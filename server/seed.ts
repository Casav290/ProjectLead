/**
 * Données de démonstration : une entreprise, trois personnes, des clients, des projets à
 * différents stades, du temps, des emails à trier. `npm run db:seed`, puis connexion avec
 * demo@projectlead.test / demo-demo-demo.
 */
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
import 'dotenv/config'

const { migrate } = await import('./migrate.js')
await migrate(() => {})
const { default: app } = await import('./index.js')
const { pool } = await import('./db.js')

const EMAIL = 'demo@projectlead.test'
const exists = (await pool.query('select 1 from users where email = $1', [EMAIL])).rowCount
if (exists) { console.log('Données de démonstration déjà présentes.'); await pool.end(); process.exit(0) }

let cookie = ''
async function call(method: string, path: string, body?: unknown, who = () => cookie, keep = true) {
  const res = await app.request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie: who() },
    body: body === undefined ? undefined : JSON.stringify(body) })
  const set = res.headers.get('set-cookie')?.match(/projectlead_session=([^;]+)/)
  if (set && keep) cookie = `projectlead_session=${set[1]}`
  const json: any = await res.json().catch(() => null)
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`)
  return json
}
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

await call('POST', '/api/auth/signup', { name: 'Ève Gemmet', email: EMAIL, password: 'demo-demo-demo', company: 'Atelier Gemmet Sàrl' })
const me = await call('GET', '/api/me')
const people: string[] = []
for (const [name, email] of [['Marc Dupont', 'marc@projectlead.test'], ['Sofia Rossi', 'sofia@projectlead.test']]) {
  const inv = await call('POST', '/api/team/invite', { email, role: 'member' })
  let c2 = ''
  const res = await app.request(`http://localhost/api/auth/invitation/${inv.link.split('/').pop()}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password: 'demo-demo-demo' }) })
  c2 = res.headers.get('set-cookie') ?? ''
  void c2
}
const team = await call('GET', '/api/team')
for (const m of team.members) { if (m.id !== me.user.id) people.push(m.id) }
await call('PATCH', `/api/team/members/${people[0]}`, { hourly_rate_cents: 12000, role: 'manager' })
await call('PATCH', `/api/team/members/${people[1]}`, { hourly_rate_cents: 11000 })
await call('PATCH', `/api/team/members/${me.user.id}`, { hourly_rate_cents: 15000 })
await call('POST', '/api/team/teams', { name: 'Conception', member_ids: [me.user.id, people[1]] })
await call('POST', '/api/team/teams', { name: 'Réalisation', member_ids: [people[0]] })
await pool.query(`update users set color = '#b45309' where id = $1`, [people[0]])
await pool.query(`update users set color = '#be185d' where id = $1`, [people[1]])

const favre = (await call('POST', '/api/clients', { name: 'Garage Favre SA', email: 'info@favre.ch', phone: '+41 22 361 00 00',
  street: 'Route de Genève', building_number: '5', postal_code: '1260', town: 'Nyon' })).id
await call('POST', `/api/clients/${favre}/contacts`, { name: 'Paul Favre', email: 'paul@favre.ch', job_title: 'Directeur' })
const rochat = (await call('POST', '/api/clients', { name: 'Boulangerie Rochat SA', email: 'lea@rochat.ch', street: 'Rue de Bourg',
  building_number: '12', postal_code: '1003', town: 'Lausanne', contact_person: 'Léa Rochat' })).id
const weber = (await call('POST', '/api/clients', { name: 'Weber Sàrl', email: 'nina@weber.ch', postal_code: '2000', town: 'Neuchâtel' })).id

const tpl = (await call('GET', '/api/projects?template=1'))[0].id
const p1 = (await call('POST', '/api/projects', { name: 'Refonte de l’atelier mécanique', client_id: favre, template_id: tpl, start_date: day(-30),
  due_date: day(40), member_ids: people, billing_mode: 'hourly', hourly_rate_cents: 14000, budget_minutes: 120 * 60, budget_cents: 1800000,
  update_frequency: 'weekly', portal_enabled: true, portal_show_tasks: true, color: '#9a6a00' })).id
const p2 = (await call('POST', '/api/projects', { name: 'Site vitrine Rochat', client_id: rochat, template_id: tpl, start_date: day(-10),
  due_date: day(25), member_ids: [people[1]], billing_mode: 'milestone', color: '#be185d', portal_enabled: true })).id
const p3 = (await call('POST', '/api/projects', { name: 'Maintenance mensuelle', client_id: weber, billing_mode: 'retainer', retainer_cents: 80000,
  member_ids: [people[0]], color: '#15803d', start_date: day(-60) })).id
await call('POST', '/api/projects', { name: 'Agrandissement entrepôt', client_id: favre, status: 'lead', billing_mode: 'fixed', fixed_cents: 4500000, color: '#b45309' })

