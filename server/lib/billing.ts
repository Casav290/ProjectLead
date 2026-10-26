import { withTenant, type Ctx, type Db } from '../db.js'
import { HttpError } from './http.js'
import { invoiceUrl, sendInvoiceDraft, type InvoiceLine } from './invoicelead.js'
import { ExchangeError } from './leadId.js'

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
                          invoiceId?: string; invoiceUrl?: string; amountCents?: number; error?: string
                          detail?: Record<string, unknown> }

/** Qui facture : l'organisation ERPlead, la personne (sa preuve) ou, pour la tâche mensuelle, personne (`sub` seul). */
export type Biller = { org: string; personProof?: string | null; sub?: string | null; auto?: boolean }

/**
 * Crée les brouillons du mois dans InvoiceLead. Idempotent : un mois déjà facturé est passé ; deux envois identiques
 * donnent un seul brouillon chez InvoiceLead (source.id run:<projet>:<mois>).
 *
 * Une COURTE transaction par projet, jamais d'appel HTTP dedans : (1) le brouillon est calculé, (2) l'enveloppe part
 * (hors transaction), (3) le résultat est inscrit et le temps / les étapes envoyés sont marqués. Un échec sur le projet 2
 * garde le projet 1. Refus d'InvoiceLead : 404 → invoicelead_not_used (rien de plus n'est tenté) ; 409 contact_limit →
 * erreur `contact_limit`, que la tâche horaire ne relance pas (il faut un geste dans InvoiceLead) ; 409 already_issued →
 * « créé » avec l'identifiant rendu ; 403 person_proof (Compte Lead d'une autre entreprise) → nouvel essai sans personne.
 * Aucune formule n'est exigée, ni ici ni chez InvoiceLead.
 */
