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
// Un 401 avant connexion (lecture de la session) est attendu : ce n'est pas une erreur de l'application.
page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(m.text()))
// Le texte visible de chaque écran, aussi en annotation GitHub (lisible par l'API, contrairement aux fichiers).
const shot = async (n) => {
  await page.screenshot({ path: `captures/${n}.png`, fullPage: true })
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 900)
  console.log(`::notice title=${n}::${page.url()} | ${text}`)
}
let ko = 0
const check = (n, c) => { console.log(`${c ? '::notice title=ok::' : '::error title=échec::'}${n}`); if (!c) ko++ }

await page.goto(URL + '/login'); await page.waitForTimeout(3000); await shot('1-connexion')
// Compte Lead branché : son bouton seul ; sinon le formulaire email.
check('écran de connexion', await page.getByRole('link', { name: 'Se connecter avec mon compte Lead' }).isVisible().catch(() => false)
  || await page.getByRole('button', { name: 'Se connecter', exact: true }).isVisible().catch(() => false))
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
for (const e of errors.slice(0, 10)) console.log(`::error title=erreur JavaScript::${e.slice(0, 500)}`)
await browser.close()
process.exit(ko ? 1 : 0)
