import { z } from 'zod'
import type { Ctx, Db } from '../db.js'
import { logActivity, mentionedUsers, notify } from '../lib/activity.js'
import { runAutomations } from '../lib/automations.js'
import { buildReport, sendReport } from '../lib/clientReport.js'
import { createDefaultColumns } from '../lib/defaults.js'
import { sendMail } from '../lib/email.js'
import { newMessageId } from '../lib/mailbox/types.js'
import { assertCanOpenProject, isOpenStatus } from '../lib/plans.js'
import { body, cents, email, forbidden, HttpError, notFound, optDate, router, setClause, tx, uuid } from '../lib/http.js'

/**
 * Les projets : portefeuille, fiche, intervenants, étapes, colonnes du tableau, points
 * d'avancement, suivi client, fichiers et emails du projet.
 */
const app = router()

const STATUSES = ['lead', 'planned', 'active', 'on_hold', 'done', 'cancelled'] as const
const HEALTH = ['on_track', 'at_risk', 'off_track'] as const

const projectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(30).nullish(),
  description: z.string().max(20000).optional(),
  client_id: uuid.nullish(),
  owner_id: uuid.nullish(),
  team_id: uuid.nullish(),
  status: z.enum(STATUSES).optional(),
  health: z.enum(HEALTH).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  visibility: z.enum(['account', 'members']).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  start_date: optDate,
  due_date: optDate,
  budget_minutes: z.number().int().min(0).max(10_000_000).nullish(),
  budget_cents: cents.nullish(),
  billing_mode: z.enum(['none', 'hourly', 'retainer', 'fixed', 'milestone']).optional(),
  hourly_rate_cents: z.number().int().min(0).max(10_000_00).nullish(),
  retainer_cents: cents.nullish(),
  fixed_cents: cents.nullish(),
  currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).optional(),
  vat_code: z.enum(['normal', 'reduced', 'lodging', 'exempt', 'export']).optional(),
  portal_enabled: z.boolean().optional(),
  portal_show_tasks: z.boolean().optional(),
  portal_show_time: z.boolean().optional(),
  update_frequency: z.enum(['none', 'weekly', 'biweekly', 'monthly']).optional(),
  is_template: z.boolean().optional(),
})
const PROJECT_FIELDS = Object.keys(projectSchema.shape)

/** Avancement, temps et budget, calculés pour une liste de projets. */
const SUMMARY = `
  p.*, c.name as client_name, u.name as owner_name,
  (select count(*)::int from tasks t where t.project_id = p.id and t.parent_id is null) as tasks_total,
  (select count(*)::int from tasks t where t.project_id = p.id and t.parent_id is null and t.completed_at is not null) as tasks_done,
  (select count(*)::int from tasks t where t.project_id = p.id and t.completed_at is null and t.due_date < current_date) as tasks_late,
  (select coalesce(sum(minutes),0)::int from time_entries te where te.project_id = p.id) as minutes_spent,
  (select coalesce(sum(te.minutes * coalesce(te.rate_cents, p.hourly_rate_cents, 0) / 60),0)::bigint from time_entries te
    where te.project_id = p.id and te.billable) as billable_cents,
  (select count(*)::int from stages s where s.project_id = p.id) as stages_total,
  (select count(*)::int from stages s where s.project_id = p.id and s.status = 'done') as stages_done,
  (select json_build_object('id', s.id, 'name', s.name, 'status', s.status, 'due_date', s.due_date) from stages s
    where s.project_id = p.id and s.status <> 'done' order by s.position limit 1) as current_stage,
  coalesce((select json_agg(json_build_object('id', pu.id, 'name', pu.name, 'color', pu.color, 'role', pm.role) order by pm.role, pu.name)
    from project_members pm join users pu on pu.id = pm.user_id where pm.project_id = p.id), '[]') as members`

