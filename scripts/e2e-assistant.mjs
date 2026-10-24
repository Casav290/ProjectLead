/**
 * Essai réel de l'Assistant IA sur un déploiement d'APERÇU Vercel (jamais la production), navigateur sans tête.
 *
 * - Aperçu : adresse dans PL_PREVIEW_URL (défaut : ~/projets/.unlazy/assistant-ia/projectlead-preview.url), protection
 *   Vercel franchie par le jeton d'automatisation du projet (PL_BYPASS_FILE, hors dépôt).
 * - Base : la branche Neon de l'aperçu (copie de la production, PL_E2E_DB_FILE, hors dépôt). Le script refuse toute
 *   autre base que celle de l'aperçu (garde `PL_E2E_DB_HOST`). Il y ouvre une session pour une personne de test
 *   (entreprise « TEST … » de ~/projets/lead-e2e, PL_E2E_ORG / PL_E2E_USER), puis la referme à la fin.
 * - Parcours : question de lecture sur les vraies données, navigation, création confirmée puis lue en base, création
 *   annulée → rien en base, demande interdite (supprimer) → refus sans carte, captures bureau et mobile.
 *
 * Dernière ligne : E2E_ASSISTANT_OK. Aucun message envoyé, aucun compte créé, rien supprimé.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const pg = createRequire(`${homedir()}/projets/lead-e2e/`)('pg')
pg.types.setTypeParser(1082, (v) => v)   // une date reste AAAA-MM-JJ

const dir = `${homedir()}/projets/.unlazy/assistant-ia`
const BASE = (process.env.PL_PREVIEW_URL || readFileSync(`${dir}/projectlead-preview.url`, 'utf8')).trim().replace(/\/$/, '')
const BYPASS = readFileSync(process.env.PL_BYPASS_FILE || `${dir}/projectlead-bypass.secret`, 'utf8').trim()
const DB = readFileSync(process.env.PL_E2E_DB_FILE || `${dir}/projectlead-apercu-db.url`, 'utf8').trim().replace('-pooler', '')
const DB_HOST = process.env.PL_E2E_DB_HOST || 'ep-withered-water-b46eswxg'
const ORG = process.env.PL_E2E_ORG || 'ea5a8085-b868-4d7f-91a8-ac382e43e3e8'   // TEST Boulangerie Favre
const USER = process.env.PL_E2E_USER || '448e9591-ce80-4c97-ac39-43dadd583386'  // Léa Favre, administratrice (test)
const SHOTS = `${dir}/captures/projectlead`
mkdirSync(SHOTS, { recursive: true })

if (/projectlead\.io/.test(BASE) || !/vercel\.app$/.test(new URL(BASE).host)) throw new Error('refus : pas une adresse d’aperçu')
if (!DB.includes(DB_HOST)) throw new Error('refus : ce n’est pas la base de l’aperçu')

let ok = 0, ko = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}

const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
await db.connect()
const q = async (sql, args = []) => (await db.query(sql, args)).rows

// Une session pour la personne de test, sur la base de l'aperçu seulement.
const token = randomBytes(32).toString('base64url')
const hash = createHash('sha256').update(token).digest('hex')
await q(`insert into sessions (token_hash, user_id, account_id, expires_at, user_agent) values ($1,$2,$3, now() + interval '2 hours', 'e2e-assistant')`, [hash, USER, ORG])
const project = (await q(`select id, name from projects where account_id = $1 and status = 'active' and not is_template and archived_at is null
  and visibility = 'account' order by name limit 1`, [ORG]))[0]
const activeCount = (await q(`select count(*)::int as n from projects where account_id = $1 and status = 'active' and not is_template and archived_at is null`, [ORG]))[0].n
console.log(`Aperçu ${BASE} — projet témoin « ${project.name} », ${activeCount} projets en cours`)
const stamp = Date.now().toString(36)
const cookie = (host) => ({ name: 'projectlead_session', value: token, domain: host, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' })

const browser = await chromium.launch()
async function open(viewport, isMobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-CH',
    extraHTTPHeaders: { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } })
  await ctx.addCookies([cookie(new URL(BASE).host)])
  return { ctx, page: await ctx.newPage() }
}
/** Envoie une demande dans la bulle ouverte et attend la fin du travail. */
async function ask(page, text) {
  const before = await page.locator('[data-assistant-panel] .mr-4, [data-assistant-panel] [role=alert]').count()
  await page.fill('[data-assistant-panel] textarea', text)
  await page.keyboard.press('Enter')
  await page.waitForSelector('text=L’assistant travaille…', { timeout: 10_000 }).catch(() => {})
  await page.waitForFunction((n) => document.querySelectorAll('[data-assistant-panel] .mr-4, [data-assistant-panel] [role=alert]').length > n
    && !document.querySelector('[data-assistant-panel] [role=status]'), before, { timeout: 120_000 })
  const replies = await page.locator('[data-assistant-panel] .mr-4, [data-assistant-panel] [role=alert]').allInnerTexts()
  return replies[replies.length - 1]
}

