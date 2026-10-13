#!/usr/bin/env node
/**
 * Parcours de paiement RÉEL en mode TEST Stripe, en local, navigateur sans tête (Playwright) :
 * connexion par un faux Compte Lead → Réglages → Entreprise → « Passer à Pro » → Stripe Checkout de test, carte
 * 4242 4242 4242 4242 → retour → événements du compte de test rejoués, signés, vers le webhook local → formule Pro,
 * déclaration au Compte Lead → portail Stripe (seulement l'abonnement ProjectLead) → résiliation en fin de période.
 * Des abonnements de test d'une AUTRE application (prix ScanLead, et un prix ScanLead marqué projectlead) sont créés
 * en même temps : leurs événements rejoués doivent revenir « other_app » sans aucune écriture.
 *
 *   npm run build
 *   TEST_DATABASE_URL=postgres://…@localhost:5432/projectlead_test_abo STRIPE_SECRET_KEY=sk_test_… \
 *   STRIPE_PRICE_PRO_MONTHLY=… STRIPE_PRICE_PRO_YEARLY=… STRIPE_PRICE_PROPLUS_MONTHLY=… STRIPE_PRICE_PROPLUS_YEARLY=… \
 *   STRIPE_PORTAL_CONFIGURATION=bpc_… node scripts/e2e-abonnement.mjs        → E2E_ABONNEMENT_OK
 *
 * Garde-fous : clé de test seulement ; base locale seulement ; adresses e-mail en exemple.test (aucun e-mail réel) ;
 * aucune variable du poste n'est transmise au serveur local hors de celles listées ici. À la fin, les abonnements de
 * test créés par CE passage sont résiliés (mode test), pour laisser le compte de test propre.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import pg from 'pg'

const ROOT = join(import.meta.dirname, '..')
const KEY = process.env.STRIPE_SECRET_KEY ?? ''
const DB = process.env.TEST_DATABASE_URL ?? ''
const SHOTS = process.env.E2E_SHOTS ?? join(ROOT, '.e2e-captures')
const PRICES = ['STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY', 'STRIPE_PRICE_PROPLUS_MONTHLY', 'STRIPE_PRICE_PROPLUS_YEARLY', 'STRIPE_PORTAL_CONFIGURATION']
if (!/^(sk|rk)_test_/.test(KEY)) { console.error('Clé Stripe de TEST exigée.'); process.exit(1) }
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(DB)) { console.error('TEST_DATABASE_URL doit viser une base locale.'); process.exit(1) }
for (const k of PRICES) if (!process.env[k]) { console.error(`${k} manquant (scripts/stripe-setup.mjs en mode test).`); process.exit(1) }
mkdirSync(SHOTS, { recursive: true })

let ok = 0, ko = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stripe = async (method, path, params) => {
  const body = params ? new URLSearchParams(params).toString() : undefined
  const r = await fetch(`https://api.stripe.com${path}${method === 'GET' && body ? `?${body}` : ''}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? body : undefined })
  const d = await r.json()
  if (!r.ok) throw new Error(`stripe ${path}: ${d?.error?.message ?? r.status}`)
  return d
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))

// ------------------------------------------------------------------ faux Compte Lead (ERPlead), calcul par application
const stamp = Date.now().toString(36)
const person = { sub: `e2e-abo-${stamp}`, email: `e2e-abo-${stamp}@exemple.test`, email_verified: true, name: 'Test Abonnement',
  locale: 'fr', org: `e2e-abo-org-${stamp}`, org_name: `TEST Abonnement ${stamp}`, org_role: 'admin' }
const NAMES = { free: ['Gratuit', 0, 1], pro: ['Pro', 10, 1], pro_plus: ['Pro+', 20, 5] }
const planOf = (code, source, until = null) => ({ code, name: NAMES[code][0], rank: NAMES[code][1], seats: NAMES[code][2], source, valid_until: until })
const declared = []
// La formule ProjectLead : celle des abonnements ProjectLead déclarés. Un Pro+ CRMlead (autre application) n'ouvre rien ici.
const rights = () => {
  // Le dernier état déclaré de chaque abonnement, comme la table subscriptions d'ERPlead (upsert par external_id).
  const last = [...new Map(declared.map((d) => [d.external_id, d])).values()]
  const live = last.filter((d) => ['active', 'trialing', 'past_due'].includes(d.status)).at(-1)
  const p = live ? planOf(live.plan, 'own', live.current_period_end) : planOf('free', 'free')
  return { app: 'projectlead', plan: p, org_seats: Math.max(p.seats, 5),
    apps: { projectlead: { access: true, name: 'ProjectLead', status: 'live', upgrade_url: 'https://projectlead.io/reglages/entreprise', plan: p },
            crmlead: { access: true, name: 'CRMlead', status: 'live', upgrade_url: 'https://crmlead.io/settings#billing', plan: planOf('pro_plus', 'own') } },
    subscriptions: declared.map((d) => ({ app: 'projectlead', plan: d.plan, lead_plan: d.plan, status: d.status, current_period_end: d.current_period_end })) }
}
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256', use: 'sig' }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const codes = new Map()
let issuer = ''
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (x) => (d += x)); req.on('end', () => r(d)) })
const iss = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/oauth/authorize') {
    const code = randomBytes(12).toString('hex')
    codes.set(code, url.searchParams.get('nonce'))
    res.writeHead(302, { location: `${url.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state'))}` })
    return res.end()
  }
  res.setHeader('content-type', 'application/json')
  if (url.pathname === '/oauth/jwks') return res.end(JSON.stringify({ keys: [jwk] }))
  if (url.pathname === '/oauth/token') {
    const f = new URLSearchParams(await readBody(req))
    const nonce = f.get('grant_type') === 'authorization_code' ? codes.get(f.get('code')) : undefined
    const now = Math.floor(Date.now() / 1000)
    const h = b64({ alg: 'RS256', kid: 'e2e', typ: 'JWT' })
    const p = b64({ iss: issuer, aud: 'projectlead', iat: now, exp: now + 300, auth_time: now, nonce, ...person, lead: rights() })
    const idt = `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`
    return res.end(JSON.stringify({ access_token: 'e2e-billing', id_token: idt, token_type: 'Bearer', expires_in: 300, scope: 'openid lead billing' }))
  }
  if (req.headers.authorization !== 'Bearer e2e-billing') { res.statusCode = 401; return res.end('{"error":"invalid_token"}') }
  if (url.pathname === '/api/lead-id/v1/entitlements') return res.end(JSON.stringify({ org: person.org, ...rights() }))
  if (url.pathname === '/api/lead-id/v1/subscriptions' && req.method === 'POST') {
    const b = JSON.parse(await readBody(req) || '{}')
    if (b.org !== person.org) { res.statusCode = 404; return res.end('{"error":"org_not_found"}') }
    declared.push(b)
    return res.end(JSON.stringify({ org: person.org, ...rights() }))
  }
  res.statusCode = 404; res.end('{}')
})
issuer = `http://127.0.0.1:${await listen(iss)}`

// ------------------------------------------------------------------ serveur ProjectLead local (base de test, Stripe de test)
if (!existsSync(join(ROOT, 'dist', 'index.html'))) execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' })
const port = Number(process.env.E2E_PORT ?? 3412)
const BASE = `http://127.0.0.1:${port}`
const WHSEC = `whsec_local_${randomBytes(18).toString('hex')}`   // secret du serveur local, propre à ce passage
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', PORT: String(port), PUBLIC_URL: BASE, DATABASE_URL: DB,
  APP_SECRET: randomBytes(24).toString('hex'), JOBS_DISABLED: '1',
  LEAD_ID_ISSUER: issuer, LEAD_ID_CLIENT_ID: 'projectlead', LEAD_ID_CLIENT_SECRET: 'lid_e2e_local', LEAD_ID_APP: 'projectlead',
  LEAD_ID_REDIRECT_URI: `${BASE}/auth/lead/callback`,
  STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC, ...Object.fromEntries(PRICES.map((k) => [k, process.env[k]])),
}
execFileSync(join(ROOT, 'node_modules/.bin/tsx'), ['server/migrate.ts'], { cwd: ROOT, env, stdio: 'ignore' })
const server = spawn(join(ROOT, 'node_modules/.bin/tsx'), ['server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
const serverLog = []
server.stdout.on('data', (d) => serverLog.push(String(d)))
server.stderr.on('data', (d) => serverLog.push(String(d)))
for (let i = 0; ; i++) {
  if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok) break
  if (i > 60) { console.error('serveur local muet', serverLog.join('').slice(-2000)); process.exit(1) }
  await sleep(500)
}
const db = new pg.Client({ connectionString: DB }); await db.connect()

const created = []   // abonnements de test créés par ce passage (résiliés à la fin)
const replay = (since) => new Promise((resolve) => {
  const p = spawn('node', [join(ROOT, 'scripts/stripe-replay.mjs'), '--since', String(since), '--to', `${BASE}/api/stripe/webhook`, '--all'],
    { cwd: ROOT, env: { PATH: process.env.PATH, STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC } })
  let out = ''
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d))
  p.on('close', (code) => resolve({ code, out, lines: out.split('\n').filter((l) => /^evt_/.test(l)) }))
})
/** Attend que Stripe ait publié un événement qui satisfait `test` (la liste suit l'action de quelques secondes). */
async function waitEvent(since, test, what) {
  for (let i = 0; i < 40; i++) {
    const d = await stripe('GET', '/v1/events', { limit: '100', 'created[gte]': String(since) })
    if (d.data.some(test)) return true
    await sleep(1500)
  }
  console.log(`  (événement attendu non publié : ${what})`)
  return false
}

