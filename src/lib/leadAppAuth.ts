/**
 * « Continuer avec Google » dans l'app mobile ProjectLead (30.10.2026). Contrat d'ERPlead : `docs/GOOGLE-APP.md` du dépôt
 * ERPlead ; chantier : ~/projets/.unlazy/google-app/CAHIER.md.
 *
 * Google refuse sa connexion dans une vue web (« disallowed_useragent ») : dans l'app (coque Capacitor de
 * ~/projets/projectlead-mobile, qui ouvre ce site), la connexion Google se fait dans le navigateur du téléphone, puis l'app
 * reprend la main par son lien de retour et termine la connexion au Compte Lead DANS sa vue web.
 *
 * 1. Page relais `/lead-auth/google?start=…&back=…` (src/pages/LeadAuthGoogle.tsx), où ERPlead envoie la vue web après
 *    le bouton : `start` (départ chez ERPlead, à ouvrir dans le navigateur du téléphone) et `back` (l'écran de connexion de
 *    l'app chez ERPlead) sont vérifiés (préfixes exacts de l'émetteur), `back` est gardé, puis `Browser.open({ url: start })`.
 *    Navigateur refermé sans retour : `back`. Hors de l'app : `back`.
 * 2. Lien de retour `io.projectlead.app://lead-auth?code=…` (ou `?error=expired`), écouté au démarrage sur TOUTES les pages
 *    (`appUrlOpen`, et `getLaunchUrl` quand l'app a été relancée par le lien) : chaque lien une seule fois, navigateur du
 *    téléphone refermé, puis la vue web va au rachat d'ERPlead `/auth/google/app/redeem?code=…` (le cookie verifier
 *    d'erplead.io de la vue web part avec la navigation) ; un lien sans code valable ramène à `back` ou à `/login`.
 *
 * Rien de tout cela hors de l'app : sans le pont Capacitor natif (site web, navigateur), aucun écouteur n'est posé.
 * Les modules natifs ne sont pas empaquetés : le pont injecté par la coque (`window.Capacitor.Plugins.App` et
 * `.Browser`, plugins @capacitor/app et @capacitor/browser) suffit. L'app ne lit ni ne garde jamais le verifier
 * (cookie HttpOnly d'erplead.io) ; elle ne parle à aucune API d'ERPlead : tout passe par des navigations.
 *
 * L'émetteur (`https://erplead.io`) vient du serveur (`/api/auth/options` → `leadIssuer`, LEAD_ID_ISSUER) : un aperçu
 * relié à un aperçu d'ERPlead le voit ainsi sans autre réglage.
 */

/** Le schéma de l'app (appId Capacitor, iOS CFBundleURLSchemes, Android intent-filter) et l'hôte du lien de retour. */
export const APP_SCHEME = 'io.projectlead.app'
export const RETURN_PREFIX = `${APP_SCHEME}://lead-auth?`
/** La page relais de l'app (liste fermée d'ERPlead : https://projectlead.io/lead-auth/google). */
export const RELAY_PATH = '/lead-auth/google'
export const DEFAULT_ISSUER = 'https://erplead.io'
/** Le code de transfert d'ERPlead : 32 octets en base64url. */
export const CODE_RE = /^[A-Za-z0-9_-]{43}$/
/**
 * Navigateur du téléphone refermé (`browserFinished`) : on attend un instant le lien de retour avant de revenir à
 * l'écran de connexion. Sur Android, l'onglet se ferme parfois juste AVANT que l'app reçoive le lien.
 */
export const FINISH_GRACE_MS = 1500
const BACK_KEY = 'pl.leadAuth.back'
const DONE_KEY = 'pl.leadAuth.done'
const DONE_TTL_MS = 24 * 3600 * 1000

type Handler = (data: any) => void
type NativePlugin = { addListener?: (event: string, cb: Handler) => unknown }
/** Le pont injecté par la coque native (les seules méthodes lues ici). */
export type Bridge = {
  isNativePlatform?: () => boolean
  Plugins?: {
    App?: NativePlugin & { getLaunchUrl?: () => Promise<{ url?: string } | null | undefined> }
    Browser?: NativePlugin & { open?: (o: { url: string }) => Promise<unknown>; close?: () => Promise<unknown> }
  }
}
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type LeadAppEnv = {
  /** Le pont natif, seulement dans l'app (null ou absent sur le site). */
  bridge: Bridge | null | undefined
  /** location.replace : une navigation de premier niveau de la vue web. */
  replace: (url: string) => void
  session: Store | null
  local: Store | null
  /** L'émetteur du Compte Lead, sans barre finale. */
  issuer: () => Promise<string>
  setTimeout: (fn: () => void, ms: number) => unknown
  now?: () => number
}

