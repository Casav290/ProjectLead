/**
 * Contrôles « tout ce que l'assistant propose s'applique » (cahier du 27.10.2026, A1 à A8), sur une vraie base PostgreSQL
 * (TEST_DATABASE_URL), avec le FAUX service de modèle de scripts/assistant-check.ts (« FAKE:<outil>:<entrée JSON> ») :
 * aucune clé réelle, aucun appel extérieur. Dernière ligne : ASSISTANT_ACTIONS_CHECK_OK.
 *
 * Pour chaque outil d'écriture nouveau et pour le lot : la proposition n'écrit rien (essai annulé, aucun email), la
 * confirmation écrit exactement la carte, le rejeu donne 403, une autre personne ou une autre entreprise 403, un échec au
 * milieu d'un lot n'écrit rien. Le plan de projet (scénario d'Ève) : dates attendues calculées à la main ci-dessous.
 */
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
process.env.APP_SECRET ||= 'assistant-actions-secret-0123456789-abcdef'
process.env.PUBLIC_URL ||= 'http://localhost:5174'
// Les quotas de l'assistant ont leurs propres contrôles (assistant-check.ts) : ici, des centaines de demandes.
process.env.ASSISTANT_USER_PER_HOUR = '5000'
process.env.ASSISTANT_ACCOUNT_PER_DAY = '50000'
// Le faux agenda extérieur (propose_sync_now) répond sur 127.0.0.1 : permis aux contrôles seulement, jamais en production
// (lib/netguard.ts, lib/extcal.ts ; même réglage que scripts/smoke.ts).
process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = '1'

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
delete process.env.LEAD_ID_CLIENT_SECRET
delete process.env.LEAD_ID_ISSUER
delete process.env.RESEND_API_KEY
delete process.env.SMTP_URL

// ------------------------------------------------------------------ faux service de modèle
const seen: { body: any }[] = []
// Une entrée d'outil trop longue pour un message de la personne (8 000 caractères) passe par un nom : « FAKE:outil:#nom ».
const fakeInputs = new Map<string, unknown>()
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))
const fake = createServer((req, res) => {
  let d = ''
  req.on('data', (x) => (d += x))
  req.on('end', () => {
    const body = JSON.parse(d || '{}')
    seen.push({ body })
    res.setHeader('content-type', 'application/json')
    const msgs = body.messages as any[]
    const last = msgs[msgs.length - 1]
    const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 }
    const msg = (content: any[], stop_reason: string) => res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant',
      model: body.model, content, stop_reason, stop_sequence: null, usage }))
    const results = Array.isArray(last.content) ? last.content.filter((b: any) => b.type === 'tool_result') : []
    if (results.length) {
      const txt = results.map((r: any) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))).join('\n')
      return msg([{ type: 'text', text: `RESULTAT ${txt}` }], 'end_turn')
    }
    const text = typeof last.content === 'string' ? last.content : last.content.map((b: any) => b.text ?? '').join(' ')
    const m = text.match(/FAKE:([a-z_]+):(\{.*\}|#\w+)/s)
    if (!m) return msg([{ type: 'text', text: 'Bonjour.' }], 'end_turn')
    const input = m[2].startsWith('#') ? fakeInputs.get(m[2].slice(1)) : JSON.parse(m[2])
    return msg([{ type: 'tool_use', id: `toolu_${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: m[1], input }], 'tool_use')
  })
})
const fakePort = await listen(fake)
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fakePort}`
process.env.ANTHROPIC_API_KEY = 'cle-factice-pour-le-faux-service'

// ------------------------------------------------------------------ faux agenda extérieur (adresse iCalendar)
// `icsEvents` rendez-vous à venir (dans la fenêtre lue : 7 jours avant, 120 après) ; `icsStatus` ≠ 200 : agenda en panne.
const ics = { events: 1, status: 200 }
const icsAt = (days: number, hour: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '') + `T${String(hour).padStart(2, '0')}0000Z`
const calendar = createServer((_req, res) => {
  res.statusCode = ics.status
  res.setHeader('content-type', 'text/calendar')
  const events = Array.from({ length: ics.events }, (_, i) => ['BEGIN:VEVENT', `UID:essai-${i}@agenda.test`, `SUMMARY:Rendez-vous extérieur ${i + 1}`,
    `DTSTART:${icsAt(i + 2, 9)}`, `DTEND:${icsAt(i + 2, 10)}`, 'END:VEVENT'].join('\r\n'))
  res.end(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//essai//FR', ...events, 'END:VCALENDAR'].join('\r\n'))
})
const calendarUrl = `http://127.0.0.1:${await listen(calendar)}/agenda.ics`

const { migrate } = await import('../server/migrate.js')
await migrate(() => {})
const { default: app } = await import('../server/index.js')
const { pool } = await import('../server/db.js')
const { signConfirm, opAllowed, MAX_OPS } = await import('../server/lib/assistant/token.js')
const { TOOL_NAMES, BATCHABLE } = await import('../server/lib/assistant/tools.js')
const sched = await import('../server/lib/assistant/schedule.js')

// pg : « Calling client.query() when the client is already executing a query is deprecated » (plusieurs requêtes lancées
// ensemble sur une même connexion). Écouté pendant TOUT le contrôle ; vérifié à la fin de la section 6 ter.
const pgParallel: string[] = []
process.on('warning', (w) => { if (/already executing a query/.test(w.message)) pgParallel.push(w.message) })

let ok = 0, ko = 0
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 900)) }
}
const section = (t: string) => console.log(`\n— ${t}`)
class Client {
  cookie = ''
  async req(method: string, path: string, body?: unknown, raw?: FormData) {
    const headers: Record<string, string> = this.cookie ? { cookie: this.cookie } : {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await app.request(`http://localhost${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
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
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b ?? {})
}
const q = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows
const n = async (sql: string, args: unknown[] = []) => Number((await pool.query(sql, args)).rows[0].n)
/** Une demande au faux modèle : un outil, une entrée. Rend la réponse et la carte éventuelle. */
async function ask(cl: Client, tool: string, input: unknown, locale = 'fr') {
  let arg = JSON.stringify(input)
  if (arg.length > 6000) { const k = `in${fakeInputs.size}`; fakeInputs.set(k, input); arg = `#${k}` }
  const r = await cl.post('/api/assistant', { messages: [{ role: 'user', content: `FAKE:${tool}:${arg}` }], page: '/projets', locale })
  const card = r.body?.actions?.find((a: any) => a.type === 'confirm') ?? null
  return { r, card, reply: String(r.body?.reply ?? '') }
}
/** Empreinte des tables métier d'une entreprise (pour « rien n'est écrit »). */
const TABLES = ['projects', 'stages', 'tasks', 'task_dependencies', 'checklist_items', 'comments', 'board_columns', 'time_entries', 'clients',
  'client_contacts', 'events', 'project_updates', 'booking_types', 'intake_forms', 'automations', 'activities', 'notifications', 'client_reports']
async function footprint(accountId: string) {
  const out: Record<string, number> = {}
  for (const t of TABLES) out[t] = await n(`select count(*)::int as n from ${t} where account_id = $1`, [accountId])
  out.sent_emails = await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])
  out.confirmations = await n('select count(*)::int as n from assistant_confirmations where account_id = $1', [accountId])
  out.updated = await n(`select count(*)::int as n from projects where account_id = $1 and updated_at > now() - interval '2 seconds'`, [accountId])
  return out
}
const same = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).every((k) => k === 'updated' || a[k] === b[k])
const diff = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => [k, `${a[k]}→${b[k]}`]))

const stamp = Date.now().toString(36)

// ------------------------------------------------------------------ entreprises et personnes
section('mise en place')
const ann = new Client(), bob = new Client(), mia = new Client(), eve = new Client()
let r = await ann.post('/api/auth/signup', { name: 'Ann Planif', email: `ann-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Plan ${stamp}` })
check('inscription Ann (administratrice)', r.status === 201, r)
const me = (await ann.get('/api/me')).body
const accountId = me.account.id, annId = me.user.id
for (const [cl, who, role] of [[bob, 'bob', 'member'], [mia, 'mia', 'manager']] as const) {
  r = await ann.post('/api/team/invite', { email: `${who}-${stamp}@exemple.test`, role })
  await cl.post(`/api/auth/invitation/${r.body.link.split('/').pop()}/accept`, { name: who === 'bob' ? 'Bob Membre' : 'Mia Responsable', password: 'motdepasse-solide' })
}
const bobId = (await bob.get('/api/me')).body.user.id
const miaId = (await mia.get('/api/me')).body.user.id
await eve.post('/api/auth/signup', { name: 'Ève Ailleurs', email: `eve-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Ailleurs ${stamp}` })
const eveAccount = (await eve.get('/api/me')).body.account.id
check('Bob (membre), Mia (responsable), Ève (autre entreprise)', Boolean(bobId && miaId && eveAccount && eveAccount !== accountId))
const site = (await ann.post('/api/projects', { name: 'Site Internet TEST', status: 'active' })).body.id
const other = (await ann.post('/api/projects', { name: 'Autre projet', status: 'active' })).body.id
const eveProject = (await eve.post('/api/projects', { name: 'Projet d’Ève', status: 'active' })).body.id
check('projet vide « Site Internet TEST » (sans étape, sans tâche, sans dates)', (await n('select count(*)::int as n from stages where project_id = $1', [site])) === 0
  && (await n('select count(*)::int as n from tasks where project_id = $1', [site])) === 0
  && (await q('select start_date, due_date from projects where id = $1', [site]))[0].start_date === null)

// ------------------------------------------------------------------ 1. les jours ouvrés (attendus calculés à la main)
section('calcul des dates (jours ouvrés)')
check('jour ouvré : samedi 31.10.2026 → lundi 02.11', sched.workdayFrom('2026-10-31') === '2026-11-02')
check('5 jours ouvrés après le vendredi 06.11 → vendredi 13.11', sched.addWorkdays('2026-11-06', 5) === '2026-11-13')
check('jours ouvrés du lundi 02.11 au dimanche 15.11 : 10', sched.workdaysBetween('2026-11-02', '2026-11-15') === 10)
check('dépendance vers une étape suivante refusée', (sched.schedulePlan('2026-11-02', [{ key: 'a' }, { key: 'b' }],
  [{ key: 'x', stage: 'a', duration_days: 1, after: ['y'] }, { key: 'y', stage: 'b', duration_days: 1 }]) as any).error === 'dependency_on_later_stage')
check('dépendances en boucle refusées', (sched.schedulePlan('2026-11-02', [{ key: 'a' }],
  [{ key: 'x', stage: 'a', duration_days: 1, after: ['y'] }, { key: 'y', stage: 'a', duration_days: 1, after: ['x'] }]) as any).error === 'dependency_cycle')
check('tâche sans étape alors que le plan a des étapes : refusée', (sched.schedulePlan('2026-11-02', [{ key: 'a' }], [{ key: 'x', duration_days: 1 }]) as any).error === 'task_stage_required')

// ------------------------------------------------------------------ 2. le scénario d'Ève : planifier un nouveau site Internet
section('plan de projet : « Planifie toutes les étapes de ce projet pour un nouveau site Internet »')
const PLAN = {
  project_id: site, start_date: '2026-11-02',
  stages: [
    { key: 's1', name: 'Lancement et cahier des charges' }, { key: 's2', name: 'Arborescence et maquettes' },
    { key: 's3', name: 'Validation client' }, { key: 's4', name: 'Développement et intégration' },
    { key: 's5', name: 'Contenus' }, { key: 's6', name: 'Recette et mise en ligne' },
  ],
  tasks: [
    { key: 't1', stage: 's1', title: 'Réunion de lancement', duration_days: 1, estimate_minutes: 120 },
    { key: 't2', stage: 's1', title: 'Cahier des charges', duration_days: 3, estimate_minutes: 720, after: ['t1'], checklist: ['Objectifs', 'Pages', 'Fonctions'] },
    { key: 't3', stage: 's2', title: 'Arborescence', duration_days: 2, estimate_minutes: 480, after: ['t2'] },
    { key: 't4', stage: 's2', title: 'Maquettes', duration_days: 8, estimate_minutes: 2400, after: ['t3'], assignee_ids: [bobId] },
    { key: 't5', stage: 's3', title: 'Validation des maquettes par le client', duration_days: 0, after: ['t4'] },
    { key: 't6', stage: 's4', title: 'Intégration des maquettes', duration_days: 10, estimate_minutes: 3600, after: ['t5'] },
    { key: 't7', stage: 's4', title: 'Fonctions et formulaires', duration_days: 5, estimate_minutes: 1800, after: ['t6'] },
    { key: 't8', stage: 's5', title: 'Rédaction et import des contenus', duration_days: 4, estimate_minutes: 960 },
    { key: 't9', stage: 's6', title: 'Tests et corrections', duration_days: 3, estimate_minutes: 720, after: ['t7', 't8'] },
    { key: 't10', stage: 's6', title: 'Mise en ligne', duration_days: 0, milestone: true, after: ['t9'] },
  ],
}
// Attendus, comptés à la main sur le calendrier (lundi 02.11.2026 ; samedis et dimanches sautés).
const EXPECT_STAGES: [string, string, string][] = [
  ['Lancement et cahier des charges', '2026-11-02', '2026-11-05'], ['Arborescence et maquettes', '2026-11-06', '2026-11-19'],
  ['Validation client', '2026-11-20', '2026-11-20'], ['Développement et intégration', '2026-11-23', '2026-12-11'],
  ['Contenus', '2026-12-14', '2026-12-17'], ['Recette et mise en ligne', '2026-12-18', '2026-12-22'],
]
const EXPECT_TASKS: [string, string, string, string, number | null, boolean][] = [
  ['Réunion de lancement', 'Lancement et cahier des charges', '2026-11-02', '2026-11-02', 120, false],
  ['Cahier des charges', 'Lancement et cahier des charges', '2026-11-03', '2026-11-05', 720, false],
  ['Arborescence', 'Arborescence et maquettes', '2026-11-06', '2026-11-09', 480, false],
  ['Maquettes', 'Arborescence et maquettes', '2026-11-10', '2026-11-19', 2400, false],
  ['Validation des maquettes par le client', 'Validation client', '2026-11-20', '2026-11-20', null, true],
  ['Intégration des maquettes', 'Développement et intégration', '2026-11-23', '2026-12-04', 3600, false],
  ['Fonctions et formulaires', 'Développement et intégration', '2026-12-07', '2026-12-11', 1800, false],
  ['Rédaction et import des contenus', 'Contenus', '2026-12-14', '2026-12-17', 960, false],
  ['Tests et corrections', 'Recette et mise en ligne', '2026-12-18', '2026-12-22', 720, false],
  ['Mise en ligne', 'Recette et mise en ligne', '2026-12-22', '2026-12-22', null, true],
]
const EXPECT_DEPS = ['Cahier des charges←Réunion de lancement', 'Arborescence←Cahier des charges', 'Maquettes←Arborescence',
  'Validation des maquettes par le client←Maquettes', 'Intégration des maquettes←Validation des maquettes par le client',
  'Fonctions et formulaires←Intégration des maquettes', 'Tests et corrections←Fonctions et formulaires',
  'Tests et corrections←Rédaction et import des contenus', 'Mise en ligne←Tests et corrections'].sort()

