import type { Ctx, Db } from '../db.js'
import { logActivity, notify } from './activity.js'
import { sendReport } from './clientReport.js'

/**
 * Automatisations « quand … alors … », à la manière de Monday, ClickUp ou Asana. Une règle sans
 * projet vaut pour tous les projets de l'entreprise. Une règle ne déclenche pas d'autres règles
 * (pas de cascade, donc pas de boucle).
 */

export type Trigger = 'task_completed' | 'task_moved' | 'stage_completed' | 'task_created' | 'project_completed'
export type Payload = { projectId: string; taskId?: string | null; stageId?: string | null; columnId?: string | null }

export async function runAutomations(db: Db, ctx: Ctx, trigger: Trigger, p: Payload, userName?: string) {
  const rules = (await db.query(
    `select * from automations where active and trigger = $1 and (project_id is null or project_id = $2)`,
    [trigger, p.projectId])).rows
  for (const r of rules) {
    const cond = r.conditions ?? {}
    if (cond.column_id && cond.column_id !== p.columnId) continue
    if (cond.stage_id && cond.stage_id !== p.stageId) continue
    try {
      await act(db, ctx, r, p, userName)
      await db.query('update automations set runs = runs + 1 where id = $1', [r.id])
    } catch (e: any) {
      console.error('[automatisation]', r.name, e?.message)
    }
  }
}

async function act(db: Db, ctx: Ctx, r: any, p: Payload, userName?: string) {
  const prm = r.params ?? {}
  const task = p.taskId ? (await db.query('select id, title, project_id, stage_id from tasks where id = $1', [p.taskId])).rows[0] : null
  const project = (await db.query('select id, name, owner_id from projects where id = $1', [p.projectId])).rows[0]
  switch (r.action) {
    case 'notify': {
      let to: string[] = prm.user_ids ?? []
      if (prm.to === 'owner') to = [project.owner_id]
      if (prm.to === 'members') to = (await db.query('select user_id from project_members where project_id = $1', [p.projectId])).rows.map((x) => x.user_id)
      if (prm.to === 'assignees' && task) to = (await db.query('select user_id from task_assignees where task_id = $1', [task.id])).rows.map((x) => x.user_id)
      await notify(db, { ...ctx, userId: '00000000-0000-0000-0000-000000000000' }, to, {
        kind: 'automation', title: prm.message || `${r.name} : ${task?.title ?? project.name}`,
        link: `/projets/${p.projectId}${task ? `?tache=${task.id}` : ''}`,
      })
      break
    }
    case 'assign':
      if (task && prm.user_id) await db.query(
        'insert into task_assignees (task_id, user_id, account_id) values ($1,$2,$3) on conflict do nothing', [task.id, prm.user_id, ctx.accountId])
      break
    case 'set_priority':
      if (task && prm.priority) await db.query('update tasks set priority = $2 where id = $1', [task.id, prm.priority])
      break
    case 'move_column':
      if (task && prm.column_name) await db.query(
        `update tasks set column_id = (select id from board_columns where project_id = $2 and lower(name) = lower($3) limit 1)
          where id = $1 and exists (select 1 from board_columns where project_id = $2 and lower(name) = lower($3))`,
        [task.id, p.projectId, prm.column_name])
      break
    case 'complete_stage': {
      const stageId = p.stageId ?? task?.stage_id
      if (!stageId) break
      const open = (await db.query('select count(*)::int as n from tasks where stage_id = $1 and completed_at is null and parent_id is null', [stageId])).rows[0].n
      if (open === 0) {
        const r2 = await db.query(`update stages set status = 'done', completed_at = now() where id = $1 and status <> 'done' returning name`, [stageId])
        if (r2.rowCount) await logActivity(db, ctx, p.projectId, 'stage_done', { name: r2.rows[0].name, automatic: true })
      }
      break
    }
    case 'send_client_update':
      await sendReport(db, { accountId: ctx.accountId, projectId: p.projectId, userId: ctx.userId, userName, automatic: true,
                             message: prm.message || null }).catch((e) => console.error('[automatisation] suivi', e.message))
      break
    case 'create_task':
      if (prm.title) await db.query(
        `insert into tasks (account_id, project_id, stage_id, column_id, number, title, due_date, created_by, position)
         values ($1,$2,$3,(select id from board_columns where project_id = $2 order by position limit 1),
                 (select coalesce(max(number),0)+1 from tasks where project_id = $2), $4,
                 case when $5::int is null then null else current_date + $5::int end, $6,
                 (select coalesce(max(position),0)+1 from tasks where project_id = $2))`,
        [ctx.accountId, p.projectId, p.stageId ?? task?.stage_id ?? null, prm.title, prm.due_in_days ?? null, ctx.userId])
      break
  }
}
