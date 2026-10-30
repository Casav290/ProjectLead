/**
 * « Continuer avec Google » dans l'app mobile (30.10.2026, contrat d'ERPlead docs/GOOGLE-APP.md ; porte G1 de
 * ~/projets/.unlazy/google-app/gates/leaf-projectlead.md) : le code web de l'app, sans serveur ni base.
 *
 *   npx tsx scripts/google-app-check.ts   → GOOGLE_APP_WEB_CHECK_OK (code 0), sinon GOOGLE_APP_WEB_CHECK_KO (code 1)
 *
 * src/lib/leadAppAuth.ts avec un faux pont Capacitor (App : appUrlOpen, getLaunchUrl ; Browser : open, close,
 * browserFinished), de faux stockages et un location.replace noté :
 * 1. le lien de retour exact `io.projectlead.app://lead-auth?code=…`, pendant une connexion Google en cours (page relais)
 *    → Browser.close, puis la vue web au rachat d'ERPlead avec le code, UNE fois (appUrlOpen et getLaunchUrl, page
 *    rechargée, le lendemain) ; liens étrangers ignorés ; lien mal formé ou demande échue → l'écran de connexion de l'app
 *    (back) ou /login, jamais de rachat ; sans connexion en cours (lien venu d'ailleurs, connexion échue ou déjà revenue,
 *    ancien lien redonné par getLaunchUrl) : rien ;
 * 2. la page relais : préfixes exacts de l'émetteur, back gardé, Browser.open({ url: start }) une fois, navigateur refermé
 *    sans retour → back ; hors de l'app → back ;
 * 3. rien hors de l'app (site web : aucun écouteur) ; l'émetteur vient du serveur (/api/auth/options → leadIssuer) ;
 *    page relais publique, rendue dans les cinq langues, servie par l'application sur Vercel.
 */
import { readFileSync } from 'node:fs'
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

const L = await import('../src/lib/leadAppAuth.ts')
const { createLeadAppAuth, nativeBridge, RETURN_PREFIX, FINISH_GRACE_MS, DEFAULT_ISSUER } = L

const ISS = 'https://erplead.io'
const code = (c = 'A') => (c.repeat(40) + '_-9').slice(0, 43)
const LINK = `${RETURN_PREFIX}code=${code()}`
const START = `${ISS}/auth/google/app/start?d=projectlead.${'x'.repeat(43)}`
const BACK = `${ISS}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dprojectlead%26platform%3Dapp&locale=fr`
const relaySearch = (start = START, back = BACK) => `?${new URLSearchParams({ start, back })}`

