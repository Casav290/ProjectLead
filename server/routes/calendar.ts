import { Hono } from 'hono'
import { z } from 'zod'
import { anon } from '../db.js'
import { logActivity, notify } from '../lib/activity.js'
import { htmlParagraphs, layout, sendMail } from '../lib/email.js'
import { normalizeCalendarUrl, syncFeed } from '../lib/extcal.js'
import { body, email, HttpError, notFound, router, setClause, tx, uuid } from '../lib/http.js'
import { ics, type IcsEvent } from '../lib/ics.js'
import { mailboxSecretConfigured, seal } from '../lib/mailbox/secret.js'

/**
 * L'agenda : réunions et rendez-vous de projet, échéances des tâches, agendas extérieurs
 * (lus), et un flux iCalendar personnel pour voir ProjectLead dans Google, Outlook ou Apple.
 */
const app = router()

const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat('fr-CH', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d)

app.get('/events', async (c) => tx(c, async (db) => {
  const from = c.req.query('from'), to = c.req.query('to')
  if (!from || !to) throw new HttpError(400, 'range_required')
  const mine = c.req.query('scope') !== 'all'
  const events = (await db.query(
    `select e.*, p.name as project_name, p.color as project_color, cl.name as client_name, u.name as organizer_name,
            coalesce((select json_agg(json_build_object('user_id', a.user_id, 'email', coalesce(a.email, au.email), 'name', coalesce(a.name, au.name)))
              from event_attendees a left join users au on au.id = a.user_id where a.event_id = e.id), '[]') as attendees
       from events e left join projects p on p.id = e.project_id left join clients cl on cl.id = e.client_id left join users u on u.id = e.organizer_id
      where e.starts_at < $2::date + 1 and e.ends_at >= $1::date
        and (not $3 or e.organizer_id = app_user() or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = app_user()))
      order by e.starts_at`, [from, to, mine])).rows
  const tasks = (await db.query(
    `select t.id, t.title, t.due_date, t.start_date, t.completed_at, t.is_milestone, t.project_id, p.name as project_name, p.color as project_color
       from tasks t join projects p on p.id = t.project_id
      where not p.is_template and p.archived_at is null and t.due_date between $1::date and $2::date
        and (not $3 or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = app_user()))
      order by t.due_date`, [from, to, mine])).rows
  const stages = (await db.query(
    `select s.id, s.name, s.due_date, s.status, s.project_id, p.name as project_name, p.color as project_color
       from stages s join projects p on p.id = s.project_id
      where not p.is_template and p.archived_at is null and s.due_date between $1::date and $2::date
        and (not $3 or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = app_user()))`, [from, to, mine])).rows
  const external = (await db.query(
    `select x.id, x.title, x.starts_at, x.ends_at, x.all_day, f.name as feed_name, f.color
       from external_events x join calendar_feeds f on f.id = x.feed_id
      where x.user_id = app_user() and x.starts_at < $2::date + 1 and x.ends_at >= $1::date order by x.starts_at`, [from, to])).rows
  return c.json({ events, tasks, stages, external })
}))

const eventSchema = z.object({
  title: z.string().trim().min(1).max(300), description: z.string().max(10000).default(''), location: z.string().max(500).default(''),
  kind: z.enum(['meeting', 'call', 'workshop', 'deadline', 'other']).default('meeting'),
  starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }), all_day: z.boolean().default(false),
  project_id: uuid.nullish(), client_id: uuid.nullish(),
  attendee_user_ids: z.array(uuid).max(50).default([]),
  attendee_emails: z.array(email).max(50).default([]),
  send_invites: z.boolean().default(false),
})