let before = await footprint(accountId)
seen.length = 0
const plan = await ask(ann, 'propose_project_plan', PLAN)
check('proposition : UNE carte « À confirmer » dès la première réponse', plan.r.status === 200 && plan.card && plan.r.body.actions.filter((a: any) => a.type === 'confirm').length === 1, plan.r.body)
check('carte : titre, période en jours ouvrés, comptes', plan.card?.summary.title === 'Planifier « Site Internet TEST »'
  && plan.card.summary.lines.some((l: string) => l.includes('jours ouvrés') && l.includes('2 nov.') && l.includes('22 déc.'))
  && plan.card.summary.lines.some((l: string) => l.startsWith('6 étapes, 10 tâches dont 2 jalons, 9 dépendances')), plan.card?.summary.lines)
check('carte : un groupe par étape, ses tâches datées, jalons marqués ◆, dépendances dites', plan.card?.summary.groups?.length === 6
  && plan.card.summary.groups[2].title.startsWith('3. Validation client')
  && plan.card.summary.groups[2].lines[0].startsWith('◆ Validation des maquettes par le client')
  && plan.card.summary.groups[1].lines.some((l: string) => l.includes('Maquettes') && l.includes('40 h') && l.includes('après « Arborescence »') && l.includes('Bob Membre')),
  plan.card?.summary.groups)
check('le modèle reçoit les dates calculées (début, fin, jalons) pour les dire juste', /"start":"2026-11-02"/.test(plan.reply) && /"end":"2026-12-22"/.test(plan.reply)
  && plan.reply.includes('waiting_for_user_confirmation'), plan.reply.slice(0, 400))
let after = await footprint(accountId)
check('proposition : RIEN d’écrit (essai annulé), aucun email, jeton non consommé', same(before, after), diff(before, after))

r = await bob.post('/api/assistant/confirm', { token: plan.card.token })
check('jeton d’Ann présenté par Bob → 403', r.status === 403 && r.body.error === 'token_other_user', r)
r = await eve.post('/api/assistant/confirm', { token: plan.card.token })
check('jeton présenté depuis une autre entreprise → 403', r.status === 403, r)
const [pdata, psig] = plan.card.token.split('.')
const pforged = JSON.parse(Buffer.from(pdata, 'base64url').toString())
pforged.ops.push({ method: 'POST', path: `/api/projects/${site}/members`, body: { user_id: bobId, role: 'lead' } })
r = await ann.post('/api/assistant/confirm', { token: `${Buffer.from(JSON.stringify(pforged)).toString('base64url')}.${psig}` })
check('jeton modifié en route (écriture ajoutée) → 403', r.status === 403 && r.body.error === 'token_invalid', r)
after = await footprint(accountId)
check('toujours rien d’écrit après ces refus', same(before, after), diff(before, after))

r = await ann.post('/api/assistant/confirm', { token: plan.card.token })
check('Ann confirme → 200, une ligne dit ce qui a été créé', r.status === 200 && r.body.ok
  && r.body.message === 'Planifier « Site Internet TEST » : fait. Créé : 6 étapes, 10 tâches (dont 2 jalons), 9 dépendances, 3 points de contrôle ; dates du projet posées.', r.body)
check('après « Confirmer » : la page Gantt du projet s’ouvre, liens Étapes · Liste · Gantt', r.body.path === `/projets/${site}/gantt`
  && JSON.stringify(r.body.links.map((l: any) => l.label)) === '["stages","list","gantt"]' && r.body.links[1].path === `/projets/${site}/liste`, r.body)
const stages = await q('select name, start_date, due_date, position from stages where project_id = $1 order by position', [site])
check('en base : les 6 étapes, dans l’ordre, avec les dates attendues', JSON.stringify(stages.map((s) => [s.name, s.start_date, s.due_date]))
  === JSON.stringify(EXPECT_STAGES), stages)
const tasks = await q(`select t.title, s.name as stage, t.start_date, t.due_date, t.estimate_minutes, t.is_milestone, t.created_by, t.position
  from tasks t left join stages s on s.id = t.stage_id where t.project_id = $1 order by t.position`, [site])
check('en base : les 10 tâches, étape, début, échéance, estimation, jalon exacts', JSON.stringify(tasks.map((t) => [t.title, t.stage, t.start_date, t.due_date,
  t.estimate_minutes, t.is_milestone])) === JSON.stringify(EXPECT_TASKS), tasks)
check('en base : créées par Ann (la personne qui confirme)', tasks.every((t) => t.created_by === annId))
const deps = (await q(`select k.title || '←' || p.title as d from task_dependencies d join tasks k on k.id = d.task_id join tasks p on p.id = d.depends_on_id
  where k.project_id = $1`, [site])).map((x) => x.d).sort()
check('en base : les 9 dépendances exactes', JSON.stringify(deps) === JSON.stringify(EXPECT_DEPS), deps)
const items = (await q(`select ci.label from checklist_items ci join tasks t on t.id = ci.task_id where t.project_id = $1 order by ci.position`, [site])).map((x) => x.label)
check('en base : les points de contrôle de « Cahier des charges »', JSON.stringify(items) === '["Objectifs","Pages","Fonctions"]', items)
check('en base : Bob assigné aux maquettes (et devenu intervenant)', (await n(`select count(*)::int as n from task_assignees ta join tasks t on t.id = ta.task_id
  where t.project_id = $1 and t.title = 'Maquettes' and ta.user_id = $2`, [site, bobId])) === 1
  && (await n('select count(*)::int as n from project_members where project_id = $1 and user_id = $2', [site, bobId])) === 1)
const pd = (await q('select start_date, due_date from projects where id = $1', [site]))[0]
check('en base : dates du projet posées (elles manquaient) : 02.11 → 22.12', pd.start_date === '2026-11-02' && pd.due_date === '2026-12-22', pd)
// Ce que lisent les écrans : Étapes (fiche du projet), Liste et Gantt (tâches du projet).
const screen = (await ann.get(`/api/projects/${site}`)).body
const list = (await ann.get(`/api/tasks?project=${site}`)).body
check('écran Étapes : 6 étapes datées avec leurs tâches comptées', screen.stages.length === 6 && screen.stages[3].tasks_total === 2
  && screen.stages[3].start_date === '2026-11-23', screen.stages.map((s: any) => [s.name, s.tasks_total]))
check('écrans Liste et Gantt : 10 tâches avec dates, jalons et dépendances', list.length === 10 && list.filter((t: any) => t.is_milestone).length === 2
  && list.find((t: any) => t.title === 'Tests et corrections').depends_on.length === 2, list.length)
before = await footprint(accountId)
r = await ann.post('/api/assistant/confirm', { token: plan.card.token })
after = await footprint(accountId)
check('rejeu du même jeton → 403 token_used, rien de plus', r.status === 403 && r.body.error === 'token_used' && same(before, after), { r, d: diff(before, after) })

// Un nouveau projet créé ET planifié dans la même carte.
before = await footprint(accountId)
const np = await ask(ann, 'propose_project_plan', { new_project: { name: `Nouveau site ${stamp}` }, start_date: '2026-11-02',
  stages: [{ key: 'a', name: 'Cadrage' }, { key: 'b', name: 'Réalisation', duration_days: 10 }],
  tasks: [{ key: 'x', stage: 'a', title: 'Brief', duration_days: 2 }, { key: 'y', stage: 'a', title: 'Validation du brief', duration_days: 0, after: ['x'] }] })
after = await footprint(accountId)
check('nouveau projet + plan : une carte, rien d’écrit', np.card?.summary.title === `Créer et planifier « Nouveau site ${stamp} »` && same(before, after), { c: np.card?.summary, d: diff(before, after) })
r = await ann.post('/api/assistant/confirm', { token: np.card.token })
const npId = r.body.path?.split('/')[2]
const npRow = (await q('select name, status, start_date, due_date from projects where id = $1', [npId]))[0]
check('nouveau projet + plan confirmé : projet planifié 02.11 → 17.11, étape vide de 10 jours', r.status === 200 && npRow?.name === `Nouveau site ${stamp}`
  && npRow.status === 'planned' && npRow.start_date === '2026-11-02' && npRow.due_date === '2026-11-17'
  && JSON.stringify((await q('select name, start_date, due_date from stages where project_id = $1 order by position', [npId])).map((x) => [x.name, x.start_date, x.due_date]))
    === '[["Cadrage","2026-11-02","2026-11-03"],["Réalisation","2026-11-04","2026-11-17"]]', { r: r.body, npRow })

// Les cinq langues : la même carte dans la langue de l'interface (ici l'allemand), le résultat aussi.
const siteDe = (await ann.post('/api/projects', { name: 'Website TEST', status: 'active' })).body.id
const de = await ask(ann, 'propose_project_plan', { ...PLAN, project_id: siteDe }, 'de')
check('langue de l’interface (de) : carte en allemand', de.card?.summary.title === '«Website TEST» planen'
  && de.card.summary.lines.some((l: string) => l.includes('Arbeitstage (Montag bis Freitag)'))
  && de.card.summary.lines.some((l: string) => l.startsWith('6 Etappen, 10 Aufgaben, davon 2 Meilensteine, 9 Abhängigkeiten'))
  && de.card.summary.groups[2].lines[0].includes('(Meilenstein)') && de.card.summary.groups[1].lines.some((l: string) => l.includes('nach «Arborescence»')),
  { t: de.card?.summary.title, l: de.card?.summary.lines, g: de.card?.summary.groups?.[1] })
r = await ann.post('/api/assistant/confirm', { token: de.card.token, locale: 'de' })
check('langue de l’interface (de) : la ligne « fait » en allemand', r.status === 200
  && r.body.message === '«Website TEST» planen: erledigt. Erstellt: 6 Etappen, 10 Aufgaben (davon 2 Meilensteine), 9 Abhängigkeiten, 3 Checklistenpunkte; Projektdaten gesetzt.', r.body)
const en = await ask(ann, 'propose_create_task', { project_id: siteDe, title: 'Call the client', due_date: '2026-11-03' }, 'en')
check('langue de l’interface (en) : carte en anglais', en.card?.summary.title === 'Create a task' && en.card.summary.lines[0] === 'Task: “Call the client”'
  && en.card.summary.lines.some((l: string) => l.startsWith('Due: Tue 3 Nov')), en.card?.summary)

// Le plan d'un projet d'une autre entreprise ou d'un projet invisible : pas de carte.
const outside = await ask(ann, 'propose_project_plan', { ...PLAN, project_id: eveProject })
check('plan sur le projet d’une autre entreprise : refusé dès la proposition', !outside.card && outside.reply.includes('project_not_found'), outside.reply.slice(0, 200))
const bad = await ask(ann, 'propose_project_plan', { project_id: other, stages: [{ key: 'a', name: 'A' }], tasks: [{ key: 'x', stage: 'a', title: 'X', duration_days: 1, after: ['zz'] }] })
check('plan incohérent (dépendance inconnue) : pas de carte, erreur dite au modèle', !bad.card && bad.reply.includes('unknown_dependency'), bad.reply.slice(0, 200))

// Les droits de l'écran : Bob (membre, pas intervenant) ne crée pas d'étape dans « Autre projet ».
before = await footprint(accountId)
const bobPlan = await ask(bob, 'propose_project_plan', { project_id: other, stages: [{ key: 'a', name: 'Étape de Bob' }], tasks: [] })
after = await footprint(accountId)
check('droits revérifiés à l’essai : Bob, non intervenant, n’obtient pas de carte d’étapes (403 de la route)', !bobPlan.card && bobPlan.reply.includes('would_fail')
  && bobPlan.reply.includes('"status":403') && same(before, after), bobPlan.reply.slice(0, 300))

// ------------------------------------------------------------------ 3. échec au milieu d'un lot : rien d'écrit
section('tout ou rien')
const sign = (u: string, ops: any[], mode: 'tx' | 'route' = 'tx') => signConfirm({ u, a: accountId, mode, tool: 'test', ops, summary: { title: 'Test', lines: [] } })
before = await footprint(accountId)
const failing = sign(annId, [
  { method: 'POST', path: `/api/projects/${other}/stages`, body: { name: 'Étape témoin' }, ref: 's' },
  { method: 'POST', path: '/api/tasks', body: { project_id: other, stage_id: '@s', title: 'Tâche témoin A' }, ref: 'a' },
  { method: 'POST', path: '/api/tasks', body: { project_id: site, title: 'Tâche témoin B' }, ref: 'b' },
  { method: 'POST', path: '/api/tasks/@a/dependencies', body: { depends_on_id: '@b' } },   // deux projets : la route refuse
  { method: 'POST', path: '/api/tasks', body: { project_id: other, title: 'Jamais créée' } },
])
r = await ann.post('/api/assistant/confirm', { token: failing })
after = await footprint(accountId)
check('lot dont la 4e écriture est refusée → 400, message clair, NI étape NI tâche écrites', r.status === 400 && r.body.ok === false
  && r.body.error === 'dependency_other_project' && r.body.message.includes('écriture 4 sur 5') && same(before, after), { r: r.body, d: diff(before, after) })