const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 900 } })).newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error' && page.url().startsWith(BASE)) consoleErrors.push(m.text()) })
const api = async (path) => (await page.request.get(`${BASE}/api${path}`)).json()
let accountId = null
try {
  console.log('Connexion et page Formule')
  await page.goto(`${BASE}/auth/lead/start?next=/reglages/entreprise`)
  await page.waitForURL(`${BASE}/reglages/entreprise`)
  await page.getByRole('heading', { name: 'Formule ProjectLead' }).waitFor()
  accountId = (await api('/me')).account?.id
  let b = await api('/billing')
  check('connecté (faux Compte Lead, Pro+ seulement dans CRMlead) : ProjectLead en Gratuit, paiement ouvert',
    b.configured === true && b.portal === true && b.plan.tier === 'free' && b.canManage === true, b)
  await page.screenshot({ path: join(SHOTS, '1-formule-gratuit.png'), fullPage: true })

  // Des abonnements de test d'une autre application, pendant ce temps, sur le même compte de test.
  const t0 = Math.floor(Date.now() / 1000) - 5
  const scanPrice = (await stripe('GET', '/v1/prices', { 'lookup_keys[0]': 'scanlead_pro_monthly', active: 'true', limit: '1' })).data[0]
    ?? (await stripe('GET', '/v1/prices', { product: 'prod_UzSicEUduJzwSm', active: 'true', limit: '1' })).data[0]
  if (scanPrice) {
    const cus = await stripe('POST', '/v1/customers', { email: `autre-app-${stamp}@exemple.test`, 'metadata[app]': 'e2e-autre-application',
      payment_method: 'pm_card_visa', 'invoice_settings[default_payment_method]': 'pm_card_visa' })
    for (const meta of [{ 'metadata[plan]': 'solo' }, { 'metadata[app]': 'projectlead', 'metadata[account_id]': accountId, 'metadata[plan]': 'pro' }]) {
      const s = await stripe('POST', '/v1/subscriptions', { customer: cus.id, 'items[0][price]': scanPrice.id, ...meta })
      created.push(s.id)
    }
  } else console.log('  (aucun prix ScanLead de test : abonnements d\'une autre application non créés)')

  console.log('Stripe Checkout de test (carte 4242)')
  await page.getByRole('button', { name: 'Passer à Pro', exact: true }).click()
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 })
  await page.locator('#cardNumber').waitFor({ timeout: 30_000 })
  await page.screenshot({ path: join(SHOTS, '2-checkout.png'), fullPage: true })
  const fill = async (sel, v) => { const l = page.locator(sel); if (await l.count()) await l.first().fill(v) }
  const email = page.locator('#email')
  if (await email.count() && await email.isEditable().catch(() => false) && !(await email.inputValue())) await email.fill(person.email)
  await fill('#cardNumber', '4242 4242 4242 4242')
  await fill('#cardExpiry', '12 / 34')
  await fill('#cardCvc', '123')
  await fill('#billingName', 'Test Abonnement')
  if (await page.locator('#billingCountry').count()) await page.locator('#billingCountry').selectOption('CH')
  const manual = page.locator('button:has-text("manuellement"), .AddressAutocomplete-manual-entry button, .AddressAutocomplete-manual-entry a')
  if (await manual.count() && await manual.first().isVisible().catch(() => false)) await manual.first().click()
  await fill('#billingAddressLine1', 'Rue du Test 1')
  await fill('#billingPostalCode', '1003')
  await fill('#billingLocality', 'Lausanne')
  const link = page.locator('#enableStripePass')
  if (await link.count() && await link.isChecked().catch(() => false)) await link.uncheck().catch(() => {})
  await page.screenshot({ path: join(SHOTS, '3-checkout-rempli.png'), fullPage: true })
  await page.locator('button[type="submit"], .SubmitButton').first().click()
  await page.waitForURL((u) => u.href.startsWith(`${BASE}/reglages/entreprise`), { timeout: 90_000 })
  check('paiement de test accepté : retour sur Réglages → Entreprise', true)
  await page.screenshot({ path: join(SHOTS, '4-retour.png'), fullPage: true })

  console.log('Rejeu signé des événements du compte de test vers le webhook local')
  await waitEvent(t0, (e) => e.type === 'checkout.session.completed' && e.data.object.metadata?.account_id === accountId, 'Checkout terminé')
  if (created.length) await waitEvent(t0, (e) => e.type === 'customer.subscription.created' && e.data.object.id === created.at(-1), 'abonnement de l\'autre application')
  let rp = await replay(t0)
  const mine = rp.lines.filter((l) => /app=projectlead/.test(l) && /\s(applied|stale|duplicate)$/.test(l))
  check('rejeu : les événements ProjectLead sont appliqués (Checkout terminé, abonnement créé)', rp.code === 0 && mine.length >= 2, rp.out.slice(-1500))
  b = await api('/billing')
  const sub = b.subscription
  check('formule Pro dans ProjectLead (abonnement ProjectLead mensuel actif)', b.plan.tier === 'pro' && b.plan.paidTier === 'pro' && sub?.active === true
    && sub.plan === 'pro' && sub.interval === 'month' && sub.endsAt === null, b)
  const row = (await db.query('select * from billing_subscriptions where account_id = $1', [accountId])).rows
  created.push(...row.map((r) => r.stripe_subscription_id))
  const decl = declared.filter((d) => d.external_id === row[0]?.stripe_subscription_id)
  check('déclaré au Compte Lead : org, pro, active, sub_…', row.length === 1 && decl.length >= 1 && decl.at(-1).plan === 'pro' && decl.at(-1).status === 'active'
    && decl.at(-1).org === person.org && row[0].erplead_synced_at !== null, { row, decl })
  const stripeSub = await stripe('GET', `/v1/subscriptions/${row[0]?.stripe_subscription_id}`)
  const cus = await stripe('GET', `/v1/customers/${stripeSub.customer}`)
  const sess = (await stripe('GET', '/v1/checkout/sessions', { subscription: stripeSub.id, limit: '1' })).data[0]
  check('chez Stripe : abonnement, client et session marqués app=projectlead, sans client_reference_id',
    stripeSub.metadata?.app === 'projectlead' && stripeSub.metadata?.account_id === accountId && cus.metadata?.app === 'projectlead'
    && cus.metadata?.account_id === accountId && sess?.metadata?.app === 'projectlead' && !sess?.client_reference_id
    && stripeSub.items.data[0].price.lookup_key === 'projectlead_pro_monthly', { sub: stripeSub.metadata, cus: cus.metadata, ref: sess?.client_reference_id })
  // Les autres applications : chaque événement rejoué revient « other_app », et rien n'est écrit pour leurs abonnements.
  const foreign = rp.lines.filter((l) => !/app=projectlead/.test(l))
  const foreignBad = foreign.filter((l) => !/\sother_app$/.test(l))
  const fixtures = created.filter((id) => !row.some((r) => r.stripe_subscription_id === id))
  const fxEvents = (await stripe('GET', '/v1/events', { limit: '100', 'created[gte]': String(t0) })).data
    .filter((e) => fixtures.includes(e.data.object.id) || fixtures.includes(e.data.object.subscription)).map((e) => e.id)
  const written = (await db.query(`select (select count(*) from stripe_events where id = any($1))::int as events,
    (select count(*) from billing_subscriptions where stripe_subscription_id = any($2))::int as subs`, [fxEvents, fixtures])).rows[0]
  check('événements des autres applications du compte de test partagé : tous « other_app »', foreign.length > 0 && foreignBad.length === 0, foreignBad)
  check('abonnements de test d\'une autre application (prix ScanLead, et prix ScanLead marqué « projectlead ») : aucune écriture',
    fixtures.length === 2 && fxEvents.length >= 2 && written.events === 0 && written.subs === 0, { fixtures, fxEvents: fxEvents.length, written })
  await page.reload()
  const current = page.locator('p', { hasText: /^Votre formule :/ }).first()
  await current.waitFor()
  const shown = await current.innerText()
  check('la page affiche la formule Pro et « Gérer l\'abonnement »', /Pro\b/.test(shown) && await page.getByRole('button', { name: "Gérer l'abonnement" }).isVisible(), shown)
  await page.screenshot({ path: join(SHOTS, '5-formule-pro.png'), fullPage: true })

  console.log('Portail Stripe propre à ProjectLead')
  const t1 = Math.floor(Date.now() / 1000) - 5
  await page.getByRole('button', { name: "Gérer l'abonnement" }).click()
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 })
  await page.getByText('ProjectLead Pro').first().waitFor({ timeout: 30_000 })
  await page.screenshot({ path: join(SHOTS, '6-portail.png'), fullPage: true })
  // Le portail ne montre que les abonnements du client Stripe propre à ProjectLead (l'en-tête porte le nom du compte
  // Stripe partagé, « Scanlead Login Sandbox » en test, « scanlead.io » en réel : ce n'est pas un abonnement).
  const portalText = await page.locator('body').innerText()
  const listed = portalText.split(/ABONNEMENT EN COURS|ABONNEMENTS EN COURS/i)[1]?.split(/MOYEN DE PAIEMENT/i)[0] ?? ''
  const cusSubs = (await stripe('GET', '/v1/subscriptions', { customer: stripeSub.customer, status: 'all', limit: '100' })).data
  check('portail : un seul abonnement, ProjectLead Pro ; le client Stripe n\'en a pas d\'autre application',
    /ProjectLead Pro/.test(listed) && (listed.match(/€ par (mois|an)/g) ?? []).length === 1
    && cusSubs.length === 1 && cusSubs.every((x) => x.metadata?.app === 'projectlead'), { listed: listed.slice(0, 300), n: cusSubs.length })
  const cancel = page.locator('a[data-test="cancel-subscription"], button[data-test="cancel-subscription"]')
    .or(page.getByRole('link', { name: /annuler l.abonnement/i })).or(page.getByRole('button', { name: /annuler l.abonnement/i }))
  await cancel.first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(SHOTS, '7-portail-annuler.png'), fullPage: true })
  await page.locator('button[data-testid="confirm"], button[data-test="confirm"]').or(page.getByRole('button', { name: /annuler l.abonnement/i })).first().click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(SHOTS, '8-portail-annule.png'), fullPage: true })
  // Selon la version d'API, la résiliation en fin de période pose cancel_at_period_end ou cancel_at.
  await waitEvent(t1, (e) => e.type === 'customer.subscription.updated' && e.data.object.id === stripeSub.id
    && (e.data.object.cancel_at_period_end || e.data.object.cancel_at), 'résiliation en fin de période')
  rp = await replay(t1)
  b = await api('/billing')
  check('résiliation au portail : fin de période annoncée, toujours Pro jusque-là', rp.code === 0
    && Date.parse(b.subscription?.endsAt ?? '') === Date.parse(b.subscription?.currentPeriodEnd ?? 'x')
    && b.plan.tier === 'pro', { b, out: rp.out.slice(-800) })
  await page.goto(`${BASE}/reglages/entreprise`)
  const ending = page.locator('p', { hasText: /se termine le/ }).first()
  await ending.waitFor({ timeout: 15_000 }).catch(() => {})
  check('la page annonce la fin de l\'abonnement', await ending.isVisible(), null)
  await page.screenshot({ path: join(SHOTS, '9-fin-annoncee.png'), fullPage: true })
} catch (e) {
  ko++
  console.log('  ✗ parcours interrompu :', e?.message ?? e)
  await page.screenshot({ path: join(SHOTS, 'erreur.png'), fullPage: true }).catch(() => {})
} finally {
  // Propreté du compte de test : les abonnements de test de CE passage sont résiliés (mode test uniquement).
  const t2 = Math.floor(Date.now() / 1000) - 5
  let cleaned = 0
  for (const id of created) {
    const s = await stripe('GET', `/v1/subscriptions/${id}`).catch(() => null)
    if (s && !['canceled', 'incomplete_expired'].includes(s.status)) { await stripe('DELETE', `/v1/subscriptions/${id}`).catch(() => null); cleaned++ }
  }
  const ours = accountId ? (await db.query('select stripe_subscription_id as id from billing_subscriptions where account_id = $1', [accountId]).catch(() => ({ rows: [] }))).rows.map((r) => r.id) : []
  if (cleaned && ours.length) {
    await waitEvent(t2, (e) => e.type === 'customer.subscription.deleted' && ours.includes(e.data.object.id), 'résiliation de fin de test')
    const rp = await replay(t2)
    const b = await api('/billing').catch(() => null)
    check('fin de test (abonnements de test résiliés) : retour en Gratuit après rejeu', rp.code === 0 && b?.plan?.tier === 'free', b?.plan)
  }
  check('aucune erreur dans la console de ProjectLead', consoleErrors.length === 0, consoleErrors)
  await browser.close(); server.kill(); iss.close(); await db.end()
}
console.log(`\n${ok} contrôles verts, ${ko} rouges — captures : ${SHOTS}`)
if (ko) { console.log(serverLog.join('').split('\n').filter((l) => /\[(stripe|abonnement|api)\]/.test(l)).slice(-20).join('\n')); process.exit(1) }
console.log('E2E_ABONNEMENT_OK')
process.exit(0)