/** Envoie l'invitation (fichier .ics joint) aux participants extérieurs. */
async function invite(accountId: string, userId: string, userName: string, userEmail: string, ev: any, emails: string[], cancel = false) {
  if (!emails.length) return
  const tz = await anon(async (db) => (await db.query('select timezone from accounts where id = $1', [accountId])).rows[0]?.timezone ?? 'Europe/Zurich')
  const file = ics([{ uid: `${ev.id}@projectlead`, title: ev.title, description: ev.description, location: ev.location,
    start: new Date(ev.starts_at), end: new Date(ev.ends_at), organizer: { name: userName, email: userEmail },
    attendees: emails.map((e) => ({ email: e })), status: cancel ? 'CANCELLED' : 'CONFIRMED' }], { method: cancel ? 'CANCEL' : 'REQUEST' })
  const when = fmt(new Date(ev.starts_at), tz)
  const text = cancel ? `Le rendez-vous « ${ev.title} » du ${when} est annulé.`
    : `${userName} vous invite : ${ev.title}\nQuand : ${when}${ev.location ? `\nOù : ${ev.location}` : ''}${ev.description ? `\n\n${ev.description}` : ''}`
  await sendMail({ accountId, to: emails, subject: `${cancel ? 'Annulé' : 'Invitation'} : ${ev.title}`, text,
    html: layout(ev.title, htmlParagraphs(text)), fromUserId: userId, fromName: userName,
    attachments: [{ filename: 'invitation.ics', content: Buffer.from(file), contentType: `text/calendar; method=${cancel ? 'CANCEL' : 'REQUEST'}; charset=utf-8` }] })
}

