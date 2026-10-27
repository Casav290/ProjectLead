/**
 * Contrôle des cinq langues dans un vrai navigateur (chantier du 27.10.2026).
 *
 *   BASE=http://localhost:5174 EMAIL=demo@projectlead.test PASSWORD=demo-demo-demo node scripts/e2e-langues.mjs
 *   BASE=https://projectlead.io SESSION=<jeton de session de test> node scripts/e2e-langues.mjs
 *
 * Pour chaque langue (fr, de, en, it, es), sur ordinateur (1440×900) et téléphone (390×844) : le sélecteur est sur la
 * page publique (/conditions, et PUBLIC_PATHS) et sur les pages connectées ; le choisir change la langue sur place
 * (attribut lang, textes), garde la saisie en cours, survit au rechargement ; aucune clé brute à l'écran ; aucune
 * erreur JavaScript. Captures dans SHOTS (par défaut ./captures-langues). Lecture seule : rien n'est écrit, sauf la
 * langue du profil (POST /api/me/locale), remise à la fin à sa valeur de départ.
 * Dernière ligne : E2E_LANGUES_OK.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const BASE = (process.env.BASE ?? 'http://localhost:5174').replace(/\/$/, '')
const SHOTS = process.env.SHOTS ?? 'captures-langues'
const PAGES = (process.env.PAGES ?? '/,/projets,/taches,/temps,/agenda,/clients,/reglages').split(',')
const PUBLIC_PATHS = (process.env.PUBLIC_PATHS ?? '/conditions').split(',')
mkdirSync(SHOTS, { recursive: true })

const LANGS = ['fr', 'de', 'en', 'it', 'es']
// Un mot témoin du menu dans chaque langue : prouve que l'écran a vraiment changé.
const NAV_HOME = { fr: 'Accueil', de: 'Start', en: 'Home', it: 'Home', es: 'Inicio' }

let ok = 0, ko = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const host = new URL(BASE).hostname
const browser = await chromium.launch()
const jsErrors = []

async function context(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'fr-CH', ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
  if (process.env.SESSION) {
    await ctx.addCookies([{ name: 'projectlead_session', value: process.env.SESSION, domain: host, path: '/', httpOnly: true,
                            secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  } else if (process.env.EMAIL) {
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: process.env.EMAIL, password: process.env.PASSWORD } })
    if (!r.ok()) throw new Error(`connexion refusée ${r.status()}`)
  }
  return ctx
}
const rawKeys = (text) => [...text.matchAll(/\b(?:common|shell|legal|public|project|ptabs|tasks|home|agenda|inbox|workload|time|clients|settings|settings2|status|health|stage|priority|billing|role|projectRole|langSelect)\.[a-zA-Z][\w.]*\b/g)].map((m) => m[0])

async function choose(page, l) {
  await page.locator('[data-lang-select] select').first().selectOption(l)
  await page.waitForFunction((x) => document.documentElement.lang === x, l, { timeout: 10_000 })
  await page.waitForTimeout(400)
}

const startLocale = await (async () => {
  const ctx = await context({ width: 1440, height: 900 })
  const r = await ctx.request.get(`${BASE}/api/me`)
  const l = r.ok() ? (await r.json()).user?.locale : null
  await ctx.close()
  return l
})()

try {
  for (const [kind, viewport] of [['ordinateur', { width: 1440, height: 900 }], ['telephone', { width: 390, height: 844 }]]) {
    console.log(`\n${kind}`)
    const ctx = await context(viewport)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => jsErrors.push(`${page.url()} : ${e.message}`))

    // Pages publiques.
    for (const p of PUBLIC_PATHS) {
      await page.goto(`${BASE}${p}`); await page.waitForLoadState('networkidle')
      check(`${kind} public ${p} : sélecteur présent`, (await page.locator('[data-lang-select] select').count()) > 0)
      for (const l of LANGS) {
        await choose(page, l)
        const text = await page.locator('body').innerText()
        check(`${kind} public ${p} ${l} : aucune clé brute`, rawKeys(text).length === 0, rawKeys(text).slice(0, 5))
        await page.screenshot({ path: `${SHOTS}/${kind}-public${p.replace(/\W+/g, '-')}-${l}.png`, fullPage: false })
      }
    }

    // Pages connectées.
    await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle')
    const connected = (await page.locator('nav[aria-label]').count()) > 0 || (await page.locator('header').count()) > 0
    check(`${kind} : session ouverte`, connected)
    for (const l of LANGS) {
      for (const p of PAGES) {
        await page.goto(`${BASE}${p}`); await page.waitForLoadState('networkidle')
        if (p === PAGES[0]) await choose(page, l)
        const sel = await page.locator('[data-lang-select] select').first()
        check(`${kind} ${l} ${p} : sélecteur visible`, await sel.isVisible())
        check(`${kind} ${l} ${p} : lang=${l}`, (await page.evaluate(() => document.documentElement.lang)) === l)
        const text = await page.locator('body').innerText()
        check(`${kind} ${l} ${p} : aucune clé brute`, rawKeys(text).length === 0, rawKeys(text).slice(0, 5))
        await page.screenshot({ path: `${SHOTS}/${kind}-${p === '/' ? 'accueil' : p.replace(/\W+/g, '')}-${l}.png` })
      }
      if (kind === 'ordinateur') {
        await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle')
        const nav = await page.locator('nav').first().innerText()
        check(`${kind} ${l} : menu traduit (« ${NAV_HOME[l]} »)`, nav.includes(NAV_HOME[l]), nav.slice(0, 120))
      }
    }

    // Saisie gardée au changement de langue, langue gardée au rechargement.
    if (kind === 'ordinateur') {
      await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle')
      await choose(page, 'fr')
      const search = page.locator('header form input').first()
      await search.fill('saisie-en-cours')
      await choose(page, 'de')
      check('saisie gardée au changement de langue', (await search.inputValue()) === 'saisie-en-cours')
      await page.reload(); await page.waitForLoadState('networkidle')
      check('langue gardée au rechargement (de)', (await page.evaluate(() => document.documentElement.lang)) === 'de')
      const me = await (await ctx.request.get(`${BASE}/api/me`)).json()
      check('langue enregistrée sur le profil (de)', me.user?.locale === 'de', me.user?.locale)
      const cookies = await ctx.cookies()
      check('cookie pl_lang = de', cookies.some((c) => c.name === 'pl_lang' && c.value === 'de'))
    }
    await ctx.close()
  }
  check('aucune erreur JavaScript', jsErrors.length === 0, jsErrors.slice(0, 5))
} finally {
  // La langue du profil revient à sa valeur de départ.
  if (startLocale) {
    const ctx = await context({ width: 1440, height: 900 })
    await ctx.request.post(`${BASE}/api/me/locale`, { data: { locale: startLocale } }).catch(() => {})
    await ctx.close()
  }
  await browser.close()
}
console.log(`\n${ok} verts, ${ko} rouges`)
if (ko) process.exit(1)
console.log('E2E_LANGUES_OK')
