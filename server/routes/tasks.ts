import { z } from 'zod'
import type { Ctx, Db } from '../db.js'
import { logActivity, mentionedUsers, notify } from '../lib/activity.js'
import { runAutomations } from '../lib/automations.js'
import { body, HttpError, notFound, optDate, router, setClause, tx, uuid } from '../lib/http.js'

/** Les tâches : tableau, liste, Gantt, calendrier et « Mes tâches » lisent tous ici. */
const app = router()

const taskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(50000).optional(),
  stage_id: uuid.nullish(),
  column_id: uuid.nullish(),
  parent_id: uuid.nullish(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  start_date: optDate,
  due_date: optDate,
  estimate_minutes: z.number().int().min(0).max(100_000).nullish(),
  position: z.number().finite().optional(),
  is_milestone: z.boolean().optional(),
  visible_to_client: z.boolean().optional(),
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  custom: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
})
const TASK_FIELDS = Object.keys(taskSchema.shape)

export const TASK_COLS = `
  t.*, p.name as project_name, p.color as project_color, p.code as project_code, bc.name as column_name, bc.is_done as column_done,
  s.name as stage_name,
  coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name, 'color', u.color) order by u.name)
    from task_assignees ta join users u on u.id = ta.user_id where ta.task_id = t.id), '[]') as assignees,
  (select count(*)::int from checklist_items ci where ci.task_id = t.id) as checklist_total,
  (select count(*)::int from checklist_items ci where ci.task_id = t.id and ci.done) as checklist_done,
  (select count(*)::int from tasks st where st.parent_id = t.id) as subtasks_total,
  (select count(*)::int from tasks st where st.parent_id = t.id and st.completed_at is not null) as subtasks_done,
  (select count(*)::int from comments cm where cm.task_id = t.id) as comments,
  (select coalesce(array_agg(d.depends_on_id), '{}') from task_dependencies d where d.task_id = t.id) as depends_on,
  exists (select 1 from task_dependencies d join tasks dt on dt.id = d.depends_on_id where d.task_id = t.id and dt.completed_at is null) as blocked,
  (select coalesce(sum(te.minutes),0)::int from time_entries te where te.task_id = t.id) as minutes_spent`

const FROM = `from tasks t join projects p on p.id = t.project_id
  left join board_columns bc on bc.id = t.column_id left join stages s on s.id = t.stage_id`

app.get('/', async (c) => tx(c, async (db) => {
  const q = c.req.query()
  const where: string[] = ['p.archived_at is null']
  const args: unknown[] = []
  const add = (sql: string, ...v: unknown[]) => {
    let s = sql
    for (const x of v) { args.push(x); s = s.replace('?', `$${args.length}`) }
    where.push(s)
  }
  if (q.project) add('t.project_id = ?', q.project)
  else add('not p.is_template')
  if (q.assignee === 'me') add('exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = app_user())')
  else if (q.assignee) add('exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = ?)', q.assignee)
  if (q.status === 'open') add('t.completed_at is null')
  if (q.status === 'done') add('t.completed_at is not null')
  if (q.due === 'overdue') add('t.completed_at is null and t.due_date < current_date')
  if (q.due === 'today') add('t.completed_at is null and t.due_date <= current_date')
  if (q.due === 'week') add(`t.completed_at is null and t.due_date <= current_date + 7`)
  if (q.from) add('coalesce(t.due_date, t.start_date) >= ?::date', q.from)
  if (q.to) add('coalesce(t.start_date, t.due_date) <= ?::date', q.to)
  if (q.stage) add('t.stage_id = ?', q.stage)
  if (q.top === '1') add('t.parent_id is null')
  if (q.q) add(`(t.title ilike '%' || ? || '%' or ? = any(t.tags))`, q.q, q.q)
  const rows = (await db.query(
    `select ${TASK_COLS} ${FROM} where ${where.join(' and ')}
      order by ${q.project ? 't.position, t.number' : 't.due_date nulls last, t.priority desc, t.position'} limit 2000`, args)).rows
  return c.json(rows)
}))