app.get('/', async (c) => tx(c, async (db) => {
  const template = c.req.query('template') === '1'
  const rows = (await db.query(
    `select ${SUMMARY} from projects p left join clients c on c.id = p.client_id left join users u on u.id = p.owner_id
      where p.is_template = $1 and (p.archived_at is null or $2)
        and ($3 = '' or p.status = $3) and ($4 = '' or p.client_id::text = $4)
        and ($5 = '' or p.name ilike '%' || $5 || '%' or p.code ilike '%' || $5 || '%' or c.name ilike '%' || $5 || '%')
        and ($6 = '' or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = app_user()) or p.owner_id = app_user())
      order by case p.status when 'active' then 0 when 'planned' then 1 when 'lead' then 2 when 'on_hold' then 3 else 4 end,
               p.due_date nulls last, p.name`,
    [template, c.req.query('archived') === '1', c.req.query('status') ?? '', c.req.query('client') ?? '',
     (c.req.query('q') ?? '').trim(), c.req.query('mine') === '1' ? '1' : ''])).rows
  return c.json(rows)
}))

/** Copie les étapes, colonnes et tâches d'un projet (modèle) dans un autre, dates décalées. */
async function copyStructure(db: Db, ctx: Ctx, fromId: string, toId: string, startDate: string | null) {
  const src = (await db.query('select start_date, coalesce(start_date, created_at::date) as anchor from projects where id = $1', [fromId])).rows[0]
  if (!src) throw notFound()
  // Décalage : les dates du modèle sont rejouées à partir du début du nouveau projet.
  const shift = startDate ? (await db.query('select ($1::date - $2::date)::int as d', [startDate, src.anchor])).rows[0].d : 0
  const cols = new Map<string, string>()
  for (const col of (await db.query('select * from board_columns where project_id = $1 order by position', [fromId])).rows) {
    const n = (await db.query('insert into board_columns (account_id, project_id, name, position, is_done, wip_limit) values ($1,$2,$3,$4,$5,$6) returning id',
      [ctx.accountId, toId, col.name, col.position, col.is_done, col.wip_limit])).rows[0]
    cols.set(col.id, n.id)
  }
  if (!cols.size) await createDefaultColumns(db, ctx.accountId, toId)
  const firstCol = (await db.query('select id from board_columns where project_id = $1 order by position limit 1', [toId])).rows[0]?.id
  const stages = new Map<string, string>()
  for (const s of (await db.query('select * from stages where project_id = $1 order by position', [fromId])).rows) {
    const n = (await db.query(
      `insert into stages (account_id, project_id, name, description, client_note, position, start_date, due_date, visible_to_client, billing_cents)
       values ($1,$2,$3,$4,$5,$6,$7::date + $10::int,$8::date + $10::int,$9,$11) returning id`,
      [ctx.accountId, toId, s.name, s.description, s.client_note, s.position, s.start_date, s.due_date, s.visible_to_client, shift, s.billing_cents])).rows[0]
    stages.set(s.id, n.id)
  }
  const tasks = new Map<string, string>()
  const srcTasks = (await db.query('select * from tasks where project_id = $1 order by parent_id nulls first, position', [fromId])).rows
  for (const t of srcTasks) {
    const n = (await db.query(
      `insert into tasks (account_id, project_id, stage_id, column_id, parent_id, number, title, description, priority, start_date, due_date,
                          estimate_minutes, position, is_milestone, visible_to_client, recurrence, tags, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date + $18::int,$11::date + $18::int,$12,$13,$14,$15,$16,$17,$19) returning id`,
      [ctx.accountId, toId, t.stage_id ? stages.get(t.stage_id) ?? null : null, firstCol, t.parent_id ? tasks.get(t.parent_id) ?? null : null,
       t.number, t.title, t.description, t.priority, t.start_date, t.due_date, t.estimate_minutes, t.position, t.is_milestone,
       t.visible_to_client, t.recurrence, t.tags, shift, ctx.userId])).rows[0]
    tasks.set(t.id, n.id)
    for (const it of (await db.query('select label, position from checklist_items where task_id = $1', [t.id])).rows)
      await db.query('insert into checklist_items (account_id, task_id, label, position) values ($1,$2,$3,$4)', [ctx.accountId, n.id, it.label, it.position])
  }
  for (const d of (await db.query('select d.* from task_dependencies d join tasks t on t.id = d.task_id where t.project_id = $1', [fromId])).rows) {
    if (tasks.has(d.task_id) && tasks.has(d.depends_on_id))
      await db.query('insert into task_dependencies (task_id, depends_on_id, account_id) values ($1,$2,$3)', [tasks.get(d.task_id), tasks.get(d.depends_on_id), ctx.accountId])
  }
}

