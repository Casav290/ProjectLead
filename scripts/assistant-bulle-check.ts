/**
 * Alignement des bulles (28.10.2026) côté navigateur : le rendu du texte et de la carte (B6, B7) sous Node, puis la vraie
 * bulle dans un navigateur sans tête (Playwright, lancé ici ; jamais un Chrome existant) : l'application construite
 * (vite build → dist/), le vrai serveur (server/index.ts) sur 127.0.0.1, la base de TEST (TEST_DATABASE_URL) et le FAUX
 * service de modèle (scripts/assistant-fake.ts). Aucune clé réelle, aucun appel extérieur, aucune donnée réelle.
 *
 * Chaque contrôle porte un libellé FIXE, cité dans docs/ASSISTANT-ACTIONS.md (« Alignement des bulles ») ; la porte G7
 * vérifie qu'il est imprimé « ✓ ». `--no-build` : garder dist/ tel quel. Dernière ligne : ASSISTANT_BULLE_CHECK_OK.
 */
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
process.env.APP_SECRET ||= 'assistant-bulle-secret-0123456789-abcdef'

import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { startFake } from './assistant-fake.js'

const ROOT = join(import.meta.dirname, '..')
process.chdir(ROOT)
if (!process.env.TEST_DATABASE_URL) { console.log('TEST_DATABASE_URL manquant'); process.exit(2) }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
for (const k of ['LEAD_ID_CLIENT_SECRET', 'LEAD_ID_ISSUER', 'RESEND_API_KEY', 'SMTP_URL', 'ASSISTANT_TURN_TIMEOUT_MS', 'ASSISTANT_USER_PER_HOUR']) delete process.env[k]

