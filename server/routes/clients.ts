import { z } from 'zod'
import { crmleadConfig, getLead, searchLeads, upsertClientFromLead } from '../lib/crmlead.js'
import { body, email, HttpError, notFound, router, setClause, tx } from '../lib/http.js'

/** Les clients et leurs adresses ; CRMlead en est la source quand il est branché. */
const app = router()

const clientSchema = z.object({
  kind: z.enum(['company', 'person']).default('company'),
  name: z.string().trim().min(1).max(200),
  contact_person: z.string().trim().max(200).nullish(),
  email: email.nullish().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(50).nullish(),
  street: z.string().trim().max(70).nullish(),
  building_number: z.string().trim().max(16).nullish(),
  postal_code: z.string().trim().max(16).nullish(),
  town: z.string().trim().max(35).nullish(),
  country: z.string().regex(/^[A-Z]{2}$/).default('CH'),
  language: z.enum(['fr', 'de', 'it', 'en']).default('fr'),
  vat_number: z.string().trim().max(40).nullish(),
  notes: z.string().max(5000).nullish(),
})
const CLIENT_FIELDS = Object.keys(clientSchema.shape)

app.get('/', async (c) => tx(c, async (db) => {
  const q = (c.req.query('q') ?? '').trim()
  const rows = (await db.query(
    `select c.*, (select count(*)::int from projects p where p.client_id = c.id and not p.is_template and p.archived_at is null) as projects,
            (select count(*)::int from projects p where p.client_id = c.id and p.status = 'active') as active_projects
       from clients c
      where ($1 = '' or c.name ilike '%' || $1 || '%' or c.email ilike '%' || $1 || '%' or c.town ilike '%' || $1 || '%')
        and (c.archived_at is null or $2)
      order by c.name limit 500`, [q, c.req.query('archived') === '1'])).rows
  return c.json(rows)
}))

app.post('/', async (c) => {
  const b = await body(c, clientSchema)
  const id = await tx(c, async (db, ctx) => (await db.query(
    `insert into clients (account_id, ${CLIENT_FIELDS.join(', ')}) values ($1, ${CLIENT_FIELDS.map((_, i) => `$${i + 2}`).join(', ')})
     returning id`, [ctx.accountId, ...CLIENT_FIELDS.map((k) => (b as any)[k] ?? null)])).rows[0].id)
  return c.json({ id }, 201)
})

app.get('/:id', async (c) => tx(c, async (db) => {
  const client = (await db.query('select * from clients where id = $1', [c.req.param('id')])).rows[0]
  if (!client) throw notFound()
  const contacts = (await db.query('select * from client_contacts where client_id = $1 order by name', [client.id])).rows
  const projects = (await db.query(
    `select id, name, code, status, health, due_date, color from projects
      where client_id = $1 and not is_template order by created_at desc`, [client.id])).rows
  const emails = (await db.query(
    `select id, subject, from_email, direction, received_at, project_id from email_messages
      where client_id = $1 order by received_at desc limit 20`, [client.id])).rows
  return c.json({ ...client, contacts, projects, emails })
}))

app.patch('/:id', async (c) => {
  const b = await body(c, clientSchema.partial().extend({ archived: z.boolean().optional() }))
  await tx(c, async (db) => {
    const s = setClause(b, CLIENT_FIELDS, 2)
    if (s.keys.length) {
      const r = await db.query(`update clients set ${s.sql} where id = $1`, [c.req.param('id'), ...s.values])
      if (!r.rowCount) throw notFound()
    }
    if (b.archived !== undefined)
      await db.query('update clients set archived_at = case when $2 then now() else null end where id = $1', [c.req.param('id'), b.archived])
  })
  return c.json({ ok: true })
})

const contactSchema = z.object({
  name: z.string().trim().max(200).default(''), email: email.nullish().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(50).nullish(), job_title: z.string().trim().max(120).nullish(),
  receives_updates: z.boolean().default(true),
})

app.post('/:id/contacts', async (c) => {
  const b = await body(c, contactSchema)
  const id = await tx(c, async (db, ctx) => (await db.query(
    `insert into client_contacts (account_id, client_id, name, email, phone, job_title, receives_updates)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [ctx.accountId, c.req.param('id'), b.name, b.email ?? null, b.phone ?? null, b.job_title ?? null, b.receives_updates])).rows[0].id)
  return c.json({ id }, 201)
})

app.patch('/contacts/:cid', async (c) => {
  const b = await body(c, contactSchema.partial())
  await tx(c, async (db) => {
    const s = setClause(b, ['name', 'email', 'phone', 'job_title', 'receives_updates'], 2)
    if (s.keys.length) await db.query(`update client_contacts set ${s.sql} where id = $1`, [c.req.param('cid'), ...s.values])
  })
  return c.json({ ok: true })
})

app.delete('/contacts/:cid', async (c) => {
  await tx(c, (db) => db.query('delete from client_contacts where id = $1', [c.req.param('cid')]))
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ CRMlead

/** Cherche une entreprise dans CRMlead (ses leads), pour en reprendre l'adresse. */
app.get('/crmlead/search', async (c) => tx(c, async (db) => {
  const cfg = await crmleadConfig(db)
  if (!cfg) throw new HttpError(400, 'crmlead_not_configured')
  const leads = await searchLeads(cfg, (c.req.query('q') ?? '').slice(0, 100))
  const known = new Set((await db.query(`select external_ref from clients where external_ref like 'crmlead:%'`)).rows.map((r) => r.external_ref))
  return c.json(leads.map((l) => ({
    id: l.id, title: l.title, company: l.company, address: l.company_address, status: l.status,
    imported: known.has(`crmlead:${l.id}`),
  })))
}))

app.post('/crmlead/import', async (c) => {
  const b = await body(c, z.object({ leadId: z.string().min(1).max(100) }))
  const id = await tx(c, async (db, ctx) => {
    const cfg = await crmleadConfig(db)
    if (!cfg) throw new HttpError(400, 'crmlead_not_configured')
    return upsertClientFromLead(db, ctx.accountId, await getLead(cfg, b.leadId))
  })
  return c.json({ id }, 201)
})

/** Relit dans CRMlead l'adresse et les contacts d'un client déjà repris. */
app.post('/:id/crmlead/refresh', async (c) => tx(c, async (db, ctx) => {
  const cl = (await db.query('select external_ref from clients where id = $1', [c.req.param('id')])).rows[0]
  if (!cl?.external_ref?.startsWith('crmlead:')) throw new HttpError(400, 'not_from_crmlead')
  const cfg = await crmleadConfig(db)
  if (!cfg) throw new HttpError(400, 'crmlead_not_configured')
  await upsertClientFromLead(db, ctx.accountId, await getLead(cfg, cl.external_ref.slice(8)))
  return c.json({ ok: true })
}))

export default app