export async function createProject(db: Db, ctx: Ctx, b: z.infer<typeof projectSchema> & {
  template_id?: string | null; member_ids?: string[]; source?: string; source_ref?: string | null
}) {
  // La formule compte les projets en cours (lib/plans.ts) ; un modèle ou une demande à qualifier ne comptent pas.
  if (!b.is_template && isOpenStatus(b.status)) await assertCanOpenProject(db, ctx.accountId)
  const fields = PROJECT_FIELDS.filter((k) => (b as any)[k] !== undefined)
  const p = (await db.query(
    `insert into projects (account_id, created_by, owner_id, source, source_ref ${fields.filter((f) => f !== 'owner_id').map((f) => ', ' + f).join('')})
     values ($1, $2::uuid, coalesce($3::uuid, $2::uuid), $4, $5 ${fields.filter((f) => f !== 'owner_id').map((_, i) => `, $${i + 6}`).join('')})
     returning id`,
    [ctx.accountId, ctx.userId, b.owner_id ?? null, b.source ?? (b.template_id ? 'template' : 'manual'), b.source_ref ?? null,
     ...fields.filter((f) => f !== 'owner_id').map((k) => (b as any)[k])])).rows[0]
  if (!p.id) throw new Error('not_saved')
  if (b.template_id) await copyStructure(db, ctx, b.template_id, p.id, b.start_date ?? null)
  else await createDefaultColumns(db, ctx.accountId, p.id)
  // Le responsable est toujours intervenant (« lead ») du projet.
  const owner = b.owner_id ?? ctx.userId
  await db.query(`insert into project_members (project_id, user_id, account_id, role) values ($1,$2,$3,'lead') on conflict do nothing`,
    [p.id, owner, ctx.accountId])
  for (const u of b.member_ids ?? [])
    await db.query(`insert into project_members (project_id, user_id, account_id) values ($1,$2,$3) on conflict do nothing`, [p.id, u, ctx.accountId])
  if (!b.code) {
    // Code court par défaut : P-2026-007.
    await db.query(
      `update projects set code = 'P-' || to_char(now(), 'YYYY') || '-' ||
              lpad(((select count(*) from projects where account_id = $2 and not is_template))::text, 3, '0')
        where id = $1 and not is_template`, [p.id, ctx.accountId])
  }
  await logActivity(db, ctx, p.id, 'project_created', { name: b.name })
  await notify(db, ctx, [owner, ...(b.member_ids ?? [])], { kind: 'project_member', title: `Vous intervenez sur « ${b.name} »`, link: `/projets/${p.id}` })
  return p.id as string
}

app.post('/', async (c) => {
  const b = await body(c, projectSchema.extend({ template_id: uuid.nullish(), member_ids: z.array(uuid).max(100).optional() }))
  const id = await tx(c, (db, ctx) => createProject(db, ctx, b))
  return c.json({ id }, 201)
})

