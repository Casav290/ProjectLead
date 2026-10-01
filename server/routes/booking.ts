import { Hono } from 'hono'
import { z } from 'zod'
import { anon, anonTx, type Db } from '../db.js'
import { htmlParagraphs, layout, sendMail } from '../lib/email.js'
import { body, email, HttpError, requireRole, router, setClause, tx, uuid } from '../lib/http.js'
import { ics } from '../lib/ics.js'
import { localDay, localInstant } from '../lib/time.js'
import { createDefaultColumns } from '../lib/defaults.js'

/**
 * Prise de rendez-vous, comme dans CRMlead : une page publique par type de rendez-vous, des
 * créneaux tirés des disponibilités, moins ce qui est déjà pris dans ProjectLead et dans les
 * agendas extérieurs branchés. Plusieurs hôtes : le premier libre, à tour de rôle.
 * Un rendez-vous pris peut ouvrir un projet (ou rejoindre le projet choisi).
 */
const app = router()

const range = z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)])
const typeSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/), name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''), duration_minutes: z.number().int().min(5).max(480).default(30),
  buffer_minutes: z.number().int().min(0).max(240).default(0), min_notice_hours: z.number().int().min(0).max(720).default(12),
  max_days_ahead: z.number().int().min(1).max(365).default(30), location: z.string().max(300).default(''),
  availability: z.record(z.enum(['1', '2', '3', '4', '5', '6', '7']), z.array(range).max(6)).optional(),
  host_ids: z.array(uuid).max(20).optional(), create_project: z.boolean().default(false), project_id: uuid.nullish(),
  active: z.boolean().default(true),
})
const TYPE_FIELDS = Object.keys(typeSchema.shape)
const publicUrl = (slug: string) => `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/rdv/${slug}`

app.get('/', async (c) => tx(c, async (db) => {
  const types = (await db.query(
    `select bt.*, (select count(*)::int from bookings b where b.booking_type_id = bt.id and b.status = 'confirmed' and b.starts_at > now()) as upcoming
       from booking_types bt order by bt.name`)).rows
  return c.json(types.map((t) => ({ ...t, url: publicUrl(t.slug) })))
}))

