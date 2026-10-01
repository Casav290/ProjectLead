import { z } from 'zod'
import { logActivity } from '../lib/activity.js'
import { body, date, forbidden, HttpError, notFound, router, setClause, tx, uuid } from '../lib/http.js'

/** Le temps : saisie, chronomètre, feuille de temps de la semaine, rapports, charge de travail. */
const app = router()

app.get('/entries', async (c) => tx(c, async (db) => {
  const q = c.req.query()
  const user = q.user === 'all' ? null : q.user && q.user !== 'me' ? q.user : 'me'
  const rows = (await db.query(
    `select te.*, p.name as project_name, p.color as project_color, k.title as task_title, u.name as user_name, cl.name as client_name
       from time_entries te join projects p on p.id = te.project_id join users u on u.id = te.user_id
       left join tasks k on k.id = te.task_id left join clients cl on cl.id = p.client_id
      where ($1::date is null or te.entry_date >= $1) and ($2::date is null or te.entry_date <= $2)
        and ($3::text is null or ($3 = 'me' and te.user_id = app_user()) or te.user_id::text = $3)
        and ($4::uuid is null or te.project_id = $4)
      order by te.entry_date desc, te.created_at desc limit 2000`,
    [q.from ?? null, q.to ?? null, user, q.project ?? null])).rows
  return c.json(rows)
}))

const entrySchema = z.object({
  project_id: uuid, task_id: uuid.nullish(), entry_date: date, minutes: z.number().int().min(1).max(1440),
  billable: z.boolean().default(true), note: z.string().max(2000).default(''),
})