let ok = 0, ko = 0
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 700)) }
}
const json = (l: string, part: string) => JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${l}/${part}.json`), 'utf8')) as Record<string, string>
const LANGS = ['fr', 'de', 'en', 'it', 'es']
const FR = json('fr', 'shell')

// ================================================================== 1. rendu sous Node (B6, B7, B11)
const { Rich, CardText } = await import('../src/components/assistantText.tsx')
const html = (text: string, fr = true) => renderToStaticMarkup(h(StaticRouter, { location: '/' }, h(Rich, { text, onLink: () => {}, fr })))
{
  const bold = html('Un **mot** fort et un ** orphelin')
  check('B6 rendu : **gras** → <strong>, sans « ** »', bold.includes('<strong>mot</strong>') && !bold.includes('**'), bold)
  const br = html('Un<br>Deux<br/>Trois<BR />Quatre')
  check('B6 rendu : <br> et <br/> → lignes séparées', (br.match(/<p /g) ?? []).length === 4 && !/&lt;br/i.test(br), br)
  const title = html('# Titre\n## Sous-titre\nTexte')
  check('B6 rendu : titre « # » retiré', !title.includes('#') && title.includes('<p class="my-1 font-bold">Titre</p>') && title.includes('Sous-titre'), title)
  const table = html('| Projet | État |\n|---|:---:|\n| **Alpha** | en cours |')
  check('B6 rendu : tableau Markdown sans barre verticale ni « --- », cellules en ligne', !table.includes('|') && !table.includes('---')
    && table.includes('Projet · État') && table.includes('<strong>Alpha</strong> · en cours'), table)
  const script = html('<script>alert(1)</script> <b>x</b> <img src=x onerror=alert(2)>')
  check('B6 rendu : <script> reste du texte', script.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !/<script|<b>|<img/i.test(script), script)
  const typo = html('Note: voir « ici » ! Heure 10:30, https://exemple.ch?x=1', true)
  const notFr = html('Note: voir « ici » ! Heure 10:30', false)
  check('B6 rendu : typographie française (espace fine insécable) en français seulement',
    typo.includes('Note :') && typo.includes('« ici »') && typo.includes('ici » !') && typo.includes('10:30')
    && typo.includes('https://exemple.ch?x=1') && !notFr.includes(' '), { typo, notFr })
  // Le code seulement (les commentaires qui disent « jamais innerHTML » ne comptent pas).
  const sources = ['src/components/Assistant.tsx', 'src/components/assistantText.tsx'].map((f) => readFileSync(join(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')).join('\n')
  check('B6 rendu sans innerHTML ni dangerouslySetInnerHTML dans la bulle', !/innerHTML|dangerouslySetInnerHTML/.test(sources))
  const line = renderToStaticMarkup(h(CardText, { text: 'Échéance : lun. 2 nov. → ven. 6 nov.', becomes: 'devient' }))
  check('B7 rendu : « avant → après » lu « devient » par les lecteurs d’écran, flèche masquée',
    line === 'Échéance : lun. 2 nov.<span aria-hidden="true"> → </span><span class="sr-only"> devient </span>ven. 6 nov.', line)
  const notes = LANGS.map((l) => json(l, 'shell')['shell.assistant.note'])
  check('B11 mention dans les cinq langues', notes[0] === 'L’assistant peut se tromper : vérifiez avant de confirmer.'
    && notes.every((x) => x && x.length > 20) && new Set(notes).size === 5, notes)
}

// ================================================================== 2. la bulle dans un navigateur sans tête
if (!process.argv.includes('--no-build')) {
  const b = spawnSync('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, encoding: 'utf8', timeout: 900_000 })
  check('application construite (vite build → dist/)', b.status === 0, (b.stdout + b.stderr).slice(-400))
}
const fake = await startFake()
process.env.ANTHROPIC_BASE_URL = fake.url
process.env.ANTHROPIC_API_KEY = 'cle-factice-pour-le-faux-service'
const { migrate } = await import('../server/migrate.js')
await migrate(() => {})
const { default: app } = await import('../server/index.js')
const { pool } = await import('../server/db.js')
const { serve } = await import('@hono/node-server')
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
await new Promise((r) => server.once('listening', r))
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
process.env.PUBLIC_URL = BASE

/** L'API comme l'écran, sans navigateur (mise en place). */
let cookie = ''
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const m = res.headers.get('set-cookie')?.match(/projectlead_session=([^;]+)/)
  if (m) cookie = `projectlead_session=${m[1]}`
  return { status: res.status, body: await res.json().catch(() => null) }
}
const stamp = Date.now().toString(36)
await call('POST', '/api/auth/signup', { name: 'Léa Bulle', email: `lea-bulle-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Bulle ${stamp}` })
const me = (await call('GET', '/api/me')).body
const pid = (await call('POST', '/api/projects', { name: 'Site Internet', status: 'active' })).body.id
const task = (await call('POST', '/api/tasks', { project_id: pid, title: 'Maquettes', due_date: '2026-11-03', assignee_ids: [me.user.id] })).body
for (let i = 1; i <= 24; i++) await call('POST', '/api/tasks', { project_id: pid, title: `Tâche ${i}`, assignee_ids: [me.user.id] })
for (let i = 1; i <= 14; i++) await call('POST', '/api/projects', { name: `Projet ${i}`, status: 'planned' })
check('mise en place : une personne, 15 projets, 25 tâches (pages longues)', Boolean(me?.user?.id && pid && task?.id), me)
const sessionValue = cookie.split('=')[1]

const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const browser = await chromium.launch()
const errors: string[] = []
async function open(viewport: { width: number; height: number }, init?: () => void) {
  const ctx = await browser.newContext({ viewport, locale: 'fr-CH', isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
  // tsx (esbuild) nomme les fonctions avec `__name` : les fonctions passées à la page en ont besoin.
  await ctx.addInitScript('window.__name = (f) => f')
  await ctx.addCookies([{ name: 'projectlead_session', value: sessionValue, url: BASE }])
  await ctx.addInitScript(() => { try { localStorage.setItem('pl.lang', 'fr') } catch { /* */ } })
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  page.on('pageerror', (e: Error) => errors.push(`${page.url()} : ${e.message}`))
  return { ctx, page }
}
const LOG = '[data-assistant-log]'
/** Une demande dans la bulle ouverte ; attend la fin du travail. */
async function ask(page: any, text: string) {
  const n = await page.locator(`${LOG} > *`).count()
  await page.fill('[data-assistant-input]', text)
  await page.keyboard.press('Enter')
  await page.waitForFunction(({ sel, n }: any) => document.querySelectorAll(sel).length > n + 1 && !document.querySelector('[data-assistant-panel] [role=status]'),
    { sel: `${LOG} > *`, n }, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(200)
}
/** Le texte du fil hors messages de la personne : réponses, « Page ouverte », erreurs, cartes. */
const threadText = (page: any) => page.evaluate((sel: string) => [...document.querySelectorAll(`${sel} > :not([data-assistant-user])`)]
  .map((e) => (e as HTMLElement).innerText).join('\n'), LOG)
const RAW_PATH = /\/(taches|projets|modeles|emails|agenda|temps|charge|rapports|clients|facturation|recherche|reglages)\b|projectlead\.io|\/api\//
const MARKUP: [string, RegExp][] = [['|---|', /\|\s*:?-{3,}/], ['<br', /<br/i], ['**', /\*\*/], ['#', /(^|\s)#{1,6}\s/m]]
const markupIn = (text: string) => MARKUP.filter(([, re]) => re.test(text)).map(([label]) => label)

try {
  // ---------------------------------------------------------------- bureau
  const d = await open({ width: 1280, height: 860 })
  const p = d.page
  await p.goto(`${BASE}/`)
  await p.waitForSelector('[data-assistant-bubble]', { timeout: 60_000 })
  await p.click('[data-assistant-bubble]')
  check('B8 bulle : focus dans le champ dès l’ouverture', await p.evaluate(() => document.activeElement?.hasAttribute('data-assistant-input')))
  const noteBox = await p.locator('[data-assistant-note]').boundingBox()
  const fieldBox = await p.locator('[data-assistant-input]').boundingBox()
  check('B11 bulle : mention « peut se tromper » visible sous le champ', (await p.locator('[data-assistant-note]').isVisible())
    && (await p.locator('[data-assistant-note]').innerText()) === FR['shell.assistant.note'] && noteBox && fieldBox && noteBox.y >= fieldBox.y + fieldBox.height,
    { noteBox, fieldBox })

  await ask(p, 'FAKE:open_page:{"path":"/reglages/equipe"}')
  const opened = await p.locator('[data-assistant-opened]').last().innerText().catch(() => '')
  const t1 = await threadText(p)
  check('B5 bulle : « Page ouverte : Réglages › Équipe », navigation faite, aucun chemin brut dans le fil',
    opened === 'Page ouverte : Réglages › Équipe' && new URL(p.url()).pathname === '/reglages/equipe' && !RAW_PATH.test(t1), { opened, url: p.url(), t1: t1.slice(0, 300) })

  await ask(p, 'TABLEAU')
  const t2 = await threadText(p)
  check('B6 bulle : demande « tableau » → fil sans séparateur de tableau, « <br », « ** » ni « # », <script> reste du texte',
    markupIn(t2).length === 0 && t2.includes('Projet · État') && t2.includes('<script>alert(1)</script>')
    && (await p.locator(`${LOG} script`).count()) === 0, { found: markupIn(t2), t2: t2.slice(0, 400) })

  await ask(p, `FAKE:propose_update_task:{"task_id":"${task.id}","due_date":"2026-11-06"}`)
  const cardLine = p.locator('[data-assistant-confirm="pending"] li').filter({ hasText: '→' }).first()
  const lineText = await cardLine.innerText().catch(() => '')
  check('B7 bulle : carte « avant → après », « devient » pour les lecteurs d’écran', /^Échéance : .+ → .+$/.test(lineText.replace(/\s*devient\s*/, ' '))
    && (await cardLine.locator('[aria-hidden="true"]').innerText()).trim() === '→' && (await cardLine.locator('.sr-only').innerText()).trim() === 'devient', lineText)
  await p.locator('[data-assistant-confirm="pending"]').getByRole('button', { name: 'Annuler' }).click()

  const prefixes = await p.evaluate((sel: string) => {
    const sr = (el: Element | null) => { const s = el?.querySelector('.sr-only') as HTMLElement | null; if (!s) return null
      const cs = getComputedStyle(s); return { text: s.textContent?.trim(), hidden: cs.position === 'absolute' && parseFloat(cs.width) <= 1 } }
    return { you: sr(document.querySelector(`${sel} > [data-assistant-user]`)), bot: sr(document.querySelector(`${sel} > [data-item]`)),
      live: document.querySelector(sel)?.getAttribute('aria-live') }
  }, LOG)
  await ask(p, 'HTTP400')
  const alert = p.locator(`${LOG} [role=alert]`).last()
  check('B8 bulle : préfixes masqués « Vous : » / « Assistant IA : », fil aria-live polite, erreur role=alert',
    prefixes.you?.text === 'Vous :' && prefixes.you.hidden && prefixes.bot?.text === 'Assistant IA :' && prefixes.bot.hidden && prefixes.live === 'polite'
    && (await alert.count()) === 1, prefixes)
  check('B3 bulle : fil refusé → message « Cette conversation ne peut pas continuer. » avec le bouton « Nouvelle conversation »',
    (await alert.locator('p').innerText()) === FR['shell.assistant.err.history'] && (await alert.locator('[data-assistant-reset-inline]').innerText()) === FR['shell.assistant.new'])
  await alert.locator('[data-assistant-reset-inline]').click()
  const after = await p.evaluate((sel: string) => document.querySelectorAll(`${sel} > [data-item], ${sel} > [data-assistant-user], ${sel} > [role=alert]`).length, LOG)
  const stored = await p.evaluate((k: string) => JSON.parse(sessionStorage.getItem(k) ?? 'null'), `projectlead.assistant.${me.account.id}.${me.user.id}`)
  check('B3 bulle : ce bouton recommence la conversation (fil vide)', after === 0 && stored?.items?.length === 0 && stored.api.length === 0
    && await p.evaluate(() => document.activeElement?.hasAttribute('data-assistant-input')), { after, stored })

  process.env.ASSISTANT_TURN_TIMEOUT_MS = '1000'
  await ask(p, 'LENT:5000')
  delete process.env.ASSISTANT_TURN_TIMEOUT_MS
  const slow = p.locator(`${LOG} [role=alert]`).last()
  check('B3 bulle : une autre erreur (délai) n’a pas ce bouton, texte du délai', (await slow.innerText()).trim() === FR['shell.assistant.err.timeout']
    && (await slow.locator('button').count()) === 0, await slow.innerText().catch(() => ''))

  // Entrée pendant une composition (IME) : rien ne part ; Entrée seule : la demande part (contre-épreuve).
  await p.fill('[data-assistant-input]', 'Bonjour IME')
  const users0 = await p.locator(`${LOG} > [data-assistant-user]`).count()
  await p.locator('[data-assistant-input]').evaluate((el: HTMLElement) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true })))
  await p.waitForTimeout(400)
  const composing = { value: await p.inputValue('[data-assistant-input]'), users: await p.locator(`${LOG} > [data-assistant-user]`).count() }
  await p.locator('[data-assistant-input]').press('Enter')
  await p.waitForFunction((sel: string) => !document.querySelector('[data-assistant-panel] [role=status]') && document.querySelectorAll(`${sel} > [data-assistant-user]`).length > 0, LOG, { timeout: 30_000 }).catch(() => {})
  check('B8 bulle : Entrée pendant une composition IME n’envoie pas, Entrée seule envoie', composing.value === 'Bonjour IME' && composing.users === users0
    && (await p.locator(`${LOG} > [data-assistant-user]`).count()) === users0 + 1, composing)

  const keys = await p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('projectlead.assistant.')))
  check('B10 bulle : fil rangé sous une clé avec l’entreprise et la personne', JSON.stringify(keys) === JSON.stringify([`projectlead.assistant.${me.account.id}.${me.user.id}`]), keys)

  await p.locator('[data-assistant-reset]').focus()
  await p.keyboard.press('Escape')
  check('B8 bulle : Échap ferme depuis un bouton du panneau et rend le focus à la bulle', (await p.locator('[data-assistant-panel]').count()) === 0
    && await p.evaluate(() => document.activeElement?.hasAttribute('data-assistant-bubble')))

  await p.emulateMedia({ media: 'print' })
  const printBubble = await p.locator('[data-assistant-bubble]').isVisible()
  await p.emulateMedia({ media: 'screen' })
  await p.click('[data-assistant-bubble]')
  await p.emulateMedia({ media: 'print' })
  const printPanel = await p.locator('[data-assistant-panel]').isVisible()
  await p.emulateMedia({ media: 'screen' })
  check('B9 bulle : bulle et panneau cachés à l’impression', !printBubble && !printPanel && await p.locator('[data-assistant-panel]').isVisible())
  await d.ctx.close()

  // Stockage refusé (navigation privée stricte, quota plein) : la bulle marche, le fil reste à l'écran.
  const s = await open({ width: 1280, height: 860 }, () => {
    const set = Storage.prototype.setItem, get = Storage.prototype.getItem
    Storage.prototype.setItem = function (k: string, v: string) { if (this === window.sessionStorage) throw new DOMException('plein', 'QuotaExceededError'); return set.call(this, k, v) }
    Storage.prototype.getItem = function (k: string) { if (this === window.sessionStorage) throw new DOMException('refusé', 'SecurityError'); return get.call(this, k) }
  })
  await s.page.goto(`${BASE}/`)
  await s.page.waitForSelector('[data-assistant-bubble]', { timeout: 60_000 })
  await s.page.click('[data-assistant-bubble]')
  await ask(s.page, 'Bonjour')
  check('B10 bulle : stockage plein ou refusé toléré (le fil reste à l’écran, aucune erreur)',
    (await s.page.locator(`${LOG} > [data-item]`).last().innerText()).includes('Bonjour.') && !errors.length, errors)
  await s.ctx.close()

  // ---------------------------------------------------------------- téléphone, 390 px ; seuils 640 / 641 px
  const m = await open({ width: 390, height: 844 })
  const bottoms: unknown[] = []
  for (const path of ['/', '/projets', '/taches', `/projets/${pid}/liste`, '/reglages/equipe']) {
    await m.page.goto(`${BASE}${path}`)
    await m.page.waitForSelector('[data-assistant-bubble]', { timeout: 60_000 })
    await m.page.waitForTimeout(800)
    await m.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await m.page.waitForTimeout(300)
    bottoms.push({ path, ...(await m.page.evaluate(() => {
      const fab = document.querySelector('[data-assistant-bubble]')!.getBoundingClientRect()
      let bottom = 0, last: Element | null = null
      for (const el of document.querySelectorAll('main *')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0 && r.bottom > bottom) { bottom = r.bottom; last = el }
      }
      const lr = last?.getBoundingClientRect()
      return { bottom: Math.round(bottom), fabTop: Math.round(fab.top), scrolls: document.documentElement.scrollHeight > innerHeight,
        atEnd: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1,
        disjoint: Boolean(lr && (lr.bottom <= fab.top || lr.right <= fab.left || lr.left >= fab.right)) }
    })) })
  }
  check('B9 bulle : à 390 px, le bas de chaque page défile au-dessus de la bulle', bottoms.every((b: any) => b.atEnd && b.bottom > 0 && b.bottom <= b.fabTop && b.disjoint)
    && bottoms.filter((b: any) => b.scrolls).length >= 3, bottoms)
  await m.page.click('[data-assistant-bubble]')
  const size = await m.page.locator('[data-assistant-input]').evaluate((el: HTMLElement) => getComputedStyle(el).fontSize)
  check('B9 bulle : champ en 16 px au téléphone', size === '16px', size)
  const panelAt = async (width: number) => {
    await m.page.setViewportSize({ width, height: 800 })
    await m.page.waitForTimeout(200)
    return m.page.locator('[data-assistant-panel]').boundingBox()
  }
  const at640 = await panelAt(640), at641 = await panelAt(641)
  check('B9 bulle : panneau plein écran jusqu’à 640 px, flottant à 641 px', at640?.width === 640 && at640?.height === 800 && at641 !== null && at641.width === 400, { at640, at641 })
  await m.ctx.close()
} finally {
  await browser.close()
}
check('bulle : aucune erreur JavaScript', !errors.length, errors)

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
fake.close()
server.close()
await pool.end()
console.log(ko ? 'ASSISTANT_BULLE_CHECK_FAILED' : 'ASSISTANT_BULLE_CHECK_OK')
process.exit(ko ? 1 : 0)
