import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import * as z from 'zod/v4'
import type { Ctx } from '../../db.js'
import { callApi } from './internal.js'
import { OpFailure, runOps } from './run.js'
import { schedulePlan, workdayFrom, workdaysBetween } from './schedule.js'
import { MAX_OPS, opAllowed, signConfirm, type Mode, type Summary, type SummaryGroup, type WriteOp } from './token.js'

/**
 * Les outils de l'assistant de ProjectLead. Chacun appelle les routes existantes (`callApi`, avec la session de la
 * personne) : mêmes droits que l'écran. Lecture : résultats réduits aux champs utiles, 50 lignes au plus.
 *
 * Écriture (`propose_*`) : l'outil NE FAIT RIEN de durable. Il prépare les écritures exactes (les routes mêmes de
 * l'écran), les ESSAIE dans une transaction toujours annulée (une proposition qui échouerait n'est pas montrée), puis les
 * signe (`signConfirm`) et les renvoie au navigateur en UNE carte « À confirmer ». Seul le clic « Confirmer » les exécute
 * (POST /api/assistant/confirm), toutes ensemble ou aucune. Plusieurs changements = une carte : `propose_batch`
 * (lot de changements simples) ou `propose_project_plan` (étapes, tâches, jalons, dépendances et dates d'un projet).
 *
 * Aucun outil ne supprime ni n'archive, ne gère l'équipe, les membres ou le responsable d'un projet, la visibilité,
 * l'abonnement, les clés d'API, les branchements (boîtes mail, agendas extérieurs), ni n'envoie quoi que ce soit à
 * l'extérieur (liste fermée de token.ts, docs/ASSISTANT-ACTIONS.md).
 */

export type ConfirmAction = { type: 'confirm'; token: string; summary: Summary }
export type NavigateAction = { type: 'navigate'; path: string }
export type AssistantAction = ConfirmAction | NavigateAction

export type ToolScope = { cookie: string; ctx: Ctx; actions: AssistantAction[]; used: string[]; today: string }

const MAX_ROWS = 50
const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-JJ')
const DATETIME = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, 'AAAA-MM-JJTHH:MM+01:00')
const KEY = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/, 'clé courte : lettres, chiffres, - ou _')
const PRIORITY = z.enum(['low', 'normal', 'high', 'urgent'])
const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const MINUTES = z.number().int().min(0).max(100_000)
const CENTS = z.number().int().min(0).max(1e12)
const PRIORITY_FR: Record<string, string> = { low: 'basse', normal: 'normale', high: 'haute', urgent: 'urgente' }
const STATUS_FR: Record<string, string> = { lead: 'à qualifier', planned: 'planifié', active: 'en cours', on_hold: 'en pause', done: 'terminé', cancelled: 'annulé' }
const HEALTH_FR: Record<string, string> = { on_track: 'dans les temps', at_risk: 'à risque', off_track: 'en retard' }
const STAGE_FR: Record<string, string> = { todo: 'à venir', in_progress: 'en cours', done: 'terminée', blocked: 'en attente' }
const BILLING_FR: Record<string, string> = { none: 'non facturable', hourly: 'à l’heure', retainer: 'forfait mensuel', fixed: 'forfait global', milestone: 'par étape' }
const RECURRENCE_FR: Record<string, string> = { none: 'aucune', daily: 'chaque jour', weekly: 'chaque semaine', monthly: 'chaque mois' }