app.post('/entries', async (c) => {
  const b = await body(c, entrySchema.extend({ user_id: uuid.optional() }))
  const id = await tx(c, async (db, ctx) => {
    // Saisir pour quelqu'un d'autre : responsables et administrateurs seulement.
    if (b.user_id && b.user_id !== ctx.userId && ctx.role === 'member') throw forbidden()
    const p = (await db.query('select id, billing_mode from projects where id = $1', [b.project_id])).rows[0]
    if (!p) throw notFound()
    const r = (await db.query(
      `insert into time_entries (account_id, user_id, project_id, task_id, entry_date, minutes, billable, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [ctx.accountId, b.user_id ?? ctx.userId, b.project_id, b.task_id ?? null, b.entry_date, b.minutes,
       p.billing_mode === 'none' ? false : b.billable, b.note])).rows[0]
    return r.id
  })
  return c.json({ id }, 201)
})

async function ownEditable(db: any, ctx: any, id: string) {
  const e = (await db.query('select user_id, invoiced_at from time_entries where id = $1', [id])).rows[0]
  if (!e) throw notFound()
  if (e.user_id !== ctx.userId && ctx.role === 'member') throw forbidden()
  // Du temps déjà facturé ne se modifie plus : la facture le porte.
  if (e.invoiced_at) throw new HttpError(409, 'already_invoiced')
}

app.patch('/entries/:id', async (c) => {
  const b = await body(c, entrySchema.partial())
  await tx(c, async (db, ctx) => {
    await ownEditable(db, ctx, c.req.param('id'))
    const s = setClause(b, Object.keys(entrySchema.shape), 2)
    if (s.keys.length) await db.query(`update time_entries set ${s.sql} where id = $1`, [c.req.param('id'), ...s.values])
  })
  return c.json({ ok: true })
})

app.delete('/entries/:id', async (c) => {
  await tx(c, async (db, ctx) => {
    await ownEditable(db, ctx, c.req.param('id'))
    await db.query('delete from time_entries where id = $1', [c.req.param('id')])
  })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ chronomètre

app.post('/timer/start', async (c) => {
  const b = await body(c, z.object({ project_id: uuid, task_id: uuid.nullish(), note: z.string().max(2000).default('') }))
  const id = await tx(c, async (db, ctx) => {
    await stopRunning(db)
    const p = (await db.query('select billing_mode from projects where id = $1', [b.project_id])).rows[0]
    if (!p) throw notFound()
    return (await db.query(
      `insert into time_entries (account_id, user_id, project_id, task_id, started_at, note, billable)
       values ($1,$2,$3,$4,now(),$5,$6) returning id`,
      [ctx.accountId, ctx.userId, b.project_id, b.task_id ?? null, b.note, p.billing_mode !== 'none'])).rows[0].id
  })
  return c.json({ id }, 201)
})

/** Arrête le chronomètre de la personne : la durée arrondie à la minute supérieure. */
async function stopRunning(db: any) {
  const r = (await db.query(
    `update time_entries set minutes = least(1440, greatest(1, ceil(extract(epoch from now() - started_at) / 60)::int)),
            entry_date = (started_at at time zone (select timezone from accounts where id = app_account()))::date
      where user_id = app_user() and minutes is null returning id, minutes, project_id, task_id`)).rows[0]
  return r ?? null
}

app.post('/timer/stop', async (c) => {
  const r = await tx(c, async (db, ctx) => {
    const s = await stopRunning(db)
    if (s) await logActivity(db, ctx, s.project_id, 'time_logged', { minutes: s.minutes }, s.task_id)
    return s
  })
  return c.json(r ?? { stopped: false })
})

// ------------------------------------------------------------------ feuille de temps

/** La semaine de la personne : une ligne par projet et tâche, une colonne par jour. */
app.get('/week', async (c) => tx(c, async (db) => {
  const start = c.req.query('start')
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new HttpError(400, 'start_required')
  const user = c.req.query('user') || null
  const rows = (await db.query(
    `select te.project_id, p.name as project_name, p.color as project_color, te.task_id, k.title as task_title,
            te.entry_date, sum(te.minutes)::int as minutes
       from time_entries te join projects p on p.id = te.project_id left join tasks k on k.id = te.task_id
      where te.user_id = coalesce($2::uuid, app_user()) and te.entry_date between $1::date and $1::date + 6 and te.minutes is not null
      group by 1,2,3,4,5,6 order by p.name, k.title nulls first`, [start, user])).rows
  const capacity = (await db.query('select capacity_minutes from account_users where account_id = app_account() and user_id = coalesce($1::uuid, app_user())', [user])).rows[0]
  return c.json({ rows, capacity_minutes: capacity?.capacity_minutes ?? 2400 })
}))

/** Une cellule de la feuille de temps : remplace le total du jour pour ce projet et cette tâche. */
app.put('/week/cell', async (c) => {
  const b = await body(c, z.object({ project_id: uuid, task_id: uuid.nullish(), entry_date: date, minutes: z.number().int().min(0).max(1440) }))
  await tx(c, async (db, ctx) => {
    const invoiced = (await db.query(
      `select 1 from time_entries where user_id = app_user() and project_id = $1 and task_id is not distinct from $2 and entry_date = $3 and invoiced_at is not null`,
      [b.project_id, b.task_id ?? null, b.entry_date])).rowCount
    if (invoiced) throw new HttpError(409, 'already_invoiced')
    await db.query(`delete from time_entries where user_id = app_user() and project_id = $1 and task_id is not distinct from $2 and entry_date = $3 and minutes is not null`,
      [b.project_id, b.task_id ?? null, b.entry_date])
    if (b.minutes > 0) {
      const p = (await db.query('select billing_mode from projects where id = $1', [b.project_id])).rows[0]
      if (!p) throw notFound()
      await db.query(`insert into time_entries (account_id, user_id, project_id, task_id, entry_date, minutes, billable) values ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.accountId, ctx.userId, b.project_id, b.task_id ?? null, b.entry_date, b.minutes, p.billing_mode !== 'none'])
    }
  })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ rapports

app.get('/report', async (c) => tx(c, async (db) => {
  const q = c.req.query()
  const group = ({ project: 'p.name', user: 'u.name', client: `coalesce(cl.name, '(sans client)')`,
                   month: `to_char(te.entry_date, 'YYYY-MM')`, task: `coalesce(k.title, '(sans tâche)')` } as Record<string, string>)[q.group ?? 'project']
  if (!group) throw new HttpError(400, 'invalid_group')
  const rows = (await db.query(
    `select ${group} as label, sum(te.minutes)::int as minutes,
            sum(case when te.billable then te.minutes else 0 end)::int as billable_minutes,
            sum(case when te.billable then te.minutes * coalesce(te.rate_cents, pm.hourly_rate_cents, p.hourly_rate_cents, au.hourly_rate_cents, 0) / 60 else 0 end)::bigint as billable_cents,
            sum(te.minutes * au.cost_rate_cents / 60)::bigint as cost_cents,
            sum(case when te.invoiced_at is not null then te.minutes else 0 end)::int as invoiced_minutes
       from time_entries te join projects p on p.id = te.project_id join users u on u.id = te.user_id
       left join clients cl on cl.id = p.client_id left join tasks k on k.id = te.task_id
       left join project_members pm on pm.project_id = te.project_id and pm.user_id = te.user_id
       left join account_users au on au.account_id = te.account_id and au.user_id = te.user_id
      where te.minutes is not null and ($1::date is null or te.entry_date >= $1) and ($2::date is null or te.entry_date <= $2)
        and ($3::uuid is null or te.project_id = $3) and ($4::uuid is null or te.user_id = $4)
      group by 1 order by 2 desc`, [q.from ?? null, q.to ?? null, q.project ?? null, q.user ?? null])).rows
  return c.json(rows)
}))

/** Export CSV du temps (pour un tableur ou une fiduciaire). */
app.get('/export.csv', async (c) => {
  const q = c.req.query()
  const rows = await tx(c, async (db) => (await db.query(
    `select te.entry_date, u.name as person, p.code, p.name as project, coalesce(cl.name,'') as client, coalesce(k.title,'') as task,
            te.minutes, te.billable, te.note, te.invoice_ref
       from time_entries te join projects p on p.id = te.project_id join users u on u.id = te.user_id
       left join clients cl on cl.id = p.client_id left join tasks k on k.id = te.task_id
      where te.minutes is not null and ($1::date is null or te.entry_date >= $1) and ($2::date is null or te.entry_date <= $2)
      order by te.entry_date`, [q.from ?? null, q.to ?? null])).rows)
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = ['Date;Personne;Code;Projet;Client;Tâche;Heures;Facturable;Note;Facture',
    ...rows.map((r) => [r.entry_date, r.person, r.code, r.project, r.client, r.task, (r.minutes / 60).toFixed(2).replace('.', ','),
                        r.billable ? 'oui' : 'non', r.note, r.invoice_ref].map(cell).join(';'))].join('\r\n')
  return new Response('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="temps.csv"' } })
})

