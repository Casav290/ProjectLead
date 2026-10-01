import { z } from 'zod'
import { billableProjects, draftFor, previousPeriod, runMonthly } from '../lib/billing.js'
import { crmFetch, crmleadConfig, getLead, upsertClientFromLead } from '../lib/crmlead.js'
import { body, HttpError, requireRole, router, tx } from '../lib/http.js'
import { ilFetch } from '../lib/invoicelead.js'
import { mailboxSecretConfigured, seal } from '../lib/mailbox/secret.js'
import { outboundUrlProblem } from '../lib/netguard.js'

/** Réglages des liens avec CRMlead (adresses) et InvoiceLead (facturation mensuelle). */
const app = router()

app.get('/', async (c) => tx(c, async (db, ctx) => {
  await db.query('insert into account_settings (account_id) values ($1) on conflict do nothing', [ctx.accountId])
  const s = (await db.query(
    `select crmlead_url, crmlead_key_enc is not null as crmlead_key, invoicelead_url, invoicelead_key_enc is not null as invoicelead_key,
            monthly_billing_auto, monthly_billing_day, invoice_language, client_update_signature
       from account_settings where account_id = app_account()`)).rows[0]
  return c.json({ ...s, secret_configured: mailboxSecretConfigured(),
    lead_exchange: { inbox: `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/api/lead-exchange/v1/inbox`, configured: Boolean(process.env.LEAD_ID_CLIENT_SECRET) } })
}))

const linkSchema = z.object({ url: z.string().url().max(300), key: z.string().trim().min(8).max(300).optional(),
                              invoice_language: z.enum(['fr', 'de', 'it', 'en']).optional() })

async function saveLink(c: any, app2: 'crmlead' | 'invoicelead') {
  requireRole(c, 'admin')
  if (!mailboxSecretConfigured()) throw new HttpError(503, 'app_secret_missing')
  const b = await body(c, linkSchema)
  const url = b.url.replace(/\/+$/, '')
  if (outboundUrlProblem(url)) throw new HttpError(400, 'url_not_allowed')
  return tx(c, async (db, ctx) => {
    await db.query('insert into account_settings (account_id) values ($1) on conflict do nothing', [ctx.accountId])
    const cur = (await db.query(`select ${app2}_key_enc as k from account_settings where account_id = app_account()`)).rows[0]
    if (!b.key && !cur.k) throw new HttpError(400, 'key_required')
    // On essaie la clé avant de la garder : une clé fausse se voit ici, pas à la fin du mois.
    if (b.key) {
      if (app2 === 'crmlead') await crmFetch({ url, key: b.key }, '/leads?limit=1')
      else await ilFetch({ url, key: b.key }, '/contacts?q=')
    }
    await db.query(
      `update account_settings set ${app2}_url = $1, ${app2}_key_enc = coalesce($2, ${app2}_key_enc),
              invoice_language = coalesce($3, invoice_language), updated_at = now() where account_id = app_account()`,
      [url, b.key ? seal(b.key) : null, b.invoice_language ?? null])
    return c.json({ ok: true })
  })
}

app.put('/crmlead', (c) => saveLink(c, 'crmlead'))
app.put('/invoicelead', (c) => saveLink(c, 'invoicelead'))

app.delete('/:app{crmlead|invoicelead}', async (c) => {
  requireRole(c, 'admin')
  const a = c.req.param('app')
  await tx(c, (db) => db.query(`update account_settings set ${a}_url = null, ${a}_key_enc = null where account_id = app_account()`))
  return c.json({ ok: true })
})

app.patch('/settings', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, z.object({
    monthly_billing_auto: z.boolean().optional(), monthly_billing_day: z.number().int().min(1).max(28).optional(),
    invoice_language: z.enum(['fr', 'de', 'it', 'en']).optional(), client_update_signature: z.string().max(2000).optional(),
  }))
  await tx(c, async (db, ctx) => {
    await db.query('insert into account_settings (account_id) values ($1) on conflict do nothing', [ctx.accountId])
    await db.query(
      `update account_settings set monthly_billing_auto = coalesce($1, monthly_billing_auto), monthly_billing_day = coalesce($2, monthly_billing_day),
              invoice_language = coalesce($3, invoice_language), client_update_signature = coalesce($4, client_update_signature), updated_at = now()
        where account_id = app_account()`,
      [b.monthly_billing_auto ?? null, b.monthly_billing_day ?? null, b.invoice_language ?? null, b.client_update_signature ?? null])
  })
  return c.json({ ok: true })
})

/** Reprend de CRMlead les adresses à jour de tous les clients qui en viennent. */
app.post('/crmlead/refresh-clients', async (c) => {
  requireRole(c, 'admin', 'manager')
  return tx(c, async (db, ctx) => {
    const cfg = await crmleadConfig(db)
    if (!cfg) throw new HttpError(400, 'crmlead_not_configured')
    const refs = (await db.query(`select external_ref from clients where external_ref like 'crmlead:%' and archived_at is null`)).rows
    let updated = 0, missing = 0
    for (const r of refs) {
      try { await upsertClientFromLead(db, ctx.accountId, await getLead(cfg, r.external_ref.slice(8))); updated++ }
      catch (e) { if (e instanceof HttpError && e.code === 'not_found') missing++; else throw e }
    }
    return c.json({ updated, missing })
  })
})

// ------------------------------------------------------------------ facturation mensuelle

app.get('/billing/preview', async (c) => tx(c, async (db) => {
  const period = c.req.query('period') ?? previousPeriod()
  if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'invalid_period')
  const out = []
  for (const id of await billableProjects(db)) {
    const d = await draftFor(db, id, period)
    out.push({ project: d.project, client: d.client ? { id: d.client.id, name: d.client.name } : null, lines: d.lines,
               total_cents: d.totalCents, existing: d.existing })
  }
  return c.json({ period, projects: out })
}))

app.post('/billing/run', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), project_ids: z.array(z.string().uuid()).max(500).optional() }))
  const results = await tx(c, (db, ctx) => runMonthly(db, ctx, b.period, b.project_ids))
  return c.json({ period: b.period, results })
})

app.get('/billing/runs', async (c) => tx(c, async (db) => c.json((await db.query(
  `select r.*, p.name as project_name, u.name as created_by_name from invoice_runs r join projects p on p.id = r.project_id
     left join users u on u.id = r.created_by where ($1::text is null or r.period = $1) order by r.created_at desc limit 300`,
  [c.req.query('period') ?? null])).rows)))

export default app
