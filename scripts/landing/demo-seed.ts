/**
 * Données de démonstration FICTIVES pour les captures de la page d'accueil et du film :
 * une entreprise inventée (Moraine Bâtiment SA), ses projets de rénovation et d'installation,
 * son équipe, son temps, ses e-mails et ses rendez-vous. Aucune donnée réelle.
 *
 * Base neuve uniquement : `DATABASE_URL=postgres://…/pl_landing_demo npx tsx scripts/landing/demo-seed.ts`
 * Connexion ensuite : claire@moraine-batiment.test / demo-moraine-2026 (sans Compte Lead : LEAD_ID_* vides).
 */
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
import 'dotenv/config'

const { migrate } = await import('../../server/migrate.js')
await migrate(() => {})
const { default: app } = await import('../../server/index.js')
const { pool } = await import('../../server/db.js')

const EMAIL = 'claire@moraine-batiment.test'
const PASSWORD = 'demo-moraine-2026'
if ((await pool.query('select 1 from users where email = $1', [EMAIL])).rowCount) {
  console.log('Démonstration déjà présente.'); await pool.end(); process.exit(0)
}

let cookie = ''
async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body) })
  const set = res.headers.get('set-cookie')?.match(/projectlead_session=([^;]+)/)
  if (set) cookie = `projectlead_session=${set[1]}`
  const json: any = await res.json().catch(() => null)
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`)
  return json
}
async function signup(body: unknown) {
  const res = await app.request('http://localhost/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const set = res.headers.get('set-cookie')?.match(/projectlead_session=([^;]+)/)
  if (!set) throw new Error('inscription ' + res.status + ' ' + await res.text())
  cookie = `projectlead_session=${set[1]}`
}

/** Les dates partent d'aujourd'hui : les captures restent crédibles quel que soit le jour. */
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
/** Lundi de la semaine en cours, pour la feuille de temps. */
const monday = (() => { const d = new Date(); const w = (d.getDay() + 6) % 7; return -w })()
/** Un rendez-vous un jour ouvrable (n jours ouvrables après aujourd'hui), heure de Suisse. */
const at = (n: number, hh: number, mm = 0) => {
  const d = new Date(); let k = n
  while (k > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) k-- }
  const local = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm))
  // Heure d'été (fin mars à fin octobre) : UTC+2, sinon UTC+1.
  const summer = local.getUTCMonth() > 2 && local.getUTCMonth() < 9 || (local.getUTCMonth() === 9 && local.getUTCDate() < 25)
  return new Date(local.getTime() - (summer ? 2 : 1) * 3600_000).toISOString()
}

await signup({ name: 'Claire Monnier', email: EMAIL, password: PASSWORD, company: 'Moraine Bâtiment SA' })
const me = await call('GET', '/api/me')
const CLAIRE = me.user.id as string

// ------------------------------------------------------------------ équipe
const TEAM: [string, string, string, number, number][] = [
  ['Luca Bernasconi', 'luca@moraine-batiment.test', '#0f766e', 11500, 40],
  ['Yann Perrin', 'yann@moraine-batiment.test', '#1d4ed8', 10500, 40],
  ['Aline Chappuis', 'aline@moraine-batiment.test', '#be185d', 11000, 32],
  ['Noah Jaccard', 'noah@moraine-batiment.test', '#7c3aed', 9500, 40],
]
for (const [name, email] of TEAM) {
  const inv = await call('POST', '/api/team/invite', { email, role: 'member' })
  await app.request(`http://localhost/api/auth/invitation/${inv.link.split('/').pop()}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password: PASSWORD }) })
}
const team = await call('GET', '/api/team')
const id = (name: string) => team.members.find((m: any) => m.name === name).id as string
const LUCA = id('Luca Bernasconi'), YANN = id('Yann Perrin'), ALINE = id('Aline Chappuis'), NOAH = id('Noah Jaccard')
await call('PATCH', `/api/team/members/${LUCA}`, { hourly_rate_cents: 11500, role: 'manager' })
await call('PATCH', `/api/team/members/${YANN}`, { hourly_rate_cents: 10500 })
await call('PATCH', `/api/team/members/${ALINE}`, { hourly_rate_cents: 11000 })
await call('PATCH', `/api/team/members/${NOAH}`, { hourly_rate_cents: 9500 })
await call('PATCH', `/api/team/members/${CLAIRE}`, { hourly_rate_cents: 13500 })
for (const [name, email, color] of TEAM) await pool.query('update users set color = $2 where email = $1', [email, color])
await pool.query(`update users set color = '#9a6a00' where id = $1`, [CLAIRE])
await call('POST', '/api/team/teams', { name: 'Bureau technique', member_ids: [CLAIRE, ALINE] })
await call('POST', '/api/team/teams', { name: 'Chantier', member_ids: [LUCA, YANN, NOAH] })

