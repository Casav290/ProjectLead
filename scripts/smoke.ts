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
// Ce que le faux Compte Lead mettra dans le prochain jeton d'identité (connexion de bout en bout).
let nextIdClaims: Record<string, unknown> = {}
// Et ce qu'il répond quand une application relit les droits d'une organisation.
const entitlementsByOrg: Record<string, unknown> = {}
// Les abonnements que ProjectLead lui déclare (POST /api/lead-id/v1/subscriptions), et une panne simulée.
const declared: any[] = []
let issuerDown = false
const issuerSrv = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/oauth/jwks') return res.end(JSON.stringify({ keys: [jwk] }))
  if (req.url === '/api/lead-id/v1/subscriptions' && req.method === 'POST') {
    if (issuerDown) { res.statusCode = 503; return res.end('{"error":"unavailable"}') }
    if (req.headers.authorization !== 'Bearer a') { res.statusCode = 401; return res.end('{"error":"invalid_token"}') }
    const b = await readBody(req)
    declared.push(b)
    // Comme ERPlead : la formule de l'application qui déclare, d'après ses abonnements (statuts qui ouvrent la formule).
    const live = ['active', 'trialing', 'past_due'].includes(b.status)
    const code = live ? b.plan : 'free'
    const until = live && b.current_period_end ? new Date(Date.parse(b.current_period_end) + 3 * 86400e3).toISOString() : null
    const out = { org: b.org, ...rights(code, { valid_until: until }) }
    entitlementsByOrg[b.org] = out
    return res.end(JSON.stringify(out))
  }
  if (req.url?.startsWith('/api/lead-id/v1/entitlements')) {
    const org = new URL(req.url, 'http://x').searchParams.get('org') ?? ''
    if (!entitlementsByOrg[org] || req.headers.authorization !== 'Bearer a') { res.statusCode = 404; return res.end('{"error":"org_not_found"}') }
    return res.end(JSON.stringify({ org, ...(entitlementsByOrg[org] as object) }))
  }
  if (req.url === '/oauth/token' && req.method === 'POST') {
    const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
    const p = b64({ iss: process.env.LEAD_ID_ISSUER, aud: 'projectlead', exp: Math.floor(Date.now() / 1000) + 300, ...nextIdClaims })
    const idToken = `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`
    return res.end(JSON.stringify({ id_token: idToken, access_token: 'a', token_type: 'Bearer', expires_in: 300 }))
  }
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

section('Tâches planifiées : jeton enregistré en base')
const taskToken = `tache-${stamp}-${randomUUID()}`
await pool.query(`insert into task_tokens (token_hash, label) values (encode(sha256($1::bytea), 'hex'), 'contrôle')`, [taskToken])
r = await new Client().req('POST', '/api/tasks/run', {}, { authorization: `Bearer ${taskToken}` })
check('jeton connu → tâches lancées', r.status === 200 && typeof r.body === 'object', r)
r = await new Client().req('POST', '/api/tasks/run', {}, { authorization: `Bearer ${taskToken}x` })
check('jeton inconnu → 401', r.status === 401)
r = await pool.query('select last_used_at from task_tokens where token_hash = encode(sha256($1::bytea), \'hex\')', [taskToken])
check('dernier usage noté', r.rows[0]?.last_used_at !== null, r.rows)

section('Secrets du serveur posés par le jeton d’exploitation')
r = await new Client().req('PUT', '/api/ops/secrets/GLM_API_KEY', { value: 'cle-ia-de-controle-123' })
check('sans jeton → 401', r.status === 401)
r = await new Client().req('PUT', '/api/ops/secrets/AUTRE', { value: 'x'.repeat(20) }, { authorization: `Bearer ${taskToken}` })
check('nom inconnu → 404', r.status === 404)
const glmBefore = process.env.GLM_API_KEY
r = await new Client().req('PUT', '/api/ops/secrets/GLM_API_KEY', { value: 'cle-ia-de-controle-123' }, { authorization: `Bearer ${taskToken}` })
const stored = (await pool.query(`select value_enc from server_secrets where name = 'GLM_API_KEY'`)).rows[0]?.value_enc ?? ''
check('clé IA posée : chiffrée en base, lue par le serveur', r.status === 200 && stored.startsWith('v1.') && !stored.includes('cle-ia-de-controle')
  && process.env.GLM_API_KEY === 'cle-ia-de-controle-123', { status: r.status })
r = await new Client().req('DELETE', '/api/ops/secrets/GLM_API_KEY', undefined, { authorization: `Bearer ${taskToken}` })
check('clé IA retirée', r.status === 200 && !process.env.GLM_API_KEY && !(await pool.query(`select 1 from server_secrets`)).rowCount)
if (glmBefore) process.env.GLM_API_KEY = glmBefore

section('File « À trier » : 30 jours au plus')
await pool.query(`insert into email_messages (account_id, message_id, from_email, subject, received_at) values
  ($1, $2, 'vieux@exemple.test', 'Ancien', now() - interval '31 days'), ($1, $3, 'recent@exemple.test', 'Récent', now() - interval '2 days')`,
  [accountId, `triage:x:vieux-${stamp}`, `triage:x:recent-${stamp}`])
const { purgeTriage } = await import('../server/lib/jobs.js')
await purgeTriage()
r = await pool.query('select subject from email_messages where message_id = any($1)', [[`triage:x:vieux-${stamp}`, `triage:x:recent-${stamp}`]])
check('entrée de plus de 30 jours effacée, la récente gardée', r.rows.length === 1 && r.rows[0].subject === 'Récent', r.rows)

section('Connexion par le Compte Lead, de bout en bout')
const { refreshLeadPlans } = await import('../server/lib/jobs.js')
process.env.LEAD_ID_CLIENT_ID = 'projectlead'
process.env.LEAD_ID_CLIENT_SECRET = 'lid_essai'
process.env.LEAD_ID_REDIRECT_URI = 'http://localhost/auth/lead/callback'
r = await new Client().post('/api/auth/signup', { name: 'X', email: `x-${stamp}@exemple.test`, password: 'motdepasse-solide', company: 'X' })
check('Compte Lead branché : pas d’inscription locale', r.status === 403 && r.body.error === 'signup_via_lead', r.body)
r = await new Client().get('/api/auth/options')
check('options : Compte Lead annoncé', r.body.leadId === true, r.body)
/** Départ, passage chez le faux Compte Lead, retour : rend la redirection finale et le cookie de session. */
async function leadLogin(claims: (nonce: string) => Record<string, unknown>, query = '') {
  const start = await app.request(`http://localhost/auth/lead/start${query}`)
  const to = new URL(start.headers.get('location') ?? 'http://x/')
  const jar = (start.headers.get('set-cookie') ?? '').match(/pl_lead_login=[^;]+/)?.[0] ?? ''
  nextIdClaims = claims(to.searchParams.get('nonce') ?? '')
  const back = await app.request(`http://localhost/auth/lead/callback?code=c&state=${to.searchParams.get('state')}`, { headers: { cookie: jar } })
  const session = (back.headers.get('set-cookie') ?? '').match(/projectlead_session=[^;]+/)?.[0] ?? ''
  return { authorize: to, location: back.headers.get('location'), session, cookies: back.headers.getSetCookie().length }
}
// Les droits tels qu'ERPlead les calcule depuis le 13.10.2026 : une formule PAR application (`plan` = celle de
// ProjectLead, l'application qui demande), son origine (own, family, free) et sa date de validité.
const PLAN_NAMES: Record<string, [string, number, number]> = { free: ['Gratuit', 0, 1], pro: ['Pro', 10, 1], pro_plus: ['Pro+', 20, 5] }
const leadPlan = (code: string, extra: Record<string, unknown> = {}) => ({ code, name: PLAN_NAMES[code][0], rank: PLAN_NAMES[code][1],
  seats: PLAN_NAMES[code][2], source: code === 'free' ? 'free' : 'own', valid_until: null, ...extra })