const clip = (v: unknown, n = 300) => {
  if (typeof v !== 'string') return v
  return v.length > n ? v.slice(0, n) + '…' : v
}
const hours = (m: number | null | undefined) => (m == null ? null : Math.round((m / 60) * 100) / 100)
const hm = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`
const money = (cents: number | null | undefined, cur = 'CHF') => (cents == null ? 'aucun' : `${cur} ${(cents / 100).toLocaleString('fr-CH', { minimumFractionDigits: cents % 100 ? 2 : 0 })}`)
const pick = <T extends Record<string, any>>(o: T, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
const yesNo = (b: boolean) => (b ? 'oui' : 'non')

/** Le texte rendu au modèle : JSON compact, au plus ~14 000 caractères. */
const out = (v: unknown) => {
  const s = JSON.stringify(v)
  return s.length > 14_000 ? s.slice(0, 14_000) + '…(tronqué)' : s
}
const rows = (list: any[], map: (r: any) => unknown) => ({
  total: list.length, shown: Math.min(list.length, MAX_ROWS), rows: list.slice(0, MAX_ROWS).map(map),
})

/** Un refus de route, dit au modèle sans détail technique. */
const refusal = (status: number, body: any) => out({ error: body?.error ?? `http_${status}`, status,
  hint: status === 404 ? 'introuvable ou pas accessible à cette personne' : status === 403 ? 'le rôle de la personne ne le permet pas' : undefined })

/** Les refus des routes, dits en clair (carte et modèle). */
export const ROUTE_ERRORS: Record<string, string> = {
  forbidden: 'Votre rôle ne permet pas cette action.',
  not_found: 'Introuvable, ou vous n’y avez pas accès.',
  invalid_input: 'Une valeur est refusée : rien n’a été enregistré.',
  plan_limit_projects: 'La formule de votre entreprise ne permet pas un projet en cours de plus : terminez ou archivez un projet.',
  already_invoiced: 'Ce temps est déjà facturé : il ne se modifie plus.',
  other_project: 'Cet élément appartient à un autre projet.',
  unknown_reference: 'Un élément lié n’existe plus.',
  conflict: 'Cet élément existe déjà (adresse ou nom déjà pris).',
  dependency_cycle: 'Ces dépendances tourneraient en rond.',
  dependency_other_project: 'Une dépendance ne relie que deux tâches du même projet.',
  self_dependency: 'Une tâche ne peut pas dépendre d’elle-même.',
  last_column: 'Un tableau garde au moins une colonne.',
  unknown_column: 'Cette colonne n’est pas dans le projet.',
  end_before_start: 'La fin est avant le début.',
  invalid_timezone: 'Fuseau horaire inconnu.',
  not_from_crmlead: 'Ce client ne vient pas de CRMlead.',
  operation_not_allowed: 'Cette action n’est pas permise à l’assistant.',
  lead_required: 'ProjectLead n’est pas relié au Compte Lead de l’entreprise.',
  person_proof: 'Reconnectez-vous à votre Compte Lead pour lire l’autre application.',
  not_opened: 'Ouvrez d’abord l’autre application une fois avec votre Compte Lead.',
  no_seat: 'Pas de place pour vous dans l’autre application.',
  not_linked: 'Les deux applications ne sont pas encore reliées.',
  token_used: 'Cette carte a déjà été confirmée.',
}

/** Les pages de l'application vers lesquelles l'assistant peut ouvrir (open_page, liens des cartes). */
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PAGES = [
  /^\/$/, /^\/taches$/, /^\/projets$/, /^\/modeles$/, /^\/emails$/, /^\/agenda$/, /^\/temps$/, /^\/charge$/, /^\/rapports$/,
  /^\/clients$/, /^\/facturation$/, /^\/recherche(\?q=[^#]{0,200})?$/,
  new RegExp(`^/projets/${ID}(/(tableau|liste|gantt|calendrier|etapes|temps|fichiers|activite|emails|suivi|reglages))?(\\?tache=${ID})?$`),
  new RegExp(`^/clients/${ID}$`),
  /^\/reglages(\/(profil|entreprise|equipe|emails|agendas|rendez-vous|formulaires|automatisations|integrations|api))?$/,
]
export const pageAllowed = (p: string) => PAGES.some((re) => re.test(p))

type Line = string | null | false | undefined | 0
/** Ce qu'un outil d'écriture prépare : les écritures, et ce que la carte en montre. */
type Built = {
  title: string; lines: Line[]; ops: WriteOp[]
  short?: string            // une ligne, pour un lot
  groups?: SummaryGroup[]
  open?: string | null      // la page à ouvrir après « Confirmer » (« @ref » permis)
  links?: { label: string; path: string }[]
  mode?: Mode
  info?: Record<string, unknown>   // rendu au modèle, pour qu'il décrive juste
}
type Refused = { error: string; [k: string]: unknown }
type WriteDef = {
  name: string; title: string; description: string; schema: z.ZodObject<any>; batch: boolean
  build: (a: any) => Promise<Built | Refused>
}

/** Les outils d'écriture que `propose_batch` peut regrouper (une transaction, sans appel à une autre application). */
export const BATCHABLE = [
  'propose_create_task', 'propose_update_task', 'propose_update_tasks', 'propose_add_dependency', 'propose_add_task_comment',
  'propose_add_project_comment', 'propose_update_comment', 'propose_add_checklist_item', 'propose_update_checklist_item',
  'propose_create_project', 'propose_update_project', 'propose_duplicate_project', 'propose_project_update',
  'propose_create_stage', 'propose_update_stage', 'propose_reorder', 'propose_board_column', 'propose_set_file_visibility',
  'propose_log_time', 'propose_update_time_entry', 'propose_set_timesheet_day', 'propose_timer',
  'propose_create_client', 'propose_update_client', 'propose_client_contact', 'propose_event', 'propose_set_email_status',
  'propose_mark_notifications_read', 'propose_update_settings', 'propose_booking_page', 'propose_intake_form', 'propose_automation',
] as const

export function buildTools(s: ToolScope) {
  const get = (path: string) => callApi(s.cookie, 'GET', path)
  const mark = (name: string) => { s.used.push(name) }

  // ------------------------------------------------------------------ dates lisibles
  const year = s.today.slice(0, 4)
  const fmtShort = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  const fmtYear = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const D = (iso: string | null | undefined) => {
    if (!iso) return 'aucune'
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
    return (iso.slice(0, 4) === year ? fmtShort : fmtYear).format(d)
  }
  const span = (a: string, b: string) => (a === b ? D(a) : `${D(a)} → ${D(b)}`)
  const when = (iso: string) => new Intl.DateTimeFormat('fr-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' }).format(new Date(iso))

  // ------------------------------------------------------------------ lectures communes
  let teamCache: any[] | null = null
  const team = async () => {
    if (!teamCache) { const r = await get('/api/team'); teamCache = r.status === 200 ? r.body.members : [] }
    return teamCache!
  }
  const peopleNames = async (ids: string[] | undefined) => {
    if (!ids?.length) return ''
    const t = await team()
    return ids.map((id) => t.find((m) => m.id === id)?.name ?? 'personne inconnue').join(', ')
  }
  const unknownPeople = async (ids: string[] | undefined) => {
    if (!ids?.length) return []
    const t = await team()
    return ids.filter((id) => !t.some((m) => m.id === id && m.active))
  }
  const project = async (id: string) => {
    const r = await get(`/api/projects/${id}`)
    return r.status === 200 ? r.body : null
  }
  const task = async (id: string) => {
    const r = await get(`/api/tasks/${id}`)
    return r.status === 200 ? r.body : null
  }
  const client = async (id: string) => {
    const r = await get(`/api/clients/${id}`)
    return r.status === 200 ? r.body : null
  }

  // ------------------------------------------------------------------ proposer : essayer, signer, montrer
  const failureForModel = (e: unknown, n: number) => {
    if (e instanceof OpFailure) return { error: 'would_fail', step: e.index + 1, of: n, status: e.status, code: e.code, operation: e.label,
      hint: ROUTE_ERRORS[e.code] ?? 'refusé par l’application', fields: e.body?.fields }
    return { error: 'would_fail', code: String((e as Error)?.message ?? e).slice(0, 80) }
  }

  const propose = async (tool: string, b: Built | Refused) => {
    if ('error' in b) return out(b)
    const mode = b.mode ?? 'tx'
    if (!b.ops.length) return out({ error: 'nothing_to_change' })
    if (b.ops.length > MAX_OPS) return out({ error: 'too_many_operations', operations: b.ops.length, max: MAX_OPS,
      hint: 'découper en deux cartes ou alléger (moins de points de contrôle, moins de tâches)' })
    if (mode === 'route' && b.ops.length !== 1) return out({ error: 'route_single_only' })
    for (const op of b.ops) if (!opAllowed(op, mode)) return out({ error: 'operation_not_allowed' })
    // L'essai : les mêmes écritures, dans une transaction annulée. Une carte qui échouerait n'est jamais montrée.
    if (mode === 'tx') {
      try { await runOps(s.cookie, s.ctx, b.ops, 'tx', { dryRun: true }) } catch (e) { return out(failureForModel(e, b.ops.length)) }
    }
    const summary: Summary = { title: b.title, lines: b.lines.filter((l): l is string => Boolean(l)) }
    if (b.groups?.length) summary.groups = b.groups
    const page = (x: string) => pageAllowed(x.replace(/@[A-Za-z0-9_:.-]+/g, '00000000-0000-4000-8000-000000000000'))
    const token = signConfirm({ u: s.ctx.userId, a: s.ctx.accountId, mode, tool, ops: b.ops, summary,
      open: b.open && page(b.open) ? b.open : null, ...(b.links?.length ? { links: b.links.filter((l) => page(l.path)) } : {}) })
    s.actions.push({ type: 'confirm', token, summary })
    return out({ proposed: true, status: 'waiting_for_user_confirmation', card: b.title, operations: b.ops.length,
      checked: mode === 'tx' ? 'essai réussi : la confirmation écrira exactement ce que montre la carte' : undefined, ...b.info,
      note: "Carte « À confirmer » affichée à la personne. RIEN n'est encore fait : ne dis pas que c'est fait ; dis-lui de vérifier puis de cliquer « Confirmer » (ou « Annuler »)." })
  }

  // ------------------------------------------------------------------ outils d'écriture (registre)
  const W: WriteDef[] = []
  const write = (d: WriteDef) => { W.push(d); return d }
  const taskFields = {
    description: z.string().max(5000).optional(), start_date: DATE.optional(), due_date: DATE.optional(), priority: PRIORITY.optional(),
    assignee_ids: z.array(UUID).max(10).optional(), stage_id: UUID.optional(), column_id: UUID.optional(),
    estimate_minutes: MINUTES.optional(), is_milestone: z.boolean().optional(), visible_to_client: z.boolean().optional(),
    recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  }

  write({
    name: 'propose_create_task', title: 'Créer une tâche', batch: true,
    description: 'Prépare la création d’une tâche (ou d’une sous-tâche avec parent_id) dans un projet : dates, priorité, personnes, étape, colonne, estimation (minutes), jalon.',
    schema: z.object({ project_id: UUID, title: z.string().trim().min(1).max(500), parent_id: UUID.optional(), ...taskFields }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      const stage = a.stage_id ? p.stages.find((x: any) => x.id === a.stage_id) : null
      if (a.stage_id && !stage) return { error: 'stage_not_in_project' }
      if (a.column_id && !p.columns.some((x: any) => x.id === a.column_id)) return { error: 'column_not_in_project' }
      let parent: any = null
      if (a.parent_id) { parent = await task(a.parent_id); if (!parent || parent.project_id !== a.project_id) return { error: 'parent_not_in_project' } }
      if ((await unknownPeople(a.assignee_ids)).length) return { error: 'unknown_person', hint: 'ids de list_team, personnes actives' }
      const col = a.column_id ? p.columns.find((x: any) => x.id === a.column_id) : null
      return {
        title: parent ? 'Créer une sous-tâche' : 'Créer une tâche',
        ops: [{ method: 'POST', path: '/api/tasks', body: { ...a }, ref: 'task' }],
        lines: [`Tâche : « ${a.title} »`, `Projet : ${p.name}`, parent && `Sous-tâche de : « ${parent.title} »`,
          a.description && `Description : ${clip(a.description, 200)}`,
          a.start_date && `Début : ${D(a.start_date)}`, a.due_date && `Échéance : ${D(a.due_date)}`,
          a.priority && `Priorité : ${PRIORITY_FR[a.priority]}`, stage && `Étape : ${stage.name}`, col && `Colonne : ${col.name}`,
          a.assignee_ids?.length && `Assignée à : ${await peopleNames(a.assignee_ids)}`,
          a.estimate_minutes != null && `Estimation : ${hm(a.estimate_minutes)}`, a.is_milestone && 'Jalon',
          a.visible_to_client !== undefined && `Visible par le client : ${yesNo(a.visible_to_client)}`,
          a.recurrence && a.recurrence !== 'none' && `Récurrence : ${RECURRENCE_FR[a.recurrence]}`, a.tags?.length && `Étiquettes : ${a.tags.join(', ')}`],
        short: `« ${a.title} » (${p.name})${a.due_date ? `, échéance ${D(a.due_date)}` : ''}${a.assignee_ids?.length ? `, ${await peopleNames(a.assignee_ids)}` : ''}`,
        open: `/projets/${a.project_id}?tache=@task`,
      }
    },
  })

  write({
    name: 'propose_update_task', title: 'Modifier une tâche', batch: true,
    description: 'Prépare la modification d’une tâche : titre, description, dates (null = retirer), priorité, personnes assignées (liste complète qui remplace l’actuelle), terminée ou rouverte, estimation, étape (null = sans étape), colonne du tableau, jalon, visible par le client, récurrence, étiquettes.',
    schema: z.object({
      task_id: UUID, title: z.string().trim().min(1).max(500).optional(), description: z.string().max(5000).optional(),
      due_date: DATE.nullable().optional(), start_date: DATE.nullable().optional(), priority: PRIORITY.optional(),
      assignee_ids: z.array(UUID).max(10).optional(), completed: z.boolean().optional(), estimate_minutes: MINUTES.nullable().optional(),
      stage_id: UUID.nullable().optional(), column_id: UUID.optional(), is_milestone: z.boolean().optional(), visible_to_client: z.boolean().optional(),
      recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    }),
    build: async ({ task_id, ...patch }) => {
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      let stageName: string | null = null, colName: string | null = null
      if (patch.stage_id || patch.column_id) {
        const p = await project(t.project_id)
        if (patch.stage_id) { stageName = p?.stages.find((x: any) => x.id === patch.stage_id)?.name ?? null; if (!stageName) return { error: 'stage_not_in_project' } }
        if (patch.column_id) { colName = p?.columns.find((x: any) => x.id === patch.column_id)?.name ?? null; if (!colName) return { error: 'column_not_in_project' } }
      }
      if ((await unknownPeople(patch.assignee_ids)).length) return { error: 'unknown_person' }
      return {
        title: 'Modifier une tâche',
        ops: [{ method: 'PATCH', path: `/api/tasks/${task_id}`, body: patch }],
        lines: [`Tâche : « ${t.title} » (${t.project_name})`,
          patch.title && `Nouveau titre : « ${patch.title} »`, patch.description !== undefined && `Description : ${clip(patch.description, 200) || '(vide)'}`,
          patch.start_date !== undefined && `Début : ${D(patch.start_date)} (avant : ${D(t.start_date)})`,
          patch.due_date !== undefined && `Échéance : ${D(patch.due_date)} (avant : ${D(t.due_date)})`,
          patch.priority && `Priorité : ${PRIORITY_FR[patch.priority]} (avant : ${PRIORITY_FR[t.priority] ?? t.priority})`,
          patch.assignee_ids && `Assignée à : ${(await peopleNames(patch.assignee_ids)) || 'personne'} (avant : ${t.assignees.map((x: any) => x.name).join(', ') || 'personne'})`,
          patch.completed !== undefined && (patch.completed ? 'Marquer comme terminée' : 'Rouvrir la tâche'),
          patch.estimate_minutes !== undefined && `Estimation : ${patch.estimate_minutes == null ? 'aucune' : hm(patch.estimate_minutes)}`,
          patch.stage_id !== undefined && `Étape : ${stageName ?? 'sans étape'} (avant : ${t.stage_name ?? 'sans étape'})`,
          colName && `Colonne : ${colName} (avant : ${t.column_name ?? '—'})`,
          patch.is_milestone !== undefined && (patch.is_milestone ? 'Devient un jalon' : 'N’est plus un jalon'),
          patch.visible_to_client !== undefined && `Visible par le client : ${yesNo(patch.visible_to_client)}`,
          patch.recurrence && `Récurrence : ${RECURRENCE_FR[patch.recurrence]}`, patch.tags && `Étiquettes : ${patch.tags.join(', ') || 'aucune'}`],
        short: `« ${t.title} » : ${Object.keys(patch).map((k) => ({ title: 'titre', description: 'description', due_date: 'échéance', start_date: 'début', priority: 'priorité', assignee_ids: 'personnes', completed: patch.completed ? 'terminée' : 'rouverte', estimate_minutes: 'estimation', stage_id: 'étape', column_id: 'colonne', is_milestone: 'jalon', visible_to_client: 'visibilité client', recurrence: 'récurrence', tags: 'étiquettes' } as Record<string, string>)[k] ?? k).join(', ')}${patch.due_date ? ` → ${D(patch.due_date)}` : ''}`,
        open: `/projets/${t.project_id}?tache=${task_id}`,
      }
    },
  })

  write({
    name: 'propose_update_tasks', title: 'Modifier plusieurs tâches', batch: true,
    description: 'Prépare la même modification sur plusieurs tâches (comme la sélection multiple de la liste) : terminer ou rouvrir, priorité, échéance (null = retirer), étape (null = sans étape), ajouter une personne. Pas de suppression.',
    schema: z.object({
      task_ids: z.array(UUID).min(1).max(100), completed: z.boolean().optional(), priority: PRIORITY.optional(),
      due_date: DATE.nullable().optional(), stage_id: UUID.nullable().optional(), add_assignee: UUID.optional(),
    }),
    build: async ({ task_ids, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const ids = [...new Set(task_ids as string[])]
      const found: any[] = []
      for (let i = 0; i < ids.length; i += 10) found.push(...await Promise.all(ids.slice(i, i + 10).map((id) => task(id))))
      if (found.some((t) => !t)) return { error: 'task_not_found', missing: ids.filter((_, i) => !found[i]) }
      if (patch.add_assignee && (await unknownPeople([patch.add_assignee])).length) return { error: 'unknown_person' }
      if (patch.stage_id) {
        const projects = new Set(found.map((t) => t.project_id))
        if (projects.size !== 1) return { error: 'stage_needs_one_project' }
        const p = await project(found[0].project_id)
        if (!p?.stages.some((x: any) => x.id === patch.stage_id)) return { error: 'stage_not_in_project' }
      }
      const what = [patch.completed !== undefined && (patch.completed ? 'terminer' : 'rouvrir'), patch.priority && `priorité ${PRIORITY_FR[patch.priority]}`,
        patch.due_date !== undefined && `échéance ${D(patch.due_date)}`, patch.stage_id !== undefined && (patch.stage_id ? 'changer d’étape' : 'retirer l’étape'),
        patch.add_assignee && `ajouter ${await peopleNames([patch.add_assignee])}`].filter(Boolean).join(', ')
      return {
        title: `Modifier ${ids.length} tâche${ids.length > 1 ? 's' : ''}`,
        ops: [{ method: 'POST', path: '/api/tasks/bulk', body: { ids, patch } }],
        lines: [`Changement : ${what}`, ...found.slice(0, 12).map((t) => `« ${t.title} » (${t.project_name})`), found.length > 12 && `+ ${found.length - 12} autres`],
        short: `${ids.length} tâches : ${what}`,
        open: new Set(found.map((t) => t.project_id)).size === 1 ? `/projets/${found[0].project_id}/liste` : '/taches',
      }
    },
  })

  write({
    name: 'propose_add_dependency', title: 'Ajouter une dépendance', batch: true,
    description: 'Prépare une dépendance entre deux tâches du même projet : task_id attendra que depends_on_id soit terminée.',
    schema: z.object({ task_id: UUID, depends_on_id: UUID }),
    build: async ({ task_id, depends_on_id }) => {
      if (task_id === depends_on_id) return { error: 'self_dependency' }
      const [t, d] = await Promise.all([task(task_id), task(depends_on_id)])
      if (!t || !d) return { error: 'task_not_found' }
      if (t.project_id !== d.project_id) return { error: 'dependency_other_project' }
      return {
        title: 'Ajouter une dépendance',
        ops: [{ method: 'POST', path: `/api/tasks/${task_id}/dependencies`, body: { depends_on_id } }],
        lines: [`« ${t.title} » attendra « ${d.title} »`, `Projet : ${t.project_name}`],
        short: `« ${t.title} » après « ${d.title} »`, open: `/projets/${t.project_id}/gantt`,
      }
    },
  })

  write({
    name: 'propose_add_task_comment', title: 'Commenter une tâche', batch: true,
    description: 'Prépare un commentaire sur une tâche (les @Prénom Nom cités sont notifiés dans ProjectLead).',
    schema: z.object({ task_id: UUID, body: z.string().trim().min(1).max(5000) }),
    build: async ({ task_id, body }) => {
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      return { title: 'Commenter une tâche', ops: [{ method: 'POST', path: `/api/tasks/${task_id}/comments`, body: { body } }],
        lines: [`Tâche : « ${t.title} » (${t.project_name})`, `Commentaire : ${clip(body, 400)}`], short: `« ${t.title} » : ${clip(body, 80)}`,
        open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  write({
    name: 'propose_add_project_comment', title: 'Commenter un projet', batch: true,
    description: 'Prépare un commentaire dans le fil d’activité d’un projet (interne à l’équipe ; les @Prénom Nom cités sont notifiés).',
    schema: z.object({ project_id: UUID, body: z.string().trim().min(1).max(5000) }),
    build: async ({ project_id, body }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      return { title: 'Commenter un projet', ops: [{ method: 'POST', path: `/api/projects/${project_id}/comments`, body: { body } }],
        lines: [`Projet : ${p.name}`, `Commentaire : ${clip(body, 400)}`, 'Interne à l’équipe'], short: `${p.name} : ${clip(body, 80)}`,
        open: `/projets/${project_id}/activite` }
    },
  })

  write({
    name: 'propose_update_comment', title: 'Modifier un commentaire', batch: true,
    description: 'Prépare la modification d’un de SES commentaires sur une tâche (comment_id et task_id lus avec get_task).',
    schema: z.object({ task_id: UUID, comment_id: UUID, body: z.string().trim().min(1).max(5000) }),
    build: async ({ task_id, comment_id, body }) => {
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      const cm = t.comment_list.find((x: any) => x.id === comment_id)
      if (!cm) return { error: 'comment_not_found' }
      if (cm.author_id !== s.ctx.userId) return { error: 'not_author', hint: 'seul l’auteur modifie son commentaire' }
      return { title: 'Modifier un commentaire', ops: [{ method: 'PATCH', path: `/api/tasks/comments/${comment_id}`, body: { body } }],
        lines: [`Tâche : « ${t.title} »`, `Avant : ${clip(cm.body, 200)}`, `Après : ${clip(body, 400)}`], short: `« ${t.title} » : ${clip(body, 80)}`,
        open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  write({
    name: 'propose_add_checklist_item', title: 'Ajouter un point de contrôle', batch: true,
    description: 'Prépare l’ajout d’un point à la liste de contrôle d’une tâche.',
    schema: z.object({ task_id: UUID, label: z.string().trim().min(1).max(300) }),
    build: async ({ task_id, label }) => {
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      return { title: 'Ajouter un point de contrôle', ops: [{ method: 'POST', path: `/api/tasks/${task_id}/checklist`, body: { label } }],
        lines: [`Tâche : « ${t.title} » (${t.project_name})`, `Point : ${label}`], short: `« ${t.title} » : ${label}`, open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  write({
    name: 'propose_update_checklist_item', title: 'Modifier un point de contrôle', batch: true,
    description: 'Prépare le cochage, le décochage ou le renommage d’un point de la liste de contrôle d’une tâche (item_id lu avec get_task).',
    schema: z.object({ task_id: UUID, item_id: UUID, label: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }),
    build: async ({ task_id, item_id, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      const it = t.checklist.find((x: any) => x.id === item_id)
      if (!it) return { error: 'item_not_found' }
      return { title: 'Modifier un point de contrôle', ops: [{ method: 'PATCH', path: `/api/tasks/checklist/${item_id}`, body: patch }],
        lines: [`Tâche : « ${t.title} »`, `Point : ${it.label}`, patch.label && `Nouveau libellé : ${patch.label}`, patch.done !== undefined && (patch.done ? 'Cocher' : 'Décocher')],
        short: `« ${it.label} » : ${patch.done === undefined ? 'renommé' : patch.done ? 'coché' : 'décoché'}`, open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  const billingFields = {
    billing_mode: z.enum(['none', 'hourly', 'retainer', 'fixed', 'milestone']).optional(), hourly_rate_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
    retainer_cents: CENTS.nullable().optional(), fixed_cents: CENTS.nullable().optional(), budget_cents: CENTS.nullable().optional(),
    currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).optional(), vat_code: z.enum(['normal', 'reduced', 'lodging', 'exempt', 'export']).optional(),
  }
  const billingLines = (a: any, cur: string) => [
    a.billing_mode && `Facturation : ${BILLING_FR[a.billing_mode]}`, a.hourly_rate_cents !== undefined && `Taux horaire : ${money(a.hourly_rate_cents, cur)}`,
    a.retainer_cents !== undefined && `Forfait mensuel : ${money(a.retainer_cents, cur)}`, a.fixed_cents !== undefined && `Forfait global : ${money(a.fixed_cents, cur)}`,
    a.budget_cents !== undefined && `Budget : ${money(a.budget_cents, cur)}`, a.currency && `Devise : ${a.currency}`, a.vat_code && `TVA : ${a.vat_code}`]

  write({
    name: 'propose_create_project', title: 'Créer un projet', batch: true,
    description: 'Prépare la création d’un projet (ou d’un modèle avec is_template, ou depuis un modèle avec template_id). La personne connectée en est la responsable. Pour créer un projet ET planifier ses étapes en une carte : propose_project_plan avec new_project.',
    schema: z.object({
      name: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), client_id: UUID.optional(), code: z.string().trim().max(30).optional(),
      status: z.enum(['lead', 'planned', 'active', 'on_hold']).optional(), priority: PRIORITY.optional(), color: COLOR.optional(),
      start_date: DATE.optional(), due_date: DATE.optional(), budget_minutes: z.number().int().min(0).max(10_000_000).optional(),
      template_id: UUID.optional(), is_template: z.boolean().optional(), ...billingFields,
    }),
    build: async (a) => {
      let cl: string | null = null
      if (a.client_id) { const c = await client(a.client_id); if (!c) return { error: 'client_not_found' }; cl = c.name }
      let template: string | null = null
      if (a.template_id) { const t = await project(a.template_id); if (!t || !t.is_template) return { error: 'template_not_found' }; template = t.name }
      const body = { ...a, ...(a.is_template ? { status: 'planned' } : {}) }
      return {
        title: a.is_template ? 'Créer un modèle de projet' : 'Créer un projet',
        ops: [{ method: 'POST', path: '/api/projects', body, ref: 'project' }],
        lines: [`${a.is_template ? 'Modèle' : 'Projet'} : « ${a.name} »`, cl && `Client : ${cl}`, template && `Depuis le modèle : ${template} (étapes, colonnes et tâches recopiées, dates recalées)`,
          !a.is_template && `Statut : ${STATUS_FR[a.status ?? 'planned'] ?? a.status}`, a.code && `Code : ${a.code}`, a.priority && `Priorité : ${PRIORITY_FR[a.priority]}`,
          a.start_date && `Début : ${D(a.start_date)}`, a.due_date && `Échéance : ${D(a.due_date)}`,
          a.budget_minutes != null && `Budget : ${hm(a.budget_minutes)}`, ...billingLines(a, a.currency ?? 'CHF'), a.description && `Description : ${clip(a.description, 200)}`],
        short: `« ${a.name} »${cl ? ` (${cl})` : ''}`, open: '/projets/@project',
      }
    },
  })

  write({
    name: 'propose_update_project', title: 'Modifier un projet', batch: true,
    description: 'Prépare la modification d’un projet : nom, code, couleur, description, client (null = aucun), statut, santé, priorité, dates (null = retirer), budget (heures en minutes, montant en centimes), facturation (mode, taux, forfaits, devise, TVA), ce que la page de suivi montre (tâches, temps). Pas la visibilité, le responsable, les intervenants, l’ouverture de la page de suivi ni l’envoi automatique : écran du projet.',
    schema: z.object({
      project_id: UUID, name: z.string().trim().min(1).max(200).optional(), code: z.string().trim().max(30).nullable().optional(), color: COLOR.optional(),
      description: z.string().max(5000).optional(), client_id: UUID.nullable().optional(),
      status: z.enum(['lead', 'planned', 'active', 'on_hold', 'done', 'cancelled']).optional(),
      health: z.enum(['on_track', 'at_risk', 'off_track']).optional(), priority: PRIORITY.optional(),
      start_date: DATE.nullable().optional(), due_date: DATE.nullable().optional(),
      budget_minutes: z.number().int().min(0).max(10_000_000).nullable().optional(), ...billingFields,
      portal_show_tasks: z.boolean().optional(), portal_show_time: z.boolean().optional(),
    }),
    build: async ({ project_id, ...patch }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      let cl: string | null = null
      if (patch.client_id) { const c = await client(patch.client_id); if (!c) return { error: 'client_not_found' }; cl = c.name }
      return {
        title: p.is_template ? 'Modifier un modèle' : 'Modifier un projet',
        ops: [{ method: 'PATCH', path: `/api/projects/${project_id}`, body: patch }],
        lines: [`Projet : ${p.name}`, patch.name && `Nouveau nom : « ${patch.name} »`, patch.code !== undefined && `Code : ${patch.code ?? 'aucun'}`,
          patch.color && `Couleur : ${patch.color}`, patch.client_id !== undefined && `Client : ${cl ?? 'aucun'} (avant : ${p.client?.name ?? 'aucun'})`,
          patch.status && `Statut : ${STATUS_FR[patch.status]} (avant : ${STATUS_FR[p.status] ?? p.status})`,
          patch.health && `Santé : ${HEALTH_FR[patch.health]} (avant : ${HEALTH_FR[p.health] ?? p.health})`,
          patch.priority && `Priorité : ${PRIORITY_FR[patch.priority]}`,
          patch.start_date !== undefined && `Début : ${D(patch.start_date)} (avant : ${D(p.start_date)})`,
          patch.due_date !== undefined && `Échéance : ${D(patch.due_date)} (avant : ${D(p.due_date)})`,
          patch.budget_minutes !== undefined && `Budget en heures : ${patch.budget_minutes == null ? 'aucun' : hm(patch.budget_minutes)}`,
          ...billingLines(patch, patch.currency ?? p.currency ?? 'CHF'),
          patch.portal_show_tasks !== undefined && `Page de suivi : tâches visibles ${yesNo(patch.portal_show_tasks)}`,
          patch.portal_show_time !== undefined && `Page de suivi : temps visible ${yesNo(patch.portal_show_time)}`,
          patch.description !== undefined && `Description : ${clip(patch.description, 200) || '(vide)'}`],
        short: `${p.name} : ${Object.keys(patch).length} changement${Object.keys(patch).length > 1 ? 's' : ''}`,
        open: `/projets/${project_id}`,
      }
    },
  })

  write({
    name: 'propose_duplicate_project', title: 'Dupliquer un projet', batch: true,
    description: 'Prépare la copie d’un projet (étapes, colonnes, tâches, dépendances, dates recalées sur start_date) en nouveau projet, ou son enregistrement comme MODÈLE réutilisable (as_template: true, sans client).',
    schema: z.object({ project_id: UUID, name: z.string().trim().min(1).max(200), as_template: z.boolean().default(false), start_date: DATE.optional(), client_id: UUID.optional() }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      let cl: string | null = null
      if (a.client_id && !a.as_template) { const c = await client(a.client_id); if (!c) return { error: 'client_not_found' }; cl = c.name }
      const body: Record<string, unknown> = { name: a.name, as_template: a.as_template, ...(a.as_template ? {} : { start_date: a.start_date ?? s.today, ...(a.client_id ? { client_id: a.client_id } : {}) }) }
      return {
        title: a.as_template ? 'Enregistrer comme modèle' : 'Dupliquer un projet',
        ops: [{ method: 'POST', path: `/api/projects/${a.project_id}/duplicate`, body, ref: 'copy' }],
        lines: [a.as_template ? `Modèle « ${a.name} » à partir de « ${p.name} »` : `Nouveau projet « ${a.name} », copie de « ${p.name} »`,
          `Recopie : ${p.stages.length} étape${p.stages.length > 1 ? 's' : ''}, ${p.tasks_total} tâche${p.tasks_total > 1 ? 's' : ''}, colonnes et dépendances`,
          !a.as_template && `Début du nouveau projet : ${D(String(body.start_date))} (dates recalées)`, cl && `Client : ${cl}`,
          a.as_template && 'Sans client ; réutilisable depuis Modèles'],
        short: `${a.as_template ? 'modèle' : 'copie'} « ${a.name} »`, open: '/projets/@copy',
      }
    },
  })

  write({
    name: 'propose_project_update', title: "Publier un point d'avancement", batch: true,
    description: "Prépare un point d'avancement interne sur un projet (santé + texte). Il n'est PAS partagé avec le client.",
    schema: z.object({ project_id: UUID, health: z.enum(['on_track', 'at_risk', 'off_track']), body: z.string().trim().max(5000).default('') }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      return { title: "Publier un point d'avancement",
        ops: [{ method: 'POST', path: `/api/projects/${a.project_id}/updates`, body: { health: a.health, body: a.body, share_with_client: false } }],
        lines: [`Projet : ${p.name}`, `Santé : ${HEALTH_FR[a.health]}`, a.body && `Texte : ${clip(a.body, 400)}`, 'Interne : non partagé avec le client'],
        short: `${p.name} : ${HEALTH_FR[a.health]}`, open: `/projets/${a.project_id}` }
    },
  })

  write({
    name: 'propose_create_stage', title: 'Créer une étape', batch: true,
    description: 'Prépare une étape (grande phase) à la fin d’un projet : nom, description, note pour le client, statut, dates, visible par le client, montant si le projet est facturé par étape (centimes). Pour plusieurs étapes avec leurs tâches et dates enchaînées : propose_project_plan.',
    schema: z.object({
      project_id: UUID, name: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), client_note: z.string().max(2000).optional(),
      status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional(), start_date: DATE.optional(), due_date: DATE.optional(),
      visible_to_client: z.boolean().optional(), billing_cents: CENTS.optional(),
    }),
    build: async ({ project_id, ...a }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      if (a.start_date && a.due_date && a.start_date > a.due_date) return { error: 'end_before_start' }
      return { title: 'Créer une étape', ops: [{ method: 'POST', path: `/api/projects/${project_id}/stages`, body: a }],
        lines: [`Étape : « ${a.name} » (n° ${p.stages.length + 1})`, `Projet : ${p.name}`, a.description && `Description : ${clip(a.description, 200)}`,
          a.client_note && `Note pour le client : ${clip(a.client_note, 200)}`, a.status && `Statut : ${STAGE_FR[a.status]}`,
          (a.start_date || a.due_date) && `Dates : ${D(a.start_date)} → ${D(a.due_date)}`,
          a.visible_to_client !== undefined && `Visible par le client : ${yesNo(a.visible_to_client)}`, a.billing_cents != null && `Montant : ${money(a.billing_cents, p.currency)}`],
        short: `« ${a.name} » (${p.name})`, open: `/projets/${project_id}/etapes` }
    },
  })

  write({
    name: 'propose_update_stage', title: 'Modifier une étape', batch: true,
    description: 'Prépare la modification d’une étape (stage_id lu avec get_project) : nom, description, note pour le client, statut (sans prévenir le client), dates (null = retirer), visible par le client, montant (centimes).',
    schema: z.object({
      project_id: UUID, stage_id: UUID, name: z.string().trim().min(1).max(200).optional(), description: z.string().max(5000).optional(),
      client_note: z.string().max(2000).optional(), status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional(),
      start_date: DATE.nullable().optional(), due_date: DATE.nullable().optional(), visible_to_client: z.boolean().optional(), billing_cents: CENTS.nullable().optional(),
    }),
    build: async ({ project_id, stage_id, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const p = await project(project_id)
      const st = p?.stages.find((x: any) => x.id === stage_id)
      if (!st) return { error: 'stage_not_found' }
      return { title: 'Modifier une étape', ops: [{ method: 'PATCH', path: `/api/projects/stages/${stage_id}`, body: patch }],
        lines: [`Étape : « ${st.name} » (${p.name})`, patch.name && `Nouveau nom : « ${patch.name} »`,
          patch.status && `Statut : ${STAGE_FR[patch.status]} (avant : ${STAGE_FR[st.status] ?? st.status}) — le client n’est pas prévenu`,
          patch.start_date !== undefined && `Début : ${D(patch.start_date)} (avant : ${D(st.start_date)})`,
          patch.due_date !== undefined && `Échéance : ${D(patch.due_date)} (avant : ${D(st.due_date)})`,
          patch.description !== undefined && `Description : ${clip(patch.description, 200) || '(vide)'}`,
          patch.client_note !== undefined && `Note pour le client : ${clip(patch.client_note, 200) || '(vide)'}`,
          patch.visible_to_client !== undefined && `Visible par le client : ${yesNo(patch.visible_to_client)}`,
          patch.billing_cents !== undefined && `Montant : ${money(patch.billing_cents, p.currency)}`],
        short: `« ${st.name} » : ${Object.keys(patch).join(', ')}`, open: `/projets/${project_id}/etapes` }
    },
  })

  write({
    name: 'propose_reorder', title: 'Réordonner', batch: true,
    description: 'Prépare le nouvel ordre des étapes (kind: stages) ou des colonnes du tableau (kind: columns) d’un projet : ids = TOUS les identifiants, dans le nouvel ordre.',
    schema: z.object({ project_id: UUID, kind: z.enum(['stages', 'columns']), ids: z.array(UUID).min(1).max(100) }),
    build: async ({ project_id, kind, ids }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      const list: any[] = kind === 'stages' ? p.stages : p.columns
      if (ids.length !== list.length || new Set(ids).size !== ids.length || !ids.every((id: string) => list.some((x) => x.id === id)))
        return { error: 'ids_must_list_all', expected: list.map((x) => ({ id: x.id, name: x.name })) }
      const names = ids.map((id: string) => list.find((x) => x.id === id).name)
      return { title: kind === 'stages' ? 'Réordonner les étapes' : 'Réordonner les colonnes',
        ops: [{ method: 'POST', path: `/api/projects/${project_id}/${kind}/order`, body: { ids } }],
        lines: [`Projet : ${p.name}`, ...names.map((n: string, i: number) => `${i + 1}. ${n}`)],
        short: `${p.name} : ${names.join(' → ')}`, open: `/projets/${project_id}/${kind === 'stages' ? 'etapes' : 'tableau'}` }
    },
  })

  write({
    name: 'propose_board_column', title: 'Colonne du tableau', batch: true,
    description: 'Prépare une colonne du tableau (kanban) d’un projet : création (sans column_id, name obligatoire) ou modification (column_id) du nom, de « colonne des tâches terminées » (is_done) et de la limite de cartes (wip_limit, null = aucune).',
    schema: z.object({ project_id: UUID, column_id: UUID.optional(), name: z.string().trim().min(1).max(60).optional(), is_done: z.boolean().optional(),
      wip_limit: z.number().int().min(1).max(999).nullable().optional() }),
    build: async ({ project_id, column_id, ...a }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      if (!column_id) {
        if (!a.name) return { error: 'name_required' }
        return { title: 'Ajouter une colonne', ops: [{ method: 'POST', path: `/api/projects/${project_id}/columns`, body: a }],
          lines: [`Colonne : « ${a.name} »`, `Projet : ${p.name}`, a.is_done && 'Colonne des tâches terminées', a.wip_limit && `Limite : ${a.wip_limit} cartes`],
          short: `« ${a.name} » (${p.name})`, open: `/projets/${project_id}/tableau` }
      }
      const col = p.columns.find((x: any) => x.id === column_id)
      if (!col) return { error: 'column_not_found' }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: 'Modifier une colonne', ops: [{ method: 'PATCH', path: `/api/projects/columns/${column_id}`, body: a }],
        lines: [`Colonne : « ${col.name} » (${p.name})`, a.name && `Nouveau nom : « ${a.name} »`, a.is_done !== undefined && `Tâches terminées : ${yesNo(a.is_done)}`,
          a.wip_limit !== undefined && `Limite : ${a.wip_limit ?? 'aucune'}`],
        short: `« ${col.name} »`, open: `/projets/${project_id}/tableau` }
    },
  })

  write({
    name: 'propose_set_file_visibility', title: 'Visibilité d’un fichier', batch: true,
    description: 'Prépare le choix « visible par le client » d’un fichier du projet (sur la page de suivi, si elle est ouverte). file_id lu avec list_files.',
    schema: z.object({ project_id: UUID, file_id: UUID, visible_to_client: z.boolean() }),
    build: async ({ project_id, file_id, visible_to_client }) => {
      const r = await get(`/api/projects/${project_id}/files`)
      if (r.status !== 200) return { error: 'project_not_found' }
      const f = r.body.find((x: any) => x.id === file_id)
      if (!f) return { error: 'file_not_found' }
      const p = await project(project_id)
      return { title: 'Visibilité d’un fichier', ops: [{ method: 'PATCH', path: `/api/projects/files/${file_id}`, body: { visible_to_client } }],
        lines: [`Fichier : ${f.filename} (${p?.name ?? ''})`, visible_to_client ? `Visible par le client sur sa page de suivi${p?.portal_enabled ? '' : ' (page fermée pour l’instant)'}` : 'Caché au client'],
        short: `${f.filename} : ${visible_to_client ? 'visible' : 'caché'}`, open: `/projets/${project_id}/fichiers` }
    },
  })

  write({
    name: 'propose_log_time', title: 'Saisir du temps', batch: true,
    description: 'Prépare une saisie de temps (minutes entières, 1 à 1440) sur un projet, et éventuellement une tâche de ce projet ; pour la personne connectée, ou pour un collègue (user_id : responsables et administrateurs seulement).',
    schema: z.object({
      project_id: UUID, task_id: UUID.optional(), entry_date: DATE, minutes: z.number().int().min(1).max(1440),
      note: z.string().max(2000).optional(), billable: z.boolean().optional(), user_id: UUID.optional(),
    }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      let t: any = null
      if (a.task_id) { t = await task(a.task_id); if (!t || t.project_id !== a.project_id) return { error: 'task_not_in_project' } }
      if (a.user_id && a.user_id !== s.ctx.userId && s.ctx.role === 'member') return { error: 'forbidden', hint: 'un membre ne saisit que son propre temps' }
      const body = { project_id: a.project_id, task_id: a.task_id ?? null, entry_date: a.entry_date, minutes: a.minutes, note: a.note ?? '',
        billable: a.billable ?? true, ...(a.user_id && a.user_id !== s.ctx.userId ? { user_id: a.user_id } : {}) }
      return { title: 'Saisir du temps', ops: [{ method: 'POST', path: '/api/time/entries', body }],
        lines: [`Projet : ${p.name}`, t && `Tâche : « ${t.title} »`, `Date : ${D(a.entry_date)}`, `Durée : ${hm(a.minutes)}`,
          a.user_id && a.user_id !== s.ctx.userId && `Pour : ${await peopleNames([a.user_id])}`,
          a.note && `Note : ${clip(a.note, 200)}`, p.billing_mode === 'none' ? 'Non facturable (projet non facturable)' : `Facturable : ${yesNo(body.billable)}`],
        short: `${hm(a.minutes)} le ${D(a.entry_date)} (${p.name})`, open: '/temps' }
    },
  })

  /** Une saisie de temps lue par son identifiant (liste de l'entreprise, comme l'écran Temps). */
  const timeEntry = async (id: string) => {
    const r = await get('/api/time/entries?user=all')
    return r.status === 200 ? r.body.find((e: any) => e.id === id) ?? null : null
  }
  write({
    name: 'propose_update_time_entry', title: 'Modifier une saisie de temps', batch: true,
    description: 'Prépare la modification d’une saisie de temps (entry_id lu avec list_time_entries) : projet, tâche (null = aucune), date, minutes, facturable, note. Le temps déjà facturé ne se modifie plus.',
    schema: z.object({ entry_id: UUID, project_id: UUID.optional(), task_id: UUID.nullable().optional(), entry_date: DATE.optional(),
      minutes: z.number().int().min(1).max(1440).optional(), billable: z.boolean().optional(), note: z.string().max(2000).optional() }),
    build: async ({ entry_id, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const e = await timeEntry(entry_id)
      if (!e) return { error: 'entry_not_found' }
      if (e.invoiced_at) return { error: 'already_invoiced' }
      let pName = e.project_name, tTitle: string | null = e.task_title
      if (patch.project_id) { const p = await project(patch.project_id); if (!p) return { error: 'project_not_found' }; pName = p.name }
      if (patch.task_id) { const t = await task(patch.task_id); if (!t || t.project_id !== (patch.project_id ?? e.project_id)) return { error: 'task_not_in_project' }; tTitle = t.title }
      return { title: 'Modifier une saisie de temps', ops: [{ method: 'PATCH', path: `/api/time/entries/${entry_id}`, body: patch }],
        lines: [`Saisie du ${D(e.entry_date)} : ${hm(e.minutes ?? 0)} sur ${e.project_name}${e.task_title ? ` (« ${e.task_title} »)` : ''}, ${e.user_name}`,
          patch.project_id && `Projet : ${pName}`, patch.task_id !== undefined && `Tâche : ${patch.task_id ? `« ${tTitle} »` : 'aucune'}`,
          patch.entry_date && `Date : ${D(patch.entry_date)}`, patch.minutes && `Durée : ${hm(patch.minutes)}`,
          patch.billable !== undefined && `Facturable : ${yesNo(patch.billable)}`, patch.note !== undefined && `Note : ${clip(patch.note, 200) || '(vide)'}`],
        short: `saisie du ${D(e.entry_date)} (${e.project_name})`, open: '/temps' }
    },
  })

  write({
    name: 'propose_set_timesheet_day', title: 'Feuille de temps', batch: true,
    description: 'Prépare une case de SA feuille de temps : le total du jour pour un projet (et une tâche) devient `minutes` (1 à 1440) ; les saisies de ce jour-là sur ce projet/tâche sont remplacées par une seule. Pour ajouter du temps sans remplacer : propose_log_time.',
    schema: z.object({ project_id: UUID, task_id: UUID.optional(), entry_date: DATE, minutes: z.number().int().min(1).max(1440) }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      let t: any = null
      if (a.task_id) { t = await task(a.task_id); if (!t || t.project_id !== a.project_id) return { error: 'task_not_in_project' } }
      const monday = (() => { const d = new Date(`${a.entry_date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) })()
      const w = await get(`/api/time/week?start=${monday}`)
      const before = w.status === 200 ? w.body.rows.filter((x: any) => x.project_id === a.project_id && (x.task_id ?? null) === (a.task_id ?? null)
        && String(x.entry_date).slice(0, 10) === a.entry_date).reduce((n: number, x: any) => n + x.minutes, 0) : 0
      return { title: 'Feuille de temps', ops: [{ method: 'PUT', path: '/api/time/week/cell', body: { project_id: a.project_id, task_id: a.task_id ?? null, entry_date: a.entry_date, minutes: a.minutes } }],
        lines: [`Projet : ${p.name}`, t && `Tâche : « ${t.title} »`, `Jour : ${D(a.entry_date)}`, `Total du jour : ${hm(a.minutes)} (avant : ${before ? hm(before) : 'rien'})`,
          before > 0 && 'Les saisies de ce jour sur cette ligne sont remplacées par ce total'],
        short: `${D(a.entry_date)} : ${hm(a.minutes)} (${p.name})`, open: '/temps' }
    },
  })

  write({
    name: 'propose_timer', title: 'Chronomètre', batch: true,
    description: 'Prépare le démarrage du chronomètre de la personne sur un projet (et une tâche), ou son arrêt (action stop).',
    schema: z.object({ action: z.enum(['start', 'stop']), project_id: UUID.optional(), task_id: UUID.optional(), note: z.string().max(2000).optional() }),
    build: async (a) => {
      if (a.action === 'stop') return { title: 'Arrêter le chronomètre', ops: [{ method: 'POST', path: '/api/time/timer/stop', body: {} }],
        lines: ['Le temps écoulé est enregistré.'], short: 'arrêter le chronomètre', open: '/temps' }
      if (!a.project_id) return { error: 'project_id_required' }
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      let t: any = null
      if (a.task_id) { t = await task(a.task_id); if (!t || t.project_id !== a.project_id) return { error: 'task_not_in_project' } }
      return { title: 'Démarrer le chronomètre', ops: [{ method: 'POST', path: '/api/time/timer/start', body: { project_id: a.project_id, task_id: a.task_id ?? null, note: a.note ?? '' } }],
        lines: [`Projet : ${p.name}`, t && `Tâche : « ${t.title} »`, 'Un chronomètre déjà lancé est arrêté et enregistré.'], short: `chronomètre sur ${p.name}`, open: '/temps' }
    },
  })

  const clientFields = {
    contact_person: z.string().trim().max(200).optional(), email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().max(50).optional(), street: z.string().trim().max(70).optional(), building_number: z.string().trim().max(16).optional(),
    postal_code: z.string().trim().max(16).optional(), town: z.string().trim().max(35).optional(), vat_number: z.string().trim().max(40).optional(),
    notes: z.string().max(5000).optional(),
  }
  const addressLine = (a: any) => (a.street || a.town || a.postal_code)
    && `Adresse : ${[a.street && `${a.street} ${a.building_number ?? ''}`.trim(), [a.postal_code, a.town].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`

  write({
    name: 'propose_create_client', title: 'Créer un client', batch: true,
    description: 'Prépare la création d’une fiche client (entreprise ou personne).',
    schema: z.object({
      name: z.string().trim().min(1).max(200), kind: z.enum(['company', 'person']).default('company'), ...clientFields,
      country: z.string().regex(/^[A-Z]{2}$/).default('CH'), language: z.enum(['fr', 'de', 'it', 'en']).default('fr'),
    }),
    build: async (a) => ({
      title: 'Créer un client', ops: [{ method: 'POST', path: '/api/clients', body: { ...a }, ref: 'client' }],
      lines: [`Client : ${a.name} (${a.kind === 'person' ? 'personne' : 'entreprise'})`, a.contact_person && `Contact : ${a.contact_person}`,
        a.email && `Email : ${a.email}`, a.phone && `Téléphone : ${a.phone}`, addressLine(a), `Pays : ${a.country}`, a.vat_number && `TVA : ${a.vat_number}`],
      short: a.name, open: '/clients/@client',
    }),
  })

  write({
    name: 'propose_update_client', title: 'Modifier un client', batch: true,
    description: 'Prépare la modification d’une fiche client : nom, genre, contact, email, téléphone, adresse, pays, langue, TVA, notes. (Archiver un client : écran du client.)',
    schema: z.object({ client_id: UUID, name: z.string().trim().min(1).max(200).optional(), kind: z.enum(['company', 'person']).optional(), ...clientFields,
      country: z.string().regex(/^[A-Z]{2}$/).optional(), language: z.enum(['fr', 'de', 'it', 'en']).optional() }),
    build: async ({ client_id, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const c = await client(client_id)
      if (!c) return { error: 'client_not_found' }
      return { title: 'Modifier un client', ops: [{ method: 'PATCH', path: `/api/clients/${client_id}`, body: patch }],
        lines: [`Client : ${c.name}`, ...Object.entries(patch).map(([k, v]) => `${({ name: 'Nom', kind: 'Genre', contact_person: 'Contact', email: 'Email', phone: 'Téléphone',
          street: 'Rue', building_number: 'N°', postal_code: 'NPA', town: 'Localité', vat_number: 'TVA', notes: 'Notes', country: 'Pays', language: 'Langue' } as Record<string, string>)[k] ?? k} : ${clip(String(v), 120)} (avant : ${clip(String(c[k] ?? '—'), 60)})`)],
        short: `${c.name} : ${Object.keys(patch).join(', ')}`, open: `/clients/${client_id}` }
    },
  })

  write({
    name: 'propose_client_contact', title: 'Contact d’un client', batch: true,
    description: 'Prépare un contact d’un client : ajout (sans contact_id) ou modification (contact_id lu avec get_client) : nom, email, téléphone, fonction, reçoit le suivi des projets (receives_updates).',
    schema: z.object({ client_id: UUID, contact_id: UUID.optional(), name: z.string().trim().max(200).optional(), email: z.string().trim().email().max(254).optional(),
      phone: z.string().trim().max(50).optional(), job_title: z.string().trim().max(120).optional(), receives_updates: z.boolean().optional() }),
    build: async ({ client_id, contact_id, ...a }) => {
      const c = await client(client_id)
      if (!c) return { error: 'client_not_found' }
      if (!contact_id) {
        if (!a.name && !a.email) return { error: 'name_or_email_required' }
        return { title: 'Ajouter un contact', ops: [{ method: 'POST', path: `/api/clients/${client_id}/contacts`, body: a }],
          lines: [`Client : ${c.name}`, a.name && `Nom : ${a.name}`, a.email && `Email : ${a.email}`, a.phone && `Téléphone : ${a.phone}`, a.job_title && `Fonction : ${a.job_title}`,
            `Reçoit le suivi des projets : ${yesNo(a.receives_updates ?? true)}`], short: `${a.name || a.email} (${c.name})`, open: `/clients/${client_id}` }
      }
      const k = c.contacts.find((x: any) => x.id === contact_id)
      if (!k) return { error: 'contact_not_found' }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: 'Modifier un contact', ops: [{ method: 'PATCH', path: `/api/clients/contacts/${contact_id}`, body: a }],
        lines: [`Contact : ${k.name || k.email} (${c.name})`, a.name && `Nom : ${a.name}`, a.email && `Email : ${a.email}`, a.phone && `Téléphone : ${a.phone}`,
          a.job_title && `Fonction : ${a.job_title}`, a.receives_updates !== undefined && `Reçoit le suivi : ${yesNo(a.receives_updates)}`],
        short: `${k.name || k.email}`, open: `/clients/${client_id}` }
    },
  })

  write({
    name: 'propose_event', title: 'Rendez-vous', batch: true,
    description: 'Prépare un rendez-vous de l’agenda : création (sans event_id : titre, début, fin obligatoires) ou modification (event_id lu avec list_events). Dates avec heure et décalage (2026-11-03T14:00:00+01:00). Les personnes de l’équipe sont prévenues dans ProjectLead ; AUCUNE invitation n’est envoyée par email aux adresses extérieures (cela se fait depuis l’agenda).',
    schema: z.object({
      event_id: UUID.optional(), title: z.string().trim().min(1).max(300).optional(), description: z.string().max(10000).optional(), location: z.string().max(500).optional(),
      kind: z.enum(['meeting', 'call', 'workshop', 'deadline', 'other']).optional(), starts_at: DATETIME.optional(), ends_at: DATETIME.optional(), all_day: z.boolean().optional(),
      project_id: UUID.nullable().optional(), client_id: UUID.nullable().optional(), attendee_user_ids: z.array(UUID).max(50).optional(),
      attendee_emails: z.array(z.string().trim().email().max(254)).max(50).optional(),
    }),
    build: async ({ event_id, ...a }) => {
      if (a.starts_at && a.ends_at && Date.parse(a.ends_at) < Date.parse(a.starts_at)) return { error: 'end_before_start' }
      let pName: string | null = null
      if (a.project_id) { const p = await project(a.project_id); if (!p) return { error: 'project_not_found' }; pName = p.name }
      if ((await unknownPeople(a.attendee_user_ids)).length) return { error: 'unknown_person' }
      const lines: Line[] = [a.title && `Titre : ${a.title}`, a.starts_at && `Début : ${when(a.starts_at)}`, a.ends_at && `Fin : ${when(a.ends_at)}`,
        a.all_day && 'Toute la journée', a.location && `Lieu : ${a.location}`, pName && `Projet : ${pName}`,
        a.attendee_user_ids?.length && `Équipe : ${await peopleNames(a.attendee_user_ids)} (prévenue dans ProjectLead)`,
        a.attendee_emails?.length && `Participants extérieurs : ${a.attendee_emails.join(', ')} — aucune invitation envoyée`,
        a.description && `Description : ${clip(a.description, 200)}`]
      if (!event_id) {
        if (!a.title || !a.starts_at || !a.ends_at) return { error: 'title_start_end_required' }
        return { title: 'Créer un rendez-vous', ops: [{ method: 'POST', path: '/api/calendar/events', body: { ...a, send_invites: false } }],
          lines, short: `${a.title}, ${when(a.starts_at)}`, open: '/agenda' }
      }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: 'Modifier un rendez-vous', ops: [{ method: 'PATCH', path: `/api/calendar/events/${event_id}`, body: { ...a, send_invites: false } }],
        lines: ['Rendez-vous modifié :', ...lines], short: `rendez-vous ${a.title ?? ''}`.trim(), open: '/agenda' }
    },
  })

  /** Un email de la boîte de réception (même règle de visibilité que l'écran). */
  const inboxMessage = async (id: string) => {
    const r = await get('/api/mail/inbox?status=all')
    return r.status === 200 ? r.body.find((m: any) => m.id === id) ?? null : null
  }
  write({
    name: 'propose_set_email_status', title: 'Classer un email', batch: true,
    description: 'Prépare le classement d’un email reçu (message_id lu avec list_emails) : « ignored » (ignorer) ou « new » (remettre à trier, ce qui le détache de son projet).',
    schema: z.object({ message_id: UUID, status: z.enum(['new', 'ignored']) }),
    build: async ({ message_id, status }) => {
      const m = await inboxMessage(message_id)
      if (!m) return { error: 'message_not_found' }
      return { title: status === 'ignored' ? 'Ignorer un email' : 'Remettre un email à trier',
        ops: [{ method: 'POST', path: `/api/mail/messages/${message_id}/status`, body: { status } }],
        lines: [`Email : « ${m.subject || '(sans objet)'} » de ${m.from_name ?? m.from_email}`, status === 'new' && m.project_name && `Détaché du projet ${m.project_name}`],
        short: `« ${m.subject || '(sans objet)'} » : ${status === 'ignored' ? 'ignoré' : 'à trier'}`, open: '/emails' }
    },
  })

  write({
    name: 'propose_mark_notifications_read', title: 'Notifications lues', batch: true,
    description: 'Prépare le marquage de SES notifications comme lues : toutes (sans ids) ou certaines (ids lus avec list_settings kind=notifications).',
    schema: z.object({ ids: z.array(UUID).max(200).optional() }),
    build: async ({ ids }) => {
      const r = await get('/api/notifications')
      const unread = r.status === 200 ? r.body.filter((n: any) => !n.read_at && (!ids || ids.includes(n.id))) : []
      if (!unread.length) return { error: 'nothing_to_change', hint: 'aucune notification non lue' }
      return { title: 'Marquer les notifications comme lues', ops: [{ method: 'POST', path: '/api/notifications/read', body: ids ? { ids } : {} }],
        lines: [`${unread.length} notification${unread.length > 1 ? 's' : ''} non lue${unread.length > 1 ? 's' : ''}`, ...unread.slice(0, 6).map((n: any) => clip(n.title, 90) as string),
          unread.length > 6 && `+ ${unread.length - 6} autres`], short: `${unread.length} notifications lues`, open: null }
    },
  })

  write({
    name: 'propose_update_settings', title: 'Réglages', batch: true,
    description: 'Prépare des réglages : profile (son nom, sa couleur), company (entreprise, administrateurs : nom, fuseau, devise, heures par semaine), billing (facturation mensuelle vers InvoiceLead : automatique, jour, langue, signature du suivi client ; responsables et administrateurs), mailbox (une boîte branchée : nom affiché, boîte par défaut). Ni mot de passe, ni partage d’une boîte, ni équipe, ni formule.',
    schema: z.object({
      profile: z.object({ name: z.string().trim().min(1).max(120).optional(), color: COLOR.optional() }).optional(),
      company: z.object({ name: z.string().trim().min(1).max(200).optional(), timezone: z.string().max(60).optional(),
        currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).optional(), week_hours: z.number().min(1).max(80).optional() }).optional(),
      billing: z.object({ monthly_billing_auto: z.boolean().optional(), monthly_billing_day: z.number().int().min(1).max(28).optional(),
        invoice_language: z.enum(['fr', 'de', 'it', 'en']).optional(), client_update_signature: z.string().max(2000).optional() }).optional(),
      mailbox: z.object({ id: UUID, display_name: z.string().trim().max(120).optional(), is_default: z.boolean().optional() }).optional(),
    }),
    build: async (a) => {
      const ops: WriteOp[] = []
      const lines: Line[] = []
      const nonEmpty = (o: any) => o && Object.values(o).some((v) => v !== undefined)
      if (nonEmpty(a.profile)) { ops.push({ method: 'PATCH', path: '/api/me', body: a.profile }); lines.push(`Profil : ${Object.entries(a.profile).map(([k, v]) => `${k === 'name' ? 'nom' : 'couleur'} ${v}`).join(', ')}`) }
      if (nonEmpty(a.company)) { ops.push({ method: 'PATCH', path: '/api/account', body: a.company }); lines.push(`Entreprise : ${Object.entries(a.company).map(([k, v]) => `${({ name: 'nom', timezone: 'fuseau', currency: 'devise', week_hours: 'heures par semaine' } as Record<string, string>)[k]} ${v}`).join(', ')}`) }
      if (nonEmpty(a.billing)) { ops.push({ method: 'PATCH', path: '/api/integrations/settings', body: a.billing }); lines.push(`Facturation mensuelle : ${Object.entries(a.billing).map(([k, v]) => `${({ monthly_billing_auto: 'automatique', monthly_billing_day: 'jour', invoice_language: 'langue', client_update_signature: 'signature' } as Record<string, string>)[k]} ${typeof v === 'boolean' ? yesNo(v) : clip(String(v), 80)}`).join(', ')}`) }
      if (a.mailbox && (a.mailbox.display_name !== undefined || a.mailbox.is_default !== undefined)) {
        const r = await get('/api/mail/mailboxes')
        const mb = r.status === 200 ? r.body.mailboxes.find((m: any) => m.id === a.mailbox.id) : null
        if (!mb) return { error: 'mailbox_not_found' }
        const { id, ...rest } = a.mailbox
        ops.push({ method: 'PATCH', path: `/api/mail/mailboxes/${id}`, body: rest })
        lines.push(`Boîte ${mb.email} : ${[rest.display_name !== undefined && `nom affiché « ${rest.display_name} »`, rest.is_default && 'boîte par défaut'].filter(Boolean).join(', ')}`)
      }
      if (!ops.length) return { error: 'nothing_to_change' }
      return { title: 'Modifier des réglages', ops, lines, short: lines.filter(Boolean).join(' ; ') as string,
        open: a.company || a.billing ? '/reglages/entreprise' : a.mailbox ? '/reglages/emails' : '/reglages/profil' }
    },
  })

  const day = z.string().regex(/^[1-7]$/, 'jour 1 (lundi) à 7 (dimanche)')
  write({
    name: 'propose_booking_page', title: 'Page de rendez-vous', batch: true,
    description: 'Prépare une page publique de prise de rendez-vous (responsables et administrateurs) : création (sans booking_page_id : slug et nom) ou modification. Disponibilités : jours 1 (lundi) à 7, plages ["09:00","12:00"].',
    schema: z.object({
      booking_page_id: UUID.optional(), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/).optional(), name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(2000).optional(), duration_minutes: z.number().int().min(5).max(480).optional(), buffer_minutes: z.number().int().min(0).max(240).optional(),
      min_notice_hours: z.number().int().min(0).max(720).optional(), max_days_ahead: z.number().int().min(1).max(365).optional(), location: z.string().max(300).optional(),
      availability: z.record(day, z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)])).max(6)).optional(),
      host_ids: z.array(UUID).max(20).optional(), create_project: z.boolean().optional(), project_id: UUID.nullable().optional(), active: z.boolean().optional(),
    }),
    build: async ({ booking_page_id, ...a }) => {
      if ((await unknownPeople(a.host_ids)).length) return { error: 'unknown_person' }
      const lines: Line[] = [a.name && `Nom : ${a.name}`, a.slug && `Adresse : /rdv/${a.slug}`, a.duration_minutes && `Durée : ${a.duration_minutes} min`,
        a.location && `Lieu : ${a.location}`, a.host_ids?.length && `Hôtes : ${await peopleNames(a.host_ids)}`,
        a.availability && `Disponibilités : ${Object.entries(a.availability).map(([d, r]: [string, any]) => `${['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'][Number(d) - 1]} ${r.map((x: string[]) => x.join('-')).join(', ')}`).join(' ; ')}`,
        a.create_project !== undefined && `Ouvre un projet à chaque rendez-vous : ${yesNo(a.create_project)}`, a.active !== undefined && `Active : ${yesNo(a.active)}`]
      if (!booking_page_id) {
        if (!a.slug || !a.name) return { error: 'slug_and_name_required' }
        return { title: 'Créer une page de rendez-vous', ops: [{ method: 'POST', path: '/api/booking', body: a }], lines: [...lines, 'Page publique : les visiteurs y réservent un créneau'],
          short: `page « ${a.name} »`, open: '/reglages/rendez-vous' }
      }
      const r = await get('/api/booking')
      const bt = r.status === 200 ? r.body.find((x: any) => x.id === booking_page_id) : null
      if (!bt) return { error: 'booking_page_not_found' }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: 'Modifier une page de rendez-vous', ops: [{ method: 'PATCH', path: `/api/booking/${booking_page_id}`, body: a }],
        lines: [`Page : ${bt.name}`, ...lines], short: `page « ${bt.name} »`, open: '/reglages/rendez-vous' }
    },
  })

  write({
    name: 'propose_intake_form', title: 'Formulaire de demande', batch: true,
    description: 'Prépare un formulaire public de demande (responsables et administrateurs) : création (sans form_id : slug et nom) ou modification. Chaque demande reçue ouvre un projet « à qualifier » (depuis template_id s’il est donné) confié à owner_id.',
    schema: z.object({ form_id: UUID.optional(), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/).optional(), name: z.string().trim().min(1).max(120).optional(),
      intro: z.string().max(3000).optional(), template_id: UUID.nullable().optional(), owner_id: UUID.nullable().optional(), active: z.boolean().optional() }),
    build: async ({ form_id, ...a }) => {
      if (a.template_id) { const t = await project(a.template_id); if (!t?.is_template) return { error: 'template_not_found' } }
      if (a.owner_id && (await unknownPeople([a.owner_id])).length) return { error: 'unknown_person' }
      const lines: Line[] = [a.name && `Nom : ${a.name}`, a.slug && `Adresse : /demande/${a.slug}`, a.intro && `Texte d’accueil : ${clip(a.intro, 160)}`,
        a.owner_id && `Confié à : ${await peopleNames([a.owner_id])}`, a.active !== undefined && `Actif : ${yesNo(a.active)}`]
      if (!form_id) {
        if (!a.slug || !a.name) return { error: 'slug_and_name_required' }
        return { title: 'Créer un formulaire de demande', ops: [{ method: 'POST', path: '/api/forms', body: a }], lines: [...lines, 'Formulaire public'], short: `formulaire « ${a.name} »`, open: '/reglages/formulaires' }
      }
      const r = await get('/api/forms')
      const f = r.status === 200 ? r.body.find((x: any) => x.id === form_id) : null
      if (!f) return { error: 'form_not_found' }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: 'Modifier un formulaire de demande', ops: [{ method: 'PATCH', path: `/api/forms/${form_id}`, body: a }], lines: [`Formulaire : ${f.name}`, ...lines],
        short: `formulaire « ${f.name} »`, open: '/reglages/formulaires' }
    },
  })

  write({
    name: 'propose_automation', title: 'Automatisation', batch: true,
    description: 'Prépare une automatisation « quand … alors … » (responsables et administrateurs) : création (sans automation_id) ou modification. Déclencheurs : task_completed, task_moved, stage_completed, task_created, project_completed. Actions : notify (params.to: owner|members|assignees ou params.user_ids, params.message), assign (params.user_id), set_priority (params.priority), move_column (params.column_name), complete_stage, create_task (params.title, params.due_in_days). L’envoi automatique au client n’est pas permis à l’assistant.',
    schema: z.object({
      automation_id: UUID.optional(), name: z.string().trim().min(1).max(120).optional(), project_id: UUID.nullable().optional(),
      trigger: z.enum(['task_completed', 'task_moved', 'stage_completed', 'task_created', 'project_completed']).optional(),
      conditions: z.record(z.string(), z.unknown()).optional(),
      action: z.enum(['notify', 'assign', 'set_priority', 'move_column', 'complete_stage', 'create_task']).optional(),
      params: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional(),
    }),
    build: async ({ automation_id, ...a }) => {
      let pName: string | null = null
      if (a.project_id) { const p = await project(a.project_id); if (!p) return { error: 'project_not_found' }; pName = p.name }
      const TR: Record<string, string> = { task_completed: 'une tâche est terminée', task_moved: 'une tâche change de colonne', stage_completed: 'une étape est terminée',
        task_created: 'une tâche est créée', project_completed: 'le projet est terminé' }
      const AC: Record<string, string> = { notify: 'prévenir', assign: 'assigner', set_priority: 'changer la priorité', move_column: 'déplacer la tâche', complete_stage: 'terminer l’étape', create_task: 'créer une tâche' }
      const lines: Line[] = [a.name && `Nom : ${a.name}`, a.trigger && `Quand : ${TR[a.trigger]}`, a.action && `Alors : ${AC[a.action]}`,
        a.params && Object.keys(a.params).length && `Paramètres : ${clip(JSON.stringify(a.params), 160)}`, a.project_id !== undefined && `Projet : ${pName ?? 'tous les projets'}`,
        a.active !== undefined && `Active : ${yesNo(a.active)}`]
      if (!automation_id) {
        if (!a.name || !a.trigger || !a.action) return { error: 'name_trigger_action_required' }
        return { title: 'Créer une automatisation', ops: [{ method: 'POST', path: '/api/automations', body: a }], lines, short: `« ${a.name} »`, open: '/reglages/automatisations' }
      }
      const r = await get('/api/automations')
      const au = r.status === 200 ? r.body.find((x: any) => x.id === automation_id) : null
      if (!au) return { error: 'automation_not_found' }
      if (au.action === 'send_client_update') return { error: 'forbidden_category', hint: 'automatisation qui écrit au client : à régler dans l’écran' }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: 'Modifier une automatisation', ops: [{ method: 'PATCH', path: `/api/automations/${automation_id}`, body: a }], lines: [`Automatisation : ${au.name}`, ...lines],
        short: `« ${au.name} »`, open: '/reglages/automatisations' }
    },
  })

  // ---------------------------------------------------- seules sur leur carte (une autre application ou un fournisseur)
  write({
    name: 'propose_email_to_project', title: 'Ouvrir un projet depuis un email', batch: false,
    description: 'Prépare l’ouverture d’un projet à partir d’un email reçu (message_id lu avec list_emails) : client retrouvé ou créé, projet (depuis un modèle si template_id), première tâche « Répondre à … ».',
    schema: z.object({ message_id: UUID, name: z.string().trim().min(1).max(200).optional(), client_id: UUID.optional(), client_name: z.string().trim().max(200).optional(),
      template_id: UUID.optional(), status: z.enum(['lead', 'planned', 'active']).default('lead'), first_task: z.boolean().default(true) }),
    build: async ({ message_id, ...a }) => {
      const m = await inboxMessage(message_id)
      if (!m) return { error: 'message_not_found' }
      return { title: 'Ouvrir un projet depuis un email', mode: 'route', ops: [{ method: 'POST', path: `/api/mail/messages/${message_id}/project`, body: a, ref: 'project' }],
        lines: [`Email : « ${m.subject || '(sans objet)'} » de ${m.from_name ?? m.from_email}`, `Projet : « ${a.name || m.subject || 'Demande'} » (${STATUS_FR[a.status]})`,
          a.client_id ? 'Client : celui choisi' : m.known_client ? `Client : ${m.known_client.name}` : `Client : créé depuis l’expéditeur${a.client_name ? ` (${a.client_name})` : ''}`,
          a.first_task && 'Première tâche : répondre à l’expéditeur (demain, priorité haute)'],
        open: '/projets/@project' }
    },
  })

  write({
    name: 'propose_link_email', title: 'Rattacher un email', batch: false,
    description: 'Prépare le rattachement d’un email reçu (message_id) à un projet existant, éventuellement en créant une tâche avec son contenu (as_task).',
    schema: z.object({ message_id: UUID, project_id: UUID, as_task: z.boolean().default(false) }),
    build: async ({ message_id, project_id, as_task }) => {
      const [m, p] = await Promise.all([inboxMessage(message_id), project(project_id)])
      if (!m) return { error: 'message_not_found' }
      if (!p) return { error: 'project_not_found' }
      return { title: 'Rattacher un email', mode: 'route', ops: [{ method: 'POST', path: `/api/mail/messages/${message_id}/link`, body: { project_id, as_task } }],
        lines: [`Email : « ${m.subject || '(sans objet)'} » de ${m.from_name ?? m.from_email}`, `Projet : ${p.name}`, as_task && 'Et une tâche avec le contenu de l’email'],
        open: `/projets/${project_id}/emails` }
    },
  })

  write({
    name: 'propose_import_client', title: 'Reprendre un client', batch: false,
    description: 'Prépare la reprise d’un client depuis une application Lead reliée : source crmlead + external_id (id d’un lead lu avec search_lead_apps) ; crmlead + client_id (mettre à jour un client déjà repris) ; invoicelead + external_id (id d’un contact InvoiceLead). Avec les droits de la personne dans l’autre application.',
    schema: z.object({ source: z.enum(['crmlead', 'invoicelead']), external_id: z.string().min(1).max(100).optional(), client_id: UUID.optional(), q: z.string().max(100).optional() }),
    build: async (a) => {
      if (a.source === 'crmlead' && a.client_id) {
        const c = await client(a.client_id)
        if (!c) return { error: 'client_not_found' }
        if (!String(c.external_ref ?? '').startsWith('crmlead:')) return { error: 'not_from_crmlead' }
        return { title: 'Mettre à jour depuis CRMlead', mode: 'route', ops: [{ method: 'POST', path: `/api/clients/${a.client_id}/crmlead/refresh`, body: {} }],
          lines: [`Client : ${c.name}`, 'Adresse et contacts relus dans CRMlead'], open: `/clients/${a.client_id}` }
      }
      if (!a.external_id) return { error: 'external_id_required' }
      if (a.source === 'crmlead') return { title: 'Reprendre un client de CRMlead', mode: 'route',
        ops: [{ method: 'POST', path: '/api/clients/crmlead/import', body: { leadId: a.external_id }, ref: 'client' }],
        lines: [`Lead CRMlead : ${a.external_id}`, 'Adresse et contacts repris ; CRMlead enverra ensuite leurs changements'], open: '/clients/@client' }
      return { title: 'Reprendre un client d’InvoiceLead', mode: 'route',
        ops: [{ method: 'POST', path: '/api/clients/invoicelead/import', body: { contactId: a.external_id, ...(a.q ? { q: a.q } : {}) }, ref: 'client' }],
        lines: [`Contact InvoiceLead : ${a.external_id}`, 'Nom, email et adresse repris'], open: '/clients/@client' }
    },
  })

  write({
    name: 'propose_monthly_billing', title: 'Brouillons de facture du mois', batch: false,
    description: 'Prépare la création des BROUILLONS de facture du mois dans InvoiceLead (responsables et administrateurs), pour la période AAAA-MM (en général le mois passé) et éventuellement certains projets. Rien n’est émis ni envoyé au client.',
    schema: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), project_ids: z.array(UUID).max(500).optional() }),
    build: async ({ period, project_ids }) => {
      if (s.ctx.role === 'member') return { error: 'forbidden', hint: 'responsables et administrateurs' }
      const r = await get(`/api/integrations/billing/preview?period=${period}`)
      if (r.status !== 200) return { error: r.body?.error ?? 'preview_unavailable' }
      const list = r.body.projects.filter((x: any) => !project_ids || project_ids.includes(x.project.id))
      const fresh = list.filter((x: any) => !x.existing)
      return { title: `Brouillons de facture ${period}`, mode: 'route',
        ops: [{ method: 'POST', path: '/api/integrations/billing/run', body: { period, ...(project_ids ? { project_ids } : {}) } }],
        lines: [`${fresh.length} brouillon${fresh.length > 1 ? 's' : ''} à créer dans InvoiceLead (${list.length - fresh.length} déjà fait${list.length - fresh.length > 1 ? 's' : ''})`,
          ...fresh.slice(0, 10).map((x: any) => `${x.project.name}${x.client ? ` (${x.client.name})` : ''} : ${money(x.total_cents, x.project.currency ?? 'CHF')}`),
          fresh.length > 10 && `+ ${fresh.length - 10} autres`, 'Brouillons seulement : rien n’est émis ni envoyé au client'],
        open: '/facturation' }
    },
  })

  write({
    name: 'propose_sync_now', title: 'Synchroniser', batch: false,
    description: 'Prépare une synchronisation immédiate d’une boîte mail branchée (kind mailbox) ou d’un agenda extérieur (kind calendar_feed) ; id lu avec list_settings.',
    schema: z.object({ kind: z.enum(['mailbox', 'calendar_feed']), id: UUID }),
    build: async ({ kind, id }) => {
      if (kind === 'mailbox') {
        const r = await get('/api/mail/mailboxes')
        const mb = r.status === 200 ? r.body.mailboxes.find((m: any) => m.id === id) : null
        if (!mb) return { error: 'mailbox_not_found' }
        return { title: 'Synchroniser une boîte mail', mode: 'route', ops: [{ method: 'POST', path: `/api/mail/mailboxes/${id}/sync`, body: {} }],
          lines: [`Boîte : ${mb.email}`, 'Les nouveaux emails sont relevés'], open: '/emails' }
      }
      const r = await get('/api/calendar/feeds')
      const f = r.status === 200 ? r.body.find((x: any) => x.id === id) : null
      if (!f) return { error: 'feed_not_found' }
      return { title: 'Synchroniser un agenda', mode: 'route', ops: [{ method: 'POST', path: `/api/calendar/feeds/${id}/sync`, body: {} }],
        lines: [`Agenda : ${f.name}`, 'Les rendez-vous de l’agenda extérieur sont relus'], open: '/agenda' }
    },
  })

  // ------------------------------------------------------------------ le plan d'un projet (outil métier)
  const planStage = z.object({
    key: KEY, name: z.string().trim().min(1).max(200), description: z.string().max(2000).optional(), client_note: z.string().max(2000).optional(),
    duration_days: z.number().int().min(1).max(250).optional().describe('seulement pour une étape sans tâche'), visible_to_client: z.boolean().optional(),
  })
  const planTask = z.object({
    key: KEY, stage: KEY.optional().describe('clé de son étape (obligatoire s’il y a des étapes)'), title: z.string().trim().min(1).max(500),
    duration_days: z.number().int().min(0).max(250).describe('durée en jours ouvrés ; 0 = jalon'), milestone: z.boolean().optional(),
    estimate_minutes: MINUTES.optional().describe('travail estimé, en minutes (1 h = 60)'),
    after: z.array(KEY).max(10).optional().describe('clés des tâches qui doivent être finies avant (dépendances)'),
    description: z.string().max(2000).optional(), assignee_ids: z.array(UUID).max(10).optional(), priority: PRIORITY.optional(),
    checklist: z.array(z.string().trim().min(1).max(300)).max(15).optional(), visible_to_client: z.boolean().optional(),
  })
  write({
    name: 'propose_project_plan', title: 'Planifier un projet', batch: false,
    description: 'Prépare en UNE carte tout le plan d’un projet : étapes datées, leurs tâches (durée en jours ouvrés, estimation), jalons (durée 0, par exemple la validation par le client) et dépendances simples (after). Les dates sont calculées par ProjectLead en jours ouvrés (lundi à vendredi) à partir de start_date (par défaut : le début du projet s’il est à venir, sinon aujourd’hui) : les étapes se suivent ; une tâche commence au début de son étape ou le jour ouvré après ses tâches préalables. Projet existant (project_id, le plan s’ajoute à ce qui existe) ou nouveau projet (new_project). Les dates de début et de fin du projet sont posées si elles manquent.',
    schema: z.object({
      project_id: UUID.optional(),
      new_project: z.object({ name: z.string().trim().min(1).max(200), client_id: UUID.optional(), description: z.string().max(5000).optional(),
        priority: PRIORITY.optional(), status: z.enum(['planned', 'active']).optional() }).optional(),
      start_date: DATE.optional(),
      stages: z.array(planStage).max(20).default([]),
      tasks: z.array(planTask).max(100).default([]),
    }),
    build: async (a) => {
      if (Boolean(a.project_id) === Boolean(a.new_project)) return { error: 'project_id_or_new_project', hint: 'l’un ou l’autre' }
      if (!a.stages.length && !a.tasks.length) return { error: 'empty_plan' }
      const p = a.project_id ? await project(a.project_id) : null
      if (a.project_id && !p) return { error: 'project_not_found' }
      let cl: string | null = null
      if (a.new_project?.client_id) { const c = await client(a.new_project.client_id); if (!c) return { error: 'client_not_found' }; cl = c.name }
      const allPeople = a.tasks.flatMap((t: any) => t.assignee_ids ?? [])
      if ((await unknownPeople(allPeople)).length) return { error: 'unknown_person', hint: 'ids de list_team, personnes actives' }
      const start = workdayFrom(a.start_date ?? (p?.start_date && p.start_date.slice(0, 10) >= s.today ? p.start_date.slice(0, 10) : s.today))
      const plan = schedulePlan(start, a.stages, a.tasks)
      if ('error' in plan) return plan
      const pid = p ? p.id : '@p'
      const ops: WriteOp[] = []
      if (a.new_project) ops.push({ method: 'POST', path: '/api/projects', ref: 'p',
        body: { ...a.new_project, status: a.new_project.status ?? 'planned', start_date: plan.start, due_date: plan.end } })
      for (const st of a.stages) {
        const d = plan.stages.get(st.key)!
        ops.push({ method: 'POST', path: `/api/projects/${pid}/stages`, ref: `s:${st.key}`,
          body: { name: st.name, start_date: d.start, due_date: d.due, ...pick(st, ['description', 'client_note', 'visible_to_client']) } })
      }
      // Les tâches, étape par étape (l'ordre de la liste et du tableau suit celui du plan).
      const ordered = a.stages.length ? a.stages.flatMap((st: any) => a.tasks.filter((t: any) => t.stage === st.key)) : a.tasks
      for (const t of ordered) {
        const d = plan.tasks.get(t.key)!
        ops.push({ method: 'POST', path: '/api/tasks', ref: `t:${t.key}`, body: {
          project_id: pid, ...(t.stage ? { stage_id: `@s:${t.stage}` } : {}), title: t.title, start_date: d.start, due_date: d.due,
          ...(d.milestone ? { is_milestone: true } : {}), ...pick(t, ['description', 'estimate_minutes', 'assignee_ids', 'priority', 'visible_to_client']) } })
      }
      for (const t of ordered) for (const label of t.checklist ?? []) ops.push({ method: 'POST', path: `/api/tasks/@t:${t.key}/checklist`, body: { label } })
      let deps = 0
      for (const t of ordered) for (const pred of [...new Set<string>(t.after ?? [])]) { deps++; ops.push({ method: 'POST', path: `/api/tasks/@t:${t.key}/dependencies`, body: { depends_on_id: `@t:${pred}` } }) }
      const dates: Record<string, string> = {}
      if (p && !p.start_date) dates.start_date = plan.start
      if (p && !p.due_date) dates.due_date = plan.end
      if (p && Object.keys(dates).length) ops.push({ method: 'PATCH', path: `/api/projects/${p.id}`, body: dates })
      if (ops.length > MAX_OPS) return { error: 'plan_too_large', operations: ops.length, max: MAX_OPS,
        hint: 'moins de points de contrôle ou de tâches, ou deux cartes (une partie des étapes, puis la suite)' }

      // La carte : un groupe par étape, ses tâches avec dates, estimation, dépendances.
      const titleOf = new Map<string, string>(a.tasks.map((t: any) => [t.key, t.title]))
      const milestones = ordered.filter((t: any) => plan.tasks.get(t.key)!.milestone)
      const estimate = ordered.reduce((n: number, t: any) => n + (t.estimate_minutes ?? 0), 0)
      const taskLine = async (t: any) => {
        const d = plan.tasks.get(t.key)!
        return [`${d.milestone ? '◆ ' : ''}${t.title}`, d.milestone ? `${D(d.due)} (jalon)` : span(d.start, d.due),
          t.estimate_minutes ? hm(t.estimate_minutes) : null, t.after?.length ? `après ${t.after.map((k: string) => `« ${titleOf.get(k)} »`).join(', ')}` : null,
          t.checklist?.length ? `${t.checklist.length} point${t.checklist.length > 1 ? 's' : ''} de contrôle` : null,
          t.assignee_ids?.length ? await peopleNames(t.assignee_ids) : null].filter(Boolean).join(' · ')
      }
      const CAP = 10
      const groups: SummaryGroup[] = []
      if (a.stages.length) {
        for (const [i, st] of a.stages.entries()) {
          const d = plan.stages.get(st.key)!
          const list = ordered.filter((t: any) => t.stage === st.key)
          groups.push({ title: `${(p?.stages.length ?? 0) + i + 1}. ${st.name} · ${span(d.start, d.due)}`,
            lines: list.length ? await Promise.all(list.slice(0, CAP).map(taskLine)) : ['(étape sans tâche)'], ...(list.length > CAP ? { more: list.length - CAP } : {}) })
        }
      } else {
        groups.push({ title: 'Tâches', lines: await Promise.all(ordered.slice(0, 40).map(taskLine)), ...(ordered.length > 40 ? { more: ordered.length - 40 } : {}) })
      }
      const name = p ? p.name : a.new_project.name
      const late = p?.due_date && plan.end > p.due_date.slice(0, 10)
      return {
        title: p ? `Planifier « ${name} »` : `Créer et planifier « ${name} »`,
        lines: [p ? `Projet : ${name}` : `Nouveau projet : ${name}${cl ? ` (client ${cl})` : ''}`,
          `Du ${D(plan.start)} au ${D(plan.end)} · ${workdaysBetween(plan.start, plan.end)} jours ouvrés (lundi à vendredi)`,
          `${a.stages.length ? `${a.stages.length} étape${a.stages.length > 1 ? 's' : ''}, ` : ''}${ordered.length} tâche${ordered.length > 1 ? 's' : ''}${milestones.length ? ` dont ${milestones.length} jalon${milestones.length > 1 ? 's' : ''}` : ''}${deps ? `, ${deps} dépendance${deps > 1 ? 's' : ''}` : ''}${estimate ? `, ${hm(estimate)} estimées` : ''}`,
          p && (p.stages.length || p.tasks_total) && `Déjà dans le projet : ${p.stages.length} étape(s) et ${p.tasks_total} tâche(s) ; elles restent, le plan s’ajoute après`,
          Object.keys(dates).length && `Dates du projet : ${[dates.start_date && `début ${D(dates.start_date)}`, dates.due_date && `fin ${D(dates.due_date)}`].filter(Boolean).join(', ')}`,
          late && `Attention : le plan finit après l’échéance du projet (${D(p.due_date)})`],
        groups, ops, open: `/projets/${pid}/gantt`,
        links: [{ label: 'Étapes', path: `/projets/${pid}/etapes` }, { label: 'Liste', path: `/projets/${pid}/liste` }, { label: 'Gantt', path: `/projets/${pid}/gantt` }],
        info: { plan: { start: plan.start, end: plan.end, stages: a.stages.map((st: any) => ({ name: st.name, start: plan.stages.get(st.key)!.start, due: plan.stages.get(st.key)!.due })),
          milestones: milestones.map((t: any) => ({ title: t.title, date: plan.tasks.get(t.key)!.due })), tasks: ordered.length, dependencies: deps } },
      }
    },
  })

  // ------------------------------------------------------------------ le lot : plusieurs changements, une carte
  const defs = new Map(W.map((d) => [d.name, d]))
  const batchTool = betaZodTool({
    name: 'propose_batch',
    description: 'Regroupe PLUSIEURS changements en UNE carte « À confirmer » (un clic, une transaction : tout ou rien, 150 écritures au plus). Chaque opération = { tool, input } où tool est un des outils propose_* regroupables et input exactement ce que cet outil prend. Pour les étapes, tâches, jalons et dépendances d’un plan de projet : propose_project_plan.',
    inputSchema: z.object({
      title: z.string().trim().min(1).max(120).optional().describe('titre court de la carte'),
      operations: z.array(z.object({ tool: z.enum(BATCHABLE), input: z.record(z.string(), z.unknown()) })).min(1).max(MAX_OPS),
    }),
    run: async (a) => {
      mark('propose_batch')
      const ops: WriteOp[] = []
      const byTitle = new Map<string, string[]>()
      const opens = new Set<string | null>()
      for (const [i, item] of a.operations.entries()) {
        const d = defs.get(item.tool)
        if (!d?.batch) return out({ error: 'tool_not_batchable', operation: i + 1, tool: item.tool })
        const parsed = d.schema.safeParse(item.input)
        if (!parsed.success) return out({ error: 'invalid_input', operation: i + 1, tool: item.tool,
          issues: parsed.error.issues.slice(0, 5).map((x) => `${x.path.join('.')}: ${x.message}`) })
        const b = await d.build(parsed.data)
        if ('error' in b) return out({ ...b, operation: i + 1, tool: item.tool })
        // Dans un lot, les références locales ne servent qu'à l'outil seul (page à ouvrir) : on les retire.
        for (const op of b.ops) ops.push({ method: op.method, path: op.path, body: op.body })
        const list = byTitle.get(b.title) ?? []
        list.push(b.short ?? (b.lines.find(Boolean) as string) ?? b.title)
        byTitle.set(b.title, list)
        opens.add(b.open?.includes('@') ? null : b.open?.replace(/\?.*$/, '') ?? null)
      }
      const groups: SummaryGroup[] = [...byTitle].map(([title, lines]) => ({ title: lines.length > 1 ? `${title} (${lines.length})` : title,
        lines: lines.slice(0, 10), ...(lines.length > 10 ? { more: lines.length - 10 } : {}) }))
      const n = a.operations.length
      const only = opens.size === 1 ? [...opens][0] : null
      return propose('propose_batch', {
        title: a.title ?? `${n} changement${n > 1 ? 's' : ''}`,
        lines: [`${n} changement${n > 1 ? 's' : ''} en une fois : tout est enregistré ensemble, ou rien`], groups, ops, open: only,
      })
    },
  })

  // ------------------------------------------------------------------ outils de lecture
  const reads = [
    betaZodTool({
      name: 'search',
      description: 'Recherche plein texte dans les projets, tâches et clients visibles par la personne (au moins 2 caractères).',
      inputSchema: z.object({ q: z.string().min(2).max(100) }),
      run: async ({ q }) => {
        mark('search')
        const r = await get(`/api/search?q=${encodeURIComponent(q)}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out({
          projects: r.body.projects.map((p: any) => pick(p, ['id', 'name', 'code', 'status'])),
          tasks: r.body.tasks.map((t: any) => ({ id: t.id, title: t.title, project_id: t.project_id, project: t.project_name, done: Boolean(t.completed_at) })),
          clients: r.body.clients.map((c: any) => pick(c, ['id', 'name', 'town'])),
        })
      },
    }),
    betaZodTool({
      name: 'dashboard',
      description: "L'accueil de la personne : compteurs de l'entreprise (projets en cours, à risque, en retard, demandes), ses tâches ouvertes, ses projets suivis, ses rendez-vous des 7 prochains jours, ses heures de la semaine.",
      inputSchema: z.object({}),
      run: async () => {
        mark('dashboard')
        const r = await get('/api/dashboard')
        if (r.status !== 200) return refusal(r.status, r.body)
        const d = r.body
        return out({
          counts: d.counts,
          my_open_tasks: rows(d.myTasks, (t: any) => ({ id: t.id, title: t.title, due_date: t.due_date, priority: t.priority, project_id: t.project_id, project: t.project_name })),
          projects: rows(d.projects, (p: any) => ({ id: p.id, name: p.name, code: p.code, status: p.status, health: p.health, due_date: p.due_date,
            client: p.client_name, tasks: `${p.tasks_done}/${p.tasks_total}`, tasks_late: p.tasks_late, hours_spent: hours(p.minutes_spent), budget_hours: hours(p.budget_minutes) })),
          events_next_7_days: d.events.map((e: any) => pick(e, ['id', 'title', 'starts_at', 'ends_at', 'location', 'project_name'])),
          my_hours_this_week: hours(d.week.reduce((a: number, w: any) => a + w.minutes, 0)),
        })
      },
    }),
    betaZodTool({
      name: 'list_projects',
      description: 'Liste les projets visibles (hors archives), avec avancement, retard, temps passé, budget et étape en cours. templates: true = les MODÈLES de projet (structures réutilisables). Filtres facultatifs.',
      inputSchema: z.object({
        status: z.enum(['lead', 'planned', 'active', 'on_hold', 'done', 'cancelled']).optional(),
        q: z.string().max(100).optional().describe('texte dans le nom, le code ou le client'),
        mine: z.boolean().optional().describe('seulement ceux où la personne intervient'),
        client_id: UUID.optional(), templates: z.boolean().optional(),
      }),
      run: async (a) => {
        mark('list_projects')
        const qs = new URLSearchParams()
        if (a.status) qs.set('status', a.status)
        if (a.q) qs.set('q', a.q)
        if (a.mine) qs.set('mine', '1')
        if (a.client_id) qs.set('client', a.client_id)
        if (a.templates) qs.set('template', '1')
        const r = await get(`/api/projects?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (p: any) => ({
          id: p.id, code: p.code, name: p.name, status: p.status, health: p.health, priority: p.priority, client: p.client_name, owner: p.owner_name,
          start_date: p.start_date, due_date: p.due_date, tasks_done: p.tasks_done, tasks_total: p.tasks_total, tasks_late: p.tasks_late,
          stages: p.stages_total, hours_spent: hours(p.minutes_spent), budget_hours: hours(p.budget_minutes), current_stage: p.current_stage?.name ?? null,
        })))
      },
    }),
    betaZodTool({
      name: 'get_project',
      description: "La fiche d'un projet (ou d'un modèle) : description, client, intervenants (id, rôle, heures), étapes (id, statut, dates, tâches), colonnes du tableau (id), dates, facturation, dernier point d'avancement.",
      inputSchema: z.object({ project_id: UUID }),
      run: async ({ project_id }) => {
        mark('get_project')
        const r = await get(`/api/projects/${project_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const p = r.body
        return out({
          ...pick(p, ['id', 'code', 'name', 'status', 'health', 'priority', 'visibility', 'start_date', 'due_date', 'billing_mode', 'currency', 'is_template', 'color']),
          description: clip(p.description, 1500), client: p.client ? { id: p.client.id, name: p.client.name } : null,
          owner: p.owner_name, budget_hours: hours(p.budget_minutes), budget_cents: p.budget_cents, hours_spent: hours(p.minutes_spent),
          tasks_done: p.tasks_done, tasks_total: p.tasks_total, tasks_late: p.tasks_late, portal_enabled: p.portal_enabled,
          members: p.members_detail.map((m: any) => ({ id: m.id, name: m.name, role: m.role, hours: hours(m.minutes) })),
          stages: p.stages.map((st: any) => ({ id: st.id, name: st.name, status: st.status, start_date: st.start_date, due_date: st.due_date,
            visible_to_client: st.visible_to_client, tasks: `${st.tasks_done}/${st.tasks_total}` })),
          columns: p.columns.map((c: any) => ({ id: c.id, name: c.name, is_done: c.is_done })),
          last_update: p.last_update ? { health: p.last_update.health, body: clip(p.last_update.body, 600), author: p.last_update.author_name, at: p.last_update.created_at } : null,
        })
      },
    }),
    betaZodTool({
      name: 'list_tasks',
      description: "Liste des tâches visibles (hors projets archivés ; les modèles seulement avec project_id). Filtres : projet, personne assignée ('me' ou l'id d'un membre), ouvertes/terminées, échéance (en retard, aujourd'hui, cette semaine), période, texte. Donne l'étape, le jalon, les dépendances (ids).",
      inputSchema: z.object({
        project_id: UUID.optional(),
        assignee: z.string().max(40).optional().describe("'me' ou l'id d'un membre"),
        status: z.enum(['open', 'done']).optional(),
        due: z.enum(['overdue', 'today', 'week']).optional(),
        from: DATE.optional(), to: DATE.optional(),
        q: z.string().max(100).optional(),
      }),
      run: async (a) => {
        mark('list_tasks')
        const qs = new URLSearchParams()
        if (a.project_id) qs.set('project', a.project_id)
        if (a.assignee) qs.set('assignee', a.assignee)
        if (a.status) qs.set('status', a.status)
        if (a.due) qs.set('due', a.due)
        if (a.from) qs.set('from', a.from)
        if (a.to) qs.set('to', a.to)
        if (a.q) qs.set('q', a.q)
        const r = await get(`/api/tasks?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (t: any) => ({
          id: t.id, number: t.number, title: t.title, project_id: t.project_id, project: t.project_name, start_date: t.start_date, due_date: t.due_date,
          priority: t.priority, done: Boolean(t.completed_at), column: t.column_name, stage: t.stage_name, stage_id: t.stage_id, milestone: t.is_milestone,
          parent_id: t.parent_id, depends_on: t.depends_on, blocked: t.blocked,
          assignees: t.assignees.map((p: any) => p.name), estimate_hours: hours(t.estimate_minutes), hours_spent: hours(t.minutes_spent),
        })))
      },
    }),
    betaZodTool({
      name: 'get_task',
      description: "Le détail d'une tâche : description, liste de contrôle (id), sous-tâches, dépendances, derniers commentaires (id, auteur), temps saisi.",
      inputSchema: z.object({ task_id: UUID }),
      run: async ({ task_id }) => {
        mark('get_task')
        const r = await get(`/api/tasks/${task_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const t = r.body
        return out({
          id: t.id, number: t.number, title: t.title, project_id: t.project_id, project: t.project_name, description: clip(t.description, 1500),
          priority: t.priority, start_date: t.start_date, due_date: t.due_date, done: Boolean(t.completed_at), column: t.column_name, stage: t.stage_name,
          stage_id: t.stage_id, milestone: t.is_milestone, visible_to_client: t.visible_to_client, recurrence: t.recurrence, tags: t.tags,
          assignees: t.assignees.map((p: any) => ({ id: p.id, name: p.name })), blocked: t.blocked, estimate_hours: hours(t.estimate_minutes),
          checklist: t.checklist.slice(0, MAX_ROWS).map((i: any) => ({ id: i.id, label: i.label, done: i.done })),
          subtasks: t.subtasks.slice(0, MAX_ROWS).map((x: any) => ({ id: x.id, title: x.title, done: Boolean(x.completed_at) })),
          depends_on: t.dependencies.map((x: any) => ({ id: x.id, title: x.title, done: Boolean(x.completed_at) })),
          blocking: t.blocking.map((x: any) => ({ id: x.id, title: x.title })),
          comments: t.comment_list.slice(-10).map((cm: any) => ({ id: cm.id, author: cm.author_name, mine: cm.author_id === s.ctx.userId, at: cm.created_at, body: clip(cm.body, 400) })),
          time: t.time.slice(0, 20).map((e: any) => ({ id: e.id, date: e.entry_date, hours: hours(e.minutes), person: e.user_name, note: clip(e.note, 120) })),
        })
      },
    }),
    betaZodTool({
      name: 'list_team',
      description: "Les membres de l'entreprise (lecture seule) : id, nom, rôle, actif, équipes. Sert à trouver l'id d'une personne pour l'assigner.",
      inputSchema: z.object({}),
      run: async () => {
        mark('list_team')
        const r = await get('/api/team')
        if (r.status !== 200) return refusal(r.status, r.body)
        const teams = new Map<string, string>(r.body.teams.map((t: any) => [t.id, t.name]))
        teamCache = r.body.members
        return out(rows(r.body.members, (m: any) => ({ id: m.id, name: m.name, role: m.role, active: m.active,
          teams: (m.team_ids ?? []).map((id: string) => teams.get(id)).filter(Boolean) })))
      },
    }),
    betaZodTool({
      name: 'list_clients',
      description: "Les clients de l'entreprise (nom, localité, nombre de projets), avec une recherche facultative.",
      inputSchema: z.object({ q: z.string().max(100).optional() }),
      run: async ({ q }) => {
        mark('list_clients')
        const r = await get(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (c: any) => ({ id: c.id, name: c.name, kind: c.kind, town: c.town, country: c.country, projects: c.projects, active_projects: c.active_projects })))
      },
    }),
    betaZodTool({
      name: 'get_client',
      description: "La fiche d'un client : coordonnées, adresse, contacts (id, email, reçoit le suivi), projets, derniers emails.",
      inputSchema: z.object({ client_id: UUID }),
      run: async ({ client_id }) => {
        mark('get_client')
        const r = await get(`/api/clients/${client_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const c = r.body
        return out({ ...pick(c, ['id', 'name', 'kind', 'contact_person', 'email', 'phone', 'street', 'building_number', 'postal_code', 'town', 'country', 'language', 'vat_number']),
          notes: clip(c.notes, 600), from_crmlead: String(c.external_ref ?? '').startsWith('crmlead:'), archived: Boolean(c.archived_at),
          contacts: c.contacts.map((k: any) => pick(k, ['id', 'name', 'email', 'phone', 'job_title', 'receives_updates'])),
          projects: c.projects.slice(0, MAX_ROWS).map((p: any) => pick(p, ['id', 'name', 'code', 'status', 'due_date'])),
          emails: c.emails.slice(0, 10).map((e: any) => pick(e, ['id', 'subject', 'from_email', 'received_at'])) })
      },
    }),
    betaZodTool({
      name: 'list_time_entries',
      description: "Les saisies de temps (heures) : par défaut celles de la personne connectée. user = 'me', 'all' (toute l'entreprise, selon les droits) ou l'id d'un membre. Totaux en heures ; id de chaque saisie.",
      inputSchema: z.object({ from: DATE.optional(), to: DATE.optional(), user: z.string().max(40).optional(), project_id: UUID.optional() }),
      run: async (a) => {
        mark('list_time_entries')
        const qs = new URLSearchParams()
        if (a.from) qs.set('from', a.from)
        if (a.to) qs.set('to', a.to)
        if (a.user) qs.set('user', a.user)
        if (a.project_id) qs.set('project', a.project_id)
        const r = await get(`/api/time/entries?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const done = r.body.filter((e: any) => e.minutes != null)
        return out({
          total_hours: hours(done.reduce((n: number, e: any) => n + e.minutes, 0)),
          billable_hours: hours(done.filter((e: any) => e.billable).reduce((n: number, e: any) => n + e.minutes, 0)),
          ...rows(r.body, (e: any) => ({ id: e.id, date: e.entry_date, hours: hours(e.minutes), running: e.minutes == null, person: e.user_name,
            project_id: e.project_id, project: e.project_name, task_id: e.task_id, task: e.task_title, client: e.client_name, billable: e.billable,
            invoiced: Boolean(e.invoiced_at), note: clip(e.note, 120) })),
        })
      },
    }),
    betaZodTool({
      name: 'time_report',
      description: 'Rapport du temps regroupé (par projet, personne, client, mois ou tâche) : heures, heures facturables, montant facturable et coût (centimes), heures facturées.',
      inputSchema: z.object({
        group: z.enum(['project', 'user', 'client', 'month', 'task']).default('project'),
        from: DATE.optional(), to: DATE.optional(), project_id: UUID.optional(), user_id: UUID.optional(),
      }),
      run: async (a) => {
        mark('time_report')
        const qs = new URLSearchParams({ group: a.group })
        if (a.from) qs.set('from', a.from)
        if (a.to) qs.set('to', a.to)
        if (a.project_id) qs.set('project', a.project_id)
        if (a.user_id) qs.set('user', a.user_id)
        const r = await get(`/api/time/report?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (x: any) => ({ label: x.label, hours: hours(x.minutes), billable_hours: hours(x.billable_minutes),
          billable_cents: x.billable_cents, cost_cents: x.cost_cents, invoiced_hours: hours(x.invoiced_minutes) })))
      },
    }),
    betaZodTool({
      name: 'workload',
      description: "Charge de travail par personne et par semaine à partir d'un lundi : heures estimées des tâches ouvertes face à la capacité, tâches en retard, heures saisies.",
      inputSchema: z.object({ from: DATE.describe('un lundi'), weeks: z.number().int().min(1).max(12).default(4) }),
      run: async (a) => {
        mark('workload')
        const r = await get(`/api/time/workload?from=${a.from}&weeks=${a.weeks}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const d = r.body
        return out(rows(d.people, (p: any) => ({
          id: p.id, name: p.name, capacity_hours_per_week: hours(p.capacity_minutes),
          planned_hours_by_week: Array.from({ length: d.weeks }, (_, w) => hours(d.load.find((l: any) => l.user_id === p.id && l.week === w)?.minutes ?? 0)),
          logged_hours_by_week: Array.from({ length: d.weeks }, (_, w) => hours(d.logged.find((l: any) => l.user_id === p.id && l.week === w)?.minutes ?? 0)),
          overdue_tasks: d.overdue.find((o: any) => o.user_id === p.id)?.tasks ?? 0,
        })))
      },
    }),
    betaZodTool({
      name: 'list_events',
      description: "Les rendez-vous de l'agenda entre deux dates (ceux de la personne, ou toute l'entreprise si scope='all'), avec leur id.",
      inputSchema: z.object({ from: DATE, to: DATE, scope: z.enum(['mine', 'all']).default('mine') }),
      run: async (a) => {
        mark('list_events')
        const r = await get(`/api/calendar/events?from=${a.from}&to=${a.to}${a.scope === 'all' ? '&scope=all' : ''}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const list = Array.isArray(r.body) ? r.body : (r.body.events ?? [])
        return out(rows(list, (e: any) => ({ id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, location: e.location,
          project: e.project_name, client: e.client_name, organizer: e.organizer_name, external: Boolean(e.external) })))
      },
    }),
    betaZodTool({
      name: 'list_emails',
      description: "La boîte de réception de ProjectLead (emails reçus visibles par la personne) : status 'new' (à trier, par défaut), 'linked', 'ignored' ou 'all', recherche facultative. Donne l'id de chaque email.",
      inputSchema: z.object({ status: z.enum(['new', 'linked', 'ignored', 'all']).default('new'), q: z.string().max(100).optional() }),
      run: async (a) => {
        mark('list_emails')
        const r = await get(`/api/mail/inbox?status=${a.status}${a.q ? `&q=${encodeURIComponent(a.q)}` : ''}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (m: any) => ({ id: m.id, from: m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email, subject: m.subject,
          snippet: clip(m.snippet, 160), received_at: m.received_at, status: m.status, project: m.project_name, known_client: m.known_client?.name ?? null })))
      },
    }),
    betaZodTool({
      name: 'list_files',
      description: 'Les fichiers d’un projet : id, nom, taille, tâche, visible par le client.',
      inputSchema: z.object({ project_id: UUID }),
      run: async ({ project_id }) => {
        mark('list_files')
        const r = await get(`/api/projects/${project_id}/files`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (f: any) => ({ id: f.id, filename: f.filename, size: f.size, task: f.task_title, visible_to_client: f.visible_to_client, at: f.created_at })))
      },
    }),
    betaZodTool({
      name: 'list_settings',
      description: 'Les réglages et listes de l’entreprise, en lecture : booking_pages (pages de rendez-vous), forms (formulaires de demande), automations, mailboxes (boîtes branchées), calendar_feeds (agendas extérieurs), notifications (les siennes), billing (réglages de facturation mensuelle et applications reliées), billing_preview (brouillons du mois, period AAAA-MM).',
      inputSchema: z.object({ kind: z.enum(['booking_pages', 'forms', 'automations', 'mailboxes', 'calendar_feeds', 'notifications', 'billing', 'billing_preview']),
        period: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
      run: async ({ kind, period }) => {
        mark('list_settings')
        const path = { booking_pages: '/api/booking', forms: '/api/forms', automations: '/api/automations', mailboxes: '/api/mail/mailboxes', calendar_feeds: '/api/calendar/feeds',
          notifications: '/api/notifications', billing: '/api/integrations', billing_preview: `/api/integrations/billing/preview${period ? `?period=${period}` : ''}` }[kind]
        const r = await get(path)
        if (r.status !== 200) return refusal(r.status, r.body)
        const b = r.body
        switch (kind) {
          case 'booking_pages': return out(rows(b, (x: any) => pick(x, ['id', 'name', 'slug', 'url', 'duration_minutes', 'location', 'active', 'upcoming', 'host_ids', 'availability'])))
          case 'forms': return out(rows(b, (x: any) => pick(x, ['id', 'name', 'slug', 'url', 'active', 'template_name', 'received'])))
          case 'automations': return out(rows(b, (x: any) => pick(x, ['id', 'name', 'trigger', 'action', 'params', 'conditions', 'active', 'project_name', 'runs'])))
          case 'mailboxes': return out(rows(b.mailboxes, (x: any) => pick(x, ['id', 'email', 'provider', 'display_name', 'is_default', 'shared', 'mine', 'last_synced_at', 'sync_error'])))
          case 'calendar_feeds': return out(rows(b, (x: any) => pick(x, ['id', 'name', 'last_synced_at', 'sync_error', 'events'])))
          case 'notifications': return out(rows(b, (x: any) => ({ id: x.id, title: x.title, read: Boolean(x.read_at), at: x.created_at, link: x.link })))
          case 'billing': return out({ ...pick(b, ['monthly_billing_auto', 'monthly_billing_day', 'invoice_language', 'client_update_signature', 'last_invoice_at']),
            linked_apps: b.links })
          default: return out({ period: b.period, projects: rows(b.projects, (x: any) => ({ project: x.project?.name, client: x.client?.name ?? null, total_cents: x.total_cents, already_created: Boolean(x.existing) })) })
        }
      },
    }),
    betaZodTool({
      name: 'search_lead_apps',
      description: 'Cherche dans une application Lead reliée, avec les droits de la personne : crmlead (les leads, pour reprendre un client et son adresse) ou invoicelead (le carnet de contacts). Donne l’id à passer à propose_import_client.',
      inputSchema: z.object({ app: z.enum(['crmlead', 'invoicelead']), q: z.string().max(100).default('') }),
      run: async ({ app, q }) => {
        mark('search_lead_apps')
        const r = await get(`/api/clients/${app}/search?q=${encodeURIComponent(q)}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (x: any) => pick(x, ['id', 'title', 'company', 'name', 'email', 'address', 'status', 'imported'])))
      },
    }),
    betaZodTool({
      name: 'open_page',
      description: "Ouvre une page de ProjectLead dans le navigateur de la personne. Chemins : / (accueil), /taches, /projets, /projets/<id>[/tableau|liste|gantt|calendrier|etapes|temps|fichiers|activite|emails|suivi|reglages][?tache=<id>], /modeles, /emails, /agenda, /temps, /charge, /rapports, /clients, /clients/<id>, /facturation, /recherche?q=…, /reglages[/profil|entreprise|equipe|emails|agendas|rendez-vous|formulaires|automatisations|integrations|api].",
      inputSchema: z.object({ path: z.string().max(300) }),
      run: async ({ path }) => {
        mark('open_page')
        if (!pageAllowed(path)) return out({ error: 'unknown_page' })
        if (!s.actions.some((x) => x.type === 'navigate')) s.actions.push({ type: 'navigate', path })
        return out({ opened: path })
      },
    }),
  ]

  const writes = W.map((d) => betaZodTool({
    name: d.name, description: d.description, inputSchema: d.schema,
    run: async (a: any) => { mark(d.name); return propose(d.name, await d.build(a)) },
  }))
  return [...reads, ...writes, batchTool]
}

