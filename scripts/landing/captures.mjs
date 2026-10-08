/**
 * Captures de l'application sur les données fictives de `demo-seed.ts`, pour la page d'accueil et le film.
 * Serveur local lancé avec la base de démonstration (PUBLIC_URL=https://projectlead.io pour que les liens affichés
 * soient ceux de la production), puis : `node scripts/landing/captures.mjs <dossier> [http://localhost:3412]`.
 *
 * Sortie : <dossier>/desktop/*.png (1440 x 900, densité 2), <dossier>/mobile/*.png (430 x 932, densité 3),
 * <dossier>/elements/*.png (morceaux d'écran pour le film, densité 2) et <dossier>/rects.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('/usr/lib/node_modules/playwright')) }

const OUT = process.argv[2] ?? 'captures-landing'
const URL = (process.argv[3] ?? 'http://localhost:3412').replace(/\/$/, '')
for (const d of ['desktop', 'mobile', 'elements']) mkdirSync(`${OUT}/${d}`, { recursive: true })

const browser = await chromium.launch({ args: ['--lang=fr-CH', '--hide-scrollbars', '--font-render-hinting=none'],
  env: { ...process.env, LANG: 'fr_CH.UTF-8', LANGUAGE: 'fr_CH:fr', LC_ALL: 'fr_CH.UTF-8' } })
const common = { locale: 'fr-CH', timezoneId: 'Europe/Zurich', colorScheme: 'light', reducedMotion: 'reduce' }
const desk = await browser.newContext({ ...common, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const login = await desk.request.post(URL + '/api/auth/login', { data: { email: 'claire@moraine-batiment.test', password: 'demo-moraine-2026' } })
if (!login.ok()) throw new Error('connexion ' + login.status())
const state = await desk.storageState()
const projects = await (await desk.request.get(URL + '/api/projects')).json()
const pid = (start) => projects.find((p) => p.name.startsWith(start)).id
const R = pid('Rénovation'), M = pid('Pompe')
const portal = (await (await desk.request.get(`${URL}/api/projects/${R}`)).json()).project?.portal_token
  ?? (await (await desk.request.get(`${URL}/api/projects/${R}`)).json()).portal_token

const page = await desk.newPage()
const rects = {}
/** Attendre la fin des chargements et des polices, puis figer l'écran. */
async function settle(p, extra = 900) {
  await p.waitForLoadState('networkidle').catch(() => {})
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(extra)
}
async function shot(p, name, path, { full = false, before } = {}) {
  await p.goto(URL + path); await settle(p)
  if (before) await before(p)
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full })
  console.log('capture', name)
}
async function rect(p, key, locator) {
  const b = await locator.boundingBox().catch(() => null)
  if (b) rects[key] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
}

// ------------------------------------------------------------------ bureau (1440 x 900)
await shot(page, 'desktop/accueil', '/')
await rect(page, 'accueil.timer', page.locator('header').getByText('Isolation façade nord').first())
await shot(page, 'desktop/projets', '/projets')
await shot(page, 'desktop/projet', `/projets/${R}`)
await shot(page, 'desktop/gantt', `/projets/${R}/gantt`, { before: async (p) => {
  // Le Gantt s'ouvre sur aujourd'hui : on recule un peu pour montrer les étapes terminées.
  await p.evaluate(() => { const s = [...document.querySelectorAll('*')].find((e) => e.scrollWidth > e.clientWidth + 200 && getComputedStyle(e).overflowX !== 'visible'); if (s) s.scrollLeft = Math.max(0, s.scrollLeft - 260) })
  await p.waitForTimeout(400)
} })
await shot(page, 'desktop/tableau', `/projets/${R}/tableau`)
for (const t of ['Isolation façade nord', 'Commande des fenêtres', 'Crépi de finition, teinte validée par la PPE', 'Pose des fenêtres, 1er et 2e étage', 'Isolation façade est']) {
  const card = page.locator(`[aria-roledescription="carte déplaçable"][aria-label="${t}"]`).first()
  await rect(page, `tableau.${t}`, card)
  await card.screenshot({ path: `${OUT}/elements/carte-${t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').toLowerCase().replace(/^-|-$/g, '')}.png` }).catch((e) => console.log('carte', t, e.message))
}
await shot(page, 'desktop/liste', `/projets/${R}/liste`)
await shot(page, 'desktop/etapes', `/projets/${R}/etapes`)
await shot(page, 'desktop/suivi', `/projets/${R}/suivi`)
await shot(page, 'desktop/temps', '/temps')
await shot(page, 'desktop/temps-projet', `/projets/${R}/temps`)
await shot(page, 'desktop/emails', '/emails', { before: async (p) => {
  await p.getByText('Rénovation de nos bureaux à Payerne').first().click().catch(() => {})
  await p.waitForTimeout(800)
} })
await shot(page, 'desktop/agenda', '/agenda')
await shot(page, 'desktop/agenda-semaine', '/agenda', { before: async (p) => { await p.getByRole('tab', { name: 'Semaine' }).or(p.getByRole('button', { name: 'Semaine' })).first().click().catch(() => {}); await p.waitForTimeout(700) } })
await shot(page, 'desktop/charge', '/charge')
await shot(page, 'desktop/rapports', '/rapports')
await shot(page, 'desktop/facturation', '/facturation')
await shot(page, 'desktop/clients', '/clients')
await shot(page, 'desktop/taches', '/taches')
await shot(page, 'desktop/villa', `/projets/${M}`)

// ------------------------------------------------------------------ pages publiques (le client n'a pas de compte)
const pub = await browser.newContext({ ...common, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const pp = await pub.newPage()
if (portal) await shot(pp, 'desktop/portail', `/suivi/${portal}`)
await shot(pp, 'desktop/rdv', '/rdv/moraine-visite-technique')

// ------------------------------------------------------------------ téléphone (390 x 844)
const mob = await browser.newContext({ ...common, viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, storageState: state })
const mp = await mob.newPage()
await shot(mp, 'mobile/accueil', '/')
await shot(mp, 'mobile/projet', `/projets/${R}`)
await shot(mp, 'mobile/tableau', `/projets/${R}/tableau`)
await shot(mp, 'mobile/temps', '/temps')
await shot(mp, 'mobile/taches', '/taches')
const mpub = await browser.newContext({ ...common, viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
const mpp = await mpub.newPage()
if (portal) { await shot(mpp, 'mobile/portail', `/suivi/${portal}`); await shot(mpp, 'mobile/portail-long', `/suivi/${portal}`, { full: true }) }
await shot(mpp, 'mobile/rdv', '/rdv/moraine-visite-technique')

writeFileSync(`${OUT}/rects.json`, JSON.stringify({ portal: Boolean(portal), rects }, null, 2))
await browser.close()
console.log('CAPTURES-OK')
