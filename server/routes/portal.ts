import { Hono } from 'hono'
import { z } from 'zod'
import { anon, anonTx, type Db } from '../db.js'
import { body, email, notFound, router, tx } from '../lib/http.js'

/**
 * La page de suivi du client (`/suivi/<jeton>`) : l'état des étapes, l'avancement, les points
 * partagés, les fichiers rendus visibles, et un mot à l'équipe. En lecture seule, sans compte ;
 * fermée tant que le projet ne l'ouvre pas (`portal_enabled`).
 */

async function portalData(db: Db, where: string, arg: string) {
  const p = (await db.query(
    `select p.id, p.account_id, p.name, p.code, p.description, p.status, p.health, p.start_date, p.due_date, p.color,
            p.portal_show_tasks, p.portal_show_time, p.portal_token, a.name as account_name, c.name as client_name, u.name as owner_name, u.email as owner_email
       from projects p join accounts a on a.id = p.account_id left join clients c on c.id = p.client_id left join users u on u.id = p.owner_id
      where ${where}`, [arg])).rows[0]
  if (!p) return null
  const stages = (await db.query(
    `select s.id, s.name, s.status, s.start_date, s.due_date, s.client_note, s.completed_at,
            (select count(*)::int from tasks t where t.stage_id = s.id and t.parent_id is null) as tasks_total,
            (select count(*)::int from tasks t where t.stage_id = s.id and t.parent_id is null and t.completed_at is not null) as tasks_done
       from stages s where s.project_id = $1 and s.visible_to_client order by s.position`, [p.id])).rows
  const tasks = p.portal_show_tasks ? (await db.query(
    `select t.id, t.title, t.due_date, t.completed_at, t.is_milestone, s.name as stage_name from tasks t left join stages s on s.id = t.stage_id
      where t.project_id = $1 and t.visible_to_client order by t.completed_at nulls first, t.due_date nulls last limit 200`, [p.id])).rows : []
  const updates = (await db.query(
    `select pu.health, pu.body, pu.created_at, u.name as author_name from project_updates pu left join users u on u.id = pu.author_id
      where pu.project_id = $1 and pu.share_with_client order by pu.created_at desc limit 20`, [p.id])).rows
  const files = (await db.query(
    `select id, filename, size, created_at from attachments where project_id = $1 and visible_to_client order by created_at desc`, [p.id])).rows
  const time = p.portal_show_time ? (await db.query(
    `select to_char(entry_date, 'YYYY-MM') as month, sum(minutes)::int as minutes from time_entries
      where project_id = $1 and billable and minutes is not null group by 1 order by 1 desc limit 12`, [p.id])).rows : []
  const events = (await db.query(
    `select title, starts_at, ends_at, location from events where project_id = $1 and starts_at > now() order by starts_at limit 5`, [p.id])).rows
  const done = stages.filter((s) => s.status === 'done').length
  return {
    project: { name: p.name, code: p.code, description: p.description, status: p.status, health: p.health, start_date: p.start_date,
               due_date: p.due_date, color: p.color, account: p.account_name, client: p.client_name, owner: p.owner_name },
    progress: stages.length ? Math.round((done / stages.length) * 100) : 0,
    stages, tasks, updates, files, time, events, _id: p.id, _account: p.account_id, _owner_email: p.owner_email,
  }
}

const strip = (d: any) => { if (!d) return d; const { _id, _account, _owner_email, ...rest } = d; return rest }

/** Aperçu pour l'équipe, même page portail fermé. */
const app = router()
app.get('/:projectId', async (c) => {
  const d = await tx(c, async (db) => (await db.query('select id from projects where id = $1', [c.req.param('projectId')])).rows[0])
  if (!d) throw notFound()
  return c.json(strip(await anon((db) => portalData(db, 'p.id = $1', c.req.param('projectId')))))
})
export default app

export const publicPortal = new Hono()
const TOKEN = /^[0-9a-f]{36}$/

publicPortal.get('/:token', async (c) => {
  if (!TOKEN.test(c.req.param('token'))) return c.json({ error: 'not_found' }, 404)
  const d = await anon((db) => portalData(db, 'p.portal_token = $1 and p.portal_enabled and p.archived_at is null', c.req.param('token')))
  if (!d) return c.json({ error: 'not_found' }, 404)
  return c.json(strip(d))
})

publicPortal.get('/:token/files/:fid', async (c) => {
  if (!TOKEN.test(c.req.param('token'))) return c.text('not found', 404)
  const f = await anon(async (db) => (await db.query(
    `select a.filename, a.mime, a.content from attachments a join projects p on p.id = a.project_id
      where p.portal_token = $1 and p.portal_enabled and a.id = $2 and a.visible_to_client`, [c.req.param('token'), c.req.param('fid')])).rows[0])
  if (!f) return c.text('not found', 404)
  return new Response(f.content, { headers: { 'Content-Type': f.mime, 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}` } })
})

/** Le client écrit à l'équipe depuis sa page de suivi : un commentaire sur le projet, et le responsable prévenu. */
publicPortal.post('/:token/message', async (c) => {
  if (!TOKEN.test(c.req.param('token'))) return c.json({ error: 'not_found' }, 404)
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(120), email, body: z.string().trim().min(1).max(5000) }))
  const ok = await anonTx(async (db) => {
    const p = (await db.query(`select id, account_id, owner_id, name from projects where portal_token = $1 and portal_enabled`, [c.req.param('token')])).rows[0]
    if (!p) return false
    // Pas plus de dix messages par heure et par projet : la page est publique.
    const recent = (await db.query(`select count(*)::int as n from activities where project_id = $1 and kind = 'client_message' and created_at > now() - interval '1 hour'`, [p.id])).rows[0].n
    if (recent >= 10) return false
    await db.query(`insert into comments (account_id, project_id, author_id, body) values ($1,$2,null,$3)`,
      [p.account_id, p.id, `Message du client ${b.name} <${b.email}> :\n\n${b.body}`])
    await db.query(`insert into activities (account_id, project_id, kind, data) values ($1,$2,'client_message',$3)`,
      [p.account_id, p.id, JSON.stringify({ name: b.name, email: b.email })])
    if (p.owner_id) await db.query(`insert into notifications (account_id, user_id, kind, title, body, link) values ($1,$2,'client_message',$3,$4,$5)`,
      [p.account_id, p.owner_id, `Message du client sur « ${p.name} »`, b.body.slice(0, 300), `/projets/${p.id}/activite`])
    return true
  })
  if (!ok) return c.json({ error: 'not_accepted' }, 429)
  return c.json({ ok: true }, 201)
})
