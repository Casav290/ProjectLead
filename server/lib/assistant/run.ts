import { sharedTransaction, type Ctx, type Db } from '../../db.js'
import { callApi } from './internal.js'
import { opAllowed, opLabel, REF, REF_FIELDS, type Mode, type WriteOp } from './token.js'

/**
 * Exécute les écritures d'une carte de l'Assistant IA : chacune est la route même de l'écran (`callApi`, avec la session
 * de la personne : session, rôle, RLS, projets réservés, limites de la formule revérifiés à ce moment).
 * - `tx` : toutes dans UNE transaction partagée (db.ts, `sharedTransaction`) : la première qui échoue annule tout.
 * - `route` : une seule écriture, la route telle quelle (elle appelle une autre application hors transaction).
 * `dryRun` : l'essai d'une proposition, avant d'afficher la carte ; la transaction est toujours annulée et rien ne sort.
 */
export class OpFailure extends Error {
  constructor(public index: number, public status: number, public code: string, public label: string, public body: any = null) {
    super(code)
  }
}

const resolve = (v: unknown, ids: Map<string, string>, index: number, label: string) => {
  if (typeof v !== 'string' || !REF.test(v)) return v
  const id = ids.get(v.slice(1))
  if (!id) throw new OpFailure(index, 400, 'unknown_reference', label)
  return id
}

/** Remplace les références « @ref » (chemin et champs d'identifiants) par les identifiants déjà créés. */
export function resolveOp(op: WriteOp, ids: Map<string, string>, index = 0): WriteOp {
  const label = opLabel(op)
  const path = op.path.split('/').map((seg) => resolve(seg, ids, index, label) as string).join('/')
  const body: Record<string, unknown> = { ...op.body }
  for (const f of REF_FIELDS) if (f in body) body[f] = resolve(body[f], ids, index, label)
  return { method: op.method, path, body, ...(op.ref ? { ref: op.ref } : {}) }
}

export type RunOutcome = { results: { label: string; status: number; body: any }[]; ids: Record<string, string> }

async function each(cookie: string, ops: WriteOp[], mode: Mode): Promise<RunOutcome> {
  const ids = new Map<string, string>()
  const results: RunOutcome['results'] = []
  for (const [i, raw] of ops.entries()) {
    const op = resolveOp(raw, ids, i)
    const label = opLabel(op)
    // La liste fermée, revérifiée sur le chemin réel (après remplacement des références).
    if (!opAllowed(op, mode)) throw new OpFailure(i, 403, 'operation_not_allowed', label)
    const r = await callApi(cookie, op.method, op.path, op.body)
    if (r.status >= 400) throw new OpFailure(i, r.status, String(r.body?.error ?? `http_${r.status}`), label, r.body)
    if (op.ref) {
      const id = r.body?.id
      if (typeof id !== 'string') throw new OpFailure(i, 500, 'no_id', label)
      ids.set(op.ref, id)
    }
    results.push({ label, status: r.status, body: r.body })
  }
  return { results, ids: Object.fromEntries(ids) }
}

export async function runOps(cookie: string, ctx: Ctx, ops: WriteOp[], mode: Mode,
  opts: { dryRun?: boolean; first?: (db: Db) => Promise<void> } = {}): Promise<RunOutcome> {
  if (mode === 'route') {
    if (opts.dryRun) throw new Error('dry_run_route')
    if (ops.length !== 1) throw new OpFailure(0, 400, 'route_single_only', 'route')
    return each(cookie, ops, 'route')
  }
  return sharedTransaction(ctx, async (db) => {
    if (opts.first) await opts.first(db)
    return each(cookie, ops, 'tx')
  }, { dryRun: opts.dryRun })
}

// ------------------------------------------------------------------ ce qui a été fait, en une ligne

const NOUNS: [RegExp, string, string][] = [
  [/^POST \/api\/projects$/, 'projet', 'projets'],
  [/^POST \/api\/projects\/:id\/duplicate$/, 'copie de projet', 'copies de projet'],
  [/^POST \/api\/projects\/:id\/stages$/, 'étape', 'étapes'],
  [/^POST \/api\/tasks$/, 'tâche', 'tâches'],
  [/^POST \/api\/tasks\/:id\/dependencies$/, 'dépendance', 'dépendances'],
  [/^POST \/api\/tasks\/:id\/checklist$/, 'point de contrôle', 'points de contrôle'],
  [/^POST \/api\/(tasks|projects)\/:id\/comments$/, 'commentaire', 'commentaires'],
  [/^POST \/api\/projects\/:id\/columns$/, 'colonne', 'colonnes'],
  [/^POST \/api\/time\/entries$/, 'saisie de temps', 'saisies de temps'],
  [/^POST \/api\/clients$/, 'client', 'clients'],
  [/^POST \/api\/clients\/:id\/contacts$/, 'contact', 'contacts'],
  [/^POST \/api\/calendar\/events$/, 'rendez-vous', 'rendez-vous'],
]

/** « Créé : 7 étapes, 24 tâches (dont 2 jalons), 18 dépendances ; 1 modification enregistrée. » */
export function doneLine(ops: WriteOp[]): string {
  const counts = new Map<string, number>()
  let changes = 0, milestones = 0, projectDates = false
  for (const op of ops) {
    const label = opLabel(op)
    // Les dates d'un projet posées par un plan : dites comme telles.
    if (label === 'PATCH /api/projects/:id' && Object.keys(op.body).every((k) => k === 'start_date' || k === 'due_date')) { projectDates = true; continue }
    const n = NOUNS.find(([re]) => re.test(label))
    if (!n) { changes++; continue }
    counts.set(n[1], (counts.get(n[1]) ?? 0) + 1)
    if (label === 'POST /api/tasks' && op.body.is_milestone === true) milestones++
  }
  const parts = NOUNS.filter(([, one]) => counts.has(one)).map(([, one, many]) => {
    const c = counts.get(one)!
    return `${c} ${c > 1 ? many : one}${one === 'tâche' && milestones ? ` (dont ${milestones} jalon${milestones > 1 ? 's' : ''})` : ''}`
  })
  const out: string[] = []
  if (parts.length) out.push(`Créé : ${parts.join(', ')}`)
  if (projectDates) out.push('dates du projet posées')
  if (changes) out.push(`${changes} modification${changes > 1 ? 's' : ''} enregistrée${changes > 1 ? 's' : ''}`)
  return `${out.join(' ; ')}.`
}