class MemStore {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

type FakeOpts = {
  native?: boolean; app?: boolean; browser?: boolean; closeRejects?: boolean; openRejects?: boolean
  issuer?: string | (() => Promise<string>); launchUrl?: string | null; local?: MemStore; session?: MemStore
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
  const on = (plugin: string) => (event: string, cb: (d: any) => void) => {
    log.push(`listen:${plugin}:${event}`); (listeners[event] ??= []).push(cb); return { remove: async () => {} }
  }
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
  const bridge = o.native === false ? null : { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins }
  const local = o.local ?? new MemStore(), session = o.session ?? new MemStore()
  const auth = createLeadAppAuth({
    bridge, local, session,
    replace: (url) => log.push(`replace:${url}`),
    issuer: typeof o.issuer === 'function' ? o.issuer : async () => (o.issuer as string | undefined) ?? ISS,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    ...(o.now ? { now: o.now } : {}),
  })
  const fire = (event: string, data?: unknown) => (listeners[event] ?? []).forEach((cb) => cb(data))
  const replaces = () => log.filter((x) => x.startsWith('replace:')).map((x) => x.slice('replace:'.length))
  return { auth, log, fire, timers, local, session, replaces, closes: () => log.filter((x) => x === 'close').length,
    opens: () => log.filter((x) => x.startsWith('open:')).map((x) => x.slice(5)) }
}
/**
 * Une connexion Google en cours, comme dans l'app : la page relais d'un chargement précédent (même localStorage, autre
 * sessionStorage : comme une app relancée par le lien) a ouvert le navigateur du téléphone ; puis la page qui reçoit le lien.
 */
async function armed(o: FakeOpts = {}) {
  const local = o.local ?? new MemStore()
  const r = await fake({ local, now: o.now }).auth.relay(relaySearch())
  if (r.outcome !== 'opened') throw new Error(`relais : ${r.outcome}`)
  return fake({ ...o, local })
}

// ------------------------------------------------------------------ 1. lien de retour
await block('1. Lien de retour io.projectlead.app://lead-auth', async () => {
  {
    const f = await armed()
    check('écoute posée dans l’app : appUrlOpen (App), lien de lancement lu', f.auth.listen() === true && f.log.includes('listen:App:appUrlOpen'), f.log)
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    const close = f.log.indexOf('close'), nav = f.log.findIndex((x) => x.startsWith('replace:'))
    check('lien de retour exact (schéma io.projectlead.app, hôte lead-auth, code de 43 caractères) : Browser.close, puis la vue web au rachat d’ERPlead avec le code, une seule navigation',
      f.closes() === 1 && close >= 0 && close < nav && JSON.stringify(f.replaces()) === JSON.stringify([`${ISS}/auth/google/app/redeem?code=${code()}`]), f.log)
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
    const g = fake({ launchUrl: LINK, local: f.local, session: f.session })
    g.auth.listen()
    await flush()
    check('page rechargée (nouvelle instance, même localStorage) : le lien de lancement déjà traité est ignoré (ni navigation, ni fermeture)',
      g.replaces().length === 0 && g.closes() === 0, g.log)
    const other = `${RETURN_PREFIX}code=${code('B')}`
    g.fire('appUrlOpen', { url: other })
    await flush()
    check('une seule connexion par page relais : après le retour, un autre lien (autre code, sans nouvelle page relais) est ignoré (ni navigation, ni fermeture)',
      g.replaces().length === 0 && g.closes() === 0, g.log)
    const h = await armed({ local: f.local, session: f.session })
    h.auth.listen()
    const third = `${RETURN_PREFIX}code=${code('D')}`
    h.fire('appUrlOpen', { url: third })
    await flush()
    check('nouvelle connexion Google (nouvelle page relais) : son lien est traité, une fois', JSON.stringify(h.replaces()) === JSON.stringify([`${ISS}/auth/google/app/redeem?code=${code('D')}`]), h.log)
    check('le stockage ne garde que des empreintes (jamais le code)', ![...f.local.m.values(), ...f.session.m.values()].join(' ').includes(code()), [...f.local.m.values()])
  }
  {
    // Le scénario de la relecture : lundi 9 h connexion Google ; l'app reste en mémoire et iOS redonne le même lien
    // (lastURL) à chaque chargement complet de page ; mardi 9 h 30, la reconnexion silencieuse recharge la page.
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
    // Le lendemain, une nouvelle connexion Google : getLaunchUrl redonne toujours le lien de lundi sur la page relais.
    let clock = Date.parse('2026-11-02T09:00:00Z')
    const now = () => clock
    const f = await armed({ now })
    f.auth.listen()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    clock = Date.parse('2026-11-03T10:00:00Z')
    const k = fake({ launchUrl: LINK, local: f.local, now })
    k.auth.listen()
    await k.auth.relay(relaySearch())
    await flush()
    const fresh = `${RETURN_PREFIX}code=${code('E')}`
    k.fire('appUrlOpen', { url: fresh })
    await flush()
    check('le lendemain, nouvelle connexion Google : le lien de lundi que getLaunchUrl redonne sur la page relais est ignoré, seul le nouveau lien est racheté',
      JSON.stringify(k.replaces()) === JSON.stringify([`${ISS}/auth/google/app/redeem?code=${code('E')}`]), k.log)
  }
  {
    const f = fake()
    f.auth.listen()
    f.fire('appUrlOpen', { url: LINK })
    f.fire('appUrlOpen', { url: `${RETURN_PREFIX}error=expired` })
    await flush()
    check('aucune connexion Google en cours (aucune page relais) : un lien de retour venu d’ailleurs (courriel, page, code QR, autre app), code ou error=expired, est ignoré (ni navigation, ni fermeture)',
      f.replaces().length === 0 && f.closes() === 0, f.log)
    // Ce lien ne sert pas non plus plus tard : la page relais suivante (getLaunchUrl le redonne) ne le prend pas pour son retour.
    const g = fake({ launchUrl: LINK, local: f.local })
    g.auth.listen()
    await g.auth.relay(relaySearch())
    await flush()
    check('… et une connexion Google suivante ne le reprend pas (getLaunchUrl le redonne sur la page relais) : ni navigation, ni fermeture',
      g.replaces().length === 0 && g.closes() === 0, g.log)
  }
  {
    // La coque répond lentement à getLaunchUrl : la page relais attend sa réponse avant de poser l'attente.
    const stale = `${RETURN_PREFIX}code=${code('F')}`
    const f = fake({ launchUrl: stale, launchDelayMs: 40 })
    f.auth.listen()
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
    g.fire('appUrlOpen', { url: LINK })
    await flush()
    check('connexion en cours échue (page relais il y a 16 min, ERPlead garde le départ 10 min) : lien ignoré ; à 14 min : racheté',
      f.replaces().length === 0 && f.closes() === 0 && JSON.stringify(g.replaces()) === JSON.stringify([`${ISS}/auth/google/app/redeem?code=${code()}`]), { f: f.log, g: g.log })
  }
  {
    const foreign = [
      `io.crmlead.app://lead-auth?code=${code()}`, `io.projectlead.app://sso?code=${code()}`, `io.projectlead.app://lead-auth/x?code=${code()}`,
      `io.projectlead.appx://lead-auth?code=${code()}`, `io.projectlead://lead-auth?code=${code()}`, `https://projectlead.io/lead-auth?code=${code()}`,
      `IO.PROJECTLEAD.APP://lead-auth?code=${code()}`, ` ${LINK}`, `io.projectlead.app://lead-auth.evil?code=${code()}`, `io.projectlead.app://lead-auth`,
      `io.projectlead.app://LEAD-AUTH?code=${code()}`, '', null, 42, { url: LINK },
    ]
    const f = await armed()
    f.auth.listen()
    for (const u of foreign) f.fire('appUrlOpen', { url: u })
    f.fire('appUrlOpen', undefined)
    await flush()
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    check(`liens étrangers ignorés (${foreign.length + 1} : autre app, ancien retour sso, autre chemin ou hôte, schéma voisin, https, majuscules, espace, vide, pas une chaîne) : ni navigation, ni fermeture, la connexion en cours attend toujours son lien`,
      JSON.stringify(f.replaces()) === JSON.stringify([`${ISS}/auth/google/app/redeem?code=${code()}`]) && f.closes() === 1, f.log)
  }
  {
    const bad = [`code=${code().slice(0, 42)}`, `code=${code()}A`, `code=${code().slice(0, 42)}+`, `code=${code().slice(0, 42)}%2F`,
      `code=${code()}&code=${code('B')}`, '', 'error=google', `code=${code()}%00`, `code=${code()}#x`]
    const out: string[][] = []
    for (const q of bad) {
      const f = await armed()
      out.push(await f.auth.handleReturnLink(`${RETURN_PREFIX}${q}`).then(() => f.replaces()))
    }
    check(`lien mal formé (${bad.length} : code de 42 ou 44 caractères, hors base64url, deux codes, sans code, suffixe) : jamais de rachat, la connexion normale de l’app (/login)`,
      out.every((r) => JSON.stringify(r) === '["/login"]'), out)
  }
  {
    const s = new MemStore(), local = new MemStore()
    const f = fake({ session: s, local })
    await f.auth.relay(relaySearch())
    const g = fake({ session: s, local })
    await g.auth.handleReturnLink(`${RETURN_PREFIX}error=expired`)
    check('demande échue (error=expired) : l’écran de connexion de l’app gardé par la page relais (back), jamais de rachat ; back effacé ensuite',
      JSON.stringify(g.replaces()) === JSON.stringify([BACK]) && g.closes() === 1 && s.getItem('pl.leadAuth.back') === null, g.log)
    const h = await armed()
    await h.auth.handleReturnLink(`${RETURN_PREFIX}error=expired`)
    check('error=expired sans back gardé (app relancée par le lien) : la connexion normale de l’app (/login)', JSON.stringify(h.replaces()) === '["/login"]', h.log)
    const evil = new MemStore()
    evil.setItem('pl.leadAuth.back', 'https://evil.example/login?next=x')
    const k = await armed({ session: evil })
    await k.auth.handleReturnLink(`${RETURN_PREFIX}error=expired`)
    check('back gardé mais hors de l’émetteur (stockage modifié) : /login, jamais ce back', JSON.stringify(k.replaces()) === '["/login"]', k.log)
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
      f.replaces()[0] === `${PREVIEW}/auth/google/app/redeem?code=${code()}` && [g, h, k].every((x) => x.replaces()[0] === `${DEFAULT_ISSUER}/auth/google/app/redeem?code=${code()}`),
      { f: f.replaces(), g: g.replaces(), h: h.replaces(), k: k.replaces() })
  }
})

