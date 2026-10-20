#!/usr/bin/env node
/**
 * « Se déconnecter » sous un Compte Lead lent, EN LOCAL, navigateur sans tête (Playwright) (relecture du 20.10.2026).
 * Après avoir fermé sa session, la page part vers la déconnexion d'ERPlead (/oauth/logout) et l'attend, parfois
 * plusieurs secondes. Rien ne doit l'en détourner vers la connexion : sinon la session ERPlead reste ouverte, et la
 * personne rentre dans l'espace sans formulaire. Un retard (3 s par défaut) est posé sur /oauth/logout du faux Compte
 * Lead. Manches, chacune dans un navigateur neuf, avec une personne et une entreprise neuves :
 *   simple      un clic ;
 *   double      2e clic DANS la page 700 ms après la réponse de POST /api/auth/logout : une personne qui ne voit rien
 *               bouger (c34a3ca : 2e POST sans cookie, réponse « /login », qui coupait la sortie) ;
 *   double-tot  2e clic aussitôt, avant la réponse ;
 *   echap       sortie arrêtée (Échap ou Stop : window.stop()), menu fermé par Échap, rouvert, nouveau clic ;
 *   relecture   pendant la sortie, la relecture de /me (son minuteur de 60 s, joué aussitôt) et un 401 d'une autre
 *               lecture (1804451 : l'écran de connexion repartait seul et coupait la sortie) ;
 *   retour      bouton Précédent depuis l'écran de connexion du Compte Lead : ni l'espace, ni une boucle.
 * Attendu à chaque manche : le Compte Lead reçoit la déconnexion de ce navigateur et ferme sa session ; aucune
 * autorisation n'est rendue sans écran après le clic ; la page finit sur l'écran de connexion du Compte Lead (champ de
 * mot de passe), jamais dans l'espace ([data-lead-org]) ; <ProjectLead>/login rouvert ensuite : l'écran de connexion.
 *
 *   npm run build
 *   TEST_DATABASE_URL=postgres://…@localhost:5432/… node scripts/e2e-deconnexion.mjs [--manches double,echap] [--retard 3000]
 *   → E2E_DECONNEXION_OK (code 0) ou E2E_DECONNEXION_KO (code 1)
 *   PROJECTLEAD_DIR=<une autre copie du dépôt, construite> : la même chose contre une autre version (témoins : double et
 *   echap rouges sur c34a3ca, relecture rouge sur 1804451).
 *
 * Garde-fous : base locale seulement ; faux Compte Lead lancé ici sur 127.0.0.1 ; aucun service extérieur, aucun e-mail ;
 * aucune variable du poste transmise au serveur local hors de celles listées ici.
 */
import { execFileSync, spawn } from 'node:child_process'
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const DIR = process.env.PROJECTLEAD_DIR ?? ROOT
const DB = process.env.TEST_DATABASE_URL ?? ''
const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const ALL = ['simple', 'double', 'double-tot', 'echap', 'relecture', 'retour']
const MANCHES = opt('--manches', ALL.join(',')).split(',').filter(Boolean)
const DELAY = Number(opt('--retard', '3000'))
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(DB)) { console.error('TEST_DATABASE_URL doit viser une base locale.'); process.exit(2) }
for (const m of MANCHES) if (!ALL.includes(m)) { console.error(`manche inconnue : ${m} (${ALL.join(', ')})`); process.exit(2) }
if (!existsSync(join(DIR, 'dist', 'index.html'))) execFileSync('npx', ['vite', 'build'], { cwd: DIR, stdio: 'inherit' })

let ok = 0, ko = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
  return Boolean(cond)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (x) => (d += x)); req.on('end', () => r(d)) })

