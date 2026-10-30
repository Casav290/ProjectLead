/**
 * « Continuer avec Google » dans l'app mobile (30.10.2026, révisé : liens vérifiés ; contrat d'ERPlead docs/GOOGLE-APP.md
 * § 3 ; porte G1 de ~/projets/.unlazy/google-app/gates/leaf-projectlead.md) : le code web de l'app, sans serveur ni base.
 *
 *   npx tsx scripts/google-app-check.ts   → GOOGLE_APP_WEB_CHECK_OK (code 0), sinon GOOGLE_APP_WEB_CHECK_KO (code 1)
 *
 * src/lib/leadAppAuth.ts avec un faux pont Capacitor (App : appUrlOpen, getLaunchUrl ; Browser : open, close,
 * browserFinished ; LeadAuthSession : isAvailable, start, openExternal ; plateforme ios ou android), de faux stockages et
 * un location.replace noté :
 * 1. le lien vérifié exact `https://projectlead.io/lead-auth/return?code=…`, pendant une connexion Google en cours (page
 *    relais) → (Android : Browser.close) puis la vue web au rachat d'ERPlead avec le code, UNE fois (appUrlOpen, getLaunchUrl,
 *    adresse rendue par la session iOS, page rechargée, le lendemain) ; le schéma propre io.projectlead.app et tout autre
 *    lien ignorés ; lien mal formé ou demande échue → back ou /login, jamais de rachat ; sans connexion en cours : rien ;
 *    le lien d'erreur jamais gardé comme vu ;
 * 2. la page relais : préfixes exacts de l'émetteur ; iOS 17.4+ session `start&m=auto` (annulée → back, autre refus →
 *    Safari `start&m=tap`) ; iOS 15 à 17.3 Safari `m=tap` ; Android Custom Tab `m=auto` (refermé sans retour → back) ;
 *    hors de l'app ou coque sans module → back ;
 * 3. la page /lead-auth/return chargée dans l'app (même traitement, sinon l'accueil) et sa page HTML (code effacé de
 *    l'adresse avant tout, aucune ressource tierce, aucun lien) ;
 * 4. rien hors de l'app (site web : aucun écouteur) ; l'émetteur vient du serveur ; fichiers d'association exacts (contrat) ;
 *    routes Vercel ; page relais et page de retour dans les cinq langues.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'

process.env.DATABASE_URL ||= 'postgres://google-app-check@localhost/aucune-base'
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'

const ROOT = join(import.meta.dirname, '..')
let ok = 0
let ko = 0
const check = (name: string, pass: unknown, detail: unknown = '') => {
  if (pass) { ok++; console.log(`  ok   ${name}`) } else {
    ko++
    console.log(`  NON  ${name}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 500)}`)
  }
}
async function block(title: string, fn: () => Promise<void> | void) {
  console.log(title)
  try { await fn() } catch (e) { check(`${title} : exécuté sans erreur`, false, String((e as Error)?.stack ?? e).slice(0, 400)) }
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const L = await import('../src/lib/leadAppAuth.ts')
const { createLeadAppAuth, nativeBridge, RETURN_PREFIX, RETURN_URL, FINISH_GRACE_MS, DEFAULT_ISSUER } = L

const ISS = 'https://erplead.io'
const code = (c = 'A') => (c.repeat(40) + '_-9').slice(0, 43)
const LINK = `${RETURN_PREFIX}code=${code()}&locale=fr`
const linkOf = (c: string) => `${RETURN_PREFIX}code=${code(c)}&locale=fr`
const ERROR_LINK = `${RETURN_PREFIX}error=expired&locale=fr`
const redeemOf = (c = 'A', iss = ISS) => `${iss}/auth/google/app/redeem?code=${code(c)}`
const START = `${ISS}/auth/google/app/start?d=projectlead.${'x'.repeat(43)}`
const BACK = `${ISS}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dprojectlead%26platform%3Dapp&locale=fr`
const relaySearch = (start = START, back = BACK) => `?${new URLSearchParams({ start, back })}`

class MemStore {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

type Deferred = { resolve: (v: any) => void; reject: (e: any) => void }
type FakeOpts = {
  native?: boolean; app?: boolean; browser?: boolean; closeRejects?: boolean; openRejects?: boolean
  /** La plateforme de la coque (android par défaut). */
  platform?: 'ios' | 'android'
  /** Module LeadAuthSession (iOS) : absent si false. */
  session?: false | {
    https?: boolean | 'throws'
    /** Ce que rend start : une adresse, un refus (code), ou 'wait' (la porte le résout ensuite). */
    start?: { url: string } | { reject: string } | 'wait'
    external?: 'ok' | 'rejects' | 'not-opened'
  }
  issuer?: string | (() => Promise<string>); launchUrl?: string | null; local?: MemStore; sessionStore?: MemStore
  /** L'horloge de la page (Date.now par défaut). */
  now?: () => number
  /** La coque répond à getLaunchUrl après ce délai (ms). */
  launchDelayMs?: number
}
/** Un chargement de page dans la vue web de l'app : faux pont, faux stockages, navigations notées. */
function fake(o: FakeOpts = {}) {
  const log: string[] = []
  const listeners: Record<string, ((d: any) => void)[]> = {}
  const timers: { fn: () => void; ms: number }[] = []
  const waiting: Deferred[] = []
  const on = (plugin: string) => (event: string, cb: (d: any) => void) => {
    log.push(`listen:${plugin}:${event}`); (listeners[event] ??= []).push(cb); return { remove: async () => {} }
  }
  const platform = o.platform ?? 'android'
  const Plugins: any = {}
  if (o.app !== false) Plugins.App = { addListener: on('App'), getLaunchUrl: async () => {
    if (o.launchDelayMs) await new Promise((r) => setTimeout(r, o.launchDelayMs))
    return o.launchUrl ? { url: o.launchUrl } : {}
  } }
  if (o.browser !== false) Plugins.Browser = {
    addListener: on('Browser'),
    open: async ({ url }: { url: string }) => { log.push(`open:${url}`); if (o.openRejects) throw new Error('Unable to display URL') },
    close: async () => { log.push('close'); if (o.closeRejects) throw new Error('nothing to close') },
  }
  // Sous iOS, par défaut : session disponible, annulée tout de suite (aucun essai ne reste suspendu si le code change).
  const s = o.session === undefined ? (platform === 'ios' ? { https: true, start: { reject: 'canceled' } } : false) : o.session
  if (s) {
    const err = (c: string) => Object.assign(new Error(c), { code: c })
    Plugins.LeadAuthSession = {
      isAvailable: async () => { log.push('isAvailable'); if (s.https === 'throws') throw new Error('x'); return { https: s.https === true } },
      start: ({ url }: { url: string }) => {
        log.push(`session:${url}`)
        const r = s.start ?? { reject: 'failed' }
        if (r === 'wait') return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
        if ('reject' in r) return Promise.reject(err(r.reject))
        return Promise.resolve(r)
      },
      openExternal: async ({ url }: { url: string }) => {
        log.push(`external:${url}`)
        if (s.external === 'rejects') throw err('failed')
        return { opened: s.external !== 'not-opened' }
      },
    }
  }
  const bridge = o.native === false ? null : { isNativePlatform: () => true, getPlatform: () => platform, Plugins }
  const local = o.local ?? new MemStore(), session = o.sessionStore ?? new MemStore()
  const auth = createLeadAppAuth({
    bridge, local, session,
    replace: (url) => log.push(`replace:${url}`),
    issuer: typeof o.issuer === 'function' ? o.issuer : async () => (o.issuer as string | undefined) ?? ISS,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    ...(o.now ? { now: o.now } : {}),
  })
  const fire = (event: string, data?: unknown) => (listeners[event] ?? []).forEach((cb) => cb(data))
  const replaces = () => log.filter((x) => x.startsWith('replace:')).map((x) => x.slice('replace:'.length))
  const pick = (p: string) => log.filter((x) => x.startsWith(p)).map((x) => x.slice(p.length))
  return { auth, log, fire, timers, local, session, replaces, waiting, closes: () => log.filter((x) => x === 'close').length,
    opens: () => pick('open:'), sessions: () => pick('session:'), externals: () => pick('external:') }
}
/**
 * Une connexion Google en cours, comme dans l'app : la page relais d'un chargement précédent (même localStorage, autre
 * sessionStorage : comme une app relancée par le lien) a ouvert le Custom Tab (Android) ; puis la page qui reçoit le lien.
 */
