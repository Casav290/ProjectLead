import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, HEALTH_LABEL, hours, money, STATUS_LABEL, today } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { ProjectSummary } from '../lib/types'
import { Button, Card, ColorDot, Empty, ErrorNote, Field, HealthBadge, Input, PageHeader, Progress, Select, Spinner, TableStack } from '../components/ui'

type ReportRow = { label: string; minutes: number; billable_minutes: number; billable_cents: number; cost_cents: number; invoiced_minutes: number }
type Period = 'month' | 'last_month' | 'quarter' | 'year' | 'custom'

const GROUPS = { project: 'Projet', user: 'Personne', client: 'Client', month: 'Mois', task: 'Tâche' } as const
const PERIODS: Record<Period, string> = { month: 'Ce mois', last_month: 'Mois dernier', quarter: 'Ce trimestre', year: 'Cette année', custom: 'Personnalisée' }

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
function range(p: Period): [string, string] {
  const t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7)
  if (p === 'last_month') { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return [ymd(ly, lm, 1), addDays(ymd(y, m, 1), -1)] }
  if (p === 'quarter') { const q = Math.floor((m - 1) / 3) * 3 + 1; return [ymd(y, q, 1), t] }
  if (p === 'year') return [ymd(y, 1, 1), t]
  return [ymd(y, m, 1), t]
}
const monthName = (s: string) => /^\d{4}-\d{2}$/.test(s)
  ? new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric' }).format(new Date(s + '-15T12:00:00')) : s
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

