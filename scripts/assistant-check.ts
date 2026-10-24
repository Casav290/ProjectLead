/**
 * Contrôles de l'Assistant IA (bulle), sur une vraie base PostgreSQL (TEST_DATABASE_URL), avec un FAUX service de
 * modèle local (ANTHROPIC_BASE_URL) : aucune clé réelle, aucun appel extérieur. Dernière ligne : ASSISTANT_CHECK_OK.
 *
 * Le faux service joue un scénario selon le texte de la demande (« FAKE:<outil>:<entrée JSON> ») : il demande l'outil,
 * puis, au tour suivant (résultat de l'outil reçu), répond par un texte qui recopie ce résultat. Il garde chaque requête
 * reçue pour vérifier les paramètres envoyés (modèle, effort, max_tokens, repli, cache du système, outils).
 */
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
process.env.APP_SECRET ||= 'assistant-check-secret-0123456789-abcdef'
process.env.PUBLIC_URL ||= 'http://localhost:5174'

import 'dotenv/config'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
delete process.env.LEAD_ID_CLIENT_SECRET
delete process.env.LEAD_ID_ISSUER

// ------------------------------------------------------------------ faux service de modèle
const seen: { headers: Record<string, any>; body: any }[] = []
let mode: 'normal' | 'refusal' | 'fail' = 'normal'
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))
const fake = createServer((req, res) => {
  let d = ''
  req.on('data', (x) => (d += x))
  req.on('end', () => {
    const body = JSON.parse(d || '{}')
    seen.push({ headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    if (mode === 'fail') { res.statusCode = 500; return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } })) }
    const msgs = body.messages as any[]
    const last = msgs[msgs.length - 1]
    const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 }
    const msg = (content: any[], stop_reason: string) => res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant',
      model: body.model, content, stop_reason, stop_sequence: null, usage }))
    if (mode === 'refusal') return msg([], 'refusal')
    const results = Array.isArray(last.content) ? last.content.filter((b: any) => b.type === 'tool_result') : []
    if (results.length) {
      const txt = results.map((r: any) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))).join('\n')
      return msg([{ type: 'text', text: `RESULTAT ${txt}` }], 'end_turn')
    }
    const text = typeof last.content === 'string' ? last.content : last.content.map((b: any) => b.text ?? '').join(' ')
    const m = text.match(/FAKE:([a-z_]+):(\{.*\})/)
    if (!m) return msg([{ type: 'text', text: 'Bonjour.' }], 'end_turn')
    return msg([{ type: 'text', text: 'Je regarde.' }, { type: 'tool_use', id: `toolu_${Date.now()}`, name: m[1], input: JSON.parse(m[2]) }], 'tool_use')
  })
})
const fakePort = await listen(fake)
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fakePort}`

const { migrate } = await import('../server/migrate.js')
await migrate(() => {})
const { default: app } = await import('../server/index.js')
const { pool } = await import('../server/db.js')
const { signConfirm } = await import('../server/lib/assistant/token.js')
const { TOOL_NAMES } = await import('../server/lib/assistant/tools.js')

let ok = 0, ko = 0
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
class Client {
  cookie = ''
  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = this.cookie ? { cookie: this.cookie } : {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await app.request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const set = res.headers.get('set-cookie')
    const m = set?.match(/projectlead_session=([^;]*)/)
    if (m) this.cookie = m[1] ? `projectlead_session=${m[1]}` : ''
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, body: json }
  }
  get = (p: string) => this.req('GET', p)
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {})
}
const ask = (cl: Client, text: string, history: any[] = []) =>
  cl.post('/api/assistant', { messages: [...history, { role: 'user', content: text }], page: '/projets', locale: 'fr' })
const count = async (sql: string, args: unknown[]) => Number((await pool.query(sql, args)).rows[0].n)

const stamp = Date.now().toString(36)
const today = new Date().toISOString().slice(0, 10)

// ------------------------------------------------------------------ deux entreprises, deux personnes
const ann = new Client()
let r = await ann.post('/api/auth/signup', { name: 'Ann Assistant', email: `ann-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Assist ${stamp}` })
check('inscription Ann', r.status === 201, r)
const me = (await ann.get('/api/me')).body
const accountId = me.account.id, annId = me.user.id
r = await ann.post('/api/team/invite', { email: `bob-${stamp}@exemple.test`, role: 'member' })
const bob = new Client()
await bob.post(`/api/auth/invitation/${r.body.link.split('/').pop()}/accept`, { name: 'Bob Membre', password: 'motdepasse-solide' })
const bobId = (await bob.get('/api/me')).body.user.id
check('Bob, membre de la même entreprise', Boolean(bobId) && bobId !== annId)
const eve = new Client()
await eve.post('/api/auth/signup', { name: 'Ève Ailleurs', email: `eve-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Ailleurs ${stamp}` })
const eveMe = (await eve.get('/api/me')).body

r = await ann.post('/api/projects', { name: 'Chantier Alpha', status: 'active' })
const projectId = r.body.id
r = await ann.post('/api/projects', { name: 'Projet Réservé', status: 'planned', visibility: 'members' })
const reservedId = r.body.id
check('projets créés (dont un réservé aux intervenants)', Boolean(projectId && reservedId))
r = await eve.post('/api/projects', { name: 'Projet d’Ève', status: 'active' })
const eveProject = r.body.id

// ------------------------------------------------------------------ 1. sans clé
delete process.env.ANTHROPIC_API_KEY
r = await ann.get('/api/me')
check('sans clé : features.assistant = false (bulle masquée)', r.body.features.assistant === false, r.body.features)
r = await ask(ann, 'Bonjour')
check('sans clé : POST /api/assistant → 503', r.status === 503 && r.body.error === 'assistant_not_configured', r)
process.env.ANTHROPIC_API_KEY = 'cle-factice-pour-le-faux-service'
r = await ann.get('/api/me')
check('avec clé : features.assistant = true', r.body.features.assistant === true)

// ------------------------------------------------------------------ 2. session obligatoire
r = await new Client().post('/api/assistant', { messages: [{ role: 'user', content: 'x' }] })
check('sans session : /api/assistant → 401', r.status === 401, r)
r = await new Client().post('/api/assistant/confirm', { token: 'x'.repeat(40) })
check('sans session : /api/assistant/confirm → 401', r.status === 401, r)

// ------------------------------------------------------------------ 3. paramètres envoyés au modèle
seen.length = 0
r = await ask(ann, 'Bonjour')
const sent = seen[0]?.body
check('réponse simple → 200 avec reply et historique', r.status === 200 && r.body.reply === 'Bonjour.' && r.body.messages.length === 2, r.body)
check('modèle claude-opus-5-5, max_tokens 4000, effort low', sent?.model === 'claude-opus-5-5' && sent?.max_tokens === 4000 && sent?.output_config?.effort === 'low', sent)
check('repli des refus : fallbacks "default" + en-tête server-side-fallback-2026-07-01',
  sent?.fallbacks === 'default' && String(seen[0]?.headers['anthropic-beta'] ?? '').includes('server-side-fallback-2026-07-01'), { f: sent?.fallbacks, h: seen[0]?.headers['anthropic-beta'] })
check('système : bloc stable mis en cache, date et langue après', Array.isArray(sent?.system) && sent.system[0].cache_control?.type === 'ephemeral'
  && !sent.system[0].text.includes(today) && sent.system[1].text.includes(today) && !sent.system[1].cache_control, sent?.system?.map((x: any) => x.cache_control))
const toolNames: string[] = (sent?.tools ?? []).map((t: any) => t.name)
check('outils = la liste prévue, dans l’ordre', JSON.stringify(toolNames) === JSON.stringify(TOOL_NAMES), toolNames)
check('aucun outil de suppression, d’équipe, de membres, d’abonnement, de clés ou d’envoi',
  !toolNames.some((n) => /delete|remove|archive|member|invite|team_|role|billing|subscri|plan|api_key|send|email|reply|portal/.test(n)) && toolNames.includes('list_team'), toolNames)

// ------------------------------------------------------------------ 4. lecture avec les droits de la personne
r = await ask(ann, `FAKE:list_projects:{}`)
check('lecture : list_projects rend les projets d’Ann', r.status === 200 && r.body.reply.includes('Chantier Alpha') && !r.body.reply.includes('Projet d’Ève'), r.body.reply)
check('historique : demande, appel d’outil, résultat, réponse', r.body.messages.length === 4 && r.body.messages[2].content[0].type === 'tool_result', r.body.messages.map((m: any) => m.role))
r = await ask(bob, `FAKE:get_project:{"project_id":"${reservedId}"}`)
check('projet réservé : invisible pour Bob par l’assistant (not_found)', r.status === 200 && r.body.reply.includes('not_found') && !r.body.reply.includes('Projet Réservé'), r.body.reply)
r = await ask(ann, `FAKE:get_project:{"project_id":"${eveProject}"}`)
check('autre entreprise : invisible (not_found)', r.status === 200 && r.body.reply.includes('not_found'), r.body.reply)
r = await ask(ann, `FAKE:open_page:{"path":"/projets/${projectId}/tableau"}`)
check('open_page : action navigate', r.body.actions?.[0]?.type === 'navigate' && r.body.actions[0].path === `/projets/${projectId}/tableau`, r.body.actions)
r = await ask(ann, `FAKE:open_page:{"path":"https://ailleurs.example/x"}`)
check('open_page : adresse extérieure refusée', !r.body.actions?.length && r.body.reply.includes('unknown_page'), r.body)

// ------------------------------------------------------------------ 5. écriture en deux temps
const tasksBefore = await count('select count(*)::int as n from tasks where project_id = $1', [projectId])
seen.length = 0
r = await ask(ann, `FAKE:propose_create_task:{"project_id":"${projectId}","title":"Relancer le client","due_date":"${today}","assignee_ids":["${bobId}"]}`)
const card = r.body.actions?.find((a: any) => a.type === 'confirm')
check('proposition : carte « À confirmer » avec un résumé lisible', r.status === 200 && card?.token && card.summary.title === 'Créer une tâche'
  && card.summary.lines.some((l: string) => l.includes('Chantier Alpha')) && card.summary.lines.some((l: string) => l.includes('Bob Membre')), r.body.actions)
check('un tour d’outil = 2 appels au modèle, une seule carte (l’outil n’a tourné qu’une fois)', seen.length === 2 && r.body.actions.length === 1
  && seen[1].body.messages.length === 3, { calls: seen.length, actions: r.body.actions?.length })
check('proposition : le modèle sait que rien n’est fait', r.body.reply.includes('waiting_for_user_confirmation'), r.body.reply)
check('proposition : AUCUNE tâche créée sans confirmation', await count('select count(*)::int as n from tasks where project_id = $1', [projectId]) === tasksBefore)

r = await bob.post('/api/assistant/confirm', { token: card.token })
check('jeton d’Ann présenté par Bob → 403', r.status === 403 && r.body.error === 'token_other_user', r)
r = await eve.post('/api/assistant/confirm', { token: card.token })
check('jeton présenté depuis une autre entreprise → 403', r.status === 403, r)
const [data, sig] = card.token.split('.')
const forged = JSON.parse(Buffer.from(data, 'base64url').toString())
forged.op.body.title = 'Titre changé en route'
r = await ann.post('/api/assistant/confirm', { token: `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}` })
check('jeton modifié (signature fausse) → 403', r.status === 403 && r.body.error === 'token_invalid', r)
check('toujours aucune tâche créée après ces refus', await count('select count(*)::int as n from tasks where project_id = $1', [projectId]) === tasksBefore)

r = await ann.post('/api/assistant/confirm', { token: card.token })
check('Ann confirme → exécutée, lien vers la tâche', r.status === 200 && r.body.ok && r.body.path?.startsWith(`/projets/${projectId}?tache=`), r)
const created = (await pool.query('select t.id, t.title, t.due_date, t.created_by from tasks t where t.project_id = $1 and t.title = $2', [projectId, 'Relancer le client'])).rows
check('en base : une seule tâche, créée par Ann, échéance et assignation justes', created.length === 1 && created[0].created_by === annId && created[0].due_date === today
  && (await count('select count(*)::int as n from task_assignees where task_id = $1 and user_id = $2', [created[0].id, bobId])) === 1, created)
r = await ann.post('/api/assistant/confirm', { token: card.token })
check('jeton rejoué → 403, rien de plus', r.status === 403 && r.body.error === 'token_used'
  && await count('select count(*)::int as n from tasks where project_id = $1', [projectId]) === tasksBefore + 1, r)

const expired = signConfirm({ u: annId, a: accountId, op: { method: 'POST', path: '/api/tasks', body: { project_id: projectId, title: 'Trop tard' } },
  summary: { title: 'x', lines: [] } }, Date.now() - 11 * 60_000)
r = await ann.post('/api/assistant/confirm', { token: expired })
check('jeton de plus de 10 minutes → 403 token_expired', r.status === 403 && r.body.error === 'token_expired', r)
const del = signConfirm({ u: annId, a: accountId, op: { method: 'POST', path: `/api/projects/${projectId}/duplicate`, body: { name: 'x' } }, summary: { title: 'x', lines: [] } })
r = await ann.post('/api/assistant/confirm', { token: del })
check('opération hors liste (même signée) → 403 operation_not_allowed', r.status === 403 && r.body.error === 'operation_not_allowed', r)
const delTask = signConfirm({ u: annId, a: accountId, op: { method: 'PATCH', path: `/api/tasks/${created[0].id}/../../projects/${projectId}`, body: {} }, summary: { title: 'x', lines: [] } })
r = await ann.post('/api/assistant/confirm', { token: delTask })
check('chemin détourné (..) → 403', r.status === 403, r)

// Une proposition annulée : rien en base (l'écran n'appelle simplement pas /confirm).
r = await ask(ann, `FAKE:propose_create_task:{"project_id":"${projectId}","title":"Tâche annulée"}`)
check('proposition annulée : rien en base', r.body.actions?.[0]?.type === 'confirm'
  && await count('select count(*)::int as n from tasks where title = $1', ['Tâche annulée']) === 0)

// Droits revérifiés à la confirmation : Bob (membre, pas intervenant) ne voit pas le projet réservé.
const bobReserved = signConfirm({ u: bobId, a: accountId, op: { method: 'POST', path: '/api/tasks', body: { project_id: reservedId, title: 'Intrusion' } }, summary: { title: 'x', lines: [] } })
r = await bob.post('/api/assistant/confirm', { token: bobReserved })
check('confirmation : les droits de la route s’appliquent (projet réservé → 404, rien créé)', r.status === 404 && r.body.ok === false
  && await count('select count(*)::int as n from tasks where title = $1', ['Intrusion']) === 0, r)
r = await ask(bob, `FAKE:propose_create_task:{"project_id":"${reservedId}","title":"Intrusion"}`)
check('proposition sur un projet invisible : refusée dès la proposition', !r.body.actions?.length && r.body.reply.includes('project_not_found'), r.body)

// Temps : pour soi seulement.
r = await ask(bob, `FAKE:propose_log_time:{"project_id":"${projectId}","entry_date":"${today}","minutes":90,"note":"Visite"}`)
const tcard = r.body.actions?.[0]
check('saisie de temps proposée (1 h 30)', tcard?.summary?.lines?.some((l: string) => l.includes('1 h 30')), r.body)
r = await bob.post('/api/assistant/confirm', { token: tcard.token })
check('saisie de temps confirmée : au nom de Bob', r.status === 200
  && await count('select count(*)::int as n from time_entries where user_id = $1 and minutes = 90 and project_id = $2', [bobId, projectId]) === 1, r)

// ------------------------------------------------------------------ 6. rien de la conversation en base
const secret = `phrase-temoin-${stamp}`
await ask(ann, `Bonjour ${secret}`)
const leak = await pool.query(`select table_name, column_name from information_schema.columns
  where table_schema = 'public' and table_name like 'assistant%' and data_type in ('text','jsonb','json','character varying')`)
let found = 0
for (const c of leak.rows) found += await count(`select count(*)::int as n from ${c.table_name} where ${c.column_name}::text like $1`, [`%${secret}%`])
check('aucun texte de conversation dans les tables de l’assistant', found === 0)
const logged = (await pool.query(`select kind, ok, input_tokens, tools from assistant_usage where account_id = $1 order by created_at`, [accountId])).rows
check('journal : jetons et outils notés', logged.some((l) => l.kind === 'message' && l.input_tokens > 0 && l.tools.includes('propose_create_task'))
  && logged.some((l) => l.kind === 'confirm' && l.ok), logged.slice(0, 3))

// ------------------------------------------------------------------ 7. refus et panne du modèle
mode = 'refusal'
r = await ask(ann, 'Une demande refusée')
check('refus du modèle → message poli, sans action', r.status === 200 && r.body.reply === 'Je ne peux pas traiter cette demande.' && !r.body.actions.length, r.body)
mode = 'fail'
r = await ask(ann, 'Panne')
check('panne du service → 502 assistant_unavailable (sans détail)', r.status === 502 && r.body.error === 'assistant_unavailable', r)
mode = 'normal'

// ------------------------------------------------------------------ 8. quotas
r = await ann.post('/api/assistant', { messages: [{ role: 'assistant', content: 'x' }] })
check('dernier message qui n’est pas de la personne → 400', r.status === 400, r)
process.env.ASSISTANT_USER_PER_HOUR = '3'
const carl = new Client()
await carl.post('/api/auth/signup', { name: 'Carl Quota', email: `carl-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Quota ${stamp}` })
const codes: number[] = []
for (let i = 0; i < 4; i++) codes.push((await ask(carl, 'Bonjour')).status)
r = await ask(carl, 'Bonjour')
check('quota par personne : 3 passent, la 4e → 429 (scope user)', JSON.stringify(codes) === '[200,200,200,429]' && r.status === 429 && r.body.scope === 'user', { codes, r })
delete process.env.ASSISTANT_USER_PER_HOUR
const carlAccount = (await carl.get('/api/me')).body.account.id
await pool.query(`insert into assistant_usage (account_id, user_id, kind, created_at) select $1, null, 'message', now() - interval '2 hours' from generate_series(1, 397)`, [carlAccount])
r = await ask(carl, 'Bonjour')
check('quota par entreprise : 400 sur 24 h → 429 (scope account)', r.status === 429 && r.body.scope === 'account', r)
check('défauts du cahier : 40 / heure et 400 / jour', (await import('../server/lib/assistant/quota.js')).USER_PER_HOUR() === 40
  && (await import('../server/lib/assistant/quota.js')).ACCOUNT_PER_DAY() === 400)

// ------------------------------------------------------------------ 9. RLS des tables de l'assistant
const rls = (await pool.query(`select relname, relrowsecurity from pg_class where relname in ('assistant_usage','assistant_confirmations')`)).rows
check('RLS active sur assistant_usage et assistant_confirmations', rls.length === 2 && rls.every((x) => x.relrowsecurity), rls)

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
fake.close()
await pool.end()
console.log(ko ? 'ASSISTANT_CHECK_FAILED' : 'ASSISTANT_CHECK_OK')
process.exit(ko ? 1 : 0)
