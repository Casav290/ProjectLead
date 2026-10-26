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

/** Les codes d'erreur de l'API, dits en clair. */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email ou mot de passe incorrect.',
  email_taken: 'Cette adresse a déjà un compte.',
  signup_via_lead: "L'inscription se fait avec le Compte Lead.",
  invitation_via_lead: "Acceptez l'invitation avec votre Compte Lead.",
  plan_limit_projects: 'La formule gratuite mène 3 projets en cours à la fois : terminez ou archivez un projet. Pour davantage, un administrateur peut passer à Pro (Réglages → Entreprise).',
  plan_limit_seats: 'Toutes les places de la formule sont prises. Pour une personne de plus, un administrateur peut passer à Pro+, jusqu\'à 5 personnes (Réglages → Entreprise).',
  plan_limit_seats_full: 'Les 5 places de Pro+ sont prises : retirez une personne ou une invitation en attente pour en inviter une autre.',
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
  crmlead_not_used: "Votre entreprise n'utilise pas encore CRMlead.",
  invoicelead_not_used: "Votre entreprise n'utilise pas encore InvoiceLead.",
  crmlead_unreachable: 'CRMlead ne répond pas. Réessayez dans un instant.',
  invoicelead_unreachable: 'InvoiceLead ne répond pas. Réessayez dans un instant.',
  crmlead_error: 'CRMlead a refusé la demande. Réessayez dans un instant.',
  invoicelead_error: 'InvoiceLead a refusé la demande. Réessayez dans un instant.',
  lead_required: 'Connectez-vous une fois avec votre Compte Lead pour relier vos applications.',
  lead_reauth: 'Votre connexion au Compte Lead est à renouveler : rechargez la page.',
  keys_retired: 'Les applications Lead se relient toutes seules : plus rien à coller (Réglages → Applications Lead).',
  not_from_crmlead: "Ce client n'a pas été repris de CRMlead.",
  client_missing: 'Le projet n\'a pas de client : choisissez-en un pour le facturer.',
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
  already_subscribed: "Vous avez déjà un abonnement ProjectLead : changez de formule dans « Gérer l'abonnement ».",
  plan_not_above: 'Votre entreprise a déjà cette formule ou une formule supérieure : rien à payer.',
  cannot_remove_self: 'Vous ne pouvez pas vous retirer vous-même : un autre administrateur peut le faire.',
  use_remove_restore: 'La place d\'une personne se règle avec « Retirer » ou « Rétablir », dans la liste des places (Réglages → Équipe).',
  billing_not_configured: "Le paiement en ligne n'est pas encore ouvert.",
  no_customer: "Aucun abonnement ProjectLead à gérer pour l'instant.",
  stripe_error: "Le paiement n'a pas pu s'ouvrir. Réessayez dans un instant.",
}
const APP_NAMES: Record<string, string> = { crmlead: 'CRMlead', invoicelead: 'InvoiceLead' }

/** Les refus d'une application sœur, avec ce qu'ils disent (application, administrateur, formule, nombres). */
export function linkErrorText(code: string, b: any = {}): string | null {
  const app = APP_NAMES[b?.app] ?? 'cette application'
  switch (code) {
    case 'person_not_member':
      return b?.reason === 'no_seat'
        ? `Vous n'avez pas de place dans ${app} (formule de ${app}). Demandez à ${b?.admin ?? 'un administrateur'}, ou reprenez ce client à la main.`
        : b?.reason === 'disabled'
          ? `Votre accès à ${app} est désactivé. Demandez à ${b?.admin ?? 'un administrateur'}.`
          : `Ouvrez ${app} une fois avec votre Compte Lead pour y accéder depuis ProjectLead.`
    case 'person_proof':
      return `Votre Compte Lead${b?.email ? ` (${b.email})` : ''} appartient à ${b?.person_org_name ?? 'une autre entreprise'}${b?.company ? `, pas à ${b.company}` : ''}.`
    case 'person_not_allowed':
      return `Vous n'avez pas le droit de facturer dans InvoiceLead : demandez à ${b?.admin ?? 'un administrateur'}.`
    case 'contact_limit':
      return `InvoiceLead${b?.plan ? ` (formule ${b.plan})` : ''} a déjà ${b?.count ?? b?.limit ?? 'trop de'} clients : le brouillon${b?.project ? ` de ${b.project}` : ''} n'a pas été créé. Archivez un client dans InvoiceLead ou changez de formule dans InvoiceLead, puis relancez.`
    case 'already_issued':
      return `Une facture${b?.month ? ` de ${b.month}` : ' de ce mois'} est déjà émise dans InvoiceLead pour ce projet.`
  }
  return null
}

export const errorText = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : String((e as Error)?.message ?? e)
  const linked = linkErrorText(code, e instanceof ApiError ? e.body : {})
  if (linked) return linked
  // En Pro+, plus de formule au-dessus : on dit quoi faire plutôt que de renvoyer vers une mise à niveau.
  if (code === 'plan_limit_seats' && e instanceof ApiError && e.body?.plan === 'pro_plus') return MESSAGES.plan_limit_seats_full
  return MESSAGES[code] ?? `Erreur : ${code}`
}
