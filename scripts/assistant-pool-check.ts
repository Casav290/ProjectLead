/**
 * Le pool de connexions de la base ne se bloque pas sous les écritures de l'Assistant IA (relecture du 29.10.2026).
 *
 * Chaque essai d'une proposition et chaque « Confirmer » tiennent une connexion pendant tout le lot (transaction
 * partagée, server/db.ts), et chaque route qu'ils appellent en demande une seconde, brève (garde de session). Le modèle
 * peut appeler plusieurs outils dans UN message : le runner les lance ensemble. Ici le pool n'a que 2 connexions
 * (PG_POOL_MAX=2) : le faux service de modèle demande 8 propose_create_task dans un même message, puis 6 « Confirmer »
 * partent en même temps. Avant la correction : blocage sans fin (chaque essai tient une connexion et attend la suivante).
 * Garde-fou : 45 s. Base : TEST_DATABASE_URL ; aucun appel extérieur. Dernière ligne : ASSISTANT_POOL_CHECK_OK.
 */
import 'dotenv/config'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
process.env.APP_SECRET ||= 'assistant-pool-secret-0123456789-abcdef'
process.env.PUBLIC_URL ||= 'http://localhost:5174'
process.env.ASSISTANT_USER_PER_HOUR = '5000'
process.env.ASSISTANT_ACCOUNT_PER_DAY = '50000'
process.env.PG_POOL_MAX = '2'
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
delete process.env.LEAD_ID_CLIENT_SECRET
delete process.env.LEAD_ID_ISSUER
delete process.env.RESEND_API_KEY
delete process.env.SMTP_URL

const N_TOOLS = 8, N_CONFIRMS = 6, WATCHDOG_MS = 45_000
let ok = 0, ko = 0
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}

// Le faux service de modèle : au message « POOL:<id du projet> », N_TOOLS appels d'outil dans la même réponse.
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))
const fake = createServer((req, res) => {
  let d = ''
  req.on('data', (x) => (d += x))
  req.on('end', () => {
    const body = JSON.parse(d || '{}')
    const last = body.messages[body.messages.length - 1]
    const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    const msg = (content: any[], stop_reason: string) => res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant',
      model: body.model, content, stop_reason, stop_sequence: null, usage }))
    res.setHeader('content-type', 'application/json')
    if (Array.isArray(last.content) && last.content.some((b: any) => b.type === 'tool_result')) return msg([{ type: 'text', text: 'Cartes prêtes.' }], 'end_turn')
    const text = typeof last.content === 'string' ? last.content : last.content.map((b: any) => b.text ?? '').join(' ')
    const pid = text.match(/POOL:([0-9a-f-]{36})/)?.[1]
    if (!pid) return msg([{ type: 'text', text: 'Bonjour.' }], 'end_turn')
    msg(Array.from({ length: N_TOOLS }, (_, i) => ({ type: 'tool_use', id: `toolu_pool_${i}_${Date.now()}`, name: 'propose_create_task',
      input: { project_id: pid, title: `Tâche simultanée ${i + 1}` } })), 'tool_use')
  })
})
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${await listen(fake)}`
process.env.ANTHROPIC_API_KEY = 'cle-factice-pour-le-faux-service'

const { migrate } = await import('../server/migrate.js')
await migrate(() => {})
const { default: app } = await import('../server/index.js')
const { pool } = await import('../server/db.js')

let cookie = ''
async function req(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = cookie ? { cookie } : {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await app.request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const m = res.headers.get('set-cookie')?.match(/projectlead_session=([^;]*)/)
  if (m) cookie = m[1] ? `projectlead_session=${m[1]}` : ''
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
}

async function scenario() {
  console.log(`\n— pool de ${process.env.PG_POOL_MAX} connexions, ${N_TOOLS} outils d'écriture dans un même message`)
  const stamp = Date.now().toString(36)
  let r = await req('POST', '/api/auth/signup', { name: 'Ann Pool', email: `ann-pool-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Pool ${stamp}` })
  check('inscription', r.status === 201, r)
  const pid = (await req('POST', '/api/projects', { name: `Projet pool ${stamp}`, status: 'active' })).body.id
  const t0 = Date.now()
  r = await req('POST', '/api/assistant', { messages: [{ role: 'user', content: `POOL:${pid}` }], page: '/projets', locale: 'fr' })
  const cards = (r.body?.actions ?? []).filter((a: any) => a.type === 'confirm')
  check(`${N_TOOLS} propositions simultanées : réponse 200 et ${N_TOOLS} cartes (${Date.now() - t0} ms), dans l’ordre des appels`, r.status === 200 && cards.length === N_TOOLS
    && cards.every((c: any, i: number) => c.summary.lines[0] === `Tâche : « Tâche simultanée ${i + 1} »`), { status: r.status, n: cards.length, body: String(JSON.stringify(r.body)).slice(0, 300) })
  const t1 = Date.now()
  const confirms = await Promise.all(cards.slice(0, N_CONFIRMS).map((c: any) => req('POST', '/api/assistant/confirm', { token: c.token })))
  check(`${N_CONFIRMS} « Confirmer » simultanés : tous 200 (${Date.now() - t1} ms)`, confirms.length === N_CONFIRMS && confirms.every((x) => x.status === 200), confirms.map((x) => x.status))
  const n = Number((await pool.query('select count(*)::int as n from tasks where project_id = $1', [pid])).rows[0].n)
  check(`en base : exactement ${N_CONFIRMS} tâches`, n === N_CONFIRMS, n)
  r = await req('GET', `/api/projects/${pid}`)
  check('le pool sert encore une requête ordinaire ensuite', r.status === 200, r.status)
}

const watchdog = new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), WATCHDOG_MS))
const outcome = await Promise.race([scenario().then(() => 'done' as const), watchdog])
if (outcome === 'blocked') check(`aucun blocage : le scénario finit en moins de ${WATCHDOG_MS / 1000} s`, false, 'pool bloqué')
console.log(`\n${ok} contrôles verts, ${ko} rouges`)
fake.close()
console.log(ko || outcome === 'blocked' ? 'ASSISTANT_POOL_CHECK_FAILED' : 'ASSISTANT_POOL_CHECK_OK')
process.exit(ko || outcome === 'blocked' ? 1 : 0)