/** Le pont Capacitor natif de la page, ou null (site web, navigateur, ancienne coque sans pont). */
export function nativeBridge(win: { Capacitor?: unknown } | undefined): Bridge | null {
  const b = win?.Capacitor as Bridge | undefined
  try { return b && typeof b.isNativePlatform === 'function' && b.isNativePlatform() === true ? b : null } catch { return null }
}

/** Un émetteur tel que le serveur le donne : https (http pour localhost, contrôles), sans barre finale. */
export function validIssuer(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 200 || /[\s\\?#]/.test(v) || v.endsWith('/')) return null
  try {
    const u = new URL(v)
    const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)
    if ((u.protocol !== 'https:' && !local) || u.username || u.password) return null
    return `${u.origin}${u.pathname === '/' ? '' : u.pathname}` === v ? v : null
  } catch { return null }
}

const CONTROL = /[\u0000-\u001f\u007f\s\\]/
/** `start` et `back` de la page relais, s'ils pointent exactement là où ERPlead les fait pointer. */
export function relayTargets(search: string, issuer: string): { start: string; back: string } | null {
  const p = new URLSearchParams(search)
  if (p.getAll('start').length !== 1 || p.getAll('back').length !== 1) return null
  const start = p.get('start')!, back = p.get('back')!
  if (start.length > 4096 || back.length > 4096 || CONTROL.test(start) || CONTROL.test(back)) return null
  if (!start.startsWith(`${issuer}/auth/google/app/start?`) || !isBack(back, issuer)) return null
  return { start, back }
}
const isBack = (back: unknown, issuer: string): back is string =>
  typeof back === 'string' && back.length <= 4096 && !CONTROL.test(back) && back.startsWith(`${issuer}/login?`)

/** Empreinte courte d'un lien (FNV-1a, deux graines) : « déjà traité » sans garder le code lui-même. */
function fingerprint(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193 + 0x2c) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

export type ReturnOutcome = 'ignored' | 'duplicate' | 'redeem' | 'back' | 'login'
export type RelayOutcome = { outcome: 'opened' | 'outside' | 'invalid' | 'failed' | 'again'; back: string | null }

/**
 * Le retour de Google pour une page (un chargement de la vue web) : `listen` au démarrage, `relay` sur la page relais.
 * Les liens déjà traités sont gardés (empreintes, 24 h) dans localStorage : `getLaunchUrl` redonne le même lien à
 * chaque chargement de page tant que l'app tourne (iOS : le dernier lien ouvert ; Android : le lien de lancement).
 */
