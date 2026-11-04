#!/usr/bin/env node
/**
 * La visite guidée au navigateur sans tête (04.11.2026) : Chromium de Playwright lancé ici, jamais un Chrome existant.
 *
 *   VISITE_NEW_COOKIE=…  VISITE_OLD_COOKIE=…  [VISITE_NEW_COOKIE_MOBILE=…]
 *   node scripts/e2e-visite.mjs --url https://… [--out <dossier>] [--bypass <jeton Vercel>] [--video]
 *
 * Les cookies sont des sessions `projectlead_session` (jamais affichées) : NEW = une personne neuve (visite due),
 * OLD = une personne d'avant la visite (due = faux). NEW_COOKIE_MOBILE (facultatif) = une autre personne neuve, pour voir
 * l'ouverture automatique au téléphone ; sans elle, le téléphone passe par « Revoir la visite ».
 *
 * Ce qui est vérifié (dernière ligne : E2E_VISITE_OK, sinon la liste des rouges) :
 *  1. personne neuve, 1440 px : la visite s'ouvre seule ; chaque étape pointe un élément RÉELLEMENT visible (la découpe
 *     entoure l'élément, dans l'écran), la carte est dans l'écran et ne couvre pas la zone, pas de défilement horizontal ;
 *     après l'ouverture, /api/me dit due = faux ;
 *  2. nouveau navigateur (stockage vide), même personne : rien ne s'ouvre ;
 *  3. « Revoir la visite » (menu du profil) la relance ; Échap ferme ; « Passer » ferme ; un clic sur la zone montrée
 *     ferme la visite et ouvre la page ;
 *  4. 390 px (téléphone) : mêmes contrôles d'étape (le menu replié s'ouvre pour les étapes du menu) ;
 *  5. clair et sombre : contraste du titre, du texte et du bouton principal ≥ 4,5:1, carte sombre en mode sombre ;
 *  6. cinq langues : titres et boutons = fichiers src/i18n/locales/<langue>/tour.json ;
 *  7. personne d'avant : rien ne s'ouvre seul, « Revoir la visite » marche ;
 *  8. prefers-reduced-motion : aucune animation ;
 *  9. aucune erreur JavaScript.
 * --video : vidéos 1440 et 390 (webm, puis mp4 si ffmpeg est là) et captures de chaque étape dans --out.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const URL0 = (arg('--url') ?? '').replace(/\/$/, '')
const OUT = arg('--out')
const BYPASS = arg('--bypass') ?? process.env.VISITE_BYPASS ?? null
const VIDEO = process.argv.includes('--video')
const NEW = process.env.VISITE_NEW_COOKIE, OLD = process.env.VISITE_OLD_COOKIE, NEW_M = process.env.VISITE_NEW_COOKIE_MOBILE
if (!URL0 || !NEW || !OLD) throw new Error('usage : VISITE_NEW_COOKIE, VISITE_OLD_COOKIE et --url')
if (OUT) mkdirSync(OUT, { recursive: true })

const ROOT = new URL('..', import.meta.url).pathname
const LANGS = ['fr', 'de', 'en', 'it', 'es']
const TEXT = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${l}/tour.json`), 'utf8'))]))
const host = new URL(URL0).hostname
const secure = URL0.startsWith('https')

const fails = [], passes = []
const check = (name, ok, detail = '') => { (ok ? passes : fails).push(ok ? name : `${name} : ${detail}`); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` (${detail})`}`) }
const jsErrors = []
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true })
async function context({ cookie, width, height, scheme = 'light', reduced = false, lang = null, video = null, mobile = false }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
    colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference', locale: 'fr-CH',
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {},
    ...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}),
  })
  await ctx.addCookies([{ name: 'projectlead_session', value: cookie, domain: host, path: '/', httpOnly: true, secure, sameSite: 'Lax' }])
  if (lang) {
    await ctx.addCookies([{ name: 'pl_lang', value: lang, domain: host, path: '/', secure, sameSite: 'Lax' }])
    await ctx.addInitScript((l) => { try { localStorage.setItem('pl.lang', l) } catch { /* */ } }, lang)
  }
  const page = await ctx.newPage()
  page.on('pageerror', (e) => jsErrors.push(`${width}px : ${e.message}`))
  return { ctx, page }
}

