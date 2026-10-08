/**
 * Kit « compte Lead » pour les applications de la famille (Scanlead, ProjectLead, InvoiceLead…).
 *
 * Un seul fichier, aucune dépendance : Node 18 ou plus (fetch et crypto intégrés). À copier tel
 * quel dans le serveur de l'application (ex. `server/leadId.ts`). Mode d'emploi : LEAD-ID.md.
 *
 * Variables d'environnement attendues :
 *   LEAD_ID_ISSUER         https://erplead.io
 *   LEAD_ID_CLIENT_ID      scanlead
 *   LEAD_ID_CLIENT_SECRET  lid_…   (Réglages CRMlead → Mon compte Lead → Applications reliées)
 *   LEAD_ID_REDIRECT_URI   https://scanlead.io/auth/lead/callback
 *   LEAD_ID_APP            scanlead  (le code de l'application dans la famille)
 */
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} manquant`)
  return v
}
/**
 * L'émetteur des connexions. CRMlead ne l'est plus depuis le 08.10.2026 : ERPlead (erplead.io) a repris
 * les comptes avec les mêmes identifiants. Une fonction encore réglée sur crmlead.io passe donc sur
 * erplead.io sans qu'il faille réécrire toutes ses variables.
 */
const RETIRED_ISSUERS: Record<string, string> = { 'https://crmlead.io': 'https://erplead.io' }
const issuer = () => {
  const v = env('LEAD_ID_ISSUER').replace(/\/+$/, '')
  return RETIRED_ISSUERS[v] ?? v
}
const b64url = (b: Buffer) => b.toString('base64url')
const basic = () => 'Basic ' + Buffer.from(`${encodeURIComponent(env('LEAD_ID_CLIENT_ID'))}:${encodeURIComponent(env('LEAD_ID_CLIENT_SECRET'))}`).toString('base64')

// ------------------------------------------------------------------ types

/** Ce que le compte Lead dit d'une personne (jeton d'identité, ou /oauth/userinfo). */
export type LeadClaims = {
  sub: string                       // identifiant stable de la personne : c'est LUI qui rattache, pas l'email
  email: string; email_verified: boolean
  name: string; locale: string; zoneinfo: string
  org: string; org_name: string; org_role: 'admin' | 'manager' | 'user'
  lead: LeadEntitlements
}
export type LeadEntitlements = {
  plan: { code: 'free' | 'pro' | 'pro_plus' | string; name: string; rank: number; seats: number | null }
  apps: Record<string, { access: boolean; name: string; url: string | null; status: string; upgrade_url: string | null; [limit: string]: unknown }>
  subscriptions: { app: string; plan: string; lead_plan: string | null; status: string; current_period_end: string | null }[]
}
export type LoginStart = { url: string; state: string; nonce: string; verifier: string; maxAge?: number }
export type Tokens = { access_token: string; id_token: string; refresh_token?: string; expires_in: number; scope: string }

// ------------------------------------------------------------------ clés publiques

let jwksCache: { at: number; keys: any[] } | null = null
async function publicKey(kid: string) {
  const fresh = async () => {
    const r = await fetch(`${issuer()}/oauth/jwks`)
    if (!r.ok) throw new Error(`jwks ${r.status}`)
    jwksCache = { at: Date.now(), keys: (await r.json()).keys }
  }
  if (!jwksCache || Date.now() - jwksCache.at > 3_600_000) await fresh()
  let jwk = jwksCache!.keys.find((k) => k.kid === kid)
  // Clé inconnue : le compte Lead a peut-être tourné sa clé, on relit une fois.
  if (!jwk) { await fresh(); jwk = jwksCache!.keys.find((k) => k.kid === kid) }
  return jwk ? createPublicKey({ key: jwk, format: 'jwk' }) : null
}

/**
 * Vérifie un JWT du compte Lead : signature RS256, émetteur, audience, expiration.
 * Rend les revendications, ou `null`. Ne jamais lire un jeton sans passer par ici.
 */
export async function verifyLeadJwt(token: string, audience: string): Promise<Record<string, any> | null> {
  try {
    const [h, p, s] = token.split('.')
    const head = JSON.parse(Buffer.from(h, 'base64url').toString())
    if (head.alg !== 'RS256') return null
    const key = await publicKey(head.kid)
    if (!key || !verify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) return null
    const c = JSON.parse(Buffer.from(p, 'base64url').toString())
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
    if (c.iss !== issuer() || !aud.includes(audience) || typeof c.exp !== 'number' || c.exp * 1000 < Date.now() - 30_000) return null
    return c
  } catch { return null }
}

// ------------------------------------------------------------------ connexion

/**
 * Étape 1 : l'adresse où envoyer la personne. Garder `state`, `nonce` et `verifier` côté
 * serveur (cookie httpOnly signé ou session) jusqu'au retour : ils prouvent que le retour est le sien.
 */
export function startLogin(opts: { prompt?: 'none' | 'login'; locale?: string; maxAge?: number } = {}): LoginStart {
  const verifier = b64url(randomBytes(48))
  const state = b64url(randomBytes(24))
  const nonce = b64url(randomBytes(24))
  const q = new URLSearchParams({
    response_type: 'code', client_id: env('LEAD_ID_CLIENT_ID'), redirect_uri: env('LEAD_ID_REDIRECT_URI'),
    scope: 'openid email profile lead offline_access', state, nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  })
  // prompt=login : redemander le mot de passe (avant une action sensible). maxAge : exiger une
  // connexion de moins de N secondes ; `finishLogin` le vérifie sur `auth_time`.
  if (opts.prompt) q.set('prompt', opts.prompt)
  if (opts.maxAge != null) q.set('max_age', String(opts.maxAge))
  if (opts.locale) q.set('ui_locales', opts.locale)
  return { url: `${issuer()}/oauth/authorize?${q}`, state, nonce, verifier, ...(opts.maxAge != null ? { maxAge: opts.maxAge } : {}) }
}

/** Étape 2 : au retour, le code contre les jetons ; le jeton d'identité est vérifié ici. */
export async function finishLogin(query: { code?: string; state?: string; error?: string },
                                  saved: { state: string; nonce: string; verifier: string; maxAge?: number }) {
  if (query.error) throw new Error(`lead_id:${query.error}`)
  if (!query.code || !query.state || query.state !== saved.state) throw new Error('lead_id:state_mismatch')
  const tokens = await tokenRequest({
    grant_type: 'authorization_code', code: query.code,
    redirect_uri: env('LEAD_ID_REDIRECT_URI'), code_verifier: saved.verifier,
  })
  const claims = await verifyLeadJwt(tokens.id_token, env('LEAD_ID_CLIENT_ID'))
  if (!claims || claims.nonce !== saved.nonce) throw new Error('lead_id:invalid_id_token')
  if (saved.maxAge != null && (typeof claims.auth_time !== 'number' || Date.now() / 1000 - claims.auth_time > saved.maxAge + 60)) {
    throw new Error('lead_id:auth_too_old')
  }
  return { claims: claims as LeadClaims, tokens }
}

/** Nouveau jeton d'accès (et droits à jour) sans redemander la connexion. Le jeton de rafraîchissement tourne : garder le nouveau. */
export async function refresh(refreshToken: string) {
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
  const claims = await verifyLeadJwt(tokens.id_token, env('LEAD_ID_CLIENT_ID'))
  if (!claims) throw new Error('lead_id:invalid_id_token')
  return { claims: claims as LeadClaims, tokens }
}

/** L'adresse de déconnexion : ferme aussi la session du compte Lead, puis revient chez vous. */
export function logoutUrl(idToken: string | null, backTo: string) {
  const q = new URLSearchParams({ client_id: env('LEAD_ID_CLIENT_ID'), post_logout_redirect_uri: backTo })
  if (idToken) q.set('id_token_hint', idToken)
  return `${issuer()}/oauth/logout?${q}`
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${issuer()}/oauth/token`, {
    method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`lead_id:${out.error ?? r.status}`)
  return out
}

