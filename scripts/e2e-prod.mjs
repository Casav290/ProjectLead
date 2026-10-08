/**
 * Parcours réel sur le site en ligne (GitHub Actions, et à la main : `URL=https://projectlead.io
 * node scripts/e2e-prod.mjs`). Sans rien créer en production : page d'accueil, connexion par le Compte Lead,
 * inscription fermée hors Compte Lead, écran d'erreur, pages publiques et légales, carte de visite
 * de l'application. Captures d'écran dans captures/.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL = (process.env.URL ?? 'https://projectlead.io').replace(/\/$/, '')
mkdirSync('captures', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' })
const errors = []
page.on('pageerror', (e) => errors.push(`${page.url()} : ${e.message}`))
// Un 401 avant connexion (lecture de la session) est attendu : ce n'est pas une erreur de l'application.
page.on('console', (m) => m.type() === 'error' && !/status of 40[134]/.test(m.text()) && page.url().startsWith(URL) && errors.push(m.text()))
// Le texte visible de chaque écran, aussi en annotation GitHub (lisible par l'API, contrairement aux fichiers).
const shot = async (n) => {
  await page.screenshot({ path: `captures/${n}.png`, fullPage: true })
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600)
  console.log(`::notice title=${n}::${page.url().split('?')[0]} | ${text}`)
}
let ko = 0
const check = (n, c) => { console.log(`${c ? '::notice title=ok::' : '::error title=échec::'}${n}`); if (!c) ko++ }
const json = async (path, init) => { const r = await fetch(URL + path, init); return { status: r.status, body: await r.json().catch(() => null) } }

// 1. API et carte de visite de l'application
let r = await json('/api/health')
check('santé de l’API', r.status === 200 && r.body?.ok === true)
r = await json('/.well-known/lead-app.json')
check('carte de visite : boîte de réception sur ' + URL, r.body?.app === 'projectlead' && r.body?.exchange?.inbox === `${URL}/api/lead-exchange/v1/inbox`)
r = await json('/api/me')
check('sans session : /api/me refuse', r.status === 401)
r = await json('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Contrôle', email: 'controle@exemple.test', password: 'controle-automatique', company: 'Contrôle' }) })
check('inscription locale fermée : on s’inscrit par le Compte Lead', r.status === 403 && r.body?.error === 'signup_via_lead')

// 1 bis. Page d'accueil pour un visiteur (sans session) : boutons vers /login, images et film hors paquet
await page.goto(URL + '/'); await page.waitForTimeout(2500); await shot('0-accueil')
check('accueil : page d’accueil pour un visiteur', await page.getByRole('heading', { level: 1, name: /Le projet vendu/ }).isVisible().catch(() => false))
check('accueil : « Créer mon compte » mène à /login', (await page.getByRole('link', { name: 'Créer mon compte' }).first().getAttribute('href').catch(() => '')) === 'https://projectlead.io/login')
let media = await fetch(URL + '/media/accueil/accueil-1280.avif')
check('accueil : image servie (AVIF)', media.status === 200 && media.headers.get('content-type') === 'image/avif')
media = await fetch(URL + '/media/film/projectlead-film-720.mp4', { headers: { range: 'bytes=0-1' } })
check('accueil : film servi par plages (206)', media.status === 206 && media.headers.get('content-type') === 'video/mp4')

// 2. Connexion : tout droit vers le Compte Lead (crmlead.io), sans écran intermédiaire
await page.goto(URL + '/projets'); await page.waitForURL(/crmlead\.io/, { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(2500); await shot('1-compte-lead')
const at = new globalThis.URL(page.url())
check('connexion : écran du Compte Lead sur crmlead.io', at.hostname === 'crmlead.io' && await page.getByText('Compte Lead').first().isVisible().catch(() => false))
check('connexion : le Compte Lead sait qu’on va vers ProjectLead', /ProjectLead/.test(await page.evaluate(() => document.body.innerText)))
await page.goto(URL + '/signup'); await page.waitForURL(/crmlead\.io/, { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(2500); await shot('2-inscription')
check('inscription : le Compte Lead ouvre « Créer un compte »', new globalThis.URL(page.url()).hostname === 'crmlead.io'
  && await page.getByRole('heading', { name: /Créer un compte|Create an account/ }).first().isVisible().catch(() => false))

// 3. Retour en erreur : l'écran ProjectLead, au gabarit commun, couleur ocre
await page.goto(URL + '/login?erreur=lead'); await page.waitForTimeout(2500); await shot('3-erreur')
const retry = page.getByRole('link', { name: 'Réessayer avec mon Compte Lead' })
check('erreur : message et bouton « Réessayer »', await page.getByRole('alert').isVisible().catch(() => false) && await retry.isVisible().catch(() => false))
// Le jeton HSL (41 100% 30%) rend l'ocre #9a6a00 à un point près : on compare à 3 près.
const bg = (await retry.evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => '')).match(/\d+/g)?.map(Number) ?? []
check(`erreur : bouton à la couleur de ProjectLead (ocre #9a6a00, lu ${bg.join(',')})`, bg.length >= 3 && [154, 106, 0].every((v, i) => Math.abs(bg[i] - v) <= 3))

// 4. Pages publiques
await page.goto(URL + '/confidentialite'); await page.waitForTimeout(1500); await shot('4-confidentialite')
check('politique de confidentialité', await page.getByRole('heading', { name: 'Politique de confidentialité' }).isVisible().catch(() => false))
await page.goto(URL + '/conditions'); await page.waitForTimeout(1500)
check('conditions d’utilisation', await page.getByRole('heading', { name: "Conditions d'utilisation" }).isVisible().catch(() => false))
await page.goto(URL + '/suivi/lien-inconnu'); await page.waitForTimeout(2000); await shot('5-suivi-inconnu')
check('suivi client : lien inconnu dit qu’il n’est plus valable', /pas ou plus valable/.test(await page.evaluate(() => document.body.innerText)))

check('aucune erreur JavaScript', errors.length === 0)
for (const e of errors.slice(0, 10)) console.log(`::error title=erreur JavaScript::${e.slice(0, 500)}`)
await browser.close()
process.exit(ko ? 1 : 0)