app.get('/:id', async (c) => tx(c, async (db) => {
  const id = c.req.param('id')
  const p = (await db.query(`select ${SUMMARY} from projects p left join clients c on c.id = p.client_id left join users u on u.id = p.owner_id where p.id = $1`, [id])).rows[0]
  if (!p) throw notFound()
  const client = p.client_id ? (await db.query('select * from clients where id = $1', [p.client_id])).rows[0] : null
  const contacts = p.client_id ? (await db.query('select * from client_contacts where client_id = $1 order by name', [p.client_id])).rows : []
  const members = (await db.query(
    `select u.id, u.name, u.email, u.color, pm.role, pm.hourly_rate_cents,
            (select coalesce(sum(minutes),0)::int from time_entries t where t.project_id = $1 and t.user_id = u.id) as minutes
       from project_members pm join users u on u.id = pm.user_id where pm.project_id = $1 order by pm.role, u.name`, [id])).rows
  const columns = (await db.query('select * from board_columns where project_id = $1 order by position', [id])).rows
  const stages = (await db.query(
    `select s.*, (select count(*)::int from tasks t where t.stage_id = s.id and t.parent_id is null) as tasks_total,
            (select count(*)::int from tasks t where t.stage_id = s.id and t.parent_id is null and t.completed_at is not null) as tasks_done
       from stages s where s.project_id = $1 order by s.position`, [id])).rows
  const lastUpdate = (await db.query(
    `select pu.*, u.name as author_name from project_updates pu left join users u on u.id = pu.author_id
      where pu.project_id = $1 order by pu.created_at desc limit 1`, [id])).rows[0] ?? null
  return c.json({ ...p, client, contacts, members_detail: members, columns, stages, last_update: lastUpdate,
                  portal_url: `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/suivi/${p.portal_token}` })
}))

async function assertCanEdit(db: Db, ctx: Ctx, projectId: string) {
  const p = (await db.query('select owner_id from projects where id = $1', [projectId])).rows[0]
  if (!p) throw notFound()
  if (ctx.role === 'admin' || ctx.role === 'manager' || p.owner_id === ctx.userId) return
  const m = (await db.query(`select role from project_members where project_id = $1 and user_id = app_user()`, [projectId])).rows[0]
  if (!m || m.role === 'observer') throw forbidden()
}

app.patch('/:id', async (c) => {
  const b = await body(c, projectSchema.partial())
  await tx(c, async (db, ctx) => {
    const id = c.req.param('id')
    await assertCanEdit(db, ctx, id)
    const before = (await db.query('select status, name, is_template, archived_at from projects where id = $1', [id])).rows[0]
    if (!before) throw notFound()
    // Tout passage vers « en cours » prend une place de la formule : statut rouvert, modèle redevenu projet.
    const counted = (p: { status: string; is_template: boolean; archived_at: unknown }) => !p.is_template && !p.archived_at && isOpenStatus(p.status)
    const after = { status: b.status ?? before.status, is_template: b.is_template ?? before.is_template, archived_at: before.archived_at }
    if (!counted(before) && counted(after)) await assertCanOpenProject(db, ctx.accountId)
    const s = setClause(b, PROJECT_FIELDS, 2)
    if (!s.keys.length) return
    await db.query(`update projects set ${s.sql}, updated_at = now(),
      completed_at = case when status = 'done' then coalesce(completed_at, now()) else null end where id = $1`, [id, ...s.values])
    if (b.status && b.status !== before.status) {
      await logActivity(db, ctx, id, 'project_status', { from: before.status, to: b.status })
      if (b.status === 'done') await runAutomations(db, ctx, 'project_completed', { projectId: id }, c.get('name'))
    }
    if (b.owner_id) await db.query(`insert into project_members (project_id, user_id, account_id, role) values ($1,$2,$3,'lead')
      on conflict (project_id, user_id) do update set role = 'lead'`, [id, b.owner_id, ctx.accountId])
  })
  return c.json({ ok: true })
})

/** Archiver (ou désarchiver) ; un modèle se supprime pour de bon. */
app.delete('/:id', async (c) => {
  await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    const p = (await db.query('select is_template, archived_at, status from projects where id = $1', [c.req.param('id')])).rows[0]
    if (!p) throw notFound()
    // Désarchiver un projet en cours reprend une place de la formule.
    if (!p.is_template && p.archived_at && isOpenStatus(p.status)) await assertCanOpenProject(db, ctx.accountId)
    if (p.is_template) await db.query('delete from projects where id = $1', [c.req.param('id')])
    else await db.query('update projects set archived_at = case when archived_at is null then now() else null end where id = $1', [c.req.param('id')])
  })
  return c.json({ ok: true })
})