// ------------------------------------------------------------------ clients
const client = async (b: any, contact?: any) => {
  const c = (await call('POST', '/api/clients', b)).id
  if (contact) await call('POST', `/api/clients/${c}/contacts`, contact)
  return c as string
}
const TILLEULS = await client({ name: 'PPE Les Tilleuls', email: 'administration@ppe-tilleuls.test', phone: '+41 21 555 01 20',
  street: 'Avenue des Tilleuls', building_number: '8', postal_code: '1820', town: 'Montreux', contact_person: 'Hélène Duvoisin' },
  { name: 'Hélène Duvoisin', email: 'helene.duvoisin@ppe-tilleuls.test', job_title: 'Administratrice de la PPE' })
const MOREL = await client({ name: 'Famille Morel', email: 'julien.morel@courriel.test', street: 'Chemin des Vergers', building_number: '3',
  postal_code: '1618', town: 'Châtel-Saint-Denis', contact_person: 'Julien Morel' })
const FROMAGERIE = await client({ name: 'Fromagerie du Haut-Plateau', email: 'contact@haut-plateau.test', street: 'Route du Chasseron',
  building_number: '41', postal_code: '1450', town: 'Sainte-Croix', contact_person: 'Marc-Henri Pittet' },
  { name: 'Marc-Henri Pittet', email: 'mh.pittet@haut-plateau.test', job_title: 'Maître fromager' })
const HOTEL = await client({ name: 'Hôtel du Grand-Pré', email: 'direction@grand-pre.test', street: 'Rue du Village', building_number: '17',
  postal_code: '1874', town: 'Champéry', contact_person: 'Sandrine Favez' })
const COMMUNE = await client({ name: 'Commune de Chênevert', email: 'greffe@chenevert.test', street: 'Place de la Maison de Commune',
  building_number: '1', postal_code: '1530', town: 'Chênevert', contact_person: 'Pierre Gilliéron' })
const ARCADIE = await client({ name: 'Gérance Arcadie SA', email: 'technique@arcadie-gerance.test', postal_code: '1400', town: 'Yverdon-les-Bains',
  contact_person: 'Nadia Benali' })
const AULNES = await client({ name: 'Ferme des Aulnes', email: 'famille.roulin@courriel.test', postal_code: '1673', town: 'Promasens' })

// ------------------------------------------------------------------ projets
type StageDef = [name: string, from: number, to: number, status: 'todo' | 'in_progress' | 'done', note?: string, billing?: number]
type TaskDef = [title: string, stage: number, from: number, to: number, who: string[], extra?: Record<string, unknown>]

