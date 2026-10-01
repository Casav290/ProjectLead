import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { anon, type Ctx, withTenant } from '../db.js'
import { body, date, HttpError, uuid } from '../lib/http.js'
import { createProject } from './projects.js'

/**
 * API REST publique (`Authorization: Bearer pl_…`), pour relier ProjectLead à un autre outil
 * ou à une automatisation (Make, n8n…). Une clé agit au nom de la personne qui l'a créée.
 */
type V1Env = { Variables: { ctx: Ctx } }
const app = new Hono<V1Env>()

app.use('*', async (c, next) => {
  const m = c.req.header('authorization')?.match(/^Bearer\s+(pl_[\w-]+)$/)
  if (!m) return c.json({ error: 'unauthenticated' }, 401)
  const k = await anon(async (db) => (await db.query(
    `update api_keys k set last_used_at = now() from account_users au
      where k.key_hash = $1 and k.revoked_at is null and au.account_id = k.account_id and au.user_id = k.user_id and au.active
      returning k.account_id, k.user_id, au.role`, [createHash('sha256').update(m[1]).digest('hex')])).rows[0])
  if (!k) return c.json({ error: 'invalid_key' }, 401)
  c.set('ctx', { accountId: k.account_id, userId: k.user_id, role: k.role })
  await next()
})

app.get('/projects', async (c) => c.json({ data: await withTenant(c.get('ctx'), async (db) => (await db.query(
  `select p.id, p.code, p.name, p.status, p.health, p.start_date, p.due_date, p.client_id, c.name as client_name, p.billing_mode, p.updated_at
     from projects p left join clients c on c.id = p.client_id where not p.is_template and p.archived_at is null order by p.updated_at desc limit 500`)).rows) }))

app.get('/projects/:id', async (c) => {
  const p = await withTenant(c.get('ctx'), async (db) => {
    const p = (await db.query('select * from projects where id = $1 and not is_template', [c.req.param('id')])).rows[0]
    if (!p) return null
    const stages = (await db.query('select id, name, status, start_date, due_date from stages where project_id = $1 order by position', [p.id])).rows
    return { ...p, portal_token: undefined, stages }
  })
  return p ? c.json({ data: p }) : c.json({ error: 'not_found' }, 404)
})

app.post('/projects', async (c) => {
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(20000).optional(),
    client_id: uuid.nullish(), template_id: uuid.nullish(), start_date: date.nullish(), due_date: date.nullish(), external_id: z.string().max(200).optional() }))
  const id = await withTenant(c.get('ctx'), async (db) => {
    if (b.external_id) {
      const ex = (await db.query(`select id from projects where source = 'api' and source_ref = $1`, [b.external_id])).rows[0]
      if (ex) return { id: ex.id, existing: true }
    }
    return { id: await createProject(db, c.get('ctx'), { ...b, source: 'api', source_ref: b.external_id ?? null }), existing: false }
  })
  return c.json({ data: { id: id.id } }, id.existing ? 200 : 201)
})

app.get('/tasks', async (c) => c.json({ data: await withTenant(c.get('ctx'), async (db) => (await db.query(
  `select t.id, t.project_id, t.number, t.title, t.priority, t.start_date, t.due_date, t.completed_at, s.name as stage
     from tasks t join projects p on p.id = t.project_id left join stages s on s.id = t.stage_id
    where not p.is_template and ($1::uuid is null or t.project_id = $1) order by t.updated_at desc limit 1000`, [c.req.query('project') ?? null])).rows) }))

app.post('/tasks', async (c) => {
  const b = await body(c, z.object({ project_id: uuid, title: z.string().trim().min(1).max(500), description: z.string().max(50000).default(''),
    due_date: date.nullish(), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal') }))
  const id = await withTenant(c.get('ctx'), async (db) => {
    if (!(await db.query('select 1 from projects where id = $1', [b.project_id])).rowCount) throw new HttpError(404, 'not_found')
    return (await db.query(
      `insert into tasks (account_id, project_id, column_id, number, title, description, due_date, priority, created_by, position)
       values ($1,$2,(select id from board_columns where project_id = $2 order by position limit 1),(select coalesce(max(number),0)+1 from tasks where project_id = $2),
               $3,$4,$5,$6,$7,(select coalesce(max(position),0)+1 from tasks where project_id = $2)) returning id`,
      [c.get('ctx').accountId, b.project_id, b.title, b.description, b.due_date ?? null, b.priority, c.get('ctx').userId])).rows[0].id
  })
  return c.json({ data: { id } }, 201)
})

app.post('/time', async (c) => {
  const b = await body(c, z.object({ project_id: uuid, task_id: uuid.nullish(), entry_date: date, minutes: z.number().int().min(1).max(1440),
    note: z.string().max(2000).default(''), billable: z.boolean().default(true) }))
  const id = await withTenant(c.get('ctx'), async (db) => (await db.query(
    `insert into time_entries (account_id, user_id, project_id, task_id, entry_date, minutes, note, billable) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [c.get('ctx').accountId, c.get('ctx').userId, b.project_id, b.task_id ?? null, b.entry_date, b.minutes, b.note, b.billable])).rows[0].id)
  return c.json({ data: { id } }, 201)
})

export default app