/** Dupliquer un projet, ou en faire un modèle. */
app.post('/:id/duplicate', async (c) => {
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(200), as_template: z.boolean().default(false),
                                      start_date: optDate, client_id: uuid.nullish() }))
  const id = await tx(c, async (db, ctx) => {
    const src = (await db.query('select * from projects where id = $1', [c.req.param('id')])).rows[0]
    if (!src) throw notFound()
    return createProject(db, ctx, {
      name: b.name, description: src.description, client_id: b.as_template ? null : b.client_id ?? src.client_id,
      billing_mode: src.billing_mode, hourly_rate_cents: src.hourly_rate_cents, retainer_cents: src.retainer_cents,
      fixed_cents: src.fixed_cents, budget_minutes: src.budget_minutes, budget_cents: src.budget_cents, color: src.color,
      currency: src.currency, vat_code: src.vat_code, is_template: b.as_template, start_date: b.start_date ?? null,
      status: b.as_template ? 'planned' : 'active', template_id: src.id, source: 'template',
    })
  })
  return c.json({ id }, 201)
})

// ------------------------------------------------------------------ intervenants

app.post('/:id/members', async (c) => {
  const b = await body(c, z.object({ user_id: uuid, role: z.enum(['lead', 'member', 'observer']).default('member'),
                                      hourly_rate_cents: z.number().int().min(0).max(10_000_00).nullish() }))
  await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    await db.query(
      `insert into project_members (project_id, user_id, account_id, role, hourly_rate_cents) values ($1,$2,$3,$4,$5)
       on conflict (project_id, user_id) do update set role = excluded.role, hourly_rate_cents = excluded.hourly_rate_cents`,
      [c.req.param('id'), b.user_id, ctx.accountId, b.role, b.hourly_rate_cents ?? null])
    const p = (await db.query('select name from projects where id = $1', [c.req.param('id')])).rows[0]
    await notify(db, ctx, [b.user_id], { kind: 'project_member', title: `Vous intervenez sur « ${p.name} »`, link: `/projets/${c.req.param('id')}` })
    await logActivity(db, ctx, c.req.param('id'), 'member_added', { user_id: b.user_id, role: b.role })
  })
  return c.json({ ok: true })
})

app.delete('/:id/members/:uid', async (c) => {
  await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    await db.query('delete from project_members where project_id = $1 and user_id = $2', [c.req.param('id'), c.req.param('uid')])
    await db.query('delete from task_assignees ta using tasks t where t.id = ta.task_id and t.project_id = $1 and ta.user_id = $2 and t.completed_at is null',
      [c.req.param('id'), c.req.param('uid')])
  })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ colonnes du tableau

app.post('/:id/columns', async (c) => {
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(60), is_done: z.boolean().default(false), wip_limit: z.number().int().min(1).max(999).nullish() }))
  const id = await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    return (await db.query(
      `insert into board_columns (account_id, project_id, name, position, is_done, wip_limit)
       values ($1,$2,$3,(select coalesce(max(position),-1)+1 from board_columns where project_id = $2),$4,$5) returning id`,
      [ctx.accountId, c.req.param('id'), b.name, b.is_done, b.wip_limit ?? null])).rows[0].id
  })
  return c.json({ id }, 201)
})

app.patch('/columns/:cid', async (c) => {
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(60).optional(), is_done: z.boolean().optional(),
                                      wip_limit: z.number().int().min(1).max(999).nullish() }))
  await tx(c, async (db) => {
    const s = setClause(b, ['name', 'is_done', 'wip_limit'], 2)
    if (s.keys.length) await db.query(`update board_columns set ${s.sql} where id = $1`, [c.req.param('cid'), ...s.values])
  })
  return c.json({ ok: true })
})

app.delete('/columns/:cid', async (c) => {
  await tx(c, async (db) => {
    const col = (await db.query('select project_id from board_columns where id = $1', [c.req.param('cid')])).rows[0]
    if (!col) throw notFound()
    const n = (await db.query('select count(*)::int as n from board_columns where project_id = $1', [col.project_id])).rows[0].n
    if (n <= 1) throw new HttpError(400, 'last_column')
    const other = (await db.query('select id from board_columns where project_id = $1 and id <> $2 order by position limit 1', [col.project_id, c.req.param('cid')])).rows[0]
    await db.query('update tasks set column_id = $2 where column_id = $1', [c.req.param('cid'), other.id])
    await db.query('delete from board_columns where id = $1', [c.req.param('cid')])
  })
  return c.json({ ok: true })
})