// ------------------------------------------------------------------ faux Compte Lead (ERPlead), une session par navigateur
// Comme ERPlead : une autorisation sans session ouverte montre l'écran de connexion (prompt=none : login_required) ;
// avec une session, un code sans écran. /oauth/logout ferme la session de CE navigateur sur preuve (id_token_hint de sa
// personne, signé ici), efface son cookie et revient à l'application.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'deconnexion', alg: 'RS256', use: 'sig' }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims) => {
  const h = b64({ alg: 'RS256', kid: 'deconnexion', typ: 'JWT' }), p = b64(claims)
  return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`
}
const hintOf = (token) => {
  try {
    const [h, p, s] = String(token ?? '').split('.')
    return verify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')) ? JSON.parse(Buffer.from(p, 'base64url').toString()) : null
  } catch { return null }
}
const plan = { code: 'free', name: 'Gratuit', rank: 0, seats: 1, source: 'free', valid_until: null }
const rights = { app: 'projectlead', plan, org_seats: 1, subscriptions: [],
  apps: { projectlead: { access: true, name: 'ProjectLead', url: null, status: 'live', upgrade_url: 'https://projectlead.io/reglages/entreprise', plan } } }
const SCREEN = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion</title></head><body>'
  + '<h1>Connexion au Compte Lead (faux)</h1><form><input type="email" name="email"><input type="password" name="password">'
  + '<button type="submit">Se connecter</button></form></body></html>'
const people = new Map()      // manche → personne
const sessions = new Map()    // cookie fake_lead_sid (= sid) → personne
const codes = new Map()
const logouts = []            // { sid, at }
const authorizes = []         // { at, prompt, session }
let ISS = ''
const iss = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const sid = /(?:^|;\s*)fake_lead_sid=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null
  const person = sid ? sessions.get(sid) ?? null : null
  if (url.pathname === '/test/session') {
    const s = randomBytes(12).toString('hex')
    sessions.set(s, people.get(url.searchParams.get('p')))
    res.writeHead(200, { 'set-cookie': `fake_lead_sid=${s}; Path=/; HttpOnly; SameSite=Lax`, 'content-type': 'text/plain; charset=utf-8' })
    return res.end('session du Compte Lead ouverte')
  }
  if (url.pathname === '/oauth/authorize') {
    authorizes.push({ at: Date.now(), prompt: url.searchParams.get('prompt'), session: Boolean(person) })
    const back = new URL(url.searchParams.get('redirect_uri') ?? '')
    back.searchParams.set('state', url.searchParams.get('state') ?? '')
    if (!person && url.searchParams.get('prompt') !== 'none') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(SCREEN) }
    if (!person) back.searchParams.set('error', 'login_required')
    else {
      const code = randomBytes(12).toString('hex')
      codes.set(code, { person, sid, nonce: url.searchParams.get('nonce') })
      back.searchParams.set('code', code)
    }
    res.writeHead(302, { location: back.href }); return res.end()
  }
  if (url.pathname === '/oauth/logout') {
    const hint = hintOf(url.searchParams.get('id_token_hint'))
    if (person && hint?.sub === person.sub) { sessions.delete(sid); logouts.push({ sid, at: Date.now() }) }
    res.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') ?? '/', 'set-cookie': 'fake_lead_sid=; Path=/; Max-Age=0' })
    return res.end()
  }
  res.setHeader('content-type', 'application/json')
  if (url.pathname === '/oauth/jwks') return res.end(JSON.stringify({ keys: [jwk] }))
  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req))
    const c = codes.get(f.get('code') ?? '')
    codes.delete(f.get('code') ?? '')
    if (!c) { res.statusCode = 400; return res.end('{"error":"invalid_grant"}') }
    const now = Math.floor(Date.now() / 1000)
    const idt = jwt({ iss: ISS, aud: 'projectlead', iat: now, exp: now + 900, auth_time: now, nonce: c.nonce, sid: c.sid, ...c.person, lead: rights })
    return res.end(JSON.stringify({ access_token: 'deconnexion-local', id_token: idt, token_type: 'Bearer', expires_in: 900, scope: 'openid email profile lead' }))
  }
  res.statusCode = 404; res.end('{}')
})
ISS = `http://127.0.0.1:${await listen(iss)}`

// ------------------------------------------------------------------ serveur ProjectLead local (base de test)
const freePort = async () => { const s = createServer(); const p = await listen(s); await new Promise((r) => s.close(r)); return p }
const port = Number(process.env.E2E_PORT ?? await freePort())
const BASE = `http://localhost:${port}`
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', PORT: String(port), PUBLIC_URL: BASE, DATABASE_URL: DB,
  APP_SECRET: randomBytes(24).toString('hex'), JOBS_DISABLED: '1',
  LEAD_ID_ISSUER: ISS, LEAD_ID_CLIENT_ID: 'projectlead', LEAD_ID_CLIENT_SECRET: 'lid_deconnexion_local', LEAD_ID_APP: 'projectlead',
  LEAD_ID_REDIRECT_URI: `${BASE}/auth/lead/callback`,
}
const tsx = join(DIR, 'node_modules/.bin/tsx')
execFileSync(tsx, ['server/migrate.ts'], { cwd: DIR, env, stdio: 'ignore' })
const server = spawn(tsx, ['server/index.ts'], { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] })
const serverLog = []
server.stdout.on('data', (d) => serverLog.push(String(d)))
server.stderr.on('data', (d) => serverLog.push(String(d)))
for (let i = 0; ; i++) {
  if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok) break
  if (i > 60) { console.error('serveur local muet', serverLog.join('').slice(-2000)); server.kill(); process.exit(1) }
  await sleep(500)
}

