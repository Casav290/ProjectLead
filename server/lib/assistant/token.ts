import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Le jeton « Confirmer » d'une carte de l'Assistant IA. Il porte les écritures EXACTES à faire (méthode, route, corps :
 * les routes mêmes de l'écran) et le résumé montré à la personne, signé HMAC-SHA256 (clé dérivée d'APP_SECRET), lié à la
 * personne et à l'entreprise, valable 10 minutes, à usage unique (`nonce` noté dans `assistant_confirmations`).
 *
 * Une carte peut porter plusieurs écritures (un lot, un plan de projet) : `mode: 'tx'`, toutes dans UNE transaction
 * (tout ou rien, lib/assistant/run.ts). Une écriture qui appelle une autre application (CRMlead, InvoiceLead, boîte mail)
 * reste seule sur sa carte : `mode: 'route'`, la route telle quelle, sans transaction ouverte pendant ses appels.
 *
 * Références locales : une écriture qui crée quelque chose peut porter `ref` ; les suivantes citent « @ref » dans leur
 * chemin ou dans un champ d'identifiant (`project_id`, `stage_id`, `task_id`, `depends_on_id`, `parent_id`,
 * `column_id`). À l'exécution, « @ref » devient l'identifiant créé.
 */
export const CONFIRM_TTL_MS = 10 * 60_000
export const MAX_OPS = 150
export const MAX_TOKEN_CHARS = 250_000

export type Method = 'POST' | 'PATCH' | 'PUT'
export type WriteOp = { method: Method; path: string; body: Record<string, unknown>; ref?: string }
export type SummaryGroup = { title: string; lines: string[]; more?: number }
export type Summary = { title: string; lines: string[]; groups?: SummaryGroup[] }
export type Mode = 'tx' | 'route'
export type ConfirmPayload = {
  v: 2; u: string; a: string; exp: number; n: string
  mode: Mode; tool: string; ops: WriteOp[]; summary: Summary; open?: string | null
  links?: { label: string; path: string }[]
}

const key = () => {
  const s = process.env.APP_SECRET
  if (!s || s.length < 16) throw new Error('app_secret_missing')
  return createHmac('sha256', s).update('projectlead-assistant-confirm-v2').digest()
}

const mac = (data: string) => createHmac('sha256', key()).update(data).digest('base64url')

