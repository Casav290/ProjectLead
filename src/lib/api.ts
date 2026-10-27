/** Le navigateur ne parle jamais à la base : tout passe par l'API serveur (`/api`). */
import { t } from '../i18n'

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: any) { super(code) }
}

const inflight = new Map<string, Promise<unknown>>()

/** Une écriture identique déjà en route n'est pas relancée : un double clic ne crée pas deux fois. */
function req<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'
  if (method === 'GET') return send<T>(path, init)
  const key = `${method} ${path} ${typeof init?.body === 'string' ? init.body : ''}`
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const p = send<T>(path, init).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 && body.error === 'unauthenticated' && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('pl:unauthenticated'))
    }
    // La preuve de la personne a plus de 11 h (lecture de CRMlead ou d'InvoiceLead) : reconnexion silencieuse par le
    // Compte Lead, retour sur la même page avec l'état du dialogue (porté par l'adresse). Rien à l'écran.
    if (res.status === 401 && body.error === 'lead_reauth' && leadReauth()) return new Promise<T>(() => {})
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

/**
 * Repart par /auth/lead/start?prompt=none&next=<la page courante, avec sa recherche : l'état du dialogue y est>. Une fois
 * par minute au plus (garde contre une boucle si la reconnexion ne rapporte pas de preuve) : sinon, l'erreur s'affiche.
 */
export function leadReauth(): boolean {
  const KEY = 'pl:lead_reauth_at'
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* stockage refusé : on tente quand même, une fois par chargement */ if ((window as any).__plReauth) return false; (window as any).__plReauth = true }
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.assign(`/auth/lead/start?prompt=none&next=${encodeURIComponent(next)}`)
  return true
}

export const api = {
  get: <T,>(p: string) => req<T>(p),
  post: <T,>(p: string, body?: unknown) => req<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T,>(p: string, body: unknown) => req<T>(p, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T,>(p: string, body: unknown) => req<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T,>(p: string) => req<T>(p, { method: 'DELETE' }),
  upload: <T,>(p: string, form: FormData) => req<T>(p, { method: 'POST', body: form }),
}

/**
 * Les codes d'erreur de l'API, dits en clair : le texte est la clé `shell.err.<code>`, traduite au moment de l'affichage
 * (errorText est appelée au rendu, jamais au chargement du module).
 */
const MESSAGES = new Set([
  'invalid_credentials', 'email_taken', 'signup_via_lead', 'invitation_via_lead', 'plan_limit_projects',
  'plan_limit_seats', 'plan_limit_seats_full', 'invalid_input', 'forbidden', 'not_found', 'last_admin',
  'already_member', 'dependency_cycle', 'dependency_other_project', 'already_invoiced', 'no_recipient', 'slot_taken',
  'crmlead_not_used', 'invoicelead_not_used', 'crmlead_unreachable', 'invoicelead_unreachable', 'crmlead_error',
  'invoicelead_error', 'lead_required', 'lead_reauth', 'keys_retired', 'not_from_crmlead', 'client_missing',
  'calendar_url_invalid', 'servers_unknown', 'imap_auth_failed', 'smtp_auth_failed', 'imap_unreachable',
  'smtp_unreachable', 'conflict', 'last_column', 'invitation_invalid', 'url_not_allowed', 'already_subscribed',
  'plan_not_above', 'cannot_remove_self', 'use_remove_restore', 'billing_not_configured', 'no_customer',
  'stripe_error',
])
const APP_NAMES: Record<string, string> = { crmlead: 'CRMlead', invoicelead: 'InvoiceLead' }

/** Les refus d'une application sœur, avec ce qu'ils disent (application, administrateur, formule, nombres). */
export function linkErrorText(code: string, b: any = {}): string | null {
  const app = APP_NAMES[b?.app] ?? t('shell.err.link.thisApp')
  const admin = b?.admin ?? t('shell.err.link.anAdmin')
  switch (code) {
    case 'person_not_member':
      return b?.reason === 'no_seat' ? t('shell.err.link.noSeat', { app, admin })
        : b?.reason === 'disabled' ? t('shell.err.link.disabled', { app, admin })
          : t('shell.err.link.openOnce', { app })
    case 'person_proof':
      return t('shell.err.link.proof', { email: b?.email ? ` (${b.email})` : '', org: b?.person_org_name ?? t('shell.err.link.otherCompany'),
        company: b?.company ? t('shell.err.link.proofCompany', { company: b.company }) : '' })
    case 'person_not_allowed':
      return t('shell.err.link.notAllowed', { admin })
    case 'contact_limit': {
      const vars = { plan: b?.plan ? t('shell.err.link.contactPlan', { plan: b.plan }) : '', count: b?.count ?? b?.limit ?? '',
        project: b?.project ? t('shell.err.link.contactProject', { project: b.project }) : '' }
      return t(vars.count === '' ? 'shell.err.link.contactLimitMany' : 'shell.err.link.contactLimit', vars)
    }
    case 'already_issued':
      return b?.month ? t('shell.err.link.alreadyIssuedMonth', { month: b.month }) : t('shell.err.link.alreadyIssued')
  }
  return null
}

export const errorText = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : String((e as Error)?.message ?? e)
  const linked = linkErrorText(code, e instanceof ApiError ? e.body : {})
  if (linked) return linked
  // En Pro+, plus de formule au-dessus : on dit quoi faire plutôt que de renvoyer vers une mise à niveau.
  if (code === 'plan_limit_seats' && e instanceof ApiError && e.body?.plan === 'pro_plus') return t('shell.err.plan_limit_seats_full')
  return MESSAGES.has(code) ? t(`shell.err.${code}`) : t('common.error', { code })
}
