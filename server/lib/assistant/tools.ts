import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import * as z from 'zod/v4'
import type { Ctx } from '../../db.js'
import { tr, type Locale } from '../i18n.js'
import { callApi } from './internal.js'
import { OpFailure, runOps } from './run.js'
import { schedulePlan, workdayFrom, workdaysBetween } from './schedule.js'
import { labelOf } from './pages.js'
import { MAX_OPS, MAX_TOKEN_CHARS, opAllowed, signConfirm, type Mode, type Summary, type SummaryGroup, type WriteOp } from './token.js'

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
 * l'extérieur (liste fermée de token.ts, docs/ASSISTANT-ACTIONS.md). Ni indirectement : une écriture qui ferait partir
 * un email (automatisation de l'entreprise) est refusée à l'essai et à « Confirmer » (run.ts) ; un changement qui
 * relancerait le suivi périodique au client, assignerait quelqu'un qui n'a pas accès à un projet réservé, ou copierait
 * un projet réservé (copie visible de toute l'entreprise) n'a pas de carte.
 *
 * La carte montre TOUT ce qui sera écrit (B7) : chaque champ, en entier (aucun texte coupé), « avant → après » pour une
 * modification ; dans un lot ou un plan, chaque opération et chaque tâche (aucune cachée sous « + N autres ») ; son titre
 * vient du serveur, jamais du modèle.
 *
 * Langues : ce que voit la personne (titre et lignes des cartes) vient des dictionnaires du serveur, clés
 * `assistant.card.*` (server/i18n/<langue>.ts, cinq langues), dans la langue de l'interface. Ce que lit le modèle
 * (descriptions, résultats, indices) reste en français : il répond dans la langue de la personne.
 */

export type ConfirmAction = { type: 'confirm'; token: string; summary: Summary }
/** `label` : le nom de l'écran (« Réglages › Équipe ») ; la bulle écrit « Page ouverte : <label> », jamais le chemin. */
export type NavigateAction = { type: 'navigate'; path: string; label: string }
export type AssistantAction = ConfirmAction | NavigateAction

export type ToolScope = { cookie: string; ctx: Ctx; actions: AssistantAction[]; used: string[]; today: string; locale?: Locale
  /** Le fuseau de l'entreprise (heures des rendez-vous sur la carte). */
  timezone?: string }

const MAX_ROWS = 50
const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-JJ')
const DATETIME = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, 'AAAA-MM-JJTHH:MM+01:00')
const KEY = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/, 'clé courte : lettres, chiffres, - ou _')
const PRIORITY = z.enum(['low', 'normal', 'high', 'urgent'])
const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const MINUTES = z.number().int().min(0).max(100_000)
const CENTS = z.number().int().min(0).max(1e12)
const LOCALE = z.enum(['fr', 'de', 'en', 'it', 'es'])
// Les libellés des valeurs, clés des dictionnaires (écrites en entier : le contrôle des clés les retrouve).
const PRIORITY_K: Record<string, string> = { low: 'assistant.card.prio.low', normal: 'assistant.card.prio.normal', high: 'assistant.card.prio.high', urgent: 'assistant.card.prio.urgent' }
const STATUS_K: Record<string, string> = { lead: 'assistant.card.status.lead', planned: 'assistant.card.status.planned', active: 'assistant.card.status.active',
  on_hold: 'assistant.card.status.on_hold', done: 'assistant.card.status.done', cancelled: 'assistant.card.status.cancelled' }
const HEALTH_K: Record<string, string> = { on_track: 'assistant.card.health.on_track', at_risk: 'assistant.card.health.at_risk', off_track: 'assistant.card.health.off_track' }
const STAGE_K: Record<string, string> = { todo: 'assistant.card.stageStatus.todo', in_progress: 'assistant.card.stageStatus.in_progress',
  done: 'assistant.card.stageStatus.done', blocked: 'assistant.card.stageStatus.blocked' }
const BILLING_K: Record<string, string> = { none: 'assistant.card.billing.none', hourly: 'assistant.card.billing.hourly', retainer: 'assistant.card.billing.retainer',
  fixed: 'assistant.card.billing.fixed', milestone: 'assistant.card.billing.milestone' }
const RECURRENCE_K: Record<string, string> = { none: 'assistant.card.recurrence.none', daily: 'assistant.card.recurrence.daily',
  weekly: 'assistant.card.recurrence.weekly', monthly: 'assistant.card.recurrence.monthly' }
const LANG_K: Record<string, string> = { fr: 'assistant.card.lang.fr', de: 'assistant.card.lang.de', en: 'assistant.card.lang.en', it: 'assistant.card.lang.it', es: 'assistant.card.lang.es' }
const TRIGGER_K: Record<string, string> = { task_completed: 'assistant.card.trigger.task_completed', task_moved: 'assistant.card.trigger.task_moved',
  stage_completed: 'assistant.card.trigger.stage_completed', task_created: 'assistant.card.trigger.task_created', project_completed: 'assistant.card.trigger.project_completed' }
const ACTION_K: Record<string, string> = { notify: 'assistant.card.action.notify', assign: 'assistant.card.action.assign', set_priority: 'assistant.card.action.set_priority',
  move_column: 'assistant.card.action.move_column', complete_stage: 'assistant.card.action.complete_stage', create_task: 'assistant.card.action.create_task' }
const VAT_K: Record<string, string> = { normal: 'assistant.card.vatCode.normal', reduced: 'assistant.card.vatCode.reduced', lodging: 'assistant.card.vatCode.lodging',
  exempt: 'assistant.card.vatCode.exempt', export: 'assistant.card.vatCode.export' }
const AUTO_TO_K: Record<string, string> = { owner: 'assistant.card.autoTo.owner', members: 'assistant.card.autoTo.members', assignees: 'assistant.card.autoTo.assignees' }
const KIND_K: Record<string, string> = { company: 'assistant.card.kind.company', person: 'assistant.card.kind.person' }
const DAY_K = ['assistant.card.day.1', 'assistant.card.day.2', 'assistant.card.day.3', 'assistant.card.day.4', 'assistant.card.day.5', 'assistant.card.day.6', 'assistant.card.day.7']
const CLIENT_FIELD_K: Record<string, string> = { name: 'assistant.card.clientField.name', kind: 'assistant.card.clientField.kind',
  contact_person: 'assistant.card.clientField.contact_person', email: 'assistant.card.clientField.email', phone: 'assistant.card.clientField.phone',
  street: 'assistant.card.clientField.street', building_number: 'assistant.card.clientField.building_number', postal_code: 'assistant.card.clientField.postal_code',
  town: 'assistant.card.clientField.town', vat_number: 'assistant.card.clientField.vat_number', notes: 'assistant.card.clientField.notes',
  country: 'assistant.card.clientField.country', language: 'assistant.card.clientField.language' }
/** Les formats de date et de nombre de chaque langue (comme l'interface : src/i18n, intlLocale). */
const INTL: Record<Locale, string> = { fr: 'fr-CH', de: 'de-CH', en: 'en-GB', it: 'it-CH', es: 'es-ES' }