app.post('/:id/columns/order', async (c) => {
  const b = await body(c, z.object({ ids: z.array(uuid).max(50) }))
  await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    for (const [i, id] of b.ids.entries()) await db.query('update board_columns set position = $2 where id = $1 and project_id = $3', [id, i, c.req.param('id')])
  })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ étapes

const stageSchema = z.object({
  name: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), client_note: z.string().max(2000).optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional(), start_date: optDate, due_date: optDate,
  visible_to_client: z.boolean().optional(), billing_cents: cents.nullish(),
})

app.post('/:id/stages', async (c) => {
  const b = await body(c, stageSchema)
  const id = await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    const s = setClause(b, Object.keys(stageSchema.shape), 4)
    const r = (await db.query(
      `insert into stages (account_id, project_id, position ${s.keys.map((k) => ', ' + k).join('')})
       values ($1,$2,$3 ${s.keys.map((_, i) => `, $${i + 4}`).join('')}) returning id`,
      [ctx.accountId, c.req.param('id'),
       (await db.query('select coalesce(max(position),-1)+1 as n from stages where project_id = $1', [c.req.param('id')])).rows[0].n,
       ...s.values])).rows[0]
    await logActivity(db, ctx, c.req.param('id'), 'stage_created', { name: b.name })
    return r.id
  })
  return c.json({ id }, 201)
})

app.patch('/stages/:sid', async (c) => {
  const b = await body(c, stageSchema.partial().extend({ notify_client: z.boolean().optional() }))
  const out = await tx(c, async (db, ctx) => {
    const st = (await db.query('select project_id, status, name from stages where id = $1', [c.req.param('sid')])).rows[0]
    if (!st) throw notFound()
    await assertCanEdit(db, ctx, st.project_id)
    const s = setClause(b, Object.keys(stageSchema.shape), 2)
    if (s.keys.length) await db.query(
      `update stages set ${s.sql}, completed_at = case when status = 'done' then coalesce(completed_at, now()) else null end where id = $1`,
      [c.req.param('sid'), ...s.values])
    let report = null
    if (b.status && b.status !== st.status) {
      await logActivity(db, ctx, st.project_id, 'stage_status', { name: st.name, from: st.status, to: b.status })
      if (b.status === 'done') await runAutomations(db, ctx, 'stage_completed', { projectId: st.project_id, stageId: c.req.param('sid') }, c.get('name'))
      // Le client peut être prévenu à chaque changement d'étape, d'un clic.
      if (b.notify_client) report = await sendReport(db, { accountId: ctx.accountId, projectId: st.project_id, userId: ctx.userId,
        userName: c.get('name'), message: `L'étape « ${st.name} » est maintenant : ${({ todo: 'à venir', in_progress: 'en cours', done: 'terminée', blocked: 'en attente' } as any)[b.status]}.` })
          .catch((e) => ({ error: e.message }))
    }
    return { report }
  })
  return c.json({ ok: true, ...out })
})

app.delete('/stages/:sid', async (c) => {
  await tx(c, async (db, ctx) => {
    const st = (await db.query('select project_id from stages where id = $1', [c.req.param('sid')])).rows[0]
    if (!st) throw notFound()
    await assertCanEdit(db, ctx, st.project_id)
    await db.query('delete from stages where id = $1', [c.req.param('sid')])
  })
  return c.json({ ok: true })
})

app.post('/:id/stages/order', async (c) => {
  const b = await body(c, z.object({ ids: z.array(uuid).max(100) }))
  await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    for (const [i, id] of b.ids.entries()) await db.query('update stages set position = $2 where id = $1 and project_id = $3', [id, i, c.req.param('id')])
  })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ fil, points, suivi client

