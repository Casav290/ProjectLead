import { z } from 'zod'
import { hashToken, newToken } from '../auth.js'
import { body, email, HttpError, notFound, requireRole, router, tx, uuid } from '../lib/http.js'
import { htmlParagraphs, layout, sendMail } from '../lib/email.js'
import { assertSeatFree } from '../lib/plans.js'

/** L'équipe : les personnes de l'entreprise, leurs rôles, leurs taux, leurs équipes. */
const app = router()

app.get('/', async (c) => tx(c, async (db) => {
  const members = (await db.query(
    `select u.id, u.name, u.email, u.color, au.role, au.active, au.hourly_rate_cents, au.cost_rate_cents, au.capacity_minutes,
            coalesce((select array_agg(tm.team_id) from team_members tm where tm.user_id = u.id), '{}') as team_ids
       from account_users au join users u on u.id = au.user_id
      where au.account_id = app_account() order by au.active desc, u.name`)).rows
  const teams = (await db.query(
    `select t.id, t.name, t.color, coalesce(array_agg(tm.user_id) filter (where tm.user_id is not null), '{}') as member_ids
       from teams t left join team_members tm on tm.team_id = t.id group by t.id order by t.name`)).rows
  const invitations = (await db.query(
    `select id, email, role, expires_at, created_at from invitations
      where accepted_at is null and expires_at > now() order by created_at desc`)).rows
  return c.json({ members, teams, invitations })
}))

app.post('/invite', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, z.object({ email, role: z.enum(['admin', 'manager', 'member']).default('member') }))
  if (b.role === 'admin') requireRole(c, 'admin')
  const token = newToken()
  const account = await tx(c, async (db, ctx) => {
    const already = (await db.query(
      `select 1 from account_users au join users u on u.id = au.user_id where lower(u.email) = $1 and au.active`, [b.email])).rowCount
    if (already) throw new HttpError(409, 'already_member')
    // Une place de la formule par personne (invitations en attente comprises).
    await assertSeatFree(ctx.accountId)
    await db.query('insert into invitations (account_id, email, role, token_hash, invited_by) values ($1,$2,$3,$4,$5)',
      [ctx.accountId, b.email, b.role, hashToken(token), ctx.userId])
    return (await db.query('select name from accounts where id = app_account()')).rows[0].name as string
  })
  const link = `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/invitation/${token}`
  const text = `${c.get('name')} vous invite à rejoindre ${account} sur ProjectLead.\n\nAcceptez l'invitation (valable 14 jours) :\n${link}`
  await sendMail({ accountId: c.get('ctx').accountId, to: [b.email], subject: `Invitation à rejoindre ${account} sur ProjectLead`,
    text, html: layout(`Rejoindre ${account}`, htmlParagraphs(`${c.get('name')} vous invite à rejoindre ${account} sur ProjectLead.`),
      { label: "Accepter l'invitation", url: link }), fromUserId: c.get('ctx').userId, fromName: c.get('name') })
  return c.json({ ok: true, link }, 201)
})

app.delete('/invitations/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  await tx(c, (db) => db.query('delete from invitations where id = $1', [c.req.param('id')]))
  return c.json({ ok: true })
})

app.patch('/members/:userId', async (c) => {
  requireRole(c, 'admin')
  const b = await body(c, z.object({
    role: z.enum(['admin', 'manager', 'member']).optional(), active: z.boolean().optional(),
    hourly_rate_cents: z.number().int().min(0).max(10_000_00).optional(),
    cost_rate_cents: z.number().int().min(0).max(10_000_00).optional(),
    capacity_minutes: z.number().int().min(0).max(10080).optional(),
  }))
  await tx(c, async (db) => {
    const r = await db.query(
      `update account_users set role = coalesce($2, role), active = coalesce($3, active),
              hourly_rate_cents = coalesce($4, hourly_rate_cents), cost_rate_cents = coalesce($5, cost_rate_cents),
              capacity_minutes = coalesce($6, capacity_minutes)
        where account_id = app_account() and user_id = $1`,
      [c.req.param('userId'), b.role ?? null, b.active ?? null, b.hourly_rate_cents ?? null, b.cost_rate_cents ?? null, b.capacity_minutes ?? null])
    if (!r.rowCount) throw notFound()
    // Jamais d'entreprise sans administrateur actif : ce serait s'enfermer dehors.
    const admins = (await db.query(`select count(*)::int as n from account_users where account_id = app_account() and role = 'admin' and active`)).rows[0].n
    if (!admins) throw new HttpError(400, 'last_admin')
  })
  return c.json({ ok: true })
})

const teamSchema = z.object({
  name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  member_ids: z.array(uuid).max(200).optional(),
})

async function setMembers(db: any, accountId: string, teamId: string, ids: string[] | undefined) {
  if (!ids) return
  await db.query('delete from team_members where team_id = $1', [teamId])
  for (const u of ids) await db.query('insert into team_members (team_id, user_id, account_id) values ($1,$2,$3)', [teamId, u, accountId])
}

app.post('/teams', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, teamSchema)
  const id = await tx(c, async (db, ctx) => {
    const t = (await db.query('insert into teams (account_id, name, color) values ($1,$2,coalesce($3,\'#0f6e70\')) returning id',
      [ctx.accountId, b.name, b.color ?? null])).rows[0]
    await setMembers(db, ctx.accountId, t.id, b.member_ids)
    return t.id
  })
  return c.json({ id }, 201)
})

app.patch('/teams/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, teamSchema.partial())
  await tx(c, async (db, ctx) => {
    const r = await db.query('update teams set name = coalesce($2, name), color = coalesce($3, color) where id = $1',
      [c.req.param('id'), b.name ?? null, b.color ?? null])
    if (!r.rowCount) throw notFound()
    await setMembers(db, ctx.accountId, c.req.param('id'), b.member_ids)
  })
  return c.json({ ok: true })
})

app.delete('/teams/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  await tx(c, (db) => db.query('delete from teams where id = $1', [c.req.param('id')]))
  return c.json({ ok: true })
})

export default app
