/**
 * « Continuer avec Google » dans l'app mobile ProjectLead (30.10.2026, révisé : liens vérifiés). Contrat d'ERPlead :
 * `docs/GOOGLE-APP.md` du dépôt ERPlead (§ 3) ; chantier : ~/projets/.unlazy/google-app/CAHIER.md.
 *
 * Google refuse sa connexion dans une vue web (« disallowed_useragent ») : dans l'app (coque Capacitor de
 * ~/projets/projectlead-mobile, qui ouvre ce site), la connexion Google se fait dans le navigateur SÛR du téléphone, puis
 * l'app reprend la main par un lien HTTPS réservé à l'app par Apple et Google (`https://projectlead.io/lead-auth/return`,
 * Universal Link iOS, App Link vérifié Android, retour https d'ASWebAuthenticationSession) et termine la connexion au
 * Compte Lead DANS sa vue web. Plus aucun schéma propre (`io.projectlead.app://…`) n'est accepté.
 *
 * 1. Page relais `/lead-auth/google?start=…&back=…` (src/pages/LeadAuthGoogle.tsx), où ERPlead envoie la vue web après
 *    le bouton : `start` et `back` vérifiés (préfixes exacts de l'émetteur), `back` gardé, connexion en cours notée, puis :
 *    - iOS 17.4+ (module natif `LeadAuthSession` de la coque, `isAvailable().https`) : `start({ url: start&m=auto })`,
 *      ASWebAuthenticationSession avec retour https ; l'adresse rendue passe par le même traitement que les liens reçus ;
 *      annulée → `back` ; autre refus → Safari (`openExternal`, `m=tap`) ;
 *    - iOS 15.0 à 17.3 : Safari (`openExternal({ url: start&m=tap })`), puis le bouton « Ouvrir ProjectLead » d'ERPlead ;
 *    - Android : Custom Tab (`Browser.open({ url: start&m=auto })`), redirection vers l'App Link vérifié ; navigateur
 *      refermé sans retour → `back`.
 *    Hors de l'app, ou coque sans le module attendu : `back`.
 * 2. Lien de retour `https://projectlead.io/lead-auth/return?code=…&locale=…` (ou `?error=expired&locale=…`), écouté au
 *    démarrage sur TOUTES les pages (`appUrlOpen`, `getLaunchUrl`) et rendu par la session iOS : chaque lien une seule
 *    fois (empreintes sans échéance), SEULEMENT pendant une connexion en cours (page relais il y a moins de 15 min, une
 *    connexion par page relais) ; le lien d'erreur, toujours le même, n'est jamais gardé comme vu. Navigateur refermé
 *    (Android), puis la vue web va au rachat d'ERPlead `/auth/google/app/redeem?code=…` (le cookie verifier d'erplead.io
 *    de la vue web part avec la navigation) ; sans code valable : `back` ou `/login`.
 * 3. Page `/lead-auth/return` chargée DANS la vue web (src/leadAuthReturn.ts) : son adresse passe par le même traitement ;
 *    un lien ignoré ramène à l'accueil de l'app.
 *
 * Rien de tout cela hors de l'app : sans le pont Capacitor natif (site web, navigateur), aucun écouteur n'est posé. Les
 * modules natifs ne sont pas empaquetés : le pont injecté par la coque (`window.Capacitor.Plugins.App`, `.Browser`,
 * `.LeadAuthSession`) suffit. L'app ne lit ni ne garde jamais le verifier (cookie HttpOnly d'erplead.io) ; elle ne parle
 * à aucune API d'ERPlead : tout passe par des navigations.
 *
 * L'émetteur (`https://erplead.io`) vient du serveur (`/api/auth/options` → `leadIssuer`, LEAD_ID_ISSUER) : un aperçu
 * relié à un aperçu d'ERPlead le voit ainsi sans autre réglage. Le lien de retour, lui, est écrit ici (production).
 */

