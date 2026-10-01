import { createHash, randomBytes } from 'node:crypto'

/**
 * OAuth de Google et de Microsoft, pour brancher une boîte sans jamais voir le
 * mot de passe du vendeur.
 *
 * Aucun SDK : deux fournisseurs, trois adresses chacun, le même protocole. Les
 * adresses sont surchargeables par variable d'environnement, ce qui permet aux
 * contrôles de non-régression de parler à un faux fournisseur local.
 *
 * PKCE en plus du secret client : un code d'autorisation intercepté au retour ne
 * sert à rien sans le vérificateur, qui n'a jamais quitté le serveur.
 */

export type OAuthProvider = 'google' | 'microsoft'

/**
 * Deux usages, un seul protocole.
 *
 * `mailbox` demande à lire et à envoyer du courrier ; `sso` ne demande que de
 * savoir qui est là. Ce sont deux demandes très différentes pour la personne qui
 * les accorde, et il serait malhonnête de réclamer l'accès à une boîte mail pour
 * ouvrir une session. Les autorisations et l'adresse de retour changent donc
 * ensemble, et rien d'autre.
 */
export type OAuthUse = 'mailbox' | 'sso'

const SSO_SCOPES = {
  google: ['openid', 'email', 'profile'],
  microsoft: ['openid', 'email', 'profile', 'User.Read'],
} as const

export type Tokens = { access_token: string; refresh_token: string; expires_at: number }

const env = (k: string, d: string) => process.env[k] || d

export const OAUTH = {
  google: {
    authUrl: () => env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    tokenUrl: () => env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    clientId: () => process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET ?? '',
    // Lecture et envoi, rien d'autre : ni suppression, ni modification, ni accès
    // aux contacts ou à l'agenda.
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly',
             'https://www.googleapis.com/auth/gmail.send'],
    extra: { access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'true' },
  },
  microsoft: {
    authUrl: () => env('MICROSOFT_AUTH_URL', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'),
    tokenUrl: () => env('MICROSOFT_TOKEN_URL', 'https://login.microsoftonline.com/common/oauth2/v2.0/token'),
    clientId: () => process.env.MICROSOFT_CLIENT_ID ?? '',
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET ?? '',
    // `Mail.ReadWrite` et pas seulement `Mail.Read` : répondre dans le fil d'un
    // client passe par un brouillon de réponse créé dans la boîte, puis envoyé.
    // Rien n'est jamais supprimé ni déplacé.
    scopes: ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'],
    extra: { prompt: 'select_account' },
  },
} as const

export const oauthConfigured = (p: OAuthProvider) =>
  Boolean(OAUTH[p].clientId() && OAUTH[p].clientSecret())

/**
 * Brancher une boîte Gmail d'un clic est éteint par défaut, et c'est voulu.
 *
 * `gmail.readonly` est une autorisation « restreinte » : Google ne la valide
 * qu'après un audit de sécurité CASA payant, à refaire chaque année. Décision
 * d'Ève du 17.09.2026 : pas un centime là-dessus. Sans cette validation, chaque
 * branchement passerait par l'écran « application non vérifiée », plafonné à
 * 100 personnes. Gmail se branche donc par mot de passe d'application (IMAP et
 * SMTP), qui lit et envoie tout autant, et l'application Google ne réclame plus
 * que `openid email profile` — ce qui la laisse valider gratuitement.
 *
 * `GOOGLE_MAILBOX_OAUTH=1` rallume le chemin : les contrôles s'en servent, et les
 * boîtes déjà branchées par Google continuent de se synchroniser tant que leur
 * jeton vit.
 */
export const mailboxOAuthEnabled = (p: OAuthProvider) =>
  oauthConfigured(p) && (p !== 'google' || process.env.GOOGLE_MAILBOX_OAUTH === '1')

export const redirectUri = (p: OAuthProvider, use: OAuthUse = 'mailbox') =>
  `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}` +
  (use === 'sso' ? `/api/auth/sso/${p}/callback` : `/api/mail/oauth/${p}/callback`)

export const hashState = (state: string) => createHash('sha256').update(state).digest('hex')

/** L'adresse vers laquelle envoyer le vendeur, avec l'état et le défi PKCE. */
export function beginAuthorization(p: OAuthProvider, use: OAuthUse = 'mailbox') {
  const state = randomBytes(24).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const cfg = OAUTH[p]
  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: redirectUri(p, use),
    response_type: 'code',
    scope: (use === 'sso' ? SSO_SCOPES[p] : cfg.scopes).join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // `access_type=offline` et `prompt=consent` réclament un jeton de
    // rafraîchissement, dont une simple connexion n'a aucun usage : le jeton sert
    // une fois, pour lire qui est là, puis il est jeté.
    ...(use === 'sso' ? { prompt: 'select_account' } : cfg.extra),
  })
  return { url: `${cfg.authUrl()}?${params}`, state, verifier }
}

async function tokenRequest(p: OAuthProvider, body: Record<string, string>): Promise<Tokens> {
  const cfg = OAUTH[p]
  const res = await fetch(cfg.tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId(), client_secret: cfg.clientSecret(), ...body }),
    signal: AbortSignal.timeout(20_000),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    // `invalid_grant` : le vendeur a retiré l'accès, changé de mot de passe, ou le
    // jeton a expiré. Il n'y a rien à réessayer, il faut rebrancher la boîte.
    const code = data.error === 'invalid_grant' ? 'reconnect_required' : (data.error ?? `HTTP ${res.status}`)
    throw new Error(code)
  }
  return {
    access_token: data.access_token,
    // Google ne renvoie pas toujours de nouveau jeton de rafraîchissement ;
    // Microsoft en renvoie un à chaque fois et invalide l'ancien.
    refresh_token: data.refresh_token ?? body.refresh_token ?? '',
    expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  }
}

export const exchangeCode = (p: OAuthProvider, code: string, verifier: string, use: OAuthUse = 'mailbox') =>
  tokenRequest(p, { grant_type: 'authorization_code', code, code_verifier: verifier,
                    redirect_uri: redirectUri(p, use) })

/**
 * Un jeton valide pour la minute qui vient. Rend `changed` quand il a fallu le
 * renouveler : l'appelant doit alors enregistrer le nouveau, sinon le suivant
 * repartira d'un jeton de rafraîchissement que Microsoft a déjà invalidé.
 */
export async function freshTokens(p: OAuthProvider, t: Tokens): Promise<{ tokens: Tokens; changed: boolean }> {
  if (t.expires_at > Date.now() + 60_000) return { tokens: t, changed: false }
  if (!t.refresh_token) throw new Error('reconnect_required')
  return { tokens: await tokenRequest(p, { grant_type: 'refresh_token', refresh_token: t.refresh_token }), changed: true }
}

/** Un appel JSON authentifié, borné dans le temps, qui dit clairement son échec. */
export async function api(url: string, token: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(init.headers as any) }
  if (init.json !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  const data: any = text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null
  if (res.status === 401) throw new Error('reconnect_required')
  // Le fournisseur demande de ralentir : ce n'est pas une panne, on reprendra au
  // passage suivant. Google le dit en 429, ou en 403 avec un motif de quota.
  if (res.status === 429 || (res.status === 403 &&
      /rate ?limit|quota|userRateLimitExceeded/i.test(JSON.stringify(data ?? '')))) throw new Error('rate_limited')
  if (!res.ok) throw new Error(data?.error?.message ?? data?.error_description ?? `HTTP ${res.status}`)
  return data
}