const clip = (v: unknown, n = 300) => {
  if (typeof v !== 'string') return v
  return v.length > n ? v.slice(0, n) + '…' : v
}
const hours = (m: number | null | undefined) => (m == null ? null : Math.round((m / 60) * 100) / 100)
const hm = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`
const pick = <T extends Record<string, any>>(o: T, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

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

/** Les refus des routes, expliqués au MODÈLE (en français : il répond dans la langue de la personne). */
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
  sends_outside: 'Ce changement ferait partir un email vers l’extérieur (une automatisation de l’entreprise écrit au client) : '
    + 'l’assistant n’envoie jamais rien. Explique-le et ouvre l’écran (open_page) : la personne le fait elle-même.',
  restarts_client_updates: 'Ce changement (seul ou avec les autres de la carte) relancerait le suivi automatique au client : un email '
    + 'partirait au prochain passage. L’assistant n’envoie jamais rien. Explique-le et ouvre l’écran du projet (open_page).',
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
/** Ce qu'un outil d'écriture prépare : les écritures, et ce que la carte en montre (TOUT ce qui est écrit). */
type Built = {
  title: string; lines: Line[]; ops: WriteOp[]
  groups?: SummaryGroup[]
  open?: string | null      // la page à ouvrir après « Confirmer » (« @ref » permis)
  links?: { label: string; path: string }[]   // label : clé d'onglet du projet (stages, list, gantt), traduite à l'écran
  mode?: Mode
  info?: Record<string, unknown>   // rendu au modèle, pour qu'il décrive juste
}
type Refused = { error: string; [k: string]: unknown }
type WriteDef = {
  name: string; description: string; schema: z.ZodObject<any>; batch: boolean
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
  const l: Locale = s.locale ?? 'fr'
  /** Un texte de la carte, dans la langue de la personne (clé entière : le contrôle des clés la retrouve). */
  const L = (key: string, vars?: Record<string, unknown>) => tr(l, key, vars)
  const yesNo = (b: boolean) => L(b ? 'assistant.card.yes' : 'assistant.card.no')
  const q = (x: unknown) => L('assistant.card.quoted', { text: x })
  const before = (value: unknown, old: unknown) => L('assistant.card.before', { value, old })

  // ------------------------------------------------------------------ dates, montants lisibles (langue de la personne)
  const year = s.today.slice(0, 4)
  const fmtShort = new Intl.DateTimeFormat(INTL[l], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  const fmtYear = new Intl.DateTimeFormat(INTL[l], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const D = (iso: string | null | undefined) => {
    if (!iso) return L('assistant.card.noDate')
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
    return (iso.slice(0, 4) === year ? fmtShort : fmtYear).format(d)
  }
  // Un intervalle en mots (« du … au … ») : sur une carte, la flèche « → » ne dit que « avant → après » (B7).
  const span = (a: string, b: string) => (a === b ? D(a) : L('assistant.card.range', { start: D(a), due: D(b) }))
  // L'heure d'un rendez-vous dans le fuseau de l'entreprise (comme l'Agenda), la date dans le format de la langue.
  const when = (iso: string) => {
    const opts = { dateStyle: 'medium', timeStyle: 'short' } as const
    try { return new Intl.DateTimeFormat(INTL[l], { ...opts, timeZone: s.timezone || 'Europe/Zurich' }).format(new Date(iso)) }
    catch { return new Intl.DateTimeFormat(INTL[l], { ...opts, timeZone: 'Europe/Zurich' }).format(new Date(iso)) }
  }
  /** Un pays en toutes lettres dans la langue de la personne (CH → Suisse, Schweiz, Switzerland…). */
  const region = (code: unknown) => {
    if (typeof code !== 'string' || !code) return '—'
    try { return new Intl.DisplayNames([INTL[l]], { type: 'region' }).of(code) ?? code } catch { return code }
  }
  /** La valeur d'un champ d'une fiche client, lisible (genre, pays, langue en toutes lettres). */
  const clientValue = (field: string, v: unknown) => (v == null || v === '' ? '—'
    : field === 'kind' && KIND_K[String(v)] ? L(KIND_K[String(v)])
      : field === 'country' ? region(v)
        : field === 'language' && LANG_K[String(v)] ? L(LANG_K[String(v)]) : String(v))
  const money = (cents: number | null | undefined, cur = 'CHF') => (cents == null ? L('assistant.card.none')
    : `${cur} ${(cents / 100).toLocaleString(INTL[l], { minimumFractionDigits: cents % 100 ? 2 : 0 })}`)
  const noun = (key: string, n: number) => L(key, { n })

  // ------------------------------------------------------------------ lectures communes
  let teamCache: any[] | null = null
  const team = async () => {
    if (!teamCache) { const r = await get('/api/team'); teamCache = r.status === 200 ? r.body.members : [] }
    return teamCache!
  }
  const peopleNames = async (ids: string[] | undefined) => {
    if (!ids?.length) return ''
    const t = await team()
    return ids.map((id) => t.find((m) => m.id === id)?.name ?? L('assistant.card.unknownPerson')).join(', ')
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

  /**
   * Assigner une tâche fait de la personne une intervenante du projet (routes/tasks.ts, setAssignees). Dans un projet
   * réservé aux intervenants, cela OUVRE le projet à un membre qui ne le voyait pas : c'est gérer les intervenants et les
   * droits, interdit à l'assistant (pas de carte ; à faire depuis l'écran du projet). Ailleurs, la carte le dit.
   * `p` : le projet lu par GET /api/projects/:id (null : nouveau projet, visible de l'entreprise, la personne en est
   * la responsable).
   */
  const joining = async (p: any | null, ids: string[] | undefined, projectName: string): Promise<{ line: Line } | Refused> => {
    if (!ids?.length) return { line: null }
    const known = new Set<string>(p ? [p.owner_id, ...(p.members_detail ?? []).map((m: any) => m.id)] : [s.ctx.userId])
    const fresh = [...new Set(ids)].filter((id) => !known.has(id))
    if (!fresh.length) return { line: null }
    const t = await team()
    const opens = p?.visibility === 'members' ? fresh.filter((id) => t.find((m) => m.id === id)?.role === 'member') : []
    if (opens.length) return { error: 'opens_reserved_project', people: await peopleNames(opens),
      hint: 'projet réservé aux intervenants : assigner ces personnes leur ouvrirait le projet (gestion des intervenants, interdite à l’assistant). À faire depuis l’écran du projet.' }
    return { line: L('assistant.card.becomesMember', { project: projectName, names: await peopleNames(fresh) }) }
  }
  /** Copier un projet réservé aux intervenants (ou en partir comme modèle) donnerait une copie visible de toute l'entreprise. */
  const reservedCopy = { error: 'reserved_project_copy',
    hint: 'projet réservé aux intervenants : sa copie serait visible de toute l’entreprise (la visibilité ne se règle pas par l’assistant). À faire depuis l’écran.' }

  // ------------------------------------------------------------------ proposer : essayer, signer, montrer
  const failureForModel = (e: unknown, n: number) => {
    if (e instanceof OpFailure) return { error: 'would_fail', step: e.index + 1, of: n, status: e.status, code: e.code, operation: e.label,
      hint: ROUTE_ERRORS[e.code] ?? 'refusé par l’application', fields: e.body?.fields }
    return { error: 'would_fail', code: String((e as Error)?.message ?? e).slice(0, 80) }
  }

  /**
   * Une proposition à la fois dans un tour : le modèle peut appeler plusieurs outils d'un coup (le runner les lance
   * ensemble) ; chaque essai tient une connexion de la base (db.ts) et les cartes gardent l'ordre des appels.
   */
  let queue: Promise<unknown> = Promise.resolve()
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => {})
    return next
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
    const summary: Summary = { title: b.title, lines: b.lines.filter((x): x is string => Boolean(x)) }
    if (b.groups?.length) summary.groups = b.groups
    const page = (x: string) => pageAllowed(x.replace(/@[A-Za-z0-9_:.-]+/g, '00000000-0000-4000-8000-000000000000'))
    const token = signConfirm({ u: s.ctx.userId, a: s.ctx.accountId, mode, tool, ops: b.ops, summary,
      open: b.open && page(b.open) ? b.open : null, ...(b.links?.length ? { links: b.links.filter((x) => page(x.path)) } : {}) })
    // Une carte que « Confirmer » refuserait (jeton trop long : textes très longs × nombreuses écritures) n'est pas montrée.
    if (token.length > MAX_TOKEN_CHARS) return out({ error: 'card_too_large', hint: 'découper en deux cartes ou raccourcir les textes' })
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
    name: 'propose_create_task', batch: true,
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
      const joins = await joining(p, a.assignee_ids, p.name)
      if ('error' in joins) return joins
      const col = a.column_id ? p.columns.find((x: any) => x.id === a.column_id) : null
      const people = await peopleNames(a.assignee_ids)
      return {
        title: L(parent ? 'assistant.card.title.createSubtask' : 'assistant.card.title.createTask'),
        ops: [{ method: 'POST', path: '/api/tasks', body: { ...a }, ref: 'task' }],
        lines: [L('assistant.card.task', { title: a.title }), L('assistant.card.project', { name: p.name }),
          parent && L('assistant.card.subtaskOf', { title: parent.title }),
          a.description && L('assistant.card.description', { text: a.description }),
          a.start_date && L('assistant.card.start', { date: D(a.start_date) }), a.due_date && L('assistant.card.due', { date: D(a.due_date) }),
          a.priority && L('assistant.card.priority', { value: L(PRIORITY_K[a.priority]) }), stage && L('assistant.card.stage', { name: stage.name }),
          col && L('assistant.card.column', { name: col.name }), people && L('assistant.card.assignees', { names: people }), joins.line,
          a.estimate_minutes != null && L('assistant.card.estimate', { value: hm(a.estimate_minutes) }), a.is_milestone && L('assistant.card.milestone'),
          a.visible_to_client !== undefined && L('assistant.card.visibleToClient', { value: yesNo(a.visible_to_client) }),
          a.recurrence && a.recurrence !== 'none' && L('assistant.card.recurrenceLine', { value: L(RECURRENCE_K[a.recurrence]) }),
          a.tags?.length && L('assistant.card.tags', { value: a.tags.join(', ') })],
        open: `/projets/${a.project_id}?tache=@task`,
      }
    },
  })

  write({
    name: 'propose_update_task', batch: true,
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
      const p = patch.stage_id || patch.column_id || patch.assignee_ids?.length ? await project(t.project_id) : null
      if (patch.stage_id) { stageName = p?.stages.find((x: any) => x.id === patch.stage_id)?.name ?? null; if (!stageName) return { error: 'stage_not_in_project' } }
      if (patch.column_id) { colName = p?.columns.find((x: any) => x.id === patch.column_id)?.name ?? null; if (!colName) return { error: 'column_not_in_project' } }
      if ((await unknownPeople(patch.assignee_ids)).length) return { error: 'unknown_person' }
      const joins = await joining(p, patch.assignee_ids, t.project_name)
      if ('error' in joins) return joins
      const nobody = L('assistant.card.nobody'), noStage = L('assistant.card.noStage'), empty = L('assistant.card.empty'), noneF = L('assistant.card.noneF')
      const changes: Line[] = [
        patch.title && L('assistant.card.titleChanged', { value: q(patch.title), old: q(t.title) }),
        patch.description !== undefined && L('assistant.card.description', { text: before(patch.description || empty, clip(t.description, 200) || empty) }),
        patch.start_date !== undefined && L('assistant.card.startChanged', { value: D(patch.start_date), old: D(t.start_date) }),
        patch.due_date !== undefined && L('assistant.card.dueChanged', { value: D(patch.due_date), old: D(t.due_date) }),
        patch.priority && L('assistant.card.priorityChanged', { value: L(PRIORITY_K[patch.priority]), old: PRIORITY_K[t.priority] ? L(PRIORITY_K[t.priority]) : t.priority }),
        patch.assignee_ids && L('assistant.card.assigneesChanged', { value: (await peopleNames(patch.assignee_ids)) || nobody,
          old: t.assignees.map((x: any) => x.name).join(', ') || nobody }), joins.line,
        patch.completed !== undefined && L(patch.completed ? 'assistant.card.complete' : 'assistant.card.reopen'),
        patch.estimate_minutes !== undefined && L('assistant.card.estimateChanged', { value: patch.estimate_minutes == null ? L('assistant.card.noneF') : hm(patch.estimate_minutes),
          old: t.estimate_minutes == null ? L('assistant.card.noneF') : hm(t.estimate_minutes) }),
        patch.stage_id !== undefined && L('assistant.card.stageChanged', { value: stageName ?? noStage, old: t.stage_name ?? noStage }),
        colName && L('assistant.card.columnChanged', { value: colName, old: t.column_name ?? '—' }),
        patch.is_milestone !== undefined && L(patch.is_milestone ? 'assistant.card.becomesMilestone' : 'assistant.card.notMilestone'),
        patch.visible_to_client !== undefined && L('assistant.card.visibleToClient', { value: before(yesNo(patch.visible_to_client), yesNo(Boolean(t.visible_to_client))) }),
        patch.recurrence && L('assistant.card.recurrenceLine', { value: before(L(RECURRENCE_K[patch.recurrence]), RECURRENCE_K[t.recurrence] ? L(RECURRENCE_K[t.recurrence]) : noneF) }),
        patch.tags && L('assistant.card.tags', { value: before(patch.tags.join(', ') || noneF, (t.tags ?? []).join(', ') || noneF) })]
      return {
        title: L('assistant.card.title.updateTask'),
        ops: [{ method: 'PATCH', path: `/api/tasks/${task_id}`, body: patch }],
        lines: [L('assistant.card.taskIn', { title: t.title, project: t.project_name }), ...changes],
        open: `/projets/${t.project_id}?tache=${task_id}`,
      }
    },
  })

  write({
    name: 'propose_update_tasks', batch: true,
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
      // Ajouter une personne : elle devient intervenante de chaque projet touché (refus si cela ouvre un projet réservé).
      const joinLines: Line[] = []
      if (patch.add_assignee) for (const pid of new Set<string>(found.map((t) => t.project_id))) {
        const joins = await joining(await project(pid), [patch.add_assignee], found.find((t) => t.project_id === pid).project_name)
        if ('error' in joins) return joins
        joinLines.push(joins.line)
      }
      const what = [patch.completed !== undefined && L(patch.completed ? 'assistant.card.bulk.complete' : 'assistant.card.bulk.reopen'),
        patch.priority && L('assistant.card.bulk.priority', { value: L(PRIORITY_K[patch.priority]) }),
        patch.due_date !== undefined && L('assistant.card.bulk.due', { date: D(patch.due_date) }),
        patch.stage_id !== undefined && L(patch.stage_id ? 'assistant.card.bulk.stage' : 'assistant.card.bulk.noStage'),
        patch.add_assignee && L('assistant.card.bulk.add', { name: await peopleNames([patch.add_assignee]) })].filter(Boolean).join(', ')
      return {
        title: L('assistant.card.title.updateTasks', { n: ids.length }),
        ops: [{ method: 'POST', path: '/api/tasks/bulk', body: { ids, patch } }],
        // Chaque tâche visée, toutes (100 au plus) : aucune cachée sous « + N autres ».
        lines: [L('assistant.card.change', { what }), ...found.map((t) => `${q(t.title)} (${t.project_name})`), ...joinLines],
        open: new Set(found.map((t) => t.project_id)).size === 1 ? `/projets/${found[0].project_id}/liste` : '/taches',
      }
    },
  })

  write({
    name: 'propose_add_dependency', batch: true,
    description: 'Prépare une dépendance entre deux tâches du même projet : task_id attendra que depends_on_id soit terminée.',
    schema: z.object({ task_id: UUID, depends_on_id: UUID }),
    build: async ({ task_id, depends_on_id }) => {
      if (task_id === depends_on_id) return { error: 'self_dependency' }
      const [t, d] = await Promise.all([task(task_id), task(depends_on_id)])
      if (!t || !d) return { error: 'task_not_found' }
      if (t.project_id !== d.project_id) return { error: 'dependency_other_project' }
      return {
        title: L('assistant.card.title.addDependency'),
        ops: [{ method: 'POST', path: `/api/tasks/${task_id}/dependencies`, body: { depends_on_id } }],
        lines: [L('assistant.card.waits', { task: t.title, dep: d.title }), L('assistant.card.project', { name: t.project_name })],
        open: `/projets/${t.project_id}/gantt`,
      }
    },
  })

  write({
    name: 'propose_add_task_comment', batch: true,
    description: 'Prépare un commentaire sur une tâche (les @Prénom Nom cités sont notifiés dans ProjectLead).',
    schema: z.object({ task_id: UUID, body: z.string().trim().min(1).max(5000) }),
    build: async ({ task_id, body }) => {
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      return { title: L('assistant.card.title.commentTask'), ops: [{ method: 'POST', path: `/api/tasks/${task_id}/comments`, body: { body } }],
        lines: [L('assistant.card.taskIn', { title: t.title, project: t.project_name }), L('assistant.card.comment', { text: body })],
        open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  write({
    name: 'propose_add_project_comment', batch: true,
    description: 'Prépare un commentaire dans le fil d’activité d’un projet (interne à l’équipe ; les @Prénom Nom cités sont notifiés).',
    schema: z.object({ project_id: UUID, body: z.string().trim().min(1).max(5000) }),
    build: async ({ project_id, body }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      return { title: L('assistant.card.title.commentProject'), ops: [{ method: 'POST', path: `/api/projects/${project_id}/comments`, body: { body } }],
        lines: [L('assistant.card.project', { name: p.name }), L('assistant.card.comment', { text: body }), L('assistant.card.internal')],
        open: `/projets/${project_id}/activite` }
    },
  })

  write({
    name: 'propose_update_comment', batch: true,
    description: 'Prépare la modification d’un de SES commentaires sur une tâche (comment_id et task_id lus avec get_task).',
    schema: z.object({ task_id: UUID, comment_id: UUID, body: z.string().trim().min(1).max(5000) }),
    build: async ({ task_id, comment_id, body }) => {
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      const cm = t.comment_list.find((x: any) => x.id === comment_id)
      if (!cm) return { error: 'comment_not_found' }
      if (cm.author_id !== s.ctx.userId) return { error: 'not_author', hint: 'seul l’auteur modifie son commentaire' }
      return { title: L('assistant.card.title.updateComment'), ops: [{ method: 'PATCH', path: `/api/tasks/comments/${comment_id}`, body: { body } }],
        lines: [L('assistant.card.task', { title: t.title }), L('assistant.card.beforeText', { text: clip(cm.body, 200) }), L('assistant.card.afterText', { text: body })],
        open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  write({
    name: 'propose_add_checklist_item', batch: true,
    description: 'Prépare l’ajout d’un point à la liste de contrôle d’une tâche.',
    schema: z.object({ task_id: UUID, label: z.string().trim().min(1).max(300) }),
    build: async ({ task_id, label }) => {
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      return { title: L('assistant.card.title.addChecklist'), ops: [{ method: 'POST', path: `/api/tasks/${task_id}/checklist`, body: { label } }],
        lines: [L('assistant.card.taskIn', { title: t.title, project: t.project_name }), L('assistant.card.checkItem', { label })],
        open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  write({
    name: 'propose_update_checklist_item', batch: true,
    description: 'Prépare le cochage, le décochage ou le renommage d’un point de la liste de contrôle d’une tâche (item_id lu avec get_task).',
    schema: z.object({ task_id: UUID, item_id: UUID, label: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }),
    build: async ({ task_id, item_id, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const t = await task(task_id)
      if (!t) return { error: 'task_not_found' }
      const it = t.checklist.find((x: any) => x.id === item_id)
      if (!it) return { error: 'item_not_found' }
      return { title: L('assistant.card.title.updateChecklist'), ops: [{ method: 'PATCH', path: `/api/tasks/checklist/${item_id}`, body: patch }],
        lines: [L('assistant.card.task', { title: t.title }), L('assistant.card.checkItem', { label: it.label }), patch.label && L('assistant.card.newLabel', { label: patch.label }),
          patch.done !== undefined && L(patch.done ? 'assistant.card.check' : 'assistant.card.uncheck')],
        open: `/projets/${t.project_id}?tache=${task_id}` }
    },
  })

  const billingFields = {
    billing_mode: z.enum(['none', 'hourly', 'retainer', 'fixed', 'milestone']).optional(), hourly_rate_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
    retainer_cents: CENTS.nullable().optional(), fixed_cents: CENTS.nullable().optional(), budget_cents: CENTS.nullable().optional(),
    currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).optional(), vat_code: z.enum(['normal', 'reduced', 'lodging', 'exempt', 'export']).optional(),
    doc_locale: LOCALE.nullable().optional().describe('langue des documents du client de ce projet (suivi, factures) ; null = celle de l’entreprise'),
  }
  /**
   * La facturation d'un projet, lisible. `old` (le projet tel qu'il est) : chaque montant, taux ou réglage modifié se lit
   * « avant → après » (B7), chaque montant dans SA devise.
   */
  const billingLines = (a: any, cur: string, old?: any): Line[] => {
    const oldCur = old?.currency ?? cur
    const v = (value: string, was: string) => (old ? before(value, was) : value)
    const lang = (x: unknown) => (typeof x === 'string' && LANG_K[x] ? L(LANG_K[x]) : L('assistant.card.companyLanguage'))
    return [
      a.billing_mode && L('assistant.card.billingMode', { value: v(L(BILLING_K[a.billing_mode]), BILLING_K[old?.billing_mode] ? L(BILLING_K[old.billing_mode]) : '—') }),
      a.hourly_rate_cents !== undefined && L('assistant.card.hourlyRate', { value: v(money(a.hourly_rate_cents, cur), money(old?.hourly_rate_cents, oldCur)) }),
      a.retainer_cents !== undefined && L('assistant.card.retainer', { value: v(money(a.retainer_cents, cur), money(old?.retainer_cents, oldCur)) }),
      a.fixed_cents !== undefined && L('assistant.card.fixed', { value: v(money(a.fixed_cents, cur), money(old?.fixed_cents, oldCur)) }),
      a.budget_cents !== undefined && L('assistant.card.budgetAmount', { value: v(money(a.budget_cents, cur), money(old?.budget_cents, oldCur)) }),
      a.currency && L('assistant.card.currency', { value: v(a.currency, old?.currency ?? '—') }),
      a.vat_code && L('assistant.card.vat', { value: v(L(VAT_K[a.vat_code]), VAT_K[old?.vat_code] ? L(VAT_K[old.vat_code]) : '—') }),
      a.doc_locale !== undefined && L('assistant.card.docLocale', { value: v(lang(a.doc_locale), lang(old?.doc_locale)) })]
  }

  write({
    name: 'propose_create_project', batch: true,
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
      if (a.template_id) {
        const t = await project(a.template_id)
        if (!t || !t.is_template) return { error: 'template_not_found' }
        if (t.visibility === 'members') return reservedCopy
        template = t.name
      }
      const body = { ...a, ...(a.is_template ? { status: 'planned' } : {}) }
      return {
        title: L(a.is_template ? 'assistant.card.title.createTemplate' : 'assistant.card.title.createProject'),
        ops: [{ method: 'POST', path: '/api/projects', body, ref: 'project' }],
        lines: [L(a.is_template ? 'assistant.card.templateName' : 'assistant.card.projectName', { name: a.name }), cl && L('assistant.card.client', { name: cl }),
          template && L('assistant.card.fromTemplate', { name: template }),
          !a.is_template && L('assistant.card.status', { value: L(STATUS_K[a.status ?? 'planned']) }), a.code && L('assistant.card.code', { value: a.code }),
          a.priority && L('assistant.card.priority', { value: L(PRIORITY_K[a.priority]) }), a.color && L('assistant.card.color', { value: a.color }),
          a.start_date && L('assistant.card.start', { date: D(a.start_date) }), a.due_date && L('assistant.card.due', { date: D(a.due_date) }),
          a.budget_minutes != null && L('assistant.card.budgetHours', { value: hm(a.budget_minutes) }), ...billingLines(a, a.currency ?? 'CHF'),
          a.description && L('assistant.card.description', { text: a.description })],
        open: '/projets/@project',
      }
    },
  })

  write({
    name: 'propose_update_project', batch: true,
    description: 'Prépare la modification d’un projet : nom, code, couleur, description, client (null = aucun), statut, santé, priorité, dates (null = retirer), budget (heures en minutes, montant en centimes), facturation (mode, taux, forfaits, devise, TVA), langue des documents du client, ce que la page de suivi montre (tâches, temps). Pas la visibilité, le responsable, les intervenants, l’ouverture de la page de suivi ni l’envoi automatique : écran du projet.',
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
      // Le suivi périodique au client (tâches de fond, lib/jobs.ts) part pour un projet en cours, avec un client, dont
      // l'envoi automatique est réglé. Un changement qui le (re)lance ferait partir un email au prochain passage : pas de
      // carte (rien n'est envoyé par l'assistant, même indirectement). Un changement de client le dit sur la carte.
      const follows = (x: any) => Boolean(x.update_frequency && x.update_frequency !== 'none' && x.status === 'active' && !x.is_template && !x.archived_at && x.client_id)
      const next = { ...p, ...(patch.status ? { status: patch.status } : {}), ...(patch.client_id !== undefined ? { client_id: patch.client_id } : {}) }
      if (!follows(p) && follows(next)) return { error: 'restarts_client_updates',
        hint: 'ce projet envoie un suivi automatique au client ; ce changement le relancerait (un email partirait). À faire depuis l’écran du projet.' }
      const none = L('assistant.card.none'), empty = L('assistant.card.empty')
      return {
        title: L(p.is_template ? 'assistant.card.title.updateTemplate' : 'assistant.card.title.updateProject'),
        ops: [{ method: 'PATCH', path: `/api/projects/${project_id}`, body: patch }],
        lines: [L('assistant.card.project', { name: p.name }), patch.name && L('assistant.card.nameChanged', { value: q(patch.name), old: q(p.name) }),
          patch.code !== undefined && L('assistant.card.code', { value: before(patch.code || none, p.code || none) }),
          patch.color && L('assistant.card.color', { value: before(patch.color, p.color ?? none) }),
          patch.client_id !== undefined && L('assistant.card.clientChanged', { value: cl ?? none, old: p.client?.name ?? none }),
          follows(p) && follows(next) && patch.client_id && patch.client_id !== p.client_id && L('assistant.card.followUpTo', { name: cl }),
          patch.status && L('assistant.card.statusChanged', { value: L(STATUS_K[patch.status]), old: STATUS_K[p.status] ? L(STATUS_K[p.status]) : p.status }),
          patch.health && L('assistant.card.healthChanged', { value: L(HEALTH_K[patch.health]), old: HEALTH_K[p.health] ? L(HEALTH_K[p.health]) : p.health }),
          patch.priority && L('assistant.card.priorityChanged', { value: L(PRIORITY_K[patch.priority]), old: PRIORITY_K[p.priority] ? L(PRIORITY_K[p.priority]) : p.priority }),
          patch.start_date !== undefined && L('assistant.card.startChanged', { value: D(patch.start_date), old: D(p.start_date) }),
          patch.due_date !== undefined && L('assistant.card.dueChanged', { value: D(patch.due_date), old: D(p.due_date) }),
          patch.budget_minutes !== undefined && L('assistant.card.budgetHoursChanged', { value: patch.budget_minutes == null ? L('assistant.card.none') : hm(patch.budget_minutes),
            old: p.budget_minutes == null ? L('assistant.card.none') : hm(p.budget_minutes) }),
          ...billingLines(patch, patch.currency ?? p.currency ?? 'CHF', p),
          patch.portal_show_tasks !== undefined && L('assistant.card.portalTasks', { value: before(yesNo(patch.portal_show_tasks), yesNo(Boolean(p.portal_show_tasks))) }),
          patch.portal_show_time !== undefined && L('assistant.card.portalTime', { value: before(yesNo(patch.portal_show_time), yesNo(Boolean(p.portal_show_time))) }),
          patch.description !== undefined && L('assistant.card.description', { text: before(patch.description || empty, clip(p.description, 200) || empty) })],
        open: `/projets/${project_id}`,
      }
    },
  })

  write({
    name: 'propose_duplicate_project', batch: true,
    description: 'Prépare la copie d’un projet (étapes, colonnes, tâches, dépendances, dates recalées sur start_date) en nouveau projet, ou son enregistrement comme MODÈLE réutilisable (as_template: true, sans client).',
    schema: z.object({ project_id: UUID, name: z.string().trim().min(1).max(200), as_template: z.boolean().default(false), start_date: DATE.optional(), client_id: UUID.optional() }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      // La copie (ou le modèle) d'un projet réservé aux intervenants serait visible de toute l'entreprise.
      if (p.visibility === 'members') return reservedCopy
      let cl: string | null = null
      if (a.client_id && !a.as_template) { const c = await client(a.client_id); if (!c) return { error: 'client_not_found' }; cl = c.name }
      const body: Record<string, unknown> = { name: a.name, as_template: a.as_template, ...(a.as_template ? {} : { start_date: a.start_date ?? s.today, ...(a.client_id ? { client_id: a.client_id } : {}) }) }
      // Ce que la copie reprend du projet source (routes/projects.ts, duplicate) : son client si aucun n'est donné, le statut
      // « en cours » (un modèle : sans client), la facturation et le budget. Tout est dit sur la carte (relecture du 29.10).
      const copied: Record<string, unknown> = { billing_mode: p.billing_mode }
      for (const k of ['hourly_rate_cents', 'retainer_cents', 'fixed_cents', 'budget_cents', 'doc_locale']) if (p[k] != null) copied[k] = p[k]
      if (p.vat_code && p.vat_code !== 'normal') copied.vat_code = p.vat_code
      return {
        title: L(a.as_template ? 'assistant.card.title.saveTemplate' : 'assistant.card.title.duplicate'),
        ops: [{ method: 'POST', path: `/api/projects/${a.project_id}/duplicate`, body, ref: 'copy' }],
        lines: [L(a.as_template ? 'assistant.card.copyAsTemplate' : 'assistant.card.copyAsProject', { name: a.name, from: p.name }),
          L('assistant.card.copies', { stages: noun('assistant.noun.stage', p.stages.length), tasks: noun('assistant.noun.task', p.tasks_total) }),
          !a.as_template && L('assistant.card.newStart', { date: D(String(body.start_date)) }),
          !a.as_template && L('assistant.card.client', { name: cl ?? p.client_name ?? L('assistant.card.none') }),
          !a.as_template && L('assistant.card.status', { value: L(STATUS_K.active) }),
          ...billingLines(copied, p.currency ?? 'CHF'),
          p.budget_minutes != null && L('assistant.card.budgetHours', { value: hm(p.budget_minutes) }),
          a.as_template && L('assistant.card.templateNoClient')],
        open: '/projets/@copy',
      }
    },
  })

  write({
    name: 'propose_project_update', batch: true,
    description: "Prépare un point d'avancement interne sur un projet (santé + texte). Il n'est PAS partagé avec le client.",
    schema: z.object({ project_id: UUID, health: z.enum(['on_track', 'at_risk', 'off_track']), body: z.string().trim().max(5000).default('') }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      return { title: L('assistant.card.title.projectUpdate'),
        ops: [{ method: 'POST', path: `/api/projects/${a.project_id}/updates`, body: { health: a.health, body: a.body, share_with_client: false } }],
        lines: [L('assistant.card.project', { name: p.name }), L('assistant.card.health', { value: L(HEALTH_K[a.health]) }),
          a.body && L('assistant.card.text', { text: a.body }), L('assistant.card.notShared')],
        open: `/projets/${a.project_id}` }
    },
  })

  write({
    name: 'propose_create_stage', batch: true,
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
      return { title: L('assistant.card.title.createStage'), ops: [{ method: 'POST', path: `/api/projects/${project_id}/stages`, body: a }],
        lines: [L('assistant.card.stageNumbered', { name: a.name, n: p.stages.length + 1 }), L('assistant.card.project', { name: p.name }),
          a.description && L('assistant.card.description', { text: a.description }),
          a.client_note && L('assistant.card.clientNote', { text: a.client_note }), a.status && L('assistant.card.status', { value: L(STAGE_K[a.status]) }),
          (a.start_date || a.due_date) && L('assistant.card.dates', { start: D(a.start_date), due: D(a.due_date) }),
          // Toujours dit : sans choix, une étape est visible par le client (db/001_schema.sql, stages.visible_to_client).
          L('assistant.card.visibleToClient', { value: yesNo(a.visible_to_client ?? true) }),
          a.billing_cents != null && L('assistant.card.amount', { value: money(a.billing_cents, p.currency) })],
        open: `/projets/${project_id}/etapes` }
    },
  })

  write({
    name: 'propose_update_stage', batch: true,
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
      const empty = L('assistant.card.empty')
      const changes: Line[] = [patch.name && L('assistant.card.nameChanged', { value: q(patch.name), old: q(st.name) }),
        patch.status && L('assistant.card.stageStatusChanged', { value: L(STAGE_K[patch.status]), old: STAGE_K[st.status] ? L(STAGE_K[st.status]) : st.status }),
        patch.start_date !== undefined && L('assistant.card.startChanged', { value: D(patch.start_date), old: D(st.start_date) }),
        patch.due_date !== undefined && L('assistant.card.dueChanged', { value: D(patch.due_date), old: D(st.due_date) }),
        patch.description !== undefined && L('assistant.card.description', { text: before(patch.description || empty, clip(st.description, 200) || empty) }),
        patch.client_note !== undefined && L('assistant.card.clientNote', { text: before(patch.client_note || empty, clip(st.client_note, 200) || empty) }),
        patch.visible_to_client !== undefined && L('assistant.card.visibleToClient', { value: before(yesNo(patch.visible_to_client), yesNo(Boolean(st.visible_to_client))) }),
        patch.billing_cents !== undefined && L('assistant.card.amount', { value: before(money(patch.billing_cents, p.currency), money(st.billing_cents, p.currency)) })]
      return { title: L('assistant.card.title.updateStage'), ops: [{ method: 'PATCH', path: `/api/projects/stages/${stage_id}`, body: patch }],
        lines: [L('assistant.card.stageOf', { name: st.name, project: p.name }), ...changes], open: `/projets/${project_id}/etapes` }
    },
  })

  write({
    name: 'propose_reorder', batch: true,
    description: 'Prépare le nouvel ordre des étapes (kind: stages) ou des colonnes du tableau (kind: columns) d’un projet : ids = TOUS les identifiants, dans le nouvel ordre.',
    schema: z.object({ project_id: UUID, kind: z.enum(['stages', 'columns']), ids: z.array(UUID).min(1).max(100) }),
    build: async ({ project_id, kind, ids }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      const list: any[] = kind === 'stages' ? p.stages : p.columns
      if (ids.length !== list.length || new Set(ids).size !== ids.length || !ids.every((id: string) => list.some((x) => x.id === id)))
        return { error: 'ids_must_list_all', expected: list.map((x) => ({ id: x.id, name: x.name })) }
      const names = ids.map((id: string) => list.find((x) => x.id === id).name)
      return { title: L(kind === 'stages' ? 'assistant.card.title.reorderStages' : 'assistant.card.title.reorderColumns'),
        ops: [{ method: 'POST', path: `/api/projects/${project_id}/${kind}/order`, body: { ids } }],
        lines: [L('assistant.card.project', { name: p.name }), ...names.map((x: string, i: number) => `${i + 1}. ${x}`)],
        open: `/projets/${project_id}/${kind === 'stages' ? 'etapes' : 'tableau'}` }
    },
  })

  write({
    name: 'propose_board_column', batch: true,
    description: 'Prépare une colonne du tableau (kanban) d’un projet : création (sans column_id, name obligatoire) ou modification (column_id) du nom, de « colonne des tâches terminées » (is_done) et de la limite de cartes (wip_limit, null = aucune).',
    schema: z.object({ project_id: UUID, column_id: UUID.optional(), name: z.string().trim().min(1).max(60).optional(), is_done: z.boolean().optional(),
      wip_limit: z.number().int().min(1).max(999).nullable().optional() }),
    build: async ({ project_id, column_id, ...a }) => {
      const p = await project(project_id)
      if (!p) return { error: 'project_not_found' }
      if (!column_id) {
        if (!a.name) return { error: 'name_required' }
        return { title: L('assistant.card.title.addColumn'), ops: [{ method: 'POST', path: `/api/projects/${project_id}/columns`, body: a }],
          lines: [L('assistant.card.columnName', { name: a.name }), L('assistant.card.project', { name: p.name }), a.is_done && L('assistant.card.doneColumn'),
            a.wip_limit && L('assistant.card.wip', { n: a.wip_limit })],
          open: `/projets/${project_id}/tableau` }
      }
      const col = p.columns.find((x: any) => x.id === column_id)
      if (!col) return { error: 'column_not_found' }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: L('assistant.card.title.updateColumn'), ops: [{ method: 'PATCH', path: `/api/projects/columns/${column_id}`, body: a }],
        lines: [L('assistant.card.columnOf', { name: col.name, project: p.name }), a.name && L('assistant.card.nameChanged', { value: q(a.name), old: q(col.name) }),
          a.is_done !== undefined && L('assistant.card.doneTasks', { value: before(yesNo(a.is_done), yesNo(Boolean(col.is_done))) }),
          a.wip_limit !== undefined && L('assistant.card.wipChanged', { value: before(a.wip_limit ?? L('assistant.card.noneF'), col.wip_limit ?? L('assistant.card.noneF')) })],
        open: `/projets/${project_id}/tableau` }
    },
  })

  write({
    name: 'propose_set_file_visibility', batch: true,
    description: 'Prépare le choix « visible par le client » d’un fichier du projet (sur la page de suivi, si elle est ouverte). file_id lu avec list_files.',
    schema: z.object({ project_id: UUID, file_id: UUID, visible_to_client: z.boolean() }),
    build: async ({ project_id, file_id, visible_to_client }) => {
      const r = await get(`/api/projects/${project_id}/files`)
      if (r.status !== 200) return { error: 'project_not_found' }
      const f = r.body.find((x: any) => x.id === file_id)
      if (!f) return { error: 'file_not_found' }
      const p = await project(project_id)
      return { title: L('assistant.card.title.fileVisibility'), ops: [{ method: 'PATCH', path: `/api/projects/files/${file_id}`, body: { visible_to_client } }],
        lines: [L('assistant.card.file', { name: f.filename, project: p?.name ?? '' }),
          L(!visible_to_client ? 'assistant.card.fileHidden' : p?.portal_enabled ? 'assistant.card.fileVisible' : 'assistant.card.fileVisibleClosed')],
        open: `/projets/${project_id}/fichiers` }
    },
  })

  write({
    name: 'propose_log_time', batch: true,
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
      return { title: L('assistant.card.title.logTime'), ops: [{ method: 'POST', path: '/api/time/entries', body }],
        lines: [L('assistant.card.project', { name: p.name }), t && L('assistant.card.task', { title: t.title }), L('assistant.card.date', { date: D(a.entry_date) }),
          L('assistant.card.duration', { value: hm(a.minutes) }),
          a.user_id && a.user_id !== s.ctx.userId && L('assistant.card.for', { names: await peopleNames([a.user_id]) }),
          a.note && L('assistant.card.note', { text: a.note }),
          p.billing_mode === 'none' ? L('assistant.card.nonBillable') : L('assistant.card.billable', { value: yesNo(body.billable) })],
        open: '/temps' }
    },
  })

  /** Une saisie de temps lue par son identifiant (liste de l'entreprise, comme l'écran Temps). */
  const timeEntry = async (id: string) => {
    const r = await get('/api/time/entries?user=all')
    return r.status === 200 ? r.body.find((e: any) => e.id === id) ?? null : null
  }
  write({
    name: 'propose_update_time_entry', batch: true,
    description: 'Prépare la modification d’une saisie de temps (entry_id lu avec list_time_entries) : projet, tâche (null = aucune), date, minutes, facturable, note. Le temps déjà facturé ne se modifie plus.',
    schema: z.object({ entry_id: UUID, project_id: UUID.optional(), task_id: UUID.nullable().optional(), entry_date: DATE.optional(),
      minutes: z.number().int().min(1).max(1440).optional(), billable: z.boolean().optional(), note: z.string().max(2000).optional() }),
    build: async ({ entry_id, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const e = await timeEntry(entry_id)
      if (!e) return { error: 'entry_not_found' }
      if (e.invoiced_at) return { error: 'already_invoiced' }
      let pName = e.project_name, tTitle: string | null = patch.task_id === null ? null : e.task_title
      if (patch.project_id) { const p = await project(patch.project_id); if (!p) return { error: 'project_not_found' }; pName = p.name }
      if (patch.task_id) { const t = await task(patch.task_id); if (!t || t.project_id !== (patch.project_id ?? e.project_id)) return { error: 'task_not_in_project' }; tTitle = t.title }
      const none = L('assistant.card.noneF'), empty = L('assistant.card.empty')
      return { title: L('assistant.card.title.updateTime'), ops: [{ method: 'PATCH', path: `/api/time/entries/${entry_id}`, body: patch }],
        // Chaque champ modifié « avant → après » (B7).
        lines: [L('assistant.card.entry', { date: D(e.entry_date), duration: hm(e.minutes ?? 0), project: e.project_name, task: e.task_title ? ` (${q(e.task_title)})` : '', person: e.user_name }),
          patch.project_id && L('assistant.card.project', { name: before(pName, e.project_name) }),
          patch.task_id !== undefined && L('assistant.card.taskChanged', { value: tTitle ? q(tTitle) : none, old: e.task_title ? q(e.task_title) : none }),
          patch.entry_date && L('assistant.card.date', { date: before(D(patch.entry_date), D(e.entry_date)) }),
          patch.minutes && L('assistant.card.duration', { value: before(hm(patch.minutes), hm(e.minutes ?? 0)) }),
          patch.billable !== undefined && L('assistant.card.billable', { value: before(yesNo(patch.billable), yesNo(Boolean(e.billable))) }),
          patch.note !== undefined && L('assistant.card.note', { text: before(patch.note || empty, clip(e.note, 200) || empty) })],
        open: '/temps' }
    },
  })

  write({
    name: 'propose_set_timesheet_day', batch: true,
    description: 'Prépare une case de SA feuille de temps : le total du jour pour un projet (et une tâche) devient `minutes` (1 à 1440) ; les saisies de ce jour-là sur ce projet/tâche sont remplacées par une seule. Pour ajouter du temps sans remplacer : propose_log_time.',
    schema: z.object({ project_id: UUID, task_id: UUID.optional(), entry_date: DATE, minutes: z.number().int().min(1).max(1440) }),
    build: async (a) => {
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      let t: any = null
      if (a.task_id) { t = await task(a.task_id); if (!t || t.project_id !== a.project_id) return { error: 'task_not_in_project' } }
      const monday = (() => { const d = new Date(`${a.entry_date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) })()
      const w = await get(`/api/time/week?start=${monday}`)
      const prev = w.status === 200 ? w.body.rows.filter((x: any) => x.project_id === a.project_id && (x.task_id ?? null) === (a.task_id ?? null)
        && String(x.entry_date).slice(0, 10) === a.entry_date).reduce((n: number, x: any) => n + x.minutes, 0) : 0
      return { title: L('assistant.card.title.timesheet'),
        ops: [{ method: 'PUT', path: '/api/time/week/cell', body: { project_id: a.project_id, task_id: a.task_id ?? null, entry_date: a.entry_date, minutes: a.minutes } }],
        lines: [L('assistant.card.project', { name: p.name }), t && L('assistant.card.task', { title: t.title }), L('assistant.card.day', { date: D(a.entry_date) }),
          L('assistant.card.dayTotal', { value: hm(a.minutes), old: prev ? hm(prev) : L('assistant.card.nothing') }), prev > 0 && L('assistant.card.replaced')],
        open: '/temps' }
    },
  })

  write({
    name: 'propose_timer', batch: true,
    description: 'Prépare le démarrage du chronomètre de la personne sur un projet (et une tâche), ou son arrêt (action stop).',
    schema: z.object({ action: z.enum(['start', 'stop']), project_id: UUID.optional(), task_id: UUID.optional(), note: z.string().max(2000).optional() }),
    build: async (a) => {
      if (a.action === 'stop') return { title: L('assistant.card.title.timerStop'), ops: [{ method: 'POST', path: '/api/time/timer/stop', body: {} }],
        lines: [L('assistant.card.timerSaved')], open: '/temps' }
      if (!a.project_id) return { error: 'project_id_required' }
      const p = await project(a.project_id)
      if (!p) return { error: 'project_not_found' }
      let t: any = null
      if (a.task_id) { t = await task(a.task_id); if (!t || t.project_id !== a.project_id) return { error: 'task_not_in_project' } }
      return { title: L('assistant.card.title.timerStart'),
        ops: [{ method: 'POST', path: '/api/time/timer/start', body: { project_id: a.project_id, task_id: a.task_id ?? null, note: a.note ?? '' } }],
        lines: [L('assistant.card.project', { name: p.name }), t && L('assistant.card.task', { title: t.title }),
          a.note && L('assistant.card.note', { text: a.note }), L('assistant.card.timerReplaces')],
        open: '/temps' }
    },
  })

  const clientFields = {
    contact_person: z.string().trim().max(200).optional(), email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().max(50).optional(), street: z.string().trim().max(70).optional(), building_number: z.string().trim().max(16).optional(),
    postal_code: z.string().trim().max(16).optional(), town: z.string().trim().max(35).optional(), vat_number: z.string().trim().max(40).optional(),
    notes: z.string().max(5000).optional(),
  }
  const addressLine = (a: any) => (a.street || a.town || a.postal_code)
    && L('assistant.card.address', { value: [a.street && `${a.street} ${a.building_number ?? ''}`.trim(), [a.postal_code, a.town].filter(Boolean).join(' ')].filter(Boolean).join(', ') })

  write({
    name: 'propose_create_client', batch: true,
    description: 'Prépare la création d’une fiche client (entreprise ou personne).',
    schema: z.object({
      name: z.string().trim().min(1).max(200), kind: z.enum(['company', 'person']).default('company'), ...clientFields,
      country: z.string().regex(/^[A-Z]{2}$/).default('CH'), language: z.enum(['fr', 'de', 'it', 'en', 'es']).default('fr'),
    }),
    build: async (a) => ({
      title: L('assistant.card.title.createClient'), ops: [{ method: 'POST', path: '/api/clients', body: { ...a }, ref: 'client' }],
      lines: [L('assistant.card.clientKind', { name: a.name, kind: L(a.kind === 'person' ? 'assistant.card.kind.person' : 'assistant.card.kind.company') }),
        a.contact_person && L('assistant.card.contactPerson', { name: a.contact_person }),
        a.email && L('assistant.card.email', { value: a.email }), a.phone && L('assistant.card.phone', { value: a.phone }), addressLine(a),
        L('assistant.card.country', { value: region(a.country) }), L('assistant.card.clientLanguage', { value: L(LANG_K[a.language]) }),
        a.vat_number && L('assistant.card.vatNumber', { value: a.vat_number }), a.notes && L('assistant.card.note', { text: a.notes })],
      open: '/clients/@client',
    }),
  })

  write({
    name: 'propose_update_client', batch: true,
    description: 'Prépare la modification d’une fiche client : nom, genre, contact, email, téléphone, adresse, pays, langue, TVA, notes. (Archiver un client : écran du client.)',
    schema: z.object({ client_id: UUID, name: z.string().trim().min(1).max(200).optional(), kind: z.enum(['company', 'person']).optional(), ...clientFields,
      country: z.string().regex(/^[A-Z]{2}$/).optional(), language: z.enum(['fr', 'de', 'it', 'en', 'es']).optional() }),
    build: async ({ client_id, ...patch }) => {
      if (!Object.keys(patch).length) return { error: 'nothing_to_change' }
      const c = await client(client_id)
      if (!c) return { error: 'client_not_found' }
      return { title: L('assistant.card.title.updateClient'), ops: [{ method: 'PATCH', path: `/api/clients/${client_id}`, body: patch }],
        lines: [L('assistant.card.clientName', { name: c.name }), ...Object.entries(patch).map(([k, v]) => L('assistant.card.fieldChanged', {
          field: CLIENT_FIELD_K[k] ? L(CLIENT_FIELD_K[k]) : k, value: clientValue(k, v), old: clip(String(clientValue(k, c[k])), 60) }))],
        open: `/clients/${client_id}` }
    },
  })

  write({
    name: 'propose_client_contact', batch: true,
    description: 'Prépare un contact d’un client : ajout (sans contact_id) ou modification (contact_id lu avec get_client) : nom, email, téléphone, fonction, reçoit le suivi des projets (receives_updates).',
    schema: z.object({ client_id: UUID, contact_id: UUID.optional(), name: z.string().trim().max(200).optional(), email: z.string().trim().email().max(254).optional(),
      phone: z.string().trim().max(50).optional(), job_title: z.string().trim().max(120).optional(), receives_updates: z.boolean().optional() }),
    build: async ({ client_id, contact_id, ...a }) => {
      const c = await client(client_id)
      if (!c) return { error: 'client_not_found' }
      // Ajout : chaque champ ; modification : chaque champ « avant → après » (B7). « Reçoit le suivi » toujours dit.
      const k = contact_id ? c.contacts.find((x: any) => x.id === contact_id) : null
      if (contact_id && !k) return { error: 'contact_not_found' }
      const v = (value: unknown, old: unknown) => (k ? before(value, old || '—') : value)
      const detail: Line[] = [a.name !== undefined && L('assistant.card.name', { value: v(a.name || '—', k?.name) }),
        a.email !== undefined && L('assistant.card.email', { value: v(a.email, k?.email) }),
        a.phone !== undefined && L('assistant.card.phone', { value: v(a.phone || '—', k?.phone) }),
        a.job_title !== undefined && L('assistant.card.jobTitle', { value: v(a.job_title || '—', k?.job_title) })]
      if (!k) {
        if (!a.name && !a.email) return { error: 'name_or_email_required' }
        return { title: L('assistant.card.title.addContact'), ops: [{ method: 'POST', path: `/api/clients/${client_id}/contacts`, body: a }],
          lines: [L('assistant.card.clientName', { name: c.name }), ...detail, L('assistant.card.receives', { value: yesNo(a.receives_updates ?? true) })],
          open: `/clients/${client_id}` }
      }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      return { title: L('assistant.card.title.updateContact'), ops: [{ method: 'PATCH', path: `/api/clients/contacts/${contact_id}`, body: a }],
        lines: [L('assistant.card.contactOf', { name: k.name || k.email, client: c.name }), ...detail,
          a.receives_updates !== undefined && L('assistant.card.receives', { value: before(yesNo(a.receives_updates), yesNo(Boolean(k.receives_updates))) })],
        open: `/clients/${client_id}` }
    },
  })

  /** Un rendez-vous tel que l'Agenda le montre, avec ses participants : lu seul (`?id=`), pas tout l'agenda. */
  const eventOf = async (id: string) => {
    const r = await get(`/api/calendar/events?id=${encodeURIComponent(id)}`)
    const list: any[] = r.status === 200 ? r.body.events ?? [] : []
    return list.find((e) => e.id === id) ?? null
  }
  const EVENT_KIND_K: Record<string, string> = { meeting: 'assistant.card.eventKind.meeting', call: 'assistant.card.eventKind.call',
    workshop: 'assistant.card.eventKind.workshop', deadline: 'assistant.card.eventKind.deadline', other: 'assistant.card.eventKind.other' }
  write({
    name: 'propose_event', batch: true,
    description: 'Prépare un rendez-vous de l’agenda : création (sans event_id : titre, début, fin obligatoires) ou modification (event_id lu avec list_events). Dates avec heure et décalage (2026-11-03T14:00:00+01:00). attendee_user_ids et attendee_emails : la liste COMPLÈTE (elle remplace l’actuelle, lue avec list_events) ; une liste non donnée reste telle quelle ; la personne qui confirme reste participante. Les personnes de l’équipe sont prévenues dans ProjectLead ; AUCUNE invitation n’est envoyée par email aux adresses extérieures (cela se fait depuis l’agenda).',
    schema: z.object({
      event_id: UUID.optional(), title: z.string().trim().min(1).max(300).optional(), description: z.string().max(10000).optional(), location: z.string().max(500).optional(),
      kind: z.enum(['meeting', 'call', 'workshop', 'deadline', 'other']).optional(), starts_at: DATETIME.optional(), ends_at: DATETIME.optional(), all_day: z.boolean().optional(),
      project_id: UUID.nullable().optional(), client_id: UUID.nullable().optional(), attendee_user_ids: z.array(UUID).max(50).optional(),
      attendee_emails: z.array(z.string().trim().email().max(254)).max(50).optional(),
    }),
    build: async ({ event_id, ...a }) => {
      if (a.starts_at && a.ends_at && Date.parse(a.ends_at) < Date.parse(a.starts_at)) return { error: 'end_before_start' }
      const none = L('assistant.card.none'), empty = L('assistant.card.empty')
      let pName: string | null = null, cName: string | null = null
      if (a.project_id) { const p = await project(a.project_id); if (!p) return { error: 'project_not_found' }; pName = p.name }
      if (a.client_id) { const c = await client(a.client_id); if (!c) return { error: 'client_not_found' }; cName = c.name }
      if ((await unknownPeople(a.attendee_user_ids)).length) return { error: 'unknown_person' }
      const kind = (k: unknown) => (typeof k === 'string' && EVENT_KIND_K[k] ? L(EVENT_KIND_K[k]) : '—')
      if (!event_id) {
        if (!a.title || !a.starts_at || !a.ends_at) return { error: 'title_start_end_required' }
        // La route ajoute toujours la personne qui confirme aux participants.
        const team = [...new Set([s.ctx.userId, ...(a.attendee_user_ids ?? [])])]
        return { title: L('assistant.card.title.createEvent'), ops: [{ method: 'POST', path: '/api/calendar/events', body: { ...a, send_invites: false } }],
          lines: [L('assistant.card.eventTitle', { value: a.title }), a.kind && L('assistant.card.eventKind', { value: kind(a.kind) }),
            L('assistant.card.eventStart', { value: when(a.starts_at) }), L('assistant.card.eventEnd', { value: when(a.ends_at) }), a.all_day && L('assistant.card.allDay'),
            a.location && L('assistant.card.location', { value: a.location }), pName && L('assistant.card.project', { name: pName }), cName && L('assistant.card.client', { name: cName }),
            L('assistant.card.team', { names: await peopleNames(team) }),
            a.attendee_emails?.length && L('assistant.card.external', { emails: a.attendee_emails.join(', ') }),
            a.description && L('assistant.card.description', { text: a.description })],
          open: '/agenda' }
      }
      if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      const ev = await eventOf(event_id)
      if (!ev) return { error: 'event_not_found' }
      // Les participants : la route efface TOUTE la liste dès qu'une des deux est donnée, puis réinsère ce qu'elle reçoit
      // (routes/calendar.ts). La liste qui n'est pas donnée est donc recopiée telle quelle : rien n'est retiré en douce.
      const attendees: any[] = ev.attendees ?? []
      const usersBefore = attendees.filter((x) => x.user_id).map((x) => x.user_id as string)
      const emailsBefore = attendees.filter((x) => !x.user_id && x.email).map((x) => x.email as string)
      const body: Record<string, unknown> = { ...a, send_invites: false }
      const touching = a.attendee_user_ids !== undefined || a.attendee_emails !== undefined
      if (touching) {
        body.attendee_user_ids = a.attendee_user_ids ?? usersBefore
        body.attendee_emails = a.attendee_emails ?? emailsBefore
      }
      const usersAfter = touching ? [...new Set([s.ctx.userId, ...(body.attendee_user_ids as string[])])] : usersBefore
      const emailsAfter = touching ? body.attendee_emails as string[] : emailsBefore
      const same = (x: string[], y: string[]) => x.length === y.length && x.every((v) => y.includes(v))
      const names = async (ids: string[]) => (await peopleNames(ids)) || none
      const at = (iso: string | null) => (iso ? when(iso) : none)
      // Chaque champ modifié « avant → après » (B7), les participants retirés compris.
      return { title: L('assistant.card.title.updateEvent'), ops: [{ method: 'PATCH', path: `/api/calendar/events/${event_id}`, body }],
        lines: [L('assistant.card.event', { title: ev.title, when: at(ev.starts_at) }),
          a.title && L('assistant.card.eventTitle', { value: before(a.title, ev.title) }),
          a.kind && L('assistant.card.eventKind', { value: before(kind(a.kind), kind(ev.kind)) }),
          a.starts_at && L('assistant.card.eventStart', { value: before(when(a.starts_at), at(ev.starts_at)) }),
          a.ends_at && L('assistant.card.eventEnd', { value: before(when(a.ends_at), at(ev.ends_at)) }),
          a.all_day !== undefined && L('assistant.card.allDayChanged', { value: before(yesNo(a.all_day), yesNo(Boolean(ev.all_day))) }),
          a.location !== undefined && L('assistant.card.location', { value: before(a.location || empty, ev.location || empty) }),
          a.project_id !== undefined && L('assistant.card.project', { name: before(pName ?? none, ev.project_name ?? none) }),
          a.client_id !== undefined && L('assistant.card.client', { name: before(cName ?? none, ev.client_name ?? none) }),
          !same(usersBefore, usersAfter) && L('assistant.card.team', { names: before(await names(usersAfter), await names(usersBefore)) }),
          !same(emailsBefore, emailsAfter) && L('assistant.card.external', { emails: before(emailsAfter.join(', ') || none, emailsBefore.join(', ') || none) }),
          a.description !== undefined && L('assistant.card.description', { text: before(a.description || empty, clip(ev.description, 200) || empty) })],
        open: '/agenda' }
    },
  })

  /** Un email de la boîte de réception (même règle de visibilité que l'écran). */
  const inboxMessage = async (id: string) => {
    const r = await get('/api/mail/inbox?status=all')
    return r.status === 200 ? r.body.find((m: any) => m.id === id) ?? null : null
  }
  const emailLine = (m: any) => L('assistant.card.emailFrom', { subject: m.subject || L('assistant.card.noSubject'), from: m.from_name ?? m.from_email })
  write({
    name: 'propose_set_email_status', batch: true,
    description: 'Prépare le classement d’un email reçu (message_id lu avec list_emails) : « ignored » (ignorer) ou « new » (remettre à trier, ce qui le détache de son projet).',
    schema: z.object({ message_id: UUID, status: z.enum(['new', 'ignored']) }),
    build: async ({ message_id, status }) => {
      const m = await inboxMessage(message_id)
      if (!m) return { error: 'message_not_found' }
      return { title: L(status === 'ignored' ? 'assistant.card.title.ignoreEmail' : 'assistant.card.title.untriageEmail'),
        ops: [{ method: 'POST', path: `/api/mail/messages/${message_id}/status`, body: { status } }],
        lines: [emailLine(m), status === 'new' && m.project_name && L('assistant.card.detached', { name: m.project_name })],
        open: '/emails' }
    },
  })

  write({
    name: 'propose_mark_notifications_read', batch: true,
    description: 'Prépare le marquage de SES notifications comme lues : toutes (sans ids) ou certaines (ids lus avec list_settings kind=notifications).',
    schema: z.object({ ids: z.array(UUID).max(200).optional() }),
    build: async ({ ids }) => {
      const r = await get('/api/notifications')
      const unread = r.status === 200 ? r.body.filter((x: any) => !x.read_at && (!ids || ids.includes(x.id))) : []
      if (!unread.length) return { error: 'nothing_to_change', hint: 'aucune notification non lue' }
      return { title: L('assistant.card.title.notifRead'), ops: [{ method: 'POST', path: '/api/notifications/read', body: ids ? { ids } : {} }],
        lines: [L('assistant.card.unread', { n: unread.length }), ...unread.slice(0, 6).map((x: any) => clip(x.title, 90) as string),
          unread.length > 6 && L('assistant.card.more', { n: unread.length - 6 })],
        open: null }
    },
  })

  write({
    name: 'propose_update_settings', batch: true,
    description: 'Prépare des réglages : profile (son nom, sa couleur), company (entreprise, administrateurs : nom, fuseau, devise, heures par semaine, langue des documents), billing (facturation mensuelle vers InvoiceLead : automatique, jour, langue, signature du suivi client ; responsables et administrateurs), mailbox (une boîte branchée : nom affiché, boîte par défaut). Ni mot de passe, ni partage d’une boîte, ni équipe, ni formule. La langue de l’interface : propose_set_language.',
    schema: z.object({
      profile: z.object({ name: z.string().trim().min(1).max(120).optional(), color: COLOR.optional() }).optional(),
      company: z.object({ name: z.string().trim().min(1).max(200).optional(), timezone: z.string().max(60).optional(),
        currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).optional(), week_hours: z.number().min(1).max(80).optional(), locale: LOCALE.optional() }).optional(),
      billing: z.object({ monthly_billing_auto: z.boolean().optional(), monthly_billing_day: z.number().int().min(1).max(28).optional(),
        invoice_language: LOCALE.optional(), client_update_signature: z.string().max(2000).optional() }).optional(),
      mailbox: z.object({ id: UUID, display_name: z.string().trim().max(120).optional(), is_default: z.boolean().optional() }).optional(),
    }),
    build: async (a) => {
      const ops: WriteOp[] = []
      const lines: Line[] = []
      // Chaque réglage « avant → après » (B7), chaque texte en entier (la signature est ajoutée à TOUS les suivis client).
      const fmt = (v: unknown) => (typeof v === 'boolean' ? yesNo(v) : v == null || v === '' ? L('assistant.card.empty') : String(v))
      const set = (k: string, v: unknown, old: unknown) => L(k, { value: before(fmt(v), fmt(old)) })
      const me = a.profile || a.company ? (await get('/api/me')).body : null
      if (a.profile && Object.values(a.profile).some((v) => v !== undefined)) {
        ops.push({ method: 'PATCH', path: '/api/me', body: a.profile })
        lines.push(L('assistant.card.profile', { value: [a.profile.name !== undefined && set('assistant.card.set.name', a.profile.name, me?.user?.name),
          a.profile.color && set('assistant.card.set.color', a.profile.color, me?.user?.color)].filter(Boolean).join(', ') }))
      }
      if (a.company && Object.values(a.company).some((v) => v !== undefined)) {
        const acc = me?.account ?? {}
        ops.push({ method: 'PATCH', path: '/api/account', body: a.company })
        lines.push(L('assistant.card.company', { value: [a.company.name !== undefined && set('assistant.card.set.name', a.company.name, acc.name),
          a.company.timezone && set('assistant.card.set.timezone', a.company.timezone, acc.timezone), a.company.currency && set('assistant.card.set.currency', a.company.currency, acc.currency),
          a.company.week_hours !== undefined && set('assistant.card.set.weekHours', a.company.week_hours, acc.week_hours),
          a.company.locale && L('assistant.card.set.docLocale', { value: before(L(LANG_K[a.company.locale]), LANG_K[acc.locale] ? L(LANG_K[acc.locale]) : '—') })].filter(Boolean).join(', ') }))
      }
      if (a.billing && Object.values(a.billing).some((v) => v !== undefined)) {
        const r = await get('/api/integrations')
        const cur: any = r.status === 200 ? r.body : {}
        ops.push({ method: 'PATCH', path: '/api/integrations/settings', body: a.billing })
        lines.push(L('assistant.card.billingSettings', { value: [a.billing.monthly_billing_auto !== undefined && set('assistant.card.set.auto', a.billing.monthly_billing_auto, cur.monthly_billing_auto),
          a.billing.monthly_billing_day !== undefined && set('assistant.card.set.day', a.billing.monthly_billing_day, cur.monthly_billing_day),
          a.billing.invoice_language && L('assistant.card.set.invoiceLanguage', { value: before(L(LANG_K[a.billing.invoice_language]), LANG_K[cur.invoice_language] ? L(LANG_K[cur.invoice_language]) : '—') }),
          a.billing.client_update_signature !== undefined && set('assistant.card.set.signature', a.billing.client_update_signature, clip(cur.client_update_signature, 200))].filter(Boolean).join(', ') }))
      }
      if (a.mailbox && (a.mailbox.display_name !== undefined || a.mailbox.is_default !== undefined)) {
        const r = await get('/api/mail/mailboxes')
        const mb = r.status === 200 ? r.body.mailboxes.find((m: any) => m.id === a.mailbox.id) : null
        if (!mb) return { error: 'mailbox_not_found' }
        const { id, ...rest } = a.mailbox
        ops.push({ method: 'PATCH', path: `/api/mail/mailboxes/${id}`, body: rest })
        lines.push(L('assistant.card.mailbox', { email: mb.email, value: [rest.display_name !== undefined && L('assistant.card.set.displayName', { value: before(rest.display_name, mb.display_name ?? '') }),
          rest.is_default !== undefined && L('assistant.card.set.isDefault', { value: before(yesNo(rest.is_default), yesNo(Boolean(mb.is_default))) })].filter(Boolean).join(', ') }))
      }
      if (!ops.length) return { error: 'nothing_to_change' }
      return { title: L('assistant.card.title.settings'), ops, lines,
        open: a.company || a.billing ? '/reglages/entreprise' : a.mailbox ? '/reglages/emails' : '/reglages/profil' }
    },
  })

  const day = z.string().regex(/^[1-7]$/, 'jour 1 (lundi) à 7 (dimanche)')
  write({
    name: 'propose_booking_page', batch: true,
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
      let bt: any = null
      if (booking_page_id) {
        const r = await get('/api/booking')
        bt = r.status === 200 ? r.body.find((x: any) => x.id === booking_page_id) : null
        if (!bt) return { error: 'booking_page_not_found' }
        if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      } else if (!a.slug || !a.name) return { error: 'slug_and_name_required' }
      let pName: string | null = null
      if (a.project_id) { const p = await project(a.project_id); if (!p) return { error: 'project_not_found' }; pName = p.name }
      const oldProject = bt?.project_id ? (await project(bt.project_id))?.name ?? null : null
      // Création : chaque champ ; modification : chaque champ « avant → après » (B7).
      const none = L('assistant.card.none'), empty = L('assistant.card.empty')
      const v = (value: unknown, old: unknown) => (bt ? before(value, old ?? none) : value)
      const avail = (x: any) => (x && Object.keys(x).length ? Object.entries(x).map(([d, r]: [string, any]) =>
        `${L(DAY_K[Number(d) - 1])} ${(r as string[][]).map((x) => x.join('-')).join(', ')}`).join(' ; ') : none)
      const lines: Line[] = [a.name && L('assistant.card.name', { value: v(a.name, bt?.name) }),
        a.slug && L('assistant.card.url', { value: v(`/rdv/${a.slug}`, bt && `/rdv/${bt.slug}`) }),
        a.description !== undefined && L('assistant.card.description', { text: v(a.description || empty, clip(bt?.description, 200) || empty) }),
        a.duration_minutes && L('assistant.card.durationMin', { n: v(a.duration_minutes, bt?.duration_minutes) }),
        a.buffer_minutes !== undefined && L('assistant.card.buffer', { n: v(a.buffer_minutes, bt?.buffer_minutes) }),
        a.min_notice_hours !== undefined && L('assistant.card.minNotice', { n: v(a.min_notice_hours, bt?.min_notice_hours) }),
        a.max_days_ahead !== undefined && L('assistant.card.maxAhead', { n: v(a.max_days_ahead, bt?.max_days_ahead) }),
        a.location !== undefined && L('assistant.card.location', { value: v(a.location || empty, bt?.location || empty) }),
        a.host_ids && L('assistant.card.hosts', { names: v((await peopleNames(a.host_ids)) || none, (await peopleNames(bt?.host_ids)) || none) }),
        a.availability && L('assistant.card.availability', { value: v(avail(a.availability), avail(bt?.availability)) }),
        a.create_project !== undefined && L('assistant.card.createsProject', { value: v(yesNo(a.create_project), yesNo(Boolean(bt?.create_project))) }),
        a.project_id !== undefined && L('assistant.card.project', { name: v(pName ?? none, oldProject ?? none) }),
        a.active !== undefined && L('assistant.card.active', { value: v(yesNo(a.active), yesNo(Boolean(bt?.active))) })]
      if (!bt) return { title: L('assistant.card.title.createBooking'), ops: [{ method: 'POST', path: '/api/booking', body: a }],
        lines: [...lines, L('assistant.card.publicBooking')], open: '/reglages/rendez-vous' }
      return { title: L('assistant.card.title.updateBooking'), ops: [{ method: 'PATCH', path: `/api/booking/${booking_page_id}`, body: a }],
        lines: [L('assistant.card.page', { name: bt.name }), ...lines], open: '/reglages/rendez-vous' }
    },
  })

  write({
    name: 'propose_intake_form', batch: true,
    description: 'Prépare un formulaire public de demande (responsables et administrateurs) : création (sans form_id : slug et nom) ou modification. Chaque demande reçue ouvre un projet « à qualifier » (depuis template_id s’il est donné) confié à owner_id.',
    schema: z.object({ form_id: UUID.optional(), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/).optional(), name: z.string().trim().min(1).max(120).optional(),
      intro: z.string().max(3000).optional(), template_id: UUID.nullable().optional(), owner_id: UUID.nullable().optional(), active: z.boolean().optional() }),
    build: async ({ form_id, ...a }) => {
      let tName: string | null = null
      if (a.template_id) {
        const t = await project(a.template_id)
        if (!t?.is_template) return { error: 'template_not_found' }
        // Chaque demande ouvrirait un projet visible de toute l'entreprise avec la structure d'un modèle réservé.
        if (t.visibility === 'members') return reservedCopy
        tName = t.name
      }
      if (a.owner_id && (await unknownPeople([a.owner_id])).length) return { error: 'unknown_person' }
      let f: any = null
      if (form_id) {
        const r = await get('/api/forms')
        f = r.status === 200 ? r.body.find((x: any) => x.id === form_id) : null
        if (!f) return { error: 'form_not_found' }
        if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      } else if (!a.slug || !a.name) return { error: 'slug_and_name_required' }
      const none = L('assistant.card.none'), empty = L('assistant.card.empty')
      const v = (value: unknown, old: unknown) => (f ? before(value, old ?? none) : value)
      // La création confie les demandes à la personne qui confirme si aucune n'est choisie (routes/work.ts).
      const owner = async (id: string | null | undefined) => (id ? await peopleNames([id]) : none)
      const lines: Line[] = [a.name && L('assistant.card.name', { value: v(a.name, f?.name) }),
        a.slug && L('assistant.card.url', { value: v(`/demande/${a.slug}`, f && `/demande/${f.slug}`) }),
        a.intro !== undefined && L('assistant.card.intro', { text: v(a.intro || empty, clip(f?.intro, 200) || empty) }),
        a.template_id !== undefined && L('assistant.card.formTemplate', { name: v(tName ?? none, f?.template_name ?? none) }),
        (f ? a.owner_id !== undefined : true) && L('assistant.card.owner', { names: v(await owner(f ? a.owner_id : a.owner_id ?? s.ctx.userId), await owner(f?.owner_id)) }),
        a.active !== undefined && L('assistant.card.formActive', { value: v(yesNo(a.active), yesNo(Boolean(f?.active))) })]
      if (!f) return { title: L('assistant.card.title.createForm'), ops: [{ method: 'POST', path: '/api/forms', body: a }], lines: [...lines, L('assistant.card.publicForm')],
        open: '/reglages/formulaires' }
      return { title: L('assistant.card.title.updateForm'), ops: [{ method: 'PATCH', path: `/api/forms/${form_id}`, body: a }],
        lines: [L('assistant.card.form', { name: f.name }), ...lines], open: '/reglages/formulaires' }
    },
  })

  write({
    name: 'propose_automation', batch: true,
    description: 'Prépare une automatisation « quand … alors … » (responsables et administrateurs) : création (sans automation_id) ou modification. Déclencheurs : task_completed, task_moved, stage_completed, task_created, project_completed. Conditions (avec project_id) : column_id (tâche dans cette colonne), stage_id (de cette étape). Actions : notify (params.to: owner|members|assignees ou params.user_ids, params.message), assign (params.user_id), set_priority (params.priority), move_column (params.column_name), complete_stage, create_task (params.title, params.due_in_days). L’envoi automatique au client n’est pas permis à l’assistant.',
    schema: z.object({
      automation_id: UUID.optional(), name: z.string().trim().min(1).max(120).optional(), project_id: UUID.nullable().optional(),
      trigger: z.enum(['task_completed', 'task_moved', 'stage_completed', 'task_created', 'project_completed']).optional(),
      conditions: z.object({ column_id: UUID.optional(), stage_id: UUID.optional() }).strict().optional(),
      action: z.enum(['notify', 'assign', 'set_priority', 'move_column', 'complete_stage', 'create_task']).optional(),
      params: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional(),
    }),
    build: async ({ automation_id, ...a }) => {
      // Une modification : l'automatisation telle qu'elle est (jamais une qui écrit au client).
      let au: any = null
      if (automation_id) {
        const r = await get('/api/automations')
        au = r.status === 200 ? r.body.find((x: any) => x.id === automation_id) : null
        if (!au) return { error: 'automation_not_found' }
        if (au.action === 'send_client_update') return { error: 'forbidden_category', hint: 'automatisation qui écrit au client : à régler dans l’écran' }
        if (!Object.keys(a).length) return { error: 'nothing_to_change' }
      } else if (!a.name || !a.trigger || !a.action) return { error: 'name_trigger_action_required' }
      const projectId = a.project_id !== undefined ? a.project_id : au?.project_id ?? null
      const scope = projectId ? await project(projectId) : null
      if (projectId && !scope) return { error: 'project_not_found' }
      // Les conditions désignent une colonne ou une étape du projet de l'automatisation : dites par leur nom.
      const condText = (c: any) => {
        if (!c || (!c.column_id && !c.stage_id)) return L('assistant.card.autoAny')
        const col = c.column_id ? scope?.columns.find((x: any) => x.id === c.column_id) : null
        const st = c.stage_id ? scope?.stages.find((x: any) => x.id === c.stage_id) : null
        return [c.column_id && L('assistant.card.autoColumn', { name: col?.name ?? '?' }), c.stage_id && L('assistant.card.autoStage', { name: st?.name ?? '?' })].filter(Boolean).join(', ')
      }
      if (a.conditions && ((a.conditions.column_id && !scope?.columns.some((x: any) => x.id === a.conditions.column_id))
        || (a.conditions.stage_id && !scope?.stages.some((x: any) => x.id === a.conditions.stage_id)))) return { error: 'condition_not_in_project', hint: 'colonne ou étape du projet de l’automatisation (project_id)' }
      // « Alors … » : la même phrase que l'écran Réglages → Automatisations, dans la langue de la personne.
      const action: string = a.action ?? au?.action
      const p: Record<string, any> = a.params ?? (a.action ? {} : au?.params ?? {})
      const peopleOf = (x: Record<string, any>) => [...(Array.isArray(x.user_ids) ? x.user_ids : []), ...(typeof x.user_id === 'string' ? [x.user_id] : [])]
      const people = peopleOf(p)
      if (people.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) || (await unknownPeople(people)).length) return { error: 'unknown_person', hint: 'ids de list_team, personnes actives' }
      const thenOf = async (act: string, x: Record<string, any>) => {
        const who = peopleOf(x)
        if (act === 'notify') return L('assistant.card.autoThen.notify', { to: x.to && AUTO_TO_K[x.to] ? L(AUTO_TO_K[x.to])
          : who.length ? await peopleNames(who) : L('assistant.card.autoTo.team') })
        if (act === 'assign') return L('assistant.card.autoThen.assign', { name: (await peopleNames(who)) || '…' })
        if (act === 'set_priority') return L('assistant.card.autoThen.setPriority', { priority: PRIORITY_K[x.priority] ? L(PRIORITY_K[x.priority]).toLowerCase() : '…' })
        if (act === 'move_column') return L('assistant.card.autoThen.moveColumn', { name: x.column_name || '…' })
        if (act === 'create_task') return L('assistant.card.autoThen.createTask', { title: x.title || '…' })
          + (x.due_in_days != null ? L('assistant.card.autoThen.createTaskDue', { n: x.due_in_days }) : '')
        return ACTION_K[act] ? L(ACTION_K[act]) : act
      }
      // Création : chaque champ ; modification : chaque champ « avant → après » (B7).
      const v = (value: unknown, old: unknown) => (au ? before(value, old ?? '—') : value)
      const all = L('assistant.card.allProjects')
      const message = action === 'notify' && typeof p.message === 'string' ? p.message : ''
      const oldMessage = au?.action === 'notify' && typeof au.params?.message === 'string' ? au.params.message : ''
      const lines: Line[] = [a.name && L('assistant.card.name', { value: v(a.name, au?.name) }),
        a.trigger && L('assistant.card.when', { value: v(L(TRIGGER_K[a.trigger]), TRIGGER_K[au?.trigger] ? L(TRIGGER_K[au.trigger]) : null) }),
        a.conditions !== undefined && L('assistant.card.autoOnly', { value: v(condText(a.conditions), condText(au?.conditions)) }),
        (a.action || a.params) && L('assistant.card.then', { value: v(await thenOf(action, p), au ? await thenOf(au.action, au.params ?? {}) : null) }),
        (a.action || a.params) && (message || oldMessage) && L('assistant.card.autoMessage', { text: v(message || L('assistant.card.empty'), clip(oldMessage, 200) || L('assistant.card.empty')) }),
        a.project_id !== undefined && L('assistant.card.project', { name: v(scope?.name ?? all, au?.project_name ?? all) }),
        a.active !== undefined && L('assistant.card.active', { value: v(yesNo(a.active), yesNo(Boolean(au?.active))) })]
      if (!au) return { title: L('assistant.card.title.createAutomation'), ops: [{ method: 'POST', path: '/api/automations', body: a }], lines, open: '/reglages/automatisations' }
      return { title: L('assistant.card.title.updateAutomation'), ops: [{ method: 'PATCH', path: `/api/automations/${automation_id}`, body: a }],
        lines: [L('assistant.card.automation', { name: au.name }), ...lines], open: '/reglages/automatisations' }
    },
  })

  // ---------------------------------------------------- seules sur leur carte (une autre application ou un fournisseur)
  write({
    name: 'propose_email_to_project', batch: false,
    description: 'Prépare l’ouverture d’un projet à partir d’un email reçu (message_id lu avec list_emails) : client retrouvé ou créé, projet (depuis un modèle si template_id), première tâche « Répondre à … ».',
    schema: z.object({ message_id: UUID, name: z.string().trim().min(1).max(200).optional(), client_id: UUID.optional(), client_name: z.string().trim().max(200).optional(),
      template_id: UUID.optional(), status: z.enum(['lead', 'planned', 'active']).default('lead'), first_task: z.boolean().default(true) }),
    build: async ({ message_id, ...a }) => {
      const m = await inboxMessage(message_id)
      if (!m) return { error: 'message_not_found' }
      // Le modèle : un vrai modèle, jamais un projet ou modèle réservé aux intervenants (sa copie serait visible de toute
      // l'entreprise, comme propose_create_project), et nommé sur la carte avec ce qu'il recopie (relecture du 29.10).
      let template: string | null = null
      if (a.template_id) {
        const t = await project(a.template_id)
        if (!t || !t.is_template) return { error: 'template_not_found' }
        if (t.visibility === 'members') return reservedCopy
        template = t.name
      }
      let chosen: string | null = null
      if (a.client_id) { const c = await client(a.client_id); if (!c) return { error: 'client_not_found' }; chosen = c.name }
      return { title: L('assistant.card.title.emailToProject'), mode: 'route', ops: [{ method: 'POST', path: `/api/mail/messages/${message_id}/project`, body: a, ref: 'project' }],
        lines: [emailLine(m), L('assistant.card.newProjectStatus', { name: a.name || m.subject || L('assistant.card.request'), status: L(STATUS_K[a.status]) }),
          template && L('assistant.card.fromTemplate', { name: template }),
          chosen ? L('assistant.card.client', { name: chosen }) : m.known_client ? L('assistant.card.client', { name: m.known_client.name })
            : L('assistant.card.clientFromSender', { name: a.client_name ?? m.from_name ?? m.from_email }),
          a.first_task && L('assistant.card.firstTask')],
        open: '/projets/@project' }
    },
  })

  write({
    name: 'propose_link_email', batch: false,
    description: 'Prépare le rattachement d’un email reçu (message_id) à un projet existant, éventuellement en créant une tâche avec son contenu (as_task).',
    schema: z.object({ message_id: UUID, project_id: UUID, as_task: z.boolean().default(false) }),
    build: async ({ message_id, project_id, as_task }) => {
      const [m, p] = await Promise.all([inboxMessage(message_id), project(project_id)])
      if (!m) return { error: 'message_not_found' }
      if (!p) return { error: 'project_not_found' }
      return { title: L('assistant.card.title.linkEmail'), mode: 'route', ops: [{ method: 'POST', path: `/api/mail/messages/${message_id}/link`, body: { project_id, as_task } }],
        lines: [emailLine(m), L('assistant.card.project', { name: p.name }), as_task && L('assistant.card.asTask')],
        open: `/projets/${project_id}/emails` }
    },
  })

  write({
    name: 'propose_import_client', batch: false,
    description: 'Prépare la reprise d’un client depuis une application Lead reliée : source crmlead + external_id (id d’un lead lu avec search_lead_apps) ; crmlead + client_id (mettre à jour un client déjà repris) ; invoicelead + external_id (id d’un contact InvoiceLead). Avec les droits de la personne dans l’autre application.',
    schema: z.object({ source: z.enum(['crmlead', 'invoicelead']), external_id: z.string().min(1).max(100).optional(), client_id: UUID.optional(), q: z.string().max(100).optional() }),
    build: async (a) => {
      if (a.source === 'crmlead' && a.client_id) {
        const c = await client(a.client_id)
        if (!c) return { error: 'client_not_found' }
        if (!String(c.external_ref ?? '').startsWith('crmlead:')) return { error: 'not_from_crmlead' }
        return { title: L('assistant.card.title.refreshCrm'), mode: 'route', ops: [{ method: 'POST', path: `/api/clients/${a.client_id}/crmlead/refresh`, body: {} }],
          lines: [L('assistant.card.clientName', { name: c.name }), L('assistant.card.crmReread')], open: `/clients/${a.client_id}` }
      }
      if (!a.external_id) return { error: 'external_id_required' }
      if (a.source === 'crmlead') return { title: L('assistant.card.title.importCrm'), mode: 'route',
        ops: [{ method: 'POST', path: '/api/clients/crmlead/import', body: { leadId: a.external_id }, ref: 'client' }],
        lines: [L('assistant.card.crmLead', { id: a.external_id }), L('assistant.card.crmImport')], open: '/clients/@client' }
      return { title: L('assistant.card.title.importInvoice'), mode: 'route',
        ops: [{ method: 'POST', path: '/api/clients/invoicelead/import', body: { contactId: a.external_id, ...(a.q ? { q: a.q } : {}) }, ref: 'client' }],
        lines: [L('assistant.card.ilContact', { id: a.external_id }), L('assistant.card.ilImport')], open: '/clients/@client' }
    },
  })

  write({
    name: 'propose_monthly_billing', batch: false,
    description: 'Prépare la création des BROUILLONS de facture du mois dans InvoiceLead (responsables et administrateurs), pour la période AAAA-MM (en général le mois passé) et éventuellement certains projets. Rien n’est émis ni envoyé au client.',
    schema: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), project_ids: z.array(UUID).max(500).optional() }),
    build: async ({ period, project_ids }) => {
      if (s.ctx.role === 'member') return { error: 'forbidden', hint: 'responsables et administrateurs' }
      const r = await get(`/api/integrations/billing/preview?period=${period}`)
      if (r.status !== 200) return { error: r.body?.error ?? 'preview_unavailable' }
      const list = r.body.projects.filter((x: any) => !project_ids || project_ids.includes(x.project.id))
      const fresh = list.filter((x: any) => !x.existing)
      return { title: L('assistant.card.title.billing', { period }), mode: 'route',
        ops: [{ method: 'POST', path: '/api/integrations/billing/run', body: { period, ...(project_ids ? { project_ids } : {}) } }],
        lines: [L('assistant.card.drafts', { n: fresh.length, done: list.length - fresh.length }),
          // Chaque brouillon et son montant, tous : aucun caché sous « + N autres ».
          ...fresh.map((x: any) => `${x.project.name}${x.client ? ` (${x.client.name})` : ''} : ${money(x.total_cents, x.project.currency ?? 'CHF')}`),
          L('assistant.card.draftsOnly')],
        open: '/facturation' }
    },
  })

  write({
    name: 'propose_sync_now', batch: false,
    description: 'Prépare une synchronisation immédiate d’une boîte mail branchée (kind mailbox) ou d’un agenda extérieur (kind calendar_feed) ; id lu avec list_settings.',
    schema: z.object({ kind: z.enum(['mailbox', 'calendar_feed']), id: UUID }),
    build: async ({ kind, id }) => {
      if (kind === 'mailbox') {
        const r = await get('/api/mail/mailboxes')
        const mb = r.status === 200 ? r.body.mailboxes.find((m: any) => m.id === id) : null
        if (!mb) return { error: 'mailbox_not_found' }
        return { title: L('assistant.card.title.syncMailbox'), mode: 'route', ops: [{ method: 'POST', path: `/api/mail/mailboxes/${id}/sync`, body: {} }],
          lines: [L('assistant.card.box', { email: mb.email }), L('assistant.card.newEmails')], open: '/emails' }
      }
      const r = await get('/api/calendar/feeds')
      const f = r.status === 200 ? r.body.find((x: any) => x.id === id) : null
      if (!f) return { error: 'feed_not_found' }
      return { title: L('assistant.card.title.syncFeed'), mode: 'route', ops: [{ method: 'POST', path: `/api/calendar/feeds/${id}/sync`, body: {} }],
        lines: [L('assistant.card.feed', { name: f.name }), L('assistant.card.feedReread')], open: '/agenda' }
    },
  })

  write({
    name: 'propose_set_language', batch: false,
    description: 'Prépare le changement de SA langue d’interface (fr, de, en, it, es), comme le sélecteur de langue de chaque page : la page passe dans cette langue après « Confirmer ».',
    schema: z.object({ locale: LOCALE }),
    build: async ({ locale }) => ({
      title: L('assistant.card.title.setLanguage'), mode: 'route', ops: [{ method: 'POST', path: '/api/me/locale', body: { locale } }],
      lines: [L('assistant.card.language', { value: L(LANG_K[locale]) })], open: null,
    }),
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
    name: 'propose_project_plan', batch: false,
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
      const joins = await joining(p, allPeople, p ? p.name : a.new_project.name)
      if ('error' in joins) return joins
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

      // La carte : un groupe par étape, sa description et sa note pour le client, puis TOUTES ses tâches avec dates,
      // estimation, dépendances, points de contrôle (leurs libellés), personnes, priorité, visibilité et description.
      const titleOf = new Map<string, string>(a.tasks.map((t: any) => [t.key, t.title]))
      const milestones = ordered.filter((t: any) => plan.tasks.get(t.key)!.milestone)
      const estimate = ordered.reduce((n: number, t: any) => n + (t.estimate_minutes ?? 0), 0)
      const taskLine = async (t: any) => {
        const d = plan.tasks.get(t.key)!
        return [`${d.milestone ? '◆ ' : ''}${t.title}`, d.milestone ? `${D(d.due)} ${L('assistant.card.plan.milestoneTag')}` : span(d.start, d.due),
          t.estimate_minutes ? hm(t.estimate_minutes) : null,
          t.after?.length ? L('assistant.card.plan.after', { list: t.after.map((k: string) => q(titleOf.get(k))).join(', ') }) : null,
          t.checklist?.length ? `${noun('assistant.noun.checklist', t.checklist.length)} (${t.checklist.join(', ')})` : null,
          t.assignee_ids?.length ? await peopleNames(t.assignee_ids) : null,
          t.priority ? L('assistant.card.plan.priorityTag', { value: L(PRIORITY_K[t.priority]) }) : null,
          t.visible_to_client ? L('assistant.card.plan.visibleTag') : null,
          t.description ? L('assistant.card.description', { text: t.description }) : null].filter(Boolean).join(' · ')
      }
      const n0 = p?.stages.length ?? 0
      const groups: SummaryGroup[] = []
      if (a.stages.length) {
        for (const [i, st] of a.stages.entries()) {
          const d = plan.stages.get(st.key)!
          const list = ordered.filter((t: any) => t.stage === st.key)
          const notes = [st.description && L('assistant.card.description', { text: st.description }),
            st.client_note && L('assistant.card.clientNote', { text: st.client_note })].filter((x): x is string => Boolean(x))
          groups.push({ title: `${n0 + i + 1}. ${st.name} · ${span(d.start, d.due)}`, ...(notes.length ? { notes } : {}),
            lines: list.length ? await Promise.all(list.map(taskLine)) : [L('assistant.card.plan.emptyStage')] })
        }
      } else {
        groups.push({ title: L('assistant.card.plan.tasksGroup'), lines: await Promise.all(ordered.map(taskLine)) })
      }
      // Une étape est visible par le client par défaut (page de suivi, suivis envoyés) : la carte dit lesquelles.
      const shown = a.stages.map((st: any, i: number) => ({ st, n: n0 + i + 1 })).filter(({ st }: any) => st.visible_to_client !== false)
      const visibleLine = a.stages.length && L('assistant.card.plan.clientVisible', { list: shown.length === a.stages.length ? L('assistant.card.plan.allStages')
        : shown.length ? shown.map(({ st, n }: any) => `${n}. ${st.name}`).join(', ') : L('assistant.card.noneF') })
      const name = p ? p.name : a.new_project.name
      const late = p?.due_date && plan.end > p.due_date.slice(0, 10)
      const counts = [a.stages.length && noun('assistant.noun.stage', a.stages.length),
        milestones.length ? L('assistant.card.plan.tasksWithMilestones', { tasks: noun('assistant.noun.task', ordered.length), n: milestones.length })
          : noun('assistant.noun.task', ordered.length),
        deps && noun('assistant.noun.dependency', deps), estimate && L('assistant.card.plan.estimated', { value: hm(estimate) })].filter(Boolean).join(', ')
      return {
        title: L(p ? 'assistant.card.title.plan' : 'assistant.card.title.createPlan', { name }),
        lines: [p ? L('assistant.card.project', { name }) : cl ? L('assistant.card.plan.newProjectClient', { name, client: cl }) : L('assistant.card.plan.newProject', { name }),
          L('assistant.card.plan.period', { start: D(plan.start), end: D(plan.end), n: workdaysBetween(plan.start, plan.end) }), counts, visibleLine, joins.line,
          p && (p.stages.length || p.tasks_total) && L('assistant.card.plan.existing', { stages: noun('assistant.noun.stage', p.stages.length), tasks: noun('assistant.noun.task', p.tasks_total) }),
          Object.keys(dates).length && L('assistant.card.plan.projectDates', { value: [dates.start_date && L('assistant.card.plan.startPart', { date: D(dates.start_date) }),
            dates.due_date && L('assistant.card.plan.endPart', { date: D(dates.due_date) })].filter(Boolean).join(', ') }),
          late && L('assistant.card.plan.late', { date: D(p.due_date) })],
        groups, ops, open: `/projets/${pid}/gantt`,
        links: [{ label: 'stages', path: `/projets/${pid}/etapes` }, { label: 'list', path: `/projets/${pid}/liste` }, { label: 'gantt', path: `/projets/${pid}/gantt` }],
        info: { plan: { start: plan.start, end: plan.end, stages: a.stages.map((st: any) => ({ name: st.name, start: plan.stages.get(st.key)!.start, due: plan.stages.get(st.key)!.due })),
          milestones: milestones.map((t: any) => ({ title: t.title, date: plan.tasks.get(t.key)!.due })), tasks: ordered.length, dependencies: deps } },
      }
    },
  })

  // ------------------------------------------------------------------ le lot : plusieurs changements, une carte
  const defs = new Map(W.map((d) => [d.name, d]))
  const batchTool = betaZodTool({
    name: 'propose_batch',
    description: 'Regroupe PLUSIEURS changements en UNE carte « À confirmer » (un clic, une transaction : tout ou rien, 150 écritures au plus). Chaque opération = { tool, input } où tool est un des outils propose_* regroupables et input exactement ce que cet outil prend. La carte montre chaque opération en entier. Pour les étapes, tâches, jalons et dépendances d’un plan de projet : propose_project_plan.',
    inputSchema: z.object({
      operations: z.array(z.object({ tool: z.enum(BATCHABLE), input: z.record(z.string(), z.unknown()) })).min(1).max(MAX_OPS),
    }),
    run: (a) => oneAtATime(async () => {
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
        // Chaque opération EN ENTIER (tout ce que montrerait sa carte seule) : une ligne, ses parties séparées par « · ».
        const list = byTitle.get(b.title) ?? []
        list.push(b.lines.filter((x): x is string => Boolean(x)).join(' · ') || b.title)
        byTitle.set(b.title, list)
        opens.add(b.open?.includes('@') ? null : b.open?.replace(/\?.*$/, '') ?? null)
      }
      // Toutes les opérations, aucune cachée sous « + N autres » ; le titre vient du serveur, jamais du modèle.
      const groups: SummaryGroup[] = [...byTitle].map(([title, lines]) => ({ title: lines.length > 1 ? `${title} (${lines.length})` : title, lines }))
      const n = a.operations.length
      const only = opens.size === 1 ? [...opens][0] : null
      return propose('propose_batch', {
        title: L('assistant.card.batch.title', { n }),
        lines: [L('assistant.card.batch.line', { n })], groups, ops, open: only,
      })
    }),
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
      description: "Les rendez-vous de l'agenda entre deux dates (ceux de la personne, ou toute l'entreprise si scope='all'), avec leur id et leurs participants (équipe : id et nom ; extérieurs : email).",
      inputSchema: z.object({ from: DATE, to: DATE, scope: z.enum(['mine', 'all']).default('mine') }),
      run: async (a) => {
        mark('list_events')
        const r = await get(`/api/calendar/events?from=${a.from}&to=${a.to}${a.scope === 'all' ? '&scope=all' : ''}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const list = Array.isArray(r.body) ? r.body : (r.body.events ?? [])
        return out(rows(list, (e: any) => ({ id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, location: e.location,
          project: e.project_name, client: e.client_name, organizer: e.organizer_name, external: Boolean(e.external),
          team: (e.attendees ?? []).filter((x: any) => x.user_id).map((x: any) => ({ id: x.user_id, name: x.name })),
          external_emails: (e.attendees ?? []).filter((x: any) => !x.user_id && x.email).map((x: any) => x.email) })))
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
        // Le modèle reçoit le NOM de l'écran, jamais le chemin (alignement des bulles, B5) : il l'annonce tel quel.
        const label = await labelOf(s.cookie, path, l)
        if (!s.actions.some((x) => x.type === 'navigate')) s.actions.push({ type: 'navigate', path, label })
        return out({ opened: label, note: 'Écran ouvert. Annonce-le en une courte phrase par ce nom, sans chemin ni adresse.' })
      },
    }),
  ]

  const writes = W.map((d) => betaZodTool({
    name: d.name, description: d.description, inputSchema: d.schema,
    run: (a: any) => oneAtATime(async () => { mark(d.name); return propose(d.name, await d.build(a)) }),
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
  'propose_import_client', 'propose_monthly_billing', 'propose_sync_now', 'propose_set_language', 'propose_project_plan', 'propose_batch'] as const