app.post('/events', async (c) => {
  const b = await body(c, eventSchema)
  if (Date.parse(b.ends_at) < Date.parse(b.starts_at)) throw new HttpError(400, 'end_before_start')
  const ev = await tx(c, async (db, ctx) => {
    const e = (await db.query(
      `insert into events (account_id, project_id, client_id, organizer_id, title, description, location, kind, starts_at, ends_at, all_day)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [ctx.accountId, b.project_id ?? null, b.client_id ?? null, ctx.userId, b.title, b.description, b.location, b.kind, b.starts_at, b.ends_at, b.all_day])).rows[0]
    for (const u of new Set([ctx.userId, ...b.attendee_user_ids]))
      await db.query('insert into event_attendees (event_id, account_id, user_id) values ($1,$2,$3) on conflict do nothing', [e.id, ctx.accountId, u])
    for (const m of b.attendee_emails)
      await db.query('insert into event_attendees (event_id, account_id, email) values ($1,$2,$3)', [e.id, ctx.accountId, m])
    await notify(db, ctx, b.attendee_user_ids, { kind: 'event', title: `Invitation : ${b.title}`, link: '/agenda' })
    if (b.project_id) await logActivity(db, ctx, b.project_id, 'event_created', { title: b.title, starts_at: b.starts_at })
    return e
  })
  if (b.send_invites) await invite(c.get('ctx').accountId, c.get('ctx').userId, c.get('name'), c.get('email'), ev, b.attendee_emails)
  return c.json({ id: ev.id }, 201)
})

app.patch('/events/:id', async (c) => {
  const b = await body(c, eventSchema.partial())
  const out = await tx(c, async (db, ctx) => {
    const s = setClause(b, ['title', 'description', 'location', 'kind', 'starts_at', 'ends_at', 'all_day', 'project_id', 'client_id'], 2)
    const r = s.keys.length ? await db.query(`update events set ${s.sql} where id = $1 returning *`, [c.req.param('id'), ...s.values])
                            : await db.query('select * from events where id = $1', [c.req.param('id')])
    if (!r.rowCount) throw notFound()
    if (b.attendee_user_ids || b.attendee_emails) {
      await db.query('delete from event_attendees where event_id = $1', [c.req.param('id')])
      for (const u of new Set([ctx.userId, ...(b.attendee_user_ids ?? [])]))
        await db.query('insert into event_attendees (event_id, account_id, user_id) values ($1,$2,$3) on conflict do nothing', [c.req.param('id'), ctx.accountId, u])
      for (const m of b.attendee_emails ?? [])
        await db.query('insert into event_attendees (event_id, account_id, email) values ($1,$2,$3)', [c.req.param('id'), ctx.accountId, m])
    }
    const emails = (await db.query('select email from event_attendees where event_id = $1 and email is not null', [c.req.param('id')])).rows.map((x) => x.email)
    return { ev: r.rows[0], emails }
  })
  if (b.send_invites) await invite(c.get('ctx').accountId, c.get('ctx').userId, c.get('name'), c.get('email'), out.ev, out.emails)
  return c.json({ ok: true })
})

app.delete('/events/:id', async (c) => {
  const out = await tx(c, async (db) => {
    const ev = (await db.query('select * from events where id = $1', [c.req.param('id')])).rows[0]
    if (!ev) throw notFound()
    const emails = (await db.query('select email from event_attendees where event_id = $1 and email is not null', [ev.id])).rows.map((x) => x.email)
    await db.query('delete from events where id = $1', [ev.id])
    if (ev.booking_id) await db.query(`update bookings set status = 'cancelled' where id = $1`, [ev.booking_id])
    return { ev, emails }
  })
  if (c.req.query('notify') === '1') await invite(c.get('ctx').accountId, c.get('ctx').userId, c.get('name'), c.get('email'), out.ev, out.emails, true)
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ agendas extérieurs

app.get('/feeds', async (c) => tx(c, async (db) => c.json((await db.query(
  `select id, name, color, last_synced_at, sync_error, (select count(*)::int from external_events x where x.feed_id = f.id) as events
     from calendar_feeds f where user_id = app_user() order by name`)).rows)))

app.post('/feeds', async (c) => {
  if (!mailboxSecretConfigured()) throw new HttpError(503, 'app_secret_missing')
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(100), url: z.string().max(2000),
                                      color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#57534e') }))
  const url = normalizeCalendarUrl(b.url)
  if (!url) throw new HttpError(400, 'calendar_url_invalid')
  const feed = await tx(c, async (db, ctx) => (await db.query(
    'insert into calendar_feeds (account_id, user_id, name, url, color) values ($1,$2,$3,$4,$5) returning id, account_id, user_id, url',
    [ctx.accountId, ctx.userId, b.name, seal(url), b.color])).rows[0])
  const r = await syncFeed(feed)
  return c.json({ id: feed.id, ...r }, 201)
})

app.post('/feeds/:id/sync', async (c) => {
  const feed = await tx(c, async (db) => (await db.query('select id, account_id, user_id, url from calendar_feeds where id = $1 and user_id = app_user()', [c.req.param('id')])).rows[0])
  if (!feed) throw notFound()
  return c.json(await syncFeed(feed))
})

app.delete('/feeds/:id', async (c) => {
  await tx(c, (db) => db.query('delete from calendar_feeds where id = $1 and user_id = app_user()', [c.req.param('id')]))
  return c.json({ ok: true })
})

export default app

// ------------------------------------------------------------------ flux public

/** `/api/public/calendar/<jeton>.ics` : l'agenda ProjectLead de la personne, en lecture. */
export const publicCalendar = new Hono()
publicCalendar.get('/:file', async (c) => {
  const token = c.req.param('file').replace(/\.ics$/, '')
  if (!/^[0-9a-f]{36}$/.test(token)) return c.text('not found', 404)
  const out = await anon(async (db) => {
    const who = (await db.query(
      `select au.user_id, au.account_id, u.name from account_users au join users u on u.id = au.user_id where au.ical_token = $1 and au.active`, [token])).rows[0]
    if (!who) return null
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')
    const evs = (await db.query(
      `select e.id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.all_day, p.name as project_name from events e
         left join projects p on p.id = e.project_id
        where e.account_id = $1 and e.starts_at > now() - interval '60 days'
          and (e.organizer_id = $2 or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = $2))`,
      [who.account_id, who.user_id])).rows
    const tasks = (await db.query(
      `select t.id, t.title, t.due_date, p.name as project_name, t.project_id from tasks t join projects p on p.id = t.project_id
        where t.account_id = $1 and t.completed_at is null and t.due_date is not null and not p.is_template and p.archived_at is null
          and exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = $2)`, [who.account_id, who.user_id])).rows
    const list: IcsEvent[] = [
      ...evs.map((e) => ({ uid: `${e.id}@projectlead`, title: e.project_name ? `${e.title} (${e.project_name})` : e.title,
        description: e.description, location: e.location, start: new Date(e.starts_at), end: new Date(e.ends_at) })),
      ...tasks.map((t) => ({ uid: `task-${t.id}@projectlead`, title: `Échéance : ${t.title} (${t.project_name})`, allDay: true,
        date: t.due_date, start: new Date(t.due_date), end: new Date(t.due_date), url: `${base}/projets/${t.project_id}?tache=${t.id}` })),
    ]
    return ics(list, { name: `ProjectLead — ${who.name}` })
  })
  if (!out) return c.text('not found', 404)
  return c.body(out, 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' })
})