app.get('/:id/activity', async (c) => tx(c, async (db) => {
  const rows = (await db.query(
    `select * from (
       select 'activity' as type, a.id::text, a.kind, a.data, null as body, a.task_id, a.created_at, u.name as actor_name, u.color as actor_color,
              k.title as task_title
         from activities a left join users u on u.id = a.actor_id left join tasks k on k.id = a.task_id where a.project_id = $1
       union all
       select 'comment', cm.id::text, 'comment', '{}'::jsonb, cm.body, cm.task_id, cm.created_at, u.name, u.color, k.title
         from comments cm left join users u on u.id = cm.author_id left join tasks k on k.id = cm.task_id where cm.project_id = $1
     ) x order by created_at desc limit 200`, [c.req.param('id')])).rows
  return c.json(rows)
}))

app.post('/:id/comments', async (c) => {
  const b = await body(c, z.object({ body: z.string().trim().min(1).max(20000) }))
  const id = await tx(c, async (db, ctx) => {
    const p = (await db.query('select name from projects where id = $1', [c.req.param('id')])).rows[0]
    if (!p) throw notFound()
    const mentions = await mentionedUsers(db, b.body)
    const r = (await db.query('insert into comments (account_id, project_id, author_id, body, mentions) values ($1,$2,$3,$4,$5) returning id',
      [ctx.accountId, c.req.param('id'), ctx.userId, b.body, mentions])).rows[0]
    await notify(db, ctx, mentions, { kind: 'mention', title: `${c.get('name')} vous cite dans « ${p.name} »`, body: b.body.slice(0, 300), link: `/projets/${c.req.param('id')}/activite` })
    return r.id
  })
  return c.json({ id }, 201)
})

app.get('/:id/updates', async (c) => tx(c, async (db) => c.json((await db.query(
  `select pu.*, u.name as author_name from project_updates pu left join users u on u.id = pu.author_id
    where pu.project_id = $1 order by pu.created_at desc`, [c.req.param('id')])).rows)))

app.post('/:id/updates', async (c) => {
  const b = await body(c, z.object({ health: z.enum(HEALTH), body: z.string().trim().max(20000).default(''), share_with_client: z.boolean().default(false) }))
  const id = await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    const r = (await db.query(
      'insert into project_updates (account_id, project_id, author_id, health, body, share_with_client) values ($1,$2,$3,$4,$5,$6) returning id',
      [ctx.accountId, c.req.param('id'), ctx.userId, b.health, b.body, b.share_with_client])).rows[0]
    await db.query('update projects set health = $2, updated_at = now() where id = $1', [c.req.param('id'), b.health])
    await logActivity(db, ctx, c.req.param('id'), 'project_update', { health: b.health })
    const members = (await db.query('select user_id from project_members where project_id = $1', [c.req.param('id')])).rows.map((x) => x.user_id)
    const p = (await db.query('select name from projects where id = $1', [c.req.param('id')])).rows[0]
    await notify(db, ctx, members, { kind: 'project_update', title: `Point d'avancement sur « ${p.name} »`, body: b.body.slice(0, 300), link: `/projets/${c.req.param('id')}` })
    return r.id
  })
  return c.json({ id }, 201)
})

app.get('/:id/client-report', async (c) => tx(c, async (db) => {
  const r = await buildReport(db, c.req.param('id'), c.req.query('message') ?? null)
  const sent = (await db.query(
    `select cr.id, cr.recipients, cr.subject, cr.automatic, cr.sent_at, u.name as sent_by_name
       from client_reports cr left join users u on u.id = cr.sent_by where cr.project_id = $1 order by cr.sent_at desc limit 50`,
    [c.req.param('id')])).rows
  return c.json({ ...r, history: sent })
}))

app.post('/:id/client-report', async (c) => {
  const b = await body(c, z.object({ recipients: z.array(email).max(20).optional(), message: z.string().max(5000).nullish() }))
  const out = await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    try {
      return await sendReport(db, { accountId: ctx.accountId, projectId: c.req.param('id'), userId: ctx.userId, userName: c.get('name'),
                                    recipients: b.recipients, message: b.message })
    } catch (e: any) {
      if (e.message === 'no_recipient') throw new HttpError(400, 'no_recipient')
      throw e
    }
  })
  return c.json(out)
})