/** Le site de l'app en production : seul domaine associé à l'app (apple-app-site-association, assetlinks.json). */
export const SITE = 'https://projectlead.io'
/** Le lien de retour réservé à l'app (contrat d'ERPlead § 1, liste fermée) : écrit dans le code, jamais lu du serveur. */
export const RETURN_PATH = '/lead-auth/return'
export const RETURN_URL = `${SITE}${RETURN_PATH}`
export const RETURN_PREFIX = `${RETURN_URL}?`
/** La page relais de l'app (liste fermée d'ERPlead : https://projectlead.io/lead-auth/google). */
export const RELAY_PATH = '/lead-auth/google'
export const DEFAULT_ISSUER = 'https://erplead.io'
/** Le code de transfert d'ERPlead : 32 octets en base64url. */
export const CODE_RE = /^[A-Za-z0-9_-]{43}$/
/**
 * Navigateur du téléphone refermé (`browserFinished`, Android) : on attend un instant le lien de retour avant de revenir
 * à l'écran de connexion. L'onglet se ferme parfois juste AVANT que l'app reçoive le lien.
 */
export const FINISH_GRACE_MS = 1500
/**
 * Une connexion Google en cours : posée par la page relais (localStorage, pour une app relancée par le lien), valable le
 * temps d'un départ d'ERPlead (10 min : cookie verifier, départ) et un peu plus. Au-delà, ERPlead refuserait le code.
 */
export const PENDING_TTL_MS = 15 * 60 * 1000
/** Lecture du lien de lancement avant de poser l'attente : au plus ce délai (la coque répond tout de suite). */
export const LAUNCH_WAIT_MS = 1500
const BACK_KEY = 'pl.leadAuth.back'
const DONE_KEY = 'pl.leadAuth.done'
const PENDING_KEY = 'pl.leadAuth.pending'
/** Empreintes gardées (les plus récentes), sans échéance : `getLaunchUrl` redonne le même lien tant que l'app vit. */
const DONE_MAX = 20

type Handler = (data: any) => void
type NativePlugin = { addListener?: (event: string, cb: Handler) => unknown }
/**
 * Le module natif iOS de la coque (ios/App/App/LeadAuthSession.swift du dépôt mobile) : ASWebAuthenticationSession avec
 * retour https (`.https(host: "projectlead.io", path: "/lead-auth/return")`, écrit dans le Swift) et Safari.
 * Refus (code de l'erreur) : `canceled`, `unavailable`, `busy`, `bad_url`, `failed`.
 */
