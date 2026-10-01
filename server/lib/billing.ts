import type { Ctx, Db } from '../db.js'
import { HttpError } from './http.js'
import { createDraftInvoice, ensureContact, invoiceleadConfig, type InvoiceLine } from './invoicelead.js'

/**
 * Facturation mensuelle vers InvoiceLead.
 *
 * Pour un mois donné (`AAAA-MM`), chaque projet facturable donne au plus **un** brouillon de
 * facture (`invoice_runs`, unique par projet et par mois), selon son mode :
 * - à l'heure : le temps facturable non encore facturé jusqu'à la fin du mois, ligne par tâche
 *   et par taux ;
 * - forfait mensuel : le forfait du mois ;
 * - par étape : les étapes terminées (montant posé sur l'étape) non encore facturées ;
 * - forfait global : le forfait, le mois où le projet est terminé.
 * Le temps et les étapes facturés sont marqués : jamais facturés deux fois.
 */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
export const periodEnd = (p: string) => {
  const [y, m] = p.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
export const previousPeriod = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  return x.toISOString().slice(0, 7)
}

export type Draft = {
  project: { id: string; name: string; code: string | null; billing_mode: string; currency: string; vat_code: string }
  client: any | null
  lines: (InvoiceLine & { amountCents: number })[]
  timeEntryIds: string[]
  stageIds: string[]
  totalCents: number
  existing: { status: string; invoice_id: string | null; invoice_url: string | null; amount_cents: number } | null
}

/** Ce que contiendrait la facture du mois, sans rien envoyer. */
export async function draftFor(db: Db, projectId: string, period: string): Promise<Draft> {
  const p = (await db.query(
    `select id, name, code, billing_mode, hourly_rate_cents, retainer_cents, fixed_cents, currency, vat_code, client_id,
            status, to_char(completed_at, 'YYYY-MM') as completed_period
       from projects where id = $1`, [projectId])).rows[0]
  if (!p) throw new HttpError(404, 'not_found')
  const end = periodEnd(period)
  const client = p.client_id ? (await db.query('select * from clients where id = $1', [p.client_id])).rows[0] : null
  const existing = (await db.query('select status, invoice_id, invoice_url, amount_cents from invoice_runs where project_id = $1 and period = $2',
    [projectId, period])).rows[0] ?? null
  const lines: Draft['lines'] = []
  let timeEntryIds: string[] = []
  let stageIds: string[] = []
  const label = periodLabel(period)

  if (p.billing_mode === 'hourly') {
    // Taux : celui figé sur la saisie, sinon celui de la personne sur le projet, celui du projet,
    // puis son taux par défaut dans l'entreprise.
    const rows = (await db.query(
      `select t.id, t.minutes, coalesce(k.title, 'Travaux divers') as label,
              coalesce(t.rate_cents, pm.hourly_rate_cents, $2::int, au.hourly_rate_cents, 0) as rate
         from time_entries t
         left join tasks k on k.id = t.task_id
         left join project_members pm on pm.project_id = t.project_id and pm.user_id = t.user_id
         left join account_users au on au.account_id = t.account_id and au.user_id = t.user_id
        where t.project_id = $1 and t.billable and t.invoiced_at is null and t.minutes > 0 and t.entry_date <= $3
        order by t.entry_date`, [projectId, p.hourly_rate_cents, end])).rows
    const groups = new Map<string, { label: string; rate: number; minutes: number }>()
    for (const r of rows) {
      const k = `${r.label}|${r.rate}`
      const g = groups.get(k) ?? { label: r.label, rate: r.rate, minutes: 0 }
      g.minutes += r.minutes
      groups.set(k, g)
    }
    for (const g of groups.values()) {
      const qty = Math.round((g.minutes / 60) * 100) / 100
      lines.push({ description: `${g.label} — ${label}`, quantity: qty, unit: 'hour', unitPriceCents: g.rate,
                   amountCents: Math.round(qty * g.rate) })
    }
    timeEntryIds = rows.map((r) => r.id)
  } else if (p.billing_mode === 'retainer' && p.retainer_cents) {
    if (!existing || existing.status !== 'created') {
      lines.push({ description: `Forfait mensuel — ${label}`, quantity: 1, unit: 'month', unitPriceCents: p.retainer_cents,
                   amountCents: p.retainer_cents })
    }
  } else if (p.billing_mode === 'milestone') {
    const st = (await db.query(
      `select id, name, billing_cents from stages
        where project_id = $1 and status = 'done' and billing_cents > 0 and invoiced_at is null
          and (completed_at is null or completed_at::date <= $2) order by position`, [projectId, end])).rows
    for (const s of st) lines.push({ description: `Étape « ${s.name} »`, quantity: 1, unit: 'flat', unitPriceCents: s.billing_cents, amountCents: s.billing_cents })
    stageIds = st.map((s) => s.id)
  } else if (p.billing_mode === 'fixed' && p.fixed_cents && p.status === 'done' && p.completed_period
             && p.completed_period <= period) {
    const already = (await db.query(`select 1 from invoice_runs where project_id = $1 and status = 'created'`, [projectId])).rowCount
    if (!already) lines.push({ description: `Forfait — ${p.name}`, quantity: 1, unit: 'flat', unitPriceCents: p.fixed_cents, amountCents: p.fixed_cents })
  }
  return {
    project: { id: p.id, name: p.name, code: p.code, billing_mode: p.billing_mode, currency: p.currency, vat_code: p.vat_code },
    client, lines, timeEntryIds, stageIds, totalCents: lines.reduce((s, l) => s + l.amountCents, 0), existing,
  }
}