export default function Reports() {
  const { me } = useApp()
  const currency = me?.account.currency ?? 'CHF'
  const [period, setPeriod] = useState<Period>('month')
  const [custom, setCustom] = useState<[string, string]>(range('month'))
  const [group, setGroup] = useState<keyof typeof GROUPS>('project')
  const [from, to] = period === 'custom' ? custom : range(period)
  const { data, error, loading } = useLoad<ReportRow[]>(`/time/report?from=${from}&to=${to}&group=${group}`)
  const rows = useMemo(() => {
    const r = (data ?? []).map((x) => ({ ...x, billable_cents: Number(x.billable_cents), cost_cents: Number(x.cost_cents) }))
    return group === 'month' ? r.sort((a, b) => a.label.localeCompare(b.label)) : r
  }, [data, group])
  const total = rows.reduce((s, r) => ({
    minutes: s.minutes + r.minutes, billable_minutes: s.billable_minutes + r.billable_minutes, billable_cents: s.billable_cents + r.billable_cents,
    cost_cents: s.cost_cents + r.cost_cents, invoiced_minutes: s.invoiced_minutes + r.invoiced_minutes,
  }), { minutes: 0, billable_minutes: 0, billable_cents: 0, cost_cents: 0, invoiced_minutes: 0 })
  const max = Math.max(1, ...rows.map((r) => r.minutes))
  const label = (r: ReportRow) => (group === 'month' ? monthName(r.label) : r.label)

  /** Le tableau tel qu'affiché, pour un tableur (séparateur « ; », décimales à virgule). */
  const exportCsv = () => {
    const n = (v: number) => v.toFixed(2).replace('.', ',')
    const cell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const lines = [[GROUPS[group], 'Heures', 'Heures facturables', `Montant facturable (${currency})`, `Coût (${currency})`, `Marge (${currency})`, 'Heures facturées'].join(';'),
      ...rows.map((r) => [cell(label(r)), n(r.minutes / 60), n(r.billable_minutes / 60), n(r.billable_cents / 100), n(r.cost_cents / 100),
                          n((r.billable_cents - r.cost_cents) / 100), n(r.invoiced_minutes / 60)].join(';'))]
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `rapport-${group}-${from}-${to}.csv` })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Rapports" subtitle="Le temps passé, ce qu'il rapporte et ce qu'il coûte." />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex max-w-full flex-wrap border border-input bg-card" role="group" aria-label="Période">
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p}
              className={clsx('px-3 py-2 text-[13px] font-bold', period === p ? 'bg-accent text-white' : 'hover:bg-muted')}>{PERIODS[p]}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Du"><Input type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} /></Field>
            <Field label="Au"><Input type="date" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} /></Field>
          </div>
        )}
        <Field label="Regrouper par" className="w-48">
          <Select value={group} onChange={(e) => setGroup(e.target.value as keyof typeof GROUPS)}>
            {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Button className="sm:ml-auto" disabled={!rows.length} onClick={exportCsv}>Exporter en CSV</Button>
      </div>

      <div className="grid grid-cols-2 gap-px border border-border bg-border lg:grid-cols-4">
        {[
          { l: 'Heures', v: `${hours(total.minutes)} h`, s: `dont ${pct(total.billable_minutes, total.minutes)} % facturables` },
          { l: 'Montant facturable', v: money(total.billable_cents, currency), s: `${hours(total.invoiced_minutes)} h déjà facturées` },
          { l: 'Coût', v: money(total.cost_cents, currency), s: 'au tarif de revient' },
          { l: 'Marge', v: money(total.billable_cents - total.cost_cents, currency), s: total.billable_cents ? `${pct(total.billable_cents - total.cost_cents, total.billable_cents)} % du facturable` : '–',
            tone: total.billable_cents - total.cost_cents < 0 ? 'late' : '' },
        ].map((k) => (
          <div key={k.l} className="min-w-0 bg-card px-4 py-3">
            <div className="text-xs font-semibold text-muted-foreground">{k.l}</div>
            <div className={clsx('truncate font-display text-xl font-extrabold tabular-nums sm:text-2xl', k.tone === 'late' && 'text-late')}>{k.v}</div>
            <div className="text-xs text-muted-foreground">{k.s}</div>
          </div>
        ))}
      </div>

      <ErrorNote error={error} />
      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Empty title="Aucune heure sur cette période">Choisissez une autre période, ou saisissez du temps dans <Link className="text-accent underline" to="/temps">Temps</Link>.</Empty>
      ) : (
        <TableStack>
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-head text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{GROUPS[group]}</th>
                <th className="px-3 py-2 text-right font-semibold">Heures</th>
                <th className="px-3 py-2 text-right font-semibold">Facturables</th>
                <th className="px-3 py-2 text-right font-semibold">Montant facturable</th>
                <th className="px-3 py-2 text-right font-semibold">Coût</th>
                <th className="px-3 py-2 text-right font-semibold">Marge</th>
                <th className="px-3 py-2 text-right font-semibold">Facturées</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const margin = r.billable_cents - r.cost_cents
                return (
                  <tr key={r.label} className="border-t border-border">
                    <td className="min-w-[220px] px-3 py-2">
                      <div className="min-w-0 flex-1">
                      <div className="font-semibold first-letter:uppercase [overflow-wrap:anywhere]">{label(r)}</div>
                      <div className="mt-1 flex h-2 w-full max-w-[280px] bg-muted" title={`${hours(r.billable_minutes)} h facturables sur ${hours(r.minutes)} h`}>
                        <div className="h-full bg-accent" style={{ width: `${(r.billable_minutes / max) * 100}%` }} />
                        <div className="h-full bg-accent-light" style={{ width: `${((r.minutes - r.billable_minutes) / max) * 100}%` }} />
                      </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{hours(r.minutes)} h</td>
                    <td className="px-3 py-2 text-right tabular-nums">{hours(r.billable_minutes)} h</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(r.billable_cents, currency)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{money(r.cost_cents, currency)}</td>
                    <td className={clsx('whitespace-nowrap px-3 py-2 text-right tabular-nums', margin < 0 && 'text-late')}>{money(margin, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{hours(r.invoiced_minutes)} h</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="hidden border-t border-input bg-head font-bold sm:table-footer-group">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{hours(total.minutes)} h</td>
                <td className="px-3 py-2 text-right tabular-nums">{hours(total.billable_minutes)} h</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(total.billable_cents, currency)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(total.cost_cents, currency)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(total.billable_cents - total.cost_cents, currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hours(total.invoiced_minutes)} h</td>
              </tr>
            </tfoot>
          </table>
        </TableStack>
      )}
      {rows.length > 0 && (
        <p className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 bg-accent" />Heures facturables</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 bg-accent-light" />Non facturables</span>
        </p>
      )}

      <Portfolio currency={currency} />
    </div>
  )
}