async function project(b: any, stages: StageDef[], tasks: TaskDef[]) {
  const p = (await call('POST', '/api/projects', b)).id as string
  const sids: string[] = []
  for (const [name, from, to, , note, billing] of stages) {
    sids.push((await call('POST', `/api/projects/${p}/stages`, { name, start_date: day(from), due_date: day(to), visible_to_client: true,
      ...(note ? { client_note: note } : {}), ...(billing ? { billing_cents: billing } : {}) })).id)
  }
  const d = await call('GET', `/api/projects/${p}`)
  const cols = d.columns ?? (await call('GET', `/api/projects/${p}`)).columns
  const colId = (name: string) => cols?.find((c: any) => c.name === name)?.id
  const tids: string[] = []
  for (const [i, [title, stage, from, to, who, extra]] of tasks.entries()) {
    const { column, completed, ...rest } = (extra ?? {}) as any
    const t = (await call('POST', '/api/tasks', { project_id: p, title, stage_id: sids[stage] ?? null, start_date: day(from), due_date: day(to),
      assignee_ids: who, estimate_minutes: Math.max(60, Math.min(to - from, 10) * 150), position: i, ...rest })).id as string
    if (column && colId(column)) await call('PATCH', `/api/tasks/${t}`, { column_id: colId(column) })
    if (completed) await call('PATCH', `/api/tasks/${t}`, { completed: true })
    tids.push(t)
  }
  for (const [i, [, , , status]] of stages.entries()) if (status !== 'todo') await call('PATCH', `/api/projects/stages/${sids[i]}`, { status })
  return { p, sids, tids }
}

// Le grand projet : rénovation énergétique d'un immeuble en PPE.
const R = await project({
  name: 'Rénovation énergétique, Résidence Les Tilleuls', code: 'MB-2026-014', client_id: TILLEULS, owner_id: CLAIRE,
  start_date: day(-38), due_date: day(52), member_ids: [LUCA, YANN, ALINE, NOAH], billing_mode: 'milestone', color: '#9a6a00',
  budget_minutes: 640 * 60, budget_cents: 18640000, update_frequency: 'weekly', portal_enabled: true, portal_show_tasks: true,
  priority: 'high', health: 'on_track',
  description: 'Isolation périphérique des façades, remplacement des fenêtres par du triple vitrage et pompe à chaleur air-eau pour les 12 appartements.',
}, [
  ['Relevés et diagnostic', -38, -28, 'done', 'Diagnostic énergétique remis au comité de la PPE.', 1860000],
  ['Échafaudages et protections', -27, -20, 'done', 'Échafaudage posé, accès des locataires maintenus.', 2240000],
  ['Isolation des façades', -19, 12, 'in_progress', 'Façades sud et est terminées, façade nord en cours.', 6890000],
  ['Fenêtres triple vitrage', 6, 26, 'todo', 'Pose prévue appartement par appartement, une demi-journée chacun.', 4120000],
  ['Pompe à chaleur', 20, 42, 'todo', undefined, 2930000],
  ['Réception des travaux', 43, 52, 'todo', undefined, 600000],
], [
  ['Relevé thermographique des façades', 0, -38, -34, [ALINE], { completed: true }],
  ['Rapport de diagnostic CECB', 0, -33, -29, [CLAIRE, ALINE], { completed: true }],
  ['Montage de l’échafaudage', 1, -27, -22, [LUCA, NOAH], { completed: true }],
  ['Isolation façade sud', 2, -19, -9, [LUCA, NOAH], { completed: true }],
  ['Isolation façade est', 2, -10, -2, [LUCA, YANN], { completed: true }],
  ['Isolation façade nord', 2, -3, 8, [LUCA, NOAH], { column: 'En cours', priority: 'high', visible_to_client: true }],
  ['Crépi de finition, teinte validée par la PPE', 2, 4, 12, [NOAH], { visible_to_client: true }],
  ['Commande des fenêtres', 3, -6, 1, [CLAIRE], { column: 'En revue', priority: 'urgent' }],
  ['Pose des fenêtres, 1er et 2e étage', 3, 6, 16, [YANN, NOAH], { visible_to_client: true }],
  ['Pose des fenêtres, 3e et 4e étage', 3, 15, 26, [YANN, NOAH], { visible_to_client: true }],
  ['Raccordement électrique de la PAC', 4, 20, 30, [YANN]],
  ['Mise en service de la pompe à chaleur', 4, 31, 42, [YANN, LUCA], { is_milestone: true, visible_to_client: true }],
  ['Visite de réception avec le comité', 5, 46, 50, [CLAIRE], { is_milestone: true, visible_to_client: true }],
])
// Une dépendance réelle : on ne pose pas les fenêtres avant de les avoir commandées.
await call('POST', `/api/tasks/${R.tids[8]}/dependencies`, { depends_on_id: R.tids[7] })
await call('POST', `/api/tasks/${R.tids[9]}/dependencies`, { depends_on_id: R.tids[8] })
for (const label of ['Contrôle des chevilles', 'Pare-pluie posé', 'Photos avant crépi']) await call('POST', `/api/tasks/${R.tids[5]}/checklist`, { label })
await call('POST', `/api/tasks/${R.tids[5]}/comments`, { body: 'Les panneaux de la façade nord arrivent mardi. @Noah Jaccard tu peux préparer la zone de stockage ?' })
await call('POST', `/api/projects/${R.p}/updates`, { health: 'on_track', share_with_client: true,
  body: 'Façades sud et est isolées. Façade nord en cours, fin prévue dans dix jours. Les fenêtres sont commandées.' })