export const TOOL_NAMES = ['search', 'dashboard', 'list_projects', 'get_project', 'list_tasks', 'get_task', 'list_team', 'list_clients', 'get_client',
  'list_time_entries', 'time_report', 'workload', 'list_events', 'list_emails', 'list_files', 'list_settings', 'search_lead_apps', 'open_page',
  'propose_create_task', 'propose_update_task', 'propose_update_tasks', 'propose_add_dependency', 'propose_add_task_comment', 'propose_add_project_comment',
  'propose_update_comment', 'propose_add_checklist_item', 'propose_update_checklist_item', 'propose_create_project', 'propose_update_project',
  'propose_duplicate_project', 'propose_project_update', 'propose_create_stage', 'propose_update_stage', 'propose_reorder', 'propose_board_column',
  'propose_set_file_visibility', 'propose_log_time', 'propose_update_time_entry', 'propose_set_timesheet_day', 'propose_timer', 'propose_create_client',
  'propose_update_client', 'propose_client_contact', 'propose_event', 'propose_set_email_status', 'propose_mark_notifications_read',
  'propose_update_settings', 'propose_booking_page', 'propose_intake_form', 'propose_automation', 'propose_email_to_project', 'propose_link_email',
  'propose_import_client', 'propose_monthly_billing', 'propose_sync_now', 'propose_project_plan', 'propose_batch'] as const