export function signConfirm(p: Omit<ConfirmPayload, 'v' | 'exp' | 'n'>, now = Date.now()): string {
  const full: ConfirmPayload = { v: 2, exp: now + CONFIRM_TTL_MS, n: randomBytes(16).toString('base64url'), ...p }
  const data = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${data}.${mac(data)}`
}

export type VerifyError = 'token_invalid' | 'token_expired' | 'token_other_user'

/** Vérifie signature, échéance et propriétaire. L'usage unique se joue en base, au moment d'exécuter. */
export function verifyConfirm(token: string, who: { userId: string; accountId: string }, now = Date.now()):
  { ok: true; payload: ConfirmPayload } | { ok: false; error: VerifyError } {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return { ok: false, error: 'token_invalid' }
  const [data, sig, extra] = token.split('.')
  if (!data || !sig || extra !== undefined) return { ok: false, error: 'token_invalid' }
  const expected = Buffer.from(mac(data))
  const got = Buffer.from(sig)
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, error: 'token_invalid' }
  let p: ConfirmPayload
  try { p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) } catch { return { ok: false, error: 'token_invalid' } }
  if (p?.v !== 2 || !p.n || !Array.isArray(p.ops) || !p.ops.length || p.ops.length > MAX_OPS || !['tx', 'route'].includes(p.mode)
    || (p.mode === 'route' && p.ops.length !== 1)) return { ok: false, error: 'token_invalid' }
  if (p.u !== who.userId || p.a !== who.accountId) return { ok: false, error: 'token_other_user' }
  if (!(p.exp > now)) return { ok: false, error: 'token_expired' }
  return { ok: true, payload: p }
}

// ------------------------------------------------------------------ la liste fermée des écritures

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export const REF = /^@[A-Za-z0-9_:.-]{1,48}$/
/** Les champs du corps qui peuvent citer une référence locale « @ref ». */
export const REF_FIELDS = ['project_id', 'stage_id', 'task_id', 'depends_on_id', 'parent_id', 'column_id'] as const

type Rule = { method: Method; path: RegExp; mode: Mode; refuse?: (b: Record<string, any>) => string | null }
const r = (method: Method, path: string, mode: Mode, refuse?: Rule['refuse']): Rule =>
  ({ method, path: new RegExp(`^${path.replaceAll(':id', UUID)}$`), mode, refuse })
const has = (b: Record<string, any>, ...keys: string[]) => keys.find((k) => b[k] !== undefined) ?? null

/**
 * Les seules écritures qu'un jeton peut faire exécuter, même signé. Jamais : une suppression ou un archivage, l'équipe,
 * les membres ou le responsable d'un projet, la visibilité, l'abonnement, les clés d'API, un envoi vers l'extérieur
 * (email, suivi client, invitation, point partagé avec le client, automatisation qui écrit au client). Les refus par
 * champ (`refuse`) gardent ces interdits même sur une route permise.
 */
const RULES: Rule[] = [
  // tâches
  r('POST', '/api/tasks', 'tx'),
  r('PATCH', '/api/tasks/:id', 'tx'),
  r('POST', '/api/tasks/bulk', 'tx', (b) => (b.patch?.delete !== undefined ? 'supprimer' : null)),
  r('POST', '/api/tasks/:id/comments', 'tx'),
  r('PATCH', '/api/tasks/comments/:id', 'tx'),
  r('POST', '/api/tasks/:id/checklist', 'tx'),
  r('PATCH', '/api/tasks/checklist/:id', 'tx'),
  r('POST', '/api/tasks/:id/dependencies', 'tx'),
  // projets, étapes, colonnes, fichiers
  r('POST', '/api/projects', 'tx', (b) => has(b, 'visibility', 'owner_id', 'team_id', 'member_ids', 'portal_enabled', 'update_frequency')),
  r('PATCH', '/api/projects/:id', 'tx', (b) => has(b, 'visibility', 'owner_id', 'team_id', 'portal_enabled', 'update_frequency', 'is_template')),
  r('POST', '/api/projects/:id/duplicate', 'tx'),
  r('POST', '/api/projects/:id/comments', 'tx'),
  r('POST', '/api/projects/:id/updates', 'tx', (b) => (b.share_with_client === true ? 'share_with_client' : null)),
  r('POST', '/api/projects/:id/stages', 'tx'),
  r('PATCH', '/api/projects/stages/:id', 'tx', (b) => has(b, 'notify_client')),
  r('POST', '/api/projects/:id/stages/order', 'tx'),
  r('POST', '/api/projects/:id/columns', 'tx'),
  r('PATCH', '/api/projects/columns/:id', 'tx'),
  r('POST', '/api/projects/:id/columns/order', 'tx'),
  r('PATCH', '/api/projects/files/:id', 'tx'),
  // temps
  r('POST', '/api/time/entries', 'tx'),
  r('PATCH', '/api/time/entries/:id', 'tx'),
  r('PUT', '/api/time/week/cell', 'tx', (b) => (!(Number(b.minutes) >= 1) ? 'minutes_zero' : null)),
  r('POST', '/api/time/timer/start', 'tx'),
  r('POST', '/api/time/timer/stop', 'tx'),
  // clients
  r('POST', '/api/clients', 'tx'),
  r('PATCH', '/api/clients/:id', 'tx', (b) => has(b, 'archived')),
  r('POST', '/api/clients/:id/contacts', 'tx'),
  r('PATCH', '/api/clients/contacts/:id', 'tx'),
  // agenda, emails, notifications
  r('POST', '/api/calendar/events', 'tx', (b) => (b.send_invites === true ? 'send_invites' : null)),
  r('PATCH', '/api/calendar/events/:id', 'tx', (b) => (b.send_invites === true ? 'send_invites' : null)),
  r('POST', '/api/mail/messages/:id/status', 'tx'),
  r('POST', '/api/notifications/read', 'tx'),
  // réglages
  r('PATCH', '/api/me', 'tx'),
  r('PATCH', '/api/account', 'tx'),
  r('PATCH', '/api/integrations/settings', 'tx'),
  r('PATCH', '/api/mail/mailboxes/:id', 'tx', (b) => has(b, 'shared')),
  r('POST', '/api/booking', 'tx'),
  r('PATCH', '/api/booking/:id', 'tx'),
  r('POST', '/api/forms', 'tx'),
  r('PATCH', '/api/forms/:id', 'tx'),
  r('POST', '/api/automations', 'tx', (b) => (b.action === 'send_client_update' ? 'send_client_update' : null)),
  r('PATCH', '/api/automations/:id', 'tx', (b) => (b.action === 'send_client_update' ? 'send_client_update' : null)),
  // seules sur leur carte : elles lisent ou écrivent chez une autre application
  r('POST', '/api/mail/messages/:id/project', 'route'),
  r('POST', '/api/mail/messages/:id/link', 'route'),
  r('POST', '/api/clients/crmlead/import', 'route'),
  r('POST', '/api/clients/:id/crmlead/refresh', 'route'),
  r('POST', '/api/clients/invoicelead/import', 'route'),
  r('POST', '/api/integrations/billing/run', 'route'),
  r('POST', '/api/mail/mailboxes/:id/sync', 'route'),
  r('POST', '/api/calendar/feeds/:id/sync', 'route'),
]

const DUMMY = '00000000-0000-4000-8000-000000000000'

/** La règle d'une écriture dont les références sont déjà remplacées par de vrais identifiants. */
export function ruleFor(op: Pick<WriteOp, 'method' | 'path'>): Rule | null {
  return RULES.find((x) => x.method === op.method && x.path.test(op.path)) ?? null
}

/** Permise, dans ce mode, sans champ interdit. Une référence « @ref » compte comme un identifiant (proposition). */
export function opAllowed(op: WriteOp, mode: Mode = 'tx'): boolean {
  if (!op || typeof op.path !== 'string' || typeof op.body !== 'object' || op.body === null || Array.isArray(op.body)) return false
  const path = op.path.split('/').map((seg) => (REF.test(seg) ? DUMMY : seg)).join('/')
  const rule = ruleFor({ method: op.method, path })
  if (!rule || rule.mode !== mode) return false
  return !rule.refuse?.(op.body)
}

/** Le nom court d'une écriture pour le journal (sans identifiant). */
export const opLabel = (op: Pick<WriteOp, 'method' | 'path'>) =>
  `${op.method} ${op.path.replace(new RegExp(UUID, 'g'), ':id').replace(/@[A-Za-z0-9_:.-]+/g, ':id')}`