check('aucune trace des écritures 1 à 3', (await n(`select count(*)::int as n from tasks where title like 'Tâche témoin%'`)) === 0
  && (await n(`select count(*)::int as n from stages where name = 'Étape témoin'`)) === 0)
// Une référence vers une écriture qui n'existe pas.
r = await ann.post('/api/assistant/confirm', { token: sign(annId, [{ method: 'POST', path: '/api/tasks', body: { project_id: other, title: 'Orpheline', stage_id: '@absente' } }]) })
check('référence inconnue → refus, rien d’écrit', r.status === 400 && r.body.error === 'unknown_reference'
  && (await n(`select count(*)::int as n from tasks where title = 'Orpheline'`)) === 0, r.body)
// Deux clics simultanés : un seul passe.
const twice = sign(annId, [{ method: 'POST', path: '/api/tasks', body: { project_id: other, title: `Double clic ${stamp}` } }])
const both = await Promise.all([ann.post('/api/assistant/confirm', { token: twice }), ann.post('/api/assistant/confirm', { token: twice })])
check('deux « Confirmer » simultanés : un 200, un 403, une seule tâche', both.map((x) => x.status).sort().join(',') === '200,403'
  && (await n('select count(*)::int as n from tasks where title = $1', [`Double clic ${stamp}`])) === 1, both.map((x) => x.body))
// Les droits changent entre la proposition et le clic : refus, rien d'écrit.
await ann.post(`/api/projects/${site}/members`, { user_id: bobId, role: 'member' })
const bobStage = await ask(bob, 'propose_create_stage', { project_id: site, name: 'Étape proposée par Bob' })
check('Bob, intervenant : carte « Créer une étape »', Boolean(bobStage.card), bobStage.reply.slice(0, 200))
await ann.post(`/api/projects/${site}/members`, { user_id: bobId, role: 'observer' })
before = await footprint(accountId)
r = await bob.post('/api/assistant/confirm', { token: bobStage.card.token })
after = await footprint(accountId)
check('Bob devenu observateur avant de cliquer : 403 de la route, rien d’écrit', r.status === 403 && r.body.error === 'forbidden' && same(before, after), { r: r.body, d: diff(before, after) })
await ann.post(`/api/projects/${site}/members`, { user_id: bobId, role: 'member' })

// ------------------------------------------------------------------ 4. le lot : plusieurs changements, une carte
section('propose_batch')
const t1 = (await q(`select id from tasks where project_id = $1 and title = 'Arborescence'`, [site]))[0].id
const t2 = (await q(`select id from tasks where project_id = $1 and title = 'Maquettes'`, [site]))[0].id
before = await footprint(accountId)
const batch = await ask(ann, 'propose_batch', { title: 'Relances de la semaine', operations: [
  { tool: 'propose_create_task', input: { project_id: other, title: 'Appeler le client', due_date: '2026-11-03' } },
  { tool: 'propose_create_task', input: { project_id: other, title: 'Envoyer le devis signé', due_date: '2026-11-04', assignee_ids: [miaId] } },
  { tool: 'propose_create_task', input: { project_id: other, title: 'Préparer la réunion', due_date: '2026-11-05' } },
  { tool: 'propose_update_task', input: { task_id: t1, priority: 'high' } },
  { tool: 'propose_log_time', input: { project_id: site, task_id: t2, entry_date: '2026-11-02', minutes: 90, note: 'Maquette accueil' } },
] })
after = await footprint(accountId)
check('lot : UNE carte groupée (3 tâches, 1 modification, 1 saisie), rien d’écrit', batch.card?.summary.title === '5 changements'
  && batch.card.summary.groups.map((g: any) => g.title).join('|') === 'Créer une tâche (3)|Modifier une tâche|Saisir du temps' && same(before, after),
  { s: batch.card?.summary, d: diff(before, after) })
// La carte du lot montre CHAQUE opération en entier (relecture du 29.10) : rien d'écrit qui ne soit lu avant « Confirmer ».
const bLines = (batch.card?.summary.groups ?? []).flatMap((g: any) => g.lines) as string[]
check('lot : le titre de la carte vient du serveur, jamais du modèle (« Relances de la semaine » ignoré)', batch.card?.summary.title === '5 changements'
  && !JSON.stringify(batch.card?.summary).includes('Relances de la semaine'), batch.card?.summary.title)
check('lot : chaque opération en entier (échéance, personne, priorité avant → après, note, intervenant nouveau)', bLines.length === 5
  && bLines.some((l) => l.includes('« Envoyer le devis signé »') && l.includes('Assignée à : Mia Responsable') && l.includes('Devient intervenant de « Autre projet » : Mia Responsable'))
  && bLines.some((l) => l.includes('« Arborescence »') && /Priorité : \S+ → haute/.test(l)) && bLines.some((l) => l.includes('Note : Maquette accueil') && l.includes('1 h 30')), bLines)
r = await bob.post('/api/assistant/confirm', { token: batch.card.token })
check('lot : autre personne → 403', r.status === 403, r)
r = await eve.post('/api/assistant/confirm', { token: batch.card.token })
check('lot : autre entreprise → 403', r.status === 403, r)
r = await ann.post('/api/assistant/confirm', { token: batch.card.token })
check('lot confirmé : « Créé : 3 tâches, 1 saisie de temps ; 1 modification enregistrée »', r.status === 200
  && r.body.message.endsWith('Créé : 3 tâches, 1 saisie de temps ; 1 modification enregistrée.'), r.body)
check('lot en base : 3 tâches exactes, priorité haute, 1 h 30 sur les maquettes', (await n(`select count(*)::int as n from tasks where project_id = $1
  and ((title = 'Appeler le client' and due_date = '2026-11-03') or (title = 'Envoyer le devis signé' and due_date = '2026-11-04') or (title = 'Préparer la réunion' and due_date = '2026-11-05'))`, [other])) === 3
  && (await q('select priority from tasks where id = $1', [t1]))[0].priority === 'high'
  && (await n(`select count(*)::int as n from time_entries where task_id = $1 and minutes = 90 and user_id = $2 and note = 'Maquette accueil'`, [t2, annId])) === 1)
r = await ann.post('/api/assistant/confirm', { token: batch.card.token })
check('lot : rejeu → 403', r.status === 403 && r.body.error === 'token_used', r)
let b2 = await ask(ann, 'propose_batch', { operations: [{ tool: 'propose_create_task', input: { project_id: other } }] })
check('lot : entrée invalide → erreur précise, pas de carte', !b2.card && b2.reply.includes('invalid_input') && b2.reply.includes('"operation":1'), b2.reply.slice(0, 200))
b2 = await ask(ann, 'propose_batch', { operations: [{ tool: 'propose_project_plan', input: {} }] })
check('lot : un outil non regroupable est refusé', !b2.card, b2.reply.slice(0, 200))
b2 = await ask(ann, 'propose_batch', { operations: [
  { tool: 'propose_create_task', input: { project_id: other, title: 'Bonne' } },
  { tool: 'propose_add_dependency', input: { task_id: t1, depends_on_id: (await q(`select id from tasks where project_id = $1 limit 1`, [other]))[0].id } }] })
check('lot dont une opération échouerait : refusé à l’essai, pas de carte', !b2.card && /dependency_other_project/.test(b2.reply), b2.reply.slice(0, 300))
// Le scénario de la relecture : un texte lu pousse le modèle à glisser « tarif à 0 » et « autre client » dans un lot.
// La carte montre chaque champ du projet « avant → après » : rien ne passe sous « Modifier un projet : 3 changements ».
const cliA = (await ann.post('/api/clients', { name: `Client A ${stamp}` })).body.id
const cliB = (await ann.post('/api/clients', { name: `Client B ${stamp}` })).body.id
const billed = (await ann.post('/api/projects', { name: `Projet facturé ${stamp}`, status: 'active', client_id: cliA, billing_mode: 'hourly', hourly_rate_cents: 12000 })).body.id
b2 = await ask(ann, 'propose_batch', { title: 'Petit décalage', operations: [
  { tool: 'propose_update_project', input: { project_id: billed, due_date: '2026-12-15', hourly_rate_cents: 0, client_id: cliB } },
  { tool: 'propose_create_task', input: { project_id: billed, title: 'Tâche ajoutée', description: `Début. ${'x'.repeat(4000)} FIN-DU-TEXTE` } }] })
const proj = (b2.card?.summary.groups ?? []).find((g: any) => g.title === 'Modifier un projet')?.lines[0] ?? ''
const added = (b2.card?.summary.groups ?? []).find((g: any) => g.title === 'Créer une tâche')?.lines[0] ?? ''
check('lot : « Modifier un projet » montre chaque champ avant → après (échéance, taux horaire CHF 120 → CHF 0, client A → B)', proj.includes(`Projet : Projet facturé ${stamp}`)
  && /Échéance : aucune → .*15 déc/.test(proj) && proj.includes('Taux horaire : CHF 120 → CHF 0') && proj.includes(`Client : Client A ${stamp} → Client B ${stamp}`)
  && b2.card.summary.title === '2 changements', { proj, title: b2.card?.summary.title })
check('lot : la description de 4 000 caractères est montrée en entier (jusqu’à « FIN-DU-TEXTE »)', added.includes('FIN-DU-TEXTE') && added.length > 4000, added.length)
const twelve = await ask(ann, 'propose_batch', { operations: Array.from({ length: 12 }, (_, i) => ({ tool: 'propose_create_task', input: { project_id: other, title: `Lot de douze ${i + 1} ${stamp}` } })) })
const g12 = twelve.card?.summary.groups?.[0]
check('lot de 12 tâches : les 12 lignes sur la carte, aucune cachée sous « + N autres »', g12?.lines.length === 12 && !g12.more && g12.lines[11].includes(`Lot de douze 12 ${stamp}`), g12)

// ------------------------------------------------------------------ 5. chaque outil d'écriture : proposer n'écrit rien, confirmer écrit juste
section('outils d’écriture, un par un')
/** Propose, vérifie « rien d'écrit », rejoue les refus (autre personne, autre entreprise), confirme, vérifie, rejoue. */
async function cycle(name: string, who: Client, tool: string, input: unknown, verify: () => Promise<boolean>, opts: { other?: Client } = {}) {
  const fp0 = await footprint(accountId)
  const a = await ask(who, tool, input)
  const fp1 = await footprint(accountId)
  if (!a.card) { check(`${name} : carte proposée`, false, a.reply.slice(0, 400)); return null }
  check(`${name} : proposition sans écriture`, same(fp0, fp1) && !(await verify()), diff(fp0, fp1))
  const intruder = opts.other ?? (who === ann ? bob : ann)
  const x = await intruder.post('/api/assistant/confirm', { token: a.card.token })
  const y = await eve.post('/api/assistant/confirm', { token: a.card.token })
  check(`${name} : autre personne 403, autre entreprise 403`, x.status === 403 && y.status === 403, [x, y])
  const c = await who.post('/api/assistant/confirm', { token: a.card.token })
  check(`${name} : confirmation exacte`, c.status === 200 && c.body.ok && await verify(), c.body)
  const z = await who.post('/api/assistant/confirm', { token: a.card.token })
  check(`${name} : rejeu 403`, z.status === 403 && z.body.error === 'token_used', z)
  return a.card
}
const one = async (sql: string, args: unknown[] = []) => (await q(sql, args))[0] ?? null

// Les outils déjà là le 24.10, réécrits le 27.10 (mêmes routes, cartes en cinq langues) : le même cycle complet.
const tFresh = (await ann.post('/api/tasks', { project_id: other, title: `À modifier ${stamp}` })).body.id
await cycle('propose_create_task', ann, 'propose_create_task', { project_id: other, title: `Créée seule ${stamp}`, due_date: '2026-11-06', priority: 'high', estimate_minutes: 90 },
  async () => { const t = await one('select due_date, priority, estimate_minutes, created_by from tasks where title = $1', [`Créée seule ${stamp}`])
    return t?.due_date === '2026-11-06' && t.priority === 'high' && t.estimate_minutes === 90 && t.created_by === annId })
await cycle('propose_update_task', ann, 'propose_update_task', { task_id: tFresh, title: `Modifiée ${stamp}`, start_date: '2026-11-02', due_date: '2026-11-04', assignee_ids: [miaId] },
  async () => { const t = await one('select title, start_date, due_date from tasks where id = $1', [tFresh])
    return t?.title === `Modifiée ${stamp}` && t.start_date === '2026-11-02' && t.due_date === '2026-11-04'
      && (await n('select count(*)::int as n from task_assignees where task_id = $1 and user_id = $2', [tFresh, miaId])) === 1 })
await cycle('propose_add_task_comment', ann, 'propose_add_task_comment', { task_id: tFresh, body: `Commentaire ${stamp}` },
  async () => (await n('select count(*)::int as n from comments where task_id = $1 and body = $2 and author_id = $3', [tFresh, `Commentaire ${stamp}`, annId])) === 1)
await cycle('propose_add_checklist_item', ann, 'propose_add_checklist_item', { task_id: tFresh, label: `Point ${stamp}` },
  async () => (await n('select count(*)::int as n from checklist_items where task_id = $1 and label = $2', [tFresh, `Point ${stamp}`])) === 1)
await cycle('propose_create_project', ann, 'propose_create_project', { name: `Projet seul ${stamp}`, status: 'planned', start_date: '2026-11-09', priority: 'high' },
  async () => { const p = await one('select status, start_date, priority, owner_id from projects where name = $1', [`Projet seul ${stamp}`])
    return p?.status === 'planned' && p.start_date === '2026-11-09' && p.priority === 'high' && p.owner_id === annId })
const reportsBefore = await n('select count(*)::int as n from client_reports where account_id = $1', [accountId])
await cycle('propose_project_update (point interne)', ann, 'propose_project_update', { project_id: other, health: 'at_risk', body: `Retard fournisseur ${stamp}` },
  async () => (await n(`select count(*)::int as n from project_updates where project_id = $1 and health = 'at_risk' and body = $2 and not share_with_client`,
    [other, `Retard fournisseur ${stamp}`])) === 1)