const rights = (code: string, extra: Record<string, unknown> = {}, apps: Record<string, unknown> = {}, subscriptions: unknown[] = []) => ({
  app: 'projectlead', plan: leadPlan(code, extra),
  apps: { projectlead: { access: true, name: 'ProjectLead', url: null, status: 'live', upgrade_url: 'https://projectlead.io/reglages/entreprise', plan: leadPlan(code, extra) }, ...apps },
  subscriptions, org_seats: PLAN_NAMES[code][2],
})
const lead = (nonce: string, access: boolean, org = `lead-org-${stamp}`) => ({
  sub: `sub-${org}`, nonce, email: `${org}@exemple.test`, email_verified: true, name: 'Léa Lead', locale: 'fr',
  org, org_name: `Entreprise ${org}`, org_role: 'admin',
  lead: rights(access ? 'pro' : 'free'),
})
let ll = await leadLogin((n) => lead(n, true), '?next=/projets')
check('départ : vers /oauth/authorize du Compte Lead, client projectlead', ll.authorize.pathname === '/oauth/authorize' && ll.authorize.searchParams.get('client_id') === 'projectlead' && !ll.authorize.searchParams.has('prompt'), ll.authorize.href)
check('formule Pro : session ouverte, retour à la page demandée', ll.location === '/projets' && ll.session.length > 30, ll)
{
  // Le retour d'ERPlead arrive sur l'adresse sans www : un départ depuis www y est renvoyé avant de poser son cookie.
  const w = await app.request('http://www.localhost/auth/lead/start?next=/projets&signup=1')
  check('départ depuis www : renvoyé vers l’adresse du retour, sans cookie posé sur www',
    w.status === 302 && w.headers.get('location') === 'http://localhost/auth/lead/start?next=/projets&signup=1' && !w.headers.get('set-cookie'),
    { status: w.status, location: w.headers.get('location'), cookie: Boolean(w.headers.get('set-cookie')) })
}
// Neon Functions ne garde que le dernier Set-Cookie d'une réponse : au retour, la session doit être le seul cookie.
check('retour du Compte Lead : un seul cookie posé, celui de la session', ll.cookies === 1, ll)
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
check('l’entreprise Lead devient l’espace ProjectLead', r.status === 200 && r.body.account?.name === `Entreprise lead-org-${stamp}`, r.body)
const proSession = ll.session
{
  const out = await app.request('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie: ll.session } })
  const body: any = await out.json()
  check('déconnexion : un seul cookie, et la session du Compte Lead se ferme aussi (id_token_hint)',
    out.headers.getSetCookie().length === 1 && String(body.redirect ?? '').includes('/oauth/logout?') && String(body.redirect).includes('id_token_hint='), body)
}
ll = await leadLogin((n) => lead(n, true), '?next=/projets')
const freeOrg = `free-org-${stamp}`
ll = await leadLogin((n) => lead(n, false, freeOrg), '?next=/projets')
check('formule gratuite : on entre quand même (règle d’Ève du 02.10)', ll.location === '/projets' && ll.session.length > 30, ll)
const free = new Client(); free.cookie = ll.session
r = await free.get('/api/me')
check('formule gratuite : espace créé, formule notée « Gratuit », 3 projets en cours, 1 personne, « Passer à Pro » vers sa propre page',
  r.status === 200 && r.body.plan?.linked && r.body.plan.tier === 'free' && r.body.plan.projectLimit === 3 && r.body.plan.seats === 1
  && r.body.plan.upgradeUrl === '/reglages/entreprise', r.body.plan)
const freeProjects: string[] = []
for (const n of [1, 2, 3]) freeProjects.push((await free.post('/api/projects', { name: `Projet gratuit ${n}` })).body.id)
check('gratuit : trois projets en cours', freeProjects.every(Boolean), freeProjects)
r = await free.post('/api/projects', { name: 'Projet de trop' })
check('gratuit : le quatrième est refusé (402), avec la limite et le lien vers la page Formule de ProjectLead',
  r.status === 402 && r.body.error === 'plan_limit_projects' && r.body.limit === 3
  && r.body.upgrade_url === `${process.env.PUBLIC_URL}/reglages/entreprise`, r)
r = await free.post('/api/projects', { name: 'Demande', status: 'lead' })
check('gratuit : une demande à qualifier ne compte pas', r.status === 201, r)
const freeLead = r.body.id
r = await free.post('/api/projects', { name: 'Modèle maison', is_template: true })
check('gratuit : un modèle ne compte pas', r.status === 201, r)
r = await free.patch(`/api/projects/${freeLead}`, { status: 'active' })
check('gratuit : passer une demande en cours, formule pleine → 402', r.status === 402 && r.body.error === 'plan_limit_projects', r)
r = await free.patch(`/api/projects/${freeProjects[0]}`, { status: 'done' })
check('gratuit : terminer un projet libère sa place…', r.status === 200, r)
r = await free.patch(`/api/projects/${freeLead}`, { status: 'active' })
check('… et la demande peut passer en cours', r.status === 200, r)
r = await free.patch(`/api/projects/${freeProjects[0]}`, { status: 'active' })
check('gratuit : rouvrir un projet terminé, formule pleine → 402', r.status === 402, r)
r = await free.patch(`/api/projects/${freeProjects[1]}`, { name: 'Projet gratuit renommé' })
check('gratuit : un projet existant reste modifiable (la limite porte sur les actions, pas sur les données)', r.status === 200, r)
r = await free.del(`/api/projects/${freeProjects[1]}`)
check('gratuit : archiver libère une place', r.status === 200 && (await free.get('/api/me')).body.plan.openProjects === 2, r)
await free.post('/api/projects', { name: 'Projet gratuit 4' })
r = await free.del(`/api/projects/${freeProjects[1]}`)
check('gratuit : désarchiver, formule pleine → 402', r.status === 402 && r.body.error === 'plan_limit_projects', r)
r = await free.post('/api/team/invite', { email: `collegue-${stamp}@exemple.test` })
check('gratuit : 1 personne, une invitation de plus → 402', r.status === 402 && r.body.error === 'plan_limit_seats' && r.body.limit === 1, r)
const freeAcc = (await pool.query('select id from accounts where lead_org = $1', [freeOrg])).rows[0].id
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', { id: randomUUID(), type: 'deal', org: freeOrg, occurred_at: new Date().toISOString(),
  source: { app: 'crmlead', id: `lead-gratuit-${stamp}` }, data: { title: 'Affaire en gratuit', company: 'Client gratuit' } }, { authorization: `Bearer ${exchangeJwt()}` })
const dealStatus = (await pool.query('select status from projects where id = $1', [r.body?.id])).rows[0]?.status
check('gratuit, formule pleine : l’affaire gagnée arrive « à qualifier », rien n’est perdu', r.status === 201 && dealStatus === 'lead', { r: r.body, dealStatus })
void freeAcc
// Relecture contradictoire du 02.10 : chaque contournement trouvé a son contrôle.
r = await free.post('/api/projects', { name: 'Modèle à rouvrir', is_template: true })
const tpl = r.body.id
r = await free.patch(`/api/projects/${tpl}`, { is_template: false })
check('gratuit, formule pleine : un modèle repassé en projet → 402', r.status === 402 && r.body.error === 'plan_limit_projects', r)
r = await free.patch(`/api/projects/${tpl}`, { is_template: false, status: 'active' })
check('… même avec un statut en cours dans la même requête', r.status === 402, r)
ll = await leadLogin((n) => { const c: any = lead(n, true, `sans-portee-${stamp}`); delete c.org; delete c.lead; return c })
r = await pool.query('select count(*)::int as n from users where lower(email) = lower($1)', [`sans-portee-${stamp}@exemple.test`])
check('portée « lead » retirée de l’adresse : connexion refusée, message précis, rien de créé', ll.location === '/login?erreur=portee' && !ll.session && r.rows[0].n === 0, { ll, n: r.rows[0].n })
// Places : une deuxième personne de l'organisation gratuite (1 place) reste dehors, avec un message clair.
ll = await leadLogin((n) => ({ ...lead(n, false, freeOrg), sub: `sub-collegue-${stamp}`, email: `collegue2-${stamp}@exemple.test`, org_role: 'user' }))
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
check('gratuit (1 place) : une deuxième personne de l’organisation entre quand même, dans son propre espace gratuit',
  ll.session.length > 30 && r.status === 200 && r.body.account?.name !== `Entreprise ${freeOrg}` && r.body.plan?.tier === 'free' && r.body.unread >= 1,
  { loc: ll.location, account: r.body.account?.name, plan: r.body.plan, unread: r.body.unread })
