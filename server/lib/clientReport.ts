import type { Db } from '../db.js'
import { esc, htmlParagraphs, layout, sendMail } from './email.js'

/**
 * Le suivi de projet envoyé au client : l'état de chaque étape visible, l'avancement global,
 * le dernier point partagé, et le lien vers la page de suivi (si elle est ouverte).
 * Le même contenu sert à l'aperçu, à l'envoi manuel et à l'envoi automatique périodique.
 */

export const STAGE_LABEL: Record<string, string> = {
  todo: 'À venir', in_progress: 'En cours', done: 'Terminée', blocked: 'En attente',
}
const HEALTH_LABEL: Record<string, string> = {
  on_track: 'Dans les temps', at_risk: 'Sous surveillance', off_track: 'En retard',
}

const fmtDate = (d: string | null) => d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : null

export type Report = { subject: string; text: string; html: string; recipients: string[]; portalUrl: string | null }

export async function buildReport(db: Db, projectId: string, message?: string | null): Promise<Report> {
  const p = (await db.query(
    `select p.*, a.name as account_name, c.name as client_name, c.email as client_email, s.client_update_signature
       from projects p join accounts a on a.id = p.account_id left join clients c on c.id = p.client_id
       left join account_settings s on s.account_id = p.account_id
      where p.id = $1`, [projectId])).rows[0]
  if (!p) throw new Error('not_found')
  const stages = (await db.query(
    `select s.name, s.status, s.due_date, s.client_note, s.completed_at::date as completed_on,
            (select count(*)::int from tasks t where t.stage_id = s.id and t.parent_id is null) as total,
            (select count(*)::int from tasks t where t.stage_id = s.id and t.parent_id is null and t.completed_at is not null) as done
       from stages s where s.project_id = $1 and s.visible_to_client order by s.position`, [projectId])).rows
  const tasks = p.portal_show_tasks ? (await db.query(
    `select title, due_date, completed_at is not null as done from tasks
      where project_id = $1 and visible_to_client order by completed_at nulls first, due_date nulls last limit 30`, [projectId])).rows : []
  const update = (await db.query(
    `select health, body, created_at::date as on from project_updates where project_id = $1 and share_with_client
      order by created_at desc limit 1`, [projectId])).rows[0]
  const recipients = (await db.query(
    `select distinct lower(email) as e from (
       select cc.email from client_contacts cc where cc.client_id = $1 and cc.receives_updates and cc.email is not null
       union all select c.email from clients c where c.id = $1 and c.email is not null) x where email <> ''`,
    [p.client_id])).rows.map((r) => r.e)

  const doneStages = stages.filter((s) => s.status === 'done').length
  const progress = stages.length ? Math.round((doneStages / stages.length) * 100) : 0
  const portalUrl = p.portal_enabled ? `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/suivi/${p.portal_token}` : null

  const lines: string[] = []
  lines.push(`Bonjour,`, '')
  lines.push(message?.trim() || `Voici où en est le projet « ${p.name} ».`, '')
  lines.push(`Avancement : ${doneStages} étape${doneStages > 1 ? 's' : ''} terminée${doneStages > 1 ? 's' : ''} sur ${stages.length} (${progress} %).`)
  if (p.due_date) lines.push(`Échéance prévue : ${fmtDate(p.due_date)}.`)
  lines.push('', 'Étapes :')
  for (const s of stages) {
    const when = s.status === 'done' && s.completed_on ? ` le ${fmtDate(s.completed_on)}` : s.due_date ? `, prévue pour le ${fmtDate(s.due_date)}` : ''
    lines.push(`- ${s.name} : ${STAGE_LABEL[s.status]}${when}${s.total ? ` (${s.done}/${s.total} tâches)` : ''}`)
    if (s.client_note) lines.push(`  ${s.client_note}`)
  }
  if (tasks.length) {
    lines.push('', 'Tâches suivies :')
    for (const t of tasks) lines.push(`- [${t.done ? 'x' : ' '}] ${t.title}${t.due_date && !t.done ? ` (pour le ${fmtDate(t.due_date)})` : ''}`)
  }
  if (update) lines.push('', `Dernier point (${fmtDate(update.on)}, ${HEALTH_LABEL[update.health].toLowerCase()}) :`, update.body)
  if (portalUrl) lines.push('', `Suivre le projet en ligne : ${portalUrl}`)
  lines.push('', p.client_update_signature?.trim() || `Cordialement,\n${p.account_name}`)
  const text = lines.join('\n')

  const color = (s: string) => s === 'done' ? '#15803d' : s === 'in_progress' ? '#3b4fd8' : s === 'blocked' ? '#c2410c' : '#67625c'
  const rows = stages.map((s) => `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #eeebe7;border-left:3px solid ${color(s.status)}"><strong>${esc(s.name)}</strong>
      ${s.client_note ? `<div style="color:#67625c;font-size:13px;margin-top:2px">${esc(s.client_note)}</div>` : ''}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eeebe7;color:${color(s.status)};font-weight:700;white-space:nowrap">${STAGE_LABEL[s.status]}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eeebe7;color:#67625c;white-space:nowrap">${s.status === 'done' ? fmtDate(s.completed_on) ?? '' : fmtDate(s.due_date) ?? ''}</td></tr>`).join('')
  const html = layout(p.name,
    htmlParagraphs(`Bonjour,\n\n${message?.trim() || `Voici où en est le projet « ${p.name} ».`}`) +
    `<p style="margin:0 0 6px;font-weight:700">Avancement : ${progress} %</p>
     <div style="background:#f2f0ee;height:8px;margin-bottom:16px"><div style="background:#3b4fd8;height:8px;width:${progress}%"></div></div>
     <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e4e0;font-size:14px">${rows}</table>` +
    (update ? `<p style="margin:16px 0 4px;font-weight:700">Dernier point</p>${htmlParagraphs(update.body)}` : '') +
    htmlParagraphs(p.client_update_signature?.trim() || `Cordialement,\n${p.account_name}`),
    portalUrl ? { label: 'Suivre le projet en ligne', url: portalUrl } : undefined)

  return { subject: `Suivi du projet ${p.name}`, text, html, recipients, portalUrl }
}

/** Envoie le suivi, le journalise sur le projet. */
export async function sendReport(db: Db, x: { accountId: string; projectId: string; userId: string | null; userName?: string | null
                                               recipients?: string[]; message?: string | null; automatic?: boolean }) {
  const r = await buildReport(db, x.projectId, x.message)
  const to = (x.recipients?.length ? x.recipients : r.recipients).map((e) => e.toLowerCase())
  if (!to.length) throw new Error('no_recipient')
  const sent = await sendMail({ accountId: x.accountId, to, subject: r.subject, text: r.text, html: r.html,
                                fromUserId: x.userId, fromName: x.userName ?? null })
  await db.query(
    `insert into client_reports (account_id, project_id, sent_by, recipients, subject, body, automatic) values ($1,$2,$3,$4,$5,$6,$7)`,
    [x.accountId, x.projectId, x.userId, to, r.subject, r.text, Boolean(x.automatic)])
  await db.query('update projects set last_update_sent_at = now() where id = $1', [x.projectId])
  await db.query(`insert into activities (account_id, project_id, actor_id, kind, data) values ($1,$2,$3,'client_report',$4)`,
    [x.accountId, x.projectId, x.userId, JSON.stringify({ recipients: to, automatic: Boolean(x.automatic), via: sent.via })])
  return { recipients: to, via: sent.via }
}
