import { z } from 'zod'
import { billableProjects, draftFor, previousPeriod, runMonthly } from '../lib/billing.js'
import { body, HttpError, requireRole, router, tx } from '../lib/http.js'
import { leadOrgOf, linkState } from '../lib/links.js'
import { personProof } from '../lib/personProof.js'

/**
 * « Applications Lead » (Réglages) : CRMlead (adresses, affaires gagnées) et InvoiceLead (facturation mensuelle), reliés
 * SANS CLÉ depuis le 26.10.2026 : même entreprise dans le Compte Lead = reliées (lib/links.ts). Ici ne restent que
 * l'état des liens et les réglages de la facturation mensuelle.
 */
const app = router()

app.get('/', async (c) => tx(c, async (db, ctx) => {
  await db.query('insert into account_settings (account_id) values ($1) on conflict do nothing', [ctx.accountId])
  const s = (await db.query(
    `select monthly_billing_auto, monthly_billing_day, invoice_language, client_update_signature
       from account_settings where account_id = app_account()`)).rows[0]
  const last = (await db.query(
    `select (select max(created_at) from projects where source = 'crmlead') as last_deal_at,
            (select max(updated_at) from exchange_links where app = 'crmlead' and type = 'client') as last_client_update_at,
            (select max(created_at) from invoice_runs where status = 'created') as last_invoice_at`)).rows[0]
  const links = await linkState(db, ctx.accountId, { email: c.get('email'), fresh: c.req.query('fresh') === '1', screen: true })
  return c.json({ links, company: links.company, ...last, ...s })
}))

/**
 * Les clés d'avant (26.10.2026) : plus rien à coller ni à effacer. 410 pendant 30 jours pour un écran resté ouvert sur
 * l'ancienne version ; les colonnes restent en base jusqu'à l'étape 5b (db/etape-5b/013_drop_link_keys.sql).
 */
const retired = (c: any) => c.json({ error: 'keys_retired' }, 410)
app.put('/crmlead', retired)
app.put('/invoicelead', retired)
app.delete('/:app{crmlead|invoicelead}', retired)

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
  const ctx = c.get('ctx')
  // La personne qui lance la facturation : le brouillon est créé à son nom chez InvoiceLead (avec ses droits). Pas
  // de transaction ouverte pendant les envois (lib/billing.ts : une courte transaction par projet).
  const org = await tx(c, (db) => leadOrgOf(db, ctx.accountId))
  const proof = await personProof(c)
  const results = await runMonthly(ctx, ctx.userId, b.period, { org, personProof: proof }, b.project_ids)
  return c.json({ period: b.period, results })
})

app.get('/billing/runs', async (c) => tx(c, async (db) => c.json((await db.query(
  `select r.*, p.name as project_name, u.name as created_by_name from invoice_runs r join projects p on p.id = r.project_id
     left join users u on u.id = r.created_by where ($1::text is null or r.period = $1) order by r.created_at desc limit 300`,
  [c.req.query('period') ?? null])).rows)))

export default app