try {
  // ---------------------------------------------------------------- bureau
  const { ctx, page } = await open({ width: 1440, height: 900 })
  await page.goto(`${BASE}/conditions`)
  await page.waitForLoadState('networkidle')
  check('page publique (/conditions) : pas de bulle', (await page.locator('[data-assistant-bubble]').count()) === 0)
  await page.goto(`${BASE}/`)
  await page.waitForSelector('[data-assistant-bubble]', { timeout: 30_000 })
  check('connectée : la bulle est là, accessible', (await page.getAttribute('[data-assistant-bubble]', 'aria-label')) === 'Ouvrir l’Assistant IA')
  await page.click('[data-assistant-bubble]')
  await page.waitForSelector('[data-assistant-panel]')
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 2000 }).catch(() => {})
  check('ouverture : le champ a le focus', await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'))
  check('fil vide : 3 suggestions', (await page.locator('[data-assistant-panel] ul li button').count()) === 3)
  await page.screenshot({ path: `${SHOTS}/bureau-1-ouverte.png` })

  // Lecture sur les vraies données.
  let reply = await ask(page, 'Combien de projets en cours avons-nous ? Donne le nombre exact puis trois noms.')
  check(`lecture : le nombre exact de projets en cours (${activeCount}) et des noms réels`, reply.includes(String(activeCount)) && /Rénovation|Contrat|Projet/.test(reply), reply)
  await page.screenshot({ path: `${SHOTS}/bureau-2-lecture.png` })

  // Navigation.
  reply = await ask(page, 'Ouvre la page des rapports.')
  await page.waitForURL(/\/rapports$/, { timeout: 15_000 }).catch(() => {})
  check('navigation : la page Rapports s’ouvre', new URL(page.url()).pathname === '/rapports', { url: page.url(), reply })

  // Création confirmée.
  const title = `Essai assistant ${stamp}`
  reply = await ask(page, `Crée une tâche « ${title} » dans le projet « ${project.name} », échéance demain, priorité haute.`)
  const card = page.locator('[data-assistant-confirm="pending"]').last()
  check('création : carte « À confirmer » affichée', await card.count() === 1 && (await card.innerText()).includes(title), reply)
  check('création : rien en base avant le clic', (await q('select count(*)::int as n from tasks where title = $1', [title]))[0].n === 0)
  await page.screenshot({ path: `${SHOTS}/bureau-3-a-confirmer.png` })
  await card.getByRole('button', { name: 'Confirmer' }).click()
  await page.waitForSelector('[data-assistant-confirm="done"]', { timeout: 30_000 })
  const created = await q(`select t.id, t.priority, t.due_date, t.created_by, t.project_id from tasks t where t.title = $1`, [title])
  const tomorrow = (await q(`select (now() at time zone coalesce((select timezone from accounts where id = $1), 'Europe/Zurich'))::date + 1 as d`, [ORG]))[0].d
  check('création confirmée : une tâche en base, dans le bon projet, par la personne, priorité haute, échéance demain',
    created.length === 1 && created[0].project_id === project.id && created[0].created_by === USER && created[0].priority === 'high'
    && created[0].due_date === tomorrow, { created, tomorrow })
  await page.screenshot({ path: `${SHOTS}/bureau-4-confirme.png` })

  // Création annulée.
  const cancelled = `Essai annulé ${stamp}`
  await ask(page, `Crée une tâche « ${cancelled} » dans le projet « ${project.name} ».`)
  const card2 = page.locator('[data-assistant-confirm="pending"]').last()
  check('annulation : carte affichée', await card2.count() === 1)
  await card2.getByRole('button', { name: 'Annuler' }).click()
  await page.waitForSelector('[data-assistant-confirm="cancelled"]')
  check('annulation : rien en base', (await q('select count(*)::int as n from tasks where title = $1', [cancelled]))[0].n === 0)

  // Demande interdite.
  const cardsBefore = await page.locator('[data-assistant-confirm]').count()
  reply = await ask(page, `Supprime le projet « ${project.name} ».`)
  const still = await q('select archived_at from projects where id = $1', [project.id])
  check('interdit : refus expliqué, aucune carte, projet intact', /ne peux pas|pas possible|impossible|ne suis pas autoris|pas le droit/i.test(reply)
    && (await page.locator('[data-assistant-confirm]').count()) === cardsBefore && still[0]?.archived_at === null, reply)
  check('interdit : renvoi vers l’écran (page du projet ouverte ou lien)', page.url().includes(project.id) || /\/projets\//.test(await page.locator('[data-assistant-panel] .mr-4').last().innerHTML()), page.url())
  const text = await page.locator('[data-assistant-panel]').innerText()
  check('aucune mention du fournisseur ni du modèle dans la bulle', !/claude|anthropic|opus/i.test(text))
  await page.screenshot({ path: `${SHOTS}/bureau-5-interdit.png` })
  console.log('    focus après la réponse :', await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.closest('[data-assistant-panel]') ? '(dans la bulle)' : ''}`))
  await page.locator('[data-assistant-panel] textarea').focus()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-assistant-bubble'), null, { timeout: 3000 }).catch(() => {})
  check('Échap ferme et rend le focus à la bulle', (await page.locator('[data-assistant-panel]').count()) === 0
    && await page.evaluate(() => document.activeElement?.hasAttribute('data-assistant-bubble')))
  await ctx.close()

  // ---------------------------------------------------------------- mobile
  const m = await open({ width: 390, height: 844 }, true)
  await m.page.goto(`${BASE}/taches`)
  await m.page.waitForSelector('[data-assistant-bubble]', { timeout: 30_000 })
  await m.page.waitForLoadState('networkidle')
  await m.page.waitForSelector('text=Chargement…', { state: 'detached', timeout: 15_000 }).catch(() => {})
  await m.page.screenshot({ path: `${SHOTS}/mobile-1-bulle.png` })
  await m.page.click('[data-assistant-bubble]')
  const box = await m.page.locator('[data-assistant-panel]').boundingBox()
  check('mobile : panneau plein écran', box && box.width >= 389 && box.height >= 840, box)
  reply = await ask(m.page, 'Quelles sont mes tâches ouvertes ? Réponds en une courte liste.')
  check('mobile : réponse reçue', reply.length > 10, reply)
  await m.page.screenshot({ path: `${SHOTS}/mobile-2-ouverte.png` })
  await m.ctx.close()
} finally {
  await browser.close()
  await q('delete from sessions where token_hash = $1', [hash])
  const usage = await q(`select kind, ok, error, tools from assistant_usage where account_id = $1 order by created_at`, [ORG])
  console.log('journal assistant_usage :', JSON.stringify(usage.map((u) => [u.kind, u.ok, u.error, u.tools.join('+')])))
  await db.end()
}

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
console.log(ko ? 'E2E_ASSISTANT_FAILED' : 'E2E_ASSISTANT_OK')
process.exit(ko ? 1 : 0)