export type SessionPlugin = {
  isAvailable?: () => Promise<{ https?: boolean } | null | undefined>
  start?: (o: { url: string }) => Promise<{ url?: string } | null | undefined>
  openExternal?: (o: { url: string }) => Promise<{ opened?: boolean } | null | undefined>
}
/** Le pont injecté par la coque native (les seules méthodes lues ici). */
export type Bridge = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: {
    App?: NativePlugin & { getLaunchUrl?: () => Promise<{ url?: string } | null | undefined> }
    Browser?: NativePlugin & { open?: (o: { url: string }) => Promise<unknown>; close?: () => Promise<unknown> }
    LeadAuthSession?: SessionPlugin
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
/** La plateforme de la coque : 'ios', 'android' (ou '' si illisible). */
export function platformOf(b: Bridge | null | undefined): string {
  try { return String(b?.getPlatform?.() ?? '') } catch { return '' }
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
/**
 * `start` et `back` de la page relais, s'ils pointent exactement là où ERPlead les fait pointer. `start` ne porte jamais
 * `m` (c'est la page relais qui l'ajoute) : un `m` déjà là serait ambigu, refusé.
 */
export function relayTargets(search: string, issuer: string): { start: string; back: string } | null {
  const p = new URLSearchParams(search)
  if (p.getAll('start').length !== 1 || p.getAll('back').length !== 1) return null
  const start = p.get('start')!, back = p.get('back')!
  if (start.length > 4096 || back.length > 4096 || CONTROL.test(start) || CONTROL.test(back) || start.includes('#')) return null
  const prefix = `${issuer}/auth/google/app/start?`
  if (!start.startsWith(prefix) || new URLSearchParams(start.slice(prefix.length)).has('m') || !isBack(back, issuer)) return null
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

/** Le code d'erreur d'un refus du pont (CAPPluginCall.reject(message, code)). */
const errorCode = (e: unknown): string => {
  try { return typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '' } catch { return '' }
}

export type ReturnOutcome = 'ignored' | 'duplicate' | 'unexpected' | 'redeem' | 'back' | 'login'
/**
 * L'issue de la page relais : `session` (iOS 17.4+, adresse rendue et traitée), `safari` (Safari ouvert : l'app attend le
 * lien du bouton « Ouvrir ProjectLead »), `opened` (Custom Tab, Android), `canceled` (session annulée → back), `outside`
 * (hors de l'app → back), `nomodule` (coque sans le module attendu → back), `invalid` (→ /login), `failed` (→ back),
 * `again` (déjà fait sur cette page).
 */
export type RelayOutcome = {
  outcome: 'session' | 'safari' | 'opened' | 'canceled' | 'outside' | 'nomodule' | 'invalid' | 'failed' | 'again'
  back: string | null
}
/** Ce que la page relais affiche pendant l'attente : le lien « Retour », et le texte de Safari s'il le faut. */
export type RelayView = { back: string; mode: 'session' | 'safari' | 'browser' }

/**
 * Le retour de Google pour une page (un chargement de la vue web) : `listen` au démarrage, `relay` sur la page relais,
 * `returnPage` sur la page /lead-auth/return chargée dans l'app. Les liens déjà vus (traités ou ignorés, sauf le lien
 * d'erreur) sont gardés en empreintes dans localStorage, SANS échéance : `getLaunchUrl` redonne le même lien à chaque
 * chargement de page tant que l'app tourne (iOS : le dernier lien ouvert, jamais effacé par Capacitor ; Android : le lien
 * de lancement). Un lien n'est traité que pendant une connexion en cours (posée par la page relais, effacée par le
 * premier lien traité) : un lien venu d'ailleurs, ou redonné plus tard, ne fait rien.
 */
export function createLeadAppAuth(env: LeadAppEnv) {
  const now = env.now ?? (() => Date.now())
  const seen = new Set<string>()
  let returned = false
  let relayed = false
  /** La connexion en cours posée par la page relais de CE chargement (si localStorage est refusé). */
  let pendingHere: number | null = null
  /** La lecture du lien de lancement (listen) : la page relais l'attend avant de poser l'attente. */
  let launchRead: Promise<unknown> = Promise.resolve()

  const read = (s: Store | null, k: string) => { try { return s?.getItem(k) ?? null } catch { return null } }
  const write = (s: Store | null, k: string, v: string | null) => {
    try { if (v === null) s?.removeItem(k); else s?.setItem(k, v) } catch { /* stockage refusé */ }
  }
  const doneList = (): { f: string; t: number }[] => {
    try {
      const v = JSON.parse(read(env.local, DONE_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x) => x && typeof x.f === 'string') : []
    } catch { return [] }
  }
  const markDone = (f: string) => write(env.local, DONE_KEY, JSON.stringify([...doneList(), { f, t: now() }].slice(-DONE_MAX)))
  const fresh = (t: unknown) => typeof t === 'number' && now() - t >= 0 && now() - t < PENDING_TTL_MS
  /** Une connexion Google en cours (page relais, moins de 15 min) : vraie une seule fois, effacée aussitôt. */
  const takePending = (): boolean => {
    let t: unknown = null
    try { t = JSON.parse(read(env.local, PENDING_KEY) ?? 'null')?.t } catch { /* valeur abîmée : aucune attente */ }
    const ok = fresh(t) || fresh(pendingHere)
    write(env.local, PENDING_KEY, null)
    pendingHere = null
    return ok
  }
  const setPending = (on: boolean) => {
    pendingHere = on ? now() : null
    write(env.local, PENDING_KEY, on ? JSON.stringify({ t: pendingHere }) : null)
  }
  const ios = () => platformOf(env.bridge) === 'ios'

  async function issuer(): Promise<string> {
    try { return validIssuer(await env.issuer()) ?? DEFAULT_ISSUER } catch { return DEFAULT_ISSUER }
  }

  /**
   * Un lien reçu par l'app (appUrlOpen, getLaunchUrl, adresse rendue par la session iOS, adresse de la page de retour).
   * Seul `https://projectlead.io/lead-auth/return?…` compte ; le reste est laissé à qui l'attend. Sans connexion Google en
   * cours : ignoré, et gardé comme vu (jamais repris par une connexion suivante), sauf le lien d'erreur.
   */
  async function handleReturnLink(url: unknown): Promise<ReturnOutcome> {
    if (typeof url !== 'string' || url.length > 2048 || !url.startsWith(RETURN_PREFIX)) return 'ignored'
    const p = new URLSearchParams(url.slice(RETURN_PREFIX.length))
    const codes = p.getAll('code')
    // Le lien d'erreur (`error=expired`) est toujours le même : gardé comme vu, il ferait ignorer la prochaine demande échue.
    const errorLink = codes.length === 0 && p.getAll('error').length === 1 && p.get('error') === 'expired'
    if (!errorLink) {
      const f = fingerprint(url)
      if (seen.has(f) || doneList().some((x) => x.f === f)) return 'duplicate'
      seen.add(f)
      markDone(f)
    }
    if (!takePending()) return 'unexpected'
    returned = true
    // Android : le Custom Tab, s'il est encore ouvert, est refermé (erreur ignorée). iOS : la session se ferme d'elle-même.
    if (!ios()) {
      try { void Promise.resolve(env.bridge?.Plugins?.Browser?.close?.()).catch(() => {}) } catch { /* rien à fermer */ }
    }
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

  /**
   * Au démarrage de chaque page : les liens de retour (app ouverte, ou relancée par le lien). Rien hors de l'app. Sur la
   * page relais (`relayPage`), une connexion notée avant est d'abord effacée : le lien de lancement que la coque redonne
   * n'est jamais pris pour le retour de la nouvelle connexion.
   */
  function listen(opts: { relayPage?: boolean } = {}): boolean {
    const app = env.bridge?.Plugins?.App
    if (!app || typeof app.addListener !== 'function') return false
    if (opts.relayPage) setPending(false)
    try { app.addListener('appUrlOpen', (e: any) => { void handleReturnLink(e?.url) }) } catch { return false }
    try {
      launchRead = Promise.resolve(app.getLaunchUrl?.()).then((r) => (r?.url ? handleReturnLink(r.url) : undefined)).catch(() => {})
    } catch { /* pas de lien de lancement */ }
    return true
  }

  /** Fin d'une ouverture sans retour (annulée, refusée) : connexion en cours effacée, l'écran de connexion de l'app. */
  const giveUp = (back: string) => { setPending(false); if (!returned) env.replace(back) }

  /** iOS : la session avec retour https (17.4+), sinon Safari et le bouton d'ERPlead. */
  async function openIos(t: { start: string; back: string }, s: SessionPlugin, show?: (v: RelayView) => void): Promise<RelayOutcome> {
    let https = false
    try { https = (await s.isAvailable?.())?.https === true } catch { https = false }
    if (https) {
      show?.({ back: t.back, mode: 'session' })
      let url: unknown, refused: string | null = null
      try { url = (await s.start!({ url: `${t.start}&m=auto` }))?.url } catch (e) { refused = errorCode(e) || 'failed' }
      // Le lien est déjà arrivé autrement (Universal Link pendant la session) : rien de plus, ni back ni Safari.
      if (returned) return { outcome: 'session', back: t.back }
      if (refused === null) {
        const out = await handleReturnLink(url)
        if (out === 'redeem' || out === 'back' || out === 'login') return { outcome: 'session', back: t.back }
        // Adresse rendue inattendue (hôte et chemin sont fixés dans le Swift : ne devrait pas arriver) ou connexion échue.
        giveUp(t.back)
        return { outcome: 'failed', back: t.back }
      }
      if (refused === 'canceled') { giveUp(t.back); return { outcome: 'canceled', back: t.back } }
      // Autre refus (domaine pas encore associé, session occupée…) : Safari. Si le départ a déjà servi, ERPlead montre
      // « La demande a expiré » et son bouton ramène ici, vers back.
    }
    show?.({ back: t.back, mode: 'safari' })
    try {
      const r = await s.openExternal!({ url: `${t.start}&m=tap` })
      if (r && r.opened === false) throw new Error('not opened')
    } catch { giveUp(t.back); return { outcome: 'failed', back: t.back } }
    return { outcome: 'safari', back: t.back }
  }

  /** La page relais (`location.search`) : ouvre le départ dans le navigateur sûr du téléphone, ou revient à la connexion. */
  async function relay(search: string, show?: (v: RelayView) => void): Promise<RelayOutcome> {
    if (relayed) return { outcome: 'again', back: null }
    relayed = true
    const iss = await issuer()
    const t = relayTargets(search, iss)
    if (!t) { env.replace('/login'); return { outcome: 'invalid', back: null } }
    const bridge = env.bridge
    if (!bridge) { env.replace(t.back); return { outcome: 'outside', back: t.back } }
    const session = bridge.Plugins?.LeadAuthSession
    const browser = bridge.Plugins?.Browser
    const usable = ios() ? typeof session?.start === 'function' && typeof session?.openExternal === 'function' : typeof browser?.open === 'function'
    // Coque sans le module attendu (ne devrait pas arriver avec LeadAppAuth/2) : la connexion normale de l'app.
    if (!usable) { env.replace(t.back); return { outcome: 'nomodule', back: t.back } }
    // Le lien que la coque redonne au chargement (un ancien retour) est lu AVANT de poser l'attente : jamais pris pour
    // le retour de cette connexion.
    await Promise.race([launchRead, new Promise((r) => globalThis.setTimeout(r, LAUNCH_WAIT_MS))])
    if (returned) return { outcome: 'again', back: null }
    write(env.session, BACK_KEY, t.back)
    setPending(true)
    if (ios()) return openIos(t, session!, show)
    // Android : Custom Tab ; au retour de Google, redirection serveur vers l'App Link vérifié.
    show?.({ back: t.back, mode: 'browser' })
    try {
      browser!.addListener?.('browserFinished', () => {
        env.setTimeout(() => { if (!returned) giveUp(t.back) }, FINISH_GRACE_MS)
      })
    } catch { /* sans cet écouteur, le lien « Retour » de la page reste */ }
    try {
      await browser!.open!({ url: `${t.start}&m=auto` })
    } catch {
      giveUp(t.back)
      return { outcome: 'failed', back: t.back }
    }
    return { outcome: 'opened', back: t.back }
  }

  /**
   * La page /lead-auth/return chargée DANS la vue web de l'app (src/leadAuthReturn.ts) : son adresse passe par le même
   * traitement qu'un lien reçu ; ignorée (pas de connexion en cours, déjà vue, autre adresse) → l'accueil de l'app.
   */
  async function returnPage(href: string): Promise<ReturnOutcome> {
    const out = await handleReturnLink(href)
    if (out === 'ignored' || out === 'duplicate' || out === 'unexpected') env.replace('/')
    return out
  }

  return { handleReturnLink, listen, relay, returnPage, inApp: () => !!env.bridge }
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
