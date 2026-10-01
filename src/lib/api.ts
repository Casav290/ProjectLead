/** Le navigateur ne parle jamais à la base : tout passe par l'API serveur (`/api`). */

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
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

export const api = {
  get: <T,>(p: string) => req<T>(p),
  post: <T,>(p: string, body?: unknown) => req<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T,>(p: string, body: unknown) => req<T>(p, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T,>(p: string, body: unknown) => req<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T,>(p: string) => req<T>(p, { method: 'DELETE' }),
  upload: <T,>(p: string, form: FormData) => req<T>(p, { method: 'POST', body: form }),
}

/** Les codes d'erreur de l'API, dits en clair. */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email ou mot de passe incorrect.',
  email_taken: 'Cette adresse a déjà un compte.',
  invalid_input: 'Une valeur est refusée : vérifiez les champs.',
  forbidden: "Votre rôle ne permet pas cette action.",
  not_found: 'Introuvable, ou vous n\'y avez pas accès.',
  last_admin: "L'entreprise doit garder au moins un administrateur actif.",
  already_member: 'Cette personne fait déjà partie de l\'équipe.',
  dependency_cycle: 'Cette dépendance créerait une boucle.',
  dependency_other_project: 'Une dépendance doit rester dans le même projet.',
  already_invoiced: 'Ce temps est déjà facturé : il ne se modifie plus.',
  no_recipient: "Aucun destinataire : ajoutez l'email du client ou d'un contact.",
  slot_taken: 'Ce créneau vient d\'être pris. Choisissez-en un autre.',
  crmlead_not_configured: 'CRMlead n\'est pas branché (Réglages → Intégrations).',
  crmlead_key_invalid: 'La clé CRMlead est refusée.',
  crmlead_unreachable: 'CRMlead ne répond pas.',
  invoicelead_not_configured: 'InvoiceLead n\'est pas branché (Réglages → Intégrations).',
  invoicelead_key_invalid: 'La clé InvoiceLead est refusée.',
  invoicelead_forbidden: 'InvoiceLead refuse : la formule Pro+ est nécessaire pour l\'API.',
  invoicelead_unreachable: 'InvoiceLead ne répond pas.',
  app_secret_missing: 'Le serveur n\'a pas de secret de chiffrement (APP_SECRET).',
  calendar_url_invalid: "L'adresse de l'agenda doit commencer par https:// (ou webcal://).",
  servers_unknown: 'Messagerie non reconnue : indiquez les serveurs IMAP et SMTP.',
  imap_auth_failed: 'Identifiant ou mot de passe IMAP refusé.',
  smtp_auth_failed: 'Identifiant ou mot de passe SMTP refusé.',
  imap_unreachable: 'Serveur IMAP injoignable.',
  smtp_unreachable: 'Serveur SMTP injoignable.',
  conflict: 'Cet élément existe déjà.',
  last_column: 'Un tableau garde au moins une colonne.',
  invitation_invalid: 'Invitation expirée ou déjà utilisée.',
  url_not_allowed: 'Adresse refusée : https et serveur public uniquement.',
  key_required: 'La clé est obligatoire.',
}
export const errorText = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : String((e as Error)?.message ?? e)
  return MESSAGES[code] ?? `Erreur : ${code}`
}