const M = await project({
  name: 'Pompe à chaleur, villa Morel', code: 'MB-2026-017', client_id: MOREL, owner_id: LUCA, start_date: day(-21), due_date: day(18),
  member_ids: [YANN], billing_mode: 'fixed', fixed_cents: 3480000, color: '#0f766e', budget_minutes: 72 * 60, health: 'on_track', portal_enabled: true,
}, [
  ['Visite technique', -21, -18, 'done'], ['Offre et subvention', -17, -8, 'done'], ['Pose', -6, 9, 'in_progress'], ['Mise en service', 10, 18, 'todo'],
], [
  ['Dimensionnement de la PAC', 0, -21, -18, [LUCA], { completed: true }],
  ['Dossier de subvention cantonale', 1, -17, -10, [CLAIRE], { completed: true }],
  ['Démontage de la chaudière à mazout', 2, -6, -2, [YANN], { completed: true }],
  ['Pose de l’unité extérieure', 2, -1, 4, [YANN, LUCA], { column: 'En cours' }],
  ['Raccordement hydraulique', 2, 3, 9, [YANN]],
  ['Mise en service et réglages', 3, 10, 14, [YANN], { is_milestone: true }],
])

const F = await project({
  name: 'Panneaux solaires, Fromagerie du Haut-Plateau', code: 'MB-2026-019', client_id: FROMAGERIE, owner_id: CLAIRE, start_date: day(-12), due_date: day(30),
  member_ids: [YANN, NOAH], billing_mode: 'hourly', hourly_rate_cents: 12500, color: '#b45309', budget_minutes: 160 * 60, budget_cents: 4200000,
  health: 'at_risk', portal_enabled: true, update_frequency: 'biweekly',
}, [
  ['Étude de toiture', -12, -5, 'done'], ['Livraison des panneaux', -4, 8, 'in_progress'], ['Pose et raccordement', 9, 24, 'todo'], ['Annonce au distributeur', 25, 30, 'todo'],
], [
  ['Calcul de charge de la toiture', 0, -12, -7, [CLAIRE], { completed: true }],
  ['Relancer le fournisseur des onduleurs', 1, -2, 1, [CLAIRE], { column: 'En cours', priority: 'urgent' }],
  ['Pose des rails de fixation', 2, 9, 14, [NOAH, YANN]],
  ['Pose des 84 panneaux', 2, 13, 21, [NOAH, YANN]],
  ['Raccordement des onduleurs', 2, 20, 24, [YANN], { is_milestone: true }],
])
await call('POST', `/api/projects/${F.p}/updates`, { health: 'at_risk', share_with_client: true,
  body: 'Les onduleurs sont annoncés avec une semaine de retard. La pose des panneaux reste prévue à la date convenue.' })

