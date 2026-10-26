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
const { hashToken: hashTokenSmoke } = await import('../server/auth.js')

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
// Les clés publiées (une rotation les change) et le nombre de lectures du JWKS.
let publishedKeys: unknown[] = [jwk]
let jwksReads = 0
// Panne simulée de la lecture des clés (503) et durée d'une lecture (ms), pour les contrôles « Clés d'ERPlead ».
let jwksDown = false
let jwksDelay = 0
const issuerSrv = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/oauth/jwks') {
    jwksReads++
    if (jwksDelay) await new Promise((done) => setTimeout(done, jwksDelay))
    if (jwksDown) { res.statusCode = 503; return res.end('{"error":"unavailable"}') }
    return res.end(JSON.stringify({ keys: publishedKeys }))
  }
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
    // Comme ERPlead : `sid`, la session ERPlead du navigateur (une connexion d'avant ne l'a pas : `sid: undefined`).
    const p = b64({ iss: process.env.LEAD_ID_ISSUER, aud: 'projectlead', exp: Math.floor(Date.now() / 1000) + 300, sid: randomUUID(), ...nextIdClaims })
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
// 26.10.2026 : l'affaire change dans CRMlead (nouveau devis accepté, autre devise) → forfait, budget et devise suivent.
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', { ...envelope, data: { ...envelope.data, title: 'Nouvelle boutique (v2)', amount: 750000, currency: 'EUR', update: true } }, { authorization: `Bearer ${exchangeJwt()}` })
r = await eve.get(`/api/projects/${dealProject}`)
check('changement d\u2019affaire : forfait, budget et devise suivent', r.body.fixed_cents === 750000 && r.body.budget_cents === 750000 && r.body.currency === 'EUR', r.body)
await pool.query(`insert into invoice_runs (account_id, project_id, period, status) values ($1, $2, '2026-01', 'created')`, [accountId, dealProject])
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', { ...envelope, data: { ...envelope.data, title: 'Nouvelle boutique (v2)', amount: 760000, currency: 'CHF', update: true } }, { authorization: `Bearer ${exchangeJwt()}` })
r = await eve.get(`/api/projects/${dealProject}`)
check('projet déjà facturé : le montant suit, la devise reste', r.body.fixed_cents === 760000 && r.body.currency === 'EUR', r.body)
await pool.query(`delete from invoice_runs where project_id = $1`, [dealProject])
const goneEnvelope = { ...envelope, source: { ...envelope.source, id: `lead-supprime-${stamp}` } }
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', goneEnvelope, { authorization: `Bearer ${exchangeJwt()}` })
await pool.query(`delete from projects where id = $1`, [r.body.id])
r = await new Client().req('POST', '/api/lead-exchange/v1/inbox', { ...goneEnvelope, data: { ...goneEnvelope.data, amount: 1, update: true } }, { authorization: `Bearer ${exchangeJwt()}` })
check('projet supprimé ici : un changement d\u2019affaire ne le recrée pas',
  r.status === 200 && (await pool.query(`select count(*)::int as n from projects where source_ref = $1`, [`crmlead:lead-supprime-${stamp}`])).rows[0].n === 0, r.body)
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