/** Le portefeuille : tous les projets ouverts, par statut et santé, budget consommé, montant facturable. */
function Portfolio({ currency }: { currency: string }) {
  const { data, error, loading } = useLoad<ProjectSummary[]>('/projects')
  if (loading && !data) return <Spinner />
  if (error) return <ErrorNote error={error} />
  const all = data ?? []
  const open = all.filter((p) => ['lead', 'planned', 'active', 'on_hold'].includes(p.status))
  const byStatus = Object.keys(STATUS_LABEL).map((s) => ({ s, n: all.filter((p) => p.status === s).length }))
  const live = open.filter((p) => p.status !== 'lead')
  const byHealth = Object.keys(HEALTH_LABEL).map((h) => ({ h, n: live.filter((p) => p.health === h).length }))
  const billable = open.reduce((s, p) => s + Number(p.billable_cents ?? 0), 0)

  return (
    <section className="space-y-4">
      <h2 className="font-display text-xl">Portefeuille</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Par statut">
          <ul className="px-4 py-2 text-sm">
            {byStatus.map(({ s, n }) => (
              <li key={s} className="flex items-center gap-3 py-1">
                <span className="w-24 shrink-0">{STATUS_LABEL[s]}</span>
                <div className="h-2 flex-1 bg-muted"><div className="h-full bg-accent" style={{ width: `${pct(n, all.length)}%` }} /></div>
                <span className="w-6 text-right font-bold tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Santé des projets en cours">
          <ul className="px-4 py-2 text-sm">
            {byHealth.map(({ h, n }) => (
              <li key={h} className="flex items-center gap-3 py-1">
                <span className="w-28 shrink-0">{HEALTH_LABEL[h]}</span>
                <div className="h-2 flex-1 bg-muted">
                  <div className={clsx('h-full', h === 'on_track' ? 'bg-won' : h === 'at_risk' ? 'bg-soon' : 'bg-late')} style={{ width: `${pct(n, live.length)}%` }} />
                </div>
                <span className="w-6 text-right font-bold tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Montant facturable">
          <div className="px-4 py-3">
            <div className="font-display text-2xl font-extrabold tabular-nums">{money(billable, currency)}</div>
            <p className="text-xs text-muted-foreground">Temps facturable cumulé des {open.length} projet{open.length > 1 ? 's' : ''} ouvert{open.length > 1 ? 's' : ''}, depuis leur début.</p>
            <Link to="/facturation" className="mt-2 inline-block text-xs font-bold text-accent hover:underline">Aller à la facturation</Link>
          </div>
        </Card>
      </div>
      {open.length > 0 && (
        <TableStack>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-head text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Projet</th>
                <th className="px-3 py-2 text-left font-semibold">Statut</th>
                <th className="px-3 py-2 text-left font-semibold">Santé</th>
                <th className="px-3 py-2 text-left font-semibold">Budget consommé</th>
                <th className="px-3 py-2 text-right font-semibold">Facturable</th>
              </tr>
            </thead>
            <tbody>
              {open.map((p) => {
                const used = p.budget_minutes ? pct(p.minutes_spent, p.budget_minutes) : null
                return (
                  <tr key={p.id} className="border-t border-border">
                    <td className="max-w-[280px] px-3 py-2">
                      <div className="min-w-0">
                      <Link to={`/projets/${p.id}`} className="flex min-w-0 items-center gap-1.5 font-semibold hover:text-accent"><ColorDot color={p.color} /><span className="truncate">{p.name}</span></Link>
                      {p.client_name && <span className="block truncate pl-4 text-xs text-muted-foreground">{p.client_name}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">{STATUS_LABEL[p.status]}</td>
                    <td className="px-3 py-2">{p.status === 'lead' ? <span className="text-muted-foreground">–</span> : <HealthBadge health={p.health} />}</td>
                    <td className="px-3 py-2">
                      {used === null ? <span className="text-xs text-muted-foreground">{hours(p.minutes_spent)} h, sans budget</span> : (
                        <div className="w-full min-w-[140px] max-w-[220px]">
                          <div className="mb-1 flex justify-between text-xs"><span className="tabular-nums">{hours(p.minutes_spent)} / {hours(p.budget_minutes)} h</span>
                            <span className={clsx('font-bold tabular-nums', used > 100 && 'text-late')}>{used} %</span></div>
                          <Progress value={used} tone={used > 100 ? 'late' : used > 85 ? 'warn' : 'accent'} />
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(Number(p.billable_cents ?? 0), p.currency || currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableStack>
      )}
    </section>
  )
}