const H = await project({
  name: 'Cuisine professionnelle, Hôtel du Grand-Pré', code: 'MB-2026-021', client_id: HOTEL, owner_id: ALINE, start_date: day(4), due_date: day(60),
  member_ids: [ALINE, YANN], billing_mode: 'milestone', color: '#be185d', status: 'planned', health: 'on_track',
}, [
  ['Plans et choix du matériel', 4, 18, 'todo'], ['Démontage', 30, 34, 'todo'], ['Installation', 35, 55, 'todo'], ['Formation de la brigade', 56, 60, 'todo'],
], [
  ['Relevé des cotes de la cuisine', 0, 4, 7, [ALINE]],
  ['Plans d’implantation', 0, 7, 15, [ALINE]],
  ['Validation avec le chef', 0, 16, 18, [ALINE, CLAIRE], { is_milestone: true }],
])

const E = await project({
  name: 'Éclairage LED, école de Chênevert', code: 'MB-2026-018', client_id: COMMUNE, owner_id: LUCA, start_date: day(-9), due_date: day(14),
  member_ids: [YANN], billing_mode: 'hourly', hourly_rate_cents: 11500, color: '#1d4ed8', health: 'on_track', budget_minutes: 90 * 60,
}, [
  ['Salles de classe', -9, 4, 'in_progress'], ['Salle de gym', 5, 12, 'todo'], ['Contrôle OIBT', 13, 14, 'todo'],
], [
  ['Remplacement des luminaires, bâtiment A', 0, -9, -3, [YANN], { completed: true }],
  ['Remplacement des luminaires, bâtiment B', 0, -2, 4, [YANN, NOAH], { column: 'En cours' }],
  ['Luminaires de la salle de gym', 1, 5, 12, [YANN]],
  ['Rapport de sécurité OIBT', 2, 13, 14, [LUCA], { is_milestone: true }],
])

await project({
  name: 'Toiture et ferblanterie, Ferme des Aulnes', code: 'MB-2026-009', client_id: AULNES, owner_id: LUCA, start_date: day(-80), due_date: day(-24),
  member_ids: [NOAH], billing_mode: 'fixed', fixed_cents: 2650000, color: '#15803d', status: 'done', health: 'on_track',
}, [['Couverture', -80, -40, 'done'], ['Ferblanterie', -39, -24, 'done']], [
  ['Dépose des tuiles', 0, -80, -70, [NOAH], { completed: true }], ['Pose des chéneaux', 1, -39, -30, [NOAH], { completed: true }],
])

// Une affaire gagnée dans CRMlead arrive « à qualifier ».
await call('POST', '/api/projects', { name: 'Salle de bain sans obstacle, Gérance Arcadie', code: 'MB-2026-022', client_id: ARCADIE, status: 'lead',
  billing_mode: 'fixed', fixed_cents: 2890000, color: '#7c3aed', source: undefined })

// ------------------------------------------------------------------ temps : la semaine en cours et les précédentes
const T = { nord: R.tids[5], crepi: R.tids[6], fen: R.tids[7], poseFen: R.tids[8], ext: M.tids[3], hydrau: M.tids[4], subv: M.tids[1],
  ond: F.tids[1], ledB: E.tids[1], cotes: H.tids[0], plans: H.tids[1] }
