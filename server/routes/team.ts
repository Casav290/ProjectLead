import { z } from 'zod'
import { hashToken, newToken } from '../auth.js'
import { anon } from '../db.js'
import { body, email, HttpError, notFound, requireRole, router, tx, uuid } from '../lib/http.js'
import { htmlParagraphs, layout, sendMail } from '../lib/email.js'
import { assertStillAdmin, lockAdmins } from '../lib/admins.js'
import { assertSeatFree } from '../lib/plans.js'
import { asLocale, LOCALES, tr } from '../lib/i18n.js'

/**
 * L'équipe : les personnes de l'entreprise, leurs rôles, leurs taux, leurs équipes, et les places de la formule
 * (Réglages → Équipe) : qui occupe une place (personnes actives et invitations en attente), sa dernière venue
 * (`last_seen_at`), « Retirer » et « Rétablir » pour l'administrateur (suites de l'abonnement, 15.10.2026, point 2).
 */
const app = router()

app.get('/', async (c) => tx(c, async (db) => {
  // `lead_disabled` : partie de l'entreprise dans le Compte Lead (back-channel « disabled »), pas retirée ici. La dernière
  // venue des autres n'est donnée qu'à l'administrateur (comme le coût horaire) : chacun voit la sienne.
  const members = (await db.query(
    // i18n-ok
    `select u.id, u.name, u.email, u.color, au.role, au.active, au.lead_disabled,
            case when app_role() = 'admin' or u.id = app_user() then au.last_seen_at end as last_seen_at,
            au.hourly_rate_cents, au.cost_rate_cents, au.capacity_minutes,
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

/**
 * Inviter une personne. `locale` : la langue de l'e-mail d'invitation (défaut : celle de l'interface de qui invite) ; le
 * lien ouvre la page d'invitation dans cette langue (`?lang=`). `/invitations` : même route, sous le nom de l'API.
 */
const inviteRoute = async (c: any) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, z.object({ email, role: z.enum(['admin', 'manager', 'member']).default('member'), locale: z.enum(LOCALES).optional() }))
  const l = b.locale ?? asLocale(c.get('locale'))
  if (b.role === 'admin') requireRole(c, 'admin')
  const token = newToken()
  const account = await tx(c, async (db, ctx) => {
    const already = (await db.query(
      // i18n-ok
      `select 1 from account_users au join users u on u.id = au.user_id where lower(u.email) = $1 and au.active`, [b.email])).rowCount
    if (already) throw new HttpError(409, 'already_member')
    // Une place de la formule par personne (invitations en attente comprises).
    await assertSeatFree(db, ctx.accountId)
    await db.query('insert into invitations (account_id, email, role, token_hash, invited_by) values ($1,$2,$3,$4,$5)',
      [ctx.accountId, b.email, b.role, hashToken(token), ctx.userId])
    return (await db.query('select name from accounts where id = app_account()')).rows[0].name as string
  })
  const link = `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/invitation/${token}`
  const linkLang = `${link}?lang=${l}`
  const intro = tr(l, 'invite.text', { who: c.get('name'), account })
  const text = `${intro}\n\n${tr(l, 'invite.accept', { url: linkLang })}`
  await sendMail({ accountId: c.get('ctx').accountId, to: [b.email], subject: tr(l, 'invite.subject', { account }),
    text, html: layout(tr(l, 'invite.title', { account }), htmlParagraphs(intro),
      { label: tr(l, 'invite.button'), url: linkLang }, l), fromUserId: c.get('ctx').userId, fromName: c.get('name') })
  return c.json({ ok: true, link }, 201)
}
app.post('/invite', inviteRoute)
app.post('/invitations', inviteRoute)

app.delete('/invitations/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  await tx(c, (db) => db.query('delete from invitations where id = $1', [c.req.param('id')]))
  return c.json({ ok: true })
})

app.patch('/members/:userId', async (c) => {
  requireRole(c, 'admin')
  const userId = c.req.param('userId')
  if (!uuid.safeParse(userId).success) throw notFound()
  const b = await body(c, z.object({
    role: z.enum(['admin', 'manager', 'member']).optional(),
    // La place ne se règle plus ici : « Retirer » et « Rétablir » (invitations comptées, jamais soi-même, sessions fermées).
    // `active` n'est lu que pour refuser un changement ; la même valeur, envoyée par un onglet resté sur la version
    // d'avant (case « Actif » du dialogue), passe sans effet.
    active: z.boolean().optional(),
    hourly_rate_cents: z.number().int().min(0).max(10_000_00).optional(),
    cost_rate_cents: z.number().int().min(0).max(10_000_00).optional(),
    capacity_minutes: z.number().int().min(0).max(10080).optional(),
  }))
  await tx(c, async (db, ctx) => {
    // Un changement de rôle peut retirer un administrateur : un seul à la fois par entreprise (lib/admins.ts).
    await lockAdmins(db, ctx.accountId)
    await assertStillAdmin(db)
    const was = (await db.query('select active from account_users where account_id = app_account() and user_id = $1', [userId])).rows[0]
    if (!was) throw notFound()
    if (b.active !== undefined && b.active !== was.active) throw new HttpError(400, 'use_remove_restore')
    await db.query(
      `update account_users set role = coalesce($2, role),
              hourly_rate_cents = coalesce($3, hourly_rate_cents), cost_rate_cents = coalesce($4, cost_rate_cents),
              capacity_minutes = coalesce($5, capacity_minutes)
        where account_id = app_account() and user_id = $1`,
      [userId, b.role ?? null, b.hourly_rate_cents ?? null, b.cost_rate_cents ?? null, b.capacity_minutes ?? null])
    // Jamais d'entreprise sans administrateur actif : ce serait s'enfermer dehors.
    const admins = (await db.query(`select count(*)::int as n from account_users where account_id = app_account() and role = 'admin' and active`)).rows[0].n
    if (!admins) throw new HttpError(400, 'last_admin')
  })
  return c.json({ ok: true })
})

/**
 * « Retirer » (administrateur seulement, jamais soi-même) : la personne perd sa place tout de suite, ses sessions dans
 * cette entreprise se ferment, et le retrait est gardé : à sa prochaine arrivée par le Compte Lead, même s'il reste une
 * place, elle voit « accès désactivé » (`ArrivalRefused('desactive')`, routes/auth.ts) tant qu'un administrateur ne la
 * rétablit pas. Ses projets, tâches et temps restent à l'entreprise. Jamais le dernier administrateur actif.
 */
app.post('/members/:userId/remove', async (c) => {
  requireRole(c, 'admin')
  const ctx = c.get('ctx')
  const userId = c.req.param('userId')
  if (!uuid.safeParse(userId).success) throw notFound()
  if (userId === ctx.userId) throw new HttpError(400, 'cannot_remove_self')
  await tx(c, async (db) => {
    // Un seul changement à la fois sur les administrateurs de l'entreprise (lib/admins.ts), par un administrateur encore
    // actif : deux administrateurs qui se retirent l'un l'autre au même instant ne passent pas tous les deux.
    await lockAdmins(db, ctx.accountId)
    await assertStillAdmin(db)
    // Un retrait décidé ici, pas un départ annoncé par ERPlead : `lead_disabled` faux (elle ne revient pas d'elle-même).
    const r = await db.query(
      `update account_users set active = false, lead_disabled = false where account_id = app_account() and user_id = $1 and active`, [userId])
    if (!r.rowCount) throw notFound()
    const admins = (await db.query(`select count(*)::int as n from account_users where account_id = app_account() and role = 'admin' and active`)).rows[0].n
    if (!admins) throw new HttpError(400, 'last_admin')
  })
  // Ses sessions dans cette entreprise (la garde de session les refuserait déjà : elle n'y est plus active).
  await anon((db) => db.query('delete from sessions where user_id = $1 and account_id = $2', [userId, ctx.accountId]))
  return c.json({ ok: true })
})

/** « Rétablir » (administrateur) : la personne reprend une place, s'il en reste une (invitations en attente comprises). */
app.post('/members/:userId/restore', async (c) => {
  requireRole(c, 'admin')
  const userId = c.req.param('userId')
  if (!uuid.safeParse(userId).success) throw notFound()
  await tx(c, async (db, ctx) => {
    const was = (await db.query('select active from account_users where account_id = app_account() and user_id = $1 for update', [userId])).rows[0]
    if (!was) throw notFound()
    if (was.active) return
    await assertSeatFree(db, ctx.accountId)
    await db.query('update account_users set active = true, lead_disabled = false where account_id = app_account() and user_id = $1', [userId])
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
