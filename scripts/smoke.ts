/**
 * Contrôles de bout en bout de l'API, sur une vraie base PostgreSQL (DATABASE_URL), avec de faux
 * CRMlead, InvoiceLead et Compte Lead en local. `npm test` : tout doit être vert.
 */
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = '1'
process.env.APP_SECRET ||= 'smoke-secret-smoke-secret-smoke-secret-0123'
process.env.PUBLIC_URL ||= 'http://localhost:5174'

import 'dotenv/config'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import type { AddressInfo } from 'node:net'

// Une base à part pour les contrôles : ils créent des entreprises à chaque passage.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

const { migrate } = await import('../server/migrate.js')
await migrate(() => {})
const { default: app } = await import('../server/index.js')
const { pool } = await import('../server/db.js')
const { runJobs } = await import('../server/lib/jobs.js')

let ok = 0, ko = 0
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) { ok++; console.log(`  ✓ ${name}`) } else { ko++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)) }
}
const section = (s: string) => console.log(`\n${s}`)

class Client {
  cookie = ''
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { ...headers, ...(this.cookie ? { cookie: this.cookie } : {}) } }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as any)['content-type'] = 'application/json' }
    const res = await app.request(`http://localhost${path}`, init)
    const set = res.headers.get('set-cookie')
    if (set) {
      const m = set.match(/projectlead_session=([^;]*)/)
      if (m) this.cookie = m[1] ? `projectlead_session=${m[1]}` : ''
    }
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, body: json, headers: res.headers }
  }
  get = (p: string) => this.req('GET', p)
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {})
  patch = (p: string, b: unknown) => this.req('PATCH', p, b)
  put = (p: string, b: unknown) => this.req('PUT', p, b)
  del = (p: string) => this.req('DELETE', p)
}

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))
const readBody = (req: any) => new Promise<any>((r) => { let d = ''; req.on('data', (x: any) => (d += x)); req.on('end', () => { try { r(JSON.parse(d || '{}')) } catch { r({}) } }) })

// ------------------------------------------------------------------ faux CRMlead (API v1)
const crmLead = {
  id: 'lead-42', title: 'Refonte du site', company: 'Boulangerie Rochat SA', company_address: 'Rue de Bourg 12, 1003 Lausanne',
  company_country: 'CH', status: 'won', amount: 1200000, currency: 'CHF', description: 'Site vitrine',
  contacts: [{ id: 'c1', first_name: 'Léa', last_name: 'Rochat', email: 'lea@rochat.ch', phone: '+41 21 000 00 00', job_title: 'Directrice', is_primary: true }],
}
const crm = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.headers.authorization !== 'Bearer crm_test') { res.statusCode = 401; return res.end('{"error":"invalid_key"}') }
  if (req.url?.startsWith('/api/v1/leads/lead-42')) return res.end(JSON.stringify(crmLead))
  if (req.url?.startsWith('/api/v1/leads')) return res.end(JSON.stringify({ data: [crmLead], has_more: false }))
  res.statusCode = 404; res.end('{"error":"not_found"}')
})
const crmPort = await listen(crm)

// ------------------------------------------------------------------ faux InvoiceLead (API v1)
const ilContacts: any[] = []
const ilInvoices: any[] = []
const il = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.headers.authorization !== 'Bearer il_live_test') { res.statusCode = 401; return res.end('{"error":"unauthorized"}') }
  const url = new URL(req.url!, 'http://x')
  if (url.pathname === '/api/v1/contacts' && req.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    return res.end(JSON.stringify({ data: ilContacts.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email?.toLowerCase() === q) }))
  }
  if (url.pathname === '/api/v1/contacts' && req.method === 'POST') {
    const b = await readBody(req); const c = { id: randomUUID(), ...b }; ilContacts.push(c)
    res.statusCode = 201; return res.end(JSON.stringify({ data: c }))
  }
  if (url.pathname === '/api/v1/invoices' && req.method === 'POST') {
    const b = await readBody(req)
    const total = b.lines.reduce((s: number, l: any) => s + Math.round(Number(l.quantity) * Number(l.unitPrice) * 100), 0)
    const inv = { id: randomUUID(), status: 'draft', totalCents: total, ...b }; ilInvoices.push(inv)
    res.statusCode = 201; return res.end(JSON.stringify({ data: inv }))
  }
  res.statusCode = 404; res.end('{"error":"not_found"}')
})
const ilPort = await listen(il)