async function armed(o: FakeOpts = {}) {
  const local = o.local ?? new MemStore()
  const r = await fake({ local, now: o.now }).auth.relay(relaySearch())
  if (r.outcome !== 'opened') throw new Error(`relais : ${r.outcome}`)
  return fake({ ...o, local })
}

// ------------------------------------------------------------------ 1. lien de retour
await block('1. Lien vérifié https://projectlead.io/lead-auth/return', async () => {
  check('le lien de retour attendu est celui de la production, écrit dans le code : https://projectlead.io/lead-auth/return?',
    RETURN_PREFIX === 'https://projectlead.io/lead-auth/return?' && RETURN_URL === 'https://projectlead.io/lead-auth/return')
  {
    const f = await armed()
    check('écoute posée dans l’app : appUrlOpen (App), lien de lancement lu', f.auth.listen() === true && f.log.includes('listen:App:appUrlOpen'), f.log)
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    const close = f.log.indexOf('close'), nav = f.log.findIndex((x) => x.startsWith('replace:'))
    check('lien vérifié exact (https://projectlead.io/lead-auth/return, code de 43 caractères, langue) sous Android : Browser.close, puis la vue web au rachat d’ERPlead avec le code, une seule navigation',
      f.closes() === 1 && close >= 0 && close < nav && same(f.replaces(), [redeemOf()]), f.log)
    const g = await armed({ platform: 'ios' })
    g.auth.listen()
    g.fire('appUrlOpen', { url: LINK })
    await flush()
    check('le même lien sous iOS (Universal Link, après Safari) : rachat, aucun Browser.close (rien d’ouvert par Browser)', g.closes() === 0 && same(g.replaces(), [redeemOf()]), g.log)
  }
  {
    const f = await armed({ launchUrl: LINK })
    f.auth.listen()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    check('le même lien par appUrlOpen (deux fois) et par getLaunchUrl : une seule navigation, une seule fermeture', f.replaces().length === 1 && f.closes() === 1, f.log)
    // La page suivante (même vue web, mêmes stockages) : getLaunchUrl redonne le même lien.
    const g = fake({ launchUrl: LINK, local: f.local, sessionStore: f.session })
    g.auth.listen()
    await flush()
    check('page rechargée (nouvelle instance, même localStorage) : le lien de lancement déjà traité est ignoré (ni navigation, ni fermeture)',
      g.replaces().length === 0 && g.closes() === 0, g.log)
    g.fire('appUrlOpen', { url: linkOf('B') })
    await flush()
    check('une seule connexion par page relais : après le retour, un autre lien (autre code, sans nouvelle page relais) est ignoré (ni navigation, ni fermeture)',
      g.replaces().length === 0 && g.closes() === 0, g.log)
    const h = await armed({ local: f.local, sessionStore: f.session })
    h.auth.listen()
    h.fire('appUrlOpen', { url: linkOf('D') })
    await flush()
    check('nouvelle connexion Google (nouvelle page relais) : son lien est traité, une fois', same(h.replaces(), [redeemOf('D')]), h.log)
    check('le stockage ne garde que des empreintes (jamais le code)', ![...f.local.m.values(), ...f.session.m.values()].join(' ').includes(code()), [...f.local.m.values()])
  }
  {
    // Lundi 9 h connexion Google ; l'app reste en mémoire et iOS redonne le même lien (lastURL) à chaque chargement complet
    // de page ; mardi 9 h 30, la reconnexion silencieuse recharge la page.
    let clock = Date.parse('2026-11-02T09:00:00Z')
    const now = () => clock
    const f = await armed({ now })
    f.auth.listen()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    clock = Date.parse('2026-11-03T09:30:00Z')
    const g = fake({ launchUrl: LINK, local: f.local, now })
    g.auth.listen()
    await flush()
    clock = Date.parse('2026-11-09T09:30:00Z')
    const h = fake({ launchUrl: LINK, local: f.local, now })
    h.auth.listen()
    await flush()
    check('24 h et 7 jours plus tard (app restée en mémoire, getLaunchUrl redonne le lien de lundi) : jamais rejoué (ni navigation, ni fermeture)',
      f.replaces().length === 1 && g.replaces().length === 0 && g.closes() === 0 && h.replaces().length === 0 && h.closes() === 0, { f: f.log, g: g.log, h: h.log })
  }
  {
    // Le lendemain, deux connexions Google de suite : la première abandonnée (navigateur refermé), la seconde recharge la
    // page relais PENDANT la connexion en cours (posée par la première) ; getLaunchUrl y redonne toujours le lien de lundi.
    let clock = Date.parse('2026-11-02T09:00:00Z')
    const now = () => clock
    const f = await armed({ now })
    f.auth.listen()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    clock = Date.parse('2026-11-03T08:58:00Z')
    const k1 = fake({ launchUrl: LINK, local: f.local, now })
    k1.auth.listen({ relayPage: true })
    await k1.auth.relay(relaySearch())
    await flush()
    // 9 h 05 : pendant la connexion en cours (Safari ou Custom Tab ouvert), une page ORDINAIRE de l'app se charge (vue web
    // rechargée) : getLaunchUrl y redonne le lien de lundi. Seule la mémoire des liens le distingue du retour attendu.
    clock = Date.parse('2026-11-03T09:05:00Z')
    const k = fake({ launchUrl: LINK, local: f.local, now })
    k.auth.listen()
    await flush()
    k.fire('appUrlOpen', { url: linkOf('E') })
    await flush()
    check('le lendemain, nouvelle connexion Google (page relais) : le lien de lundi que getLaunchUrl redonne pendant la connexion en cours (page ordinaire rechargée) est ignoré, seul le nouveau lien est racheté',
      k1.replaces().length === 0 && same(k.replaces(), [redeemOf('E')]), { k1: k1.log, k: k.log })
  }
  {
    // Page relais rouverte pendant une connexion notée (première abandonnée il y a 2 min) ; la coque redonne au chargement
    // un lien JAMAIS vu (arrivé hors de toute connexion, l'app tuée entre-temps) : la page relais efface d'abord la
    // connexion notée, puis lit ce lien : il n'est jamais racheté. Ailleurs (page ordinaire), la même situation est celle
    // de l'app relancée par son lien de retour : racheté.
    let clock = Date.parse('2026-11-02T09:00:00Z')
    const now = () => clock
    const local = new MemStore()
    await fake({ local, now }).auth.relay(relaySearch())
    clock += 2 * 60 * 1000
    const r = fake({ launchUrl: linkOf('G'), local, now })
    r.auth.listen({ relayPage: true })
    await flush()
    const local2 = new MemStore()
    await fake({ local: local2, now }).auth.relay(relaySearch())
    const p = fake({ launchUrl: linkOf('G'), local: local2, now })
    p.auth.listen()
    await flush()
    check('page relais : une connexion notée avant est effacée AVANT de lire le lien de lancement (jamais racheté là) ; page ordinaire, app relancée par son lien : racheté',
      r.replaces().length === 0 && r.closes() === 0 && same(p.replaces(), [redeemOf('G')]), { r: r.log, p: p.log })
  }
  {
    const f = fake()
    f.auth.listen()
    f.fire('appUrlOpen', { url: LINK })
    f.fire('appUrlOpen', { url: ERROR_LINK })
    await flush()
    check('aucune connexion Google en cours (aucune page relais) : un lien de retour venu d’ailleurs (courriel, page, code QR, autre app), code ou error=expired, est ignoré (ni navigation, ni fermeture)',
      f.replaces().length === 0 && f.closes() === 0, f.log)
    // Ce lien ne sert pas non plus plus tard : la page relais suivante (getLaunchUrl le redonne) ne le prend pas pour son retour.
    const g = fake({ launchUrl: LINK, local: f.local })
    g.auth.listen({ relayPage: true })
    await g.auth.relay(relaySearch())
    await flush()
    check('… et une connexion Google suivante ne le reprend pas (getLaunchUrl le redonne sur la page relais) : ni navigation, ni fermeture',
      g.replaces().length === 0 && g.closes() === 0, g.log)
  }
  {
    // Le lien d'erreur est toujours le même : deux demandes échues de suite reviennent chacune à l'écran de connexion.
    const local = new MemStore(), s1 = new MemStore()
    await fake({ local, sessionStore: s1 }).auth.relay(relaySearch())
    const a = fake({ local, sessionStore: s1 })
    a.auth.listen()
    a.fire('appUrlOpen', { url: ERROR_LINK })
    await flush()
    const s2 = new MemStore()
    await fake({ local, sessionStore: s2 }).auth.relay(relaySearch())
    const b = fake({ local, sessionStore: s2, launchUrl: ERROR_LINK })
    b.auth.listen()
    await flush()
    const stray = fake({ local })
    const before = local.getItem('pl.leadAuth.done')
    stray.auth.listen()
    stray.fire('appUrlOpen', { url: ERROR_LINK })
    await flush()
    check('lien d’erreur (error=expired) jamais gardé comme vu : deux demandes échues de suite reviennent chacune à l’écran de connexion de l’app (back) ; reçu sans connexion en cours, il ne laisse aucune trace',
      same(a.replaces(), [BACK]) && same(b.replaces(), [BACK]) && stray.replaces().length === 0 && local.getItem('pl.leadAuth.done') === before, { a: a.log, b: b.log })
  }
  {
    // La coque répond lentement à getLaunchUrl : la page relais attend sa réponse avant de poser l'attente.
    const f = fake({ launchUrl: linkOf('F'), launchDelayMs: 40 })
    f.auth.listen({ relayPage: true })
    await f.auth.relay(relaySearch())
    await new Promise((r) => setTimeout(r, 80))
    await flush()
    check('page relais : le lien que la coque redonne au chargement (lent à venir) est lu avant de poser l’attente, jamais pris pour le retour de cette connexion',
      f.replaces().length === 0 && f.closes() === 0 && f.opens().length === 1, f.log)
  }
  {
    let clock = Date.parse('2026-11-02T09:00:00Z')
    const now = () => clock
    const f = await armed({ now })
    clock += 16 * 60 * 1000
    f.auth.listen()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    const g = await armed({ now })
    clock += 14 * 60 * 1000
    g.auth.listen()
    g.fire('appUrlOpen', { url: linkOf('H') })
    await flush()
    check('connexion en cours échue (page relais il y a 16 min, ERPlead garde le départ 10 min) : lien ignoré ; à 14 min : racheté',
      f.replaces().length === 0 && f.closes() === 0 && same(g.replaces(), [redeemOf('H')]), { f: f.log, g: g.log })
  }
  {
    const c = code()
    const foreign = [
      `io.projectlead.app://lead-auth?code=${c}`, `io.projectlead.app://lead-auth/return?code=${c}`, `io.crmlead.app://lead-auth?code=${c}`,
      `https://crmlead.io/lead-auth/return?code=${c}`, `https://greetlead.io/lead-auth/return?code=${c}`, `http://projectlead.io/lead-auth/return?code=${c}`,
      `https://www.projectlead.io/lead-auth/return?code=${c}`, `https://projectlead.io.evil.com/lead-auth/return?code=${c}`,
      `https://evil.com/https://projectlead.io/lead-auth/return?code=${c}`, `https://projectlead-abc-scanleads-projects.vercel.app/lead-auth/return?code=${c}`,
      `https://projectlead.io/lead-auth/return/x?code=${c}`, `https://projectlead.io/lead-auth/returnx?code=${c}`, `https://projectlead.io/lead-auth?code=${c}`,
      `https://projectlead.io/lead-auth/google?code=${c}`, `https://PROJECTLEAD.IO/lead-auth/return?code=${c}`, `https://projectlead.io/LEAD-AUTH/return?code=${c}`,
      `https://projectlead.io:443/lead-auth/return?code=${c}`, `https://user@projectlead.io/lead-auth/return?code=${c}`, ` ${LINK}`,
      'https://projectlead.io/lead-auth/return', `https://projectlead.io/lead-auth/return#code=${c}`, '', null, 42, { url: LINK },
    ]
    const f = await armed()
    f.auth.listen()
    for (const u of foreign) f.fire('appUrlOpen', { url: u })
    f.fire('appUrlOpen', undefined)
    await flush()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    check(`liens étrangers ignorés (${foreign.length + 1} : schéma propre io.projectlead.app, autre app, http, www, sous-domaine piège, aperçu, autre chemin, majuscules, port, identifiant, espace, sans requête, fragment, vide, pas une chaîne) : ni navigation, ni fermeture, la connexion en cours attend toujours son lien`,
      same(f.replaces(), [redeemOf()]) && f.closes() === 1, f.log)
  }
  {
    const bad = [`code=${code().slice(0, 42)}`, `code=${code()}A`, `code=${code().slice(0, 42)}+`, `code=${code().slice(0, 42)}%2F`,
      `code=${code()}&code=${code('B')}`, '', 'error=google', 'error=expired&error=expired', `code=${code()}%00`, `code=${code()}#x`]
    const out: string[][] = []
    for (const q of bad) {
      const f = await armed()
      out.push(await f.auth.handleReturnLink(`${RETURN_PREFIX}${q}`).then(() => f.replaces()))
    }
    check(`lien mal formé (${bad.length} : code de 42 ou 44 caractères, hors base64url, deux codes, sans code, autre erreur, suffixe) : jamais de rachat, la connexion normale de l’app (/login)`,
      out.every((r) => same(r, ['/login'])), out)
  }
  {
    const s = new MemStore(), local = new MemStore()
    const f = fake({ sessionStore: s, local })
    await f.auth.relay(relaySearch())
    const g = fake({ sessionStore: s, local })
    await g.auth.handleReturnLink(ERROR_LINK)
    check('demande échue (error=expired) : l’écran de connexion de l’app gardé par la page relais (back), jamais de rachat ; back effacé ensuite',
      same(g.replaces(), [BACK]) && g.closes() === 1 && s.getItem('pl.leadAuth.back') === null, g.log)
    const h = await armed()
    await h.auth.handleReturnLink(ERROR_LINK)
    check('error=expired sans back gardé (app relancée par le lien) : la connexion normale de l’app (/login)', same(h.replaces(), ['/login']), h.log)
    const evil = new MemStore()
    evil.setItem('pl.leadAuth.back', 'https://evil.example/login?next=x')
    const k = await armed({ sessionStore: evil })
    await k.auth.handleReturnLink(ERROR_LINK)
    check('back gardé mais hors de l’émetteur (stockage modifié) : /login, jamais ce back', same(k.replaces(), ['/login']), k.log)
  }
  {
    const f = await armed({ closeRejects: true })
    const r = await f.auth.handleReturnLink(LINK)
    const g = await armed({ browser: false })
    const r2 = await g.auth.handleReturnLink(LINK)
    check('Browser.close en erreur (Android, rien à fermer) ou plugin absent : le rachat a lieu quand même', r === 'redeem' && r2 === 'redeem' &&
      f.replaces().length === 1 && g.replaces().length === 1, { f: f.log, g: g.log })
  }
  {
    const PREVIEW = 'https://erplead-apercu-scanleads-projects.vercel.app'
    const f = await armed({ issuer: PREVIEW })
    await f.auth.handleReturnLink(LINK)
    const g = await armed({ issuer: async () => { throw new Error('hors ligne') } })
    await g.auth.handleReturnLink(LINK)
    const h = await armed({ issuer: 'javascript:alert(1)' })
    await h.auth.handleReturnLink(LINK)
    const k = await armed({ issuer: 'https://erplead.io/' })
    await k.auth.handleReturnLink(LINK)
    check('émetteur donné par le serveur (aperçu) : le rachat va chez lui ; serveur injoignable, émetteur invalide ou avec barre finale : https://erplead.io',
      f.replaces()[0] === redeemOf('A', PREVIEW) && [g, h, k].every((x) => x.replaces()[0] === redeemOf('A', DEFAULT_ISSUER)),
      { f: f.replaces(), g: g.replaces(), h: h.replaces(), k: k.replaces() })
  }
})

