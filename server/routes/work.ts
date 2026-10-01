import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { anonTx } from '../db.js'
import { createDefaultColumns } from '../lib/defaults.js'
import { body, email, HttpError, requireRole, router, setClause, tx, uuid } from '../lib/http.js'

/** Accueil, notifications, recherche, automatisations, formulaires de demande, clés d'API. */
const app = router()

app.get('/dashboard', async (c) => tx(c, async (db) => {
  const myTasks = (await db.query(
    `select t.id, t.title, t.due_date, t.priority, t.project_id, p.name as project_name, p.color as project_color, t.completed_at
       from tasks t join projects p on p.id = t.project_id join task_assignees ta on ta.task_id = t.id and ta.user_id = app_user()
      where t.completed_at is null and not p.is_template and p.archived_at is null
      order by t.due_date nulls last, case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end limit 50`)).rows
  const projects = (await db.query(
    `select p.id, p.name, p.code, p.color, p.status, p.health, p.due_date, c.name as client_name,
            (select count(*)::int from tasks t where t.project_id = p.id and t.parent_id is null) as tasks_total,
            (select count(*)::int from tasks t where t.project_id = p.id and t.parent_id is null and t.completed_at is not null) as tasks_done,
            (select count(*)::int from tasks t where t.project_id = p.id and t.completed_at is null and t.due_date < current_date) as tasks_late,
            (select coalesce(sum(minutes),0)::int from time_entries te where te.project_id = p.id) as minutes_spent, p.budget_minutes
       from projects p left join clients c on c.id = p.client_id
      where not p.is_template and p.archived_at is null and p.status in ('active','planned','on_hold')
        and (exists (select 1 from project_members m where m.project_id = p.id and m.user_id = app_user()) or p.owner_id = app_user() or app_role() <> 'member')
      order by case p.health when 'off_track' then 0 when 'at_risk' then 1 else 2 end, p.due_date nulls last limit 30`)).rows
  const week = (await db.query(
    `select entry_date, sum(minutes)::int as minutes from time_entries
      where user_id = app_user() and entry_date >= date_trunc('week', current_date)::date and minutes is not null group by 1 order by 1`)).rows
  const events = (await db.query(
    `select e.id, e.title, e.starts_at, e.ends_at, e.location, p.name as project_name from events e left join projects p on p.id = e.project_id
      where e.starts_at >= now() - interval '1 hour' and e.starts_at < now() + interval '7 days'
        and (e.organizer_id = app_user() or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = app_user()))
      order by e.starts_at limit 10`)).rows
  const counts = (await db.query(
    `select (select count(*)::int from projects where not is_template and archived_at is null and status = 'active') as active,
            (select count(*)::int from projects where not is_template and archived_at is null and status in ('active','planned') and health <> 'on_track') as at_risk,
            (select count(*)::int from projects where not is_template and archived_at is null and status in ('active','planned') and due_date < current_date) as late,
            (select count(*)::int from email_messages where status = 'new' and direction = 'in') as inbox,
            (select count(*)::int from projects where not is_template and archived_at is null and status = 'lead') as leads`)).rows[0]
  const activity = (await db.query(
    `select a.kind, a.data, a.created_at, a.project_id, p.name as project_name, u.name as actor_name
       from activities a join projects p on p.id = a.project_id left join users u on u.id = a.actor_id
      where not p.is_template order by a.created_at desc limit 20`)).rows
  return c.json({ myTasks, projects, week, events, counts, activity })
}))

app.get('/notifications', async (c) => tx(c, async (db) => c.json((await db.query(
  `select * from notifications where user_id = app_user() order by created_at desc limit 100`)).rows)))

app.post('/notifications/read', async (c) => {
  const b = await body(c, z.object({ ids: z.array(uuid).max(200).optional() }))
  await tx(c, (db) => db.query(`update notifications set read_at = now() where user_id = app_user() and read_at is null and ($1::uuid[] is null or id = any($1))`, [b.ids ?? null]))
  return c.json({ ok: true })
})