const open = (page) => page.locator('[data-tour-open]')
async function waitOpen(page, ms = 8000) { try { await open(page).waitFor({ state: 'visible', timeout: ms }); return true } catch { return false } }
async function stepId(page) { return page.locator('[data-tour-open]').getAttribute('data-tour-step') }
async function replay(page) {
  await page.locator('[data-tour="profile"]').click()
  await page.locator('[data-tour-replay]').click()
  return waitOpen(page, 5000)
}
const me = (page) => page.evaluate(async () => (await fetch('/api/me', { credentials: 'include' })).json())

/** Contrôle de l'étape affichée : zone visée réellement visible, découpe autour, carte dans l'écran, rien en largeur. */
async function inspectStep(page) {
  // La découpe glisse (440 ms) : on attend qu'elle soit posée.
  await pause(650)
  return page.evaluate(() => {
    const root = document.querySelector('[data-tour-open]')
    const id = root.getAttribute('data-tour-step')
    const W = document.documentElement.clientWidth, H = window.innerHeight
    const hit = root.querySelector('rect.plt-hit')
    const card = root.querySelector('.plt-card').getBoundingClientRect()
    const res = { id, W, H, hscroll: document.documentElement.scrollWidth > W + 1, card: { x: card.left, y: card.top, r: card.right, b: card.bottom },
                  cardIn: card.left >= 0 && card.top >= 0 && card.right <= W + 0.5 && card.bottom <= H + 0.5, target: null, hole: null }
    if (!hit) return res
    const hole = { x: +hit.getAttribute('x'), y: +hit.getAttribute('y'), w: +hit.getAttribute('width'), h: +hit.getAttribute('height') }
    res.hole = hole
    // L'élément sous le centre de la découpe, la visite masquée un instant : c'est ce que la personne voit vraiment.
    root.style.visibility = 'hidden'
    let tgt = null
    for (const f of [0.5, 0.25, 0.75]) {
      tgt = document.elementFromPoint(hole.x + hole.w / 2, hole.y + hole.h * f)?.closest('[data-tour], [data-assistant-bubble]') ?? null
      if (tgt) break
    }
    root.style.visibility = ''
    const r = tgt?.getBoundingClientRect()
    res.target = tgt ? { tour: tgt.getAttribute('data-tour') ?? 'assistant', label: (tgt.textContent || tgt.getAttribute('aria-label') || '').trim().slice(0, 40),
                         inside: r.left >= hole.x - 1 && r.top >= hole.y - 1 && r.right <= hole.x + hole.w + 1 && r.bottom <= hole.y + hole.h + 1 } : null
    res.holeIn = hole.x >= 0 && hole.y >= 0 && hole.x + hole.w <= W && hole.y + hole.h <= H && hole.w > 4 && hole.h > 4
    const ix = Math.max(0, Math.min(card.right, hole.x + hole.w) - Math.max(card.left, hole.x))
    const iy = Math.max(0, Math.min(card.bottom, hole.y + hole.h) - Math.max(card.top, hole.y))
    res.overlap = ix * iy
    return res
  })
}
const EXPECTED = { home: 'nav:/', projects: 'nav:/projets', tasks: 'nav:/taches', inbox: 'nav:/emails|nav:/agenda', time: 'nav:/temps|nav:/charge|nav:/rapports',
  clients: 'nav:/clients|nav:/facturation', search: 'search', settings: 'nav:/modeles|nav:/reglages', assistant: 'assistant', replay: 'profile' }