// ------------------------------------------------------------------ manches
const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const browser = await chromium.launch({ headless: true })
const LABEL = /^\s*(Se déconnecter|Déconnexion…)\s*$/
const snapshot = (page) => page.evaluate(() => ({
  url: location.href,
  leadOrg: document.querySelector('[data-lead-org]')?.getAttribute('data-lead-org') ?? null,
  password: [...document.querySelectorAll('input[type="password"]')].some((e) => e.getClientRects().length > 0),
})).catch((e) => ({ url: page.url(), leadOrg: null, password: false, error: String(e.message).slice(0, 120) }))
const settle = async (page) => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await sleep(1000) }

async function manche(name) {
  console.log(`\nManche « ${name} » (retard de ${DELAY} ms sur la déconnexion du Compte Lead)`)
  const id = `${name}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const person = { sub: `sub-${id}`, email: `deconnexion-${id}@exemple.test`, email_verified: true, name: 'Paula Déconnexion', locale: 'fr',
    zoneinfo: 'Europe/Zurich', org: `org-deconnexion-${id}`, org_name: `TEST Déconnexion ${id}`, org_role: 'admin' }
  people.set(id, person)
  const ctx = await browser.newContext({ locale: 'fr-CH', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const events = []
  const ko0 = ko
  try {
    // La relecture de /me de src/lib/store.tsx (setInterval de 60 s) : gardée sous la main pour la jouer pendant la sortie.
    await ctx.addInitScript(() => {
      const set = window.setInterval, clear = window.clearInterval
      window.__minute = new Map()
      window.setInterval = function (fn, ms, ...rest) {
        const t = set.call(window, fn, ms, ...rest)
        if (ms === 60_000 && typeof fn === 'function') window.__minute.set(t, fn)
        return t
      }
      window.clearInterval = function (t) { window.__minute.delete(t); return clear.call(window, t) }
    })
    await page.goto(`${ISS}/test/session?p=${id}`)
    const sid = (await ctx.cookies(ISS)).find((c) => c.name === 'fake_lead_sid' && c.value)?.value ?? null
    await page.goto(`${BASE}/login`)
    await page.waitForSelector(`[data-lead-org="${person.org}"]`, { timeout: 30_000 }).catch(() => {})
    if (!check('arrivée sans écran dans l’espace de son entreprise', (await snapshot(page)).leadOrg === person.org && sid, await snapshot(page))) return

    const isLogout = (u) => u.startsWith(`${ISS}/oauth/logout`)
    await ctx.route((u) => isLogout(u.href), async (route) => { await sleep(DELAY); await route.continue().catch(() => {}) })
    ctx.on('request', (r) => {
      const u = new URL(r.url())
      if (isLogout(r.url())) events.push(['déconnexion du Compte Lead : départ', Date.now()])
      else if (u.pathname === '/oauth/authorize') events.push(['autorisation', Date.now(), u.searchParams.get('prompt') ?? ''])
      else if (u.pathname === '/api/auth/logout') events.push(['POST /api/auth/logout', Date.now()])
      else if (u.origin === BASE && r.isNavigationRequest()) events.push(['navigation', Date.now(), u.pathname + u.search])
    })
    ctx.on('requestfinished', (r) => { if (isLogout(r.url())) events.push(['déconnexion du Compte Lead : reçue', Date.now()]) })
    ctx.on('requestfailed', (r) => { if (isLogout(r.url())) events.push(['déconnexion du Compte Lead : ABANDONNÉE', Date.now(), r.failure()?.errorText ?? '']) })
    page.on('console', (m) => { if (m.text().startsWith('[deconnexion] ')) events.push([`page : ${m.text().slice(14)}`, Date.now()]) })

    // Ce qui arrive pendant la sortie est joué DANS la page, à partir de la réponse de POST /api/auth/logout : Playwright
    // attend la fin d'une navigation en cours avant d'agir, une personne (ou un minuteur) non.
    await page.evaluate(({ mode, label }) => {
      const re = new RegExp(label)
      const button = () => [...document.querySelectorAll('button')].find((x) => re.test(x.textContent ?? ''))
      const click = (when) => {
        const b = button()
        console.log(`[deconnexion] 2e clic ${when} : bouton ${b ? `« ${b.textContent} »${b.disabled ? ' désactivé' : ''}` : 'absent'}`)
        b?.click()
      }
      const orig = window.fetch
      window.fetch = async (...a) => {
        const mine = String(a[0]).includes('/api/auth/logout') && !window.__first
        if (mine) window.__first = true
        if (mine && mode === 'double-tot') setTimeout(() => click('avant la réponse'), 0)
        const r = await orig(...a)
        if (mine && mode === 'double') setTimeout(() => click('700 ms après la réponse'), 700)
        if (mine && mode === 'echap') setTimeout(() => {
          // Échap (ou Stop) arrête la navigation vers le Compte Lead ; Échap ferme aussi le menu de compte.
          window.stop()
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          console.log('[deconnexion] Échap : navigation arrêtée, menu fermé')
        }, 300)
        if (mine && mode === 'relecture') setTimeout(() => {
          // La minute de relecture de /me tombe pendant la sortie, et une autre lecture reçoit un 401.
          const ticks = [...window.__minute.values()]
          ticks.forEach((fn) => fn())
          window.dispatchEvent(new Event('pl:unauthenticated'))
          console.log(`[deconnexion] relecture de /me (${ticks.length} minuteur(s) de 60 s) et 401 pendant la sortie`)
        }, 300)
        return r
      }
    }, { mode: name, label: LABEL.source })

    await page.click('header button[aria-label="Mon compte"]')
    const clickAt = Date.now()
    await page.getByRole('button', { name: LABEL }).click({ noWaitAfter: true })

    if (name === 'echap') {
      // La navigation arrêtée, la personne rouvre le menu et clique de nouveau.
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Se déconnecter|Déconnexion…/.test(b.textContent ?? '')),
        null, { timeout: 15_000 }).catch(() => {})
      await sleep(500)
      await page.click('header button[aria-label="Mon compte"]')
      events.push(['menu rouvert, nouveau clic', Date.now()])
      await page.getByRole('button', { name: LABEL }).click({ noWaitAfter: true })
    }

    await sleep(DELAY + 4000)
    await settle(page)
    if (name === 'retour') {
      const before = await snapshot(page)
      check('avant Précédent : l’écran de connexion du Compte Lead', before.password && !before.leadOrg, before)
      const n0 = authorizes.length
      await page.goBack({ timeout: 15_000 }).catch((e) => events.push(['Précédent', Date.now(), String(e.message).split('\n')[0]]))
      await sleep(5000)
      await settle(page)
      check('Précédent : pas de boucle (au plus deux autorisations)', authorizes.length - n0 <= 2, authorizes.slice(n0))
    }

    // La manche a bien eu lieu (un bouton trouvé pour le 2e clic, une navigation arrêtée, un minuteur de 60 s joué).
    const played = { double: /^page : 2e clic 700 ms après la réponse : bouton «/, 'double-tot': /^page : 2e clic avant la réponse : bouton «/,
      echap: /^page : Échap : navigation arrêtée/, relecture: /^page : relecture de \/me \([1-9]\d* minuteur/ }[name]
    if (played) check(`manche « ${name} » jouée pendant la sortie`, events.some((e) => played.test(e[0])), events.map((e) => e[0]))
    const s1 = await snapshot(page)
    const silent = authorizes.filter((a) => a.at >= clickAt && a.session)
    check('le Compte Lead reçoit la déconnexion de ce navigateur', logouts.some((l) => l.sid === sid), { logouts: logouts.filter((l) => l.sid === sid).length })
    check('… et ferme sa session (plus de session au Compte Lead pour ce navigateur)', !sessions.has(sid))
    check('aucune autorisation rendue sans écran après le clic (pas de retour dans l’espace)', silent.length === 0, silent)
    check('page finale : l’écran de connexion du Compte Lead, pas l’espace', s1.password && !s1.leadOrg, s1)
    await page.goto(`${BASE}/login`)
    await settle(page)
    const s2 = await snapshot(page)
    check('ProjectLead /login rouvert ensuite : l’écran de connexion, jamais l’espace', s2.password && !s2.leadOrg, s2)
  } finally {
    if (ko > ko0 || process.env.E2E_TRACE) {
      const t0 = events[0]?.[1] ?? Date.now()
      for (const e of events) console.log(`    +${String(e[1] - t0).padStart(5)} ms  ${e[0]}${e[2] !== undefined ? ` ${String(e[2]).slice(0, 120)}` : ''}`)
    }
    await ctx.close()
  }
}

try {
  for (const m of MANCHES) await manche(m)
} finally {
  await browser.close()
  server.kill()
  iss.close()
}
console.log(`\n${ok} contrôles verts, ${ko} rouges`)
console.log(ko === 0 && ok > 0 ? 'E2E_DECONNEXION_OK' : 'E2E_DECONNEXION_KO')
process.exit(ko === 0 && ok > 0 ? 0 : 1)