app.get('/:id', async (c) => tx(c, async (db) => {
  const t = (await db.query(`select ${TASK_COLS} ${FROM} where t.id = $1`, [c.req.param('id')])).rows[0]
  if (!t) throw notFound()
  const [checklist, subtasks, deps, blocking, comments, files, time, activity] = await Promise.all([
    db.query('select * from checklist_items where task_id = $1 order by position, label', [t.id]),
    db.query(`select ${TASK_COLS} ${FROM} where t.parent_id = $1 order by t.position, t.number`, [t.id]),
    db.query('select k.id, k.title, k.number, k.completed_at from task_dependencies d join tasks k on k.id = d.depends_on_id where d.task_id = $1', [t.id]),
    db.query('select k.id, k.title, k.number, k.completed_at from task_dependencies d join tasks k on k.id = d.task_id where d.depends_on_id = $1', [t.id]),
    db.query(`select cm.*, u.name as author_name, u.color as author_color from comments cm left join users u on u.id = cm.author_id
               where cm.task_id = $1 order by cm.created_at`, [t.id]),
    db.query('select id, filename, mime, size, created_at from attachments where task_id = $1 order by created_at desc', [t.id]),
    db.query(`select te.id, te.entry_date, te.minutes, te.note, te.billable, u.name as user_name from time_entries te join users u on u.id = te.user_id
               where te.task_id = $1 order by te.entry_date desc`, [t.id]),
    db.query(`select a.kind, a.data, a.created_at, u.name as actor_name from activities a left join users u on u.id = a.actor_id
               where a.task_id = $1 order by a.created_at desc limit 50`, [t.id]),
  ])
  return c.json({ ...t, checklist: checklist.rows, subtasks: subtasks.rows, dependencies: deps.rows, blocking: blocking.rows,
                  comment_list: comments.rows, files: files.rows, time: time.rows, activity: activity.rows })
}))

async function setAssignees(db: Db, ctx: Ctx, taskId: string, ids: string[], title: string, projectId: string, name: string) {
  const before = new Set((await db.query('select user_id from task_assignees where task_id = $1', [taskId])).rows.map((r) => r.user_id))
  await db.query('delete from task_assignees where task_id = $1 and not (user_id = any($2))', [taskId, ids])
  for (const u of ids) {
    await db.query('insert into task_assignees (task_id, user_id, account_id) values ($1,$2,$3) on conflict do nothing', [taskId, u, ctx.accountId])
    // Assigner sur un projet fait de la personne un intervenant du projet.
    await db.query('insert into project_members (project_id, user_id, account_id) values ($1,$2,$3) on conflict do nothing', [projectId, u, ctx.accountId])
  }
  const added = ids.filter((u) => !before.has(u))
  await notify(db, ctx, added, { kind: 'assigned', title: `${name} vous a confié « ${title} »`, link: `/projets/${projectId}?tache=${taskId}` })
}

