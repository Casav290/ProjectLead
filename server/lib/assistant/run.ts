import { sharedTransaction, type Ctx, type Db } from '../../db.js'
import { tr } from '../i18n.js'
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

// Les écritures qui créent quelque chose, et le nom de ce qu'elles créent (server/i18n, `assistant.noun.*`).
const NOUNS: [RegExp, string][] = [
  [/^POST \/api\/projects$/, 'assistant.noun.project'],
  [/^POST \/api\/projects\/:id\/duplicate$/, 'assistant.noun.copy'],
  [/^POST \/api\/projects\/:id\/stages$/, 'assistant.noun.stage'],
  [/^POST \/api\/tasks$/, 'assistant.noun.task'],
  [/^POST \/api\/tasks\/:id\/dependencies$/, 'assistant.noun.dependency'],
  [/^POST \/api\/tasks\/:id\/checklist$/, 'assistant.noun.checklist'],
  [/^POST \/api\/(tasks|projects)\/:id\/comments$/, 'assistant.noun.comment'],
  [/^POST \/api\/projects\/:id\/columns$/, 'assistant.noun.column'],
  [/^POST \/api\/time\/entries$/, 'assistant.noun.time'],
  [/^POST \/api\/clients$/, 'assistant.noun.client'],
  [/^POST \/api\/clients\/:id\/contacts$/, 'assistant.noun.contact'],
  [/^POST \/api\/calendar\/events$/, 'assistant.noun.event'],
]

/**
 * Ce qu'une écriture seule sur sa carte (mode `route` : une autre application, une synchronisation) a VRAIMENT fait. Ces
 * routes répondent 200 même quand rien n'a abouti (facturation : un résultat par projet ; synchronisation : `ok: false`) :
 * la carte ne dit « fait » que si quelque chose a été fait, et dit quoi. `ok: false` : rien n'a abouti.
 */
export function routeOutcome(op: WriteOp, body: any, l: string = 'fr'): { ok: boolean; line: string | null; code?: string } {
  const label = opLabel(op)
  const sep = l === 'fr' ? ' ; ' : '; '
  if (label === 'POST /api/integrations/billing/run') {
    const res: any[] = Array.isArray(body?.results) ? body.results : []
    if (!res.length) return { ok: true, line: tr(l, 'assistant.outcome.billingNone') }
    const count = (s: string) => res.filter((x) => x?.status === s).length
    const created = count('created'), skipped = count('skipped'), empty = count('empty'), errors = count('error')
    if (!created && errors) return { ok: false, line: tr(l, 'assistant.outcome.billingFailed', { n: errors }), code: 'billing_failed' }
    const parts = [created && tr(l, 'assistant.outcome.billingCreated', { n: created }), skipped && tr(l, 'assistant.outcome.billingSkipped', { n: skipped }),
      empty && tr(l, 'assistant.outcome.billingEmpty', { n: empty }), errors && tr(l, 'assistant.outcome.billingErrors', { n: errors })].filter(Boolean)
    return { ok: true, line: `${parts.join(sep)}.` }
  }
  if (label === 'POST /api/calendar/feeds/:id/sync' || label === 'POST /api/mail/mailboxes/:id/sync') {
    if (body?.ok === false || (typeof body?.error === 'string' && body.error)) return { ok: false, line: tr(l, 'assistant.outcome.syncFailed'), code: 'sync_failed' }
    const n = label.includes('calendar') ? body?.count : body?.imported
    if (typeof n !== 'number') return { ok: true, line: null }
    return { ok: true, line: `${tr(l, label.includes('calendar') ? 'assistant.outcome.syncEvents' : 'assistant.outcome.syncEmails', { n })}.` }
  }
  return { ok: true, line: null }
}

/** « Créé : 7 étapes, 24 tâches (dont 2 jalons), 18 dépendances ; dates du projet posées. », dans la langue `l`. */
export function doneLine(ops: WriteOp[], l: string = 'fr'): string {
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
  const parts = NOUNS.filter(([, key]) => counts.has(key)).map(([, key]) =>
    `${tr(l, key, { n: counts.get(key) })}${key === 'assistant.noun.task' && milestones ? ` ${tr(l, 'assistant.ofWhichMilestones', { n: milestones })}` : ''}`)
  const out: string[] = []
  if (parts.length) out.push(tr(l, 'assistant.created', { list: parts.join(', ') }))
  if (projectDates) out.push(tr(l, 'assistant.projectDatesSet'))
  if (changes) out.push(tr(l, 'assistant.changesSaved', { n: changes }))
  // Le point-virgule suit la typographie de la langue (espace avant en français seulement).
  return `${out.join(l === 'fr' ? ' ; ' : '; ')}.`
}
