/**
 * Kit « compte Lead » pour les applications de la famille (ScanLead, ProjectLead, InvoiceLead…).
 *
 * Un seul fichier ; seule dépendance : zod (schéma de l'enveloppe d'échange). Node 18 ou plus (fetch et crypto
 * intégrés). À copier tel quel dans le serveur de l'application (ex. `server/leadId.ts`). Mode d'emploi : LEAD-ID.md.
 *
 * Liaison sans clé (contrat du 26.10.2026) : entre deux applications Lead, aucune clé ni adresse à coller. Même
 * organisation ERPlead = reliées. Les envois et les lectures portent un jeton d'échange d'ERPlead lié à l'organisation
 * (`org`), et à la personne qui agit (`person`) quand il y en a une.
 *
 * Variables d'environnement attendues :
 *   LEAD_ID_ISSUER         https://erplead.io
 *   LEAD_ID_CLIENT_ID      scanlead
 *   LEAD_ID_CLIENT_SECRET  lid_…   (Réglages CRMlead → Mon compte Lead → Applications reliées)
 *   LEAD_ID_REDIRECT_URI   https://scanlead.io/auth/lead/callback
 *   LEAD_ID_APP            scanlead  (le code de l'application dans la famille)
 */
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { z } from 'zod'

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
  sid?: string                      // la session ERPlead de ce navigateur : une déconnexion ne ferme que ses sessions
}
export type LeadEntitlements = {
  plan: { code: 'free' | 'pro' | 'pro_plus' | string; name: string; rank: number; seats: number | null }
  apps: Record<string, { access: boolean; name: string; url: string | null; status: string; upgrade_url: string | null; [limit: string]: unknown }>
  subscriptions: { app: string; plan: string; lead_plan: string | null; status: string; current_period_end: string | null }[]
}
export type LoginStart = { url: string; state: string; nonce: string; verifier: string; maxAge?: number }
export type Tokens = { access_token: string; id_token: string; refresh_token?: string; expires_in: number; scope: string }

// ------------------------------------------------------------------ clés publiques

const jwksCache = new Map<string, { at: number; keys: any[] }>()
// Relecture pour une clé inconnue : au plus une toutes les 30 s, par émetteur. Le back-channel et la boîte de réception
// de l'échange sont publics : sans ce délai, chaque jeton forgé avec un `kid` inventé ferait un appel à ERPlead :
// amplificateur 1 pour 1. Une vraie rotation de clé est prise en compte dans les 30 s. Les requêtes
// simultanées partagent la même lecture. Un seul émetteur accepté (ERPlead) : les tables restent petites.
const UNKNOWN_KID_REFRESH_MS = 30_000
const jwksReadAt = new Map<string, number>()
const jwksReading = new Map<string, Promise<void>>()
function readJwks(iss: string): Promise<void> {
  jwksReadAt.set(iss, Date.now())
  let reading = jwksReading.get(iss)
  if (!reading) {
    reading = (async () => {
      const r = await fetch(`${iss}/oauth/jwks`)
      if (!r.ok) throw new Error(`jwks ${r.status}`)
      jwksCache.set(iss, { at: Date.now(), keys: (await r.json()).keys })
    })().finally(() => { jwksReading.delete(iss) })
    jwksReading.set(iss, reading)
  }
  return reading
}
/** Temps écoulé depuis `at` ; une horloge revenue en arrière compte comme « très ancien ». */
const elapsed = (at: number) => { const d = Date.now() - at; return d < 0 ? Infinity : d }
async function publicKey(kid: string, iss: string = issuer()) {
  const mayRead = () => jwksReading.has(iss) || elapsed(jwksReadAt.get(iss) ?? -Infinity) >= UNKNOWN_KID_REFRESH_MS
  // Clés absentes (démarrage à froid d'une instance) ou de plus d'une heure : relues, mais elles aussi au plus une fois
  // toutes les 30 s (relecture du 15.10.2026, comme CRMlead : l'émetteur en erreur, chaque jeton forgé envoyé en série
  // referait sinon une lecture). Une lecture ratée garde les clés déjà en mémoire : pendant une panne d'ERPlead, un vrai
  // jeton passe encore.
  const hit = jwksCache.get(iss)
  if ((!hit || elapsed(hit.at) > 3_600_000) && mayRead()) {
    try { await readJwks(iss) } catch (e) { if (!jwksCache.has(iss)) throw e }
  }
  const keys = jwksCache.get(iss)?.keys
  if (!keys) throw new Error('jwks indisponible')
  let jwk = keys.find((k) => k.kid === kid)
  // Clé inconnue : le compte Lead a peut-être tourné sa clé, on relit (pas plus d'une fois toutes les 30 s). Une lecture
  // déjà en cours (lancée par une autre requête) est attendue avant de conclure, sans nouvel appel (comme InvoiceLead) :
  // sinon, juste après une rotation, de deux jetons légitimes arrivés ensemble seul le premier serait accepté.
  if (!jwk && mayRead()) {
    await readJwks(iss); jwk = jwksCache.get(iss)!.keys.find((k) => k.kid === kid)
  }
  return jwk ? createPublicKey({ key: jwk, format: 'jwk' }) : null
}