app.post('/', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, typeSchema)
  const id = await tx(c, async (db, ctx) => {
    const v = { ...b, host_ids: b.host_ids?.length ? b.host_ids : [ctx.userId] }
    const s = setClause(v, TYPE_FIELDS, 2)
    const vals = s.values.map((x, i) => s.keys[i] === 'availability' ? JSON.stringify(x) : x)
    return (await db.query(`insert into booking_types (account_id, ${s.keys.join(', ')}) values ($1, ${s.keys.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
      [ctx.accountId, ...vals])).rows[0].id
  })
  return c.json({ id, url: publicUrl(b.slug) }, 201)
})

app.patch('/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, typeSchema.partial())
  await tx(c, async (db) => {
    const s = setClause(b, TYPE_FIELDS, 2)
    const vals = s.values.map((x, i) => s.keys[i] === 'availability' ? JSON.stringify(x) : x)
    if (s.keys.length) await db.query(`update booking_types set ${s.sql} where id = $1`, [c.req.param('id'), ...vals])
  })
  return c.json({ ok: true })
})

app.delete('/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  await tx(c, (db) => db.query('delete from booking_types where id = $1', [c.req.param('id')]))
  return c.json({ ok: true })
})

app.get('/bookings', async (c) => tx(c, async (db) => c.json((await db.query(
  `select b.*, bt.name as type_name, u.name as host_name, p.name as project_name from bookings b
     join booking_types bt on bt.id = b.booking_type_id left join users u on u.id = b.host_id left join projects p on p.id = b.project_id
    where b.starts_at > now() - interval '30 days' order by b.starts_at desc limit 200`)).rows)))

export default app

// ------------------------------------------------------------------ créneaux

type BType = { id: string; account_id: string; slug: string; name: string; description: string; duration_minutes: number
  buffer_minutes: number; min_notice_hours: number; max_days_ahead: number; location: string; availability: Record<string, [string, string][]>
  host_ids: string[]; create_project: boolean; project_id: string | null; timezone: string; account_name: string }

async function loadType(db: Db, slug: string): Promise<BType | null> {
  return (await db.query(
    `select bt.*, a.timezone, a.name as account_name from booking_types bt join accounts a on a.id = bt.account_id
      where bt.slug = $1 and bt.active`, [slug])).rows[0] ?? null
}

/** Les périodes occupées de chaque hôte entre deux instants (rendez-vous, réunions, agendas extérieurs). */
async function busy(db: Db, t: BType, from: Date, to: Date) {
  const rows = (await db.query(
    `select a.user_id, e.starts_at, e.ends_at from events e join event_attendees a on a.event_id = e.id
      where e.account_id = $1 and a.user_id = any($2) and e.starts_at < $4 and e.ends_at > $3
     union all
     select e.organizer_id, e.starts_at, e.ends_at from events e
      where e.account_id = $1 and e.organizer_id = any($2) and e.starts_at < $4 and e.ends_at > $3
     union all
     select x.user_id, x.starts_at, x.ends_at from external_events x
      where x.account_id = $1 and x.user_id = any($2) and x.starts_at < $4 and x.ends_at > $3`,
    [t.account_id, t.host_ids, from, to])).rows
  const map = new Map<string, { s: number; e: number }[]>()
  for (const r of rows) {
    const l = map.get(r.user_id) ?? []
    l.push({ s: new Date(r.starts_at).getTime(), e: new Date(r.ends_at).getTime() })
    map.set(r.user_id, l)
  }
  return map
}

const DAY = 86400e3

/** Les créneaux libres : au moins un hôte libre, préavis et horizon respectés. */
async function slots(db: Db, t: BType, fromDate: string, days: number) {
  const now = Date.now()
  const earliest = now + t.min_notice_hours * 3600e3
  const horizon = now + t.max_days_ahead * DAY
  const start = new Date(Date.parse(fromDate + 'T00:00:00Z'))
  const end = new Date(start.getTime() + days * DAY)
  const b = await busy(db, t, new Date(start.getTime() - DAY), new Date(end.getTime() + DAY))
  const pad = t.buffer_minutes * 60e3
  const len = t.duration_minutes * 60e3
  const out: { date: string; times: { start: string; label: string }[] }[] = []
  for (let d = 0; d < days; d++) {
    const date = new Date(start.getTime() + d * DAY).toISOString().slice(0, 10)
    const noon = localInstant(date, '12:00', t.timezone)
    if (!noon) continue
    const iso = localDay(noon, t.timezone).isoDay
    const times: { start: string; label: string }[] = []
    for (const [a, z2] of t.availability[String(iso)] ?? []) {
      const s0 = localInstant(date, a, t.timezone), e0 = localInstant(date, z2, t.timezone)
      if (!s0 || !e0) continue
      for (let s = s0.getTime(); s + len <= e0.getTime(); s += Math.max(len, 15 * 60e3)) {
        if (s < earliest || s > horizon) continue
        const free = t.host_ids.some((h) => !(b.get(h) ?? []).some((x) => x.s < s + len + pad && x.e > s - pad))
        if (free) times.push({ start: new Date(s).toISOString(),
          label: new Intl.DateTimeFormat('fr-CH', { timeZone: t.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(s)) })
      }
    }
    out.push({ date, times })
  }
  return { slots: out, busy: b }
}

export const publicBooking = new Hono()

publicBooking.get('/manage/:token', async (c) => {
  const b = await anon(async (db) => (await db.query(
    `select b.name, b.email, b.starts_at, b.ends_at, b.status, bt.name as type_name, bt.location, a.name as account_name, a.timezone, bt.slug
       from bookings b join booking_types bt on bt.id = b.booking_type_id join accounts a on a.id = b.account_id where b.manage_token = $1`,
    [c.req.param('token')])).rows[0])
  if (!b) return c.json({ error: 'not_found' }, 404)
  return c.json(b)
})

publicBooking.post('/manage/:token/cancel', async (c) => {
  const b = await anonTx(async (db) => {
    const r = (await db.query(
      `update bookings set status = 'cancelled' where manage_token = $1 and status = 'confirmed' and starts_at > now()
       returning id, account_id, event_id, host_id, name, starts_at`, [c.req.param('token')])).rows[0]
    if (!r) return null
    if (r.event_id) await db.query('delete from events where id = $1', [r.event_id])
    if (r.host_id) await db.query(`insert into notifications (account_id, user_id, kind, title, link) values ($1,$2,'booking','Rendez-vous annulé par ' || $3,'/agenda')`,
      [r.account_id, r.host_id, r.name])
    return r
  })
  if (!b) return c.json({ error: 'not_cancellable' }, 409)
  return c.json({ ok: true })
})

publicBooking.get('/:slug', async (c) => {
  const out = await anon(async (db) => {
    const t = await loadType(db, c.req.param('slug'))
    if (!t) return null
    const from = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('from') ?? '') ? c.req.query('from')! : localDay(new Date(), t.timezone).date
    const s = await slots(db, t, from, Math.min(31, Math.max(1, Number(c.req.query('days') ?? 14))))
    return { name: t.name, description: t.description, duration_minutes: t.duration_minutes, location: t.location,
             account: t.account_name, timezone: t.timezone, slots: s.slots }
  })
  if (!out) return c.json({ error: 'not_found' }, 404)
  return c.json(out)
})

publicBooking.post('/:slug', async (c) => {
  const b = await body(c, z.object({
    starts_at: z.string().datetime({ offset: true }), name: z.string().trim().min(1).max(120), email,
    phone: z.string().trim().max(50).optional(), company: z.string().trim().max(200).optional(), message: z.string().max(3000).default(''),
  }))
  const res = await anonTx(async (db) => {
    const t = await loadType(db, c.req.param('slug'))
    if (!t) throw new HttpError(404, 'not_found')
    // Verrou par type : deux personnes ne prennent pas le même créneau au même instant.
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [t.id])
    const start = new Date(b.starts_at)
    const end = new Date(start.getTime() + t.duration_minutes * 60e3)
    const date = localDay(start, t.timezone).date
    const s = await slots(db, t, date, 1)
    if (!s.slots[0]?.times.some((x) => Date.parse(x.start) === start.getTime())) throw new HttpError(409, 'slot_taken')
    // L'hôte : parmi les libres, celui qui a le moins de rendez-vous à venir.
    const pad = t.buffer_minutes * 60e3
    const free = t.host_ids.filter((h) => !(s.busy.get(h) ?? []).some((x) => x.s < end.getTime() + pad && x.e > start.getTime() - pad))
    const host = (await db.query(
      `select u from unnest($1::uuid[]) u order by (select count(*) from bookings b where b.host_id = u and b.status = 'confirmed' and b.starts_at > now()), random() limit 1`,
      [free])).rows[0].u as string

    // Le client : retrouvé par son email, sinon créé.
    let client = (await db.query(
      `select c.id from clients c left join client_contacts cc on cc.client_id = c.id
        where c.account_id = $1 and (lower(c.email) = $2 or lower(cc.email) = $2) limit 1`, [t.account_id, b.email])).rows[0]
    if (!client) {
      client = (await db.query(
        `insert into clients (account_id, kind, name, contact_person, email, phone) values ($1,$2,$3,$4,$5,$6) returning id`,
        [t.account_id, b.company ? 'company' : 'person', b.company || b.name, b.company ? b.name : null, b.email, b.phone ?? null])).rows[0]
      if (b.company) await db.query('insert into client_contacts (account_id, client_id, name, email, phone) values ($1,$2,$3,$4,$5)',
        [t.account_id, client.id, b.name, b.email, b.phone ?? null])
    }
    let projectId = t.project_id
    if (!projectId && t.create_project) {
      const p = (await db.query(
        `insert into projects (account_id, name, description, client_id, owner_id, status, source, created_by)
         values ($1,$2,$3,$4,$5,'lead','booking',$5) returning id`,
        [t.account_id, `${t.name} — ${b.company || b.name}`, b.message, client.id, host])).rows[0]
      await createDefaultColumns(db, t.account_id, p.id)
      await db.query(`insert into project_members (project_id, user_id, account_id, role) values ($1,$2,$3,'lead')`, [p.id, host, t.account_id])
      projectId = p.id
    }
    const booking = (await db.query(
      `insert into bookings (account_id, booking_type_id, host_id, name, email, phone, company, message, starts_at, ends_at, project_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, manage_token`,
      [t.account_id, t.id, host, b.name, b.email, b.phone ?? null, b.company ?? null, b.message, start, end, projectId])).rows[0]
    const ev = (await db.query(
      `insert into events (account_id, project_id, client_id, organizer_id, title, description, location, kind, starts_at, ends_at, booking_id)
       values ($1,$2,$3,$4,$5,$6,$7,'meeting',$8,$9,$10) returning id`,
      [t.account_id, projectId, client.id, host, `${t.name} — ${b.name}`, b.message, t.location, start, end, booking.id])).rows[0]
    await db.query('update bookings set event_id = $2 where id = $1', [booking.id, ev.id])
    await db.query('insert into event_attendees (event_id, account_id, user_id) values ($1,$2,$3)', [ev.id, t.account_id, host])
    await db.query('insert into event_attendees (event_id, account_id, email, name) values ($1,$2,$3,$4)', [ev.id, t.account_id, b.email, b.name])
    await db.query(`insert into notifications (account_id, user_id, kind, title, body, link) values ($1,$2,'booking',$3,$4,'/agenda')`,
      [t.account_id, host, `Nouveau rendez-vous : ${b.name}`, `${t.name}, ${new Intl.DateTimeFormat('fr-CH', { timeZone: t.timezone, dateStyle: 'full', timeStyle: 'short' }).format(start)}`])
    if (projectId) await db.query(`insert into activities (account_id, project_id, kind, data) values ($1,$2,'booking',$3)`,
      [t.account_id, projectId, JSON.stringify({ name: b.name, starts_at: start })])
    const hostRow = (await db.query('select name, email from users where id = $1', [host])).rows[0]
    return { t, booking, start, end, host: hostRow, hostId: host, eventId: ev.id }
  })
  const when = new Intl.DateTimeFormat('fr-CH', { timeZone: res.t.timezone, dateStyle: 'full', timeStyle: 'short' }).format(res.start)
  const manage = `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/rdv/gerer/${res.booking.manage_token}`
  const text = `Bonjour ${b.name},\n\nVotre rendez-vous « ${res.t.name} » avec ${res.host.name} (${res.t.account_name}) est confirmé pour le ${when}.` +
    `${res.t.location ? `\nLieu : ${res.t.location}` : ''}\n\nPour l'annuler : ${manage}`
  await sendMail({ accountId: res.t.account_id, to: [b.email], subject: `Rendez-vous confirmé : ${res.t.name}`, text,
    html: layout('Rendez-vous confirmé', htmlParagraphs(text.replace(`\n\nPour l'annuler : ${manage}`, '')), { label: 'Gérer le rendez-vous', url: manage }),
    fromUserId: res.hostId, fromName: res.host.name,
    attachments: [{ filename: 'rendez-vous.ics', contentType: 'text/calendar; method=REQUEST; charset=utf-8', content: Buffer.from(ics([{
      uid: `${res.eventId}@projectlead`, title: `${res.t.name} — ${res.t.account_name}`, location: res.t.location, start: res.start, end: res.end,
      organizer: { name: res.host.name, email: res.host.email }, attendees: [{ name: b.name, email: b.email }] }], { method: 'REQUEST' })) }] })
    .catch((e) => console.error('[rendez-vous] confirmation', e.message))
  return c.json({ ok: true, starts_at: res.start, host: res.host.name, manage_url: manage }, 201)
})