// ------------------------------------------------------------------ faux Compte Lead (JWKS) pour l'échange
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const issuerSrv = createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/oauth/jwks') return res.end(JSON.stringify({ keys: [jwk] }))
  res.statusCode = 404; res.end('{}')
})
const issPort = await listen(issuerSrv)
process.env.LEAD_ID_ISSUER = `http://127.0.0.1:${issPort}`
process.env.LEAD_ID_APP = 'projectlead'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function exchangeJwt(app = 'crmlead', aud = 'projectlead') {
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const p = b64({ iss: process.env.LEAD_ID_ISSUER, aud, app, scope: 'exchange', exp: Math.floor(Date.now() / 1000) + 300 })
  return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`
}

// ================================================================== scénarios
const stamp = Date.now().toString(36)
const today = new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10)

section('Compte et connexion')
const eve = new Client()
let r = await eve.post('/api/auth/signup', { name: 'Ève Test', email: `eve-${stamp}@exemple.test`, password: 'motdepasse-solide', company: `Atelier ${stamp}` })
check('inscription → 201 et session', r.status === 201 && eve.cookie, r)
r = await eve.get('/api/me')
check('/me rend la personne, admin', r.status === 200 && r.body.user.role === 'admin', r.body)
const accountId = r.body.account.id
const inboundToken = r.body.account.inbound_token
check('sans session → 401', (await new Client().get('/api/projects')).status === 401)
r = await new Client().post('/api/auth/login', { email: `eve-${stamp}@exemple.test`, password: 'faux-mot-de-passe' })
check('mauvais mot de passe → 401', r.status === 401)
r = await eve.post('/api/auth/signup', { name: 'X', email: `eve-${stamp}@exemple.test`, password: 'motdepasse-solide', company: 'X' })
check('email déjà pris → 409', r.status === 409)

section('Équipe et invitation')
r = await eve.post('/api/team/invite', { email: `marc-${stamp}@exemple.test`, role: 'member' })
check('invitation → lien', r.status === 201 && r.body.link, r.body)
const invToken = r.body.link.split('/').pop()
const marc = new Client()
r = await marc.get(`/api/auth/invitation/${invToken}`)
check('invitation lisible sans compte', r.status === 200 && r.body.account.startsWith('Atelier'), r.body)
r = await marc.post(`/api/auth/invitation/${invToken}/accept`, { name: 'Marc Dupont', password: 'autre-mot-de-passe' })
check('invitation acceptée → session', r.status === 200 && marc.cookie, r.body)
r = await eve.get('/api/team')
const marcId = r.body.members.find((m: any) => m.name === 'Marc Dupont')?.id
check('Marc est dans l’équipe', Boolean(marcId), r.body)
const eveId = (await eve.get('/api/me')).body.user.id
r = await eve.post('/api/team/teams', { name: 'Production', member_ids: [eveId, marcId] })
check('équipe créée', r.status === 201)
r = await marc.post('/api/team/invite', { email: 'x@exemple.test' })
check('un membre ne peut pas inviter → 403', r.status === 403)
r = await eve.patch(`/api/team/members/${eveId}`, { role: 'member' })
check('dernier administrateur protégé → 400', r.status === 400 && r.body.error === 'last_admin', r.body)
await eve.patch(`/api/team/members/${marcId}`, { hourly_rate_cents: 12000 })

section('Clients')
r = await eve.post('/api/clients', { name: 'Garage Favre SA', email: 'info@favre.ch', street: 'Route de Genève', building_number: '5', postal_code: '1260', town: 'Nyon' })
check('client créé', r.status === 201, r.body)
const favreId = r.body.id
r = await eve.post(`/api/clients/${favreId}/contacts`, { name: 'Paul Favre', email: 'paul@favre.ch' })
check('contact du client', r.status === 201)
r = await eve.get('/api/clients?q=favre')
check('recherche de client', r.body.length === 1 && r.body[0].projects === 0, r.body)

section('Projets et modèle')
r = await eve.get('/api/projects?template=1')
const tplId = r.body[0]?.id
check('un modèle de départ existe', Boolean(tplId) && r.body[0].stages_total === 4, r.body[0])
r = await eve.post('/api/projects', { name: 'Atelier mécanique', client_id: favreId, template_id: tplId, start_date: today,
  member_ids: [marcId], billing_mode: 'hourly', hourly_rate_cents: 15000, budget_minutes: 6000, update_frequency: 'weekly' })
check('projet créé depuis le modèle', r.status === 201, r.body)
const projId = r.body.id
r = await eve.get(`/api/projects/${projId}`)
check('étapes, colonnes et intervenants copiés', r.body.stages.length === 4 && r.body.columns.length === 4 && r.body.members_detail.length === 2, r.body)
check('code projet attribué', /^P-\d{4}-\d{3}$/.test(r.body.code ?? ''), r.body.code)
check('dates du modèle décalées au début du projet', r.body.stages[0].start_date === today, r.body.stages[0])
const columns = r.body.columns
const stages = r.body.stages
r = await marc.get('/api/notifications')
check('Marc prévenu qu’il intervient', r.body.some((n: any) => n.kind === 'project_member'), r.body)

section('Tâches')
r = await eve.get(`/api/tasks?project=${projId}`)
check('tâches du modèle copiées', r.body.length === 10, r.body.length)
const tasks = r.body
r = await eve.post('/api/tasks', { project_id: projId, title: 'Commander les pièces', stage_id: stages[2].id, assignee_ids: [marcId], due_date: today, estimate_minutes: 120, priority: 'high' })
check('tâche créée et assignée', r.status === 201, r.body)
const piecesId = r.body.id
r = await marc.get('/api/tasks?assignee=me&status=open')
check('« Mes tâches » de Marc', r.body.some((t: any) => t.id === piecesId), r.body.length)
r = await eve.post('/api/tasks', { project_id: projId, title: 'Monter les pièces', stage_id: stages[2].id })
const monterId = r.body.id
r = await eve.post(`/api/tasks/${monterId}/dependencies`, { depends_on_id: piecesId })
check('dépendance posée', r.status === 200, r.body)
r = await eve.post(`/api/tasks/${piecesId}/dependencies`, { depends_on_id: monterId })
check('cycle de dépendances refusé', r.status === 400 && r.body.error === 'dependency_cycle', r.body)
r = await eve.get(`/api/tasks/${monterId}`)
check('tâche bloquée par sa dépendance', r.body.blocked === true && r.body.dependencies.length === 1, r.body)
await eve.post(`/api/tasks/${piecesId}/checklist`, { label: 'Filtre à huile' })
await eve.post(`/api/tasks/${piecesId}/comments`, { body: 'Voir avec @Marc Dupont pour le fournisseur' })
r = await marc.get('/api/notifications')
check('mention notifiée', r.body.some((n: any) => n.kind === 'mention'), r.body.map((n: any) => n.kind))
const doneCol = columns.find((c: any) => c.is_done)
r = await marc.patch(`/api/tasks/${piecesId}`, { column_id: doneCol.id })
r = await eve.get(`/api/tasks/${piecesId}`)
check('déplacée en « Terminé » → terminée', Boolean(r.body.completed_at), r.body)
r = await eve.get(`/api/tasks/${monterId}`)
check('dépendante débloquée', r.body.blocked === false, r.body)
r = await eve.patch(`/api/tasks/${piecesId}`, { completed: false })
r = await eve.get(`/api/tasks/${piecesId}`)
check('rouverte → revient en première colonne', !r.body.completed_at && r.body.column_id === columns[0].id, r.body)
r = await eve.post('/api/tasks', { project_id: projId, title: 'Point hebdo', recurrence: 'weekly', due_date: today })
const recId = r.body.id
await eve.patch(`/api/tasks/${recId}`, { completed: true })
r = await eve.get(`/api/tasks?project=${projId}&q=Point hebdo`)
check('tâche récurrente : la suivante est créée', r.body.filter((t: any) => t.title === 'Point hebdo' && !t.completed_at && t.due_date === addDays(today, 7)).length === 1, r.body.map((t: any) => [t.due_date, t.completed_at]))
r = await eve.post('/api/tasks', { project_id: projId, title: 'Sous-tâche', parent_id: piecesId })
r = await eve.get(`/api/tasks/${piecesId}`)
check('sous-tâche rattachée', r.body.subtasks.length === 1, r.body.subtasks)
r = await eve.post('/api/tasks/bulk', { ids: [tasks[0].id, tasks[1].id], patch: { priority: 'urgent' } })
r = await eve.get(`/api/tasks/${tasks[0].id}`)
check('modification groupée', r.body.priority === 'urgent', r.body.priority)

section('Temps')
r = await marc.post('/api/time/entries', { project_id: projId, task_id: piecesId, entry_date: today, minutes: 90, note: 'Recherche fournisseurs' })
check('temps saisi', r.status === 201, r.body)
r = await eve.put('/api/time/week/cell', { project_id: projId, task_id: null, entry_date: today, minutes: 120 })
check('feuille de temps : cellule', r.status === 200, r.body)
const monday = (() => { const d = new Date(today + 'T12:00:00Z'); const k = (d.getUTCDay() + 6) % 7; return addDays(today, -k) })()
r = await eve.get(`/api/time/week?start=${monday}`)
check('feuille de la semaine', r.body.rows.some((x: any) => x.minutes === 120), r.body)
r = await eve.post('/api/time/timer/start', { project_id: projId })
check('chronomètre lancé', r.status === 201)
r = await eve.get('/api/me')
check('chronomètre visible', r.body.running?.project_id === projId, r.body.running)
r = await eve.post('/api/time/timer/stop')
check('chronomètre arrêté (1 min au moins)', r.body.minutes >= 1, r.body)
r = await eve.get(`/api/time/report?group=user`)
check('rapport par personne', r.body.length === 2, r.body)
const marcRow = r.body.find((x: any) => x.label === 'Marc Dupont')
check('taux du projet appliqué (150.-/h × 1,5 h)', marcRow?.billable_cents === 22500, marcRow)
r = await eve.get(`/api/time/workload?from=${monday}&weeks=4`)
check('charge de travail', r.status === 200 && r.body.people.length === 2, r.body)
r = await eve.get(`/api/time/export.csv`)
check('export CSV', r.status === 200 && String(r.body).includes('Recherche fournisseurs'))

section('Étapes, point d’avancement, suivi client')
r = await eve.patch(`/api/projects/stages/${stages[0].id}`, { status: 'done', client_note: 'Cahier des charges validé' })
check('étape terminée', r.status === 200)
r = await eve.patch(`/api/projects/stages/${stages[1].id}`, { status: 'in_progress', notify_client: true })
check('changement d’étape avec suivi client', r.body.report?.recipients?.includes('info@favre.ch'), r.body)
r = await eve.post(`/api/projects/${projId}/updates`, { health: 'at_risk', body: 'Délai fournisseur', share_with_client: true })
check('point d’avancement', r.status === 201)
r = await eve.get(`/api/projects/${projId}/client-report`)
check('aperçu du suivi : étapes et destinataires', r.body.text.includes('Cadrage : Terminée') && r.body.recipients.length === 2, r.body)
r = await eve.post(`/api/projects/${projId}/client-report`, { message: 'Petit point de la semaine.' })
check('suivi envoyé', r.status === 200 && r.body.recipients.length === 2, r.body)
const sent = (await pool.query(`select * from sent_emails where account_id = $1 and subject like 'Suivi du projet%' order by created_at desc`, [accountId])).rows
check('suivi journalisé (sans SMTP)', sent.length >= 2 && sent[0].body.includes('Petit point de la semaine'), sent.length)
r = await eve.get(`/api/projects/${projId}`)
const portalToken = r.body.portal_token
check('santé du projet mise à jour', r.body.health === 'at_risk')
r = await new Client().get(`/api/public/portal/${portalToken}`)
check('page de suivi fermée par défaut', r.status === 404)
await eve.patch(`/api/projects/${projId}`, { portal_enabled: true, portal_show_tasks: true })
await eve.patch(`/api/tasks/${piecesId}`, { visible_to_client: true })
r = await new Client().get(`/api/public/portal/${portalToken}`)
check('page de suivi ouverte : étapes, avancement', r.status === 200 && r.body.stages.length === 4 && r.body.progress === 25, r.body)
check('page de suivi : tâches visibles seulement', r.body.tasks.length === 1, r.body.tasks)
check('page de suivi : rien d’interne', !JSON.stringify(r.body).includes('portal_token') && !r.body._id)
r = await new Client().post(`/api/public/portal/${portalToken}/message`, { name: 'Paul', email: 'paul@favre.ch', body: 'Merci, quand la livraison ?' })
check('message du client', r.status === 201, r.body)
r = await eve.get('/api/notifications')
check('responsable prévenu du message client', r.body.some((n: any) => n.kind === 'client_message'))
const fd = new FormData()
fd.append('file', new Blob(['plan']), 'plan.pdf')
r = await eve.req('POST', `/api/projects/${projId}/files`, fd)
check('fichier déposé', r.status === 201, r.body)
await eve.patch(`/api/projects/files/${r.body.id}`, { visible_to_client: true })
r = await new Client().get(`/api/public/portal/${portalToken}`)
check('fichier partagé visible du client', r.body.files.length === 1)

section('Envoi par Resend')
const resendGot: any[] = []
const resendSrv = createServer(async (req, res) => {
  const b = await readBody(req)
  resendGot.push({ auth: req.headers.authorization, ...b })
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 're_test' }))
})
const resendPort = await listen(resendSrv)
process.env.RESEND_API_KEY = 're_test_key'
process.env.RESEND_API_URL = `http://127.0.0.1:${resendPort}/emails`
r = await eve.post(`/api/projects/${projId}/client-report`, { message: 'Par Resend.' })
check('suivi envoyé par Resend', r.status === 200 && r.body.via === 'resend', r.body)
check('Resend : clé, expéditeur, destinataires, HTML', resendGot[0]?.auth === 'Bearer re_test_key' && /via ProjectLead </.test(resendGot[0]?.from)
  && resendGot[0]?.to?.includes('info@favre.ch') && resendGot[0]?.html?.includes('Avancement'), resendGot[0])
delete process.env.RESEND_API_KEY; delete process.env.RESEND_API_URL
resendSrv.close()

section('Automatisations')
r = await eve.post('/api/automations', { name: 'Clore l’étape', trigger: 'task_completed', action: 'complete_stage', project_id: projId })
check('règle créée', r.status === 201)
r = await eve.get(`/api/tasks?project=${projId}&stage=${stages[3].id}`)
for (const t of r.body) await eve.patch(`/api/tasks/${t.id}`, { completed: true })
r = await eve.get(`/api/projects/${projId}`)
check('dernière tâche terminée → étape terminée', r.body.stages[3].status === 'done', r.body.stages[3])
r = await marc.post('/api/automations', { name: 'x', trigger: 'task_created', action: 'notify' })
check('un membre ne crée pas de règle → 403', r.status === 403)

section('Agenda et rendez-vous')
const start = `${addDays(today, 1)}T08:00:00.000Z`
r = await eve.post('/api/calendar/events', { title: 'Réunion de chantier', starts_at: start, ends_at: `${addDays(today, 1)}T09:00:00.000Z`,
  project_id: projId, attendee_user_ids: [marcId], attendee_emails: ['paul@favre.ch'], send_invites: true })
check('réunion créée avec invitation', r.status === 201, r.body)
r = await marc.get(`/api/calendar/events?from=${today}&to=${addDays(today, 7)}`)
check('agenda de Marc : réunion et échéances', r.body.events.length === 1, r.body)
const me = (await eve.get('/api/me')).body
r = await new Client().get(new URL(me.icalUrl).pathname)
check('flux iCalendar personnel', r.status === 200 && String(r.body).includes('BEGIN:VCALENDAR') && String(r.body).includes('Réunion de chantier'))
r = await eve.post('/api/booking', { slug: `decouverte-${stamp}`, name: 'Appel découverte', duration_minutes: 30, min_notice_hours: 0, max_days_ahead: 14,
  availability: { 1: [['08:00', '18:00']], 2: [['08:00', '18:00']], 3: [['08:00', '18:00']], 4: [['08:00', '18:00']], 5: [['08:00', '18:00']], 6: [['08:00', '18:00']], 7: [['08:00', '18:00']] },
  host_ids: [eveId, marcId], create_project: true })
check('type de rendez-vous créé', r.status === 201, r.body)
r = await new Client().get(`/api/public/booking/decouverte-${stamp}?from=${addDays(today, 1)}&days=2`)
const firstSlot = r.body.slots?.[0]?.times?.[0]
check('créneaux publics', r.status === 200 && Boolean(firstSlot), r.body)
r = await new Client().post(`/api/public/booking/decouverte-${stamp}`, { starts_at: firstSlot.start, name: 'Nina Weber', email: 'nina@weber.ch', company: 'Weber Sàrl' })
check('rendez-vous pris', r.status === 201 && r.body.manage_url, r.body)
const manageToken = r.body.manage_url.split('/').pop()
r = await new Client().post(`/api/public/booking/decouverte-${stamp}`, { starts_at: firstSlot.start, name: 'Autre', email: 'a@b.ch' })
r = await new Client().post(`/api/public/booking/decouverte-${stamp}`, { starts_at: firstSlot.start, name: 'Troisième', email: 'c@d.ch' })
check('créneau plein pour les deux hôtes → 409', r.status === 409, r.body)
r = await eve.get('/api/projects?status=lead')
check('le rendez-vous a ouvert un projet', r.body.some((p: any) => p.source === 'booking' && p.client_name === 'Weber Sàrl'), r.body.map((p: any) => p.name))
r = await new Client().post(`/api/public/booking/manage/${manageToken}/cancel`)
check('annulation par le client', r.status === 200, r.body)
const conf = (await pool.query(`select * from sent_emails where account_id = $1 and to_emails @> array['nina@weber.ch']`, [accountId])).rows
check('confirmation envoyée au client', conf.length === 1)

section('Emails : capture et boîte de réception')
r = await new Client().req('POST', `/api/inbound/${inboundToken}`, { from: 'Julie Martin <julie@martin-archi.ch>', to: ['x@in.projectlead.io'],
  subject: 'Rénovation de nos bureaux', text: 'Bonjour, nous cherchons…', message_id: `<m1-${stamp}@martin-archi.ch>` })
check('email capturé', r.status === 201, r.body)
r = await new Client().req('POST', `/api/inbound/${inboundToken}`, { from: 'Julie Martin <julie@martin-archi.ch>', subject: 'Rénovation de nos bureaux', text: 'x', message_id: `<m1-${stamp}@martin-archi.ch>` })
check('même message → pas de doublon', r.status === 200 && r.body.status === 'dup', r.body)
r = await eve.get('/api/mail/inbox')
const juliaMsg = r.body.find((m: any) => m.from_email === 'julie@martin-archi.ch')
check('dans la boîte « À trier »', Boolean(juliaMsg), r.body)
r = await eve.post(`/api/mail/messages/${juliaMsg.id}/project`, {})
check('email → nouveau projet', r.status === 201, r.body)
const fromMail = r.body.id
r = await eve.get(`/api/projects/${fromMail}`)
check('projet : client créé depuis l’expéditeur, description reprise', r.body.client?.email === 'julie@martin-archi.ch' && r.body.description.includes('nous cherchons') && r.body.client.name === 'Martin-archi', r.body.client)
r = await eve.get(`/api/tasks?project=${fromMail}`)
check('première tâche « Répondre à … »', r.body[0]?.title.startsWith('Répondre à Julie Martin'), r.body)
r = await new Client().req('POST', `/api/inbound/${inboundToken}`, { from: 'julie@martin-archi.ch', subject: 'Plans joints', text: 'Voici les plans', message_id: `<m2-${stamp}@martin-archi.ch>` })
r = await eve.get(`/api/projects/${fromMail}/emails`)
check('email suivant d’un client connu → rattaché au projet', r.body.length === 2, r.body.map((m: any) => m.subject))
r = await new Client().req('POST', `/api/inbound/${inboundToken}`, { from: 'pub@spam.ch', subject: 'Offre', text: 'x', message_id: `<m3-${stamp}@spam.ch>` })
r = await eve.get('/api/mail/inbox')
const spam = r.body.find((m: any) => m.from_email === 'pub@spam.ch')
await eve.post(`/api/mail/messages/${spam.id}/status`, { status: 'ignored' })
r = await eve.get('/api/mail/inbox')
check('email écarté', !r.body.some((m: any) => m.id === spam.id))
r = await new Client().req('POST', `/api/inbound/${inboundToken}`, { from: 'paul@favre.ch', subject: 'Question', text: 'Une question', message_id: `<m4-${stamp}@favre.ch>` })
r = await eve.get(`/api/projects/${projId}/emails`)
check('email d’un contact client → projet en cours du client', r.body.some((m: any) => m.subject === 'Question'), r.body)
r = await eve.post(`/api/projects/${projId}/emails`, { to: ['paul@favre.ch'], subject: 'Réponse', body: 'Voici la réponse' })
check('email envoyé depuis le projet', r.status === 200, r.body)

section('Formulaire de demande')
r = await eve.post('/api/forms', { slug: `demande-${stamp}`, name: 'Demande de devis', template_id: tplId })
check('formulaire créé', r.status === 201)
r = await new Client().post(`/api/public/forms/demande-${stamp}`, { name: 'Léo', email: 'leo@exemple.ch', subject: 'Nouvelle cuisine', message: 'Bonjour' })
check('demande reçue', r.status === 201, r.body)
r = await eve.get(`/api/projects/${r.body.id}`)
check('la demande ouvre un projet avec les étapes du modèle', r.body.status === 'lead' && r.body.stages.length === 4, r.body)

section('CRMlead : adresses')
r = await eve.put('/api/integrations/crmlead', { url: `http://127.0.0.1:${crmPort}`, key: 'crm_faux' })
check('clé CRMlead fausse refusée', r.status === 502 && r.body.error === 'crmlead_key_invalid', r.body)
r = await eve.put('/api/integrations/crmlead', { url: `http://127.0.0.1:${crmPort}`, key: 'crm_test' })
check('CRMlead branché', r.status === 200, r.body)
r = await eve.get('/api/clients/crmlead/search?q=rochat')
check('recherche dans CRMlead', r.body[0]?.company === 'Boulangerie Rochat SA' && r.body[0].imported === false, r.body)
r = await eve.post('/api/clients/crmlead/import', { leadId: 'lead-42' })
check('client repris de CRMlead', r.status === 201, r.body)
const rochatId = r.body.id
r = await eve.get(`/api/clients/${rochatId}`)
check('adresse découpée (rue, numéro, NPA, localité)', r.body.street === 'Rue de Bourg' && r.body.building_number === '12' && r.body.postal_code === '1003' && r.body.town === 'Lausanne', r.body)
check('contacts repris', r.body.contacts.length === 1 && r.body.contacts[0].email === 'lea@rochat.ch', r.body.contacts)
r = await eve.post('/api/clients/crmlead/import', { leadId: 'lead-42' })
check('reprise répétée → même client', r.body.id === rochatId)

section('InvoiceLead : facturation mensuelle')
r = await eve.put('/api/integrations/invoicelead', { url: `http://127.0.0.1:${ilPort}`, key: 'il_live_test', invoice_language: 'fr' })
check('InvoiceLead branché', r.status === 200, r.body)
const period = today.slice(0, 7)
r = await eve.post('/api/projects', { name: 'Maintenance site', client_id: rochatId, billing_mode: 'retainer', retainer_cents: 50000 })
const retainerId = r.body.id
r = await eve.post('/api/projects', { name: 'Livraison par étapes', client_id: rochatId, billing_mode: 'milestone' })
const msId = r.body.id
r = await eve.post(`/api/projects/${msId}/stages`, { name: 'Maquettes', billing_cents: 300000 })
await eve.patch(`/api/projects/stages/${r.body.id}`, { status: 'done' })
r = await eve.get(`/api/integrations/billing/preview?period=${period}`)
const pv = Object.fromEntries(r.body.projects.map((p: any) => [p.project.id, p]))
check('aperçu : heures du mois (Marc 1,5 h à 150.-)', pv[projId]?.lines.some((l: any) => l.quantity === 1.5 && l.unitPriceCents === 15000), pv[projId])
check('aperçu : forfait mensuel', pv[retainerId]?.total_cents === 50000, pv[retainerId])
check('aperçu : étape livrée', pv[msId]?.total_cents === 300000, pv[msId])
r = await marc.post('/api/integrations/billing/run', { period })
check('un membre ne lance pas la facturation → 403', r.status === 403)
r = await eve.post('/api/integrations/billing/run', { period })
const res = Object.fromEntries(r.body.results.map((x: any) => [x.projectId, x]))
check('brouillons créés dans InvoiceLead', res[projId]?.status === 'created' && res[retainerId]?.status === 'created' && res[msId]?.status === 'created', r.body)
check('le projet sans client est en erreur, pas facturé', r.body.results.filter((x: any) => x.status === 'error').every((x: any) => x.error === 'client_missing'), r.body.results)
check('contact créé une seule fois chez InvoiceLead', ilContacts.filter((c) => c.name === 'Boulangerie Rochat SA').length === 1 && ilContacts.length === 2, ilContacts.map((c) => c.name))
const favreInv = ilInvoices.find((i) => i.title.includes('Atelier mécanique'))
check('facture : lignes en heures, prix en unités', favreInv?.lines.some((l: any) => l.unit === 'hour' && l.quantity === '1.50' && l.unitPrice === '150.00'), favreInv)
r = await eve.get(`/api/time/entries?project=${projId}&user=all`)
check('temps facturé marqué', r.body.filter((e: any) => e.billable).every((e: any) => e.invoiced_at), r.body.map((e: any) => e.invoiced_at))
const n = ilInvoices.length
r = await eve.post('/api/integrations/billing/run', { period })
check('relancer le même mois ne refacture rien', ilInvoices.length === n && r.body.results.filter((x: any) => x.status === 'created').length === 0, r.body.results)
r = await marc.patch(`/api/time/entries/${(await marc.get(`/api/time/entries?project=${projId}`)).body[0].id}`, { minutes: 10 })
check('temps facturé non modifiable → 409', r.status === 409, r.body)

section('InvoiceLead : contacts repris comme clients')
ilContacts.push({ id: randomUUID(), kind: 'company', name: 'Garage Muller SA', email: 'info@muller.ch', street: 'Rue du Lac',
  buildingNumber: '12', postalCode: '1800', town: 'Vevey', country: 'CH', language: 'fr', isCustomer: true },
  { id: randomUUID(), kind: 'company', name: 'Fournisseur Papier', isCustomer: false, isSupplier: true })
r = await eve.get('/api/clients/invoicelead/search?q=')
const muller = r.body.find?.((x: any) => x.name === 'Garage Muller SA')
check('recherche : clients seulement, déjà repris signalés', muller && !muller.imported && muller.address === 'Rue du Lac 12, 1800 Vevey'
  && !r.body.some((x: any) => x.name === 'Fournisseur Papier') && r.body.some((x: any) => x.name === 'Boulangerie Rochat SA' && x.imported), r.body)
r = await eve.post('/api/clients/invoicelead/import', { contactId: muller.id })
const mullerClient = (await eve.get(`/api/clients/${r.body.id}`)).body
check('contact repris : adresse et lien InvoiceLead', r.status === 201 && mullerClient.town === 'Vevey' && mullerClient.building_number === '12'
  && mullerClient.invoicelead_contact_id === muller.id, mullerClient)
const clientsBefore = (await eve.get('/api/clients')).body.length
r = await eve.post('/api/clients/invoicelead/import', { all: true })
check('tout reprendre ne crée pas de doublon', r.status === 201 && (await eve.get('/api/clients')).body.length === clientsBefore, { clientsBefore, r: r.body })
r = await marc.post('/api/clients/invoicelead/import', { contactId: 'inconnu' })
check('contact inconnu → 404', r.status === 404, r.body)

section('Échange Compte Lead : affaire gagnée dans CRMlead')
await pool.query(`update accounts set lead_org = $2 where id = $1`, [accountId, `org-${stamp}`])
const envelope = { id: randomUUID(), type: 'deal', org: `org-${stamp}`, occurred_at: new Date().toISOString(),
  source: { app: 'crmlead', id: `lead-${stamp}`, url: 'https://crmlead.io/leads/x' },
  data: { title: 'Nouvelle boutique', company: 'Fleurs Blanc', amount: 800000, currency: 'CHF', contacts: [{ first_name: 'Anne', last_name: 'Blanc', email: 'anne@blanc.ch' }] } }
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', envelope, { authorization: 'Bearer faux' })
check('jeton invalide → 401', r.status === 401)
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', envelope, { authorization: `Bearer ${exchangeJwt()}` })
check('affaire reçue → projet créé', r.status === 201 && r.body.status === 'created', r.body)
const dealProject = r.body.id
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', { ...envelope, data: { ...envelope.data, title: 'Nouvelle boutique (v2)' } }, { authorization: `Bearer ${exchangeJwt()}` })
check('renvoi → même projet, mis à jour', r.status === 200 && r.body.id === dealProject, r.body)
r = await eve.get(`/api/projects/${dealProject}`)
check('projet : nom à jour, budget, client et contact', r.body.name === 'Nouvelle boutique (v2)' && r.body.budget_cents === 800000 && r.body.client?.name === 'Fleurs Blanc' && r.body.contacts.length === 1, r.body)
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', { ...envelope, source: { ...envelope.source, app: 'scanlead' } }, { authorization: `Bearer ${exchangeJwt()}` })
check('expéditeur usurpé → 403', r.status === 403)
r = await new Client().get('/.well-known/lead-app.json')
check('carte de visite de l’application', r.body.app === 'projectlead' && r.body.exchange.accepts.includes('deal'))

section('Isolation des entreprises (RLS)')
const other = new Client()
await other.post('/api/auth/signup', { name: 'Autre', email: `autre-${stamp}@exemple.test`, password: 'motdepasse-solide', company: 'Autre SA' })
r = await other.get(`/api/projects/${projId}`)
check('projet d’une autre entreprise → 404', r.status === 404, r.body)
r = await other.get('/api/clients')
check('clients d’une autre entreprise invisibles', r.body.length === 0, r.body)
r = await other.patch(`/api/tasks/${piecesId}`, { title: 'piraté' })
check('tâche d’une autre entreprise non modifiable', r.status === 404, r.body)
r = await other.get(`/api/tasks?project=${projId}`)
check('tâches d’une autre entreprise invisibles', r.body.length === 0)
r = await other.post('/api/tasks', { project_id: projId, title: 'intrus' })
check('créer dans le projet d’une autre entreprise → 404', r.status === 404, r.body)
await eve.patch(`/api/projects/${fromMail}`, { visibility: 'members' })
await eve.del(`/api/projects/${fromMail}/members/${marcId}`)
r = await marc.get(`/api/projects/${fromMail}`)
check('projet réservé aux intervenants invisible pour un non-membre', r.status === 404, r.status)
const hiddenTask = (await eve.get(`/api/tasks?project=${fromMail}`)).body[0].id
r = await marc.patch(`/api/tasks/${hiddenTask}`, { title: 'vu' })
check('tâche d’un projet réservé non modifiable par un non-membre', r.status === 404, r.body)
r = await marc.post(`/api/tasks/${hiddenTask}/comments`, { body: 'vu' })
check('ni commentable', r.status === 404, r.body)

section('API publique')
r = await eve.post('/api/api-keys', { name: 'Make' })
const key = r.body.key
r = await new Client().req('GET', '/api/v1/projects', undefined, { authorization: `Bearer ${key}` })
check('API v1 : projets', r.status === 200 && r.body.data.length >= 3, r.body)
r = await new Client().req('POST', '/api/v1/tasks', { project_id: projId, title: 'Depuis Make' }, { authorization: `Bearer ${key}` })
check('API v1 : tâche créée', r.status === 201)
r = await new Client().req('GET', '/api/v1/projects', undefined, { authorization: 'Bearer pl_faux' })
check('API v1 : clé inconnue → 401', r.status === 401)

section('Accueil, recherche, tâches de fond')
r = await marc.get('/api/dashboard')
check('tableau de bord', r.status === 200 && Array.isArray(r.body.myTasks) && r.body.counts.active >= 1, r.body.counts)
r = await eve.get('/api/search?q=pièces')
check('recherche globale', r.body.tasks.length >= 1, r.body)
await pool.query(`update projects set last_update_sent_at = now() - interval '8 days' where id = $1`, [projId])
const before = (await pool.query(`select count(*)::int as n from client_reports where project_id = $1`, [projId])).rows[0].n
const jobs = await runJobs(true)
const after = (await pool.query(`select count(*)::int as n from client_reports where project_id = $1 and automatic`, [projId])).rows[0].n
check('suivi hebdomadaire automatique envoyé', after >= 1 && (jobs as any).clientUpdates >= 1, { before, after, jobs })

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
crm.close(); il.close(); issuerSrv.close()
await pool.end()
process.exit(ko ? 1 : 0)