app.get('/search', async (c) => tx(c, async (db) => {
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) return c.json({ projects: [], tasks: [], clients: [] })
  const like = `%${q}%`
  const [projects, tasks, clients] = await Promise.all([
    db.query(`select id, name, code, status, color from projects where not is_template and (name ilike $1 or code ilike $1 or description ilike $1) order by updated_at desc limit 10`, [like]),
    db.query(`select t.id, t.title, t.project_id, p.name as project_name, t.completed_at from tasks t join projects p on p.id = t.project_id
               where not p.is_template and (t.title ilike $1 or t.description ilike $1) order by t.completed_at nulls first, t.updated_at desc limit 15`, [like]),
    db.query(`select id, name, town, email from clients where archived_at is null and (name ilike $1 or email ilike $1 or contact_person ilike $1) order by name limit 10`, [like]),
  ])
  return c.json({ projects: projects.rows, tasks: tasks.rows, clients: clients.rows })
}))

// ------------------------------------------------------------------ automatisations

const autoSchema = z.object({
  name: z.string().trim().min(1).max(120), project_id: uuid.nullish(),
  trigger: z.enum(['task_completed', 'task_moved', 'stage_completed', 'task_created', 'project_completed']),
  conditions: z.record(z.string(), z.any()).default({}),
  action: z.enum(['notify', 'assign', 'set_priority', 'move_column', 'complete_stage', 'send_client_update', 'create_task']),
  params: z.record(z.string(), z.any()).default({}), active: z.boolean().default(true),
})

app.get('/automations', async (c) => tx(c, async (db) => c.json((await db.query(
  `select a.*, p.name as project_name from automations a left join projects p on p.id = a.project_id order by a.created_at`)).rows)))