/** Terminer ou rouvrir une tâche, avec tout ce qui s'ensuit. */
async function setCompletion(db: Db, ctx: Ctx, taskId: string, done: boolean, name: string) {
  const t = (await db.query('select * from tasks where id = $1', [taskId])).rows[0]
  if (!t || Boolean(t.completed_at) === done) return
  if (done) {
    const doneCol = (await db.query('select id from board_columns where project_id = $1 and is_done order by position limit 1', [t.project_id])).rows[0]
    await db.query(
      `update tasks set completed_at = now(), updated_at = now(),
              column_id = case when (select is_done from board_columns where id = tasks.column_id) then column_id else coalesce($2, column_id) end
        where id = $1`, [taskId, doneCol?.id ?? null])
    await logActivity(db, ctx, t.project_id, 'task_completed', { title: t.title }, taskId)
    // Les tâches qui l'attendaient sont peut-être débloquées : on prévient leurs responsables.
    const waiting = (await db.query(
      `select k.id, k.title, ta.user_id from task_dependencies d join tasks k on k.id = d.task_id
         join task_assignees ta on ta.task_id = k.id where d.depends_on_id = $1 and k.completed_at is null
          and not exists (select 1 from task_dependencies d2 join tasks o on o.id = d2.depends_on_id
                          where d2.task_id = k.id and o.completed_at is null and o.id <> $1)`, [taskId])).rows
    for (const w of waiting) await notify(db, ctx, [w.user_id], { kind: 'unblocked', title: `« ${w.title} » peut commencer`, link: `/projets/${t.project_id}?tache=${w.id}` })
    // Tâche récurrente : la suivante naît quand celle-ci se termine.
    if (t.recurrence !== 'none') {
      const step = { daily: '1 day', weekly: '7 days', monthly: '1 month' }[t.recurrence as 'daily']
      const n = (await db.query(
        `insert into tasks (account_id, project_id, stage_id, column_id, parent_id, number, title, description, priority, start_date, due_date,
                            estimate_minutes, position, visible_to_client, recurrence, tags, created_by)
         select account_id, project_id, stage_id, (select id from board_columns where project_id = t.project_id and not is_done order by position limit 1),
                parent_id, (select coalesce(max(number),0)+1 from tasks where project_id = t.project_id), title, description, priority,
                (start_date + $2::interval)::date, (coalesce(due_date, current_date) + $2::interval)::date, estimate_minutes, position + 0.5,
                visible_to_client, recurrence, tags, created_by
           from tasks t where id = $1 returning id`, [taskId, step])).rows[0]
      await db.query('insert into task_assignees (task_id, user_id, account_id) select $2, user_id, account_id from task_assignees where task_id = $1', [taskId, n.id])
      await db.query('insert into checklist_items (account_id, task_id, label, position) select account_id, $2, label, position from checklist_items where task_id = $1', [taskId, n.id])
    }
    await runAutomations(db, ctx, 'task_completed', { projectId: t.project_id, taskId, stageId: t.stage_id, columnId: t.column_id }, name)
  } else {
    const firstCol = (await db.query('select id from board_columns where project_id = $1 and not is_done order by position limit 1', [t.project_id])).rows[0]
    await db.query(
      `update tasks set completed_at = null, updated_at = now(),
              column_id = case when (select is_done from board_columns where id = tasks.column_id) then coalesce($2, column_id) else column_id end
        where id = $1`, [taskId, firstCol?.id ?? null])
    await logActivity(db, ctx, t.project_id, 'task_reopened', { title: t.title }, taskId)
  }
}

app.post('/', async (c) => {
  const b = await body(c, taskSchema.extend({ project_id: uuid, assignee_ids: z.array(uuid).max(50).optional() }))
  const id = await tx(c, async (db, ctx) => {
    const p = (await db.query('select id from projects where id = $1', [b.project_id])).rows[0]
    if (!p) throw notFound()
    const col = b.column_id ?? (await db.query('select id from board_columns where project_id = $1 order by position limit 1', [b.project_id])).rows[0]?.id ?? null
    const s = setClause({ ...b, column_id: col }, TASK_FIELDS.filter((f) => f !== 'position'), 6)
    const r = (await db.query(
      `insert into tasks (account_id, project_id, created_by, number, position ${s.keys.map((k) => ', ' + k).join('')})
       values ($1,$2,$3,$4,$5 ${s.keys.map((_, i) => `, $${i + 6}`).join('')}) returning id, title`,
      [ctx.accountId, b.project_id, ctx.userId,
       (await db.query('select coalesce(max(number),0)+1 as n from tasks where project_id = $1', [b.project_id])).rows[0].n,
       b.position ?? (await db.query('select coalesce(max(position),0)+1 as n from tasks where project_id = $1', [b.project_id])).rows[0].n,
       ...s.values])).rows[0]
    if (b.assignee_ids?.length) await setAssignees(db, ctx, r.id, b.assignee_ids, r.title, b.project_id, c.get('name'))
    await logActivity(db, ctx, b.project_id, 'task_created', { title: r.title }, r.id)
    await runAutomations(db, ctx, 'task_created', { projectId: b.project_id, taskId: r.id, stageId: b.stage_id ?? null, columnId: col }, c.get('name'))
    if (col && (await db.query('select is_done from board_columns where id = $1', [col])).rows[0]?.is_done)
      await setCompletion(db, ctx, r.id, true, c.get('name'))
    return r.id
  })
  return c.json({ id }, 201)
})