// Une adresse pas encore confirmée chez le Compte Lead : un message clair, pas de boucle, rien de créé.
ll = await leadLogin((n) => ({ ...lead(n, false, `non-confirme-${stamp}`), email_verified: false }))
check('adresse pas encore confirmée : écran « confirmez votre adresse », rien de créé', ll.location === '/login?erreur=email' && !ll.session, ll)
// Une personne désactivée dans l'espace de son organisation n'y tourne pas en boucle : elle entre ailleurs.
const annOrg = `ann-org-${stamp}`
const annPlan = rights('pro_plus')
ll = await leadLogin((n) => ({ ...lead(n, true, annOrg), lead: annPlan }))
const annAdmin = new Client(); annAdmin.cookie = ll.session
ll = await leadLogin((n) => ({ ...lead(n, true, annOrg), lead: annPlan, sub: `sub-ann-${stamp}`, email: `ann-${stamp}@exemple.test`, org_role: 'user' }))
const annId = (await pool.query('select id from users where lead_sub = $1', [`sub-ann-${stamp}`])).rows[0]?.id
r = await annAdmin.patch(`/api/team/members/${annId}`, { active: false })
check('l’administrateur désactive Ann', r.status === 200, r)
ll = await leadLogin((n) => ({ ...lead(n, true, annOrg), lead: annPlan, sub: `sub-ann-${stamp}`, email: `ann-${stamp}@exemple.test`, org_role: 'user' }))
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
check('Ann désactivée se reconnecte : session valable dans son propre espace, pas de boucle', r.status === 200 && r.body.account?.name !== `Entreprise ${annOrg}`, { status: r.status, account: r.body?.account?.name })
// Une organisation Pro+ (5 places) et un membre local venu d'une autre organisation, gratuite.
const plusOrg = `plus-org-${stamp}`
const plusLead = (n: string) => ({ ...lead(n, true, plusOrg), lead: rights('pro_plus') })
ll = await leadLogin(plusLead)
const plus = new Client(); plus.cookie = ll.session
r = await plus.post('/api/team/invite', { email: `paul-${stamp}@exemple.test` })
check('Pro+ : inviter passe', r.status === 201 || r.status === 200, r)
const paulToken = String(r.body.link ?? '').split('/').pop()
r = await new Client().post(`/api/auth/invitation/${paulToken}/accept`, { name: 'Paul', password: 'motdepasse-solide' })
check('Pro+ : Paul accepte l’invitation', r.status === 200, r)
ll = await leadLogin((n) => ({ ...lead(n, false, `paul-org-${stamp}`), sub: `sub-paul-${stamp}`, email: `paul-${stamp}@exemple.test`, org_role: 'admin' }))
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
const plusPlan = (await pool.query('select plan from accounts where lead_org = $1', [plusOrg])).rows[0]?.plan
check('membre venu d’une organisation gratuite : il entre dans l’entreprise Pro+, dont la formule reste Pro+',
  r.status === 200 && r.body.plan?.tier === 'pro_plus' && plusPlan === 'pro_plus', { plan: r.body.plan, plusPlan })
// Une entreprise d'avant le Compte Lead ne se lie pas à l'organisation personnelle d'un simple membre.
const localAcc = (await pool.query(`insert into accounts (name) values ('Atelier local ${stamp}') returning id`)).rows[0].id
const localAdmin = (await pool.query(`insert into users (email, name) values ($1, 'Admin local') returning id`, [`admin-local-${stamp}@exemple.test`])).rows[0].id
const localMember = (await pool.query(`insert into users (email, name) values ($1, 'Marc local') returning id`, [`marc-local-${stamp}@exemple.test`])).rows[0].id
await pool.query(`insert into account_users (account_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'member')`, [localAcc, localAdmin, localMember])
ll = await leadLogin((n) => ({ ...lead(n, false, `marc-org-${stamp}`), sub: `sub-marc-local-${stamp}`, email: `marc-local-${stamp}@exemple.test`, org_role: 'admin' }))
r = await pool.query('select lead_org, plan from accounts where id = $1', [localAcc])
check('entreprise locale : un simple membre ne la lie pas à son organisation gratuite (et elle naît en Gratuit, plus en Pro)',
  ll.session.length > 30 && r.rows[0].lead_org === null && r.rows[0].plan === 'free', { row: r.rows[0], loc: ll.location })
// Une invitation en attente quand la formule baisse : son acceptation est refusée, puis une réactivation aussi.
r = await plus.post('/api/team/invite', { email: `yves-${stamp}@exemple.test` })
const yvesToken = String(r.body.link ?? '').split('/').pop()
entitlementsByOrg[plusOrg] = rights('free')
await refreshLeadPlans()
r = await new Client().post(`/api/auth/invitation/${yvesToken}/accept`, { name: 'Yves', password: 'motdepasse-solide' })
check('formule descendue en gratuit : une ancienne invitation ne fait plus entrer (402)', r.status === 402 && r.body.error === 'plan_limit_seats', r)
const paulId = (await pool.query('select id from users where lower(email) = lower($1)', [`paul-${stamp}@exemple.test`])).rows[0].id
r = await plus.patch(`/api/team/members/${paulId}`, { active: false })
check('désactiver une personne passe', r.status === 200, r)
r = await plus.patch(`/api/team/members/${paulId}`, { active: true })
check('la réactiver quand toutes les places sont prises → 402', r.status === 402 && r.body.error === 'plan_limit_seats', r)
// Course : trois ouvertures simultanées pour une seule place libre, une seule passe.
const raceOrg = `course-org-${stamp}`
ll = await leadLogin((n) => ({ ...lead(n, false, raceOrg), sub: `sub-course-${stamp}`, email: `course-${stamp}@exemple.test` }))
const race = new Client(); race.cookie = ll.session
await race.post('/api/projects', { name: 'Course 1' }); await race.post('/api/projects', { name: 'Course 2' })
const tries = await Promise.all([1, 2, 3].map((n) => race.post('/api/projects', { name: `Course simultanée ${n}` })))
const open = (await race.get('/api/me')).body.plan.openProjects
check('trois créations simultanées pour une place : une seule passe, 3 projets en cours', tries.filter((t) => t.status === 201).length === 1 && open === 3,
  { statuts: tries.map((t) => t.status), open })
// Affaire reçue « à qualifier » faute de place : la notification le dit.
const note = (await pool.query(`select n.title from notifications n join accounts a on a.id = n.account_id where a.lead_org = $1 and n.kind = 'deal' order by n.created_at desc limit 1`, [freeOrg])).rows[0]?.title ?? ''
check('affaire arrivée à qualifier faute de place : la notification l’explique', /à qualifier/.test(note), note)
ll = await leadLogin((n) => lead(n, true), '?signup=1')
check('« Créer un compte » : le Compte Lead ouvre son inscription (prompt=create)', ll.authorize.searchParams.get('prompt') === 'create', ll.authorize.href)
ll = await leadLogin((n) => ({ ...lead(n, true), nonce: 'autre' }))
check('jeton d’un autre départ (nonce) → erreur, pas de session', ll.location === '/login?erreur=lead' && !ll.session, ll)
r = await app.request('http://localhost/auth/lead/callback?code=c&state=x')
check('retour sans départ → erreur de session', r.headers.get('location') === '/login?erreur=session')
// Un abonnement par application (Ève, 13.10.2026) : un Pro+ payé dans CRMlead n'ouvre rien dans ProjectLead.
entitlementsByOrg[freeOrg] = rights('free', {}, { crmlead: { access: true, name: 'CRMlead', plan: leadPlan('pro_plus') } })
let plans = await refreshLeadPlans()
r = await free.get('/api/me')
check('Pro+ pris AILLEURS (CRMlead) : limites inchangées ici, toujours Gratuit', plans.checked >= 1 && r.body.plan.tier === 'free'
  && r.body.plan.projectLimit === 3 && r.body.plan.seats === 1, { plans, plan: r.body.plan })