section('Emails : seulement de qui voit le projet ou la boîte (projet réservé, boîte privée, boîte débranchée)')
{
  // Zoé intervient sur un projet réservé ; Marc n'y est pas. Chacun a sa boîte privée ; Ève, une boîte partagée.
  // (Zoé entre directement en base : la formule de l'espace n'a plus de place libre à ce point du banc.)
  const zoeId = (await pool.query(`insert into users (email, name) values ($1, 'Zoé Rey') returning id`, [`zoe-emails-${stamp}@exemple.test`])).rows[0].id
  await pool.query(`insert into account_users (account_id, user_id, role) values ($1, $2, 'member')`, [accountId, zoeId])
  const zoeToken = `zoe-${randomUUID()}`
  await pool.query(`insert into sessions (token_hash, user_id, account_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`,
    [hashTokenSmoke(zoeToken), zoeId, accountId])
  const zoe = new Client()
  zoe.cookie = `projectlead_session=${zoeToken}`
  check('Zoé, membre, entre', (await zoe.get('/api/me')).body?.user?.id === zoeId)
  // Le projet réservé : celui ouvert depuis l'email de Julie (réservé plus haut, Marc retiré) ; Zoé y intervient.
  const resId = fromMail
  r = await eve.post(`/api/projects/${resId}/members`, { user_id: zoeId })
  check('Zoé ajoutée au projet réservé', r.status < 300, r.body)
  const kId = (await eve.get(`/api/projects/${resId}`)).body.client.id
  check('projet réservé : invisible de Marc, visible de Zoé',
    (await marc.get(`/api/projects/${resId}`)).status === 404 && (await zoe.get(`/api/projects/${resId}`)).status === 200)
  const box = async (userId: string, mail: string, shared = false) => (await pool.query(
    `insert into mailboxes (account_id, user_id, provider, email, secret_enc, shared) values ($1,$2,'imap',$3,'x',$4) returning id`,
    [accountId, userId, mail, shared])).rows[0].id as string
  const zBox = await box(zoeId, `zoe-${stamp}@boite.test`)
  const mBox = await box(marcId, `marc-${stamp}@boite.test`)
  const sBox = await box(eveId, `info-${stamp}@boite.test`, true)
  const me = async (cl: Client) => (await cl.get('/api/me')).body.inbox as number
  const dash = async (cl: Client) => (await cl.get('/api/dashboard')).body.counts.inbox as number
  const counts0 = { marcMe: await me(marc), marcDash: await dash(marc), zoeMe: await me(zoe), zoeDash: await dash(zoe) }
  const mail = (mailbox: string | null, subject: string, projectId: string | null) => pool.query(
    `insert into email_messages (account_id, mailbox_id, message_id, from_email, subject, body, status, project_id, client_id)
     values ($1,$2,$3,$4,$5,'texte',$6,$7,$8)`,
    [accountId, mailbox, `<${subject}-${stamp}@discret.test>`, 'julie@martin-archi.ch', `${subject} ${stamp}`,
     projectId ? 'linked' : 'new', projectId, kId])
  await mail(null, 'R-capture', resId)     // adresse de capture, rattaché au projet réservé
  await mail(zBox, 'Z-prive', null)        // boîte privée de Zoé, à trier
  await mail(zBox, 'Z-projet', resId)      // boîte privée de Zoé, rattaché au projet réservé
  await mail(mBox, 'M-prive', null)        // boîte privée de Marc, à trier
  await mail(sBox, 'S-projet', resId)      // boîte partagée, rattaché au projet réservé
  await mail(sBox, 'S-libre', null)        // boîte partagée, à trier
  const subj = (rows: any[]) => (Array.isArray(rows) ? rows : []).map((m: any) => String(m.subject).replace(` ${stamp}`, '')).filter((s) => /^[RZMS]-/.test(s)).sort()

  // Fuite 1 : les emails d'un projet réservé, par son identifiant.
  r = await marc.get(`/api/projects/${resId}/emails`)
  check('fuite 1 : emails d’un projet réservé → 404 pour un non-intervenant', r.status === 404, { status: r.status, emails: subj(r.body) })
  r = await zoe.get(`/api/projects/${resId}/emails`)
  check('fuite 1, contre-épreuve : l’intervenante lit les emails du projet',
    r.status === 200 && subj(r.body).join() === 'R-capture,S-projet,Z-projet', subj(r.body))
  r = await marc.get(`/api/projects/${resId}/activity`)
  check('fil d’un projet réservé (objets des emails) → 404 pour un non-intervenant', r.status === 404, r.status)
  check('fil, contre-épreuve : l’intervenante le lit', (await zoe.get(`/api/projects/${resId}/activity`)).status === 200)

  // Fuite 2 : la fiche client.
  r = await marc.get(`/api/clients/${kId}`)
  check('fuite 2 : fiche client → ni boîte privée d’un autre, ni projet réservé (Marc : sa boîte et la partagée libre)',
    subj(r.body.emails).join() === 'M-prive,S-libre', subj(r.body.emails))
  r = await zoe.get(`/api/clients/${kId}`)
  check('fuite 2, contre-épreuve : Zoé voit sa boîte, le projet réservé et la partagée',
    subj(r.body.emails).join() === 'R-capture,S-libre,S-projet,Z-prive,Z-projet', subj(r.body.emails))

  // La boîte de réception et ses compteurs suivent la même règle.
  r = await marc.get('/api/mail/inbox?status=all')
  check('boîte de réception de Marc : rien du projet réservé ni de la boîte de Zoé', subj(r.body).join() === 'M-prive,S-libre', subj(r.body))
  r = await zoe.get('/api/mail/inbox?status=all')
  check('boîte de réception de Zoé : la sienne, le projet réservé, la partagée',
    subj(r.body).join() === 'R-capture,S-libre,S-projet,Z-prive,Z-projet', subj(r.body))
  check('compteur « À trier » (/me, accueil) : Marc ne compte pas l’email privé de Zoé',
    (await me(marc)) - counts0.marcMe === 2 && (await dash(marc)) - counts0.marcDash === 2,
    { me: (await me(marc)) - counts0.marcMe, dash: (await dash(marc)) - counts0.marcDash })
  check('compteur, contre-épreuve : Zoé compte le sien et la partagée',
    (await me(zoe)) - counts0.zoeMe === 2 && (await dash(zoe)) - counts0.zoeDash === 2)

  // Fuite 3 : débrancher une boîte privée (soi-même, ou un administrateur pour un autre).
  r = await zoe.del(`/api/mail/mailboxes/${zBox}`)
  check('Zoé débranche sa boîte', r.status === 200, r.body)
  r = await eve.del(`/api/mail/mailboxes/${mBox}`)
  check('Ève (administratrice) débranche la boîte de Marc', r.status === 200, r.body)
  r = await marc.get('/api/mail/inbox?status=all')
  check('fuite 3 : boîte débranchée → ses emails à trier ne deviennent pas visibles des collègues (Marc)',
    subj(r.body).join() === 'S-libre', subj(r.body))
  r = await zoe.get('/api/mail/inbox?status=all')
  check('fuite 3 : … ni de Zoé (email privé de Marc débranché par l’administratrice)',
    !subj(r.body).includes('M-prive') && subj(r.body).join() === 'R-capture,S-libre,S-projet,Z-projet', subj(r.body))
  r = await marc.get(`/api/clients/${kId}`)
  check('fuite 3 : fiche client de Marc, rien de la boîte débranchée de Zoé', subj(r.body.emails).join() === 'S-libre', subj(r.body.emails))
  r = await zoe.get(`/api/projects/${resId}/emails`)
  check('fuite 3, contre-épreuve : l’email rattaché au projet reste au projet, pour l’intervenante',
    subj(r.body).join() === 'R-capture,S-projet,Z-projet', subj(r.body))
  r = await eve.get(`/api/projects/${resId}/emails`)
  check('… et pour l’administratrice', subj(r.body).join() === 'R-capture,S-projet,Z-projet', subj(r.body))
  const left = (await pool.query(`select subject from email_messages where account_id = $1 and subject like '%${stamp}'`, [accountId])).rows
  check('fuite 3 : les emails à trier d’une boîte privée débranchée sont effacés, ceux des projets gardés',
    subj(left).join() === 'R-capture,S-libre,S-projet,Z-projet', subj(left))
  r = await eve.del(`/api/mail/mailboxes/${sBox}`)
  r = await marc.get('/api/mail/inbox?status=all')
  check('contre-épreuve : boîte partagée débranchée, ses emails restent à l’équipe', subj(r.body).join() === 'S-libre', subj(r.body))
  // L'email de la boîte débranchée, rattaché au projet, remis « à trier » : sans boîte ni projet, il ne va à personne.
  const zProjet = (await zoe.get(`/api/projects/${resId}/emails`)).body.find((m: any) => m.subject === `Z-projet ${stamp}`)
  const rCapture = (await zoe.get(`/api/projects/${resId}/emails`)).body.find((m: any) => m.subject === `R-capture ${stamp}`)
  await zoe.post(`/api/mail/messages/${zProjet.id}/status`, { status: 'new' })
  await zoe.post(`/api/mail/messages/${rCapture.id}/status`, { status: 'new' })
  r = await marc.get('/api/mail/inbox?status=all')
  check('boîte débranchée : son email remis « à trier » ne devient pas visible des collègues ; celui de la capture, si',
    subj(r.body).join() === 'R-capture,S-libre', subj(r.body))
  r = await marc.get(`/api/clients/${kId}`)
  check('… ni sur la fiche client', subj(r.body.emails).join() === 'R-capture,S-libre', subj(r.body.emails))
  r = await new Client().req('POST', `/api/inbound/${inboundToken}`, { from: 'julie@martin-archi.ch', subject: `R-capture2 ${stamp}`, text: 'x', message_id: `<c2-${stamp}@discret.test>` })
  r = await marc.get('/api/mail/inbox?status=all')
  check('adresse de capture : l’email d’un client, rattaché au projet réservé, reste réservé', !subj(r.body).includes('R-capture2'), subj(r.body))
  r = await zoe.get('/api/mail/inbox?status=all')
  check('… contre-épreuve : l’intervenante le voit', subj(r.body).includes('R-capture2'), subj(r.body))

  section('Projet réservé : toute route par identifiant (projet, tâche, fichier, colonne, point, temps, rendez-vous) → 404 hors du projet')
  const R = resId
  const q1 = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0]
  // Les objets du projet réservé, posés par Ève (administratrice) ; Marc en est sorti, Zoé y intervient.
  const upd = await eve.post(`/api/projects/${R}/updates`, { health: 'at_risk', body: `point secret ${stamp}` })
  const fd = () => { const f = new FormData(); f.append('file', new File([`contenu ${stamp}`], `plan-secret-${stamp}.txt`, { type: 'text/plain' })); return f }
  const fileId = (await eve.req('POST', `/api/projects/${R}/files`, fd())).body.id
  const colId = (await eve.get(`/api/projects/${R}`)).body.columns[0].id
  const stageR = (await eve.post(`/api/projects/${R}/stages`, { name: `Étape secrète ${stamp}` })).body.id
  const taskR2 = (await eve.post('/api/tasks', { project_id: R, title: `Tâche secrète 2 ${stamp}` })).body.id
  await eve.post(`/api/tasks/${taskR2}/dependencies`, { depends_on_id: hiddenTask })
  const itemId = (await eve.post(`/api/tasks/${hiddenTask}/checklist`, { label: `point ${stamp}` })).body.id
  // Marc, encore intervenant un moment : un commentaire et du temps sur le projet réservé, puis il en sort.
  await eve.post(`/api/projects/${R}/members`, { user_id: marcId })
  const marcComment = (await marc.post(`/api/tasks/${hiddenTask}/comments`, { body: `ancien commentaire ${stamp}` })).body.id
  const marcEntryR = (await marc.post('/api/time/entries', { project_id: R, entry_date: today, minutes: 30 })).body.id
  await eve.del(`/api/projects/${R}/members/${marcId}`)
  check('préparation : objets du projet réservé posés, Marc ressorti',
    upd.status === 201 && fileId && colId && stageR && taskR2 && itemId && marcComment && marcEntryR && (await marc.get(`/api/projects/${R}`)).status === 404)
  const evR = (await eve.post('/api/calendar/events', { title: `Rendez-vous secret ${stamp}`, starts_at: `${today}T10:00:00+02:00`,
    ends_at: `${today}T11:00:00+02:00`, project_id: R })).body.id

  // Lectures.
  r = await marc.get(`/api/projects/${R}/files`)
  check('GET /projects/:id/files → 404 hors du projet', r.status === 404, r.body)
  r = await zoe.get(`/api/projects/${R}/files`)
  check('… contre-épreuve : l’intervenante voit les fichiers', r.status === 200 && r.body.some((f: any) => f.id === fileId), r.body)
  r = await marc.get(`/api/projects/${R}/updates`)
  check('GET /projects/:id/updates → 404 hors du projet', r.status === 404, r.body)
  r = await zoe.get(`/api/projects/${R}/updates`)
  check('… contre-épreuve : l’intervenante voit les points', r.status === 200 && r.body.some((u: any) => u.body === `point secret ${stamp}`), r.body)
  r = await marc.get(`/api/projects/${R}/client-report`)
  check('GET /projects/:id/client-report → 404 hors du projet', r.status === 404, r.status)
  check('… contre-épreuve : l’intervenante le lit', (await zoe.get(`/api/projects/${R}/client-report`)).status === 200)
  const range = `from=${addDays(today, -1)}&to=${addDays(today, 1)}&scope=all`
  r = await marc.get(`/api/calendar/events?${range}`)
  check('GET /calendar/events : un rendez-vous du projet réservé n’apparaît pas hors du projet', !r.body.events.some((e: any) => e.id === evR), r.body.events)
  r = await zoe.get(`/api/calendar/events?${range}`)
  check('… contre-épreuve : l’intervenante le voit', r.body.events.some((e: any) => e.id === evR))

  // Écritures sur le projet ou ses objets.
  r = await marc.req('POST', `/api/projects/${R}/files`, fd())
  check('POST /projects/:id/files → 404 hors du projet, rien d’enregistré', r.status === 404 &&
    (await q1('select count(*)::int as n from attachments where project_id = $1', [R])).n === 1, r.body)
  r = await zoe.req('POST', `/api/projects/${R}/files`, fd())
  check('… contre-épreuve : l’intervenante dépose un fichier', r.status === 201, r.body)
  const zoeFile = r.body.id
  const fdTask = (taskId: string) => { const f = fd(); f.append('task_id', taskId); return f }
  r = await marc.req('POST', `/api/projects/${projId}/files`, fdTask(hiddenTask))
  check('POST /projects/:id/files : tâche d’un autre projet (réservé) refusée', r.status === 400, r.body)
  r = await marc.patch(`/api/projects/files/${fileId}`, { visible_to_client: true })
  check('PATCH /projects/files/:fid → 404 hors du projet, rien de changé', r.status === 404 &&
    (await q1('select visible_to_client from attachments where id = $1', [fileId])).visible_to_client === false, r.body)
  check('… contre-épreuve : l’intervenante le modifie', (await zoe.patch(`/api/projects/files/${fileId}`, { visible_to_client: false })).status === 200)
  r = await marc.del(`/api/projects/files/${fileId}`)
  check('DELETE /projects/files/:fid → 404 hors du projet, fichier gardé', r.status === 404 &&
    (await q1('select count(*)::int as n from attachments where id = $1', [fileId])).n === 1, r.body)
  check('… contre-épreuve : l’intervenante efface le sien', (await zoe.del(`/api/projects/files/${zoeFile}`)).status === 200 &&
    (await q1('select count(*)::int as n from attachments where id = $1', [zoeFile])).n === 0)
  const colName = (await q1('select name from board_columns where id = $1', [colId])).name
  r = await marc.patch(`/api/projects/columns/${colId}`, { name: 'piratée' })
  check('PATCH /projects/columns/:cid → 404 hors du projet, nom gardé', r.status === 404 &&
    (await q1('select name from board_columns where id = $1', [colId])).name === colName, r.body)
  check('… contre-épreuve : l’intervenante la renomme', (await zoe.patch(`/api/projects/columns/${colId}`, { name: colName })).status === 200)
  r = await marc.del(`/api/projects/columns/${colId}`)
  check('DELETE /projects/columns/:cid → 404 hors du projet, colonne gardée', r.status === 404 &&
    (await q1('select count(*)::int as n from board_columns where id = $1', [colId])).n === 1, r.body)
  const zoeCol = (await zoe.post(`/api/projects/${R}/columns`, { name: `Col ${stamp}` })).body.id
  check('… contre-épreuve : l’intervenante efface une colonne', (await zoe.del(`/api/projects/columns/${zoeCol}`)).status === 200)
  const sentBefore = (await q1('select count(*)::int as n from sent_emails where account_id = $1', [accountId])).n
  r = await marc.post(`/api/projects/${R}/emails`, { to: ['client@exemple.test'], subject: `Fuite ${stamp}`, body: 'x' })
  check('POST /projects/:id/emails → 404 hors du projet, AUCUN email envoyé', r.status === 404 &&
    (await q1('select count(*)::int as n from sent_emails where account_id = $1', [accountId])).n === sentBefore, r.body)
  r = await zoe.post(`/api/projects/${R}/emails`, { to: ['client@exemple.test'], subject: `Réponse ${stamp}`, body: 'x' })
  check('… contre-épreuve : l’intervenante écrit au client', r.status === 200, r.body)

  // Tâches : liste de contrôle, dépendances, commentaires, rattachements.
  r = await marc.patch(`/api/tasks/checklist/${itemId}`, { done: true })
  check('PATCH /tasks/checklist/:iid → 404 hors du projet, rien de coché', r.status === 404 &&
    (await q1('select done from checklist_items where id = $1', [itemId])).done === false, r.body)
  check('… contre-épreuve : l’intervenante coche', (await zoe.patch(`/api/tasks/checklist/${itemId}`, { done: true })).status === 200 &&
    (await q1('select done from checklist_items where id = $1', [itemId])).done === true)
  r = await marc.del(`/api/tasks/checklist/${itemId}`)
  check('DELETE /tasks/checklist/:iid → 404 hors du projet, point gardé', r.status === 404 &&
    (await q1('select count(*)::int as n from checklist_items where id = $1', [itemId])).n === 1, r.body)
  r = await marc.del(`/api/tasks/${taskR2}/dependencies/${hiddenTask}`)
  check('DELETE /tasks/:id/dependencies/:dep → 404 hors du projet, dépendance gardée', r.status === 404 &&
    (await q1('select count(*)::int as n from task_dependencies where task_id = $1', [taskR2])).n === 1, r.body)
  check('… contre-épreuve : l’intervenante la retire', (await zoe.del(`/api/tasks/${taskR2}/dependencies/${hiddenTask}`)).status === 200 &&
    (await q1('select count(*)::int as n from task_dependencies where task_id = $1', [taskR2])).n === 0)
  r = await marc.patch(`/api/tasks/comments/${marcComment}`, { body: 'réécrit' })
  check('PATCH /tasks/comments/:cid : l’auteur sorti du projet réservé → 404, texte gardé', r.status === 404 &&
    (await q1('select body from comments where id = $1', [marcComment])).body === `ancien commentaire ${stamp}`, r.body)
  r = await marc.del(`/api/tasks/comments/${marcComment}`)
  check('DELETE /tasks/comments/:cid : idem, commentaire gardé', r.status === 404 &&
    (await q1('select count(*)::int as n from comments where id = $1', [marcComment])).n === 1, r.body)
  const zoeComment = (await zoe.post(`/api/tasks/${hiddenTask}/comments`, { body: `mot de Zoé ${stamp}` })).body.id
  check('… contre-épreuve : l’intervenante corrige et efface le sien',
    (await zoe.patch(`/api/tasks/comments/${zoeComment}`, { body: 'corrigé' })).status === 200 && (await zoe.del(`/api/tasks/comments/${zoeComment}`)).status === 200)
  r = await marc.post('/api/tasks', { project_id: projId, title: 'sous-tâche', parent_id: hiddenTask })
  check('POST /tasks : tâche parente d’un projet réservé refusée', r.status === 400, r.body)
  r = await marc.post('/api/tasks', { project_id: projId, title: 'colonne', column_id: colId })
  check('POST /tasks : colonne d’un projet réservé refusée', r.status === 400, r.body)
  r = await marc.patch(`/api/tasks/${piecesId}`, { stage_id: stageR })
  check('PATCH /tasks/:id : étape d’un projet réservé refusée, rien de changé', r.status === 400 &&
    (await q1('select stage_id from tasks where id = $1', [piecesId])).stage_id !== stageR, r.body)
  r = await marc.post('/api/tasks/bulk', { ids: [piecesId], patch: { stage_id: stageR } })
  check('POST /tasks/bulk : étape d’un projet réservé refusée', r.status === 400 &&
    (await q1('select stage_id from tasks where id = $1', [piecesId])).stage_id !== stageR, r.body)
  r = await zoe.post('/api/tasks', { project_id: R, title: `Sous-tâche ${stamp}`, parent_id: hiddenTask, column_id: colId, stage_id: stageR })
  check('… contre-épreuve : dans son projet, l’intervenante rattache parente, colonne et étape', r.status === 201, r.body)

  // Temps.
  r = await marc.post('/api/time/entries', { project_id: projId, task_id: hiddenTask, entry_date: today, minutes: 15 })
  check('POST /time/entries : tâche d’un projet réservé refusée', r.status === 400, r.body)
  r = await marc.post('/api/time/entries', { project_id: projId, task_id: piecesId, entry_date: today, minutes: 15 })
  check('… contre-épreuve : sur son projet et sa tâche, accepté', r.status === 201, r.body)
  const marcEntryOk = r.body.id
  r = await marc.patch(`/api/time/entries/${marcEntryR}`, { minutes: 999 })
  check('PATCH /time/entries/:id : son temps sur un projet réservé quitté → 404, rien de changé', r.status === 404 &&
    (await q1('select minutes from time_entries where id = $1', [marcEntryR])).minutes === 30, r.body)
  r = await marc.del(`/api/time/entries/${marcEntryR}`)
  check('DELETE /time/entries/:id : idem, gardé', r.status === 404 &&
    (await q1('select count(*)::int as n from time_entries where id = $1', [marcEntryR])).n === 1, r.body)
  r = await marc.patch(`/api/time/entries/${marcEntryOk}`, { project_id: R, task_id: null })
  check('PATCH /time/entries/:id : déplacer son temps vers un projet réservé → 404', r.status === 404 &&
    (await q1('select project_id from time_entries where id = $1', [marcEntryOk])).project_id === projId, r.body)
  check('… contre-épreuve : il modifie son temps sur son projet', (await marc.patch(`/api/time/entries/${marcEntryOk}`, { minutes: 20 })).status === 200)
  r = await marc.post('/api/time/timer/start', { project_id: projId, task_id: hiddenTask })
  check('POST /time/timer/start : tâche d’un projet réservé refusée', r.status === 400, r.body)
  r = await marc.put('/api/time/week/cell', { project_id: R, entry_date: addDays(today, -2), minutes: 60 })
  check('PUT /time/week/cell : projet réservé → 404, rien d’écrit', r.status === 404 &&
    (await q1('select count(*)::int as n from time_entries where project_id = $1 and entry_date = $2', [R, addDays(today, -2)])).n === 0, r.body)
  check('… contre-épreuve : l’intervenante remplit sa cellule',
    (await zoe.put('/api/time/week/cell', { project_id: R, entry_date: addDays(today, -2), minutes: 60 })).status === 200)

  // API v1 : une clé de Marc (membre).
  const marcKey = `pl_marc_${randomUUID()}`
  await pool.query('insert into api_keys (account_id, user_id, name, prefix, key_hash) values ($1,$2,$3,$4,encode(sha256($5::bytea), \'hex\'))',
    [accountId, marcId, 'Marc', marcKey.slice(0, 8), marcKey])
  r = await new Client().req('POST', '/api/v1/time', { project_id: R, entry_date: today, minutes: 10 }, { authorization: `Bearer ${marcKey}` })
  check('API v1 POST /time : projet réservé → 404, rien d’écrit', r.status === 404 &&
    (await q1('select count(*)::int as n from time_entries where project_id = $1 and user_id = $2 and minutes = 10', [R, marcId])).n === 0, r.body)
  r = await new Client().req('POST', '/api/v1/time', { project_id: projId, task_id: hiddenTask, entry_date: today, minutes: 10 }, { authorization: `Bearer ${marcKey}` })
  check('API v1 POST /time : tâche d’un projet réservé refusée', r.status === 400, r.body)
  r = await new Client().req('POST', '/api/v1/time', { project_id: projId, entry_date: today, minutes: 10 }, { authorization: `Bearer ${marcKey}` })
  check('… contre-épreuve : sur son projet, accepté', r.status === 201, r.body)

  // Rendez-vous.
  r = await marc.post('/api/calendar/events', { title: 'intrus', starts_at: `${today}T12:00:00+02:00`, ends_at: `${today}T13:00:00+02:00`, project_id: R })
  check('POST /calendar/events sur un projet réservé → 404', r.status === 404, r.body)
  r = await marc.patch(`/api/calendar/events/${evR}`, { title: 'piraté' })
  check('PATCH /calendar/events/:id d’un projet réservé → 404, titre gardé', r.status === 404 &&
    (await q1('select title from events where id = $1', [evR])).title === `Rendez-vous secret ${stamp}`, r.body)
  r = await marc.del(`/api/calendar/events/${evR}`)
  check('DELETE /calendar/events/:id d’un projet réservé → 404, gardé', r.status === 404 &&
    (await q1('select count(*)::int as n from events where id = $1', [evR])).n === 1, r.body)
  check('… contre-épreuve : l’intervenante le modifie', (await zoe.patch(`/api/calendar/events/${evR}`, { location: 'Salle 2' })).status === 200)
}

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
for (const bad of ['/%5Cevil.test', '//evil.test', 'https://evil.test/']) {
  // « /\evil.test » dans un Location relatif mène un navigateur sur evil.test : jamais repris comme page demandée.
  ll = await leadLogin((n) => lead(n, true), `?next=${bad}`)
  check(`page demandée « ${decodeURIComponent(bad)} » hors de ProjectLead : retour à l'accueil`, ll.location === '/', ll)
}
{
  // App mobile (agent « ProjectLeadApp ») : le départ demande platform=app, ERPlead y masque « Continuer avec Google »
  // (refusé par Google dans une vue web). Un navigateur ordinaire ne l'envoie jamais.
  const appUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ProjectLeadApp/1.0.0'
  const inApp = await app.request('http://localhost/auth/lead/start?next=/projets', { headers: { 'user-agent': appUa } })
  const web = await app.request('http://localhost/auth/lead/start?next=/projets', { headers: { 'user-agent': 'Mozilla/5.0 Safari/605.1.15' } })
  const platformOf = (r: Response) => { try { return new URL(r.headers.get('location') ?? '').searchParams.get('platform') } catch { return 'illisible' } }
  check('app mobile : départ vers le Compte Lead avec platform=app', inApp.status === 302 && platformOf(inApp) === 'app', inApp.headers.get('location'))
  check('navigateur : départ sans platform', web.status === 302 && platformOf(web) === null, web.headers.get('location'))
}
{
  // Le retour d'ERPlead arrive sur l'adresse sans www : un départ depuis www y est renvoyé avant de poser son cookie.
  const w = await app.request('http://www.localhost/auth/lead/start?next=/projets&signup=1')
  check('départ depuis www : renvoyé vers l’adresse du retour, sans cookie posé sur www',
    w.status === 302 && w.headers.get('location') === 'http://localhost/auth/lead/start?next=/projets&signup=1' && !w.headers.get('set-cookie'),
    { status: w.status, location: w.headers.get('location'), cookie: Boolean(w.headers.get('set-cookie')) })
}
{
  // Cookies refusés (le navigateur n'en garde aucun) et session ERPlead ouverte : départ, code rendu sans écran, retour
  // sans le cookie de départ → page de connexion avec « erreur=session » ; jamais un nouveau départ (boucle).
  let url = 'http://localhost/auth/lead/start?next=/projets', trips = 0
  for (let hop = 0; hop < 12; hop++) {
    const u = new URL(url)
    if (u.pathname === '/oauth/authorize') {
      trips++
      nextIdClaims = lead(u.searchParams.get('nonce') ?? '', true)
      url = `http://localhost/auth/lead/callback?code=c&state=${u.searchParams.get('state')}&iss=x`
      continue
    }
    if (u.hostname !== 'localhost' || !u.pathname.startsWith('/auth/')) break
    const res = await app.request(url)
    const loc = res.headers.get('location')
    if (!loc) break
    url = new URL(loc, url).href
  }
  check('cookies refusés : un seul passage chez ERPlead, puis la page de connexion « erreur=session » qui garde la page demandée (pas de boucle)',
    trips === 1 && url === `http://localhost/login?erreur=session&next=${encodeURIComponent('/projets')}`, { trips, url })
  const silent = await app.request('http://localhost/auth/lead/callback?error=login_required&state=perdu')
  check('retour d’ERPlead en erreur sans cookie de départ : page de connexion « erreur=session », pas de nouveau départ',
    silent.status === 302 && silent.headers.get('location') === '/login?erreur=session', silent.headers.get('location'))
  // Plus de 10 minutes sur le formulaire d'ERPlead : le cookie de départ vit une heure ; perdu quand même, le retour
  // ramène sur l'écran de connexion AVEC la page demandée (« Réessayer » y mène), sans nouveau départ automatique.
  const deepNext = '/projets/abc?onglet=taches'
  const slow = await app.request(`http://localhost/auth/lead/start?next=${encodeURIComponent(deepNext)}`)
  const maxAge = Number(/pl_lead_login=[^;]+;.*?Max-Age=(\d+)/i.exec(slow.headers.get('set-cookie') ?? '')?.[1] ?? 0)
  check('départ : le cookie de départ vit au moins 30 minutes (formulaire d’ERPlead rempli sans se presser)', maxAge >= 1800, slow.headers.get('set-cookie'))
  const slowTo = new URL(slow.headers.get('location') ?? 'http://x/')
  const lost = await app.request(`http://localhost/auth/lead/callback?code=c&state=${encodeURIComponent(slowTo.searchParams.get('state') ?? '')}&iss=x`)
  check('retour d’ERPlead après expiration du cookie de départ : « erreur=session » avec la page demandée, sans session ni nouveau départ',
    lost.status === 302 && lost.headers.get('location') === `/login?erreur=session&next=${encodeURIComponent(deepNext)}`
    && !/projectlead_session=/.test(lost.headers.get('set-cookie') ?? ''), lost.headers.get('location'))
  const forged = await app.request(`http://localhost/auth/lead/callback?code=c&state=x.${Buffer.from('//evil.test').toString('base64url')}`)
  check('… une page hors de ProjectLead glissée dans l’état n’est jamais reprise', forged.headers.get('location') === '/login?erreur=session', forged.headers.get('location'))
  // Un retour d'ERPlead en erreur AVEC le cookie de départ (accès refusé, connexion silencieuse impossible) : la page
  // de connexion avec l'erreur et la page demandée, sans session, et jamais un nouveau départ vers ERPlead.
  for (const err of ['login_required', 'access_denied']) {
    const start = await app.request('http://localhost/auth/lead/start?next=/projets/abc')
    const to = new URL(start.headers.get('location') ?? 'http://x/')
    const jar = (start.headers.get('set-cookie') ?? '').match(/pl_lead_login=[^;]+/)?.[0] ?? ''
    const back = await app.request(`http://localhost/auth/lead/callback?error=${err}&state=${to.searchParams.get('state')}`, { headers: { cookie: jar } })
    const loc = back.headers.get('location') ?? ''
    check(`retour d’ERPlead « ${err} » : page de connexion avec l’erreur et la page demandée, sans session ni nouveau départ`,
      back.status === 302 && loc === `/login?erreur=lead&next=${encodeURIComponent('/projets/abc')}` && !/projectlead_session=/.test(back.headers.get('set-cookie') ?? ''), loc)
  }
}
// Neon Functions ne garde que le dernier Set-Cookie d'une réponse : au retour, la session doit être le seul cookie.
check('retour du Compte Lead : un seul cookie posé, celui de la session', ll.cookies === 1, ll)
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
check('l’entreprise Lead devient l’espace ProjectLead', r.status === 200 && r.body.account?.name === `Entreprise lead-org-${stamp}`, r.body)
check('/me : l’organisation ERPlead de l’espace (data-lead-org des contrôles de la famille)', r.body.account?.lead_org === `lead-org-${stamp}`, r.body.account)
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
// Places : une deuxième personne de l'organisation gratuite (1 place) reste dehors, avec un message clair. Jamais un
// espace à part ni celui d'une autre entreprise (passage entre applications, 13.10.2026).
const accountsBefore = (await pool.query('select count(*)::int as n from accounts')).rows[0].n
ll = await leadLogin((n) => ({ ...lead(n, false, freeOrg), sub: `sub-collegue-${stamp}`, email: `collegue2-${stamp}@exemple.test`, org_role: 'user' }))
r = await pool.query(`select (select count(*)::int from accounts) as accounts,
  (select count(*)::int from account_users au join users u on u.id = au.user_id where u.lead_sub = $1) as places`, [`sub-collegue-${stamp}`])