// ------------------------------------------------------------------ d'application à application

const appTokens = new Map<string, { token: string; until: number }>()

/** Jeton d'application (portée `exchange` vers une application, ou `billing`), mis en cache. */
export async function appToken(scope: 'exchange' | 'billing', audience?: string) {
  const key = `${scope}|${audience ?? ''}`
  const hit = appTokens.get(key)
  if (hit && hit.until > Date.now() + 60_000) return hit.token
  const t = await tokenRequest({ grant_type: 'client_credentials', scope, ...(audience ? { audience } : {}) })
  appTokens.set(key, { token: t.access_token, until: Date.now() + t.expires_in * 1000 })
  return t.access_token
}

/**
 * Déclarer un abonnement encaissé ici (webhook Stripe, RevenueCat…). À appeler à CHAQUE
 * changement : création, changement de formule, échec de paiement, résiliation.
 * `plan` = le nom de la formule DANS VOTRE APPLICATION (ex. Scanlead : free, solo, team).
 */
export async function reportSubscription(s: {
  org?: string; email?: string; external_id: string; plan: string
  status: 'active' | 'trialing' | 'on_trial' | 'past_due' | 'canceled' | 'expired' | 'paused' | 'incomplete' | string
  current_period_end?: string | Date | null
}): Promise<LeadEntitlements & { org: string }> {
  const r = await fetch(`${issuer()}/api/lead-id/v1/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken('billing')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`lead_id:${out.error ?? r.status}`)
  return out
}

/** Les droits d'une organisation, à jour (la formule a pu changer depuis la connexion). */
export async function entitlementsOf(q: { org?: string; email?: string }): Promise<LeadEntitlements & { org: string }> {
  const r = await fetch(`${issuer()}/api/lead-id/v1/entitlements?${new URLSearchParams(q as Record<string, string>)}`,
    { headers: { Authorization: `Bearer ${await appToken('billing')}` } })
  if (!r.ok) throw new Error(`lead_id:${r.status}`)
  return r.json()
}

// ------------------------------------------------------------------ échange de données

export type Envelope = {
  id: string                        // identifiant unique de l'envoi (uuid)
  type: 'contact' | 'lead' | 'deal' | 'project' | 'invoice' | string
  org: string                       // l'organisation Lead (claims.org)
  sub?: string                      // la personne qui a agi (claims.sub), si connue
  occurred_at: string
  source: { app: string; id: string; url?: string }   // votre application et VOTRE identifiant de l'objet
  data: Record<string, unknown>
}

/** L'adresse de réception d'une application sœur, lue sur sa carte de visite `/.well-known/lead-app.json`. */
async function inboxOf(appBaseUrl: string) {
  const r = await fetch(`${appBaseUrl.replace(/\/+$/, '')}/.well-known/lead-app.json`)
  if (!r.ok) throw new Error(`lead_app ${r.status}`)
  return (await r.json()).exchange.inbox as string
}

/**
 * Envoyer un objet à une application sœur. Répéter le même `source.id` met à jour chez elle,
 * sans doublon : on peut renvoyer sans crainte après un échec.
 */
export async function send(target: { app: string; url: string }, e: Omit<Envelope, 'id' | 'occurred_at' | 'source'> &
                           { source: { id: string; url?: string } }) {
  const envelope: Envelope = {
    id: crypto.randomUUID(), occurred_at: new Date().toISOString(), ...e,
    source: { app: env('LEAD_ID_APP'), ...e.source },
  }
  const r = await fetch(await inboxOf(target.url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken('exchange', target.app)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(`lead_exchange:${out.error ?? r.status}`), { status: r.status, body: out })
  return out as { id: string; url: string; status: 'created' | 'updated' }
}

/**
 * Côté réception (votre `/api/lead-exchange/v1/inbox`) : qui envoie ? Rend le code de
 * l'application expéditrice, ou `null` si le jeton n'est pas un jeton d'échange pour vous.
 */
export async function incomingSender(authorization: string | undefined): Promise<string | null> {
  const m = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const c = await verifyLeadJwt(m[1], env('LEAD_ID_APP'))
  return c && String(c.scope ?? '').split(' ').includes('exchange') ? String(c.app ?? '') || null : null
}
