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
check('lot : UNE carte groupée (3 tâches, 1 modification, 1 saisie), rien d’écrit', batch.card?.summary.title === 'Relances de la semaine'
  && batch.card.summary.groups.map((g: any) => g.title).join('|') === 'Créer une tâche (3)|Modifier une tâche|Saisir du temps' && same(before, after),
  { s: batch.card?.summary, d: diff(before, after) })
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
check('carte client (fr) : pays, langue et genre en toutes lettres, avec l’avant', JSON.stringify(cliFr.card?.summary.lines.slice(1))
  === JSON.stringify(['Genre : personne (avant : entreprise)', 'Pays : Allemagne (avant : Suisse)', 'Langue : allemand (avant : français)']), cliFr.card?.summary.lines)
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

// ------------------------------------------------------------------ 6. l'essai n'envoie rien (automatisation « écrire au client »)
section('essai sans effet extérieur')
const watched = (await ann.post('/api/projects', { name: `Projet suivi ${stamp}`, status: 'active', client_id: cli })).body.id
await ann.post(`/api/clients/${cli}/contacts`, { name: 'Contact suivi', email: `suivi-${stamp}@exemple.test`, receives_updates: true })
await ann.post('/api/automations', { name: 'Suivi à chaque tâche', project_id: watched, trigger: 'task_created', action: 'send_client_update', params: {} })
const mails0 = await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])
const reports0 = await n('select count(*)::int as n from client_reports where project_id = $1', [watched])
const wt = await ask(ann, 'propose_create_task', { project_id: watched, title: 'Tâche qui déclenche le suivi' })
check('essai d’une tâche dont l’automatisation écrit au client : AUCUN email, aucun suivi enregistré', Boolean(wt.card)
  && (await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])) === mails0
  && (await n('select count(*)::int as n from client_reports where project_id = $1', [watched])) === reports0)
await ann.post('/api/assistant/confirm', { token: wt.card.token })
check('après « Confirmer », l’automatisation de l’entreprise joue comme à l’écran (suivi journalisé)', (await n('select count(*)::int as n from client_reports where project_id = $1', [watched])) === reports0 + 1)
// Tout ou rien, email compris : dans un lot, l'email d'une automatisation attend la validation de TOUTE la carte.
const mails1 = await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])
const reports1 = await n('select count(*)::int as n from client_reports where project_id = $1', [watched])
r = await ann.post('/api/assistant/confirm', { token: sign(annId, [
  { method: 'POST', path: '/api/tasks', body: { project_id: watched, title: `Déclenche le suivi ${stamp}` } },   // l'automatisation écrit au client
  { method: 'POST', path: '/api/tasks', body: { project_id: other, title: `Tâche A ${stamp}` }, ref: 'a' },
  { method: 'POST', path: '/api/tasks', body: { project_id: site, title: `Tâche B ${stamp}` }, ref: 'b' },
  { method: 'POST', path: '/api/tasks/@a/dependencies', body: { depends_on_id: '@b' } },                       // deux projets : refusée
]) })
check('lot refusé à la 4e écriture après une tâche qui déclenche le suivi client : AUCUN email parti, aucun suivi, aucune tâche', r.status === 400
  && (await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])) === mails1
  && (await n('select count(*)::int as n from client_reports where project_id = $1', [watched])) === reports1
  && (await n('select count(*)::int as n from tasks where title = $1', [`Déclenche le suivi ${stamp}`])) === 0, r.body)
r = await ann.post('/api/assistant/confirm', { token: sign(annId, [
  { method: 'POST', path: '/api/tasks', body: { project_id: watched, title: `Déclenche le suivi, validé ${stamp}` } },
  { method: 'POST', path: '/api/tasks', body: { project_id: other, title: `Accompagne ${stamp}` } },
]) })
const sentAfter = await q('select to_emails, via from sent_emails where account_id = $1 order by created_at desc limit 1', [accountId])
check('lot validé : l’email du suivi part APRÈS la validation (une fois, au contact qui reçoit le suivi)', r.status === 200
  && (await n('select count(*)::int as n from sent_emails where account_id = $1', [accountId])) === mails1 + 1
  && (await n('select count(*)::int as n from client_reports where project_id = $1', [watched])) === reports1 + 1
  && sentAfter[0]?.to_emails.includes(`suivi-${stamp}@exemple.test`), { r: r.body, sentAfter })

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