// Une réponse d'ERPlead calculée pour une autre application (client mal réglé) ne fixe pas la formule ProjectLead.
entitlementsByOrg[freeOrg] = { ...rights('pro_plus'), app: 'crmlead' }
await refreshLeadPlans()
r = await free.get('/api/me')
check('droits calculés pour une autre application (app ≠ projectlead) : ignorés', r.body.plan.tier === 'free', r.body.plan)
// Transition : un abonnement payé ailleurs avant la bascule garde Pro ici jusqu'à sa date figée, sans grâce.
const inheritedUntil = new Date(Date.now() + 3600e3).toISOString()
entitlementsByOrg[freeOrg] = rights('pro', { source: 'family', valid_until: inheritedUntil, from_app: 'crmlead' }, {},
  [{ app: 'crmlead', plan: 'pro', lead_plan: 'pro', status: 'active', current_period_end: inheritedUntil, family_until: inheritedUntil, inherited: true }])
await refreshLeadPlans()
r = await free.get('/api/me')
check('hérité (source family) : Pro jusqu\'à valid_until, abonnement CRMlead nommé, rien de payé ici',
  r.body.plan.tier === 'pro' && r.body.plan.source === 'family' && r.body.plan.paidTier === 'free' && r.body.plan.inherited?.app === 'crmlead'
  && r.body.plan.inherited?.until === inheritedUntil && r.body.plan.projectLimit === null, r.body.plan)
await pool.query(`update accounts set plan_valid_until = now() - interval '1 minute' where lead_org = $1`, [freeOrg])
r = await free.get('/api/me')
check('hérité : date passée → Gratuit aussitôt, sans attendre la relecture du lendemain', r.body.plan.tier === 'free' && r.body.plan.inherited === null
  && r.body.plan.projectLimit === 3, r.body.plan)
entitlementsByOrg[freeOrg] = rights('pro_plus')
plans = await refreshLeadPlans()
r = await free.get('/api/me')
check('formule ProjectLead Pro+ connue d\'ERPlead (abonnement ProjectLead) : limites levées à la relecture', r.body.plan.tier === 'pro_plus'
  && r.body.plan.source === 'own' && r.body.plan.projectLimit === null && r.body.plan.seats === 5, r.body.plan)
r = await free.post('/api/projects', { name: 'Projet en Pro+' })
check('Pro+ : un projet de plus passe', r.status === 201, r)
entitlementsByOrg[freeOrg] = rights('free')
plans = await refreshLeadPlans()
r = await free.get('/api/me')
check('formule résiliée : on garde l’accès en gratuit, rien n’est effacé', r.status === 200 && r.body.plan.tier === 'free'
  && r.body.plan.openProjects > 3, { status: r.status, plan: r.body.plan })
void proSession