app.post('/:id/portal/regenerate', async (c) => {
  await tx(c, async (db, ctx) => {
    await assertCanEdit(db, ctx, c.req.param('id'))
    await db.query(`update projects set portal_token = encode(gen_random_bytes(18), 'hex') where id = $1`, [c.req.param('id')])
  })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ fichiers

app.get('/:id/files', async (c) => tx(c, async (db) => c.json((await db.query(
  `select a.id, a.filename, a.mime, a.size, a.task_id, a.visible_to_client, a.created_at, u.name as uploaded_by_name, k.title as task_title
     from attachments a left join users u on u.id = a.uploaded_by left join tasks k on k.id = a.task_id
    where a.project_id = $1 order by a.created_at desc`, [c.req.param('id')])).rows)))

app.post('/:id/files', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'file_required')
  if (file.size > 15 * 1024 * 1024) throw new HttpError(413, 'file_too_large')
  const buf = Buffer.from(await file.arrayBuffer())
  const taskId = form.get('task_id')
  const id = await tx(c, async (db, ctx) => {
    const r = (await db.query(
      `insert into attachments (account_id, project_id, task_id, filename, mime, size, content, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [ctx.accountId, c.req.param('id'), typeof taskId === 'string' && taskId ? taskId : null, file.name.slice(0, 200),
       file.type || 'application/octet-stream', buf.length, buf, ctx.userId])).rows[0]
    await logActivity(db, ctx, c.req.param('id'), 'file_added', { filename: file.name }, typeof taskId === 'string' && taskId ? taskId : null)
    return r.id
  })
  return c.json({ id }, 201)
})

app.get('/files/:fid', async (c) => {
  const f = await tx(c, async (db) => (await db.query(
    'select a.filename, a.mime, a.content from attachments a join projects p on p.id = a.project_id where a.id = $1', [c.req.param('fid')])).rows[0])
  if (!f) throw notFound()
  return new Response(f.content, { headers: {
    'Content-Type': f.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    'X-Content-Type-Options': 'nosniff' } })
})

app.patch('/files/:fid', async (c) => {
  const b = await body(c, z.object({ visible_to_client: z.boolean() }))
  await tx(c, (db) => db.query('update attachments set visible_to_client = $2 where id = $1', [c.req.param('fid'), b.visible_to_client]))
  return c.json({ ok: true })
})

app.delete('/files/:fid', async (c) => {
  await tx(c, (db) => db.query('delete from attachments where id = $1', [c.req.param('fid')]))
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ emails du projet

app.get('/:id/emails', async (c) => tx(c, async (db) => c.json((await db.query(
  `select id, direction, from_email, from_name, to_emails, subject, left(coalesce(body,''), 4000) as body, received_at
     from email_messages where project_id = $1 order by received_at desc limit 200`, [c.req.param('id')])).rows)))

app.post('/:id/emails', async (c) => {
  const b = await body(c, z.object({ to: z.array(email).min(1).max(20), subject: z.string().trim().min(1).max(300), body: z.string().min(1).max(50000) }))
  const ctx = c.get('ctx')
  const r = await sendMail({ accountId: ctx.accountId, to: b.to, subject: b.subject, text: b.body, fromUserId: ctx.userId, fromName: c.get('name') })
  await tx(c, async (db) => {
    const p = (await db.query('select client_id from projects where id = $1', [c.req.param('id')])).rows[0]
    if (!p) throw notFound()
    await db.query(
      `insert into email_messages (account_id, message_id, direction, from_email, to_emails, subject, body, status, project_id, client_id)
       values ($1,$2,'out',$3,$4,$5,$6,'linked',$7,$8)`,
      [ctx.accountId, newMessageId(c.get('email')), c.get('email'), b.to, b.subject, b.body, c.req.param('id'), p.client_id])
    await logActivity(db, ctx, c.req.param('id'), 'email_out', { subject: b.subject, to: b.to })
  })
  return c.json({ ok: true, via: r.via })
})

export default app