check('propose_project_update : jamais partagé avec le client (aucun suivi)', (await n('select count(*)::int as n from client_reports where account_id = $1', [accountId])) === reportsBefore)
await cycle('propose_create_client', ann, 'propose_create_client', { name: `Client créé ${stamp}`, email: `cree-${stamp}@exemple.test`, town: 'Bulle', postal_code: '1630' },
  async () => { const c = await one('select email, town, postal_code, country from clients where name = $1', [`Client créé ${stamp}`])
    return c?.town === 'Bulle' && c.postal_code === '1630' && c.country === 'CH' })
await cycle('propose_log_time (pour soi, membre)', bob, 'propose_log_time', { project_id: site, entry_date: '2026-11-05', minutes: 75, note: `Saisie ${stamp}` },
  async () => (await n('select count(*)::int as n from time_entries where user_id = $1 and project_id = $2 and minutes = 75 and note = $3', [bobId, site, `Saisie ${stamp}`])) === 1)

const tA = (await q(`select id from tasks where project_id = $1 and title = 'Appeler le client'`, [other]))[0].id
const tB = (await q(`select id from tasks where project_id = $1 and title = 'Préparer la réunion'`, [other]))[0].id
await cycle('propose_update_tasks (plusieurs tâches)', ann, 'propose_update_tasks', { task_ids: [tA, tB], priority: 'urgent', due_date: '2026-11-10' },
  async () => (await n(`select count(*)::int as n from tasks where id = any($1) and priority = 'urgent' and due_date = '2026-11-10'`, [[tA, tB]])) === 2)
await cycle('propose_add_dependency', ann, 'propose_add_dependency', { task_id: tB, depends_on_id: tA },
  async () => (await n('select count(*)::int as n from task_dependencies where task_id = $1 and depends_on_id = $2', [tB, tA])) === 1)
await cycle('propose_add_project_comment', ann, 'propose_add_project_comment', { project_id: other, body: `Point projet ${stamp}` },
  async () => (await n('select count(*)::int as n from comments where project_id = $1 and task_id is null and body = $2', [other, `Point projet ${stamp}`])) === 1)
const cm = (await ann.post(`/api/tasks/${tA}/comments`, { body: 'Premier jet' })).body.id
await cycle('propose_update_comment (le sien)', ann, 'propose_update_comment', { task_id: tA, comment_id: cm, body: 'Texte corrigé' },
  async () => (await one('select body, edited_at from comments where id = $1', [cm]))?.body === 'Texte corrigé')
const notMine = await ask(bob, 'propose_update_comment', { task_id: tA, comment_id: cm, body: 'Pas à moi' })
check('propose_update_comment : le commentaire d’un autre est refusé', !notMine.card && notMine.reply.includes('not_author'), notMine.reply.slice(0, 200))
const item = (await ann.post(`/api/tasks/${tA}/checklist`, { label: 'Numéro trouvé' })).body.id
await cycle('propose_update_checklist_item', ann, 'propose_update_checklist_item', { task_id: tA, item_id: item, done: true },
  async () => (await one('select done from checklist_items where id = $1', [item]))?.done === true)
await cycle('propose_update_project (facturation, couleur, code)', ann, 'propose_update_project',
  { project_id: other, billing_mode: 'fixed', fixed_cents: 750000, currency: 'CHF', code: `AP-${stamp}`.slice(0, 30), color: '#0f6e70' },
  async () => { const p = await one('select billing_mode, fixed_cents, code, color from projects where id = $1', [other]); return p?.billing_mode === 'fixed' && p.fixed_cents === 750000 && p.color === '#0f6e70' })
const visib = await ask(ann, 'propose_update_project', { project_id: other, visibility: 'members' })
check('propose_update_project : la visibilité (droits) n’est pas permise, pas de carte', !visib.card, visib.reply.slice(0, 200))
const tplName = `Modèle site ${stamp}`
await cycle('propose_duplicate_project (enregistrer comme modèle)', ann, 'propose_duplicate_project', { project_id: site, name: tplName, as_template: true },
  async () => { const t = await one('select id, is_template, client_id from projects where name = $1', [tplName])
    return Boolean(t?.is_template) && (await n('select count(*)::int as n from stages where project_id = $1', [t.id])) === 6
      && (await n('select count(*)::int as n from tasks where project_id = $1', [t.id])) === 10 })
await cycle('propose_create_stage', ann, 'propose_create_stage', { project_id: other, name: 'Bilan', start_date: '2026-12-01', due_date: '2026-12-02', visible_to_client: false },
  async () => (await n(`select count(*)::int as n from stages where project_id = $1 and name = 'Bilan' and start_date = '2026-12-01' and not visible_to_client`, [other])) === 1)
const bilan = (await q(`select id from stages where project_id = $1 and name = 'Bilan'`, [other]))[0]?.id
await cycle('propose_update_stage (statut sans prévenir le client)', ann, 'propose_update_stage', { project_id: other, stage_id: bilan, status: 'in_progress', due_date: '2026-12-04' },
  async () => { const st = await one('select status, due_date from stages where id = $1', [bilan]); return st?.status === 'in_progress' && st.due_date === '2026-12-04' })
const siteStages = (await q('select id from stages where project_id = $1 order by position', [site])).map((x) => x.id)
const reversed = [...siteStages].reverse()
await cycle('propose_reorder (étapes)', ann, 'propose_reorder', { project_id: site, kind: 'stages', ids: reversed },
  async () => JSON.stringify((await q('select id from stages where project_id = $1 order by position', [site])).map((x) => x.id)) === JSON.stringify(reversed))
await cycle('propose_board_column (créer)', ann, 'propose_board_column', { project_id: other, name: 'En recette', wip_limit: 4 },
  async () => (await n(`select count(*)::int as n from board_columns where project_id = $1 and name = 'En recette' and wip_limit = 4`, [other])) === 1)
const col = (await q(`select id from board_columns where project_id = $1 and name = 'En recette'`, [other]))[0]?.id
await cycle('propose_board_column (modifier)', ann, 'propose_board_column', { project_id: other, column_id: col, name: 'Recette client', wip_limit: null },
  async () => { const c = await one('select name, wip_limit from board_columns where id = $1', [col]); return c?.name === 'Recette client' && c.wip_limit === null })
const cols = (await q('select id from board_columns where project_id = $1 order by position', [other])).map((x) => x.id)
const rotated = [...cols.slice(1), cols[0]]
await cycle('propose_reorder (colonnes)', ann, 'propose_reorder', { project_id: other, kind: 'columns', ids: rotated },
  async () => JSON.stringify((await q('select id from board_columns where project_id = $1 order by position', [other])).map((x) => x.id)) === JSON.stringify(rotated))
const form = new FormData()
form.append('file', new File([Buffer.from('contenu de test')], 'cahier.txt', { type: 'text/plain' }))
const file = (await ann.req('POST', `/api/projects/${other}/files`, undefined, form)).body.id
await cycle('propose_set_file_visibility', ann, 'propose_set_file_visibility', { project_id: other, file_id: file, visible_to_client: true },
  async () => (await one('select visible_to_client from attachments where id = $1', [file]))?.visible_to_client === true)
const entry = (await ann.post('/api/time/entries', { project_id: other, entry_date: '2026-11-02', minutes: 30, note: 'Avant' })).body.id
await cycle('propose_update_time_entry', ann, 'propose_update_time_entry', { entry_id: entry, minutes: 45, note: 'Après' },
  async () => { const e = await one('select minutes, note from time_entries where id = $1', [entry]); return e?.minutes === 45 && e.note === 'Après' })
await cycle('propose_set_timesheet_day', ann, 'propose_set_timesheet_day', { project_id: other, entry_date: '2026-11-03', minutes: 240 },
  async () => (await n(`select coalesce(sum(minutes),0)::int as n from time_entries where project_id = $1 and user_id = $2 and entry_date = '2026-11-03' and task_id is null`, [other, annId])) === 240)
await cycle('propose_log_time pour un collègue (responsable)', mia, 'propose_log_time', { project_id: other, entry_date: '2026-11-04', minutes: 60, user_id: bobId },
  async () => (await n(`select count(*)::int as n from time_entries where project_id = $1 and user_id = $2 and entry_date = '2026-11-04' and minutes = 60`, [other, bobId])) === 1,
  { other: ann })
const bobForOther = await ask(bob, 'propose_log_time', { project_id: other, entry_date: '2026-11-04', minutes: 60, user_id: miaId })
check('propose_log_time pour un collègue : refusé à un membre', !bobForOther.card && bobForOther.reply.includes('forbidden'), bobForOther.reply.slice(0, 200))
const cli = (await ann.post('/api/clients', { name: `Client ${stamp}`, email: `client-${stamp}@exemple.test` })).body.id
await cycle('propose_update_client', ann, 'propose_update_client', { client_id: cli, town: 'Fribourg', postal_code: '1700', phone: '+41 26 000 00 00' },
  async () => { const c = await one('select town, postal_code from clients where id = $1', [cli]); return c?.town === 'Fribourg' && c.postal_code === '1700' })
// Les cartes en toutes lettres, dans la langue de l'interface : pays, langue, genre, avant → après (jamais « DE », « de »).
const cliFr = await ask(ann, 'propose_update_client', { client_id: cli, country: 'DE', language: 'de', kind: 'person' })
check('carte client (fr) : pays, langue et genre en toutes lettres, avant → après', JSON.stringify(cliFr.card?.summary.lines.slice(1))
  === JSON.stringify(['Genre : entreprise → personne', 'Pays : Suisse → Allemagne', 'Langue : français → allemand']), cliFr.card?.summary.lines)
const cliEn = await ask(ann, 'propose_create_client', { name: `Client EN ${stamp}`, country: 'AT', language: 'it' }, 'en')
check('carte client (en) : « Country: Austria », « Language: Italian »', Boolean(cliEn.card?.summary.lines.includes('Country: Austria'))
  && Boolean(cliEn.card?.summary.lines.includes('Language: Italian')), cliEn.card?.summary.lines)
const vatDe = await ask(ann, 'propose_update_project', { project_id: other, vat_code: 'reduced' }, 'de')
check('carte projet (de) : le taux de TVA en toutes lettres (« Reduzierter Satz »)', Boolean(vatDe.card?.summary.lines.some((l: string) => l.endsWith('Reduzierter Satz'))), vatDe.card?.summary.lines)
await cycle('propose_client_contact (ajouter)', ann, 'propose_client_contact', { client_id: cli, name: 'Paul Test', email: `paul-${stamp}@exemple.test`, receives_updates: false },
  async () => (await n(`select count(*)::int as n from client_contacts where client_id = $1 and name = 'Paul Test' and not receives_updates`, [cli])) === 1)
const contact = (await q(`select id from client_contacts where client_id = $1 and name = 'Paul Test'`, [cli]))[0]?.id
await cycle('propose_client_contact (modifier)', ann, 'propose_client_contact', { client_id: cli, contact_id: contact, job_title: 'Directeur' },
  async () => (await one('select job_title from client_contacts where id = $1', [contact]))?.job_title === 'Directeur')
const sentBefore = await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])
await cycle('propose_event (créer, avec un participant extérieur : AUCUNE invitation)', ann, 'propose_event', { title: `Atelier ${stamp}`, starts_at: '2026-11-05T09:00:00+01:00',
  ends_at: '2026-11-05T10:30:00+01:00', project_id: other, attendee_user_ids: [bobId], attendee_emails: [`invite-${stamp}@exemple.test`] },
  async () => (await n('select count(*)::int as n from events where title = $1', [`Atelier ${stamp}`])) === 1)
check('propose_event : aucun email parti (ni à l’essai, ni à la confirmation)', (await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])) === sentBefore)
const ev = (await q('select id from events where title = $1', [`Atelier ${stamp}`]))[0]?.id
await cycle('propose_event (modifier)', ann, 'propose_event', { event_id: ev, location: 'Salle 2' },
  async () => (await one('select location from events where id = $1', [ev]))?.location === 'Salle 2')
const inbound = (await ann.get('/api/me')).body.inboundUrl.split('/').pop()
await new Client().post(`/api/inbound/${inbound}`, { from: `demande-${stamp}@exemple.test`, to: ['x@y.z'], subject: `Demande ${stamp}`, text: 'Bonjour, un site svp', message_id: `<m-${stamp}@t>` })
const msg = (await q('select id from email_messages where subject = $1', [`Demande ${stamp}`]))[0]?.id
check('email reçu par l’adresse de capture (pour les outils emails)', Boolean(msg))
await cycle('propose_set_email_status (ignorer)', ann, 'propose_set_email_status', { message_id: msg, status: 'ignored' },
  async () => (await one('select status from email_messages where id = $1', [msg]))?.status === 'ignored')
