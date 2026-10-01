import { z } from 'zod'
import { hashPassword, verifyPassword } from '../auth.js'
import { anon } from '../db.js'
import { leadIdConfigured } from './auth.js'
import { body, HttpError, requireRole, router, tx } from '../lib/http.js'
import { mailboxSecretConfigured } from '../lib/mailbox/secret.js'

const app = router()

app.get('/me', async (c) => tx(c, async (db, ctx) => {
  const me = (await db.query(
    `select u.id, u.email, u.name, u.color, u.locale, (u.lead_sub is not null) as lead_linked,
            au.role, au.hourly_rate_cents, au.capacity_minutes, au.ical_token
       from users u join account_users au on au.user_id = u.id and au.account_id = app_account()
      where u.id = app_user()`)).rows[0]
  const account = (await db.query('select id, name, plan, locale, timezone, currency, week_hours, inbound_token from accounts where id = app_account()')).rows[0]
  const settings = (await db.query(
    `select (crmlead_url is not null and crmlead_key_enc is not null) as crmlead,
            (invoicelead_url is not null and invoicelead_key_enc is not null) as invoicelead
       from account_settings where account_id = app_account()`)).rows[0] ?? { crmlead: false, invoicelead: false }
  const unread = (await db.query('select count(*)::int as n from notifications where user_id = app_user() and read_at is null')).rows[0].n
  const running = (await db.query(
    `select t.id, t.started_at, t.project_id, p.name as project_name, t.task_id, k.title as task_title
       from time_entries t join projects p on p.id = t.project_id left join tasks k on k.id = t.task_id
      where t.user_id = app_user() and t.minutes is null`)).rows[0] ?? null
  const inbox = (await db.query(`select count(*)::int as n from email_messages where status = 'new'`)).rows[0].n
  return c.json({
    user: me, account, integrations: settings, unread, running, inbox,
    features: { leadId: leadIdConfigured(), mailboxes: mailboxSecretConfigured(), crmlead: settings.crmlead, invoicelead: settings.invoicelead },
    // L'adresse de capture n'existe que si un domaine de réception est vraiment branché (MX vers un relais).
    inboundAddress: process.env.INBOUND_DOMAIN ? `${account.inbound_token}@${process.env.INBOUND_DOMAIN}` : null,
    inboundUrl: `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/api/inbound/${account.inbound_token}`,
    icalUrl: `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/api/public/calendar/${me.ical_token}.ics`,
  })
}))

app.patch('/me', async (c) => {
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(120).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }))
  await tx(c, (db) => db.query('update users set name = coalesce($1, name), color = coalesce($2, color) where id = app_user()',
    [b.name ?? null, b.color ?? null]))
  return c.json({ ok: true })
})

app.post('/me/password', async (c) => {
  const b = await body(c, z.object({ current: z.string().max(200).optional(), next: z.string().min(10).max(200) }))
  const ctx = c.get('ctx')
  await anon(async (db) => {
    const u = (await db.query('select password_hash from users where id = $1', [ctx.userId])).rows[0]
    if (u?.password_hash && !verifyPassword(b.current ?? '', u.password_hash)) throw new HttpError(401, 'invalid_credentials')
    await db.query('update users set password_hash = $1 where id = $2', [hashPassword(b.next), ctx.userId])
  })
  return c.json({ ok: true })
})

app.patch('/account', async (c) => {
  requireRole(c, 'admin')
  const b = await body(c, z.object({
    name: z.string().trim().min(1).max(200).optional(), timezone: z.string().max(60).optional(),
    currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).optional(), week_hours: z.number().min(1).max(80).optional(),
  }))
  if (b.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }) } catch { throw new HttpError(400, 'invalid_timezone') } }
  await tx(c, (db) => db.query(
    `update accounts set name = coalesce($1, name), timezone = coalesce($2, timezone), currency = coalesce($3, currency),
            week_hours = coalesce($4, week_hours) where id = app_account()`,
    [b.name ?? null, b.timezone ?? null, b.currency ?? null, b.week_hours ?? null]))
  return c.json({ ok: true })
})

export default app