// ------------------------------------------------------------------ 2. page relais
await block('2. Page relais /lead-auth/google', async () => {
  {
    const f = fake()
    const views: string[] = []
    const r = await f.auth.relay(relaySearch(), (v) => views.push(v.mode))
    check('Android : back gardé (sessionStorage), Browser.open({ url: start&m=auto }) une fois (Custom Tab), aucune navigation, écoute de browserFinished, jamais la session iOS',
      r.outcome === 'opened' && r.back === BACK && same(f.opens(), [`${START}&m=auto`]) && f.replaces().length === 0 && same(views, ['browser']) &&
      f.session.getItem('pl.leadAuth.back') === BACK && f.log.includes('listen:Browser:browserFinished') && f.sessions().length === 0 && f.externals().length === 0, f.log)
    const again = await f.auth.relay(relaySearch())
    check('relais demandé deux fois dans la même page (double rendu de React) : un seul Browser.open', again.outcome === 'again' && f.opens().length === 1, f.log)
    f.fire('browserFinished')
    check(`navigateur refermé sans lien de retour : back après ${FINISH_GRACE_MS} ms (le lien peut arriver juste après sur Android)`,
      f.timers.length === 1 && f.timers[0].ms === FINISH_GRACE_MS && f.replaces().length === 0, f.timers)
    f.timers[0].fn()
    const g = fake({ local: f.local })
    g.auth.listen()
    g.fire('appUrlOpen', { url: LINK })
    await flush()
    check('… puis la vue web revient à l’écran de connexion de l’app (back), et la connexion en cours est effacée (un lien ensuite ne fait rien)',
      same(f.replaces(), [BACK]) && g.replaces().length === 0, { f: f.log, g: g.log })
  }
  {
    const f = fake()
    f.auth.listen()
    await f.auth.relay(relaySearch())
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    f.fire('browserFinished')
    f.timers.forEach((t) => t.fn())
    check('navigateur refermé APRÈS le lien de retour (Browser.close) : seulement le rachat, jamais back', same(f.replaces(), [redeemOf()]), f.log)
  }
  {
    // iOS 17.4+ : la session avec retour https rend l'adresse ; elle passe par le même traitement que les liens reçus.
    const f = fake({ platform: 'ios', session: { https: true, start: 'wait' } })
    const views: string[] = []
    f.auth.listen({ relayPage: true })
    const p = f.auth.relay(relaySearch(), (v) => views.push(v.mode))
    await flush()
    check('iOS 17.4+ : LeadAuthSession.start({ url: start&m=auto }) une fois (ASWebAuthenticationSession, retour https), jamais Browser.open ni Safari, back gardé',
      same(f.sessions(), [`${START}&m=auto`]) && f.opens().length === 0 && f.externals().length === 0 && same(views, ['session']) &&
      f.session.getItem('pl.leadAuth.back') === BACK && f.replaces().length === 0, f.log)
    f.waiting[0]?.resolve({ url: LINK })
    const r = await p
    // La même adresse arrive aussi comme Universal Link (ne devrait pas, mais) : une seule navigation.
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    check('iOS 17.4+ : adresse rendue par la session → rachat avec le code, une seule navigation (le même lien redonné par appUrlOpen est ignoré), aucun Browser.close',
      r.outcome === 'session' && same(f.replaces(), [redeemOf()]) && f.closes() === 0, { r, log: f.log })
    const g = fake({ platform: 'ios', session: { https: true, start: 'wait' } })
    const pg = g.auth.relay(relaySearch())
    await flush()
    g.waiting[0]?.resolve({ url: ERROR_LINK })
    await pg
    check('iOS 17.4+ : session revenue avec le lien d’erreur (départ échu) → back', same(g.replaces(), [BACK]), g.log)
  }
  {
    // Le lien arrive aussi comme Universal Link PENDANT la session (avant qu'elle ne rende l'adresse, ou alors qu'elle se dit
    // annulée) : un seul rachat, et la fin de la session ne ramène jamais à back par-dessus.
    const out: Record<string, unknown> = {}
    for (const end of ['même adresse', 'annulée', 'refusée']) {
      const f = fake({ platform: 'ios', session: { https: true, start: 'wait' } })
      f.auth.listen({ relayPage: true })
      const p = f.auth.relay(relaySearch())
      await flush()
      f.fire('appUrlOpen', { url: LINK })
      await flush()
      if (end === 'même adresse') f.waiting[0]?.resolve({ url: LINK })
      else f.waiting[0]?.reject(Object.assign(new Error(end), { code: end === 'annulée' ? 'canceled' : 'failed' }))
      const r = await p
      await flush()
      out[end] = { r: r.outcome, nav: f.replaces(), ext: f.externals().length }
    }
    check('iOS 17.4+ : lien reçu par appUrlOpen pendant la session, puis la session rend la même adresse, est annulée ou refusée : un seul rachat, jamais back ni Safari par-dessus',
      Object.values(out).every((x: any) => same(x.nav, [redeemOf()]) && x.ext === 0), out)
  }
  {
    const f = fake({ platform: 'ios', session: { https: true, start: { reject: 'canceled' } } })
    const r = await f.auth.relay(relaySearch())
    const g = fake({ local: f.local, platform: 'ios' })
    g.auth.listen()
    g.fire('appUrlOpen', { url: LINK })
    await flush()
    check('iOS 17.4+ : session annulée (canceled) → back, jamais Safari, la connexion en cours effacée (un lien ensuite ne fait rien)',
      r.outcome === 'canceled' && same(f.replaces(), [BACK]) && f.externals().length === 0 && g.replaces().length === 0, { f: f.log, g: g.log })
  }
  {
    const out: Record<string, unknown> = {}
    for (const c of ['failed', 'busy', 'unavailable', 'bad_url', '']) {
      const f = fake({ platform: 'ios', session: { https: true, start: { reject: c } } })
      const views: string[] = []
      const r = await f.auth.relay(relaySearch(), (v) => views.push(v.mode))
      f.auth.listen()
      f.fire('appUrlOpen', { url: LINK })
      await flush()
      out[c || 'sans code'] = { r: r.outcome, ext: f.externals(), views, nav: f.replaces() }
    }
    check('iOS 17.4+ : autre refus de la session (failed : domaine pas encore associé, busy, unavailable, bad_url, sans code) → Safari (openExternal start&m=tap), texte « Safari », puis le lien du bouton (Universal Link) racheté',
      Object.values(out).every((x: any) => x.r === 'safari' && same(x.ext, [`${START}&m=tap`]) && same(x.views, ['session', 'safari']) && same(x.nav, [redeemOf()])), out)
  }
  {
    const f = fake({ platform: 'ios', session: { https: true, start: { url: 'https://projectlead.io/autre?code=x' } } })
    const r = await f.auth.relay(relaySearch())
    const g = fake({ local: f.local, platform: 'ios' })
    g.auth.listen()
    g.fire('appUrlOpen', { url: LINK })
    await flush()
    check('iOS 17.4+ : session revenue sur une autre adresse (impossible : hôte et chemin fixés dans le Swift) → back, connexion en cours effacée',
      r.outcome === 'failed' && same(f.replaces(), [BACK]) && g.replaces().length === 0, { f: f.log, g: g.log })
  }
  {
    const out: Record<string, unknown> = {}
    for (const [name, https] of [['iOS 15 à 17.3', false], ['isAvailable en erreur', 'throws']] as const) {
      const f = fake({ platform: 'ios', session: { https } })
      const views: string[] = []
      const r = await f.auth.relay(relaySearch(), (v) => views.push(v.mode))
      out[name] = { r: r.outcome, ext: f.externals(), ses: f.sessions(), views, nav: f.replaces(), back: f.session.getItem('pl.leadAuth.back') }
    }
    check('iOS 15 à 17.3 (isAvailable → https: false, ou en erreur) : Safari (openExternal({ url: start&m=tap })) une fois, jamais la session, texte « Terminez la connexion dans Safari », back gardé, aucune navigation',
      Object.values(out).every((x: any) => x.r === 'safari' && same(x.ext, [`${START}&m=tap`]) && x.ses.length === 0 && same(x.views, ['safari']) &&
        x.nav.length === 0 && x.back === BACK), out)
  }
  {
    const out: Record<string, unknown> = {}
    for (const ext of ['rejects', 'not-opened'] as const) {
      const f = fake({ platform: 'ios', session: { https: false, external: ext } })
      const r = await f.auth.relay(relaySearch())
      const g = fake({ local: f.local, platform: 'ios' })
      g.auth.listen()
      g.fire('appUrlOpen', { url: LINK })
      await flush()
      out[ext] = { r: r.outcome, nav: f.replaces(), after: g.replaces() }
    }
    check('iOS : Safari ne s’ouvre pas (openExternal en erreur ou opened: false) → back, connexion en cours effacée',
      Object.values(out).every((x: any) => x.r === 'failed' && same(x.nav, [BACK]) && x.after.length === 0), out)
  }
  {
    const f = fake({ platform: 'ios', session: false })
    const r = await f.auth.relay(relaySearch())
    const g = fake({ platform: 'android', browser: false })
    const r2 = await g.auth.relay(relaySearch())
    check('coque sans le module attendu (iOS sans LeadAuthSession, Android sans Browser) : back, rien d’ouvert, aucune connexion notée',
      r.outcome === 'nomodule' && same(f.replaces(), [BACK]) && f.opens().length === 0 && !f.local.m.has('pl.leadAuth.pending') &&
      r2.outcome === 'nomodule' && same(g.replaces(), [BACK]), { f: f.log, g: g.log })
  }
  {
    const f = fake({ native: false })
    const r = await f.auth.relay(relaySearch())
    check('hors de l’app (site, navigateur) : back, rien d’ouvert, rien gardé', r.outcome === 'outside' && same(f.replaces(), [BACK]) &&
      f.opens().length === 0 && f.session.getItem('pl.leadAuth.back') === null && f.local.m.size === 0, f.log)
  }
  {
    const PREVIEW = 'https://erplead-apercu-scanleads-projects.vercel.app'
    const cases: [string, string][] = [
      ['https://evil.example/auth/google/app/start?d=x', BACK], ['https://erplead.io.evil.com/auth/google/app/start?d=x', BACK],
      [`${ISS}/auth/google/app/startx?d=x`, BACK], [`${ISS}/auth/google/app/start`, BACK], [`${ISS}/auth/google/callback?code=x`, BACK],
      ['http://erplead.io/auth/google/app/start?d=x', BACK], [`${START}\n`, BACK], [`${START} `, BACK], [`${START}&m=tap`, BACK], [`${START}#m=auto`, BACK],
      [START, `${ISS}/oauth/authorize?client_id=projectlead`], [START, 'javascript:alert(1)//https://erplead.io/login?'], [START, 'https://evil.example/login?x'],
      [START, `${ISS}/loginx?next=x`], [START, `${ISS}/login`],
    ]
    const results: string[] = []
    for (const plat of ['android', 'ios'] as const) {
      for (const [s, b] of cases) {
        const f = fake({ platform: plat })
        const r = await f.auth.relay(relaySearch(s, b))
        results.push(`${r.outcome}|${f.opens().length + f.sessions().length + f.externals().length}|${f.replaces().join(',')}`)
      }
    }
    for (const q of ['', `?start=${encodeURIComponent(START)}`, `?back=${encodeURIComponent(BACK)}`,
      `?start=${encodeURIComponent(START)}&start=${encodeURIComponent(START)}&back=${encodeURIComponent(BACK)}`]) {
      const f = fake()
      const r = await f.auth.relay(q)
      results.push(`${r.outcome}|${f.opens().length}|${f.replaces().join(',')}`)
    }
    // Un aperçu relié à un aperçu d'ERPlead : les adresses de la production ne passent pas, celles de l'aperçu oui.
    const p = fake({ issuer: PREVIEW })
    const rp = await p.auth.relay(relaySearch())
    results.push(`${rp.outcome}|${p.opens().length}|${p.replaces().join(',')}`)
    check(`start ou back hors des préfixes exacts de l’émetteur (${results.length} cas, Android et iOS : autre site, sous-domaine piège, autre chemin, http, caractère de contrôle, m déjà posé, fragment, autre page d’ERPlead, javascript:, absent, doublé, émetteur de l’aperçu) : rien d’ouvert, /login`,
      results.every((x) => x === 'invalid|0|/login'), results)
    const q = fake({ issuer: PREVIEW })
    const rq = await q.auth.relay(relaySearch(START.replace(ISS, PREVIEW), BACK.replace(ISS, PREVIEW)))
    check('émetteur de l’aperçu : start et back de l’aperçu acceptés', rq.outcome === 'opened' && q.opens()[0] === `${START.replace(ISS, PREVIEW)}&m=auto`, q.log)
  }
  {
    const f = fake({ openRejects: true })
    const r = await f.auth.relay(relaySearch())
    const g = fake({ local: f.local })
    await g.auth.handleReturnLink(LINK)
    check('Browser.open en erreur : back, et aucune connexion laissée en cours (un lien ensuite ne fait rien)', r.outcome === 'failed' && same(f.replaces(), [BACK]) &&
      g.replaces().length === 0, { f: f.log, g: g.log })
  }
})