const d1 = await call('GET', `/api/projects/${p1}`)
await call('PATCH', `/api/projects/stages/${d1.stages[0].id}`, { status: 'done', client_note: 'Cahier des charges validé le ' + day(-20) })
await call('PATCH', `/api/projects/stages/${d1.stages[1].id}`, { status: 'in_progress', client_note: 'Maquettes en cours de validation' })
await call('POST', `/api/projects/${p1}/updates`, { health: 'at_risk', body: 'Le fournisseur des machines annonce deux semaines de retard. Nous adaptons le planning.', share_with_client: true })
const t1 = await call('GET', `/api/tasks?project=${p1}`)
for (const t of t1.slice(0, 3)) await call('PATCH', `/api/tasks/${t.id}`, { completed: true, assignee_ids: [me.user.id] })
for (const [i, t] of t1.slice(3).entries()) await call('PATCH', `/api/tasks/${t.id}`, { assignee_ids: [[me.user.id, ...people][i % 3]], estimate_minutes: 60 * (1 + (i % 4)),
  start_date: day(i * 3 - 5), due_date: day(i * 3), priority: i === 1 ? 'urgent' : i === 2 ? 'high' : 'normal', visible_to_client: i < 3 })
await call('POST', `/api/tasks/${t1[4].id}/dependencies`, { depends_on_id: t1[3].id })
await call('POST', `/api/tasks/${t1[3].id}/checklist`, { label: 'Relevé des cotes' })
await call('POST', `/api/tasks/${t1[3].id}/checklist`, { label: 'Photos de l’existant' })
await call('POST', `/api/tasks/${t1[3].id}/comments`, { body: 'Je passe sur place jeudi, @Marc Dupont tu peux venir ?' })
const d2 = await call('GET', `/api/projects/${p2}`)
await call('PATCH', `/api/projects/stages/${d2.stages[0].id}`, { status: 'done', billing_cents: 250000 })
await call('PATCH', `/api/projects/stages/${d2.stages[1].id}`, { status: 'in_progress', billing_cents: 400000 })
await call('PATCH', `/api/projects/stages/${d2.stages[2].id}`, { billing_cents: 600000 })

for (let i = 0; i < 12; i++) {
  await call('POST', '/api/time/entries', { project_id: [p1, p2, p3][i % 3], entry_date: day(-i), minutes: 60 + (i % 4) * 45,
    note: ['Atelier client', 'Plans', 'Suivi chantier', 'Intégration'][i % 4], user_id: [me.user.id, ...people][i % 3] })
}
await call('POST', '/api/calendar/events', { title: 'Réunion de chantier', starts_at: `${day(1)}T08:00:00.000Z`, ends_at: `${day(1)}T09:30:00.000Z`,
  project_id: p1, attendee_user_ids: people, attendee_emails: ['paul@favre.ch'], location: 'Nyon' })
await call('POST', '/api/calendar/events', { title: 'Présentation des maquettes', starts_at: `${day(3)}T13:00:00.000Z`, ends_at: `${day(3)}T14:00:00.000Z`,
  project_id: p2, attendee_user_ids: [people[1]] })
await call('POST', '/api/booking', { slug: 'atelier-gemmet-decouverte', name: 'Appel découverte', description: '30 minutes pour parler de votre projet.',
  duration_minutes: 30, host_ids: [me.user.id, people[0]], create_project: true })
await call('POST', '/api/forms', { slug: 'atelier-gemmet-devis', name: 'Demande de devis', intro: 'Décrivez votre projet, nous revenons vers vous sous 48 heures.', template_id: tpl })
await call('POST', '/api/automations', { name: 'Étape terminée quand ses tâches le sont', trigger: 'task_completed', action: 'complete_stage' })

const token = me.account.inbound_token
for (const [from, subject, text] of [
  ['Julie Martin <julie@martin-archi.ch>', 'Rénovation de nos bureaux à Morges', 'Bonjour,\n\nNous cherchons une équipe pour rénover 300 m² de bureaux d’ici le printemps. Pouvez-vous nous faire une offre ?\n\nJulie Martin'],
  ['Paul Favre <paul@favre.ch>', 'Question sur les plans', 'Bonjour, pouvez-vous m’envoyer la dernière version des plans ? Merci. Paul'],
  ['Thomas Keller <t.keller@keller-ag.ch>', 'Demande de rendez-vous', 'Guten Tag, wir möchten einen Termin vereinbaren für ein neues Projekt.'],
]) await app.request(`http://localhost/api/inbound/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ from, subject, text, message_id: `<seed-${Math.random()}@exemple>` }) })

console.log('Démonstration prête : demo@projectlead.test / demo-demo-demo')
await pool.end()
process.exit(0)