check('gratuit (1 place) : une deuxième personne de l’organisation voit « Toutes les places ProjectLead de votre entreprise sont prises », sans session ni espace à part',
  ll.location === '/login?erreur=places&formule=free' && !ll.session && r.rows[0].accounts === accountsBefore && r.rows[0].places === 0,
  { loc: ll.location, session: Boolean(ll.session), ...r.rows[0], accountsBefore })
// Une adresse pas encore confirmée chez le Compte Lead : un message clair, pas de boucle, rien de créé.
ll = await leadLogin((n) => ({ ...lead(n, false, `non-confirme-${stamp}`), email_verified: false }))
check('adresse pas encore confirmée : écran « confirmez votre adresse », rien de créé', ll.location === '/login?erreur=email' && !ll.session, ll)
ll = await leadLogin((n) => ({ ...lead(n, false, `non-confirme-${stamp}`), email_verified: false }), '?next=/invitation/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG')
check('… la page demandée (une invitation) est gardée pour « J’ai confirmé mon adresse, entrer »',
  ll.location === `/login?erreur=email&next=${encodeURIComponent('/invitation/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG')}` && !ll.session, ll)
{
  // Deux collègues d'une organisation sans espace arrivent au même instant (deux applications ouvertes) : un seul espace.
  const { attachLeadPerson } = await import('../server/routes/auth.js')
  const twinOrg = `jumeaux-org-${stamp}`
  const twin = (who: string) => ({ ...lead('', true, twinOrg), lead: rights('pro_plus'), sub: `sub-${who}-${stamp}`, email: `${who}-${stamp}@exemple.test`,
    org_role: who === 'zoe' ? 'admin' : 'user' }) as any
  const both = await Promise.all([attachLeadPerson(twin('zoe')), attachLeadPerson(twin('yan'))])
  const n = (await pool.query('select count(*)::int as n from accounts where lead_org = $1', [twinOrg])).rows[0].n
  check('deux collègues arrivés au même instant : un seul espace pour leur organisation, tous deux dedans', n === 1 && both[0].accountId === both[1].accountId, { n, both })
}
// Une personne désactivée dans l'espace de son organisation n'y tourne pas en boucle, et n'entre pas ailleurs : un écran le dit.
const annOrg = `ann-org-${stamp}`
const annPlan = rights('pro_plus')
ll = await leadLogin((n) => ({ ...lead(n, true, annOrg), lead: annPlan }))
const annAdmin = new Client(); annAdmin.cookie = ll.session
ll = await leadLogin((n) => ({ ...lead(n, true, annOrg), lead: annPlan, sub: `sub-ann-${stamp}`, email: `ann-${stamp}@exemple.test`, org_role: 'user' }))
const annId = (await pool.query('select id from users where lead_sub = $1', [`sub-ann-${stamp}`])).rows[0]?.id
r = await annAdmin.post(`/api/team/members/${annId}/remove`)
check('l’administrateur retire Ann', r.status === 200, r)
const annLogin = () => leadLogin((n) => ({ ...lead(n, true, annOrg), lead: annPlan, sub: `sub-ann-${stamp}`, email: `ann-${stamp}@exemple.test`, org_role: 'user' }))
ll = await annLogin()
r = await pool.query(`select count(*)::int as n from account_users au where au.user_id = $1`, [annId])
check('Ann désactivée par l’administrateur se reconnecte : écran « accès désactivé », sans session, pas de boucle ni d’espace à part',
  ll.location === '/login?erreur=desactive' && !ll.session && r.rows[0].n === 1, { loc: ll.location, places: r.rows[0].n })
r = await annAdmin.post('/api/team/invite', { email: `ann-${stamp}@exemple.test` })
ll = await annLogin()
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
check('réinvitée par l’administrateur : Ann rentre par le Compte Lead dans l’espace de son entreprise', ll.location === '/' && r.status === 200
  && r.body.account?.lead_org === annOrg, { loc: ll.location, account: r.body?.account })
// Une organisation Pro+ (5 places) et un membre local venu d'une autre organisation, gratuite.
const plusOrg = `plus-org-${stamp}`
const plusLead = (n: string) => ({ ...lead(n, true, plusOrg), lead: rights('pro_plus') })
ll = await leadLogin(plusLead)
const plus = new Client(); plus.cookie = ll.session
r = await plus.post('/api/team/invite', { email: `paul-${stamp}@exemple.test` })
check('Pro+ : inviter passe', r.status === 201 || r.status === 200, r)
const paulToken = String(r.body.link ?? '').split('/').pop()
r = await new Client().get(`/api/auth/invitation/${paulToken}`)
check('invitation : la page sait que le Compte Lead est branché, et que Paul n’a pas de mot de passe ProjectLead',
  r.status === 200 && r.body.leadId === true && r.body.hasPassword === false, r.body)
r = await new Client().post(`/api/auth/invitation/${paulToken}/accept`, { name: 'Paul', password: 'motdepasse-solide' })
check('Compte Lead branché : pas de nouveau mot de passe ProjectLead pour accepter (403 invitation_via_lead)', r.status === 403 && r.body.error === 'invitation_via_lead', r)
const paulLead = (n: string) => ({ ...lead(n, false, `paul-org-${stamp}`), sub: `sub-paul-${stamp}`, email: `paul-${stamp}@exemple.test`, org_role: 'admin' })
// Une autre adresse que celle de l'invitation : elle n'est pas prise, la page de l'invitation le dit.
ll = await leadLogin((n) => ({ ...paulLead(n), sub: `sub-paul-autre-${stamp}`, email: `paul-autre-${stamp}@exemple.test`, org: `paul-autre-org-${stamp}` }),
  `?next=/invitation/${paulToken}`)
r = await pool.query('select accepted_at from invitations where token_hash = $1', [hashTokenSmoke(paulToken)])
check('invitation ouverte avec un Compte Lead d’une autre adresse : pas prise, retour sur l’invitation avec le message',
  ll.location === `/invitation/${paulToken}?erreur=adresse` && r.rows[0]?.accepted_at === null, { loc: ll.location, row: r.rows[0] })
ll = await leadLogin(paulLead, `?next=/invitation/${paulToken}`)
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
const plusPlan = (await pool.query('select plan from accounts where lead_org = $1', [plusOrg])).rows[0]?.plan
check('Pro+ : Paul accepte l’invitation avec son Compte Lead, sans mot de passe, et entre dans l’entreprise Pro+ (formule gardée)',
  ll.location === '/' && r.status === 200 && r.body.account?.lead_org === plusOrg && r.body.plan?.tier === 'pro_plus' && plusPlan === 'pro_plus',
  { loc: ll.location, account: r.body.account, plan: r.body.plan?.tier, plusPlan })