app.post('/automations', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, autoSchema)
  const id = await tx(c, async (db, ctx) => (await db.query(
    `insert into automations (account_id, project_id, name, trigger, conditions, action, params, active) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.accountId, b.project_id ?? null, b.name, b.trigger, JSON.stringify(b.conditions), b.action, JSON.stringify(b.params), b.active])).rows[0].id)
  return c.json({ id }, 201)
})

app.patch('/automations/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, autoSchema.partial())
  await tx(c, async (db) => {
    const v: any = { ...b }
    if (v.conditions) v.conditions = JSON.stringify(v.conditions)
    if (v.params) v.params = JSON.stringify(v.params)
    const s = setClause(v, Object.keys(autoSchema.shape), 2)
    if (s.keys.length) await db.query(`update automations set ${s.sql} where id = $1`, [c.req.param('id'), ...s.values])
  })
  return c.json({ ok: true })
})

app.delete('/automations/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  await tx(c, (db) => db.query('delete from automations where id = $1', [c.req.param('id')]))
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ formulaires de demande

const formSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/), name: z.string().trim().min(1).max(120), intro: z.string().max(3000).default(''),
  template_id: uuid.nullish(), owner_id: uuid.nullish(), active: z.boolean().default(true),
})
const formUrl = (slug: string) => `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/demande/${slug}`

app.get('/forms', async (c) => tx(c, async (db) => c.json((await db.query(
  `select f.*, p.name as template_name, (select count(*)::int from projects x where x.source = 'form' and x.source_ref like f.id::text || ':%') as received
     from intake_forms f left join projects p on p.id = f.template_id order by f.created_at`)).rows.map((f) => ({ ...f, url: formUrl(f.slug) })))))

app.post('/forms', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, formSchema)
  const id = await tx(c, async (db, ctx) => (await db.query(
    `insert into intake_forms (account_id, slug, name, intro, template_id, owner_id, active) values ($1,$2,$3,$4,$5,coalesce($6::uuid,$7::uuid),$8) returning id`,
    [ctx.accountId, b.slug, b.name, b.intro, b.template_id ?? null, b.owner_id ?? null, ctx.userId, b.active])).rows[0].id)
  return c.json({ id, url: formUrl(b.slug) }, 201)
})

app.patch('/forms/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, formSchema.partial())
  await tx(c, async (db) => {
    const s = setClause(b, Object.keys(formSchema.shape), 2)
    if (s.keys.length) await db.query(`update intake_forms set ${s.sql} where id = $1`, [c.req.param('id'), ...s.values])
  })
  return c.json({ ok: true })
})

app.delete('/forms/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  await tx(c, (db) => db.query('delete from intake_forms where id = $1', [c.req.param('id')]))
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ clés d'API

app.get('/api-keys', async (c) => tx(c, async (db) => c.json((await db.query(
  `select k.id, k.name, k.prefix, k.last_used_at, k.revoked_at, k.created_at, u.name as user_name from api_keys k join users u on u.id = k.user_id
    order by k.created_at desc`)).rows)))

app.post('/api-keys', async (c) => {
  requireRole(c, 'admin', 'manager')
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(100) }))
  const key = `pl_${randomBytes(24).toString('base64url')}`
  await tx(c, (db, ctx) => db.query('insert into api_keys (account_id, user_id, name, prefix, key_hash) values ($1,$2,$3,$4,$5)',
    [ctx.accountId, ctx.userId, b.name, key.slice(0, 8), createHash('sha256').update(key).digest('hex')]))
  return c.json({ key }, 201)
})

app.delete('/api-keys/:id', async (c) => {
  requireRole(c, 'admin', 'manager')
  await tx(c, (db) => db.query('update api_keys set revoked_at = now() where id = $1', [c.req.param('id')]))
  return c.json({ ok: true })
})

export default app

// ------------------------------------------------------------------ formulaire public

export const publicForms = new Hono()

publicForms.get('/:slug', async (c) => {
  const f = await anonTx(async (db) => (await db.query(
    `select f.name, f.intro, a.name as account from intake_forms f join accounts a on a.id = f.account_id where f.slug = $1 and f.active`,
    [c.req.param('slug')])).rows[0])
  if (!f) return c.json({ error: 'not_found' }, 404)
  return c.json(f)
})

/** Une demande reçue ouvre un projet « à qualifier », avec son client, d'après le modèle du formulaire. */
publicForms.post('/:slug', async (c) => {
  const b = await body(c, z.object({
    name: z.string().trim().min(1).max(120), email, company: z.string().trim().max(200).optional(), phone: z.string().trim().max(50).optional(),
    subject: z.string().trim().min(1).max(200), message: z.string().trim().max(10000).default(''),
    website: z.string().max(0).optional(), // piège à robots : un humain ne voit pas ce champ
  }))
  const out = await anonTx(async (db) => {
    const f = (await db.query(`select * from intake_forms where slug = $1 and active`, [c.req.param('slug')])).rows[0]
    if (!f) throw new HttpError(404, 'not_found')
    const recent = (await db.query(`select count(*)::int as n from projects where account_id = $1 and source = 'form' and created_at > now() - interval '10 minutes'`, [f.account_id])).rows[0].n
    if (recent > 20) throw new HttpError(429, 'too_many')
    let client = (await db.query(`select id from clients where account_id = $1 and lower(email) = $2 limit 1`, [f.account_id, b.email])).rows[0]
    if (!client) client = (await db.query(`insert into clients (account_id, kind, name, contact_person, email, phone) values ($1,$2,$3,$4,$5,$6) returning id`,
      [f.account_id, b.company ? 'company' : 'person', b.company || b.name, b.company ? b.name : null, b.email, b.phone ?? null])).rows[0]
    const p = (await db.query(
      `insert into projects (account_id, name, description, client_id, owner_id, status, source, source_ref, created_by)
       values ($1,$2,$3,$4,$5,'lead','form',$6,$5) returning id`,
      [f.account_id, b.subject, `Demande de ${b.name} <${b.email}>${b.phone ? `, ${b.phone}` : ''} :\n\n${b.message}`, client.id, f.owner_id,
       `${f.id}:${randomBytes(6).toString('hex')}`])).rows[0]
    if (f.template_id) {
      // Les étapes du modèle, sans dates : le projet n'est pas encore lancé.
      for (const s of (await db.query('select name, description, position, visible_to_client from stages where project_id = $1', [f.template_id])).rows)
        await db.query('insert into stages (account_id, project_id, name, description, position, visible_to_client) values ($1,$2,$3,$4,$5,$6)',
          [f.account_id, p.id, s.name, s.description, s.position, s.visible_to_client])
    }
    await createDefaultColumns(db, f.account_id, p.id)
    if (f.owner_id) {
      await db.query(`insert into project_members (project_id, user_id, account_id, role) values ($1,$2,$3,'lead')`, [p.id, f.owner_id, f.account_id])
      await db.query(`insert into notifications (account_id, user_id, kind, title, link) values ($1,$2,'form',$3,$4)`,
        [f.account_id, f.owner_id, `Nouvelle demande : ${b.subject}`, `/projets/${p.id}`])
    }
    return p.id
  })
  return c.json({ ok: true, id: out }, 201)
})

