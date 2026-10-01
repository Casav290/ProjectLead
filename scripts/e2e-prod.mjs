/**
 * Parcours réel sur le site en ligne (GitHub Actions) : connexion, inscription d'un compte de
 * contrôle, accueil, projet, tâche. Captures d'écran dans captures/.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL = process.env.URL
const stamp = Date.now().toString(36)
mkdirSync('captures', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'fr-CH' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const shot = (n) => page.screenshot({ path: `captures/${n}.png`, fullPage: true })
let ko = 0
const check = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) ko++ }

await page.goto(URL + '/login'); await page.waitForTimeout(3000); await shot('1-connexion')
check('écran de connexion', await page.getByRole('button', { name: 'Se connecter' }).isVisible().catch(() => false))
await page.goto(URL + '/signup'); await page.waitForTimeout(1500)
await page.getByLabel('Votre nom').fill('Contrôle automatique')
await page.getByLabel('Entreprise').fill(`Contrôle ${stamp}`)
await page.getByLabel('Email').fill(`controle-${stamp}@exemple.test`)
await page.getByLabel('Mot de passe').fill('controle-automatique')
await page.getByRole('button', { name: 'Créer mon espace' }).click()
await page.waitForTimeout(4000); await shot('2-accueil')
check('accueil après inscription', await page.getByRole('heading', { name: /Bonjour/ }).isVisible().catch(() => false))
await page.goto(URL + '/projets'); await page.waitForTimeout(2500); await shot('3-projets')
await page.goto(URL + '/modeles'); await page.waitForTimeout(2500); await shot('4-modeles')
check('modèle de départ présent', await page.getByText('Projet client (modèle)').first().isVisible().catch(() => false))
check('aucune erreur JavaScript', errors.length === 0)
if (errors.length) console.log(errors.join('\n'))
await browser.close()
process.exit(ko ? 1 : 0)