r = await pool.query('select accepted_at from invitations where token_hash = $1', [hashTokenSmoke(paulToken)])
check('l’invitation est prise (une seule fois)', r.rows[0]?.accepted_at !== null, r.rows[0])
ll = await leadLogin(paulLead)
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
// Paul a créé son Compte Lead pour accepter (nouvelle organisation, sans espace ici) : il retrouve l'entreprise qui l'a
// invité à chaque arrivée, et aucun espace vide n'est créé pour son organisation (il cacherait cette entreprise).
check('arrivée suivante de Paul (son organisation n’a pas d’espace ici) : l’entreprise qui l’a invité, aucun espace vide créé',
  r.status === 200 && r.body.account?.lead_org === plusOrg
  && (await pool.query('select count(*)::int as n from accounts where lead_org = $1', [`paul-org-${stamp}`])).rows[0].n === 0, r.body.account)
check('… sans que la formule de l’organisation de Paul (Gratuit) remplace celle de l’entreprise qui l’a invité',
  (await pool.query('select plan from accounts where lead_org = $1', [plusOrg])).rows[0]?.plan === 'pro_plus' && r.body.plan?.tier === 'pro_plus', r.body.plan)
// Une entreprise d'avant le Compte Lead ne se lie pas à l'organisation personnelle d'un simple membre.
const localAcc = (await pool.query(`insert into accounts (name) values ('Atelier local ${stamp}') returning id`)).rows[0].id
const localAdmin = (await pool.query(`insert into users (email, name) values ($1, 'Admin local') returning id`, [`admin-local-${stamp}@exemple.test`])).rows[0].id
const localMember = (await pool.query(`insert into users (email, name) values ($1, 'Marc local') returning id`, [`marc-local-${stamp}@exemple.test`])).rows[0].id
await pool.query(`insert into account_users (account_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'member')`, [localAcc, localAdmin, localMember])
ll = await leadLogin((n) => ({ ...lead(n, false, `marc-org-${stamp}`), sub: `sub-marc-local-${stamp}`, email: `marc-local-${stamp}@exemple.test`, org_role: 'admin' }))
r = await pool.query('select lead_org, plan from accounts where id = $1', [localAcc])
check('entreprise locale : un simple membre ne la lie pas à son organisation gratuite (et elle naît en Gratuit, plus en Pro)',
  ll.session.length > 30 && r.rows[0].lead_org === null && r.rows[0].plan === 'free', { row: r.rows[0], loc: ll.location })
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
check('… il entre dans l’entreprise dont il est membre (comme avant le passage), sans espace vide pour son organisation',
  r.body.account?.id === localAcc && r.body.user?.role === 'member'
  && (await pool.query('select count(*)::int as n from accounts where lead_org = $1', [`marc-org-${stamp}`])).rows[0].n === 0, r.body.account)
{
  // Entreprise d'avant le Compte Lead, MÊME organisation ERPlead : le membre arrive avant l'administratrice. Il entre dans
  // l'entreprise (sans la lier) ; l'administratrice la relie ensuite à l'organisation, avec tous ses projets.
  const org = `menuiserie-org-${stamp}`
  const shop = (await pool.query(`insert into accounts (name) values ('Menuiserie ${stamp}') returning id`)).rows[0].id
  const boss = (await pool.query(`insert into users (email, name) values ($1, 'Admin menuiserie') returning id`, [`admin-menuiserie-${stamp}@exemple.test`])).rows[0].id
  const worker = (await pool.query(`insert into users (email, name) values ($1, 'Membre menuiserie') returning id`, [`membre-menuiserie-${stamp}@exemple.test`])).rows[0].id
  await pool.query(`insert into account_users (account_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'member')`, [shop, boss, worker])
  await pool.query(`insert into projects (account_id, name, owner_id, created_by) values ($1, 'Cuisine Dupuis', $2, $2)`, [shop, boss])
  const as = (who: string, role: string) => (n: string) => ({ ...lead(n, false, org), sub: `sub-${who}-menuiserie-${stamp}`, email: `${who}-menuiserie-${stamp}@exemple.test`, org_role: role })
  const m = await leadLogin(as('membre', 'user'))
  const mMe = await new Client().req('GET', '/api/me', undefined, { cookie: m.session })
  check('membre d’abord (même organisation, entreprise d’avant le Compte Lead) : il entre dans l’entreprise, en membre, sans espace créé',
    mMe.body.account?.id === shop && mMe.body.user?.role === 'member' && mMe.body.account?.lead_org === null
    && (await pool.query('select count(*)::int as n from accounts where lead_org = $1', [org])).rows[0].n === 0, { account: mMe.body.account, role: mMe.body.user?.role })
  const a = await leadLogin(as('admin', 'admin'))
  const aMe = await new Client().req('GET', '/api/me', undefined, { cookie: a.session })
  check('… l’administratrice ensuite : l’entreprise (et ses projets) devient celle de l’organisation, un seul espace',
    aMe.body.account?.id === shop && aMe.body.account?.lead_org === org && aMe.body.user?.role === 'admin'
    && (await pool.query('select count(*)::int as n from accounts where lead_org = $1', [org])).rows[0].n === 1, aMe.body.account)
  const m2 = await leadLogin(as('membre', 'user'))
  const m2Me = await new Client().req('GET', '/api/me', undefined, { cookie: m2.session })
  check('… et le membre y revient, en membre, avec les projets', m2Me.body.account?.id === shop && m2Me.body.user?.role === 'member'
    && (await new Client().req('GET', '/api/projects', undefined, { cookie: m2.session })).body?.some?.((p: any) => p.name === 'Cuisine Dupuis'), m2Me.body.account)
}
{
  // Organisation en Gratuit (1 place) : une simple membre ouvre ProjectLead la première. Elle y entre en membre (rôle
  // d'ERPlead), jamais en administratrice ; l'administratrice d'ERPlead n'est pas enfermée dehors ensuite.
  const org = `gratuit-membre-org-${stamp}`
  const as = (who: string, role: string) => (n: string) => ({ ...lead(n, false, org), sub: `sub-${who}-gm-${stamp}`, email: `${who}-gm-${stamp}@exemple.test`, org_role: role })
  const m = await leadLogin(as('membre', 'user'))
  const mMe = await new Client().req('GET', '/api/me', undefined, { cookie: m.session })
  check('gratuit : une simple membre crée l’espace de son organisation en membre (rôle d’ERPlead), pas en administratrice',
    mMe.body.account?.lead_org === org && mMe.body.user?.role === 'member', { account: mMe.body.account, role: mMe.body.user?.role })
  const a = await leadLogin(as('admin', 'admin'))
  const aMe = await new Client().req('GET', '/api/me', undefined, { cookie: a.session })
  check('… l’administratrice d’ERPlead arrive ensuite : elle entre, administratrice, malgré la place prise (sinon personne ne gère l’espace)',
    a.location === '/' && aMe.body.account?.lead_org === org && aMe.body.user?.role === 'admin', { loc: a.location, account: aMe.body.account, role: aMe.body.user?.role })
  const n = await leadLogin(as('collegue', 'user'))
  check('… une autre collègue voit ensuite « places prises » (un administrateur peut maintenant libérer une place ou changer de formule)',
    n.location === '/login?erreur=places&formule=free' && !n.session, n.location)
  const b = await leadLogin(as('admin2', 'admin'))
  check('… une 2e administratrice d’ERPlead aussi : la place garantie ne vaut que pour un espace sans administrateur',
    b.location === '/login?erreur=places&formule=free' && !b.session, b.location)
  // Devenue administratrice chez ERPlead : elle le devient ici aussi, dans l'espace de son organisation (jamais l'inverse).
  const up = await leadLogin(as('membre', 'admin'))
  const upMe = await new Client().req('GET', '/api/me', undefined, { cookie: up.session })
  check('membre devenue administratrice chez ERPlead : administratrice ici aussi à l’arrivée suivante', upMe.body.user?.role === 'admin', upMe.body.user)
  const down = await leadLogin(as('membre', 'user'))
  const downMe = await new Client().req('GET', '/api/me', undefined, { cookie: down.session })
  check('… jamais rétrogradée automatiquement', downMe.body.user?.role === 'admin', downMe.body.user)
}
// L'administratrice d'une entreprise d'avant le Compte Lead, administratrice chez ERPlead aussi : l'entreprise devient la sienne.
const oldAcc = (await pool.query(`insert into accounts (name) values ('Atelier ancien ${stamp}') returning id`)).rows[0].id
const oldAdmin = (await pool.query(`insert into users (email, name) values ($1, 'Admin ancienne') returning id`, [`admin-ancienne-${stamp}@exemple.test`])).rows[0].id
await pool.query(`insert into account_users (account_id, user_id, role) values ($1,$2,'admin')`, [oldAcc, oldAdmin])
ll = await leadLogin((n) => ({ ...lead(n, false, `ancienne-org-${stamp}`), sub: `sub-ancienne-${stamp}`, email: `admin-ancienne-${stamp}@exemple.test`, org_role: 'admin' }))
r = await new Client().req('GET', '/api/me', undefined, { cookie: ll.session })
check('entreprise d’avant le Compte Lead, administratrice des deux côtés : reliée à son organisation, aucun espace en plus',
  r.body.account?.id === oldAcc && r.body.account?.lead_org === `ancienne-org-${stamp}`
  && (await pool.query('select count(*)::int as n from accounts where lead_org = $1', [`ancienne-org-${stamp}`])).rows[0].n === 1, r.body.account)
// Une invitation en attente quand la formule baisse : son acceptation est refusée, puis une réactivation aussi.
r = await plus.post('/api/team/invite', { email: `yves-${stamp}@exemple.test` })
const yvesToken = String(r.body.link ?? '').split('/').pop()
entitlementsByOrg[plusOrg] = rights('free')
await refreshLeadPlans()
r = await new Client().post(`/api/auth/invitation/${yvesToken}/accept`, { name: 'Yves', password: 'motdepasse-solide' })
check('formule descendue en gratuit : une ancienne invitation ne fait plus entrer (402)', r.status === 402 && r.body.error === 'plan_limit_seats', r)
ll = await leadLogin((n) => ({ ...lead(n, false, `yves-org-${stamp}`), sub: `sub-yves-${stamp}`, email: `yves-${stamp}@exemple.test`, org_role: 'admin' }),
  `?next=/invitation/${yvesToken}`)
check('… ni par le Compte Lead : écran « places prises », pas de session, invitation gardée',
  ll.location === `/login?erreur=places&formule=free&next=${encodeURIComponent(`/invitation/${yvesToken}`)}` && !ll.session
  && (await pool.query('select accepted_at from invitations where token_hash = $1', [hashTokenSmoke(yvesToken)])).rows[0]?.accepted_at === null, ll)
const paulId = (await pool.query('select id from users where lower(email) = lower($1)', [`paul-${stamp}@exemple.test`])).rows[0].id
r = await plus.post(`/api/team/members/${paulId}/remove`)
check('retirer une personne passe', r.status === 200, r)
r = await plus.post(`/api/team/members/${paulId}/restore`)
check('la rétablir quand toutes les places sont prises → 402', r.status === 402 && r.body.error === 'plan_limit_seats', r)
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