/**
 * Charge de travail : par personne et par semaine, le temps estimé des tâches ouvertes qui
 * tombent dans la semaine (réparti entre les personnes assignées) face à sa capacité.
 */
app.get('/workload', async (c) => tx(c, async (db) => {
  const from = c.req.query('from')
  const weeks = Math.min(12, Math.max(1, Number(c.req.query('weeks') ?? 6)))
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new HttpError(400, 'from_required')
  const people = (await db.query(
    `select u.id, u.name, u.color, au.capacity_minutes from account_users au join users u on u.id = au.user_id
      where au.account_id = app_account() and au.active order by u.name`)).rows
  const load = (await db.query(
    `select ta.user_id, ((coalesce(t.due_date, t.start_date) - $1::date) / 7)::int as week,
            sum(coalesce(t.estimate_minutes, 60)::numeric / (select count(*) from task_assignees x where x.task_id = t.id))::int as minutes,
            count(*)::int as tasks
       from tasks t join task_assignees ta on ta.task_id = t.id join projects p on p.id = t.project_id
      where t.completed_at is null and not p.is_template and p.archived_at is null
        and coalesce(t.due_date, t.start_date) between $1::date and $1::date + $2::int * 7 - 1
      group by 1,2`, [from, weeks])).rows
  const overdue = (await db.query(
    `select ta.user_id, count(*)::int as tasks, sum(coalesce(t.estimate_minutes, 60))::int as minutes
       from tasks t join task_assignees ta on ta.task_id = t.id join projects p on p.id = t.project_id
      where t.completed_at is null and not p.is_template and p.archived_at is null and t.due_date < $1::date group by 1`, [from])).rows
  const logged = (await db.query(
    `select user_id, ((entry_date - $1::date) / 7)::int as week, sum(minutes)::int as minutes from time_entries
      where entry_date between $1::date and $1::date + $2::int * 7 - 1 and minutes is not null group by 1,2`, [from, weeks])).rows
  return c.json({ weeks, people, load, overdue, logged })
}))

app.get('/running', async (c) => tx(c, async (db) => c.json((await db.query(
  `select te.id, te.started_at, te.project_id, p.name as project_name, te.task_id, k.title as task_title
     from time_entries te join projects p on p.id = te.project_id left join tasks k on k.id = te.task_id
    where te.user_id = app_user() and te.minutes is null`)).rows[0] ?? null)))

export default app