// ------------------------------------------------------------------ 2. page relais
await block('2. Page relais /lead-auth/google', async () => {
  {
    const f = fake()
    const r = await f.auth.relay(relaySearch())
    check('dans l’app : back gardé (sessionStorage), Browser.open({ url: start }) une fois, aucune navigation, écoute de browserFinished',
      r.outcome === 'opened' && r.back === BACK && JSON.stringify(f.opens()) === JSON.stringify([START]) && f.replaces().length === 0 &&
      f.session.getItem('pl.leadAuth.back') === BACK && f.log.includes('listen:Browser:browserFinished'), f.log)
    const again = await f.auth.relay(relaySearch())
    check('relais demandé deux fois dans la même page (double rendu de React) : un seul Browser.open', again.outcome === 'again' && f.opens().length === 1, f.log)
    f.fire('browserFinished')
    check(`navigateur refermé sans lien de retour : back après ${FINISH_GRACE_MS} ms (le lien peut arriver juste après sur Android)`,
      f.timers.length === 1 && f.timers[0].ms === FINISH_GRACE_MS && f.replaces().length === 0, f.timers)
    f.timers[0].fn()
    check('… puis la vue web revient à l’écran de connexion de l’app (back)', JSON.stringify(f.replaces()) === JSON.stringify([BACK]), f.log)
  }
  {
    const f = fake()
    f.auth.listen()
    await f.auth.relay(relaySearch())
    f.fire('appUrlOpen', { url: LINK })
    await flush()
    f.fire('browserFinished')
    f.timers.forEach((t) => t.fn())
    check('navigateur refermé APRÈS le lien de retour (Browser.close) : seulement le rachat, jamais back', JSON.stringify(f.replaces()) === JSON.stringify([`${ISS}/auth/google/app/redeem?code=${code()}`]), f.log)
  }
  {
    const f = fake({ native: false })
    const r = await f.auth.relay(relaySearch())
    check('hors de l’app (site, navigateur) : back, Browser.open jamais appelé, rien gardé', r.outcome === 'outside' && JSON.stringify(f.replaces()) === JSON.stringify([BACK]) &&
      f.opens().length === 0 && f.session.getItem('pl.leadAuth.back') === null && f.local.m.size === 0, f.log)
    const g = fake({ browser: false })
    const r2 = await g.auth.relay(relaySearch())
    check('coque sans @capacitor/browser (ancienne app) : back, comme hors de l’app', r2.outcome === 'outside' && JSON.stringify(g.replaces()) === JSON.stringify([BACK]), g.log)
  }
  {
    const PREVIEW = 'https://erplead-apercu-scanleads-projects.vercel.app'
    const cases: [string, string][] = [
      ['https://evil.example/auth/google/app/start?d=x', BACK], ['https://erplead.io.evil.com/auth/google/app/start?d=x', BACK],
      [`${ISS}/auth/google/app/startx?d=x`, BACK], [`${ISS}/auth/google/app/start`, BACK], [`${ISS}/auth/google/callback?code=x`, BACK],
      ['http://erplead.io/auth/google/app/start?d=x', BACK], [`${START}\n`, BACK], [`${START} `, BACK],
      [START, `${ISS}/oauth/authorize?client_id=projectlead`], [START, 'javascript:alert(1)//https://erplead.io/login?'], [START, 'https://evil.example/login?x'],
      [START, `${ISS}/loginx?next=x`], [START, `${ISS}/login`],
    ]
    const results: string[] = []
    for (const [s, b] of cases) {
      const f = fake()
      const r = await f.auth.relay(relaySearch(s, b))
      results.push(`${r.outcome}|${f.opens().length}|${f.replaces().join(',')}`)
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
    check(`start ou back hors des préfixes exacts de l’émetteur (${results.length} cas : autre site, sous-domaine piège, autre chemin, http, caractère de contrôle, autre page d’ERPlead, javascript:, absent, doublé, émetteur de l’aperçu) : rien d’ouvert, /login`,
      results.every((x) => x === 'invalid|0|/login'), results)
    const q = fake({ issuer: PREVIEW })
    const rq = await q.auth.relay(relaySearch(START.replace(ISS, PREVIEW), BACK.replace(ISS, PREVIEW)))
    check('émetteur de l’aperçu : start et back de l’aperçu acceptés', rq.outcome === 'opened' && q.opens()[0] === START.replace(ISS, PREVIEW), q.log)
  }
  {
    const f = fake({ openRejects: true })
    const r = await f.auth.relay(relaySearch())
    const g = fake({ local: f.local })
    await g.auth.handleReturnLink(LINK)
    check('Browser.open en erreur : back, et aucune connexion laissée en cours (un lien ensuite ne fait rien)', r.outcome === 'failed' && JSON.stringify(f.replaces()) === JSON.stringify([BACK]) &&
      g.replaces().length === 0, { f: f.log, g: g.log })
  }
})

// ------------------------------------------------------------------ 3. hors de l'app, serveur, écran
await block('3. Site web inchangé, émetteur du serveur, écran', async () => {
  const bridges = [undefined, {}, { Capacitor: undefined }, { Capacitor: {} }, { Capacitor: { isNativePlatform: () => false } },
    { Capacitor: { isNativePlatform: () => { throw new Error('x') } } }, { Capacitor: { isNativePlatform: true } }]
  check('site web (aucun pont, pont web, isNativePlatform faux ou cassé) : aucun pont natif reconnu', bridges.every((w) => nativeBridge(w as any) === null))
  check('pont natif (coque Capacitor) reconnu', nativeBridge({ Capacitor: { isNativePlatform: () => true, Plugins: {} } }) !== null)
  {
    const f = fake({ native: false, launchUrl: LINK })
    const on = f.auth.listen()
    await flush()
    check('site web : listen() ne pose aucun écouteur, aucun lien traité', on === false && f.log.length === 0, f.log)
    const g = fake({ app: false })
    check('coque sans plugin App : aucun écouteur', g.auth.listen() === false)
  }
  const main = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
  check('src/main.tsx : l’écoute du lien de retour démarre avant le premier rendu, sur toutes les pages', /\nleadAppAuth\(\)\.listen\(\)\n/.test(main) &&
    main.indexOf('leadAppAuth().listen()') < main.indexOf('initI18n()'))
  const appTsx = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8')
  const isPublic = new RegExp(appTsx.match(/const isPublic = \/(.+)\/\.test\(loc\.pathname\)/)?.[1] ?? '^$')
  check('la page relais est une route publique (sans session) : /lead-auth/google, et seulement elle',
    appTsx.includes("{ path: '/lead-auth/google', el: () => <LeadAuthGoogle /> }") && isPublic.test('/lead-auth/google') && !isPublic.test('/lead-auth/google/x') &&
    !isPublic.test('/lead-auth') && !isPublic.test('/projets'))
  const build = readFileSync(join(ROOT, 'scripts/vercel-build.mjs'), 'utf8')
  const fnRoute = new RegExp(JSON.parse(`"${build.match(/\{ src: '(\^\/\(api\|auth[^']+)', dest: '\/api' \}/)?.[1] ?? '^$'}"`))
  check('Vercel : /lead-auth/google est servie par l’application (pas par la fonction), /auth/lead/callback par la fonction',
    !fnRoute.test('/lead-auth/google') && fnRoute.test('/auth/lead/callback') && fnRoute.test('/api/auth/options'), String(fnRoute))

  const { default: app } = await import('../server/index.ts')
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
    JSON.stringify(table) === JSON.stringify({ production: ISS, slash: ISS, retired: ISS, preview: 'https://erplead-apercu-scanleads-projects.vercel.app',
      local: 'http://127.0.0.1:4321', absent: ISS, http: ISS, query: ISS, junk: ISS }), table)

  const { useLocaleFromFiles } = await import('./i18n-node.ts')
  const { I18nProvider } = await import('../src/i18n/index.tsx')
  const { default: LeadAuthGoogle } = await import('../src/pages/LeadAuthGoogle.tsx')
  const texts: Record<string, string> = {}
  let all = true
  for (const l of ['fr', 'de', 'en', 'it', 'es'] as const) {
    useLocaleFromFiles(l)
    const d = Object.assign({}, ...['shell'].map((p) => JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${l}/${p}.json`), 'utf8'))))
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(StaticRouter, { location: `/lead-auth/google${relaySearch()}` }, createElement(LeadAuthGoogle))))
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
    const has = html.includes('data-lead-auth-relay') && html.includes(esc(d['shell.leadAuth.title'])) && html.includes(esc(d['shell.leadAuth.body'])) && !!d['shell.leadAuth.back']
    texts[l] = d['shell.leadAuth.title']
    all &&= has
  }
  check('page relais rendue dans les cinq langues (titre, texte ; « Retour » prêt)', all && new Set(Object.values(texts)).size === 5, texts)
})

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
console.log(ko ? 'GOOGLE_APP_WEB_CHECK_KO' : 'GOOGLE_APP_WEB_CHECK_OK')
process.exit(ko ? 1 : 0)