// ------------------------------------------------------------------ 3. page /lead-auth/return
await block('3. Page /lead-auth/return', async () => {
  {
    const f = await armed()
    const r = await f.auth.returnPage(LINK)
    const g = fake()
    const r2 = await g.auth.returnPage(linkOf('J'))
    const h = await armed()
    const r3 = await h.auth.returnPage(`https://projectlead-abc-scanleads-projects.vercel.app/lead-auth/return?code=${code('K')}`)
    check('page de retour chargée DANS l’app : même traitement que le lien (connexion en cours → rachat) ; sans connexion en cours ou autre origine → l’accueil de l’app, jamais de rachat',
      r === 'redeem' && same(f.replaces(), [redeemOf()]) && r2 === 'unexpected' && same(g.replaces(), ['/']) && r3 === 'ignored' && same(h.replaces(), ['/']),
      { f: f.log, g: g.log, h: h.log })
  }
  const html = readFileSync(join(ROOT, 'lead-auth-return.html'), 'utf8')
  const inline = html.indexOf('history.replaceState(null, \'\', \'/lead-auth/return\')')
  const firstScript = html.indexOf('<script')
  const moduleScript = html.indexOf('<script type="module"')
  check('lead-auth-return.html : le premier script efface le code de l’adresse et de l’historique (hors de l’app), avant le module de la page ; la langue gardée avant',
    inline > 0 && firstScript < inline && inline < moduleScript && html.indexOf("get('locale')") < inline && /if \(!app\) history\.replaceState/.test(html), { firstScript, inline, moduleScript })
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  check('lead-auth-return.html : aucune ressource tierce (polices, mesure d’audience), aucun lien ni bouton, meta referrer no-referrer et robots noindex',
    urls.every((u) => u.startsWith('/')) && !/https?:\/\/(?!projectlead\.io\/lead-auth\/return)/.test(html.replace(/<!--[\s\S]*?-->/g, '')) && !/<a\b|<button\b|<form\b/.test(html) &&
    html.includes('<meta name="referrer" content="no-referrer" />') && html.includes('<meta name="robots" content="noindex" />'), urls)
  const mod = readFileSync(join(ROOT, 'src/leadAuthReturn.ts'), 'utf8')
  const imports = [...mod.matchAll(/(?:^|\n)import .* from '([^']+)'|import\('([^']+)'\)/g)].map((m) => m[1] ?? m[2])
  check('src/leadAuthReturn.ts : n’importe que src/lib/leadAppAuth et les textes de la page (un petit fichier par langue), aucun innerHTML',
    same(imports, ['./lib/leadAppAuth', ...['fr', 'de', 'en', 'it', 'es'].map((l) => `./i18n/locales/${l}/leadauth.json`)]) && !/innerHTML|insertAdjacentHTML/.test(mod), imports)
  const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
  check('vite.config.ts : deux pages construites (index.html, lead-auth-return.html)', /input: \{ main: path\.resolve\(__dirname, 'index\.html'\), leadAuthReturn: path\.resolve\(__dirname, 'lead-auth-return\.html'\) \}/.test(vite))
  const T: Record<string, Record<string, string>> = {}
  for (const l of ['fr', 'de', 'en', 'it', 'es']) T[l] = JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${l}/leadauth.json`), 'utf8'))
  const keys = ['leadauth.return.android', 'leadauth.return.body', 'leadauth.return.nothing', 'leadauth.return.title']
  check('page de retour : quatre textes dans les cinq langues (titre, que faire, Android « Ouvrir par défaut », « rien demandé »), tous différents d’une langue à l’autre, nommant ProjectLead',
    Object.values(T).every((d) => same(Object.keys(d).sort(), keys) && Object.values(d).every((v) => v.includes('ProjectLead'))) &&
    keys.every((k) => new Set(Object.values(T).map((d) => d[k])).size === 5) && T.fr['leadauth.return.title'] === 'Revenez dans ProjectLead' &&
    T.fr['leadauth.return.body'].includes('« Continuer avec Google »') && T.fr['leadauth.return.body'].includes('« Mot de passe oublié ? »'), T.fr)
})

// ------------------------------------------------------------------ 4. hors de l'app, serveur, écran
await block('4. Site web inchangé, émetteur du serveur, fichiers d’association, écran', async () => {
  const bridges = [undefined, {}, { Capacitor: undefined }, { Capacitor: {} }, { Capacitor: { isNativePlatform: () => false } },
    { Capacitor: { isNativePlatform: () => { throw new Error('x') } } }, { Capacitor: { isNativePlatform: true } }]
  check('site web (aucun pont, pont web, isNativePlatform faux ou cassé) : aucun pont natif reconnu', bridges.every((w) => nativeBridge(w as any) === null))
  check('pont natif (coque Capacitor) reconnu', nativeBridge({ Capacitor: { isNativePlatform: () => true, Plugins: {} } }) !== null)
  {
    const f = fake({ native: false, launchUrl: LINK })
    const on = f.auth.listen()
    await flush()
    const r = await f.auth.returnPage(LINK)
    check('site web : listen() ne pose aucun écouteur, aucun lien traité ; la page de retour ne rachète rien', on === false && f.log.filter((x) => !x.startsWith('replace:')).length === 0 &&
      r === 'unexpected' && !f.replaces().some((x) => x.includes('redeem')), f.log)
    const g = fake({ app: false })
    check('coque sans plugin App : aucun écouteur', g.auth.listen() === false)
  }
  const main = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
  check('src/main.tsx : l’écoute du lien de retour démarre avant le premier rendu, sur toutes les pages (page relais signalée)',
    /\nleadAppAuth\(\)\.listen\(\{ relayPage: window\.location\.pathname === RELAY_PATH \}\)\n/.test(main) && main.indexOf('leadAppAuth().listen(') < main.indexOf('initI18n()'))
  const appTsx = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8')
  const isPublic = new RegExp(appTsx.match(/const isPublic = \/(.+)\/\.test\(loc\.pathname\)/)?.[1] ?? '^$')
  check('la page relais est une route publique (sans session) : /lead-auth/google, et seulement elle',
    appTsx.includes("{ path: '/lead-auth/google', el: () => <LeadAuthGoogle /> }") && isPublic.test('/lead-auth/google') && !isPublic.test('/lead-auth/google/x') &&
    !isPublic.test('/lead-auth') && !isPublic.test('/projets'))
  const build = readFileSync(join(ROOT, 'scripts/vercel-build.mjs'), 'utf8')
  const fnRoute = new RegExp(JSON.parse(`"${build.match(/\{ src: '(\^\/\(api\|auth[^']+)', dest: '\/api' \}/)?.[1] ?? '^$'}"`))
  check('Vercel : /lead-auth/google et /lead-auth/return servies sans la fonction ; /auth/lead/callback et /.well-known/* par la fonction',
    !fnRoute.test('/lead-auth/google') && !fnRoute.test('/lead-auth/return') && fnRoute.test('/auth/lead/callback') && fnRoute.test('/api/auth/options') &&
    fnRoute.test('/.well-known/apple-app-site-association') && fnRoute.test('/.well-known/assetlinks.json'), String(fnRoute))
  const ret = build.match(/\{ src: '([^']+)', dest: '\/lead-auth-return\.html',\s*headers: (\{[^}]+\}) \}/)
  const retRe = ret ? new RegExp(JSON.parse(`"${ret[1]}"`)) : /^$/
  const headers = ret ? Function(`return (${ret[2]})`)() : {}
  check('Vercel : /lead-auth/return → lead-auth-return.html (réécriture, pas de redirection), avant les fichiers et l’application, avec Cache-Control: no-store, Referrer-Policy: no-referrer, X-Robots-Tag: noindex',
    retRe.test('/lead-auth/return') && !retRe.test('/lead-auth/return/') && !retRe.test('/lead-auth/returnx') && !retRe.test('/lead-auth/google') &&
    build.indexOf("dest: '/lead-auth-return.html'") < build.indexOf("{ handle: 'filesystem' }") && !/status:\s*30\d/.test(build.slice(build.indexOf('routes: ['))) &&
    same(headers, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }), { re: ret?.[1], headers })

  const { default: app } = await import('../server/index.ts')
  // Les fichiers d'association, comparés au contrat d'ERPlead (docs/GOOGLE-APP.md § 3d : exemple et tableau des empreintes).
  const contract = readFileSync(join(homedir(), 'projets/erplead-google-app/docs/GOOGLE-APP.md'), 'utf8')
  const aasaExample = JSON.parse(contract.match(/AASA \(exemple CRMlead[^\n]*\n```json\n([\s\S]+?)\n```/)?.[1] ?? 'null')
  const appId = contract.match(/\| ProjectLead \| `projectlead` \| `https:\/\/projectlead\.io\/lead-auth\/return` \| `([^`]+)` \| `io\.projectlead\.app` \|/)?.[1]
  const fp = contract.match(/\| projectlead\.io \| io\.projectlead\.app \| `([0-9A-F:]{95})` \| `([0-9A-F:]{95})` \|/)
  const wantAasa = JSON.parse(JSON.stringify(aasaExample).split('X6K5247J6G.io.crmlead.app').join(appId ?? '?'))
  const wantLinks = [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'io.projectlead.app',
    sha256_cert_fingerprints: [fp?.[1], fp?.[2]] } }]
  const wk: Record<string, unknown> = {}
  for (const [path, want] of [['/.well-known/apple-app-site-association', wantAasa], ['/.well-known/assetlinks.json', wantLinks]] as const) {
    for (const ua of ['AASA-Bot/1.0.0', 'Mozilla/5.0 (Linux; Android 14) Chrome/140', 'Google-Digital-Asset-Links']) {
      const res = await app.request(`http://localhost${path}`, { headers: { 'user-agent': ua } })
      const body = await res.text()
      let parsed: unknown = null
      try { parsed = JSON.parse(body) } catch {}
      wk[`${path} ${ua}`] = res.status === 200 && res.headers.get('content-type') === 'application/json' && !res.headers.get('location') && same(parsed, want)
    }
  }
  check(`fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json) : 200, application/json, aucune redirection, contenu EXACT du contrat (appID ${appId}, empreintes Play App Signing et clé d’envoi), pour tout agent`,
    aasaExample && appId === 'X6K5247J6G.io.projectlead.app' && fp && Object.values(wk).every(Boolean), wk)
  const options = async (iss: string | undefined) => {
    if (iss === undefined) delete process.env.LEAD_ID_ISSUER
    else process.env.LEAD_ID_ISSUER = iss
    const r = await app.request('http://localhost/api/auth/options')
    return (await r.json() as { leadIssuer?: string }).leadIssuer
  }
  const table = {
    production: await options('https://erplead.io'), slash: await options('https://erplead.io/'), retired: await options('https://crmlead.io'),
    preview: await options('https://erplead-apercu-scanleads-projects.vercel.app'), local: await options('http://127.0.0.1:4321'),
    absent: await options(undefined), http: await options('http://erplead.io'), query: await options('https://erplead.io?x=1'), junk: await options('pas une adresse'),
  }
  check('/api/auth/options → leadIssuer : LEAD_ID_ISSUER (production, aperçu, local), crmlead.io → erplead.io, absent ou invalide → https://erplead.io',
    same(table, { production: ISS, slash: ISS, retired: ISS, preview: 'https://erplead-apercu-scanleads-projects.vercel.app',
      local: 'http://127.0.0.1:4321', absent: ISS, http: ISS, query: ISS, junk: ISS }), table)

  const { useLocaleFromFiles } = await import('./i18n-node.ts')
  const { I18nProvider } = await import('../src/i18n/index.tsx')
  const { default: LeadAuthGoogle } = await import('../src/pages/LeadAuthGoogle.tsx')
  const texts: Record<string, string> = {}
  const safari: Record<string, string> = {}
  let all = true
  for (const l of ['fr', 'de', 'en', 'it', 'es'] as const) {
    useLocaleFromFiles(l)
    const d = JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${l}/shell.json`), 'utf8'))
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(StaticRouter, { location: `/lead-auth/google${relaySearch()}` }, createElement(LeadAuthGoogle))))
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
    const has = html.includes('data-lead-auth-relay') && html.includes(esc(d['shell.leadAuth.title'])) && html.includes(esc(d['shell.leadAuth.body'])) && !!d['shell.leadAuth.back']
    texts[l] = d['shell.leadAuth.title']
    safari[l] = d['shell.leadAuth.safari']
    all &&= has
  }
  const button = { fr: 'Ouvrir ProjectLead', de: 'ProjectLead öffnen', en: 'Open ProjectLead', it: 'Apri ProjectLead', es: 'Abrir ProjectLead' } as Record<string, string>
  check('page relais rendue dans les cinq langues (titre, texte ; « Retour » prêt) ; texte « Safari » dans les cinq langues, avec le libellé exact du bouton d’ERPlead',
    all && new Set(Object.values(texts)).size === 5 && Object.entries(safari).every(([l, s]) => s?.includes('Safari') && s.includes(button[l])), { texts, safari })
  const page = readFileSync(join(ROOT, 'src/pages/LeadAuthGoogle.tsx'), 'utf8')
  check('page relais : sous iOS 15 à 17.3 (mode safari), le texte « Terminez la connexion dans Safari, puis touchez « Ouvrir ProjectLead » »',
    page.includes("view?.mode === 'safari' ? t('shell.leadAuth.safari') : t('shell.leadAuth.body')"))
})

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
console.log(ko ? 'GOOGLE_APP_WEB_CHECK_KO' : 'GOOGLE_APP_WEB_CHECK_OK')
process.exit(ko ? 1 : 0)