/**
 * Vérifie un JWT du compte Lead : signature RS256, émetteur, audience, expiration.
 * Rend les revendications, ou `null`. Ne jamais lire un jeton sans passer par ici.
 */
export async function verifyLeadJwt(token: string, audience: string, issuers: string[] = [issuer()]): Promise<Record<string, any> | null> {
  try {
    const [h, p, s] = token.split('.')
    const head = JSON.parse(Buffer.from(h, 'base64url').toString())
    if (head.alg !== 'RS256') return null
    // L'émetteur annoncé choisit la clé, mais seulement parmi ceux qu'on accepte ; la signature le confirme.
    const iss = String(JSON.parse(Buffer.from(p, 'base64url').toString()).iss ?? '')
    if (!issuers.includes(iss)) return null
    const key = await publicKey(head.kid, iss)
    if (!key || !verify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) return null
    const c = JSON.parse(Buffer.from(p, 'base64url').toString())
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
    if (!issuers.includes(c.iss) || !aud.includes(audience) || typeof c.exp !== 'number' || c.exp * 1000 < Date.now() - 30_000) return null
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

/** Jeton d'application `billing` (formules, abonnements), mis en cache. Les échanges : `exchangeToken`. */
export async function appToken(scope: 'billing', audience?: string) {
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
 * `plan` = le nom de la formule DANS VOTRE APPLICATION (ex. ScanLead : free, solo, team).
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

// ------------------------------------------------------------------ échange de données (liaison sans clé)

/**
 * Les adresses des applications sœurs : constantes de production, surchargeables en local (le banc lance tout sur
 * localhost) par CRMLEAD_URL, PROJECTLEAD_URL, INVOICELEAD_URL, SCANLEAD_URL, GREETLEAD_URL.
 */
const APP_URLS: Record<string, string> = {
  crmlead: 'https://crmlead.io', projectlead: 'https://projectlead.io', invoicelead: 'https://invoicelead.io',
  scanlead: 'https://scanlead.io', greetlead: 'https://greetlead.io',
}
export function appUrl(app: string) {
  const v = process.env[`${app.toUpperCase()}_URL`] || APP_URLS[app]
  if (!v) throw new Error(`application inconnue : ${app}`)
  return v.replace(/\/+$/, '')
}
/** Même origine (schéma, hôte, port) ? Une URL venue d'une app sœur n'est gardée que si elle est chez elle. */
export function sameOrigin(url: unknown, base: string) {
  if (typeof url !== 'string' || !url) return false
  try { return new URL(url).origin === new URL(base).origin } catch { return false }
}

export type Envelope = {
  id: string                        // identifiant unique de l'envoi (uuid)
  type: 'contact' | 'lead' | 'deal' | 'client' | 'invoice' | 'document' | string
  org: string                       // l'organisation ERPlead (claims.org)
  sub?: string                      // la personne qui a agi (claims.sub), si connue
  occurred_at: string
  source: { app: string; id: string; url?: string }   // votre application et VOTRE identifiant de l'objet
  data: Record<string, unknown>
}

/** Une erreur d'échange : `status` HTTP (503 = ERPlead ou l'app sœur injoignable, à relancer) et le corps reçu. */
export class ExchangeError extends Error {
  constructor(readonly status: number, readonly body: Record<string, any>, message?: string) {
    super(message ?? `lead_exchange:${body?.error ?? status}`)
  }
}

const exchangeTokens = new Map<string, { token: string; until: number }>()
const proofHash = (p?: string | null) => (p ? createHash('sha256').update(p).digest('base64url') : '')

/**
 * Jeton d'échange d'ERPlead, lié à l'organisation (`org`) et, avec `personProof` (le jeton d'identité de la personne
 * émis pour CE client), à la personne. Cache par portée|audience|org|empreinte de la preuve : 14 min sans personne,
 * 5 min avec. ERPlead en panne (5xx, réseau) → ExchangeError 503 `erplead_unavailable` (à relancer) ; un refus 4xx →
 * ExchangeError avec le statut et le corps d'ERPlead (invalid_target, person_proof…). Aucune formule n'est exigée.
 */
export async function exchangeToken(scope: 'exchange' | 'exchange_read', audience: string,
                                    o: { org: string; personProof?: string | null }) {
  const key = `${scope}|${audience}|${o.org}|${proofHash(o.personProof)}`
  const hit = exchangeTokens.get(key)
  if (hit && hit.until > Date.now()) return hit.token
  const form: Record<string, string> = { grant_type: 'client_credentials', scope, audience, org: o.org }
  if (o.personProof) {
    form.subject_token = o.personProof
    form.subject_token_type = 'urn:ietf:params:oauth:token-type:id_token'
  }
  let r: Response
  try {
    r = await fetch(`${issuer()}/oauth/token`, {
      method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form), signal: AbortSignal.timeout(15_000),
    })
  } catch { throw new ExchangeError(503, { error: 'erplead_unavailable' }) }
  const out = await r.json().catch(() => ({}))
  if (r.status >= 500) throw new ExchangeError(503, { error: 'erplead_unavailable' })
  if (!r.ok || typeof out.access_token !== 'string') throw new ExchangeError(r.ok ? 502 : r.status, r.ok ? { error: 'erplead_invalid_response' } : out)
  const ttl = Math.min(Number(out.expires_in) > 0 ? Number(out.expires_in) * 1000 - 60_000 : 0, o.personProof ? 5 * 60_000 : 14 * 60_000)
  if (ttl > 0) exchangeTokens.set(key, { token: out.access_token, until: Date.now() + ttl })
  return out.access_token as string
}
const forgetToken = (scope: string, audience: string, org: string, proof?: string | null) =>
  exchangeTokens.delete(`${scope}|${audience}|${org}|${proofHash(proof)}`)

const cards = new Map<string, { at: number; card: any }>()
/** La carte de visite `/.well-known/lead-app.json` de l'app sœur (10 min en mémoire). */
async function cardOf(base: string) {
  const hit = cards.get(base)
  if (hit && elapsed(hit.at) < 600_000) return hit.card
  let r: Response
  try { r = await fetch(`${base}/.well-known/lead-app.json`, { redirect: 'error', signal: AbortSignal.timeout(10_000) }) }
  catch { throw new ExchangeError(503, { error: 'app_unreachable' }) }
  if (!r.ok) throw new ExchangeError(503, { error: 'app_unreachable', status: r.status })
  const card = await r.json().catch(() => null)
  cards.set(base, { at: Date.now(), card })
  return card
}
/** Une adresse de la carte, refusée si elle n'est pas chez l'app elle-même (même origine que son adresse constante). */
async function cardUrl(target: { app: string; url: string }, field: 'inbox' | 'read') {
  const base = target.url.replace(/\/+$/, '')
  const u = (await cardOf(base))?.exchange?.[field]
  if (!sameOrigin(u, base)) throw new ExchangeError(502, { error: 'card_invalid', field })
  return u as string
}

async function exchangeFetch(target: { app: string; url: string }, scope: 'exchange' | 'exchange_read', org: string,
                             personProof: string | null | undefined, url: string, init: RequestInit) {
  let retried = false
  for (;;) {
    const token = await exchangeToken(scope, target.app, { org, personProof })
    let r: Response
    try {
      r = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { ...(init.headers as Record<string, string> ?? {}), Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    } catch { throw new ExchangeError(503, { error: 'app_unreachable' }) }
    // 401 : le jeton a pu être révoqué ou une clé a tourné : on l'oublie, une seule nouvelle tentative.
    if (r.status === 401 && !retried) { forgetToken(scope, target.app, org, personProof); retried = true; continue }
    const out = await r.json().catch(() => ({}))
    if (!r.ok) throw new ExchangeError(r.status, out)
    return out
  }
}

/**
 * Envoyer un objet à une application sœur (`/api/lead-exchange/v1/inbox` lue sur sa carte). Répéter le même
 * `source.id` met à jour chez elle, sans doublon : on peut renvoyer sans crainte après un échec. Rend le JSON reçu.
 */
export async function send(target: { app: string; url: string },
                           e: Omit<Envelope, 'id' | 'occurred_at' | 'source'> & { id?: string; source: { id: string; url?: string } },
                           o: { personProof?: string | null } = {}) {
  const envelope: Envelope = {
    occurred_at: new Date().toISOString(), ...e, id: e.id ?? crypto.randomUUID(),
    source: { app: env('LEAD_ID_APP'), ...e.source },
  }
  const inbox = await cardUrl(target, 'inbox')
  return exchangeFetch(target, 'exchange', envelope.org, o.personProof, inbox,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) })
}

/** Lire chez une application sœur (`exchange.read` de sa carte), avec les droits de la personne (jeton exchange_read). */
export async function readExchange(target: { app: string; url: string },
                                   q: { type: string; q?: string; ids?: string[]; link?: boolean; limit?: number },
                                   o: { org: string; personProof: string }) {
  const read = new URL(await cardUrl(target, 'read'))
  read.searchParams.set('type', q.type)
  if (q.q) read.searchParams.set('q', q.q)
  if (q.ids?.length) read.searchParams.set('ids', q.ids.slice(0, 100).join(','))
  if (q.link) read.searchParams.set('link', '1')
  if (q.limit) read.searchParams.set('limit', String(q.limit))
  return exchangeFetch(target, 'exchange_read', o.org, o.personProof, read.toString(), { method: 'GET' })
}

export type IncomingExchange = { app: string; org: string | null; person: string | null; person_role: string | null }

/**
 * Côté réception : qui envoie ? Jeton d'ERPlead SEULEMENT, pour vous (`aud`), d'un client (`sub` = client:…).
 * Jeton d'échange lié à l'org (`token_use` = exchange) : portée exactement `want`. Ancien jeton sans org : accepté
 * seulement pour `want` = exchange et une portée qui contient exchange (org et personne alors inconnues).
 */
export async function incomingExchange(authorization: string | undefined,
                                       want: 'exchange' | 'exchange_read'): Promise<IncomingExchange | null> {
  const m = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const c = await verifyLeadJwt(m[1], env('LEAD_ID_APP'))
  if (!c || typeof c.sub !== 'string' || !c.sub.startsWith('client:')) return null
  const app = typeof c.app === 'string' && c.app ? c.app : null
  if (!app) return null
  if (c.token_use === 'exchange') {
    if (c.scope !== want || typeof c.org !== 'string' || !c.org) return null
    return { app, org: c.org, person: typeof c.person === 'string' ? c.person : null,
             person_role: typeof c.person_role === 'string' ? c.person_role : null }
  }
  if (want === 'exchange' && String(c.scope ?? '').split(' ').includes('exchange')) return { app, org: null, person: null, person_role: null }
  return null
}

/** Limites de l'enveloppe : chaînes ≤ 2000, contacts ≤ 50, lignes ≤ 200, autres listes ≤ 200, profondeur ≤ 6. */
const str = z.string().max(2000)
export const envelopeSchema = z.object({
  id: str.optional(), type: z.string().min(1).max(40), org: z.string().min(1).max(200), sub: z.string().max(200).nullish(),
  occurred_at: str.optional(),
  source: z.object({ app: z.string().min(1).max(40), id: z.string().min(1).max(200), url: str.nullish() }),
  data: z.record(z.unknown()).default({}),
}).superRefine((e, ctx) => {
  const walk = (v: unknown, path: (string | number)[], depth: number): void => {
    if (depth > 6) { ctx.addIssue({ code: 'custom', path, message: 'too_deep' }); return }
    if (typeof v === 'string' && v.length > 2000) ctx.addIssue({ code: 'custom', path, message: 'too_long' })
    else if (Array.isArray(v)) {
      const key = path[path.length - 1]
      const max = key === 'contacts' ? 50 : 200
      if (v.length > max) { ctx.addIssue({ code: 'custom', path, message: 'too_many' }); return }
      v.forEach((x, i) => walk(x, [...path, i], depth + 1))
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k], depth + 1)
  }
  walk(e.data, ['data'], 0)
})
export type CheckedEnvelope = z.infer<typeof envelopeSchema>