export function createLeadAppAuth(env: LeadAppEnv) {
  const now = env.now ?? (() => Date.now())
  const seen = new Set<string>()
  let returned = false
  let relayed = false

  const read = (s: Store | null, k: string) => { try { return s?.getItem(k) ?? null } catch { return null } }
  const write = (s: Store | null, k: string, v: string | null) => {
    try { if (v === null) s?.removeItem(k); else s?.setItem(k, v) } catch { /* stockage refusé */ }
  }
  const doneList = (): { f: string; t: number }[] => {
    try {
      const v = JSON.parse(read(env.local, DONE_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x) => x && typeof x.f === 'string' && typeof x.t === 'number' && now() - x.t < DONE_TTL_MS) : []
    } catch { return [] }
  }
  const markDone = (f: string) => write(env.local, DONE_KEY, JSON.stringify([...doneList(), { f, t: now() }].slice(-20)))

  async function issuer(): Promise<string> {
    try { return validIssuer(await env.issuer()) ?? DEFAULT_ISSUER } catch { return DEFAULT_ISSUER }
  }

  /** Un lien reçu par l'app. Seul `io.projectlead.app://lead-auth?…` compte ; le reste est laissé à qui l'attend. */
  async function handleReturnLink(url: unknown): Promise<ReturnOutcome> {
    if (typeof url !== 'string' || url.length > 2048 || !url.startsWith(RETURN_PREFIX)) return 'ignored'
    const f = fingerprint(url)
    if (seen.has(f) || doneList().some((x) => x.f === f)) return 'duplicate'
    seen.add(f)
    markDone(f)
    returned = true
    // Le navigateur du téléphone, encore ouvert par-dessus l'app (iOS) : refermé. Android n'a parfois rien à fermer.
    try { void Promise.resolve(env.bridge?.Plugins?.Browser?.close?.()).catch(() => {}) } catch { /* rien à fermer */ }
    const p = new URLSearchParams(url.slice(RETURN_PREFIX.length))
    const codes = p.getAll('code')
    const iss = await issuer()
    const back = read(env.session, BACK_KEY)
    write(env.session, BACK_KEY, null)
    if (codes.length === 1 && CODE_RE.test(codes[0])) {
      env.replace(`${iss}/auth/google/app/redeem?code=${codes[0]}`)
      return 'redeem'
    }
    // Demande échue (`error=expired`) ou lien abîmé : l'écran de connexion de l'app, ou la connexion normale.
    if (isBack(back, iss)) { env.replace(back); return 'back' }
    env.replace('/login')
    return 'login'
  }

  /** Au démarrage de chaque page : les liens de retour (app ouverte, ou relancée par le lien). Rien hors de l'app. */
  function listen(): boolean {
    const app = env.bridge?.Plugins?.App
    if (!app || typeof app.addListener !== 'function') return false
    try { app.addListener('appUrlOpen', (e: any) => { void handleReturnLink(e?.url) }) } catch { return false }
    try {
      void Promise.resolve(app.getLaunchUrl?.()).then((r) => (r?.url ? handleReturnLink(r.url) : undefined)).catch(() => {})
    } catch { /* pas de lien de lancement */ }
    return true
  }

  /** La page relais (`location.search`) : ouvre le départ dans le navigateur du téléphone, ou revient à la connexion. */
  async function relay(search: string): Promise<RelayOutcome> {
    if (relayed) return { outcome: 'again', back: null }
    relayed = true
    const iss = await issuer()
    const t = relayTargets(search, iss)
    if (!t) { env.replace('/login'); return { outcome: 'invalid', back: null } }
    const browser = env.bridge?.Plugins?.Browser
    if (!env.bridge || typeof browser?.open !== 'function') { env.replace(t.back); return { outcome: 'outside', back: t.back } }
    write(env.session, BACK_KEY, t.back)
    try {
      browser.addListener?.('browserFinished', () => {
        env.setTimeout(() => { if (!returned) env.replace(t.back) }, FINISH_GRACE_MS)
      })
    } catch { /* sans cet écouteur, le lien « Retour » de la page reste */ }
    try {
      await browser.open({ url: t.start })
    } catch {
      if (!returned) env.replace(t.back)
      return { outcome: 'failed', back: t.back }
    }
    return { outcome: 'opened', back: t.back }
  }

  return { handleReturnLink, listen, relay }
}

// ------------------------------------------------------------------ dans le navigateur (vue web de l'app ou site)

let issuerRead: Promise<string> | null = null
/** L'émetteur donné par le serveur (une lecture par page), https://erplead.io si elle échoue. */
function serverIssuer(): Promise<string> {
  issuerRead ??= fetch('/api/auth/options', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((o) => validIssuer(o?.leadIssuer) ?? DEFAULT_ISSUER)
    .catch(() => DEFAULT_ISSUER)
  return issuerRead
}
const storage = (k: 'sessionStorage' | 'localStorage'): Store | null => { try { return window[k] } catch { return null } }

let instance: ReturnType<typeof createLeadAppAuth> | null = null
/** L'instance de la page (pont natif de la fenêtre, location.replace, stockages, émetteur du serveur). */
export function leadAppAuth() {
  instance ??= createLeadAppAuth({
    bridge: nativeBridge(window as { Capacitor?: unknown }),
    replace: (url) => window.location.replace(url),
    session: storage('sessionStorage'),
    local: storage('localStorage'),
    issuer: serverIssuer,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  })
  return instance
}
