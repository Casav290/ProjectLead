import { Hono } from 'hono'
import { anonTx } from '../db.js'
import { createDefaultColumns } from '../lib/defaults.js'
import { incomingSender } from '../lib/leadId.js'

/**
 * L'échange de la famille Lead (crmlead/docs/LEAD-ID.md, étape 9). ProjectLead reçoit :
 * - `deal` : un lead gagné dans CRMlead, qui devient un projet (et son client) ;
 * - `contact` : une adresse, qui devient un client.
 * Un même objet source donne toujours le même projet : un renvoi met à jour, sans doublon.
 */
const app = new Hono()
const base = () => (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')

app.get('/.well-known/lead-app.json', (c) => c.json({
  app: 'projectlead', name: 'ProjectLead',
  exchange: { version: 1, inbox: `${base()}/api/lead-exchange/v1/inbox`, accepts: ['deal', 'contact'], sends: ['project'] },
}))

app.post('/api/lead-exchange/v1/inbox', async (c) => {
  let from: string | null = null
  try { from = await incomingSender(c.req.header('authorization')) } catch { from = null }
  if (!from) return c.json({ error: 'invalid_token' }, 401)
  const e = await c.req.json().catch(() => null) as any
  if (!e?.type || !e?.org || !e?.source?.id) return c.json({ error: 'invalid_envelope' }, 400)
  if (e.source.app !== from) return c.json({ error: 'source_mismatch' }, 403)
  if (!['deal', 'contact'].includes(e.type)) return c.json({ error: 'unsupported_type', accepts: ['deal', 'contact'] }, 422)
  const d = e.data ?? {}

  const out = await anonTx(async (db) => {
    const acc = (await db.query('select id from accounts where lead_org = $1', [e.org])).rows[0]
    if (!acc) return { status: 404 as const }
    const owner = e.sub ? (await db.query(
      `select u.id from users u join account_users au on au.user_id = u.id and au.account_id = $2 where u.lead_sub = $1`, [e.sub, acc.id])).rows[0]?.id : null
    const fallbackOwner = owner ?? (await db.query(`select user_id from account_users where account_id = $1 and role = 'admin' and active order by joined_at limit 1`, [acc.id])).rows[0]?.user_id
    const link = (await db.query('select project_id, client_id from exchange_links where account_id = $1 and app = $2 and type = $3 and source_id = $4',
      [acc.id, from, e.type, String(e.source.id)])).rows[0]

    // Le client : celui du lien, sinon retrouvé par l'email d'un contact ou le nom, sinon créé.
    const contacts: any[] = Array.isArray(d.contacts) ? d.contacts : d.email ? [d] : []
    const primary = contacts.find((x) => x.is_primary) ?? contacts[0]
    const person = primary ? [primary.first_name, primary.last_name].filter(Boolean).join(' ') : null
    const clientName = String(d.company || person || d.title || 'Client').slice(0, 200)
    let clientId = link?.client_id ?? null
    if (!clientId && primary?.email) clientId = (await db.query('select id from clients where account_id = $1 and lower(email) = lower($2) limit 1', [acc.id, primary.email])).rows[0]?.id ?? null
    if (!clientId) clientId = (await db.query('select id from clients where account_id = $1 and lower(name) = lower($2) and archived_at is null limit 1', [acc.id, clientName])).rows[0]?.id ?? null
    if (!clientId) {
      clientId = (await db.query(
        `insert into clients (account_id, kind, name, contact_person, email, phone, external_ref) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (account_id, external_ref) where external_ref is not null do update set name = excluded.name returning id`,
        [acc.id, d.company ? 'company' : 'person', clientName, person, primary?.email ?? null, primary?.phone ?? null, `${from}:${e.source.id}`])).rows[0].id
    }
    for (const ct of contacts) {
      if (!ct.email) continue
      const nm = [ct.first_name, ct.last_name].filter(Boolean).join(' ')
      const has = (await db.query('select 1 from client_contacts where client_id = $1 and lower(email) = lower($2)', [clientId, ct.email])).rowCount
      if (!has) await db.query('insert into client_contacts (account_id, client_id, name, email, phone, job_title) values ($1,$2,$3,$4,$5,$6)',
        [acc.id, clientId, nm, ct.email, ct.phone ?? null, ct.job_title ?? null])
    }

    let projectId: string | null = link?.project_id ?? null
    let status: 'created' | 'updated' = link ? 'updated' : 'created'
    if (e.type === 'deal') {
      const amount = Number.isInteger(d.amount) && d.amount >= 0 ? d.amount : null
      if (projectId && (await db.query('select 1 from projects where id = $1', [projectId])).rowCount) {
        await db.query(
          `update projects set name = coalesce($2, name), description = case when description = '' then coalesce($3, '') else description end,
                  budget_cents = coalesce($4, budget_cents), updated_at = now() where id = $1`,
          [projectId, d.title ? String(d.title).slice(0, 200) : null, d.description ?? null, amount])
      } else {
        projectId = (await db.query(
          `insert into projects (account_id, name, description, client_id, owner_id, status, source, source_ref, budget_cents,
                                 fixed_cents, billing_mode, currency, created_by)
           values ($1,$2,$3,$4,$5,'planned','crmlead',$6,$7,$7,$8,$9,$5) returning id`,
          [acc.id, String(d.title || `Projet ${clientName}`).slice(0, 200), d.description ?? '', clientId, fallbackOwner,
           `${from}:${e.source.id}`, amount, amount ? 'fixed' : 'hourly', ['CHF', 'EUR', 'USD', 'GBP'].includes(d.currency) ? d.currency : 'CHF'])).rows[0].id
        await createDefaultColumns(db, acc.id, projectId!)
        if (fallbackOwner) {
          await db.query(`insert into project_members (project_id, user_id, account_id, role) values ($1,$2,$3,'lead') on conflict do nothing`, [projectId, fallbackOwner, acc.id])
          await db.query(`insert into notifications (account_id, user_id, kind, title, link) values ($1,$2,'deal',$3,$4)`,
            [acc.id, fallbackOwner, `Affaire gagnée dans CRMlead : ${d.title ?? clientName}`, `/projets/${projectId}`])
        }
        await db.query(`insert into activities (account_id, project_id, kind, data) values ($1,$2,'from_crmlead',$3)`,
          [acc.id, projectId, JSON.stringify({ url: e.source.url ?? null })])
        status = 'created'
      }
    }
    await db.query(
      `insert into exchange_links (account_id, app, type, source_id, project_id, client_id) values ($1,$2,$3,$4,$5,$6)
       on conflict (account_id, app, type, source_id) do update set project_id = excluded.project_id, client_id = excluded.client_id, updated_at = now()`,
      [acc.id, from, e.type, String(e.source.id), projectId, clientId])
    return { status: 200 as const, body: { id: projectId ?? clientId, url: projectId ? `${base()}/projets/${projectId}` : `${base()}/clients/${clientId}`, status } }
  })
  if (out.status === 404) return c.json({ error: 'unknown_org' }, 404)
  return c.json(out.body, out.body.status === 'created' ? 201 : 200)
})

export default app