/** Lit l'enveloppe brute : JSON invalide ou hors limites → `null` (400 invalid_envelope). */
export function parseEnvelope(raw: unknown): CheckedEnvelope | null {
  const r = envelopeSchema.safeParse(raw)
  return r.success ? r.data : null
}

/** Les expéditeurs dont on exige un jeton lié à l'org (variable EXCHANGE_ORG_SENDERS, liste à virgules). */
export const orgSenders = (fallback: string) =>
  (process.env.EXCHANGE_ORG_SENDERS ?? fallback).split(',').map((s) => s.trim()).filter(Boolean)

/**
 * L'enveloppe est-elle recevable de cet expéditeur ? `allowed` : par type, les apps qui peuvent l'envoyer.
 * Rend `null`, ou le refus à répondre.
 */
export function checkEnvelope(tok: IncomingExchange, env: { type: string; org: string; source: { app: string } },
                              allowed: Record<string, string[]>, senders: string[]): null | { status: 401 | 403 | 422; error: string } {
  if (!Object.prototype.hasOwnProperty.call(allowed, env.type)) return { status: 422, error: 'unsupported_type' }
  if (env.source.app !== tok.app) return { status: 403, error: 'source_mismatch' }
  if (!allowed[env.type].includes(tok.app)) return { status: 403, error: 'sender_not_allowed' }
  if (tok.org && tok.org !== env.org) return { status: 403, error: 'org_mismatch' }
  if (!tok.org && senders.includes(tok.app)) return { status: 401, error: 'org_required' }
  return null
}