section('Arrivée : adresse d’entrée /login, racine, liens profonds, un seul départ (src/lib/arrival.ts)')
{
  const { sameSitePath, requestedPage, leadStart, alreadyInTarget, departsAlone, REFUSED, startLeaving, stopLeaving, isLeaving, leave, leavingState, watchLeaving } = await import('../src/lib/arrival.js')
  // Une personne sortie par ERPlead AVANT le passage (db/009_passage.sql : rien ne distingue cette sortie d'une
  // désactivation par un administrateur) voit aussi cet écran : il ne doit pas accuser un administrateur, et donne le remède.
  check('écran « accès désactivé » : juste quelle que soit la cause (administrateur, ou départ annoncé par ERPlead avant le passage), avec le remède',
    !/a désactivé/.test(REFUSED.desactive.text) && /Réglages → Équipe/.test(REFUSED.desactive.text) && /Réglages → Équipe/.test(REFUSED.places.text), REFUSED.desactive)
  // Session ProjectLead ouverte : /login (adresse d'entrée du lanceur) mène tout droit dans l'espace, ou sur la page demandée.
  check('/login avec une session : l’accueil de l’espace', alreadyInTarget(null) === '/')
  check('/login?next=/projets avec une session : la page demandée', alreadyInTarget('/projets') === '/projets')
  check('/login?next=… hors de ProjectLead ou vers /login : l’accueil, jamais un autre site ni une boucle',
    ['//evil.test', '/\\evil.test', 'https://evil.test/', '/login', '/login?next=/login', '/signup'].every((v) => alreadyInTarget(v) === '/'))
  check('page demandée : chemins de ProjectLead seulement (mêmes règles que safeNext du serveur)',
    sameSitePath('/projets?x=1') === '/projets?x=1' && ['//a.b', '/\\a.b', 'a.b', '/a\u0000b', `/${'x'.repeat(2048)}`, null, undefined].every((v) => sameSitePath(v as string) === undefined))
  // Sans session : la racine tapée, l'adresse d'entrée et un lien profond font UN départ vers le Compte Lead, sans prompt.
  const root = leadStart(requestedPage('/', ''))
  const entry = leadStart(requestedPage('/login', ''))
  const deep = leadStart(requestedPage('/projets/abc', '?onglet=taches'))
  const entryNext = leadStart(requestedPage('/login', `?next=${encodeURIComponent('/projets/abc')}`))
  check('racine tapée sans session : un départ vers le Compte Lead, sans prompt (pas de page publique dans ProjectLead)', root === '/auth/lead/start', root)
  check('adresse d’entrée /login sans session : le même départ', entry === '/auth/lead/start', entry)
  check('lien profond sans session : départ qui garde la page demandée', deep === `/auth/lead/start?next=${encodeURIComponent('/projets/abc?onglet=taches')}`, deep)
  check('/login?next=… sans session : départ qui garde la page demandée', entryNext === `/auth/lead/start?next=${encodeURIComponent('/projets/abc')}`, entryNext)
  check('départ : jamais prompt=none ni une page hors de ProjectLead', ![root, entry, deep, entryNext].some((u) => /prompt/.test(u))
    && leadStart('//evil.test') === '/auth/lead/start' && leadStart(requestedPage('/login', '?next=%2F%2Fevil.test')) === '/auth/lead/start')
  check('inscription : départ avec signup=1', leadStart(null, true) === '/auth/lead/start?signup=1')
  check('« Changer de compte » (refus) : départ avec switch=1, page demandée gardée', leadStart(null, false, true) === '/auth/lead/start?switch=1'
    && leadStart('/projets', false, true) === `/auth/lead/start?switch=1&next=${encodeURIComponent('/projets')}`, leadStart('/projets', false, true))
  // Un seul départ automatique : après un retour en erreur, seul un clic relance (anti-boucle).
  check('écran de connexion : part seul une fois (Compte Lead branché, sans erreur)', departsAlone({ leadId: true, code: '', withEmail: false }))
  check('… jamais après un retour en erreur, ni sur l’accès par e-mail, ni sans Compte Lead',
    ['lead', 'session', 'email', 'places', 'desactive', 'portee'].every((code) => !departsAlone({ leadId: true, code, withEmail: false }))
    && !departsAlone({ leadId: true, code: '', withEmail: true }) && !departsAlone({ leadId: false, code: '', withEmail: false }) && !departsAlone({ leadId: null, code: '', withEmail: false }))
  // « Se déconnecter » en route (startLeaving, 15.10.2026) : sous un Compte Lead lent, la relecture de /me voyait un 401 et
  // l'écran de connexion repartait seul, coupant la déconnexion d'ERPlead (la personne rentrait sans formulaire).
  startLeaving()
  check('pendant « Se déconnecter » : l’écran de connexion ne part pas seul vers le Compte Lead (la déconnexion d’ERPlead va au bout)',
    isLeaving() && !departsAlone({ leadId: true, code: '', withEmail: false }))
  stopLeaving()
  check('… et repart seul une fois la déconnexion abandonnée (échec, retour par le cache arrière)', !isLeaving() && departsAlone({ leadId: true, code: '', withEmail: false }))
  // « Se déconnecter » cliqué deux fois sous un Compte Lead lent (leave, relecture du 20.10.2026) : le 2e POST partait
  // sans cookie, recevait « /login », et cette navigation coupait la déconnexion d'ERPlead encore en route (la page /login
  // neuve repartait vers le Compte Lead, toujours ouvert : la personne rentrait sans formulaire). Le parcours du bouton,
  // contre le vrai POST /api/auth/logout ; dans un navigateur : scripts/e2e-deconnexion.mjs.
  {
    const ll2 = await leadLogin((n) => lead(n, true, `deux-clics-${stamp}`), '?next=/')
    const browser = new Client(); browser.cookie = ll2.session
    let posts = 0, release!: () => void
    const held = new Promise<void>((r) => { release = r })
    // La réponse arrive quand on la libère : un Compte Lead lent, une personne qui clique entre-temps.
    const post = async () => { posts++; const r = await browser.post('/api/auth/logout'); await held; return r.body as { redirect: string | null } }
    const went: string[] = []
    const go = (to: string) => { went.push(to) }
    let seen = 0
    const unwatch = watchLeaving(() => { seen++ })
    const first = leave(post, go)
    await leave(post, go)
    check('« Se déconnecter », 2e clic avant la réponse : rien (ni 2e fermeture de session, ni navigation), bouton « Déconnexion… » désactivé',
      posts === 1 && went.length === 0 && isLeaving() && leavingState()?.to === null, { posts, went })
    release(); await first
    const out = went[0] ?? ''
    check('… 1er clic : la session se ferme une fois (cookie effacé), puis la déconnexion du Compte Lead (id_token_hint)',
      posts === 1 && went.length === 1 && out.includes('/oauth/logout?') && out.includes('id_token_hint=') && !browser.cookie && leavingState()?.to === out,
      { posts, went, cookie: browser.cookie })
    await leave(post, go)
    check('… 2e clic après la réponse (rien ne bouge, Échap, Stop) : la même sortie vers le Compte Lead relancée, jamais /login, pas de 2e POST',
      posts === 1 && went.length === 2 && went[1] === out, { posts, went })
    const naked = await browser.post('/api/auth/logout')
    check('… ce qu’un 2e POST aurait reçu, sans cookie : aucune sortie vers le Compte Lead (d’où « /login » avant)', naked.status === 200 && naked.body?.redirect === null, naked.body)
    check('… le bouton suit la sortie (useSyncExternalStore) : prévenu au départ, puis à la réponse', seen === 2, seen)
    stopLeaving()
    const failing = async (): Promise<{ redirect: string | null }> => { posts++; throw new Error('hors connexion') }
    const err = await leave(failing, go).then(() => null, (e: Error) => e)
    check('… fermeture de session en échec : erreur rendue, sortie abandonnée (l’écran de connexion repart), un nouveau clic refait le POST',
      err?.message === 'hors connexion' && !isLeaving() && leavingState() === null && posts === 2 && went.length === 2, { err: err?.message, posts, went })
    unwatch()
  }
  // Le parcours complet sans session ERPlead (simulé) : racine → départ → ERPlead (formulaire, pas de renvoi) ; avec une
  // erreur au retour → /login?erreur=… qui ne repart pas : au plus UN passage chez ERPlead.
  let trips = 0, url = `http://localhost${root}`, jar = ''
  for (let hop = 0; hop < 12; hop++) {
    const u = new URL(url)
    if (u.pathname === '/oauth/authorize') { trips++; url = `http://localhost/auth/lead/callback?error=login_required&state=${u.searchParams.get('state')}`; continue }
    if (u.pathname === '/login') {
      const p = new URLSearchParams(u.search)
      if (!departsAlone({ leadId: true, code: p.get('erreur') ?? '', withEmail: p.get('acces') === 'email' })) break
      url = `http://localhost${leadStart(requestedPage(u.pathname, u.search))}`
      continue
    }
    const res = await app.request(url, { headers: { cookie: jar } })
    jar = (res.headers.get('set-cookie') ?? '').match(/pl_lead_login=[^;]+/)?.[0] ?? jar
    const loc = res.headers.get('location')
    if (!loc) break
    url = new URL(loc, url).href
  }
  check('racine sans session, ERPlead en erreur : un seul passage chez ERPlead, puis l’écran de connexion qui attend un clic',
    trips === 1 && new URL(url).pathname === '/login' && new URL(url).searchParams.get('erreur') === 'lead', { trips, url })
  // L'adresse « fresh » des liens d'ERPlead (invitation acceptée, adresse confirmée) : repasse par ERPlead et remplace
  // la session d'une autre personne sur ce navigateur ; la personne arrive dans l'espace de SON entreprise.
  const before = await leadLogin((n) => lead(n, true, `fresh-a-${stamp}`))
  const fresh = await leadLogin((n) => lead(n, true, `fresh-b-${stamp}`), '?locale=de&fresh=1')
  const meFresh = await new Client().req('GET', '/api/me', undefined, { cookie: fresh.session })
  check('adresse « fresh » d’ERPlead (/auth/lead/start?locale=de&fresh=1) : départ sans prompt, nouvelle session dans l’espace de son entreprise',
    fresh.authorize.pathname === '/oauth/authorize' && !fresh.authorize.searchParams.has('prompt') && fresh.location === '/'
    && fresh.session && fresh.session !== before.session && meFresh.body.account?.lead_org === `fresh-b-${stamp}`, { loc: fresh.location, account: meFresh.body.account })
}
section('Départ d’une personne : OpenID Back-Channel Logout')
{
  const org = `bc-org-${stamp}`
  // Forme d'avant le calcul par application (sans `app` ni `source`) : toujours acceptée.
  const plus = { plan: { code: 'pro_plus', name: 'Pro+', rank: 20, seats: 5 }, apps: { projectlead: { access: true, name: 'ProjectLead', url: null, status: 'live', upgrade_url: null } }, subscriptions: [] }
  const person = (n: string, sub: string, role: string) => ({ sub, nonce: n, email: `${sub}@exemple.test`, email_verified: true, name: sub, locale: 'fr', org, org_name: `Entreprise ${org}`, org_role: role, lead: plus })
  const boss = await leadLogin((n) => person(n, `boss-${stamp}`, 'admin'))
  let bob = await leadLogin((n) => person(n, `bob-${stamp}`, 'user'))
  const me = async (cookie: string) => (await new Client().req('GET', '/api/me', undefined, { cookie })).status
  check('deux personnes de la même organisation connectées', (await me(boss.session)) === 200 && (await me(bob.session)) === 200)
  const accountOf = async (cookie: string) => (await new Client().req('GET', '/api/me', undefined, { cookie })).body?.account?.id
  check('… dans le même espace, celui de leur organisation (rejoint, pas un second espace)', (await accountOf(boss.session)) === (await accountOf(bob.session))
    && (await pool.query('select count(*)::int as n from accounts where lead_org = $1', [org])).rows[0].n === 1)
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
  check('départ annoncé pour une organisation sans espace ici : ses sessions tombent quand même (Compte Lead fermé), sa place ne bouge pas',
    (await post(logoutToken(`bob-${stamp}`, { org: 'org-inconnue' }))) === 200 && (await me(bob.session)) === 401
    && (await pool.query(`select au.active from account_users au join users u on u.id = au.user_id where u.lead_sub = $1`, [`bob-${stamp}`])).rows[0]?.active === true)
  bob = await leadLogin((n) => person(n, `bob-${stamp}`, 'user'))
  check('départ : 200, la session ouverte tombe aussitôt', (await post(logoutToken(`bob-${stamp}`))) === 200 && (await me(bob.session)) === 401)
  const row = (await pool.query(`select au.active from account_users au join users u on u.id = au.user_id where u.lead_sub = $1`, [`bob-${stamp}`])).rows[0]
  check('la personne devient inactive dans l’entreprise (place libérée)', row?.active === false, row)
  check('l’administratrice garde sa session', (await me(boss.session)) === 200)
  check('rejouer le départ ne casse rien', (await post(logoutToken(`bob-${stamp}`))) === 200)
  check('dernier administrateur : sa session tombe, il reste actif', (await post(logoutToken(`boss-${stamp}`))) === 200 && (await me(boss.session)) === 401
    && (await pool.query(`select au.active from account_users au join users u on u.id = au.user_id where u.lead_sub = $1`, [`boss-${stamp}`])).rows[0]?.active === true)
  // ERPlead la laisse revenir dans la même organisation : elle reprend sa place, sans administrateur ni écran (db/009_passage.sql).
  const back = await leadLogin((n) => person(n, `bob-${stamp}`, 'user'))
  const again = (await pool.query(`select au.active, au.lead_disabled from account_users au join users u on u.id = au.user_id where u.lead_sub = $1`, [`bob-${stamp}`])).rows
  check('revenue chez ERPlead dans la même organisation : elle rentre dans l’espace, place reprise', back.location === '/' && (await me(back.session)) === 200
    && again.length === 1 && again[0].active === true && again[0].lead_disabled === false, { loc: back.location, again })
  // Déconnexion ailleurs (« logout ») : toutes ses sessions tombent, même si l'organisation annoncée n'a pas d'espace ici ; sa place reste.
  const loggedOut = await post(logoutToken(`bob-${stamp}`, { org: 'org-inconnue', lead_status: 'logout' }))
  const kept = (await pool.query(`select au.active from account_users au join users u on u.id = au.user_id where u.lead_sub = $1`, [`bob-${stamp}`])).rows
  check('déconnexion ailleurs (logout) : 200, toutes ses sessions tombent, sa place reste', loggedOut === 200
    && (await me(back.session)) === 401 && kept.length === 1 && kept[0].active === true, { loggedOut, kept })
}
section('Déconnexion dans un navigateur : seulement ses sessions (sid d’ERPlead) ; départ : toutes')
{
  // Décision d'Ève (13.10.2026) : se déconnecter sur l'ordinateur ne coupe pas ses autres appareils.
  const org = `sid-org-${stamp}`, sub = `carol-${stamp}`
  const plus = { plan: { code: 'pro_plus', name: 'Pro+', rank: 20, seats: 5 }, apps: { projectlead: { access: true, name: 'ProjectLead', url: null, status: 'live', upgrade_url: null } }, subscriptions: [] }
  const carol = (n: string, sid: string | undefined) => ({ sub, nonce: n, email: `${sub}@exemple.test`, email_verified: true, name: 'Carol', locale: 'fr',
    org, org_name: `Entreprise ${org}`, org_role: 'user', lead: plus, sid })
  const sidA = `sid-a-${stamp}`, sidB = `sid-b-${stamp}`
  const owner = await leadLogin((n) => ({ ...carol(n, `sid-boss-${stamp}`), sub: `boss2-${stamp}`, email: `boss2-${stamp}@exemple.test`, org_role: 'admin' }))
  const A = await leadLogin((n) => carol(n, sidA))
  const B = await leadLogin((n) => carol(n, sidB))
  const L = await leadLogin((n) => carol(n, undefined))
  const tokenOf = (cookie: string) => hashTokenSmoke(cookie.split('=')[1] ?? '')
  const sidOf = async (cookie: string) => (await pool.query('select lead_sid from sessions where token_hash = $1', [tokenOf(cookie)])).rows[0]?.lead_sid
  check('retour du Compte Lead : le sid du jeton d’identité est gardé avec la session (et nul pour une connexion qui n’en a pas)',
    (await sidOf(A.session)) === sidA && (await sidOf(B.session)) === sidB && (await sidOf(L.session)) === null,
    { a: await sidOf(A.session), b: await sidOf(B.session), l: await sidOf(L.session) })
  // Une session dans une autre entreprise (fiduciaire), ouverte dans le navigateur B.
  const userId = (await pool.query('select id from users where lead_sub = $1', [sub])).rows[0].id
  const other = (await pool.query(`insert into accounts (name, plan) values ($1, 'free') returning id`, [`Fiduciaire ${stamp}`])).rows[0].id
  await pool.query(`insert into account_users (account_id, user_id, role) values ($1, $2, 'member')`, [other, userId])
  const xToken = `x-${randomUUID()}`
  await pool.query(`insert into sessions (token_hash, user_id, account_id, expires_at, lead_sid) values ($1, $2, $3, now() + interval '1 day', $4)`,
    [hashTokenSmoke(xToken), userId, other, sidB])
  const X = `projectlead_session=${xToken}`
  const me = async (cookie: string) => (await new Client().req('GET', '/api/me', undefined, { cookie })).status
  const logoutToken = (over: Record<string, unknown>) => {
    const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
    const iat = Math.floor(Date.now() / 1000)
    const p = b64({ iss: process.env.LEAD_ID_ISSUER, aud: 'projectlead', iat, exp: iat + 120, sub, org,
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, ...over })
    return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`
  }
  const post = async (token: string) => (await app.request('http://localhost/auth/lead/backchannel-logout', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: token }) })).status
  check('quatre sessions ouvertes (navigateurs A et B, une d’avant le sid, une autre entreprise)',
    (await me(A.session)) === 200 && (await me(B.session)) === 200 && (await me(L.session)) === 200 && (await me(X)) === 200)
  check('déconnexion dans le navigateur A (logout, sid A) : la session A et celle d’avant le sid tombent ; B et l’autre entreprise restent',
    (await post(logoutToken({ lead_status: 'logout', sid: sidA }))) === 200
    && (await me(A.session)) === 401 && (await me(L.session)) === 401 && (await me(B.session)) === 200 && (await me(X)) === 200)
  check('déconnexion d’un navigateur sans session ici : rien ne tombe',
    (await post(logoutToken({ lead_status: 'logout', sid: `sid-z-${stamp}` }))) === 200 && (await me(B.session)) === 200 && (await me(X)) === 200)
  // Compatibilité : l'ERPlead en ligne n'émet pas encore de `sid` (il est mis en ligne en dernier). Un `logout_token`
  // sans `sid` (ou avec un `sid` illisible) ferme TOUTES les sessions de la personne : jamais une session laissée
  // ouverte, jamais une erreur.
  const A3 = await leadLogin((n) => carol(n, sidA))
  check('logout SANS sid (ERPlead d’avant le sid) : 200, toutes ses sessions tombent (navigateurs A et B, autre entreprise)',
    (await me(A3.session)) === 200 && (await me(B.session)) === 200 && (await me(X)) === 200
    && (await post(logoutToken({ lead_status: 'logout' }))) === 200
    && (await me(A3.session)) === 401 && (await me(B.session)) === 401 && (await me(X)) === 401)
  const fresh2 = async () => {
    const s = await leadLogin((n) => carol(n, sidB))
    const t = `x-${randomUUID()}`
    await pool.query(`insert into sessions (token_hash, user_id, account_id, expires_at, lead_sid) values ($1, $2, $3, now() + interval '1 day', $4)`,
      [hashTokenSmoke(t), userId, other, sidA])
    return [s.session, `projectlead_session=${t}`]
  }
  for (const [label, bad] of [['un nombre', 12345], ['vide', ''], ['trop long', 'x'.repeat(300)], ['un objet', { a: 1 }]] as const) {
    const [s1, s2] = await fresh2()
    const status = await post(logoutToken({ lead_status: 'logout', sid: bad }))
    check(`logout avec un sid illisible (${label}) : 200 et repli sûr, toutes ses sessions tombent`, status === 200 && (await me(s1)) === 401 && (await me(s2)) === 401, { status })
  }
  {
    const [s1, s2] = await fresh2()
    const status = await post(logoutToken({ sid: sidB }))
    check('jeton sans lead_status, avec un sid : comme une déconnexion, seules les sessions de ce navigateur tombent ; la place reste',
      status === 200 && (await me(s1)) === 401 && (await me(s2)) === 200
      && (await pool.query(`select bool_and(active) as a from account_users where user_id = $1`, [userId])).rows[0].a === true, { status })
    await post(logoutToken({ lead_status: 'logout' }))
  }
  check('logout pour une personne inconnue ici : 200, rien ne casse', (await post(logoutToken({ sub: `inconnue-${stamp}`, lead_status: 'logout', sid: sidA }))) === 200
    && (await me(owner.session)) === 200)
  check('l’administratrice (autre personne) garde sa session pendant tout cela', (await me(owner.session)) === 200)
  // Des sessions toutes neuves, pour que le départ se prouve seul : navigateur B et autre entreprise.
  const B2 = await leadLogin((n) => carol(n, sidB))
  const x2Token = `x-${randomUUID()}`
  await pool.query(`insert into sessions (token_hash, user_id, account_id, expires_at, lead_sid) values ($1, $2, $3, now() + interval '1 day', $4)`,
    [hashTokenSmoke(x2Token), userId, other, sidB])
  const X2 = `projectlead_session=${x2Token}`
  check('départ (disabled) : toutes ses sessions tombent, autre entreprise comprise',
    (await me(B2.session)) === 200 && (await me(X2)) === 200
    && (await post(logoutToken({ lead_status: 'disabled' }))) === 200 && (await me(B2.session)) === 401 && (await me(X2)) === 401)
  const places = (await pool.query(`select account_id, active from account_users where user_id = $1`, [userId])).rows
  check('… sa place se libère dans l’entreprise annoncée seulement ; l’autre entreprise ne change pas',
    places.find((x) => x.account_id === other)?.active === true && places.find((x) => x.account_id !== other)?.active === false, places)
  check('l’administratrice de l’entreprise garde sa session', (await me(owner.session)) === 200)
}

section('Clés d’ERPlead : une clé inconnue ne fait relire le JWKS qu’une fois toutes les 30 secondes')
{
  // Le back-channel et la boîte de réception de l'échange sont publics : un jeton forgé avec un `kid` inventé ne doit
  // pas faire un appel à ERPlead par requête (comme ScanLead, server/leadId.ts).
  const logoutToken = (kid = 'k1', key = privateKey) => {
    const h = b64({ alg: 'RS256', kid, typ: 'JWT' })
    const iat = Math.floor(Date.now() / 1000)
    const p = b64({ iss: process.env.LEAD_ID_ISSUER, aud: 'projectlead', iat, exp: iat + 120, sub: `jwks-inconnue-${stamp}`, lead_status: 'logout',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} } })
    return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`
  }
  const post = async (token: string) => (await app.request('http://localhost/auth/lead/backchannel-logout', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: token }) })).status
  const inbox = async (token: string) => (await new Client().req('POST', '/api/lead-exchange/v1/inbox', {}, { authorization: `Bearer ${token}` })).status
  // L'émetteur annoncé est le bon (sinon le jeton est refusé avant toute clé) ; seule la clé est inventée.
  const forged = (kid: string) => `${b64({ alg: 'RS256', kid })}.${b64({ iss: process.env.LEAD_ID_ISSUER, aud: 'projectlead' })}.c2ln`

  check('une vraie notification d’ERPlead passe (200)', (await post(logoutToken())) === 200)
  const before = jwksReads
  const serial: number[] = []
  for (let i = 0; i < 10; i++) serial.push(await post(forged(`forged-${i}`)))
  const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => post(forged(`burst-${i}`))))
  const viaInbox = await Promise.all(Array.from({ length: 10 }, (_, i) => inbox(forged(`inbox-${i}`))))
  check('jetons forgés à clé inventée (10 en série, 10 en rafale au back-channel, 10 à la boîte de réception) : tous refusés, au plus une relecture du JWKS',
    serial.every((s) => s === 400) && burst.every((s) => s === 400) && viaInbox.every((s) => s === 401) && jwksReads - before <= 1,
    { serial, burst, viaInbox, reads: jwksReads - before })
  check('… une vraie notification d’ERPlead passe toujours, et un vrai envoi d’échange est reconnu (enveloppe vide → 400, pas 401)',
    (await post(logoutToken())) === 200 && (await inbox(exchangeJwt())) === 400)

  // Rotation de clé chez ERPlead : la nouvelle clé est lue, mais pas avant 30 s après la dernière lecture.
  const rotatedPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const rotated = { ...rotatedPair.publicKey.export({ format: 'jwk' }), kid: 'rotated-key', alg: 'RS256', use: 'sig' }
  const realNow = Date.now
  let shift = 0
  Date.now = () => realNow() + shift
  try {
    shift = 2 * 3_600_000 // cache d'une heure échu : une relecture, une seule pour des requêtes simultanées
    const start = jwksReads
    const first = await Promise.all(Array.from({ length: 10 }, () => post(logoutToken())))
    check('cache d’une heure échu : 10 notifications simultanées, une seule relecture du JWKS, toutes acceptées',
      first.every((s) => s === 200) && jwksReads - start === 1, { first, reads: jwksReads - start })
    publishedKeys = [jwk, rotated]
    shift += 5_000
    const early = await post(logoutToken('rotated-key', rotatedPair.privateKey))
    check('clé tournée, dernière lecture il y a 5 s : pas de nouvelle lecture, jeton refusé (400)', early === 400 && jwksReads - start === 1,
      { early, reads: jwksReads - start })
    shift += 26_000
    const late = await post(logoutToken('rotated-key', rotatedPair.privateKey))
    check('31 s après la dernière lecture : la nouvelle clé est lue (une lecture de plus) et le jeton accepté', late === 200 && jwksReads - start === 2,
      { late, reads: jwksReads - start })

    // Relecture du 15.10.2026 (comme InvoiceLead) : juste après une rotation, une clé inventée lance la relecture et deux
    // vraies notifications signées par la nouvelle clé arrivent pendant qu'elle est en cours (lecture de 50 ms). Elles
    // l'attendent au lieu d'être refusées (sinon : 400 et une session laissée ouverte), sans nouvelle lecture.
    const rotated2Pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    publishedKeys = [jwk, rotated, { ...rotated2Pair.publicKey.export({ format: 'jwk' }), kid: 'rotated-key-2', alg: 'RS256', use: 'sig' }]
    shift += 60_000
    jwksDelay = 50
    let mark = jwksReads
    const together = await Promise.all([post(forged('inventee-pendant-rotation')),
      post(logoutToken('rotated-key-2', rotated2Pair.privateKey)), post(logoutToken('rotated-key-2', rotated2Pair.privateKey))])
    jwksDelay = 0
    check('nouvelle rotation : clé inventée et deux vraies notifications ensemble, pendant la relecture → 400, 200, 200 et une seule lecture',
      JSON.stringify(together) === '[400,200,200]' && jwksReads - mark === 1, { together, reads: jwksReads - mark })

    // Relecture du 15.10.2026 (comme CRMlead) : clés de plus d'une heure et ERPlead en erreur (503). La lecture faite
    // parce que les clés sont périmées suit elle aussi la règle des 30 s, et son échec garde les clés en mémoire.
    shift += 2 * 3_600_000
    jwksDown = true
    mark = jwksReads
    const staleOk = await post(logoutToken())
    const stale: number[] = []
    for (let i = 0; i < 10; i++) stale.push(await post(forged(`stale-${i}`)))
    stale.push(...await Promise.all(Array.from({ length: 10 }, (_, i) => post(forged(`stale-burst-${i}`)))))
    const staleOk2 = await post(logoutToken())
    check('clés de plus d’une heure, ERPlead en erreur (503) : une vraie notification passe encore, avant et après (clés gardées)',
      staleOk === 200 && staleOk2 === 200, { staleOk, staleOk2 })
    check('… pendant la panne, 20 jetons forgés (10 en série, 10 en rafale) et 2 vrais : forgés refusés, au plus une lecture',
      stale.every((s) => s === 400) && jwksReads - mark <= 1, { stale, reads: jwksReads - mark })
    shift += 31_000
    mark = jwksReads
    const staleOk3 = await post(logoutToken())
    check('… 31 s plus tard, toujours en panne : une seule nouvelle tentative, la vraie notification passe encore',
      staleOk3 === 200 && jwksReads - mark === 1, { staleOk3, reads: jwksReads - mark })
    jwksDown = false
  } finally { Date.now = realNow; publishedKeys = [jwk]; jwksDown = false; jwksDelay = 0 }

  // Démarrage à froid (chaque nouvelle instance : aucune clé en mémoire) et ERPlead en erreur. Un second faux ERPlead,
  // jamais lu jusqu'ici, tient lieu d'instance neuve : ses lectures du JWKS suivent elles aussi la règle des 30 s.
  let coldReads = 0
  let coldDown = true
  const cold = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url !== '/oauth/jwks') { res.statusCode = 404; return res.end('{}') }
    coldReads++
    if (coldDown) { res.statusCode = 503; return res.end('{"error":"unavailable"}') }
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  const coldIss = `http://127.0.0.1:${await listen(cold)}`
  const issuerBefore = process.env.LEAD_ID_ISSUER
  const coldToken = (kid = 'k1') => {
    const h = b64({ alg: 'RS256', kid, typ: 'JWT' })
    const iat = Math.floor(Date.now() / 1000)
    const p = b64({ iss: coldIss, aud: 'projectlead', iat, exp: iat + 120, sub: `jwks-froid-${stamp}`, lead_status: 'logout',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} } })
    return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`
  }
  const coldForged = (kid: string) => `${b64({ alg: 'RS256', kid })}.${b64({ iss: coldIss, aud: 'projectlead' })}.c2ln`
  process.env.LEAD_ID_ISSUER = coldIss
  const realNow2 = Date.now
  let shift2 = 0
  Date.now = () => realNow2() + shift2
  try {
    const refusedCold: number[] = []
    for (let i = 0; i < 10; i++) refusedCold.push(await post(coldForged(`cold-${i}`)))
    refusedCold.push(...await Promise.all(Array.from({ length: 10 }, (_, i) => post(coldForged(`cold-burst-${i}`)))))
    const coldReal = await post(coldToken())
    check('démarrage à froid, ERPlead en erreur (503) : 10 jetons forgés en série, 10 en rafale et un vrai, tous refusés, au plus une lecture',
      refusedCold.every((s) => s === 400) && coldReal === 400 && coldReads <= 1, { refusedCold, coldReal, reads: coldReads })
    coldDown = false
    shift2 = 31_000
    const before2 = coldReads
    const recovered = await post(coldToken())
    check('… ERPlead revenu, 31 s plus tard : clés lues une fois, la vraie notification passe', recovered === 200 && coldReads - before2 === 1,
      { recovered, reads: coldReads - before2 })
  } finally { Date.now = realNow2; process.env.LEAD_ID_ISSUER = issuerBefore; cold.close() }
}

section('Lanceur de la famille Lead : la liste canonique (lead-family.json), six applications, adresses d’entrée')
{
  const { existsSync, readFileSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { LEAD_FAMILY, HERE_APP } = await import('../src/lib/leadFamily.js')
  const { default: AppSwitcher, launcherDismiss } = await import('../src/components/AppSwitcher.js')
  // La copie de référence (banc lead-e2e), sinon la conception du passage ; chaque dépôt garde une copie identique.
  const refs = [process.env.LEAD_FAMILY_JSON, `${homedir()}/projets/lead-e2e/lead-family.json`, `${homedir()}/projets/.unlazy/lead-vercel/passage-design.json`]
  const ref = refs.find((f) => f && existsSync(f))
  if (ref) {
    const raw = JSON.parse(readFileSync(ref, 'utf8'))
    const fam = raw.apps ? raw : raw.family
    check(`src/lib/leadFamily.ts identique à la liste de référence (${ref.replace(homedir(), '~')})`, JSON.stringify(fam) === JSON.stringify(LEAD_FAMILY))
  } else console.log('  (lead-family.json absent : seule la forme attendue est contrôlée)')
  const CODES = ['erplead', 'scanlead', 'crmlead', 'projectlead', 'invoicelead', 'greetlead']
  check('six applications, dans l’ordre ERPlead, ScanLead, CRMlead, ProjectLead, InvoiceLead, Greetlead', JSON.stringify(LEAD_FAMILY.apps.map((a) => a.code)) === JSON.stringify(CODES))
  check('adresses d’entrée : /login de chaque application (ERPlead : /account), jamais une racine publique',
    LEAD_FAMILY.apps.every((a) => a.entry === (a.code === 'erplead' ? 'https://erplead.io/account' : `${a.origin}/login`)), LEAD_FAMILY.apps.map((a) => a.entry))
  check('ProjectLead se reconnaît : PL, #9a6a00, https://projectlead.io/login', HERE_APP === 'projectlead'
    && LEAD_FAMILY.apps.some((a) => a.code === 'projectlead' && a.mark === 'PL' && a.color === '#9a6a00' && a.entry === 'https://projectlead.io/login'))
  const closed = renderToStaticMarkup(createElement(AppSwitcher, { locale: 'fr' }))
  check('bouton à 9 points : data-lead-launcher, « Applications Lead », panneau fermé', /<button[^>]*data-lead-launcher[^>]*aria-label="Applications Lead"[^>]*title="Applications Lead"/.test(closed)
    && (closed.match(/<circle/g) ?? []).length === 9 && !closed.includes('data-lead-app'), closed.slice(0, 300))
  const html = renderToStaticMarkup(createElement(AppSwitcher, { locale: 'fr', initialOpen: true }))
  const rows = [...html.matchAll(/<(a|div) data-lead-app="([a-z]+)"([^>]*)>/g)].map((m) => ({ tag: m[1], code: m[2], attrs: m[3] }))
  check('lanceur ouvert : 6 entrées data-lead-app, dans l’ordre de la liste', JSON.stringify(rows.map((x) => x.code)) === JSON.stringify(CODES), rows.map((x) => x.code))
  check('chaque autre application : un lien simple vers son adresse d’entrée, même onglet', rows.filter((x) => x.code !== 'projectlead').every((x) =>
    x.tag === 'a' && x.attrs.includes(`href="${LEAD_FAMILY.apps.find((a) => a.code === x.code)!.entry}"`) && !x.attrs.includes('target=')), rows)
  const here = rows.find((x) => x.code === 'projectlead')
  check('ProjectLead : « Vous êtes ici », aria-current="page", sans lien', here?.tag === 'div' && here.attrs.includes('aria-current="page"') && !here.attrs.includes('href')
    && html.includes('Vous êtes ici') && (html.match(/Ouvrir →/g) ?? []).length === 5, here)
  check('marques et couleurs de la famille, actions en français', LEAD_FAMILY.apps.every((a) => html.includes(`background:${a.color}`) && html.includes(`>${a.mark}<`)
    && html.includes(a.do.fr.replace(/'/g, '&#x27;'))), html.slice(0, 400))
  check('aucune entrée cachée ni bloquée par la formule : ni « Bientôt », ni « Passer à », ni lien de formule', !/Bientôt|Passer à|Mettre à niveau|reglages\/entreprise|upgrade/i.test(html))
  check('titre APPLICATIONS LEAD, panneau de 320 px, fixe à 16 px des bords sous 480 px', html.includes('>Applications Lead</p>') && html.includes('uppercase')
    && html.includes('min-[480px]:w-80') && html.includes('fixed left-4 right-4 top-16') && html.includes('overflow-y-auto'))
  // Audit indépendant (CNX-12, CNX-13) : fermeture au clavier et à la souris, pastilles lisibles et décoratives.
  const inside = (t: unknown) => t === 'dedans'
  const esc = launcherDismiss({ type: 'keydown', key: 'Escape' }, inside)
  check('Échap ferme le lanceur et rend le focus au bouton à 9 points', esc.close && esc.refocus === 'always', esc)
  check('une autre touche ne le ferme pas', !launcherDismiss({ type: 'keydown', key: 'Tab' }, inside).close)
  const out = launcherDismiss({ type: 'pointerdown', target: 'dehors' }, inside)
  check('un clic ou un toucher en dehors le ferme (focus rendu au bouton s’il se perd)', out.close && out.refocus === 'if-lost', out)
  check('un clic dans le panneau ne le ferme pas', !launcherDismiss({ type: 'pointerdown', target: 'dedans' }, inside).close)
  const src = readFileSync(new URL('../src/components/AppSwitcher.tsx', import.meta.url), 'utf8')
  check('le choix d’une entrée ferme le lanceur et rend le focus au bouton ; écoute pointerdown et keydown',
    /const choose = \(\) => \{ setOpen\(false\); button\.current\?\.focus\(\) \}/.test(src) && src.includes('onClick={choose}')
    && src.includes("addEventListener('pointerdown', onEvent)") && src.includes("addEventListener('keydown', onEvent)"))
  const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0)
  const ratios = LEAD_FAMILY.apps.map((a) => ({ code: a.code, ratio: Math.round((1.05 / (lum(a.color) + 0.05)) * 100) / 100 }))
  check('pastilles : blanc sur la couleur de chaque application ≥ 4,5:1 (axe color-contrast)', ratios.every((x) => x.ratio >= 4.5), ratios)
  check('pastilles décoratives (aria-hidden), à la couleur de la liste, jamais grises',
    LEAD_FAMILY.apps.every((a) => new RegExp(`<span aria-hidden="true"[^>]*style="background:${a.color}"[^>]*>${a.mark}</span>`).test(html))
    && !/8a847c/i.test(html + src))
  const de = renderToStaticMarkup(createElement(AppSwitcher, { locale: 'de-CH', initialOpen: true }))
  const xx = renderToStaticMarkup(createElement(AppSwitcher, { locale: 'pt', initialOpen: true }))
  check('langues fr/de/en/it/es, le français par défaut', de.includes('Sie sind hier') && de.includes('Lead-Apps') && xx.includes('Vous êtes ici'))
  const layout = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8')
  check('l’en-tête de l’espace porte le lanceur, à gauche du menu de la personne, et data-lead-org', /<AppSwitcher[^>]*\/>\s*<UserMenu \/>/.test(layout)
    && layout.includes('data-lead-org={me?.account.lead_org'))
  const login = readFileSync(new URL('../src/pages/Login.tsx', import.meta.url), 'utf8')
  check('écran de connexion : « Le même compte pour toutes les applications Lead. »', login.includes('Le même compte pour toutes les applications Lead.'))
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

  // ================================================================ suites de l'abonnement (15.10.2026)
  // Spécification : ~/projets/.unlazy/lead-vercel/billing-followups-design.md (points 1, 2, 4 et 6a) ; les contrôles
  // sans base sont dans scripts/suites-check.ts.
  section('Suites de l’abonnement (15.10.2026) : offres au-dessus de la formule acquise, « Retirer », dernière venue, refus « places »')
  {
    const future = new Date(Date.now() + 30 * 86400e3).toISOString()
    const past = new Date(Date.now() - 86400e3).toISOString()
    /** L'administratrice d'une nouvelle organisation, arrivée par le Compte Lead avec les droits donnés. */
    const arrive = async (k: string, plan: Record<string, unknown>) => {
      const org = `suites-${k}-${stamp}`
      const s = await leadLogin((n) => ({ ...lead(n, true, org), sub: `sub-suites-${k}-${stamp}`, email: `suites-${k}-${stamp}@exemple.test`, lead: plan }))
      const c = new Client(); c.cookie = s.session
      return { c, org, acc: (await pool.query('select id from accounts where lead_org = $1', [org])).rows[0]?.id as string }
    }

    // ---- point 1 : formule propre Pro+ lue au Compte Lead, aucun abonnement ProjectLead (TEST 08 en production)
    const pp = await arrive('pp', rights('pro_plus', { valid_until: future }))
    r = await pp.c.get('/api/billing')
    check('formule propre Pro+ du Compte Lead, sans abonnement ProjectLead : formule acquise Pro+, son origine et sa date de fin (plan.lead)',
      r.status === 200 && r.body.plan.paidTier === 'pro_plus' && r.body.plan.lead?.tier === 'pro_plus' && r.body.plan.lead?.until === future
      && r.body.subscription === null, r.body.plan)
    let n0 = calls.length
    const ppPro = await pp.c.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
    const ppPlus = await pp.c.post('/api/billing/checkout', { plan: 'pro_plus', interval: 'year' })
    check('… Checkout Pro et Pro+ refusés (409 plan_not_above) AVANT Stripe : zéro appel au faux Stripe, aucun client Stripe créé',
      ppPro.status === 409 && ppPro.body.error === 'plan_not_above' && ppPlus.status === 409 && ppPlus.body.error === 'plan_not_above'
      && calls.length === n0 && !(await pool.query('select stripe_customer_id from accounts where id = $1', [pp.acc])).rows[0].stripe_customer_id,
      { pro: ppPro, plus: ppPlus, appelsStripe: calls.length - n0 })
    // Formule propre Pro : Pro refusé, Pro+ accepté.
    const op = await arrive('pro', rights('pro', { valid_until: future }))
    n0 = calls.length
    r = await op.c.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
    check('formule propre Pro du Compte Lead : Checkout Pro refusé (409 plan_not_above), zéro appel au faux Stripe',
      r.status === 409 && r.body.error === 'plan_not_above' && calls.length === n0, { r, appelsStripe: calls.length - n0 })
    r = await op.c.post('/api/billing/checkout', { plan: 'pro_plus', interval: 'month' })
    check('… Checkout Pro+ accepté (au-dessus de la formule acquise) : session Stripe', r.status === 200
      && /^https:\/\/checkout\.stripe\.test\//.test(r.body.url) && calls.length > n0, r)
    // Héritage d'un abonnement payé ailleurs (source « family ») : il prend fin, on doit pouvoir s'abonner.
    const fam = await arrive('famille', rights('pro_plus', { source: 'family', valid_until: future, from_app: 'crmlead' }))
    const famPlan = (await fam.c.get('/api/billing')).body.plan
    const famPro = await fam.c.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
    const famPlus = await fam.c.post('/api/billing/checkout', { plan: 'pro_plus', interval: 'month' })
    check('héritage Pro+ (source family, jusqu’à une date figée) : formule acquise Gratuit, Checkout Pro et Pro+ acceptés',
      famPlan.tier === 'pro_plus' && famPlan.paidTier === 'free' && famPlan.lead === null && famPlan.inherited?.app === 'crmlead'
      && famPro.status === 200 && famPlus.status === 200, { famPlan, famPro: famPro.status, famPlus: famPlus.status })
    // Formule propre échue (valid_until passée) : plus acquise.
    const old = await arrive('echue', rights('pro_plus', { valid_until: past }))
    r = await old.c.post('/api/billing/checkout', { plan: 'pro', interval: 'month' })
    const oldPlan = (await old.c.get('/api/billing')).body.plan
    check('formule propre du Compte Lead échue (valid_until passée) : ni acquise ni affichée, Checkout Pro accepté',
      r.status === 200 && oldPlan.paidTier === 'free' && oldPlan.lead === null, { status: r.status, oldPlan })

    // ---- point 2 : la liste des places, dernière venue, « Retirer » (désactivation gardée), « Rétablir »
    const seatOrg = `suites-places-${stamp}`
    const seatPlan = rights('pro_plus', { valid_until: future })
    const as = (who: string, role = 'user') => (n: string) => ({ ...lead(n, true, seatOrg), lead: seatPlan, sub: `sub-sp-${who}-${stamp}`,
      email: `sp-${who}-${stamp}@exemple.test`, org_role: role })
    const ada = new Client(); ada.cookie = (await leadLogin(as('ada', 'admin'))).session
    const people: Record<string, Client> = {}
    for (const who of ['bea', 'cyd', 'dan', 'eve']) { const c = new Client(); c.cookie = (await leadLogin(as(who))).session; people[who] = c }
    const idOf = async (who: string) => (await pool.query('select id from users where lead_sub = $1', [`sub-sp-${who}-${stamp}`])).rows[0]?.id as string
    const [adaId, beaId, cydId, danId] = await Promise.all(['ada', 'bea', 'cyd', 'dan'].map(idOf))
    const lastSeen = async (id: string) => (await pool.query(
      'select au.last_seen_at from account_users au join accounts a on a.id = au.account_id where au.user_id = $1 and a.lead_org = $2', [id, seatOrg])).rows[0]?.last_seen_at as Date | null
    r = await ada.get('/api/team')
    const seen = Object.fromEntries((r.body.members ?? []).map((m: any) => [m.id, m.last_seen_at]))
    check('dernière venue (account_users.last_seen_at) écrite à l’arrivée par le Compte Lead, rendue par /api/team',
      [adaId, beaId, cydId, danId].every((id) => seen[id] && Date.now() - Date.parse(seen[id]) < 120_000), seen)
    const seenByMember = Object.fromEntries(((await people.dan.get('/api/team')).body.members ?? []).map((m: any) => [m.id, m.last_seen_at]))
    check('… la dernière venue des autres n’est donnée qu’à l’administrateur (une membre ne voit que la sienne)',
      seenByMember[danId] && [adaId, beaId, cydId].every((id) => id in seenByMember && seenByMember[id] === null), seenByMember)
    await pool.query(`update account_users set last_seen_at = now() - interval '2 hours' where user_id = $1`, [beaId])
    await people.bea.get('/api/me')
    const active1 = await lastSeen(beaId)
    check('dernière venue reprise à l’activité (une requête avec une session) quand elle date de plus d’une heure',
      active1 && Date.now() - active1.getTime() < 60_000, active1)
    await pool.query(`update account_users set last_seen_at = now() - interval '10 minutes' where user_id = $1`, [beaId])
    const tenMinutes = await lastSeen(beaId)
    await people.bea.get('/api/me')
    check('… au plus une fois par heure (pas une écriture à chaque requête)', (await lastSeen(beaId))?.getTime() === tenMinutes?.getTime(),
      { tenMinutes, now: await lastSeen(beaId) })

    // ---- point 4 : refus « places », la formule de l'entreprise dans l'adresse
    const proOrg = `suites-pro-plein-${stamp}`
    await leadLogin((n) => ({ ...lead(n, true, proOrg), lead: rights('pro', { valid_until: future }), sub: `sub-pp1-${stamp}`, email: `pp1-${stamp}@exemple.test` }))
    const proFull = await leadLogin((n) => ({ ...lead(n, true, proOrg), lead: rights('pro', { valid_until: future }), sub: `sub-pp2-${stamp}`,
      email: `pp2-${stamp}@exemple.test`, org_role: 'user' }))
    check('Pro plein (1 place) : une 2e personne → écran « places prises » de la formule Pro', proFull.location === '/login?erreur=places&formule=pro'
      && !proFull.session, proFull.location)
    const sixth = await leadLogin(as('fay'))
    check('Pro+ plein (5 places sur 5) : une 6e personne → écran « places prises » de la formule Pro+, sans session',
      sixth.location === '/login?erreur=places&formule=proplus' && !sixth.session, sixth.location)
    const sw = await app.request('http://localhost/auth/lead/start?switch=1&next=/projets')
    const swTo = new URL(sw.headers.get('location') ?? 'http://x/')
    check('« Changer de compte » (/auth/lead/start?switch=1) : autorisation du Compte Lead avec prompt=login (formulaire, jamais la session reprise)',
      sw.status === 302 && swTo.pathname === '/oauth/authorize' && swTo.searchParams.get('prompt') === 'login', swTo.href)

    // ---- point 2 (suite) : « Retirer »
    r = await people.bea.post(`/api/team/members/${danId}/remove`)
    const byMember = r.status
    await ada.patch(`/api/team/members/${cydId}`, { role: 'manager' })
    r = await people.cyd.post(`/api/team/members/${danId}/remove`)
    const byManager = r.status
    check('« Retirer » par une membre → 403, par un responsable → 403 (réservé à l’administrateur)', byMember === 403 && byManager === 403, { byMember, byManager })
    r = await ada.post(`/api/team/members/${adaId}/remove`)
    check('« Retirer » sur sa propre ligne → 400 cannot_remove_self', r.status === 400 && r.body.error === 'cannot_remove_self', r)
    r = await ada.post(`/api/team/members/${randomUUID()}/remove`)
    check('« Retirer » une personne inconnue de l’entreprise → 404', r.status === 404, r)
    const usedBefore = (await ada.get('/api/me')).body.plan.members
    const beaSeen = await lastSeen(beaId)
    r = await ada.post(`/api/team/members/${beaId}/remove`)
    const usedAfter = (await ada.get('/api/me')).body.plan.members
    const beaSessions = (await pool.query(`select count(*)::int as n from sessions s join accounts a on a.id = s.account_id
                                            where s.user_id = $1 and a.lead_org = $2`, [beaId, seatOrg])).rows[0].n
    const beaMe = await people.bea.get('/api/me')
    check('« Retirer » par l’administratrice : place libérée tout de suite, sessions de la personne dans l’entreprise fermées (401), dernière venue gardée',
      r.status === 200 && usedAfter === usedBefore - 1 && beaSessions === 0 && beaMe.status === 401 && (await lastSeen(beaId))?.getTime() === beaSeen?.getTime(),
      { status: r.status, usedBefore, usedAfter, beaSessions, me: beaMe.status })
    const beaRow = (await ada.get('/api/team')).body.members.find((m: any) => m.id === beaId)
    check('… listée à part : inactive, retirée par un administrateur (lead_disabled faux), dernière venue gardée',
      beaRow?.active === false && beaRow?.lead_disabled === false && Boolean(beaRow?.last_seen_at), beaRow)
    const back = await leadLogin(as('bea'))
    check('retrait gardé : à sa connexion suivante par le Compte Lead, « accès désactivé », même s’il reste une place (elle ne revient pas d’elle-même)',
      back.location === '/login?erreur=desactive' && !back.session, back.location)
    r = await people.dan.post(`/api/team/members/${beaId}/restore`)
    check('« Rétablir » par une membre → 403', r.status === 403, r)
    // Une invitation en attente tient la place libérée : rétablir est alors refusé, comme inviter.
    await ada.post('/api/team/invite', { email: `sp-gil-${stamp}@exemple.test` })
    r = await ada.post(`/api/team/members/${beaId}/restore`)
    check('« Rétablir » quand une invitation en attente a repris la place → 402 plan_limit_seats', r.status === 402 && r.body.error === 'plan_limit_seats', r)
    const gil = (await ada.get('/api/team')).body.invitations.find((i: any) => i.email === `sp-gil-${stamp}@exemple.test`)
    await ada.del(`/api/team/invitations/${gil?.id}`)
    r = await ada.post(`/api/team/members/${beaId}/restore`)
    const again = await leadLogin(as('bea'))
    check('« Rétablir » par l’administratrice : 200, et elle rentre à sa connexion suivante', r.status === 200 && again.location === '/' && Boolean(again.session),
      { status: r.status, loc: again.location })

    // ---- relecture (15.10.2026) : un seul changement à la fois sur les administrateurs ; `active` ne se règle plus par PATCH
    /**
     * Fait attendre des requêtes au même point, puis les lâche ensemble : le contrôle tient un verrou SHARE sur
     * account_users (aucune écriture n'y passe), lance chaque requête, attend qu'elle soit bloquée (verrou de la table ou
     * verrou des administrateurs de l'entreprise), puis lâche le verrou. Sans mise en file côté serveur, les requêtes
     * écrivent alors en même temps et chacune voit encore l'autre administrateur actif.
     */
    type Res = { status: number; body?: any }
    const lined = async (calls: (() => Promise<Res>)[]) => {
      const waiting = async () => (await pool.query(
        `select count(*)::int as n from pg_stat_activity where datname = current_database() and backend_type = 'client backend'
            and wait_event_type = 'Lock' and pid <> pg_backend_pid() and query not ilike '%last_seen_at%'`)).rows[0].n as number
      const hold = await pool.connect()
      const pending: Promise<Res>[] = []
      try {
        await hold.query('begin')
        await hold.query('lock table account_users in share mode')
        for (const call of calls) {
          pending.push(call())
          for (let i = 0; i < 200 && (await waiting()) < pending.length; i++) await new Promise((res) => setTimeout(res, 25))
        }
      } finally { await hold.query('commit').catch(() => {}); hold.release() }
      return Promise.all(pending)
    }
    /** Une organisation Pro+ et ses deux administrateurs (administrateurs aussi chez ERPlead), arrivés par le Compte Lead. */
    const adminPair = async (k: string) => {
      const org = `suites-admins-${k}-${stamp}`
      const sub = (w: string) => `sub-adm-${k}-${w}-${stamp}`
      const who = (w: string) => (n: string) => ({ ...lead(n, true, org), lead: rights('pro_plus', { valid_until: future }), sub: sub(w),
        email: `adm-${k}-${w}-${stamp}@exemple.test`, org_role: 'admin' })
      const a = new Client(); a.cookie = (await leadLogin(who('a'))).session
      const b = new Client(); b.cookie = (await leadLogin(who('b'))).session
      const [aId, bId] = await Promise.all(['a', 'b'].map(async (w) => (await pool.query('select id from users where lead_sub = $1', [sub(w)])).rows[0]?.id as string))
      const admins = async () => (await pool.query(`select count(*)::int as n from account_users au join accounts ac on ac.id = au.account_id
                                                     where ac.lead_org = $1 and au.role = 'admin' and au.active`, [org])).rows[0].n as number
      return { org, sub, a, b, aId, bId, admins, start: await admins() }
    }
    const rr = await adminPair('rr')
    let duel = await lined([() => rr.a.post(`/api/team/members/${rr.bId}/remove`), () => rr.b.post(`/api/team/members/${rr.aId}/remove`)])
    let left = await rr.admins()
    check('deux administrateurs qui se retirent l’un l’autre au même instant : un seul retrait passe, l’entreprise garde un administrateur actif',
      rr.start === 2 && left === 1 && duel.filter((x) => x.status === 200).length === 1 && duel.filter((x) => x.status === 403).length === 1,
      { avant: rr.start, apres: left, statuts: duel.map((x) => [x.status, x.body?.error]) })
    const rp = await adminPair('rp')
    duel = await lined([() => rp.a.post(`/api/team/members/${rp.bId}/remove`), () => rp.b.patch(`/api/team/members/${rp.aId}`, { role: 'member' })])
    left = await rp.admins()
    check('« Retirer » l’un et rétrograder l’autre (PATCH rôle) au même instant : un seul changement passe, jamais zéro administrateur actif',
      rp.start === 2 && left === 1 && duel.filter((x) => x.status === 200).length === 1, { avant: rp.start, apres: left, statuts: duel.map((x) => [x.status, x.body?.error]) })
    const rb = await adminPair('rb')
    const departure = () => {
      const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
      const iat = Math.floor(Date.now() / 1000)
      const p = b64({ iss: process.env.LEAD_ID_ISSUER, aud: 'projectlead', iat, exp: iat + 120, sub: rb.sub('a'), org: rb.org, lead_status: 'disabled',
        events: { 'http://schemas.openid.net/event/backchannel-logout': {} } })
      return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`
    }
    duel = await lined([() => rb.a.post(`/api/team/members/${rb.bId}/remove`), async () => ({ status: (await app.request('http://localhost/auth/lead/backchannel-logout', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: departure() }) })).status })])
    left = await rb.admins()
    check('départ d’un administrateur annoncé par ERPlead (back-channel « disabled ») pendant qu’il retire l’autre : jamais zéro administrateur actif',
      rb.start === 2 && left === 1 && duel.every((x) => x.status === 200), { avant: rb.start, apres: left, statuts: duel.map((x) => x.status) })

    // PATCH /members/:id ne règle plus la place : « Retirer » et « Rétablir » seuls (invitations comptées, jamais soi-même, sessions fermées).
    const patchOrg = `suites-patch-${stamp}`
    const patchWho = (who: string, role = 'user') => (n: string) => ({ ...lead(n, true, patchOrg), lead: rights('pro_plus', { valid_until: future }),
      sub: `sub-pa-${who}-${stamp}`, email: `pa-${who}-${stamp}@exemple.test`, org_role: role })
    const pa = new Client(); pa.cookie = (await leadLogin(patchWho('ada', 'admin'))).session
    const pc: Record<string, Client> = {}
    for (const who of ['bea', 'cyd', 'dan', 'eve']) { const c = new Client(); c.cookie = (await leadLogin(patchWho(who))).session; pc[who] = c }
    const [paId, pbId, pcId, peId] = await Promise.all(['ada', 'bea', 'cyd', 'eve'].map(async (who) =>
      (await pool.query('select id from users where lead_sub = $1', [`sub-pa-${who}-${stamp}`])).rows[0]?.id as string))
    const seatOf = async (id: string) => (await pool.query(`select au.active, au.role from account_users au join accounts a on a.id = au.account_id
                                                           where au.user_id = $1 and a.lead_org = $2`, [id, patchOrg])).rows[0] as { active: boolean; role: string } | undefined
    await pa.post(`/api/team/members/${peId}/remove`)
    await pa.post('/api/team/invite', { email: `pa-gus-${stamp}@exemple.test` })
    const viaRestore = (await pa.post(`/api/team/members/${peId}/restore`)).status
    r = await pa.patch(`/api/team/members/${peId}`, { active: true })
    check('Pro+ 5 places sur 5 (4 personnes et 1 invitation en attente) : réactiver par PATCH {active:true} refusé comme « Rétablir » (402), la personne reste retirée',
      viaRestore === 402 && r.status === 400 && r.body.error === 'use_remove_restore' && (await seatOf(peId))?.active === false,
      { viaRestore, patch: [r.status, r.body], seat: await seatOf(peId) })
    r = await pa.patch(`/api/team/members/${pbId}`, { active: false })
    check('désactiver par PATCH {active:false} refusé (seul « Retirer » libère une place et ferme les sessions) : la personne reste active et connectée',
      r.status === 400 && r.body.error === 'use_remove_restore' && (await seatOf(pbId))?.active === true && (await pc.bea.get('/api/me')).status === 200,
      { patch: [r.status, r.body], seat: await seatOf(pbId) })
    await pa.patch(`/api/team/members/${pcId}`, { role: 'admin' })
    r = await pa.patch(`/api/team/members/${paId}`, { active: false })
    check('se désactiver soi-même par PATCH refusé, même avec un autre administrateur actif (comme « Retirer » sur sa propre ligne)',
      r.status === 400 && r.body.error === 'use_remove_restore' && (await seatOf(paId))?.active === true, { patch: [r.status, r.body], seat: await seatOf(paId) })
    r = await pa.patch(`/api/team/members/${pbId}`, { role: 'manager', active: true })
    check('onglet resté sur la version d’avant (la même valeur `active` envoyée avec le rôle) : le rôle est enregistré, la place ne bouge pas',
      r.status === 200 && (await seatOf(pbId))?.role === 'manager' && (await seatOf(pbId))?.active === true, { patch: [r.status, r.body], seat: await seatOf(pbId) })
  }
  fakeStripe.close()
  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY', 'STRIPE_PRICE_PROPLUS_MONTHLY',
    'STRIPE_PRICE_PROPLUS_YEARLY', 'STRIPE_PORTAL_CONFIGURATION', 'STRIPE_API_BASE']) delete process.env[k]
}

delete process.env.LEAD_ID_CLIENT_SECRET

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
crm.close(); il.close(); issuerSrv.close()
await pool.end()
process.exit(ko ? 1 : 0)