section('Départ d’une personne : OpenID Back-Channel Logout')
{
  const org = `bc-org-${stamp}`
  // Forme d'avant le calcul par application (sans `app` ni `source`) : toujours acceptée.
  const plus = { plan: { code: 'pro_plus', name: 'Pro+', rank: 20, seats: 5 }, apps: { projectlead: { access: true, name: 'ProjectLead', url: null, status: 'live', upgrade_url: null } }, subscriptions: [] }
  const person = (n: string, sub: string, role: string) => ({ sub, nonce: n, email: `${sub}@exemple.test`, email_verified: true, name: sub, locale: 'fr', org, org_name: `Entreprise ${org}`, org_role: role, lead: plus })
  const boss = await leadLogin((n) => person(n, `boss-${stamp}`, 'admin'))
  const bob = await leadLogin((n) => person(n, `bob-${stamp}`, 'user'))
  const me = async (cookie: string) => (await new Client().req('GET', '/api/me', undefined, { cookie })).status
  check('deux personnes de la même organisation connectées', (await me(boss.session)) === 200 && (await me(bob.session)) === 200)
  const logoutToken = (sub: string, over: Record<string, unknown> = {}, key = privateKey) => {
    const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
    const iat = Math.floor(Date.now() / 1000)
    const p = b64({ iss: process.env.LEAD_ID_ISSUER, aud: 'projectlead', iat, exp: iat + 120, sub, org, lead_status: 'disabled',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, ...over })
    return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`
  }
  const post = async (token: string) => (await app.request('http://localhost/auth/lead/backchannel-logout', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: token }) })).status
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  check('jeton signé par une autre clé : refusé, la session reste', (await post(logoutToken(`bob-${stamp}`, {}, otherKey))) === 400 && (await me(bob.session)) === 200)
  check('jeton pour une autre application : refusé', (await post(logoutToken(`bob-${stamp}`, { aud: 'crmlead' }))) === 400)
  check('jeton avec nonce : refusé', (await post(logoutToken(`bob-${stamp}`, { nonce: 'x' }))) === 400)
  check('jeton de plus de cinq minutes : refusé', (await post(logoutToken(`bob-${stamp}`, { iat: Math.floor(Date.now() / 1000) - 600 }))) === 400)
  check('sans l’événement de déconnexion : refusé', (await post(logoutToken(`bob-${stamp}`, { events: {} }))) === 400)
  check('autre organisation annoncée : sans effet', (await post(logoutToken(`bob-${stamp}`, { org: 'org-inconnue' }))) === 200 && (await me(bob.session)) === 200)
  check('départ : 200, la session ouverte tombe aussitôt', (await post(logoutToken(`bob-${stamp}`))) === 200 && (await me(bob.session)) === 401)
  const row = (await pool.query(`select au.active from account_users au join users u on u.id = au.user_id where u.lead_sub = $1`, [`bob-${stamp}`])).rows[0]
  check('la personne devient inactive dans l’entreprise (place libérée)', row?.active === false, row)
  check('l’administratrice garde sa session', (await me(boss.session)) === 200)
  check('rejouer le départ ne casse rien', (await post(logoutToken(`bob-${stamp}`))) === 200)
  check('dernier administrateur : sa session tombe, il reste actif', (await post(logoutToken(`boss-${stamp}`))) === 200 && (await me(boss.session)) === 401
    && (await pool.query(`select au.active from account_users au join users u on u.id = au.user_id where u.lead_sub = $1`, [`boss-${stamp}`])).rows[0]?.active === true)
}
section('Abonnement ProjectLead : Checkout, portail, webhook (faux Stripe)')
{
  const { signPayload, own } = await import('../server/lib/stripe.js')
  const { syncErplead, cancelAccountSubscriptions } = await import('../server/lib/subscription.js')
  const { hashToken } = await import('../server/auth.js')
  let r: any
  // ---------------------------------------------------------------- faux Stripe
  const calls: { method: string; path: string; params: URLSearchParams; idem: string | null }[] = []
  const stripeSubs = new Map<string, any>()
  const customersByKey = new Map<string, string>()
  let stripeDown = false, nCus = 0, nCs = 0
  const fakeStripe = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    const raw = await new Promise<string>((ok) => { let d = ''; req.on('data', (x) => (d += x)); req.on('end', () => ok(d)) })
    if (req.headers.authorization !== 'Bearer sk_test_smoke') { res.statusCode = 401; return res.end('{"error":{"type":"invalid_request_error","message":"clé"}}') }
    if (stripeDown) { res.statusCode = 500; return res.end('{"error":{"type":"api_error","message":"panne"}}') }
    const url = new URL(req.url!, 'http://x')
    const params = new URLSearchParams(req.method === 'POST' ? raw : url.search)
    const idem = (req.headers['idempotency-key'] as string | undefined) ?? null
    calls.push({ method: req.method!, path: url.pathname, params, idem })
    if (req.method === 'POST' && url.pathname === '/v1/customers') {
      const id = (idem && customersByKey.get(idem)) || `cus_${stamp}_${++nCus}`
      if (idem) customersByKey.set(idem, id)
      return res.end(JSON.stringify({ id, object: 'customer' }))
    }
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: `cs_test_smoke${++nCs}`, url: `https://checkout.stripe.test/c/${nCs}` }))
    if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ id: 'bps_smoke', url: 'https://billing.stripe.test/p/1' }))
    const m = url.pathname.match(/^\/v1\/subscriptions\/(sub_\w+)$/)
    if (m && stripeSubs.has(m[1]) && req.method === 'GET') return res.end(JSON.stringify(stripeSubs.get(m[1])))
    if (m && stripeSubs.has(m[1]) && req.method === 'DELETE') {
      const s = { ...stripeSubs.get(m[1]), status: 'canceled' }; stripeSubs.set(m[1], s); return res.end(JSON.stringify(s))
    }
    res.statusCode = 404; res.end('{"error":{"type":"invalid_request_error","code":"resource_missing","message":"absent"}}')
  })
  process.env.STRIPE_API_BASE = `http://127.0.0.1:${await listen(fakeStripe)}`

  // ---------------------------------------------------------------- une entreprise Lead en Gratuit, son admin, un membre
  const aboOrg = `abo-org-${stamp}`
  entitlementsByOrg[aboOrg] = rights('free')
  ll = await leadLogin((n) => ({ ...lead(n, false, aboOrg), sub: `sub-abo-${stamp}`, email: `abo-${stamp}@exemple.test` }))
  const boss = new Client(); boss.cookie = ll.session
  const aboAcc = (await pool.query('select id from accounts where lead_org = $1', [aboOrg])).rows[0].id as string
  const memberId = (await pool.query(`insert into users (email, name) values ($1, 'Membre abo') returning id`, [`membre-abo-${stamp}@exemple.test`])).rows[0].id
  await pool.query(`insert into account_users (account_id, user_id, role) values ($1, $2, 'member')`, [aboAcc, memberId])
  const memberToken = `smoke-membre-${randomUUID()}`
  await pool.query(`insert into sessions (token_hash, user_id, account_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [hashToken(memberToken), memberId, aboAcc])
  const member = new Client(); member.cookie = `projectlead_session=${memberToken}`

  const hook = async (e: unknown, opts: { secret?: string; sig?: string } = {}) => {
    const raw = JSON.stringify(e)
    const res = await app.request('http://localhost/api/stripe/webhook', { method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': opts.sig ?? signPayload(raw, opts.secret ?? 'whsec_smoke_local') }, body: raw })
    return { status: res.status, body: await res.json().catch(() => null) as any }
  }
  const counts = async () => (await pool.query(`select (select count(*) from stripe_events)::int as events,
    (select count(*) from billing_subscriptions)::int as subs, (select count(*) from notifications where account_id = $1)::int as notes,
    (select stripe_customer_id from accounts where id = $1) as customer, (select plan from accounts where id = $1) as plan`, [aboAcc])).rows[0]
  const now = Math.floor(Date.now() / 1000)
  const PRICE = {
    pro_m: { id: 'price_pl_pro_m', lookup_key: 'projectlead_pro_monthly', recurring: { interval: 'month' }, metadata: { app: 'projectlead', projectlead_plan: 'pro', interval: 'month' } },
    plus_y: { id: 'price_pl_plus_y', lookup_key: 'projectlead_proplus_yearly', recurring: { interval: 'year' }, metadata: { app: 'projectlead', projectlead_plan: 'pro_plus', interval: 'year' } },
    crm_m: { id: 'price_crm_pro_m', lookup_key: 'crmlead_pro_monthly', recurring: { interval: 'month' }, metadata: { app: 'crmlead', crmlead_plan: 'pro' } },
    scan_team: { id: 'price_scan_team', lookup_key: null, recurring: { interval: 'month' }, metadata: { plan: 'team' } },
  }
  const subOf = (id: string, over: Record<string, any> = {}, price: any = PRICE.pro_m, customer = `cus_${stamp}_1`) => ({
    id, object: 'subscription', customer, status: 'active', cancel_at_period_end: false,
    metadata: { app: 'projectlead', account_id: aboAcc, plan: 'pro', interval: 'month' },
    items: { data: [{ price, current_period_end: now + 30 * 86400 }] }, ...over,
  })
  const evt = (type: string, object: unknown, id = `evt_smoke_${randomUUID().slice(0, 8)}`) => ({ id, object: 'event', type, created: now, data: { object } })

  // ---------------------------------------------------------------- sans configuration
  r = await boss.get('/api/billing')
  check('sans variables Stripe : page Formule lisible, paiement fermé, Gratuit', r.status === 200 && r.body.configured === false
    && r.body.portal === false && r.body.plan.tier === 'free' && r.body.subscription === null && r.body.prices.pro.month === 19 && r.body.prices.pro_plus.year === 390, r.body)
  r = await boss.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
  check('sans variables Stripe : Checkout → 503 billing_not_configured', r.status === 503 && r.body.error === 'billing_not_configured', r)
  r = await hook(evt('customer.subscription.created', subOf(`sub_${stamp}_x`)))
  check('sans variables Stripe : webhook → 503 (Stripe réessaiera)', r.status === 503, r)

  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_smoke', STRIPE_WEBHOOK_SECRET: 'whsec_smoke_local',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pl_pro_m', STRIPE_PRICE_PRO_YEARLY: 'price_pl_pro_y',
    STRIPE_PRICE_PROPLUS_MONTHLY: 'price_pl_plus_m', STRIPE_PRICE_PROPLUS_YEARLY: 'price_pl_plus_y' })
  {
    // Une clé live posée par erreur sur une préversion : rien ne se vend, rien ne se lit.
    const before = { k: process.env.STRIPE_SECRET_KEY, v: process.env.VERCEL_ENV }
    Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_live_jamais', VERCEL_ENV: 'preview' })
    r = await boss.get('/api/billing')
    check('clé live sur une préversion Vercel : paiement fermé', r.body.configured === false, r.body)
    delete process.env.VERCEL_ENV
    r = await boss.get('/api/billing')
    check('clé live sur un poste de développement (adresse locale) : paiement fermé', r.body.configured === false, r.body)
    process.env.STRIPE_SECRET_KEY = before.k
    if (before.v === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = before.v
  }

  // ---------------------------------------------------------------- Checkout et portail
  r = await member.get('/api/billing')
  check('un membre lit la formule mais ne la gère pas', r.status === 200 && r.body.configured === true && r.body.canManage === false, r.body)
  r = await member.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
  check('Checkout par un membre → 403', r.status === 403, r)
  r = await member.post('/api/billing/portal')
  check('portail par un membre → 403', r.status === 403, r)
  r = await boss.post('/api/billing/checkout', { plan: 'gold', interval: 'month' })
  check('Checkout : formule inconnue → 400', r.status === 400, r)
  r = await boss.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
  const cusCall = calls.find((x) => x.path === '/v1/customers')
  const csCall = calls.find((x) => x.path === '/v1/checkout/sessions')
  check('Checkout par l\'administrateur → adresse de paiement Stripe', r.status === 200 && r.body.url === 'https://checkout.stripe.test/c/1', r)
  check('client Stripe propre à ProjectLead : metadata app + account_id, clé d\'idempotence projectlead-customer-<compte>',
    cusCall?.params.get('metadata[app]') === 'projectlead' && cusCall?.params.get('metadata[account_id]') === aboAcc
    && cusCall?.idem === `projectlead-customer-${aboAcc}` && (await counts()).customer === `cus_${stamp}_1`,
    { params: cusCall && Object.fromEntries(cusCall.params), idem: cusCall?.idem })
  const cs = csCall ? Object.fromEntries(csCall.params) : {}
  check('session Checkout : abonnement, prix projectlead_pro_monthly, metadata ET subscription_data.metadata {app, account_id, plan, interval}',
    cs.mode === 'subscription' && cs.customer === `cus_${stamp}_1` && cs['line_items[0][price]'] === 'price_pl_pro_m'
    && cs['metadata[app]'] === 'projectlead' && cs['metadata[account_id]'] === aboAcc && cs['metadata[plan]'] === 'pro' && cs['metadata[interval]'] === 'month'
    && cs['subscription_data[metadata][app]'] === 'projectlead' && cs['subscription_data[metadata][account_id]'] === aboAcc
    && cs['subscription_data[metadata][plan]'] === 'pro' && cs['subscription_data[metadata][interval]'] === 'month', cs)
  check('session Checkout : jamais client_reference_id, workspace_id, invoice_id ni organization_id (clés de ScanLead et de Connect)',
    !Object.keys(cs).some((k) => /client_reference_id|workspace_id|invoice_id|organization_id/.test(k)), Object.keys(cs))
  check('session Checkout : carte seule, adresse et TVA demandées, retour sur Réglages → Entreprise',
    cs['payment_method_types[0]'] === 'card' && !cs['payment_method_types[1]'] && cs.billing_address_collection === 'required'
    && cs['tax_id_collection[enabled]'] === 'true' && cs.success_url?.endsWith('/reglages/entreprise?paiement=ok')
    && cs.cancel_url?.endsWith('/reglages/entreprise?paiement=annule'), cs)
  const csIdem = csCall?.idem
  r = await boss.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
  const csCalls = calls.filter((x) => x.path === '/v1/checkout/sessions')
  check('second clic : même client (pas de second client Stripe), même clé d\'idempotence de session (un seul abonnement possible)',
    r.status === 200 && calls.filter((x) => x.path === '/v1/customers').length === 1 && csCalls.length === 2 && csCalls[1].idem === csIdem && Boolean(csIdem),
    { customers: calls.filter((x) => x.path === '/v1/customers').length, idem: csCalls.map((x) => x.idem) })
  r = await boss.post('/api/billing/portal')
  check('portail sans configuration propre à ProjectLead → 503 (jamais celle par défaut, qui est celle de ScanLead)', r.status === 503 && r.body.error === 'billing_not_configured', r)
  process.env.STRIPE_PORTAL_CONFIGURATION = 'bpc_smoke_projectlead'
  r = await boss.post('/api/billing/portal')
  const pCall = calls.filter((x) => x.path === '/v1/billing_portal/sessions').pop()
  check('portail : configuration ProjectLead, client ProjectLead, retour sur Réglages → Entreprise', r.status === 200 && r.body.url === 'https://billing.stripe.test/p/1'
    && pCall?.params.get('configuration') === 'bpc_smoke_projectlead' && pCall?.params.get('customer') === `cus_${stamp}_1`
    && Boolean(pCall?.params.get('return_url')?.endsWith('/reglages/entreprise')), pCall && Object.fromEntries(pCall.params))

  // ---------------------------------------------------------------- signature
  const before = await counts()
  r = await hook(evt('customer.subscription.created', subOf(`sub_${stamp}_1`)), { sig: 't=1,v1=00' })
  check('webhook : fausse signature → 400', r.status === 400 && r.body.error === 'invalid_signature', r)
  r = await hook(evt('customer.subscription.created', subOf(`sub_${stamp}_1`)), { secret: 'whsec_autre_application' })
  check('webhook : signé avec le secret d\'un autre endpoint → 400', r.status === 400, r)
  {
    const raw = JSON.stringify(evt('customer.subscription.created', subOf(`sub_${stamp}_1`)))
    const res = await app.request('http://localhost/api/stripe/webhook', { method: 'POST', body: raw,
      headers: { 'stripe-signature': signPayload(raw, 'whsec_smoke_local', now - 600) } })
    check('webhook : signature de plus de 5 minutes (rejeu) → 400', res.status === 400)
  }

  // ---------------------------------------------------------------- isolation : les événements des autres applications
  const callsBefore = calls.length
  stripeSubs.set(`sub_${stamp}_crm`, subOf(`sub_${stamp}_crm`, { metadata: { app: 'crmlead', account_id: aboAcc, plan: 'pro' } }, PRICE.crm_m))
  const foreign: [string, unknown][] = [
    ['CRMlead : abonnement crmlead_pro_monthly (même account_id)', evt('customer.subscription.updated', subOf(`sub_${stamp}_crm`, { metadata: { app: 'crmlead', account_id: aboAcc, plan: 'pro' } }, PRICE.crm_m))],
    ['marque projectlead mais prix CRMlead', evt('customer.subscription.created', subOf(`sub_${stamp}_mix`, {}, PRICE.crm_m))],
    ['ScanLead : prix « team » sans app', evt('customer.subscription.created', subOf(`sub_${stamp}_scan`, { metadata: { plan: 'team', workspace_id: aboAcc } }, PRICE.scan_team))],
    ['ScanLead : Checkout avec client_reference_id', evt('checkout.session.completed', { id: 'cs_scan', object: 'checkout.session', mode: 'subscription',
      client_reference_id: aboAcc, customer: `cus_${stamp}_1`, subscription: `sub_${stamp}_scan`, metadata: { workspace_id: aboAcc } })],
    ['Greetlead : Checkout de paiement unique', evt('checkout.session.completed', { id: 'cs_greet', object: 'checkout.session', mode: 'payment',
      client_reference_id: 'card-1', metadata: { app: 'greetlead' } })],
    ['paiement unique marqué projectlead (ProjectLead ne vend que l\'abonnement)', evt('checkout.session.completed', { id: 'cs_pay', object: 'checkout.session', mode: 'payment', metadata: { app: 'projectlead', account_id: aboAcc } })],
    ['InvoiceLead : paiement échoué (nouvelle forme, parent.subscription_details)', evt('invoice.payment_failed', { id: 'in_il', object: 'invoice', customer: `cus_${stamp}_1`,
      parent: { subscription_details: { subscription: 'sub_il_1', metadata: { app: 'invoicelead', account_id: aboAcc } } } })],
    ['Greetlead : paiement échoué (ancienne forme)', evt('invoice.payment_failed', { id: 'in_gl', object: 'invoice', customer: `cus_${stamp}_1`, subscription: 'sub_gl_1',
      subscription_details: { metadata: { app: 'greetlead' } } })],
    ['type non traité (charge.succeeded)', evt('charge.succeeded', { id: 'ch_1', object: 'charge', metadata: { app: 'projectlead', account_id: aboAcc } })],
  ]
  for (const [label, e] of foreign) {
    r = await hook(e)
    check(`autre application → 200 « other_app » : ${label}`, r.status === 200 && r.body.result === 'other_app', r)
  }
  const after = await counts()
  check('autres applications : aucune écriture (événements, abonnements, notifications, client, formule) et aucun appel à Stripe',
    JSON.stringify(after) === JSON.stringify(before) && calls.length === callsBefore && after.plan === 'free', { before, after, appels: calls.length - callsBefore })
  check('filtre own : la facture d\'un abonnement ProjectLead (nouvelle forme d\'API) est reconnue',
    own(evt('invoice.payment_failed', { parent: { subscription_details: { subscription: 'sub_x', metadata: { app: 'projectlead' } } } })) === true
    && own(evt('customer.subscription.updated', subOf('sub_y', {}, { id: 'price_inconnu', metadata: { app: 'projectlead', projectlead_plan: 'pro_plus' }, recurring: { interval: 'year' } }))) === true)

  // ---------------------------------------------------------------- notre abonnement, de bout en bout
  stripeSubs.set(`sub_${stamp}_1`, subOf(`sub_${stamp}_1`))
  const created = evt('customer.subscription.created', subOf(`sub_${stamp}_1`))
  r = await hook(created)
  check('abonnement ProjectLead signé (projectlead_pro_monthly) → appliqué', r.status === 200 && r.body.result === 'applied', r)
  r = await boss.get('/api/me')
  check('/api/me : formule Pro tout de suite (abonnement ProjectLead), projets sans limite', r.body.plan.tier === 'pro' && r.body.plan.paidTier === 'pro'
    && r.body.plan.source === 'own' && r.body.plan.projectLimit === null && r.body.plan.seats === 1, r.body.plan)
  const decl = declared.filter((d) => d.external_id === `sub_${stamp}_1`)
  check('le faux Compte Lead reçoit la déclaration (org, pro, active, sub_…, fin de période)', decl.length === 1 && decl[0].org === aboOrg
    && decl[0].plan === 'pro' && decl[0].status === 'active' && Boolean(decl[0].current_period_end), decl)
  let row = (await pool.query('select * from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_1`])).rows[0]
  const acct = (await pool.query('select plan, plan_source from accounts where id = $1', [aboAcc])).rows[0]
  check('ligne locale déclarée (erplead_synced_at posé) ; formule recopiée depuis la réponse d\'ERPlead', row?.account_id === aboAcc && row.plan === 'pro'
    && row.interval === 'month' && row.status === 'active' && row.erplead_synced_at !== null && acct.plan === 'pro' && acct.plan_source === 'own', { row, acct })
  r = await hook(created)
  check('même événement rejoué → « duplicate », rien de plus déclaré', r.status === 200 && r.body.result === 'duplicate'
    && declared.filter((d) => d.external_id === `sub_${stamp}_1`).length === 1, r)
  r = await hook(evt('checkout.session.completed', { id: 'cs_test_smoke1', object: 'checkout.session', mode: 'subscription', customer: `cus_${stamp}_1`,
    subscription: `sub_${stamp}_1`, metadata: { app: 'projectlead', account_id: aboAcc, plan: 'pro', interval: 'month' } }))
  check('Checkout terminé (ProjectLead) → accepté, toujours une seule ligne', r.status === 200 && ['applied', 'stale'].includes(r.body.result)
    && (await pool.query('select count(*)::int as n from billing_subscriptions where account_id = $1', [aboAcc])).rows[0].n === 1, r)
  r = await boss.post('/api/billing/checkout', { plan: 'pro_plus', interval: 'year' })
  check('déjà abonné : un second Checkout → 409 (changer de formule passe par le portail)', r.status === 409 && r.body.error === 'already_subscribed', r)

  // L'état relu chez Stripe fait foi : un événement ancien, traité après coup, ne revient pas en arrière.
  stripeSubs.set(`sub_${stamp}_1`, subOf(`sub_${stamp}_1`, { cancel_at_period_end: true }))
  r = await hook(evt('customer.subscription.updated', subOf(`sub_${stamp}_1`, { cancel_at_period_end: false })))
  r = await boss.get('/api/billing')
  check('résiliation demandée au portail (relue chez Stripe, même si l\'événement est plus ancien) : toujours Pro, fin annoncée',
    r.body.plan.tier === 'pro' && Boolean(r.body.subscription?.endsAt) && r.body.subscription?.active === true && r.body.hasCustomer === true, r.body)
  // Versions d'API récentes (2026-07-29.dahlia) : le portail pose `cancel_at` et laisse cancel_at_period_end à faux.
  const endAt = now + 20 * 86400
  stripeSubs.set(`sub_${stamp}_1`, subOf(`sub_${stamp}_1`, { cancel_at_period_end: false, cancel_at: endAt }))
  r = await hook(evt('customer.subscription.updated', subOf(`sub_${stamp}_1`)))
  r = await boss.get('/api/billing')
  check('résiliation à une date (cancel_at, nouvelle forme du portail) : fin annoncée à cette date, toujours Pro',
    r.body.plan.tier === 'pro' && r.body.subscription?.endsAt && Date.parse(r.body.subscription.endsAt) === endAt * 1000, r.body.subscription)
  check('changement sans effet sur la formule (fin annoncée) : pas de nouvelle déclaration', declared.filter((d) => d.external_id === `sub_${stamp}_1`).length === 1)

  // Stripe en panne : rien n'est inscrit, Stripe renvoie l'événement plus tard.
  stripeDown = true
  const retried = evt('customer.subscription.updated', subOf(`sub_${stamp}_1`))
  r = await hook(retried)
  const kept = (await pool.query('select 1 from stripe_events where id = $1', [retried.id])).rowCount
  check('Stripe injoignable : 502 et événement non inscrit (Stripe le renverra)', r.status === 502 && kept === 0, r)
  stripeDown = false
  r = await hook(retried)
  check('… renvoyé une fois Stripe revenu : traité (pas « duplicate »)', r.status === 200 && ['applied', 'stale'].includes(r.body.result), r)

  // Paiement échoué : l'abonnement relu passe « en retard » ; l'administrateur est prévenu dans ProjectLead.
  stripeSubs.set(`sub_${stamp}_1`, subOf(`sub_${stamp}_1`, { status: 'past_due', cancel_at_period_end: true }))
  r = await hook(evt('invoice.payment_failed', { id: 'in_pl_1', object: 'invoice', customer: `cus_${stamp}_1`,
    parent: { subscription_details: { subscription: `sub_${stamp}_1`, metadata: { app: 'projectlead', account_id: aboAcc } } } }))
  const note = (await pool.query(`select n.title from notifications n join users u on u.id = n.user_id where n.account_id = $1 and n.kind = 'plan' and u.lead_sub = $2`, [aboAcc, `sub-abo-${stamp}`])).rows
  row = (await pool.query('select status from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_1`])).rows[0]
  r = { ...r, me: (await boss.get('/api/me')).body.plan } as any
  check('paiement échoué (ProjectLead) : en retard, administrateur prévenu, formule gardée pendant les relances', (r as any).body.result === 'payment_failed'
    && row.status === 'past_due' && note.some((n) => /paiement/.test(n.title)) && (r as any).me.tier === 'pro'
    && declared.filter((d) => d.external_id === `sub_${stamp}_1`).pop()?.status === 'past_due', { r, row, note })

  // Fin de l'abonnement : retour au gratuit, rien n'est effacé.
  stripeSubs.set(`sub_${stamp}_1`, subOf(`sub_${stamp}_1`, { status: 'canceled' }))
  r = await hook(evt('customer.subscription.deleted', subOf(`sub_${stamp}_1`, { status: 'canceled' })))
  r = await boss.get('/api/me')
  check('abonnement terminé (subscription.deleted) → Gratuit, déclaré « canceled » à ERPlead', r.body.plan.tier === 'free' && r.body.plan.projectLimit === 3
    && declared.filter((d) => d.external_id === `sub_${stamp}_1`).pop()?.status === 'canceled'
    && (await pool.query('select plan from accounts where id = $1', [aboAcc])).rows[0].plan === 'free', r.body.plan)

  // ERPlead en panne : Pro+ effectif ici quand même, puis la tâche billing_sync rattrape la déclaration.
  issuerDown = true
  stripeSubs.set(`sub_${stamp}_2`, subOf(`sub_${stamp}_2`, { metadata: { app: 'projectlead', account_id: aboAcc, plan: 'pro_plus', interval: 'year' } }, PRICE.plus_y))
  r = await hook(evt('customer.subscription.created', stripeSubs.get(`sub_${stamp}_2`)))
  const me2 = (await boss.get('/api/me')).body.plan
  row = (await pool.query('select erplead_synced_at from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_2`])).rows[0]
  check('Compte Lead en panne : Pro+ local quand même (5 places), déclaration en attente', r.status === 200 && r.body.result === 'applied'
    && me2.tier === 'pro_plus' && me2.seats === 5 && row?.erplead_synced_at === null, { r, me2, row })
  issuerDown = false
  const synced = await syncErplead()
  row = (await pool.query('select erplead_synced_at from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_2`])).rows[0]
  check('… rattrapée par la tâche billing_sync une fois le Compte Lead revenu', synced.synced >= 1 && row.erplead_synced_at !== null
    && declared.some((d) => d.external_id === `sub_${stamp}_2` && d.plan === 'pro_plus' && d.status === 'active'), { synced, row })

  // Deux événements du même abonnement en même temps (Checkout terminé + abonnement créé) : une seule ligne, cohérente.
  stripeSubs.set(`sub_${stamp}_3`, subOf(`sub_${stamp}_3`))
  const pair = await Promise.all([
    hook(evt('customer.subscription.created', subOf(`sub_${stamp}_3`))),
    hook(evt('checkout.session.completed', { id: 'cs_pair', object: 'checkout.session', mode: 'subscription', customer: `cus_${stamp}_1`, subscription: `sub_${stamp}_3`,
      metadata: { app: 'projectlead', account_id: aboAcc, plan: 'pro', interval: 'month' } })),
  ])
  const n3 = (await pool.query('select count(*)::int as n, min(status) as s from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_3`])).rows[0]
  check('deux événements simultanés du même abonnement : 200 tous deux, une seule ligne active', pair.every((x) => x.status === 200) && n3.n === 1 && n3.s === 'active', { pair, n3 })

  // Un abonnement ProjectLead d'une entreprise inconnue ici : rien n'est rattaché au hasard.
  stripeSubs.set(`sub_${stamp}_4`, subOf(`sub_${stamp}_4`, { metadata: { app: 'projectlead', account_id: randomUUID(), plan: 'pro', interval: 'month' } }, PRICE.pro_m, 'cus_inconnu'))
  r = await hook(evt('customer.subscription.created', stripeSubs.get(`sub_${stamp}_4`)))
  check('entreprise inconnue : « unknown_account », aucune ligne', r.status === 200 && r.body.result === 'unknown_account'
    && !(await pool.query('select 1 from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_4`])).rowCount, r)

  // Deux abonnements en cours pour la même entreprise (deux onglets payés) : rien n'est résilié, l'administrateur est prévenu.
  const notesBefore = (await pool.query(`select count(*)::int as n from notifications where account_id = $1 and title like '%deux abonnements%'`, [aboAcc])).rows[0].n
  r = await hook(evt('customer.subscription.created', stripeSubs.get(`sub_${stamp}_3`)))
  const notesAfter = (await pool.query(`select count(*)::int as n from notifications where account_id = $1 and title like '%deux abonnements%'`, [aboAcc])).rows[0].n
  check('deux abonnements ProjectLead en cours : administrateur prévenu une fois, aucune résiliation', notesBefore >= 1 && notesAfter === notesBefore
    && !calls.some((x) => x.method === 'DELETE'), { notesBefore, notesAfter })

  // Une relecture identique ne fait pas bouger la ligne (la tâche du jour ne tourne pas en rond).
  const v1 = (await pool.query('select updated_at::text as v, erplead_synced_at from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_3`])).rows[0]
  r = await hook(evt('customer.subscription.updated', stripeSubs.get(`sub_${stamp}_3`)))
  const v2 = (await pool.query('select updated_at::text as v, erplead_synced_at from billing_subscriptions where stripe_subscription_id = $1', [`sub_${stamp}_3`])).rows[0]
  check('même état relu : ligne inchangée, déclaration non refaite', r.body.result === 'applied' && v1.v === v2.v && v2.erplead_synced_at !== null, { v1, v2 })
  {
    const { reconcileSubscriptions } = await import('../server/lib/subscription.js')
    const getsBefore = calls.filter((x) => x.method === 'GET').length
    await reconcileSubscriptions()
    const gets = calls.filter((x) => x.method === 'GET').slice(getsBefore).map((x) => x.path)
    check('relecture du jour : seulement les abonnements qui peuvent encore changer (jamais un abonnement terminé)',
      gets.some((p) => p.endsWith(`sub_${stamp}_3`)) && !gets.some((p) => p.endsWith(`sub_${stamp}_1`)), gets)
  }

  // Impayé (relances épuisées) : pas de second abonnement, il se règle au portail.
  stripeSubs.set(`sub_${stamp}_2`, { ...stripeSubs.get(`sub_${stamp}_2`), status: 'unpaid' })
  stripeSubs.set(`sub_${stamp}_3`, { ...stripeSubs.get(`sub_${stamp}_3`), status: 'unpaid' })
  await hook(evt('customer.subscription.updated', stripeSubs.get(`sub_${stamp}_2`)))
  await hook(evt('customer.subscription.updated', stripeSubs.get(`sub_${stamp}_3`)))
  r = await boss.get('/api/billing')
  const unpaid = r.body
  r = await boss.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
  check('abonnement impayé : Gratuit, Checkout refusé (409), à régler dans le portail', unpaid.plan.tier === 'free' && unpaid.subscription?.blocking === true
    && unpaid.subscription?.active === false && r.status === 409 && r.body.error === 'already_subscribed', { sub: unpaid.subscription, status: r.status })

  // Un même client Stripe présenté pour deux entreprises au même instant : une seule le garde, aucune erreur.
  {
    const twin = await Promise.all([1, 2].map(async (n) => (await pool.query(`insert into accounts (name, lead_org) values ($1, $2) returning id`,
      [`Jumeau ${n} ${stamp}`, `jumeau-${n}-${stamp}`])).rows[0].id as string))
    const shared = `cus_${stamp}_partage`
    const res = await Promise.all(twin.map((id, n) => hook(evt('checkout.session.completed', { id: `cs_twin_${n}`, object: 'checkout.session',
      mode: 'subscription', customer: shared, subscription: null, metadata: { app: 'projectlead', account_id: id, plan: 'pro', interval: 'month' } }))))
    const owners = (await pool.query('select id from accounts where stripe_customer_id = $1', [shared])).rows
    check('un client Stripe pour deux entreprises au même instant : 200 tous deux, une seule le garde', res.every((x) => x.status === 200) && owners.length === 1,
      { res, owners: owners.length })
  }

  // Une formule recopiée avant le calcul par application (origine inconnue) n'est pas « payée ici ».
  await pool.query(`update accounts set plan = 'pro', plan_source = null, plan_valid_until = null where id = $1`, [aboAcc])
  r = await boss.get('/api/me')
  check('formule d\'origine inconnue (recopiée avant la bascule) : limites gardées jusqu\'à la relecture, mais rien de payé ici',
    r.body.plan.tier === 'pro' && r.body.plan.paidTier === 'free' && r.body.plan.source === 'family' && r.body.plan.inherited?.app === null, r.body.plan)
  await pool.query(`update accounts set plan = 'free', plan_source = 'free' where id = $1`, [aboAcc])

  // Une entreprise abonnée ne s'efface pas par mégarde ; la résiliation ne touche que ses propres abonnements.
  let blocked = ''
  try { await pool.query('delete from accounts where id = $1', [aboAcc]) } catch (e: any) { blocked = e?.code }
  check('effacer une entreprise qui a un abonnement : refusé par la base (résilier d\'abord)', blocked === '23503', blocked)
  const n = await cancelAccountSubscriptions(aboAcc)
  const deletes = calls.filter((x) => x.method === 'DELETE').map((x) => x.path)
  check('résiliation de l\'entreprise : seulement SES abonnements ProjectLead en cours (DELETE), jamais ceux d\'une autre application',
    n === 2 && deletes.length === 2 && deletes.every((p) => new RegExp(`sub_${stamp}_[23]$`).test(p)) && !deletes.some((p) => p.includes(`sub_${stamp}_crm`))
    && (await boss.get('/api/me')).body.plan.tier === 'free', { n, deletes })
  fakeStripe.close()
  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY', 'STRIPE_PRICE_PROPLUS_MONTHLY',
    'STRIPE_PRICE_PROPLUS_YEARLY', 'STRIPE_PORTAL_CONFIGURATION', 'STRIPE_API_BASE']) delete process.env[k]
}

delete process.env.LEAD_ID_CLIENT_SECRET

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
crm.close(); il.close(); issuerSrv.close()
await pool.end()
process.exit(ko ? 1 : 0)