await cycle('propose_mark_notifications_read', bob, 'propose_mark_notifications_read', {},
  async () => (await n('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [bobId])) === 0)
await cycle('propose_update_settings (profil + entreprise + facturation)', ann, 'propose_update_settings',
  { profile: { name: 'Ann Planifiée' }, company: { week_hours: 41 }, billing: { monthly_billing_day: 5, invoice_language: 'de' } },
  async () => (await one('select name from users where id = $1', [annId]))?.name === 'Ann Planifiée'
    && Number((await one('select week_hours from accounts where id = $1', [accountId]))?.week_hours) === 41
    && (await one('select monthly_billing_day, invoice_language from account_settings where account_id = $1', [accountId]))?.invoice_language === 'de')
const bobCompany = await ask(bob, 'propose_update_settings', { company: { name: 'Prise de pouvoir' } })
check('propose_update_settings : l’entreprise refusée à un membre (403 à l’essai)', !bobCompany.card && bobCompany.reply.includes('"status":403'), bobCompany.reply.slice(0, 200))
await cycle('propose_booking_page (créer)', ann, 'propose_booking_page', { slug: `rdv-${stamp}`, name: 'Premier contact', duration_minutes: 30, availability: { 1: [['09:00', '12:00']] } },
  async () => (await n('select count(*)::int as n from booking_types where slug = $1', [`rdv-${stamp}`])) === 1)
const bt = (await q('select id from booking_types where slug = $1', [`rdv-${stamp}`]))[0]?.id
await cycle('propose_booking_page (modifier)', ann, 'propose_booking_page', { booking_page_id: bt, active: false },
  async () => (await one('select active from booking_types where id = $1', [bt]))?.active === false)
await cycle('propose_intake_form (créer)', ann, 'propose_intake_form', { slug: `demande-${stamp}`, name: 'Demande de site' },
  async () => (await n('select count(*)::int as n from intake_forms where slug = $1', [`demande-${stamp}`])) === 1)
const fm = (await q('select id from intake_forms where slug = $1', [`demande-${stamp}`]))[0]?.id
await cycle('propose_intake_form (modifier)', ann, 'propose_intake_form', { form_id: fm, intro: 'Décrivez votre projet.' },
  async () => (await one('select intro from intake_forms where id = $1', [fm]))?.intro === 'Décrivez votre projet.')
const autoCard = await cycle('propose_automation (créer : prévenir le responsable)', ann, 'propose_automation', { name: `Auto ${stamp}`, trigger: 'task_completed', action: 'notify',
  params: { to: 'owner', message: 'Tâche terminée' } },
  async () => (await n('select count(*)::int as n from automations where name = $1', [`Auto ${stamp}`])) === 1)
check('carte automatisation : la phrase de l’écran (« Alors : prévenir le chef de projet », message lisible, pas de JSON)',
  Boolean(autoCard?.summary.lines.includes('Alors : prévenir le chef de projet')) && Boolean(autoCard?.summary.lines.includes('Message : Tâche terminée'))
  && !autoCard?.summary.lines.some((l: string) => l.includes('{')), autoCard?.summary.lines)
const autoEs = await ask(ann, 'propose_automation', { name: 'Asignar', trigger: 'task_created', action: 'notify', params: { to: 'owner' } }, 'es')
check('carte automatisation (es) : « Entonces: avisar al jefe de proyecto »', Boolean(autoEs.card?.summary.lines.some((l: string) => l.endsWith('avisar al jefe de proyecto'))), autoEs.card?.summary.lines)
const autoGhost = await ask(ann, 'propose_automation', { name: 'Fantôme', trigger: 'task_created', action: 'assign', params: { user_id: eveAccount } })
check('propose_automation : une personne hors de l’équipe → pas de carte', !autoGhost.card && autoGhost.reply.includes('unknown_person'), autoGhost.reply.slice(0, 200))
const au = (await q('select id from automations where name = $1', [`Auto ${stamp}`]))[0]?.id
await cycle('propose_automation (modifier)', ann, 'propose_automation', { automation_id: au, active: false },
  async () => (await one('select active from automations where id = $1', [au]))?.active === false)
const autoSend = await ask(ann, 'propose_automation', { name: 'Écrire au client', trigger: 'task_created', action: 'send_client_update' })
check('propose_automation : écrire au client n’est pas permis (pas de carte)', !autoSend.card, autoSend.reply.slice(0, 200))
await cycle('propose_timer (démarrer)', bob, 'propose_timer', { action: 'start', project_id: site },
  async () => (await n('select count(*)::int as n from time_entries where user_id = $1 and minutes is null', [bobId])) === 1)
await cycle('propose_timer (arrêter)', bob, 'propose_timer', { action: 'stop' },
  async () => (await n('select count(*)::int as n from time_entries where user_id = $1 and minutes is null', [bobId])) === 0)

// Seules sur leur carte (une autre application ou un fournisseur) : la route telle quelle.
const msg2Subject = `Nouveau site ${stamp}`
await new Client().post(`/api/inbound/${inbound}`, { from: `prospect-${stamp}@entreprise-test.ch`, to: ['x@y.z'], subject: msg2Subject, text: 'Bonjour', message_id: `<m2-${stamp}@t>` })
const msg2 = (await q('select id from email_messages where subject = $1', [msg2Subject]))[0]?.id
await cycle('propose_email_to_project (route seule)', ann, 'propose_email_to_project', { message_id: msg2, name: `Site du prospect ${stamp}` },
  async () => (await n('select count(*)::int as n from projects where name = $1 and source = $2', [`Site du prospect ${stamp}`, 'email'])) === 1)
await new Client().post(`/api/inbound/${inbound}`, { from: `suite-${stamp}@exemple.test`, to: ['x@y.z'], subject: `Suite ${stamp}`, text: 'Les textes', message_id: `<m3-${stamp}@t>` })
const msg3 = (await q('select id from email_messages where subject = $1', [`Suite ${stamp}`]))[0]?.id
await cycle('propose_link_email (route seule)', ann, 'propose_link_email', { message_id: msg3, project_id: site, as_task: true },
  async () => (await one('select project_id from email_messages where id = $1', [msg3]))?.project_id === site
    && (await n('select count(*)::int as n from tasks where project_id = $1 and source_email_id = $2', [site, msg3])) === 1)
// La reprise d'un lead CRMlead : la route même de l'écran (Clients → Importer). Ici sans Compte Lead relié : la route
// refuse, comme à l'écran (son écriture réelle, lead relu puis client créé, est contrôlée par scripts/smoke.ts).
before = await footprint(accountId)
const imp = await ask(ann, 'propose_import_client', { source: 'crmlead', external_id: 'lead-123' })
after = await footprint(accountId)
check('propose_import_client : carte seule, rien d’écrit à la proposition (aucun appel à CRMlead)', Boolean(imp.card) && same(before, after), imp.reply.slice(0, 200))
const impX = await bob.post('/api/assistant/confirm', { token: imp.card.token })
const impY = await eve.post('/api/assistant/confirm', { token: imp.card.token })
check('propose_import_client : autre personne 403, autre entreprise 403', impX.status === 403 && impY.status === 403, [impX, impY])
before = await footprint(accountId)
r = await ann.post('/api/assistant/confirm', { token: imp.card.token })
after = await footprint(accountId)
// Carte seule : le numéro du jeton est noté AVANT l'appel à l'autre application (usage unique) ; aucune donnée métier.
check('propose_import_client sans Compte Lead : refus clair de la route, aucune donnée écrite', r.status === 400 && r.body?.ok === false
  && r.body.message.startsWith('ProjectLead n’est pas relié au Compte Lead') && same({ ...before, confirmations: 0 }, { ...after, confirmations: 0 })
  && after.confirmations === before.confirmations + 1, { r, d: diff(before, after) })
const screenImport = await ann.post('/api/clients/crmlead/import', { leadId: 'lead-123' })
check('propose_import_client : la confirmation appelle la route de l’écran (même réponse que l’écran)', screenImport.status === r.status
  && screenImport.body?.error === r.body?.error, { screen: screenImport, card: r.body })
r = await ann.post('/api/assistant/confirm', { token: imp.card.token })
check('propose_import_client : rejeu 403', r.status === 403 && r.body.error === 'token_used', r)
const refreshManual = await ask(ann, 'propose_import_client', { source: 'crmlead', client_id: cli })
check('propose_import_client : « mettre à jour depuis CRMlead » un client qui n’en vient pas → pas de carte', !refreshManual.card
  && refreshManual.reply.includes('not_from_crmlead'), refreshManual.reply.slice(0, 200))

// Les brouillons du mois dans InvoiceLead (responsables) : la route de l'écran Facturation, avec un résultat par projet.
// La carte ne dit « fait » que si quelque chose a été fait, et dit quoi (lib/assistant/run.ts, routeOutcome).
const bill = await ask(bob, 'propose_monthly_billing', { period: '2026-10' })
check('propose_monthly_billing : refusé à un membre', !bill.card && bill.reply.includes('forbidden'), bill.reply.slice(0, 200))
const billP = (await ann.post('/api/projects', { name: `Facturé à l’heure ${stamp}`, status: 'active', billing_mode: 'hourly', hourly_rate_cents: 12000 })).body.id
await ann.post('/api/time/entries', { project_id: billP, entry_date: '2026-10-15', minutes: 120, note: 'Atelier', billable: true })
const emptyP = (await ann.post('/api/projects', { name: `Rien à facturer ${stamp}`, status: 'active', billing_mode: 'hourly', hourly_rate_cents: 12000 })).body.id
const runs = async (pid: string) => q('select status, error from invoice_runs where project_id = $1 and period = $2', [pid, '2026-10'])
// Sans Compte Lead relié, la route refuse comme à l'écran (lead_required). Le temps de ces cartes, l'entreprise est donc
// reliée (organisation ERPlead fictive) et la session de Mia porte une preuve fraîche (scellée, comme après une connexion
// par le Compte Lead). AUCUN appel extérieur : ces deux projets s'arrêtent avant l'envoi à InvoiceLead (l'un sans
// client, l'autre sans rien à facturer) ; l'envoi réel est contrôlé par scripts/smoke.ts avec un faux InvoiceLead.
const { sealProof } = await import('../server/lib/personProof.js')
const { hashToken } = await import('../server/auth.js')
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const leadOn = async (on: boolean) => {
  if (on) { process.env.LEAD_ID_CLIENT_SECRET = 'essai-sans-appel'; process.env.LEAD_ID_ISSUER = 'http://127.0.0.1:9' }
  else { delete process.env.LEAD_ID_CLIENT_SECRET; delete process.env.LEAD_ID_ISSUER }
  await pool.query('update accounts set lead_org = $2 where id = $1', [accountId, on ? `org-essai-${stamp}` : null])
  await pool.query('update sessions set lead_id_token = $2 where token_hash = $1', [hashToken(mia.cookie.split('=')[1]),
    on ? sealProof(`${b64u({ alg: 'none' })}.${b64u({ sub: 'essai', iat: Math.floor(Date.now() / 1000) })}.essai`) : null])
}
before = await footprint(accountId)
const billMia = await ask(mia, 'propose_monthly_billing', { period: '2026-10', project_ids: [billP] })
after = await footprint(accountId)
check('propose_monthly_billing : carte pour une responsable, « brouillons seulement », rien d’écrit', Boolean(billMia.card)
  && billMia.card.summary.lines.some((l: string) => l.includes('Brouillons seulement')) && same(before, after) && !(await runs(billP)).length, billMia.reply.slice(0, 300))
const billX = await bob.post('/api/assistant/confirm', { token: billMia.card.token })
const billY = await eve.post('/api/assistant/confirm', { token: billMia.card.token })
check('propose_monthly_billing : autre personne 403, autre entreprise 403', billX.status === 403 && billY.status === 403, [billX, billY])
await leadOn(true)
r = await mia.post('/api/assistant/confirm', { token: billMia.card.token })
check('propose_monthly_billing confirmée, projet sans client : la route note l’erreur, la carte ne dit pas « fait » (502, « Aucun brouillon créé »)',
  r.status === 502 && r.body.ok === false && r.body.message === 'Aucun brouillon créé : 1 projet en erreur (détail dans Facturation).'
  && JSON.stringify(await runs(billP)) === '[{"status":"error","error":"client_missing"}]', { r: r.body, runs: await runs(billP) })
r = await mia.post('/api/assistant/confirm', { token: billMia.card.token })
check('propose_monthly_billing : rejeu 403', r.status === 403 && r.body.error === 'token_used', r)
const billEmpty = await ask(mia, 'propose_monthly_billing', { period: '2026-10', project_ids: [emptyP] })
r = billEmpty.card ? await mia.post('/api/assistant/confirm', { token: billEmpty.card.token }) : { status: 0, body: null }
check('propose_monthly_billing confirmée, rien à facturer : « fait », et la ligne dit pourquoi aucun brouillon', r.status === 200
  && r.body.message === `Brouillons de facture 2026-10 : fait. 1 sans rien à facturer.` && JSON.stringify(await runs(emptyP)) === '[{"status":"empty","error":null}]',
  { r: r.body, runs: await runs(emptyP) })
r = billEmpty.card ? await mia.post('/api/assistant/confirm', { token: billEmpty.card.token }) : r
check('propose_monthly_billing (rien à facturer) : rejeu 403', r.status === 403 && r.body?.error === 'token_used', r)
await leadOn(false)
check('entreprise de nouveau sans Compte Lead (la suite des contrôles inchangée)', !(await one('select lead_org from accounts where id = $1', [accountId]))?.lead_org)
// La langue de l'interface : seule sur sa carte (écrite hors transaction par la route du sélecteur, db/032).
before = await footprint(accountId)
const lang = await ask(bob, 'propose_set_language', { locale: 'de' })
after = await footprint(accountId)
check('propose_set_language : carte seule, rien d’écrit à la proposition', Boolean(lang.card) && same(before, after)
  && (await one('select locale, locale_chosen from users where id = $1', [bobId]))?.locale_chosen === false, lang.reply.slice(0, 200))
r = await ann.post('/api/assistant/confirm', { token: lang.card.token })
const langEve = await eve.post('/api/assistant/confirm', { token: lang.card.token })
check('propose_set_language : autre personne 403, autre entreprise 403', r.status === 403 && langEve.status === 403, [r, langEve])
r = await bob.post('/api/assistant/confirm', { token: lang.card.token })
const bobLang = await one('select locale, locale_chosen from users where id = $1', [bobId])
check('propose_set_language confirmée : langue « de » choisie, l’écran la reçoit', r.status === 200 && r.body.locale === 'de' && bobLang?.locale === 'de' && bobLang.locale_chosen === true, { r: r.body, bobLang })
r = await bob.post('/api/assistant/confirm', { token: lang.card.token })
check('propose_set_language : rejeu 403', r.status === 403 && r.body.error === 'token_used', r)
check('la langue de l’interface ne passe jamais dans un lot (écriture hors transaction)', !opAllowed({ method: 'POST', path: '/api/me/locale', body: { locale: 'de' } }, 'tx'))
const sync = await ask(ann, 'propose_sync_now', { kind: 'mailbox', id: '00000000-0000-4000-8000-000000000001' })
check('propose_sync_now : boîte inconnue → pas de carte', !sync.card && sync.reply.includes('mailbox_not_found'), sync.reply.slice(0, 200))
// Un agenda extérieur (faux agenda iCalendar local) : branché par l'écran (1 rendez-vous lu), puis il en a 2.
ics.events = 1
r = await ann.post('/api/calendar/feeds', { name: `Agenda extérieur ${stamp}`, url: calendarUrl })
const feed = r.body?.id
const extEvents = async () => n('select count(*)::int as n from external_events where feed_id = $1', [feed])
check('agenda extérieur branché à l’écran : 1 rendez-vous lu', r.status === 201 && (await extEvents()) === 1, r.body)
ics.events = 2
await cycle('propose_sync_now (agenda extérieur, route seule)', ann, 'propose_sync_now', { kind: 'calendar_feed', id: feed }, async () => (await extEvents()) === 2)
const syncOk = await ask(ann, 'propose_sync_now', { kind: 'calendar_feed', id: feed })
ics.events = 3
r = await ann.post('/api/assistant/confirm', { token: syncOk.card.token })
check('propose_sync_now : la carte dit ce qui a été lu (« 3 rendez-vous lus »)', r.status === 200 && r.body.message === 'Synchroniser un agenda : fait. 3 rendez-vous lus.'
  && (await extEvents()) === 3, r.body)
// L'agenda est en panne : la route répond 200 avec ok: false ; la carte ne dit pas « fait » et rien ne change.
ics.status = 503
const syncKo = await ask(ann, 'propose_sync_now', { kind: 'calendar_feed', id: feed })
r = await ann.post('/api/assistant/confirm', { token: syncKo.card.token, locale: 'de' })
check('propose_sync_now, agenda en panne : 502, message clair dans la langue (de), aucun rendez-vous perdu', r.status === 502 && r.body.ok === false
  && r.body.message.startsWith('Die Synchronisierung ist fehlgeschlagen') && (await extEvents()) === 3, r.body)
ics.status = 200

// ------------------------------------------------------------------ 6. rien ne sort, même indirectement (relecture du 29.10)
// Une automatisation de l'entreprise qui « écrit au client » quand une tâche est créée ou terminée, une étape ou un projet
// terminé : à l'écran, l'email part. Depuis une carte de l'assistant, JAMAIS : la carte est refusée à l'essai, et
// « Confirmer » refuse la carte entière si l'automatisation est apparue entre-temps (rien d'écrit, rien d'envoyé).
section('rien ne sort, même indirectement')
const { tr } = await import('../server/lib/i18n.js')
const watched = (await ann.post('/api/projects', { name: `Projet suivi ${stamp}`, status: 'active', client_id: cli })).body.id
await ann.post(`/api/clients/${cli}/contacts`, { name: 'Contact suivi', email: `suivi-${stamp}@exemple.test`, receives_updates: true })
const mails = () => n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])
const reports = () => n('select count(*)::int as n from client_reports where project_id = $1', [watched])
const wStage = (await ann.post(`/api/projects/${watched}/stages`, { name: 'Maquettes', status: 'in_progress' })).body.id
const wTask = (await ann.post('/api/tasks', { project_id: watched, title: `Tâche suivie ${stamp}`, stage_id: wStage })).body.id
const autoIds: string[] = []
for (const trigger of ['task_created', 'task_completed', 'stage_completed', 'project_completed'])
  autoIds.push((await ann.post('/api/automations', { name: `Écrire au client (${trigger})`, project_id: watched, trigger, action: 'send_client_update', params: {} })).body.id)
const m0 = await mails(), r0 = await reports()
r = await ann.post('/api/tasks', { project_id: watched, title: `Créée à l’écran ${stamp}` })
check('témoin : à l’écran (inchangé), l’automatisation « écrire au client » joue : suivi enregistré, email journalisé', r.status === 201
  && (await reports()) === r0 + 1 && (await mails()) === m0 + 1, { r: r.body, reports: await reports(), mails: await mails() })
const sending: [string, string, unknown][] = [
  ['tâche créée (automatisation task_created)', 'propose_create_task', { project_id: watched, title: `Déclenche ${stamp}` }],
  ['tâche terminée (task_completed)', 'propose_update_task', { task_id: wTask, completed: true }],
  ['tâches terminées par lot de sélection (task_completed)', 'propose_update_tasks', { task_ids: [wTask], completed: true }],
  ['étape terminée (stage_completed) — la carte aurait dit « le client n’est pas prévenu »', 'propose_update_stage', { project_id: watched, stage_id: wStage, status: 'done' }],
  ['projet terminé (project_completed)', 'propose_update_project', { project_id: watched, status: 'done' }],
  ['plan de projet (ses tâches déclenchent task_created)', 'propose_project_plan', { project_id: watched, stages: [{ key: 'a', name: 'Recette' }],
    tasks: [{ key: 'x', stage: 'a', title: 'Tests', duration_days: 2 }] }],
  ['lot dont la 2e opération termine une tâche suivie', 'propose_batch', { operations: [{ tool: 'propose_create_task', input: { project_id: other, title: `Sans suivi ${stamp}` } },
    { tool: 'propose_update_task', input: { task_id: wTask, completed: true } }] }],
]
for (const [label, tool, input] of sending) {
  const fp0 = await footprint(accountId)
  const a = await ask(ann, tool, input)
  const fp1 = await footprint(accountId)
  check(`${label} : pas de carte (« sends_outside » dit au modèle), rien d’écrit, aucun email, aucun suivi`, !a.card && a.reply.includes('"code":"sends_outside"')
    && a.reply.includes('l’assistant n’envoie jamais rien') && same(fp0, fp1), { reply: a.reply.slice(0, 300), d: diff(fp0, fp1) })
}
// L'automatisation apparaît APRÈS la carte : « Confirmer » la voit et refuse la carte entière ; la carte n'est pas usée.
const quiet = (await ann.post('/api/projects', { name: `Projet calme ${stamp}`, status: 'active', client_id: cli })).body.id
const quietTask = await ask(ann, 'propose_create_task', { project_id: quiet, title: `Calme ${stamp}` })
check('projet sans automatisation : carte « Créer une tâche »', Boolean(quietTask.card), quietTask.reply.slice(0, 200))
const lateAuto = (await ann.post('/api/automations', { name: 'Ajoutée après la carte', project_id: quiet, trigger: 'task_created', action: 'send_client_update', params: {} })).body.id
let fpa = await footprint(accountId)
r = await ann.post('/api/assistant/confirm', { token: quietTask.card.token })
let fpb = await footprint(accountId)
check('automatisation ajoutée après la carte : « Confirmer » → 409 sends_outside, message traduit, rien d’écrit, aucun email, jeton pas usé', r.status === 409
  && r.body.error === 'sends_outside' && r.body.message === tr('fr', 'assistant.error.sends_outside') && same(fpa, fpb)
  && (await n('select count(*)::int as n from tasks where title = $1', [`Calme ${stamp}`])) === 0, { r: r.body, d: diff(fpa, fpb) })
fpa = await footprint(accountId)
r = await ann.post('/api/assistant/confirm', { token: sign(annId, [
  { method: 'POST', path: '/api/tasks', body: { project_id: other, title: `Avant le suivi ${stamp}` } },
  { method: 'POST', path: '/api/tasks', body: { project_id: quiet, title: `Déclenche le suivi ${stamp}` } },
]) })
fpb = await footprint(accountId)
check('jeton signé dont la 2e écriture ferait écrire au client : 409, « écriture 2 sur 2 », RIEN d’écrit (pas même la 1re), aucun email', r.status === 409
  && r.body.error === 'sends_outside' && r.body.message.includes('écriture 2 sur 2') && same(fpa, fpb)
  && (await n('select count(*)::int as n from tasks where title = $1', [`Avant le suivi ${stamp}`])) === 0, { r: r.body, d: diff(fpa, fpb) })
await ann.patch(`/api/automations/${lateAuto}`, { active: false })
r = await ann.post('/api/assistant/confirm', { token: quietTask.card.token })
check('automatisation coupée : la même carte se confirme (elle n’était pas usée), aucun email', r.status === 200
  && (await n('select count(*)::int as n from tasks where title = $1', [`Calme ${stamp}`])) === 1 && (await mails()) === m0 + 1, r.body)
// Sans automatisation qui écrit au client, la carte d'étape dit vrai : « le client n'est pas prévenu », et il ne l'est pas.
for (const id of autoIds) await ann.patch(`/api/automations/${id}`, { active: false })
const m1 = await mails(), r1 = await reports()
const stCard = await cycle('propose_update_stage terminée (sans automatisation)', ann, 'propose_update_stage', { project_id: watched, stage_id: wStage, status: 'done' },
  async () => (await one('select status from stages where id = $1', [wStage]))?.status === 'done')
check('… sa carte disait « le client n’est pas prévenu », et aucun email ni suivi n’est parti', Boolean(stCard?.summary.lines.some((l: string) => l.includes('le client n’est pas prévenu')))
  && (await mails()) === m1 && (await reports()) === r1, stCard?.summary.lines)
// Le suivi périodique (lib/jobs.ts) : relancé par un changement de statut ou de client, il enverrait un email au prochain passage.
const paused = (await ann.post('/api/projects', { name: `Projet en pause ${stamp}`, status: 'on_hold', client_id: cli })).body.id
await ann.patch(`/api/projects/${paused}`, { update_frequency: 'weekly' })
const loose = (await ann.post('/api/projects', { name: `Projet sans client ${stamp}`, status: 'active' })).body.id
await ann.patch(`/api/projects/${loose}`, { update_frequency: 'weekly' })
for (const [label, input] of [['projet en pause, suivi hebdomadaire, remis « en cours »', { project_id: paused, status: 'active' }],
  ['projet en cours, suivi hebdomadaire, sans client : un client ajouté', { project_id: loose, client_id: cli }]] as const) {
  fpa = await footprint(accountId)
  const a = await ask(ann, 'propose_update_project', input)
  fpb = await footprint(accountId)
  check(`${label} : pas de carte (« restarts_client_updates »), rien d’écrit`, !a.card && a.reply.includes('restarts_client_updates') && same(fpa, fpb), a.reply.slice(0, 300))
}
const followed = (await ann.post('/api/projects', { name: `Projet suivi chaque semaine ${stamp}`, status: 'active', client_id: cliA })).body.id
await ann.patch(`/api/projects/${followed}`, { update_frequency: 'weekly' })
const moved = await ask(ann, 'propose_update_project', { project_id: followed, client_id: cliB })
check('projet suivi chaque semaine, client changé : la carte dit « avant → après » et à qui partiront les prochains suivis', Boolean(moved.card)
  && moved.card.summary.lines.includes(`Client : Client A ${stamp} → Client B ${stamp}`)
  && moved.card.summary.lines.includes(`Suivi automatique du projet : les prochains partiront à Client B ${stamp}`), moved.card?.summary.lines ?? moved.reply.slice(0, 300))
r = await ann.post('/api/assistant/confirm', { token: moved.card.token })
check('témoin : projet déjà suivi, client changé : « Confirmer » passe (le suivi continue, vers le nouveau client, comme la carte le dit)',
  r.status === 200 && (await one('select client_id from projects where id = $1', [followed]))?.client_id === cliB, r.body)
// Relecture du 29.10 : le suivi périodique revu sur l'état RÉEL après chaque écriture, à l'essai comme à « Confirmer » —
// un lot (statut puis client), deux cartes préparées avant toute confirmation, un jeton signé de deux écritures.
const inFollowUp = async (id: string) => (await n(`select count(*)::int as n from projects where id = $1 and update_frequency <> 'none' and status = 'active'
  and not is_template and archived_at is null and client_id is not null`, [id])) === 1
const twoSteps = (await ann.post('/api/projects', { name: `En pause, sans client ${stamp}`, status: 'on_hold' })).body.id
await ann.patch(`/api/projects/${twoSteps}`, { update_frequency: 'weekly' })
fpa = await footprint(accountId)
const bothSteps = await ask(ann, 'propose_batch', { operations: [
  { tool: 'propose_update_project', input: { project_id: twoSteps, status: 'active' } },
  { tool: 'propose_update_project', input: { project_id: twoSteps, client_id: cli } }] })
fpb = await footprint(accountId)
check('lot « en cours » puis client, qui relancerait le suivi : pas de carte (« restarts_client_updates » à la 2e écriture), rien d’écrit',
  !bothSteps.card && bothSteps.reply.includes('"code":"restarts_client_updates"') && bothSteps.reply.includes('"step":2') && same(fpa, fpb),
  { reply: bothSteps.reply.slice(0, 300), d: diff(fpa, fpb) })
const cardStatus = await ask(ann, 'propose_update_project', { project_id: twoSteps, status: 'active' })
const cardClient = await ask(ann, 'propose_update_project', { project_id: twoSteps, client_id: cli })
check('deux cartes préparées avant toute confirmation (statut, puis client) : chacune, seule, est montrée', Boolean(cardStatus.card && cardClient.card),
  [cardStatus.reply.slice(0, 200), cardClient.reply.slice(0, 200)])
r = await ann.post('/api/assistant/confirm', { token: cardStatus.card?.token })
check('… la 1re (« en cours », sans client) se confirme : sans client, le suivi ne prend pas le projet', r.status === 200 && !(await inFollowUp(twoSteps)), r.body)
fpa = await footprint(accountId)
r = await ann.post('/api/assistant/confirm', { token: cardClient.card?.token })
fpb = await footprint(accountId)
check('… la 2e (client) : « Confirmer » revoit l’état réel → 409 restarts_client_updates, message traduit, rien d’écrit, carte pas usée',
  r.status === 409 && r.body.error === 'restarts_client_updates' && r.body.message === tr('fr', 'assistant.error.restarts_client_updates') && same(fpa, fpb)
  && (await one('select client_id from projects where id = $1', [twoSteps]))?.client_id === null && !(await inFollowUp(twoSteps)), { r: r.body, d: diff(fpa, fpb) })
const signedSteps = (await ann.post('/api/projects', { name: `En pause, sans client (jeton) ${stamp}`, status: 'on_hold' })).body.id
await ann.patch(`/api/projects/${signedSteps}`, { update_frequency: 'monthly' })
fpa = await footprint(accountId)
r = await ann.post('/api/assistant/confirm', { token: sign(annId, [
  { method: 'PATCH', path: `/api/projects/${signedSteps}`, body: { status: 'active' } },
  { method: 'PATCH', path: `/api/projects/${signedSteps}`, body: { client_id: cli } }]) })
fpb = await footprint(accountId)
check('jeton signé de deux écritures (statut puis client) : 409 restarts_client_updates, « écriture 2 sur 2 », RIEN d’écrit (pas même le statut)',
  r.status === 409 && r.body.error === 'restarts_client_updates' && r.body.message.includes('écriture 2 sur 2') && same(fpa, fpb)
  && (await one('select status, client_id from projects where id = $1', [signedSteps]))?.status === 'on_hold', { r: r.body, d: diff(fpa, fpb) })
// L'automatisation « écrire au client » de TOUTE l'entreprise (sans projet) : la conséquence voulue (décision d'Ève à
// prendre) — aucune tâche créée par l'assistant dans un projet dont le client reçoit les suivis ; ailleurs, la carte.
const globalAuto = (await ann.post('/api/automations', { name: `Toute l’entreprise ${stamp}`, trigger: 'task_created', action: 'send_client_update', params: {} })).body.id
const noClient = (await ann.post('/api/projects', { name: `Sans client ${stamp}`, status: 'planned' })).body.id
const gBlocked = await ask(ann, 'propose_create_task', { project_id: quiet, title: `Globale ${stamp}` })
const gFree = await ask(ann, 'propose_create_task', { project_id: noClient, title: `Globale ${stamp}` })
await ann.patch(`/api/automations/${globalAuto}`, { active: false })
check('automatisation « écrire au client » de toute l’entreprise : refus (sends_outside) là où le client reçoit les suivis, carte ailleurs',
  !gBlocked.card && gBlocked.reply.includes('"code":"sends_outside"') && Boolean(gFree.card), [gBlocked.reply.slice(0, 200), gFree.reply.slice(0, 200)])
const pausedQuiet = (await ann.post('/api/projects', { name: `En pause sans suivi ${stamp}`, status: 'on_hold', client_id: cli })).body.id
const resumeQuiet = await ask(ann, 'propose_update_project', { project_id: pausedQuiet, status: 'active' })
check('témoin : sans suivi automatique, remettre un projet « en cours » a sa carte (Statut : en pause → en cours)', Boolean(resumeQuiet.card)
  && resumeQuiet.card.summary.lines.includes('Statut : en pause → en cours'), resumeQuiet.card?.summary.lines ?? resumeQuiet.reply.slice(0, 300))

// ------------------------------------------------------------------ 6 bis. intervenants et visibilité, même indirectement
// Assigner fait de la personne une intervenante (routes/tasks.ts) : dans un projet réservé, cela lui OUVRE le projet.
// Copier un projet réservé (ou en faire un modèle) donne une copie visible de toute l'entreprise.
section('intervenants et visibilité, même indirectement')
const secret = (await ann.post('/api/projects', { name: `Projet réservé ${stamp}`, status: 'active', visibility: 'members' })).body.id
const secretTask = (await ann.post('/api/tasks', { project_id: secret, title: `Devis ${stamp}` })).body.id
check('témoin : Bob (membre, pas intervenant) ne voit pas le projet réservé', (await bob.get(`/api/projects/${secret}`)).status === 404)
const opening: [string, string, unknown][] = [
  ['créer une tâche assignée à Bob', 'propose_create_task', { project_id: secret, title: `Pour Bob ${stamp}`, assignee_ids: [bobId] }],
  ['assigner la tâche à Bob', 'propose_update_task', { task_id: secretTask, assignee_ids: [annId, bobId] }],
  ['ajouter Bob par la sélection multiple', 'propose_update_tasks', { task_ids: [secretTask], add_assignee: bobId }],
  ['plan dont une tâche est assignée à Bob', 'propose_project_plan', { project_id: secret, stages: [{ key: 'a', name: 'Étude' }],
    tasks: [{ key: 'x', stage: 'a', title: 'Analyse', duration_days: 2, assignee_ids: [bobId] }] }],
]
for (const [label, tool, input] of opening) {
  fpa = await footprint(accountId)
  const a = await ask(ann, tool, input)
  fpb = await footprint(accountId)
  check(`projet réservé, ${label} : pas de carte (« opens_reserved_project »), rien d’écrit`, !a.card && a.reply.includes('opens_reserved_project')
    && a.reply.includes('Bob Membre') && same(fpa, fpb), a.reply.slice(0, 300))
}
check('… Bob ne voit toujours pas le projet réservé, et n’en est pas intervenant', (await bob.get(`/api/projects/${secret}`)).status === 404
  && (await n('select count(*)::int as n from project_members where project_id = $1 and user_id = $2', [secret, bobId])) === 0)
const miaJoins = await ask(ann, 'propose_update_task', { task_id: secretTask, assignee_ids: [miaId] })
check('projet réservé, assigner Mia (responsable : elle voit déjà tout) : carte qui dit qu’elle devient intervenante', Boolean(miaJoins.card)
  && miaJoins.card.summary.lines.includes(`Devient intervenant de « Projet réservé ${stamp} » : Mia Responsable`), miaJoins.card?.summary.lines ?? miaJoins.reply.slice(0, 300))
const secretTpl = (await ann.post('/api/projects', { name: `Modèle réservé ${stamp}`, is_template: true, visibility: 'members' })).body.id
for (const [label, tool, input] of [['dupliquer le projet réservé', 'propose_duplicate_project', { project_id: secret, name: `Copie ${stamp}` }],
  ['enregistrer le projet réservé comme modèle', 'propose_duplicate_project', { project_id: secret, name: `Modèle ${stamp}`, as_template: true }],
  ['créer un projet depuis un modèle réservé', 'propose_create_project', { name: `Depuis le modèle ${stamp}`, template_id: secretTpl }],
  ['formulaire qui ouvre ses projets depuis un modèle réservé', 'propose_intake_form', { slug: `demande-${stamp}`, name: 'Demande', template_id: secretTpl }]] as const) {
  fpa = await footprint(accountId)
  const a = await ask(ann, tool, input)
  fpb = await footprint(accountId)
  check(`${label} : pas de carte (« reserved_project_copy » : la copie serait visible de toute l’entreprise), rien d’écrit`, !a.card
    && a.reply.includes('reserved_project_copy') && same(fpa, fpb), a.reply.slice(0, 300))
}
// Ouvrir un projet depuis un email reçu, « depuis un modèle » : même règle que propose_create_project (relecture du 29.10).
await new Client().post(`/api/inbound/${inbound}`, { from: `modele-${stamp}@entreprise-test.ch`, to: ['x@y.z'], subject: `Depuis un modèle ${stamp}`, text: 'Bonjour',
  message_id: `<m4-${stamp}@t>` })
const msg4 = (await q('select id from email_messages where subject = $1', [`Depuis un modèle ${stamp}`]))[0]?.id
fpa = await footprint(accountId)
const fromSecret = await ask(ann, 'propose_email_to_project', { message_id: msg4, template_id: secretTpl })
const notTpl = await ask(ann, 'propose_email_to_project', { message_id: msg4, template_id: other })
fpb = await footprint(accountId)
check('ouvrir un projet depuis un email avec un modèle réservé : pas de carte (« reserved_project_copy »), rien d’écrit ; un projet ordinaire n’est pas un modèle',
  !fromSecret.card && fromSecret.reply.includes('reserved_project_copy') && !notTpl.card && notTpl.reply.includes('template_not_found') && same(fpa, fpb),
  [fromSecret.reply.slice(0, 200), notTpl.reply.slice(0, 200)])
const openTpl = (await ann.post('/api/projects', { name: `Modèle ouvert ${stamp}`, is_template: true })).body.id
await ann.post(`/api/projects/${openTpl}/stages`, { name: `Cadrage ${stamp}` })
const fromOpen = await ask(ann, 'propose_email_to_project', { message_id: msg4, template_id: openTpl, client_id: cliA })
check('… avec un modèle de l’entreprise : la carte nomme le modèle (ce qu’il recopie) et le client choisi par son nom',
  Boolean(fromOpen.card?.summary.lines.includes(`Depuis le modèle : Modèle ouvert ${stamp} (étapes, colonnes et tâches recopiées, dates recalées)`))
  && Boolean(fromOpen.card?.summary.lines.includes(`Client : Client A ${stamp}`)), fromOpen.card?.summary.lines ?? fromOpen.reply.slice(0, 200))
r = await ann.post('/api/assistant/confirm', { token: fromOpen.card?.token })
const fromOpenP = (await q(`select id, client_id, visibility from projects where name = $1 and source = 'email'`, [`Depuis un modèle ${stamp}`]))[0]
check('… confirmée : le projet a le client choisi et l’étape du modèle, comme la carte le dit', r.status === 200 && fromOpenP?.client_id === cliA
  && (await n('select count(*)::int as n from stages where project_id = $1 and name = $2', [fromOpenP?.id, `Cadrage ${stamp}`])) === 1, { r: r.body, fromOpenP })
const openCopy = await ask(ann, 'propose_duplicate_project', { project_id: other, name: `Copie ouverte ${stamp}` })
check('témoin : dupliquer un projet visible de l’entreprise a sa carte', Boolean(openCopy.card), openCopy.reply.slice(0, 200))

// ------------------------------------------------------------------ 6 ter. la carte montre tout ce qui est écrit
section('la carte montre tout ce qui est écrit')
// Les participants d'un rendez-vous : la route remplace TOUTE la liste dès qu'une des deux est donnée.
const meet = (await ann.post('/api/calendar/events', { title: `Rendez-vous client ${stamp}`, starts_at: '2026-11-12T10:00:00+01:00', ends_at: '2026-11-12T11:00:00+01:00',
  attendee_user_ids: [bobId], attendee_emails: [`client1-${stamp}@exemple.test`, `client2-${stamp}@exemple.test`] })).body.id
const people = async () => (await q('select user_id, email from event_attendees where event_id = $1', [meet]))
const onlyMia = await ask(ann, 'propose_event', { event_id: meet, attendee_user_ids: [miaId] })
const teamLine = onlyMia.card?.summary.lines.find((l: string) => l.startsWith('Équipe : ')) ?? ''
check('rendez-vous, « ajoute Marie » mal compris (liste réduite à Mia) : la carte montre Bob retiré (avant → après), les extérieurs gardés', Boolean(onlyMia.card)
  && /^Équipe : .*Bob Membre.* → (?!.*Bob).*Mia Responsable/.test(teamLine) && !onlyMia.card.summary.lines.some((l: string) => l.startsWith('Participants extérieurs')),
  onlyMia.card?.summary.lines ?? onlyMia.reply.slice(0, 300))
const addMia = await ask(ann, 'propose_event', { event_id: meet, attendee_user_ids: [bobId, miaId], title: `Rendez-vous client (jeudi) ${stamp}` })
r = addMia.card ? await ann.post('/api/assistant/confirm', { token: addMia.card.token }) : { status: 0, body: null }
const after2 = await people()
check('rendez-vous, Mia ajoutée : titre avant → après ; confirmé, les deux contacts extérieurs et Bob restent, Mia et Ann y sont', r.status === 200
  && Boolean(addMia.card?.summary.lines.includes(`Titre : Rendez-vous client ${stamp} → Rendez-vous client (jeudi) ${stamp}`))
  && after2.filter((x) => x.email).length === 2 && [annId, bobId, miaId].every((id) => after2.some((x) => x.user_id === id)), { r: r.body, after2, l: addMia.card?.summary.lines })
check('list_events donne au modèle les participants (équipe et extérieurs)', (await ask(ann, 'list_events', { from: '2026-11-12', to: '2026-11-12', scope: 'all' })).reply
  .includes(`client1-${stamp}@exemple.test`))
// Les textes longs : en entier sur la carte (la signature est ajoutée à TOUS les suivis client).
const sig = `Cordialement, l’équipe ${stamp}${' '.repeat(1500)}Nos coordonnées bancaires ont changé : IBAN CH00 ${stamp}`
const sigCard = await ask(ann, 'propose_update_settings', { billing: { client_update_signature: sig } })
check('signature du suivi client (≈1 600 caractères) : en entier sur la carte, jusqu’à l’IBAN, avant → après', Boolean(sigCard.card?.summary.lines.some((l: string) =>
  l.includes(`IBAN CH00 ${stamp}`) && l.includes(' → '))), sigCard.card?.summary.lines.map((l: string) => l.slice(-120)) ?? sigCard.reply.slice(0, 200))
const note = `Retard dû au client. ${'y'.repeat(1900)} FIN-DE-LA-NOTE`
const noteCard = await ask(ann, 'propose_update_stage', { project_id: watched, stage_id: wStage, client_note: note })
check('note pour le client d’une étape (2 000 caractères) : en entier sur la carte', Boolean(noteCard.card?.summary.lines.some((l: string) => l.includes('FIN-DE-LA-NOTE'))),
  noteCard.reply.slice(0, 200))
// Le plan : description et note pour le client de chaque étape, visibilité par le client, et pour chaque tâche
// description, priorité, visibilité, points de contrôle par leur libellé ; aucune tâche cachée.
const planP = (await ann.post('/api/projects', { name: `Plan détaillé ${stamp}`, status: 'active' })).body.id
const detailed = await ask(ann, 'propose_project_plan', { project_id: planP, start_date: '2026-11-02',
  stages: [{ key: 'a', name: 'Développement', description: 'Intégration du thème', client_note: 'Retard dû à l’incompétence du client' },
    { key: 'b', name: 'Interne', visible_to_client: false }],
  tasks: [...Array.from({ length: 12 }, (_, i) => ({ key: `t${i}`, stage: 'a', title: `Tâche ${i + 1}`, duration_days: 1 })),
    { key: 'v', stage: 'b', title: 'Revue', duration_days: 1, priority: 'urgent', visible_to_client: true, description: 'Relire tout le code', checklist: ['Sécurité', 'Accessibilité'] }] })
const dg = detailed.card?.summary.groups ?? []
check('plan : la note pour le client et la description de l’étape sont sur la carte', Boolean(dg[0]?.notes?.includes('Note pour le client : Retard dû à l’incompétence du client'))
  && Boolean(dg[0]?.notes?.includes('Description : Intégration du thème')), dg[0])
check('plan : la carte dit quelles étapes le client voit (« 1. Développement » seulement)', Boolean(detailed.card?.summary.lines
  .includes('Étapes visibles par le client (page de suivi et suivis envoyés) : 1. Développement')), detailed.card?.summary.lines)
check('plan : les 12 tâches de l’étape sur la carte (aucune sous « + N autres »)', dg[0]?.lines.length === 12 && !dg[0].more, dg[0]?.lines.length)
check('plan : une tâche montre priorité, visibilité, description et ses points de contrôle par leur libellé', Boolean(dg[1]?.lines[0]?.includes('2 points de contrôle (Sécurité, Accessibilité)'))
  && dg[1].lines[0].includes('priorité urgente') && dg[1].lines[0].includes('visible par le client') && dg[1].lines[0].includes('Description : Relire tout le code'), dg[1]?.lines)
// Le budget et la facturation : « avant → après », chaque montant dans sa devise.
const budgeted = (await ann.post('/api/projects', { name: `Budgété ${stamp}`, status: 'active', budget_cents: 800000, billing_mode: 'fixed', fixed_cents: 500000 })).body.id
const bud = await ask(ann, 'propose_update_project', { project_id: budgeted, budget_cents: 150000, fixed_cents: 450000, billing_mode: 'hourly' })
check('budget, forfait et mode de facturation : avant → après', Boolean(bud.card?.summary.lines.some((l: string) => /^Budget : CHF 8\D?000 → CHF 1\D?500$/.test(l)))
  && Boolean(bud.card?.summary.lines.some((l: string) => /^Forfait global : CHF 5\D?000 → CHF 4\D?500$/.test(l)))
  && Boolean(bud.card?.summary.lines.includes('Facturation : forfait global → à l’heure')), bud.card?.summary.lines)
// Une saisie de temps et un contact modifiés : chaque champ avant → après.
const te = (await ann.post('/api/time/entries', { project_id: other, entry_date: '2026-11-05', minutes: 60, note: 'Avant' })).body.id
const teCard = await ask(ann, 'propose_update_time_entry', { entry_id: te, minutes: 90, entry_date: '2026-11-06', billable: false })
check('saisie de temps modifiée : durée, date, facturable avant → après', Boolean(teCard.card?.summary.lines.includes('Durée : 1 h → 1 h 30'))
  && Boolean(teCard.card?.summary.lines.some((l: string) => /^Date : .*5 nov.* → .*6 nov/.test(l))) && Boolean(teCard.card?.summary.lines.includes('Facturable : oui → non')), teCard.card?.summary.lines)
const ctc = (await q(`select id from client_contacts where client_id = $1 and name = 'Contact suivi'`, [cli]))[0].id
const ctcCard = await ask(ann, 'propose_client_contact', { client_id: cli, contact_id: ctc, email: `autre-${stamp}@exemple.test`, receives_updates: false })
check('contact modifié : email et « reçoit le suivi » avant → après', Boolean(ctcCard.card?.summary.lines.includes(`Email : suivi-${stamp}@exemple.test → autre-${stamp}@exemple.test`))
  && Boolean(ctcCard.card?.summary.lines.includes('Reçoit le suivi des projets : oui → non')), ctcCard.card?.summary.lines)

// La copie d'un projet reprend son client, le statut « en cours » et la facturation : tout est sur la carte (relecture du 29.10).
const billedSrc = (await ann.post('/api/projects', { name: `Facturé ${stamp}`, status: 'planned', client_id: cliA, billing_mode: 'hourly', hourly_rate_cents: 12000,
  budget_minutes: 600 })).body.id
const dup = await ask(ann, 'propose_duplicate_project', { project_id: billedSrc, name: `Copie facturée ${stamp}` })
const dupLines: string[] = dup.card?.summary.lines ?? []
check('dupliquer : la carte dit le client repris du projet source, le statut « en cours », la facturation, le taux et le budget',
  dupLines.includes(`Client : Client A ${stamp}`) && dupLines.includes('Statut : en cours') && dupLines.includes('Facturation : à l’heure')
  && dupLines.some((l) => /^Taux horaire : CHF 120$/.test(l)) && dupLines.includes('Budget : 10 h'), dupLines.length ? dupLines : dup.reply.slice(0, 200))
r = await ann.post('/api/assistant/confirm', { token: dup.card?.token })
const dupP = (await q('select client_id, status, billing_mode, hourly_rate_cents, budget_minutes from projects where name = $1', [`Copie facturée ${stamp}`]))[0]
check('… confirmée : la copie a exactement ce client, ce statut, cette facturation et ce budget', r.status === 200 && dupP?.client_id === cliA && dupP.status === 'active'
  && dupP.billing_mode === 'hourly' && dupP.hourly_rate_cents === 12000 && dupP.budget_minutes === 600, { r: r.body, dupP })
const stg = await ask(ann, 'propose_create_stage', { project_id: other, name: `Étape par défaut ${stamp}` })
check('nouvelle étape sans choix de visibilité : la carte dit « Visible par le client : oui » (la valeur écrite)', Boolean(stg.card?.summary.lines.includes('Visible par le client : oui')),
  stg.card?.summary.lines ?? stg.reply.slice(0, 200))
r = await ann.post('/api/assistant/confirm', { token: stg.card?.token })
check('… confirmée : l’étape est bien visible par le client', r.status === 200 && (await one('select visible_to_client from stages where name = $1', [`Étape par défaut ${stamp}`]))?.visible_to_client === true, r.body)
// Un rendez-vous relu seul avant sa modification (plus tout l'agenda de l'entreprise, de 2000 à 2100).
const evOne = await ann.get(`/api/calendar/events?id=${meet}`)
const evOther = await eve.get(`/api/calendar/events?id=${meet}`)
const evBad = await ann.get('/api/calendar/events?id=pas-un-id')
const toolsSrc = readFileSync(new URL('../server/lib/assistant/tools.ts', import.meta.url), 'utf8')
check('rendez-vous relu seul (?id=) : lui seul avec ses participants, rien pour une autre entreprise, id invalide 400 ; l’assistant ne lit plus tout l’agenda',
  evOne.status === 200 && evOne.body.events.length === 1 && evOne.body.events[0].id === meet && evOne.body.events[0].attendees.length >= 4
  && evOther.status === 200 && evOther.body.events.length === 0 && evBad.status === 400 && !toolsSrc.includes('2000-01-01')
  && toolsSrc.includes('/api/calendar/events?id='), { one: evOne.body?.events?.length, other: evOther.body, bad: evBad.status })
// Plusieurs requêtes ensemble sur une même connexion (avertissement de pg) : jamais, ni ici, ni dans tout ce contrôle.
const someTask = (await q('select id from tasks where account_id = $1 order by created_at limit 1', [accountId]))[0]?.id
const tGet = await ann.get(`/api/tasks/${someTask}`)
const sGet = await ann.get(`/api/search?q=${encodeURIComponent('Projet')}`)
await new Promise((resolve) => setTimeout(resolve, 50))
check('aucune requête lancée en même temps qu’une autre sur une même connexion (fiche d’une tâche, recherche, tout ce contrôle)',
  tGet.status === 200 && Array.isArray(tGet.body.checklist) && Array.isArray(tGet.body.activity) && sGet.status === 200 && Array.isArray(sGet.body.projects)
  && !pgParallel.length, { pgParallel, t: tGet.status, s: sGet.status })

// ------------------------------------------------------------------ 7. la liste fermée : jamais ces écritures, même signées
section('interdits, même avec un jeton signé')
const FORBIDDEN: [string, any][] = [
  ['visibilité d’un projet', { method: 'PATCH', path: `/api/projects/${other}`, body: { visibility: 'members' } }],
  ['responsable d’un projet', { method: 'PATCH', path: `/api/projects/${other}`, body: { owner_id: bobId } }],
  ['ouvrir la page de suivi', { method: 'PATCH', path: `/api/projects/${other}`, body: { portal_enabled: true } }],
  ['envoi automatique au client', { method: 'PATCH', path: `/api/projects/${other}`, body: { update_frequency: 'weekly' } }],
  ['étape : prévenir le client', { method: 'PATCH', path: `/api/projects/stages/${bilan}`, body: { status: 'done', notify_client: true } }],
  ['point partagé avec le client', { method: 'POST', path: `/api/projects/${other}/updates`, body: { health: 'on_track', body: 'x', share_with_client: true } }],
  ['rendez-vous : invitations', { method: 'POST', path: '/api/calendar/events', body: { title: 'x', starts_at: '2026-11-05T09:00:00+01:00', ends_at: '2026-11-05T10:00:00+01:00', send_invites: true } }],
  ['automatisation qui écrit au client', { method: 'POST', path: '/api/automations', body: { name: 'x', trigger: 'task_created', action: 'send_client_update' } }],
  ['suppression par la sélection multiple', { method: 'POST', path: '/api/tasks/bulk', body: { ids: [tA], patch: { delete: true } } }],
  ['case de temps à 0 (efface)', { method: 'PUT', path: '/api/time/week/cell', body: { project_id: other, entry_date: '2026-11-03', minutes: 0 } }],
  ['archiver un client', { method: 'PATCH', path: `/api/clients/${cli}`, body: { archived: true } }],
  ['intervenants d’un projet', { method: 'POST', path: `/api/projects/${other}/members`, body: { user_id: bobId } }],
  ['inviter une personne', { method: 'POST', path: '/api/team/invite', body: { email: 'x@y.z' } }],
  ['envoyer le suivi', { method: 'POST', path: `/api/projects/${other}/client-report`, body: {} }],
  ['email depuis le projet', { method: 'POST', path: `/api/projects/${other}/emails`, body: { to: ['x@y.z'], subject: 's', body: 'b' } }],
  ['répondre à un email', { method: 'POST', path: `/api/mail/messages/${msg}/reply`, body: { body: 'x' } }],
  ['clé d’API', { method: 'POST', path: '/api/api-keys', body: { name: 'x' } }],
  ['payer', { method: 'POST', path: '/api/billing/checkout', body: {} }],
  ['mot de passe', { method: 'POST', path: '/api/me/password', body: { next: 'xxxxxxxxxxxx' } }],
  ['régénérer le lien du client', { method: 'POST', path: `/api/projects/${other}/portal/regenerate`, body: {} }],
  ['partager une boîte', { method: 'PATCH', path: '/api/mail/mailboxes/00000000-0000-4000-8000-000000000001', body: { shared: true } }],
  ['brancher un agenda', { method: 'POST', path: '/api/calendar/feeds', body: { name: 'x', url: 'https://x' } }],
  ['route d’une autre application en lot', { method: 'POST', path: '/api/clients/crmlead/import', body: { leadId: 'x' } }],
]
const leaked: string[] = []
for (const [label, op] of FORBIDDEN) {
  check(`refusé par la liste fermée : ${label}`, !opAllowed(op, 'tx'))
  before = await footprint(accountId)
  r = await ann.post('/api/assistant/confirm', { token: sign(annId, [{ method: 'POST', path: '/api/tasks', body: { project_id: other, title: `Avant ${label}` } }, op]) })
  after = await footprint(accountId)
  if (r.status !== 403 || r.body?.error !== 'operation_not_allowed' || !same(before, after)) leaked.push(`${label}: ${r.status} ${JSON.stringify(diff(before, after))}`)
}
check(`ces ${FORBIDDEN.length} jetons signés : 403 operation_not_allowed, rien d’écrit (même la tâche placée avant)`, !leaked.length, leaked)
// Témoin : le même jeton signé, sans l'écriture interdite, passe (la vérification ci-dessus peut donc échouer).
r = await ann.post('/api/assistant/confirm', { token: sign(annId, [{ method: 'POST', path: '/api/tasks', body: { project_id: other, title: `Témoin ${stamp}` } }]) })
check('témoin : la même carte sans l’écriture interdite est exécutée', r.status === 200 && (await n('select count(*)::int as n from tasks where title = $1', [`Témoin ${stamp}`])) === 1, r.body)
check('les outils route (CRMlead, InvoiceLead, emails, facturation, synchronisation) ne passent qu’en carte seule',
  opAllowed({ method: 'POST', path: '/api/clients/crmlead/import', body: {} }, 'route') && !opAllowed({ method: 'POST', path: '/api/clients/crmlead/import', body: {} }, 'tx'))

// ------------------------------------------------------------------ 8. taille : un grand plan tient dans une carte
section('taille')
const big = { project_id: other, start_date: '2026-11-02', stages: Array.from({ length: 10 }, (_, i) => ({ key: `s${i}`, name: `Étape ${i + 1}` })),
  tasks: Array.from({ length: 60 }, (_, i) => ({ key: `t${i}`, stage: `s${Math.floor(i / 6)}`, title: `Tâche ${i + 1} — ${'x'.repeat(40)}`, duration_days: 2, estimate_minutes: 240,
    ...(i % 6 ? { after: [`t${i - 1}`] } : {}) })) }
const bigP = await ask(ann, 'propose_project_plan', big)
check(`grand plan (10 étapes, 60 tâches, 50 dépendances) : une carte, jeton < 250 000 caractères (${bigP.card?.token.length ?? 0})`,
  Boolean(bigP.card) && bigP.card.token.length < 250_000, bigP.reply.slice(0, 200))
r = await ann.post('/api/assistant/confirm', { token: bigP.card.token })
check('grand plan confirmé : 10 étapes et 60 tâches de plus', r.status === 200 && r.body.message.includes('10 étapes, 60 tâches'), r.body)
const tooBig = await ask(ann, 'propose_project_plan', { ...big, tasks: big.tasks.map((t) => ({ ...t, checklist: ['a', 'b'] })) })
check(`plan au-delà de ${MAX_OPS} écritures : refus clair (découper)`, !tooBig.card && tooBig.reply.includes('plan_too_large'), tooBig.reply.slice(0, 200))

// ------------------------------------------------------------------ 9. outils déclarés = outils enregistrés
section('registre')
seen.length = 0
await ann.post('/api/assistant', { messages: [{ role: 'user', content: 'Bonjour' }], page: '/', locale: 'fr' })
const names: string[] = (seen[0]?.body.tools ?? []).map((t: any) => t.name)
check(`outils envoyés au modèle = TOOL_NAMES (${names.length})`, JSON.stringify(names) === JSON.stringify(TOOL_NAMES), names)
check('chaque outil regroupable existe', BATCHABLE.every((b) => names.includes(b)))
check('max_tokens 16000 (un plan complet tient dans un tour)', seen[0]?.body.max_tokens === 16000, seen[0]?.body.max_tokens)

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
fake.close()
await pool.end()
console.log(ko ? 'ASSISTANT_ACTIONS_CHECK_FAILED' : 'ASSISTANT_ACTIONS_CHECK_OK')
process.exit(ko ? 1 : 0)
