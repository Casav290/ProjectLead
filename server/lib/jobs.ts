import { anon, withTenant } from '../db.js'
import { previousPeriod, runMonthly } from './billing.js'
import { sendReport } from './clientReport.js'
import { calendarsOnce } from './extcal.js'
import { mailboxesOnce } from './mailbox/index.js'
import { localDay } from './time.js'

/**
 * Tâches de fond. Comme dans CRMlead, elles profitent du trafic (une instance en veille n'a pas de
 * minuteur fiable) et se lancent aussi par `POST /api/tasks/run` depuis un cron du déploiement.
 * Chacune garde la date de son dernier passage dans `job_runs`.
 */

async function due(name: string, everyMs: number, force: boolean) {
  return anon(async (db) => {
    const r = await db.query(
      `insert into job_runs (name, last_run_at) values ($1, now())
       on conflict (name) do update set last_run_at = now()
         where job_runs.last_run_at < now() - make_interval(secs => $2) or $3
       returning name`, [name, everyMs / 1000, force])
    return Boolean(r.rowCount)
  })
}

/** Le suivi client périodique : chaque semaine, quinzaine ou mois, selon le projet. */
async function clientUpdates() {
  const rows = await anon(async (db) => (await db.query(
    `select p.id, p.account_id, p.owner_id, u.name as owner_name from projects p left join users u on u.id = p.owner_id
      where p.update_frequency <> 'none' and p.status = 'active' and not p.is_template and p.archived_at is null and p.client_id is not null
        and coalesce(p.last_update_sent_at, p.created_at) < now() - case p.update_frequency
              when 'weekly' then interval '7 days' when 'biweekly' then interval '14 days' else interval '1 month' end + interval '1 hour'
      limit 50`)).rows)
  let sent = 0
  for (const p of rows) {
    try {
      await anon((db) => sendReport(db, { accountId: p.account_id, projectId: p.id, userId: p.owner_id, userName: p.owner_name, automatic: true }))
      sent++
    } catch (e: any) {
      // Sans destinataire, on ne réessaie pas toutes les minutes : la date avance quand même.
      await anon((db) => db.query('update projects set last_update_sent_at = now() where id = $1', [p.id]))
      if (e?.message !== 'no_recipient') console.error('[suivi client]', p.id, e?.message)
    }
  }
  return sent
}

/** Une fois par jour : les échéances du jour, rappelées aux personnes assignées. */
async function dueReminders() {
  return anon(async (db) => (await db.query(
    `insert into notifications (account_id, user_id, kind, title, link)
     select t.account_id, ta.user_id, 'due', 'Échéance aujourd''hui : ' || t.title, '/projets/' || t.project_id || '?tache=' || t.id
       from tasks t join task_assignees ta on ta.task_id = t.id join projects p on p.id = t.project_id
      where t.completed_at is null and t.due_date = current_date and not p.is_template and p.archived_at is null
        and not exists (select 1 from notifications n where n.user_id = ta.user_id and n.kind = 'due'
                         and n.link = '/projets/' || t.project_id || '?tache=' || t.id and n.created_at::date = current_date)`)).rowCount ?? 0)
}

/** La facturation du mois écoulé, le jour choisi par l'entreprise, si elle l'a demandée. */
async function monthlyBilling() {
  const accounts = await anon(async (db) => (await db.query(
    `select s.account_id, s.monthly_billing_day, a.timezone,
            (select user_id from account_users where account_id = s.account_id and role = 'admin' and active order by joined_at limit 1) as admin_id
       from account_settings s join accounts a on a.id = s.account_id
      where s.monthly_billing_auto and s.invoicelead_url is not null and s.invoicelead_key_enc is not null`)).rows)
  let created = 0
  for (const a of accounts) {
    const today = localDay(new Date(), a.timezone).date
    if (Number(today.slice(8, 10)) < a.monthly_billing_day || !a.admin_id) continue
    const period = previousPeriod(new Date(today + 'T12:00:00Z'))
    const pending = await anon(async (db) => (await db.query(
      `select count(*)::int as n from projects p where p.account_id = $1 and p.billing_mode <> 'none' and not p.is_template and p.archived_at is null
          and p.status not in ('cancelled','lead')
          and not exists (select 1 from invoice_runs r where r.project_id = p.id and r.period = $2 and r.status in ('created','empty'))`,
      [a.account_id, period])).rows[0].n)
    if (!pending) continue
    try {
      const r = await withTenant({ accountId: a.account_id, userId: a.admin_id, role: 'admin' }, (db) => runMonthly(db, null, period))
      created += r.filter((x) => x.status === 'created').length
    } catch (e: any) {
      console.error('[facturation mensuelle]', a.account_id, e?.code ?? e?.message)
    }
  }
  return created
}

export async function runJobs(force = false) {
  const out: Record<string, unknown> = {}
  if (await due('mailboxes', 60_000, force)) out.mailboxes = await mailboxesOnce().catch((e) => String(e))
  if (await due('calendars', 5 * 60_000, force)) out.calendars = await calendarsOnce().catch((e) => String(e))
  if (await due('client_updates', 15 * 60_000, force)) out.clientUpdates = await clientUpdates().catch((e) => String(e))
  if (await due('due_reminders', 60 * 60_000, force)) out.dueReminders = await dueReminders().catch((e) => String(e))
  if (await due('monthly_billing', 60 * 60_000, force)) out.monthlyBilling = await monthlyBilling().catch((e) => String(e))
  return out
}

let running = false
let last = 0
export function runJobsIfDue() {
  if (process.env.JOBS_DISABLED === '1' || running || Date.now() - last < 60_000) return
  running = true
  last = Date.now()
  runJobs().catch((e) => console.error('[tâches]', e)).finally(() => { running = false })
}