app.patch('/:id', async (c) => {
  const b = await body(c, taskSchema.partial().extend({ assignee_ids: z.array(uuid).max(50).optional(), completed: z.boolean().optional() }))
  await tx(c, async (db, ctx) => {
    const t = (await db.query('select * from tasks where id = $1', [c.req.param('id')])).rows[0]
    if (!t) throw notFound()
    if (b.parent_id && b.parent_id === t.id) throw new HttpError(400, 'invalid_parent')
    const s = setClause(b, TASK_FIELDS, 2)
    if (s.keys.length) await db.query(`update tasks set ${s.sql}, updated_at = now() where id = $1`, [t.id, ...s.values])
    if (b.assignee_ids) await setAssignees(db, ctx, t.id, b.assignee_ids, b.title ?? t.title, t.project_id, c.get('name'))
    if (b.due_date !== undefined && b.due_date !== t.due_date) await logActivity(db, ctx, t.project_id, 'task_due', { title: t.title, due_date: b.due_date }, t.id)
    if (b.column_id && b.column_id !== t.column_id) {
      const col = (await db.query('select name, is_done from board_columns where id = $1 and project_id = $2', [b.column_id, t.project_id])).rows[0]
      if (!col) throw new HttpError(400, 'unknown_column')
      await logActivity(db, ctx, t.project_id, 'task_moved', { title: t.title, column: col.name }, t.id)
      await runAutomations(db, ctx, 'task_moved', { projectId: t.project_id, taskId: t.id, stageId: t.stage_id, columnId: b.column_id }, c.get('name'))
      if (col.is_done && !t.completed_at) await setCompletion(db, ctx, t.id, true, c.get('name'))
      if (!col.is_done && t.completed_at && b.completed === undefined) await setCompletion(db, ctx, t.id, false, c.get('name'))
    }
    if (b.completed !== undefined) await setCompletion(db, ctx, t.id, b.completed, c.get('name'))
  })
  return c.json({ ok: true })
})

/** Modifier plusieurs tâches d'un coup (liste : sélection multiple). */
app.post('/bulk', async (c) => {
  const b = await body(c, z.object({ ids: z.array(uuid).min(1).max(500), patch: z.object({
    completed: z.boolean().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    due_date: optDate, stage_id: uuid.nullish(), add_assignee: uuid.optional(), delete: z.boolean().optional(),
  }) }))
  await tx(c, async (db, ctx) => {
    for (const id of b.ids) {
      const t = (await db.query('select id, title, project_id from tasks where id = $1', [id])).rows[0]
      if (!t) continue
      if (b.patch.delete) { await db.query('delete from tasks where id = $1', [id]); continue }
      const s = setClause(b.patch, ['priority', 'due_date', 'stage_id'], 2)
      if (s.keys.length) await db.query(`update tasks set ${s.sql}, updated_at = now() where id = $1`, [id, ...s.values])
      if (b.patch.add_assignee) {
        const cur = (await db.query('select user_id from task_assignees where task_id = $1', [id])).rows.map((r) => r.user_id)
        await setAssignees(db, ctx, id, [...new Set([...cur, b.patch.add_assignee])], t.title, t.project_id, c.get('name'))
      }
      if (b.patch.completed !== undefined) await setCompletion(db, ctx, id, b.patch.completed, c.get('name'))
    }
  })
  return c.json({ ok: true })
})