const WEEK: [string, string, number, number, string, string?][] = [
  // [personne, projet, jour depuis lundi, minutes, note, tâche]
  [CLAIRE, R.p, 0, 120, 'Point chantier avec le comité'], [CLAIRE, F.p, 0, 90, 'Relance des onduleurs', T.ond], [CLAIRE, H.p, 0, 210, 'Préparation des plans', T.plans],
  [CLAIRE, R.p, 1, 75, 'Commande des fenêtres', T.fen], [CLAIRE, H.p, 1, 240, 'Plans d’implantation', T.plans], [CLAIRE, M.p, 1, 120, 'Subvention : suivi du dossier', T.subv],
  [CLAIRE, R.p, 2, 165, 'Métrés façade nord', T.nord], [CLAIRE, E.p, 2, 90, 'Planning salle de gym'], [CLAIRE, R.p, 2, 210, 'Commande des fenêtres', T.fen],
  [CLAIRE, F.p, 3, 105, 'Appel au fournisseur', T.ond], [CLAIRE, R.p, 3, 150, 'Contrôle façade nord', T.nord],
  [LUCA, R.p, 0, 480, 'Isolation façade nord', T.nord], [LUCA, R.p, 1, 450, 'Isolation façade nord', T.nord], [LUCA, M.p, 2, 300, 'Unité extérieure', T.ext],
  [LUCA, R.p, 2, 150, 'Isolation façade nord', T.nord], [LUCA, R.p, 3, 420, 'Isolation façade nord', T.nord],
  [YANN, M.p, 0, 360, 'Démontage chaudière'], [YANN, E.p, 1, 420, 'Luminaires bâtiment B', T.ledB], [YANN, E.p, 2, 450, 'Luminaires bâtiment B', T.ledB],
  [YANN, M.p, 3, 300, 'Pose unité extérieure', T.ext], [YANN, R.p, 3, 120, 'Repérage du local technique'],
  [NOAH, R.p, 0, 480, 'Panneaux isolants', T.nord], [NOAH, R.p, 1, 480, 'Panneaux isolants', T.nord], [NOAH, E.p, 2, 240, 'Luminaires bâtiment B', T.ledB],
  [NOAH, R.p, 3, 450, 'Crépi de fond', T.crepi],
  [ALINE, H.p, 0, 300, 'Relevé des cotes', T.cotes], [ALINE, H.p, 1, 360, 'Plans d’implantation', T.plans], [ALINE, R.p, 2, 120, 'Plans de pose des fenêtres', T.poseFen],
]
const today = (new Date().getDay() + 6) % 7
for (const [who, p, d, minutes, note, task] of WEEK) {
  if (d > Math.min(today, 4)) continue
  await call('POST', '/api/time/entries', { project_id: p, entry_date: day(monday + d), minutes, note, user_id: who, ...(task ? { task_id: task } : {}) })
}
for (let w = 1; w <= 5; w++) {
  for (const [i, [who, p]] of ([[LUCA, R.p], [NOAH, R.p], [YANN, M.p], [YANN, E.p], [CLAIRE, R.p], [ALINE, R.p], [NOAH, F.p], [CLAIRE, F.p], [YANN, R.p]] as const).entries()) {
    await call('POST', '/api/time/entries', { project_id: p, entry_date: day(monday - 7 * w + (i % 5)), minutes: 240 + ((i * 37 + w * 53) % 5) * 60,
      note: ['Chantier', 'Pose', 'Coordination', 'Préparation', 'Suivi'][i % 5], user_id: who })
  }
}
// Coûts internes (rapports de rentabilité) et une boîte mail branchée (sans synchronisation : JOBS_DISABLED).
for (const [who, cost] of [[CLAIRE, 8200], [LUCA, 6900], [YANN, 6400], [ALINE, 6600], [NOAH, 5800]] as const)
  await pool.query('update account_users set cost_rate_cents = $2 where user_id = $1', [who, cost])
// CRMlead et InvoiceLead « branchés » (clés factices : rien n'est appelé, l'aperçu de facturation est local).
await pool.query(`update account_settings set crmlead_url = 'https://crmlead.io', crmlead_key_enc = 'demo',
  invoicelead_url = 'https://invoicelead.io', invoicelead_key_enc = 'demo' where account_id = $1`, [me.account.id])
await pool.query(`insert into mailboxes (account_id, user_id, provider, email, display_name, secret_enc, is_default, shared, last_synced_at)
  values ($1, $2, 'imap', 'bureau@moraine-batiment.test', 'Moraine Bâtiment', 'demo', true, true, now())`, [me.account.id, CLAIRE])