export async function runMonthly(ctx: Ctx, actorId: string | null, period: string, who: Biller, projectIds?: string[]): Promise<RunResult[]> {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, 'invalid_period')
  const t = <T>(fn: (db: Db) => Promise<T>) => withTenant(ctx, fn)
  const ids = projectIds ?? await t(billableProjects)
  const language = await t(async (db) => (await db.query('select invoice_language from account_settings where account_id = app_account()')).rows[0]?.invoice_language ?? 'fr')
  const out: RunResult[] = []
  const record = (id: string, d: Draft, status: 'error' | 'empty', error: string | null, code: string | null) => t((db) => db.query(
    `insert into invoice_runs (account_id, project_id, period, status, error, error_code, amount_cents, lines, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (account_id, project_id, period) do update set status = excluded.status, error = excluded.error, error_code = excluded.error_code
       where invoice_runs.status <> 'created'`,
    [ctx.accountId, id, period, status, error, code, d.totalCents, JSON.stringify(d.lines), actorId]))

  for (const id of ids) {
    const d = await t(async (db) => {
      const d = await draftFor(db, id, period)
      const run = (await db.query('select status, error_code from invoice_runs where project_id = $1 and period = $2', [id, period])).rows[0]
      return { ...d, errorCode: run?.error_code as string | null }
    })
    if (d.existing?.status === 'created') { out.push({ projectId: id, project: d.project.name, status: 'skipped' }); continue }
    // La tâche horaire ne relance pas un refus qui attend un geste de la personne (formule d'InvoiceLead pleine).
    if (who.auto && d.existing?.status === 'error' && d.errorCode === 'contact_limit') {
      out.push({ projectId: id, project: d.project.name, status: 'skipped', error: 'contact_limit' }); continue
    }
    if (!d.lines.length) {
      await record(id, d, 'empty', null, null)
      out.push({ projectId: id, project: d.project.name, status: 'empty' })
      continue
    }
    if (!d.client) {
      await record(id, d, 'error', 'client_missing', 'client_missing')
      out.push({ projectId: id, project: d.project.name, status: 'error', error: 'client_missing' })
      continue
    }
    const draft = {
      org: who.org, sub: who.sub, projectId: id, period, language, client: d.client,
      title: `${d.project.code ? d.project.code + ' · ' : ''}${d.project.name} — ${periodLabel(period)}`,
      intro: `Prestations du projet « ${d.project.name} », ${periodLabel(period)}.`,
      serviceDate: periodEnd(period), currency: d.project.currency, vatCode: d.project.vat_code, lines: d.lines,
    }
    let inv: { id: string; url: string; totalCents: number; contactId: string | null } | null = null
    let failure: { error: string; detail?: Record<string, unknown> } | null = null
    // L'envoi, HORS transaction. Le contact retenu est gardé ensuite, dans la transaction courte.
    const attempt = (personProof: string | null | undefined) => sendInvoiceDraft({ ...draft, personProof })
    try {
      try { inv = await attempt(who.personProof) } catch (e) {
        // Compte Lead de la personne dans une autre entreprise : le brouillon part quand même, sans elle (attribué
        // par InvoiceLead à son premier administrateur qui facture, et journalisé chez lui).
        if (e instanceof ExchangeError && e.status === 403 && e.body?.error === 'person_proof' && who.personProof) inv = await attempt(null)
        else throw e
      }
    } catch (e) {
      if (e instanceof ExchangeError) {
        const b = e.body ?? {}
        if (e.status === 404) throw new HttpError(404, 'invoicelead_not_used')
        if (e.status === 409 && b.error === 'already_issued' && b.id) {
          inv = { id: String(b.id), url: '', totalCents: d.totalCents, contactId: null }
        } else if (e.status === 409 && b.error === 'contact_limit') {
          failure = { error: 'contact_limit', detail: { limit: b.limit ?? null, count: b.count ?? null, plan: b.plan ?? null } }
        } else if (e.status === 503) failure = { error: 'invoicelead_unreachable' }
        else if (e.status === 403 && b.error) failure = { error: String(b.error), detail: b.admin ? { admin: b.admin } : undefined }
        else failure = { error: String(b.error ?? `invoicelead_${e.status}`).slice(0, 100) }
      } else failure = { error: String((e as Error)?.message ?? e).slice(0, 300) }
    }
    if (!inv) {
      await record(id, d, 'error', failure!.error, failure!.error)
      out.push({ projectId: id, project: d.project.name, status: 'error', error: failure!.error, ...(failure!.detail ? { detail: failure!.detail } : {}) })
      continue
    }
    const sent = inv
    const url = sent.url || invoiceUrl(sent.id, language)
    await t(async (db) => {
      if (sent.contactId && sent.contactId !== d.client.invoicelead_contact_id)
        await db.query('update clients set invoicelead_contact_id = $1 where id = $2', [sent.contactId, d.client.id])
      // Seulement le temps et les étapes envoyés, encore non facturés (une saisie arrivée entre-temps attend le mois suivant).
      if (d.timeEntryIds.length)
        await db.query('update time_entries set invoiced_at = now(), invoice_ref = $2 where id = any($1) and invoiced_at is null', [d.timeEntryIds, sent.id])
      if (d.stageIds.length)
        await db.query('update stages set invoiced_at = now(), invoice_ref = $2 where id = any($1) and invoiced_at is null', [d.stageIds, sent.id])
      await db.query(
        `insert into invoice_runs (account_id, project_id, period, status, invoice_id, invoice_url, amount_cents, lines, created_by)
         values ($1,$2,$3,'created',$4,$5,$6,$7,$8)
         on conflict (account_id, project_id, period) do update set status = 'created', invoice_id = excluded.invoice_id,
           invoice_url = excluded.invoice_url, amount_cents = excluded.amount_cents, lines = excluded.lines, error = null, error_code = null`,
        [ctx.accountId, id, period, sent.id, url, d.totalCents, JSON.stringify(d.lines), actorId])
      await db.query(`insert into activities (account_id, project_id, actor_id, kind, data) values ($1,$2,$3,'invoice_created',$4)`,
        [ctx.accountId, id, actorId, JSON.stringify({ period, invoice_id: sent.id, amount_cents: d.totalCents })])
    })
    out.push({ projectId: id, project: d.project.name, status: 'created', invoiceId: sent.id, invoiceUrl: url, amountCents: d.totalCents })
  }
  return out
}