app.delete('/:id', async (c) => {
  await tx(c, async (db, ctx) => {
    const t = (await db.query('select project_id, title from tasks where id = $1', [c.req.param('id')])).rows[0]
    if (!t) throw notFound()
    await db.query('delete from tasks where id = $1', [c.req.param('id')])
    await logActivity(db, ctx, t.project_id, 'task_deleted', { title: t.title })
  })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ liste de contrôle

app.post('/:id/checklist', async (c) => {
  const b = await body(c, z.object({ label: z.string().trim().min(1).max(300) }))
  const id = await tx(c, async (db, ctx) => (await db.query(
    `insert into checklist_items (account_id, task_id, label, position)
     values ($1,$2,$3,(select coalesce(max(position),-1)+1 from checklist_items where task_id = $2)) returning id`,
    [ctx.accountId, c.req.param('id'), b.label])).rows[0].id)
  return c.json({ id }, 201)
})

app.patch('/checklist/:iid', async (c) => {
  const b = await body(c, z.object({ label: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }))
  await tx(c, async (db) => {
    const s = setClause(b, ['label', 'done'], 2)
    if (s.keys.length) await db.query(`update checklist_items set ${s.sql} where id = $1`, [c.req.param('iid'), ...s.values])
  })
  return c.json({ ok: true })
})

app.delete('/checklist/:iid', async (c) => {
  await tx(c, (db) => db.query('delete from checklist_items where id = $1', [c.req.param('iid')]))
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ dépendances

app.post('/:id/dependencies', async (c) => {
  const b = await body(c, z.object({ depends_on_id: uuid }))
  await tx(c, async (db, ctx) => {
    const id = c.req.param('id')
    if (id === b.depends_on_id) throw new HttpError(400, 'self_dependency')
    // Refuser un cycle : si `depends_on_id` attend déjà (même indirectement) cette tâche.
    const cycle = (await db.query(
      `with recursive chain(id) as (select depends_on_id from task_dependencies where task_id = $1
         union select d.depends_on_id from task_dependencies d join chain on chain.id = d.task_id)
       select 1 from chain where id = $2 limit 1`, [b.depends_on_id, id])).rowCount
    if (cycle) throw new HttpError(400, 'dependency_cycle')
    const same = (await db.query('select (select project_id from tasks where id = $1) = (select project_id from tasks where id = $2) as ok', [id, b.depends_on_id])).rows[0]
    if (!same?.ok) throw new HttpError(400, 'dependency_other_project')
    await db.query('insert into task_dependencies (task_id, depends_on_id, account_id) values ($1,$2,$3) on conflict do nothing', [id, b.depends_on_id, ctx.accountId])
  })
  return c.json({ ok: true })
})

app.delete('/:id/dependencies/:dep', async (c) => {
  await tx(c, (db) => db.query('delete from task_dependencies where task_id = $1 and depends_on_id = $2', [c.req.param('id'), c.req.param('dep')]))
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ commentaires

app.post('/:id/comments', async (c) => {
  const b = await body(c, z.object({ body: z.string().trim().min(1).max(20000) }))
  const id = await tx(c, async (db, ctx) => {
    const t = (await db.query('select id, project_id, title, created_by from tasks where id = $1', [c.req.param('id')])).rows[0]
    if (!t) throw notFound()
    const mentions = await mentionedUsers(db, b.body)
    const r = (await db.query('insert into comments (account_id, project_id, task_id, author_id, body, mentions) values ($1,$2,$3,$4,$5,$6) returning id',
      [ctx.accountId, t.project_id, t.id, ctx.userId, b.body, mentions])).rows[0]
    const assignees = (await db.query('select user_id from task_assignees where task_id = $1', [t.id])).rows.map((x) => x.user_id)
    await notify(db, ctx, mentions, { kind: 'mention', title: `${c.get('name')} vous cite sur « ${t.title} »`, body: b.body.slice(0, 300), link: `/projets/${t.project_id}?tache=${t.id}` })
    await notify(db, ctx, [...assignees, t.created_by].filter((u) => !mentions.includes(u)),
      { kind: 'comment', title: `Commentaire sur « ${t.title} »`, body: b.body.slice(0, 300), link: `/projets/${t.project_id}?tache=${t.id}` })
    return r.id
  })
  return c.json({ id }, 201)
})

app.patch('/comments/:cid', async (c) => {
  const b = await body(c, z.object({ body: z.string().trim().min(1).max(20000) }))
  await tx(c, async (db) => {
    const r = await db.query('update comments set body = $2, edited_at = now() where id = $1 and author_id = app_user()', [c.req.param('cid'), b.body])
    if (!r.rowCount) throw notFound()
  })
  return c.json({ ok: true })
})

app.delete('/comments/:cid', async (c) => {
  await tx(c, (db) => db.query(`delete from comments where id = $1 and (author_id = app_user() or app_role() = 'admin')`, [c.req.param('cid')]))
  return c.json({ ok: true })
})

export default app