/** Toute la visite, étape par étape, avec captures. Rend la liste des étapes vues. */
async function walk(page, label, { shots = false, slow = 0 } = {}) {
  const seen = []
  for (let k = 0; k < 20; k++) {
    if (!(await open(page).isVisible())) break
    const s = await inspectStep(page)
    seen.push(s.id)
    check(`${label} · ${s.id} : carte dans l'écran`, s.cardIn, JSON.stringify(s.card))
    check(`${label} · ${s.id} : pas de défilement horizontal`, !s.hscroll, `largeur ${s.W}`)
    if (s.id !== 'welcome') {
      const want = EXPECTED[s.id]
      check(`${label} · ${s.id} : la découpe montre l'élément visé, visible`, Boolean(s.target && s.target.inside && s.holeIn && new RegExp(`^(${want})$`).test(s.target.tour)), JSON.stringify({ t: s.target, h: s.hole }))
      check(`${label} · ${s.id} : la carte ne couvre pas la zone`, s.overlap < 1, `recouvrement ${Math.round(s.overlap)} px²`)
    }
    if (shots && OUT) await page.screenshot({ path: join(OUT, `${label}-${String(k + 1).padStart(2, '0')}-${s.id}.png`) })
    if (slow) await pause(slow)
    await page.locator('[data-tour-next]').click()
  }
  return seen
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

try {
  // 1. Personne neuve, bureau 1440 : ouverture seule, toutes les étapes.
  const vidDesk = OUT && VIDEO ? join(OUT, 'video-1440') : null
  {
    const { ctx, page } = await context({ cookie: NEW, width: 1440, height: 900, video: vidDesk })
    await page.goto(`${URL0}/`, { waitUntil: 'domcontentloaded' })
    check('1440 · personne neuve : la visite s’ouvre seule', await waitOpen(page))
    const seen = await walk(page, 'bureau-1440', { shots: true, slow: VIDEO ? 1700 : 0 })
    check('1440 · toutes les étapes vues, dans l’ordre', seen[0] === 'welcome' && seen.at(-1) === 'replay' && seen.length >= 10, seen.join(','))
    check('1440 · « Terminer » ferme la visite', !(await open(page).isVisible()))
    check('1440 · le serveur retient : due = faux', (await me(page)).user?.tour_pending === false)
    if (VIDEO) await pause(1200)
    await ctx.close()
  }
  // 2. Nouveau navigateur, même personne : rien.
  {
    const { ctx, page } = await context({ cookie: NEW, width: 1440, height: 900 })
    await page.goto(`${URL0}/`, { waitUntil: 'domcontentloaded' })
    check('1440 · nouveau navigateur : la visite ne se rouvre pas', !(await waitOpen(page, 4500)))
    // 3. Revoir, Échap, Passer, clic sur la zone.
    check('Revoir la visite (menu du profil) : elle se relance', await replay(page))
    await page.keyboard.press('Escape')
    check('Échap ferme la visite', !(await open(page).isVisible()))
    await replay(page)
    await page.locator('[data-tour-next]').click(); await pause(300)
    await page.locator('[data-tour-skip]').click()
    check('« Passer » ferme la visite (étape 2)', !(await open(page).isVisible()))
    await replay(page)
    for (let k = 0; k < 2; k++) { await page.locator('[data-tour-next]').click(); await pause(200) }
    check('flèche droite : étape suivante', await (async () => { await page.keyboard.press('ArrowRight'); await pause(200); return (await stepId(page)) === 'tasks' })())
    await page.keyboard.press('ArrowLeft'); await pause(700)
    const s = await inspectStep(page)
    await page.mouse.click(s.hole.x + s.hole.w / 2, s.hole.y + s.hole.h / 2)
    await pause(800)
    check('clic sur la zone montrée : visite fermée, page ouverte', !(await open(page).isVisible()) && new URL(page.url()).pathname === '/projets', page.url())
    check('Revoir ne réécrit rien : due reste faux', (await me(page)).user?.tour_pending === false)
    await ctx.close()
  }
  // 4. Téléphone 390.
  const vidMob = OUT && VIDEO ? join(OUT, 'video-390') : null
  {
    const { ctx, page } = await context({ cookie: NEW_M ?? NEW, width: 390, height: 844, mobile: true, video: vidMob })
    await page.goto(`${URL0}/`, { waitUntil: 'domcontentloaded' })
    if (NEW_M) check('390 · personne neuve : la visite s’ouvre seule', await waitOpen(page))
    else { await page.waitForLoadState('networkidle'); check('390 · Revoir la visite', await replay(page)) }
    const seen = await walk(page, 'mobile-390', { shots: true, slow: VIDEO ? 1700 : 0 })
    check('390 · toutes les étapes vues', seen[0] === 'welcome' && seen.at(-1) === 'replay' && seen.length >= 10, seen.join(','))
    check('390 · le menu replié est refermé après la visite', await page.evaluate(() => !document.querySelector('.fixed.inset-0.z-40')))
    if (VIDEO) await pause(1200)
    await ctx.close()
  }
  // 5. Clair et sombre.
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await context({ cookie: NEW, width: 1440, height: 900, scheme })
    await page.goto(`${URL0}/`, { waitUntil: 'networkidle' })
    await replay(page)
    await page.locator('[data-tour-next]').click(); await pause(700)
    const c = await page.evaluate(() => {
      const st = (sel, p = 'color') => getComputedStyle(document.querySelector(sel))[p]
      return { bg: st('.plt-card', 'backgroundColor'), title: st('.plt-title'), text: st('.plt-text'), btn: st('[data-tour-next]'), btnBg: st('[data-tour-next]', 'backgroundColor'), skip: st('[data-tour-skip]') }
    })
    const ok = contrast(c.title, c.bg) >= 4.5 && contrast(c.text, c.bg) >= 4.5 && contrast(c.btn, c.btnBg) >= 4.5 && contrast(c.skip, c.bg) >= 4.5
    check(`${scheme} : contrastes ≥ 4,5:1 (titre, texte, Passer, bouton)`, ok, JSON.stringify(c))
    check(`${scheme} : fond de carte ${scheme === 'dark' ? 'sombre' : 'clair'}`, scheme === 'dark' ? luminance(c.bg) < 0.05 : luminance(c.bg) > 0.9, c.bg)
    if (OUT) await page.screenshot({ path: join(OUT, `theme-${scheme}-1440.png`) })
    await ctx.close()
  }
  // 6. Cinq langues : chaque titre d'étape et les boutons.
  for (const lang of LANGS) {
    const { ctx, page } = await context({ cookie: NEW, width: 1440, height: 900, lang })
    await page.goto(`${URL0}/`, { waitUntil: 'networkidle' })
    await replay(page)
    const T = TEXT[lang]
    let bad = []
    check(`${lang} : bouton de départ et Passer`, (await page.locator('[data-tour-next]').innerText()).trim() === T['tour.start'] && (await page.locator('[data-tour-skip]').innerText()).trim() === T['tour.skip'])
    for (let k = 0; k < 20 && (await open(page).isVisible()); k++) {
      const id = await stepId(page)
      const title = (await page.locator('.plt-title').innerText()).trim(), body = (await page.locator('.plt-text').innerText()).trim()
      if (title !== T[`tour.${id}.title`] || body !== T[`tour.${id}.body`]) bad.push(`${id}: ${title}`)
      if (/—/.test(title + body)) bad.push(`${id}: tiret long`)
      await page.locator('[data-tour-next]').click(); await pause(120)
    }
    check(`${lang} : titres et textes de toutes les étapes = tour.json`, bad.length === 0, bad.join(' | '))
    if (OUT) {
      await replay(page); await page.locator('[data-tour-next]').click(); await pause(700)
      await page.screenshot({ path: join(OUT, `langue-${lang}-1440.png`) })
    }
    await ctx.close()
  }
  // 7. Personne d'avant la visite.
  {
    const { ctx, page } = await context({ cookie: OLD, width: 1440, height: 900 })
    await page.goto(`${URL0}/`, { waitUntil: 'domcontentloaded' })
    check('personne d’avant : due = faux', (await me(page)).user?.tour_pending === false)
    check('personne d’avant : rien ne s’ouvre seul', !(await waitOpen(page, 4500)))
    check('personne d’avant : « Revoir la visite » marche', await replay(page))
    await ctx.close()
  }
  // 8. Mouvement réduit.
  {
    const { ctx, page } = await context({ cookie: NEW, width: 1440, height: 900, reduced: true })
    await page.goto(`${URL0}/`, { waitUntil: 'networkidle' })
    await replay(page)
    await page.locator('[data-tour-next]').click(); await pause(100)
    const anims = await page.evaluate(() => [...document.querySelectorAll('.plt-root *')].map((e) => getComputedStyle(e).animationName).filter((n) => n && n !== 'none'))
    check('prefers-reduced-motion : aucune animation', anims.length === 0, anims.slice(0, 5).join(','))
    await ctx.close()
  }
  check('aucune erreur JavaScript', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

// Vidéos : un fichier par contexte, renommé ; mp4 si ffmpeg est là.
for (const [dir, name] of [[OUT && VIDEO ? join(OUT, 'video-1440') : null, 'visite-bureau-1440'], [OUT && VIDEO ? join(OUT, 'video-390') : null, 'visite-mobile-390']]) {
  if (!dir || !existsSync(dir)) continue
  const f = readdirSync(dir).find((x) => x.endsWith('.webm'))
  if (!f) continue
  const webm = join(OUT, `${name}.webm`)
  renameSync(join(dir, f), webm); rmSync(dir, { recursive: true, force: true })
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(OUT, `${name}.mp4`)]) } catch { /* webm seul */ }
}

console.log(`\n${passes.length} verts, ${fails.length} rouges`)
if (fails.length) { console.log(fails.map((f) => `ROUGE ${f}`).join('\n')); process.exit(1) }
console.log('E2E_VISITE_OK')