// Le chronomètre de Claire tourne sur la façade nord.
await call('POST', '/api/time/timer/start', { project_id: R.p, task_id: R.tids[5], note: 'Contrôle de la façade nord' })
await pool.query(`update time_entries set started_at = now() - interval '47 minutes' where minutes is null`)

// ------------------------------------------------------------------ agenda et rendez-vous
await call('POST', '/api/calendar/events', { title: 'Réunion de chantier, Les Tilleuls', starts_at: at(1, 8), ends_at: at(1, 9, 30),
  project_id: R.p, attendee_user_ids: [LUCA, NOAH], attendee_emails: ['helene.duvoisin@ppe-tilleuls.test'], location: 'Montreux' })
await call('POST', '/api/calendar/events', { title: 'Visite de la cuisine avec le chef', starts_at: at(2, 14), ends_at: at(2, 15),
  project_id: H.p, attendee_user_ids: [ALINE], location: 'Champéry' })
await call('POST', '/api/calendar/events', { title: 'Livraison des panneaux solaires', starts_at: at(4, 7, 30), ends_at: at(4, 10),
  project_id: F.p, attendee_user_ids: [YANN, NOAH], location: 'Sainte-Croix' })
await call('POST', '/api/calendar/events', { title: 'Mise en service PAC, villa Morel', starts_at: at(6, 9), ends_at: at(6, 11, 30),
  project_id: M.p, attendee_user_ids: [YANN, LUCA], location: 'Châtel-Saint-Denis' })
await call('POST', '/api/calendar/events', { title: 'Point hebdomadaire de l’équipe', starts_at: at(2, 7, 30), ends_at: at(2, 8),
  attendee_user_ids: [LUCA, YANN, ALINE, NOAH] })
await call('POST', '/api/booking', { slug: 'moraine-visite-technique', name: 'Visite technique gratuite',
  description: 'Une heure sur place pour voir votre projet et préparer une offre précise.', duration_minutes: 60, host_ids: [CLAIRE, LUCA], create_project: true })
await call('POST', '/api/forms', { slug: 'moraine-demande-offre', name: 'Demande d’offre',
  intro: 'Décrivez vos travaux, nous revenons vers vous sous 48 heures.' })
await call('POST', '/api/automations', { name: 'Étape terminée quand ses tâches le sont', trigger: 'task_completed', action: 'complete_stage' })

// ------------------------------------------------------------------ e-mails : un client connu et deux demandes à trier
const token = me.account.inbound_token
for (const [from, subject, text] of [
  ['Hélène Duvoisin <helene.duvoisin@ppe-tilleuls.test>', 'Teinte du crépi, façade nord',
    'Bonjour Madame Monnier,\n\nLe comité a validé la teinte « sable clair » pour la façade nord. Pouvez-vous nous confirmer la date de fin ?\n\nMeilleures salutations,\nHélène Duvoisin'],
  ['Thomas Aebischer <t.aebischer@atelier-aebischer.test>', 'Rénovation de nos bureaux à Payerne',
    'Bonjour,\n\nNous souhaitons rénover 280 m² de bureaux (isolation, éclairage, stores) d’ici le printemps. Pourriez-vous nous faire une offre ?\n\nThomas Aebischer'],
  ['Laura Mettraux <laura.mettraux@courriel.test>', 'Demande de visite pour une pompe à chaleur',
    'Bonjour, nous aimerions remplacer notre chaudière à mazout par une pompe à chaleur. Quand pourriez-vous passer ? Merci, Laura Mettraux'],
]) await app.request(`http://localhost/api/inbound/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ from, subject, text, message_id: `<demo-${Math.random().toString(36).slice(2)}@moraine.test>` }) })

const portal = (await pool.query('select portal_token from projects where id = $1', [R.p])).rows[0]?.portal_token
console.log(JSON.stringify({ ok: true, email: EMAIL, password: PASSWORD, projects: { R: R.p, M: M.p, F: F.p, H: H.p, E: E.p }, portal }))
await pool.end()
process.exit(0)