/** Les projets facturables du compte, pour l'écran de facturation. */
export async function billableProjects(db: Db) {
  return (await db.query(
    `select id from projects where billing_mode <> 'none' and not is_template and archived_at is null
        and status not in ('cancelled','lead') order by name`)).rows.map((r) => r.id as string)
}

export type RunResult = { projectId: string; project: string; status: 'created' | 'empty' | 'error' | 'skipped'
                          invoiceId?: string; invoiceUrl?: string; amountCents?: number; error?: string }

/** Crée les brouillons du mois dans InvoiceLead. Idempotent : un mois déjà facturé est passé. */
export async function runMonthly(db: Db, ctx: Ctx | null, period: string, projectIds?: string[]): Promise<RunResult[]> {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'invalid_period')
  const cfg = await invoiceleadConfig(db)
  if (!cfg) throw new HttpError(400, 'invoicelead_not_configured')
  const accountId = (await db.query('select app_account() as a')).rows[0].a
  const out: RunResult[] = []
  for (const id of projectIds ?? await billableProjects(db)) {
    const d = await draftFor(db, id, period)
    if (d.existing?.status === 'created') { out.push({ projectId: id, project: d.project.name, status: 'skipped' }); continue }
    if (!d.lines.length) {
      await db.query(
        `insert into invoice_runs (account_id, project_id, period, status, created_by) values ($1,$2,$3,'empty',$4)
         on conflict (account_id, project_id, period) do update set status = 'empty', error = null`,
        [accountId, id, period, ctx?.userId ?? null])
      out.push({ projectId: id, project: d.project.name, status: 'empty' })
      continue
    }
    try {
      if (!d.client) throw new Error('client_missing')
      const contactId = await ensureContact(db, cfg, d.client)
      const inv = await createDraftInvoice(cfg, {
        contactId, title: `${d.project.code ? d.project.code + ' · ' : ''}${d.project.name} — ${periodLabel(period)}`,
        intro: `Prestations du projet « ${d.project.name} », ${periodLabel(period)}.`,
        serviceDate: periodEnd(period), currency: d.project.currency, vatCode: d.project.vat_code, lines: d.lines,
      })
      if (d.timeEntryIds.length)
        await db.query('update time_entries set invoiced_at = now(), invoice_ref = $2 where id = any($1)', [d.timeEntryIds, inv.id])
      if (d.stageIds.length)
        await db.query('update stages set invoiced_at = now(), invoice_ref = $2 where id = any($1)', [d.stageIds, inv.id])
      await db.query(
        `insert into invoice_runs (account_id, project_id, period, status, invoice_id, invoice_url, amount_cents, lines, created_by)
         values ($1,$2,$3,'created',$4,$5,$6,$7,$8)
         on conflict (account_id, project_id, period) do update set status = 'created', invoice_id = excluded.invoice_id,
           invoice_url = excluded.invoice_url, amount_cents = excluded.amount_cents, lines = excluded.lines, error = null`,
        [accountId, id, period, inv.id, inv.url, d.totalCents, JSON.stringify(d.lines), ctx?.userId ?? null])
      await db.query(`insert into activities (account_id, project_id, actor_id, kind, data) values ($1,$2,$3,'invoice_created',$4)`,
        [accountId, id, ctx?.userId ?? null, JSON.stringify({ period, invoice_id: inv.id, amount_cents: d.totalCents })])
      out.push({ projectId: id, project: d.project.name, status: 'created', invoiceId: inv.id, invoiceUrl: inv.url, amountCents: d.totalCents })
    } catch (e: any) {
      const error = e instanceof HttpError ? e.code : String(e?.message ?? e).slice(0, 300)
      await db.query(
        `insert into invoice_runs (account_id, project_id, period, status, error, amount_cents, lines, created_by)
         values ($1,$2,$3,'error',$4,$5,$6,$7)
         on conflict (account_id, project_id, period) do update set status = 'error', error = excluded.error`,
        [accountId, id, period, error, d.totalCents, JSON.stringify(d.lines), ctx?.userId ?? null])
      out.push({ projectId: id, project: d.project.name, status: 'error', error })
    }
  }
  return out
}
