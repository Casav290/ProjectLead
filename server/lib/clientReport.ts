import type { Db } from '../db.js'
import { esc, htmlParagraphs, layout, sendMail } from './email.js'
import { asLocale, fmtDateIn, tr, type Locale } from './i18n.js'

/**
 * Le suivi de projet envoyé au client : l'état de chaque étape visible, l'avancement global,
 * le dernier point partagé, et le lien vers la page de suivi (si elle est ouverte).
 * Le même contenu sert à l'aperçu, à l'envoi manuel et à l'envoi automatique périodique.
 */

/** Le libellé d'un état d'étape, dans la langue du document. */
export const stageLabel = (l: Locale, status: string) => tr(l, `report.stage.${status}`)
const healthLabel = (l: Locale, h: string) => tr(l, `report.health.${h}`)
// Clés écrites en entier pour le contrôle des clés (scripts/i18n-check.ts --keys) :
// tr(l, 'report.stage.todo') tr(l, 'report.stage.in_progress') tr(l, 'report.stage.done') tr(l, 'report.stage.blocked')
// tr(l, 'report.health.on_track') tr(l, 'report.health.at_risk') tr(l, 'report.health.off_track')

export type Report = { subject: string; text: string; html: string; recipients: string[]; portalUrl: string | null; locale: Locale }

/** Le suivi, dans la langue des documents du projet (`projects.doc_locale`, sinon celle de l'entreprise). */
export async function buildReport(db: Db, projectId: string, message?: string | null): Promise<Report> {
  const p = (await db.query(
    `select p.*, a.name as account_name, a.locale as account_locale, c.name as client_name, c.email as client_email, s.client_update_signature
       from projects p join accounts a on a.id = p.account_id left join clients c on c.id = p.client_id
       left join account_settings s on s.account_id = p.account_id
      where p.id = $1`, [projectId])).rows[0]
  if (!p) throw new Error('not_found')
  const l = asLocale(p.doc_locale ?? p.account_locale)
  const fmtDate = (d: string | null) => d ? fmtDateIn(l, d) : null
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
  // La page de suivi s'ouvre dans la langue du document (le visiteur peut en changer).
  const portalUrl = p.portal_enabled ? `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/suivi/${p.portal_token}?lang=${l}` : null
  const intro = message?.trim() || tr(l, 'report.intro', { name: p.name })
  const signature = p.client_update_signature?.trim() || tr(l, 'report.regards', { account: p.account_name })

  const lines: string[] = []
  lines.push(tr(l, 'report.greeting'), '')
  lines.push(intro, '')
  lines.push(tr(l, 'report.progress', { done: doneStages, total: stages.length, pct: progress }))
  if (p.due_date) lines.push(tr(l, 'report.due', { date: fmtDate(p.due_date) }))
  lines.push('', tr(l, 'report.stages'))
  for (const s of stages) {
    const when = s.status === 'done' ? (s.completed_on ? tr(l, 'report.whenDone', { date: fmtDate(s.completed_on) }) : '')
      : s.due_date ? tr(l, 'report.whenDue', { date: fmtDate(s.due_date) }) : ''
    lines.push(`- ${s.name} : ${stageLabel(l, s.status)}${when}${s.total ? tr(l, 'report.taskCount', { done: s.done, total: s.total }) : ''}`)
    if (s.client_note) lines.push(`  ${s.client_note}`)
  }
  if (tasks.length) {
    lines.push('', tr(l, 'report.tasks'))
    for (const t of tasks) lines.push(`- [${t.done ? 'x' : ' '}] ${t.title}${t.due_date && !t.done ? tr(l, 'report.taskDue', { date: fmtDate(t.due_date) }) : ''}`)
  }
  if (update) lines.push('', tr(l, 'report.lastUpdate', { date: fmtDate(update.on), health: healthLabel(l, update.health).toLowerCase() }), update.body)
  if (portalUrl) lines.push('', tr(l, 'report.followOnline', { url: portalUrl }))
  lines.push('', signature)
  const text = lines.join('\n')

  const color = (s: string) => s === 'done' ? '#15803d' : s === 'in_progress' ? '#9a6a00' : s === 'blocked' ? '#c2410c' : '#67625c'
  const rows = stages.map((s) => `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #eeebe7;border-left:3px solid ${color(s.status)}"><strong>${esc(s.name)}</strong>
      ${s.client_note ? `<div style="color:#67625c;font-size:13px;margin-top:2px">${esc(s.client_note)}</div>` : ''}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eeebe7;color:${color(s.status)};font-weight:700;white-space:nowrap">${esc(stageLabel(l, s.status))}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eeebe7;color:#67625c;white-space:nowrap">${s.status === 'done' ? fmtDate(s.completed_on) ?? '' : fmtDate(s.due_date) ?? ''}</td></tr>`).join('')
  const html = layout(p.name,
    htmlParagraphs(`${tr(l, 'report.greeting')}\n\n${intro}`) +
    `<p style="margin:0 0 6px;font-weight:700">${esc(tr(l, 'report.progressHtml', { pct: progress }))}</p>
     <div style="background:#f2f0ee;height:8px;margin-bottom:16px"><div style="background:#9a6a00;height:8px;width:${progress}%"></div></div>
     <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e4e0;font-size:14px">${rows}</table>` +
    (update ? `<p style="margin:16px 0 4px;font-weight:700">${esc(tr(l, 'report.lastUpdateHtml'))}</p>${htmlParagraphs(update.body)}` : '') +
    htmlParagraphs(signature),
    portalUrl ? { label: tr(l, 'report.followButton'), url: portalUrl } : undefined, l)

  return { subject: tr(l, 'report.subject', { name: p.name }), text, html, recipients, portalUrl, locale: l }
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
