import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Le jeton « Confirmer » d'une écriture proposée par l'assistant. Il porte l'opération exacte (méthode, route, corps)
 * et le résumé montré à la personne, signé HMAC-SHA256 (clé dérivée d'APP_SECRET), lié à la personne et à l'entreprise,
 * valable 10 minutes, à usage unique (`nonce` noté dans `assistant_confirmations` à l'usage).
 */
export const CONFIRM_TTL_MS = 10 * 60_000

export type WriteOp = { method: 'POST' | 'PATCH'; path: string; body: Record<string, unknown> }
export type ConfirmPayload = {
  v: 1; u: string; a: string; exp: number; n: string
  op: WriteOp; summary: { title: string; lines: string[] }; open?: string | null
}

const key = () => {
  const s = process.env.APP_SECRET
  if (!s || s.length < 16) throw new Error('app_secret_missing')
  return createHmac('sha256', s).update('projectlead-assistant-confirm-v1').digest()
}

const mac = (data: string) => createHmac('sha256', key()).update(data).digest('base64url')

export function signConfirm(p: Omit<ConfirmPayload, 'v' | 'exp' | 'n'>, now = Date.now()): string {
  const full: ConfirmPayload = { v: 1, exp: now + CONFIRM_TTL_MS, n: randomBytes(16).toString('base64url'), ...p }
  const data = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${data}.${mac(data)}`
}

export type VerifyError = 'token_invalid' | 'token_expired' | 'token_other_user'

/** Vérifie signature, échéance et propriétaire. L'usage unique se joue en base, au moment d'exécuter. */
export function verifyConfirm(token: string, who: { userId: string; accountId: string }, now = Date.now()):
  { ok: true; payload: ConfirmPayload } | { ok: false; error: VerifyError } {
  if (typeof token !== 'string' || token.length > 20_000) return { ok: false, error: 'token_invalid' }
  const [data, sig] = token.split('.')
  if (!data || !sig) return { ok: false, error: 'token_invalid' }
  const expected = Buffer.from(mac(data))
  const got = Buffer.from(sig)
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, error: 'token_invalid' }
  let p: ConfirmPayload
  try { p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) } catch { return { ok: false, error: 'token_invalid' } }
  if (p?.v !== 1 || !p.op || !p.n) return { ok: false, error: 'token_invalid' }
  if (p.u !== who.userId || p.a !== who.accountId) return { ok: false, error: 'token_other_user' }
  if (!(p.exp > now)) return { ok: false, error: 'token_expired' }
  return { ok: true, payload: p }
}

/**
 * Les seules écritures qu'un jeton peut faire exécuter, même signé : jamais une suppression, ni l'équipe, ni les
 * membres d'un projet, ni l'abonnement, ni les clés d'API, ni un envoi (email, suivi client).
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ALLOWED: [WriteOp['method'], RegExp][] = [
  ['POST', /^\/api\/tasks$/],
  ['PATCH', new RegExp(`^/api/tasks/${UUID}$`)],
  ['POST', new RegExp(`^/api/tasks/${UUID}/comments$`)],
  ['POST', new RegExp(`^/api/tasks/${UUID}/checklist$`)],
  ['POST', /^\/api\/projects$/],
  ['PATCH', new RegExp(`^/api/projects/${UUID}$`)],
  ['POST', new RegExp(`^/api/projects/${UUID}/updates$`)],
  ['POST', /^\/api\/time\/entries$/],
  ['POST', /^\/api\/time\/timer\/(start|stop)$/],
  ['POST', /^\/api\/clients$/],
]
export const opAllowed = (op: WriteOp) => ALLOWED.some(([m, re]) => m === op.method && re.test(op.path))
