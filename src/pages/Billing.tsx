import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Select, Spinner, TableStack, toast } from '../components/ui'
import { intlLocale, labels, t, useT } from '../i18n'
import { api, errorText, linkErrorText } from '../lib/api'
import { NotUsed } from '../components/LeadLinks'
import { BILLING_LABEL, fmtDateTime, money } from '../lib/format'
import { useApp, useLoad } from '../lib/store'

/** Facturation mensuelle : un brouillon de facture par projet et par mois, créé dans InvoiceLead. */

type Line = { description: string; quantity: number; unit: string; unitPriceCents: number; amountCents: number }
type PreviewProject = {
  project: { id: string; name: string; code: string | null; billing_mode: string; currency: string; vat_code: string }
  client: { id: string; name: string } | null
  lines: Line[]; total_cents: number
  existing: { status: 'created' | 'empty' | 'error'; invoice_id: string | null; invoice_url: string | null; amount_cents: number } | null
}
type RunResult = { projectId: string; project: string; status: 'created' | 'empty' | 'error' | 'skipped'
  invoiceId?: string; invoiceUrl?: string; amountCents?: number; error?: string; detail?: Record<string, unknown> }
type InvoiceRun = { id: string; project_id: string; project_name: string; period: string; status: 'created' | 'empty' | 'error'
  invoice_id: string | null; invoice_url: string | null; amount_cents: number | null; error: string | null; created_at: string; created_by_name: string | null }

/** Les noms des mois dans la langue de l'interface (Intl), calculés au rendu. */
const monthNames = () => Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(new Date(2000, i, 15, 12)))
const periodLabel = (p: string) =>
  new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric' }).format(new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 15, 12))
const shiftPeriod = (p: string, n: number) => {
  const d = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const thisPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
/** On ne facture pas un mois qui n'a pas commencé. */
const clampPeriod = (p: string) => (p > thisPeriod() ? thisPeriod() : p)
const YEARS = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - 5 + i))

const UNIT: Record<string, string> = labels('clients.billing.unit', ['hour', 'month', 'flat', 'day', 'piece'])
const qty = (n: number) => n.toLocaleString(intlLocale(), { maximumFractionDigits: 2 })

/** Les erreurs de facturation, dites pour qu'on sache quoi faire. */
const runError = (code?: string | null, detail?: Record<string, unknown>) => {
  if (!code) return t('clients.billing.unknownError')
  if (code === 'client_missing') return t('clients.billing.clientMissing')
  return linkErrorText(code, detail ?? {}) ?? errorText(code)
}

export default function Billing() {
  const t = useT()
  const { me } = useApp()
  // Le mois choisi vit dans l'adresse (?mois=AAAA-MM) : une reconnexion silencieuse au Compte Lead y ramène.
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('mois')
  const period = fromUrl && /^\d{4}-\d{2}$/.test(fromUrl) ? clampPeriod(fromUrl) : shiftPeriod(thisPeriod(), -1)
  const setPeriod = (p: string) => setParams((x) => { const n = new URLSearchParams(x); n.set('mois', p); return n }, { replace: true })
  const { data, error, loading, reload } = useLoad<{ period: string; projects: PreviewProject[] }>(`/integrations/billing/preview?period=${period}`, [period])
  const runs = useLoad<InvoiceRun[]>('/integrations/billing/runs')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<RunResult[] | null>(null)
  const [runErr, setRunErr] = useState<unknown>(null)

  const connected = Boolean(me?.features.invoicelead)
  const canRun = me?.user.role === 'admin' || me?.user.role === 'manager'
  const projects = data?.period === period ? data.projects : []
  const billable = (p: PreviewProject) => p.lines.length > 0 && p.existing?.status !== 'created'

  // À chaque mois, on présélectionne ce qui peut partir : des lignes, un client, pas encore facturé.
  useEffect(() => {
    setSelected(new Set(projects.filter((p) => billable(p) && p.client).map((p) => p.project.id)))
    setResults(null); setRunErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const chosen = projects.filter((p) => selected.has(p.project.id))
  const sums = new Map<string, number>()
  for (const p of chosen) sums.set(p.project.currency, (sums.get(p.project.currency) ?? 0) + p.total_cents)
  const totals = [...sums.entries()]

  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })

  const run = async () => {
    setRunning(true); setRunErr(null)
    try {
      const r = await api.post<{ results: RunResult[] }>('/integrations/billing/run', { period, project_ids: [...selected] })
      setResults(r.results)
      const ok = r.results.filter((x) => x.status === 'created').length
      toast(ok ? t('clients.billing.toastCreated', { n: ok }) : t('clients.billing.noneCreated'))
      await reload(); runs.reload()
    } catch (e) { setRunErr(e) } finally { setRunning(false) }
  }

  return (
    <>
      <PageHeader title={t('clients.billing.title')} subtitle={t('clients.billing.subtitle')} />

      {!connected && (
        <div className="mb-5 space-y-2 border-l-[3px] border-soon bg-card px-4 py-3 text-sm">
          <NotUsed app="invoicelead" compact />
          <p className="text-muted-foreground">{t('clients.billing.previewNote')}</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button aria-label={t('clients.billing.prevMonth')} onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
        <Select value={period.slice(5, 7)} aria-label={t('clients.billing.month')} className="w-36"
          onChange={(e) => setPeriod(clampPeriod(`${period.slice(0, 4)}-${e.target.value}`))}>
          {monthNames().map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m[0].toUpperCase() + m.slice(1)}</option>)}
        </Select>
        <Select value={period.slice(0, 4)} aria-label={t('clients.billing.year')} className="w-24"
          onChange={(e) => setPeriod(clampPeriod(`${e.target.value}-${period.slice(5, 7)}`))}>
          {[...new Set([period.slice(0, 4), ...YEARS])].sort().map((y) => <option key={y}>{y}</option>)}
        </Select>
        <Button aria-label={t('clients.billing.nextMonth')} disabled={period >= thisPeriod()} onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
      </div>

      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        {t('clients.billing.explainBefore')} <strong className="text-foreground">{t('clients.billing.explainDrafts')}</strong> {t('clients.billing.explainAfter')}
      </p>

      <ErrorNote error={error} />
      {loading && !projects.length ? <Spinner /> : projects.length === 0 ? (
        <Empty title={t('clients.billing.emptyTitle')}>
          {t('clients.billing.emptyHint')}
        </Empty>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <PreviewCard key={p.project.id} p={p} checked={selected.has(p.project.id)} selectable={canRun && billable(p)}
              onToggle={(v) => toggle(p.project.id, v)} result={results?.find((r) => r.projectId === p.project.id)} />
          ))}
        </div>
      )}

      {projects.length > 0 && canRun && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-3 border-t border-input bg-background px-4 py-3 sm:mx-0 sm:border sm:bg-card">
          <span className="text-sm">
            <strong>{chosen.length}</strong> {t('clients.billing.selected', { n: chosen.length })}
            {totals.length > 0 && <> · {totals.map(([cur, c]) => money(c, cur)).join(' + ')} {t('clients.billing.exclVat')}</>}
          </span>
          <Button variant="primary" className="ml-auto" disabled={!connected || running || chosen.length === 0} onClick={run}>
            {running ? t('clients.billing.creating') : t('clients.billing.createDrafts')}
          </Button>
          {runErr != null && <div className="w-full"><ErrorNote error={runErr} /></div>}
        </div>
      )}
      {projects.length > 0 && !canRun && (
        <p className="mt-4 text-sm text-muted-foreground">{t('clients.billing.managersOnly')}</p>
      )}

      {results && <Results results={results} />}

      <h2 className="mb-3 mt-10 text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">{t('clients.billing.history')}</h2>
      <History runs={runs.data} loading={runs.loading} error={runs.error} />
    </>
  )
}

function PreviewCard({ p, checked, selectable, onToggle, result }:
  { p: PreviewProject; checked: boolean; selectable: boolean; onToggle: (v: boolean) => void; result?: RunResult }) {
  const t = useT()
  const done = p.existing?.status === 'created'
  const empty = p.lines.length === 0
  return (
    <section className={clsx('border bg-card', checked ? 'border-accent' : 'border-border', (done || empty) && 'opacity-90')}>
      <header className="flex flex-wrap items-start gap-3 px-4 py-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--accent))] disabled:opacity-30" checked={checked} disabled={!selectable}
          aria-label={t('clients.billing.billProject', { name: p.project.name })} onChange={(e) => onToggle(e.target.checked)} />
        <div className="min-w-0 flex-1">
          <Link to={`/projets/${p.project.id}`} className="font-bold hover:text-accent break-words">
            {p.project.code && <><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{p.project.code}</span>{" "}</>}{p.project.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {p.client ? <Link to={`/clients/${p.client.id}`} className="hover:text-foreground">{p.client.name}</Link>
              : <span className="font-bold text-late">{t('clients.billing.noClient')}</span>}
            {' · '}{BILLING_LABEL[p.project.billing_mode] ?? p.project.billing_mode}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {done ? <Badge tone="ok">{t('clients.billing.alreadyBilled')}</Badge>
            : empty ? <Badge>{t('clients.billing.nothingToBill')}</Badge>
            : p.existing?.status === 'error' ? <Badge tone="late">{t('clients.billing.lastFailed')}</Badge> : null}
          <span className="font-bold tabular-nums">{money(done ? p.existing!.amount_cents : p.total_cents, p.project.currency)}</span>
        </div>
      </header>

      {p.lines.length > 0 && (
        <ul className="divide-y divide-[#eeebe7] border-t border-border sm:hidden">
          {p.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
              <span className="min-w-0">
                <span className="block break-words">{l.description}</span>
                <span className="block text-xs text-muted-foreground">{qty(l.quantity)} {UNIT[l.unit] ?? l.unit} × {money(l.unitPriceCents, p.project.currency)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{money(l.amountCents, p.project.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {p.lines.length > 0 && (
        <div className="hidden overflow-x-auto border-t border-border sm:block">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-1.5 font-semibold">{t('clients.billing.description')}</th>
                <th className="px-2 py-1.5 text-right font-semibold">{t('clients.billing.quantity')}</th>
                <th className="px-2 py-1.5 font-semibold">{t('clients.billing.unitCol')}</th>
                <th className="px-2 py-1.5 text-right font-semibold">{t('clients.billing.price')}</th>
                <th className="px-4 py-1.5 text-right font-semibold">{t('clients.billing.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={i} className="border-t border-[#eeebe7]">
                  <td className="px-4 py-1.5">{l.description}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.quantity)}</td>
                  <td className="px-2 py-1.5">{UNIT[l.unit] ?? l.unit}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPriceCents, p.project.currency)}</td>
                  <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{money(l.amountCents, p.project.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(done && p.existing?.invoice_url) || result ? (
        <footer className="border-t border-border px-4 py-2 text-sm">
          {result ? <ResultLine r={result} /> : (
            <a href={p.existing!.invoice_url!} target="_blank" rel="noreferrer" className="font-bold text-accent hover:text-accent-dark">
              {t('clients.billing.openDraft')} ↗</a>
          )}
        </footer>
      ) : null}
    </section>
  )
}

function ResultLine({ r }: { r: RunResult }) {
  const t = useT()
  if (r.status === 'created') return (
    <span className="flex flex-wrap items-center gap-2"><Badge tone="ok">{t('clients.billing.draftCreated')}</Badge>
      {r.invoiceUrl && <a href={r.invoiceUrl} target="_blank" rel="noreferrer" className="font-bold text-accent hover:text-accent-dark">{t('clients.billing.openInIl')} ↗</a>}
    </span>
  )
  if (r.status === 'error') return <span className="flex flex-wrap items-center gap-2"><Badge tone="late">{t('clients.billing.error')}</Badge><span className="text-late">{runError(r.error, { ...(r.detail ?? {}), project: r.project })}</span></span>
  if (r.status === 'skipped') return <span className="flex items-center gap-2"><Badge>{t('clients.billing.skipped')}</Badge>{t('clients.billing.skippedHint')}</span>
  return <span className="flex items-center gap-2"><Badge>{t('clients.billing.empty')}</Badge>{t('clients.billing.emptyHintMonth')}</span>
}

function Results({ results }: { results: RunResult[] }) {
  const t = useT()
  const n = (s: RunResult['status']) => results.filter((r) => r.status === s).length
  return (
    <Card title={t('clients.billing.result')} className="mt-5">
      <p className="px-4 pt-3 text-sm">
        {t('clients.billing.draftsCreated', { n: n('created') })}
        {n('error') > 0 && <>, <span className="font-bold text-late">{t('clients.billing.inError', { n: n('error') })}</span></>}
        {n('empty') + n('skipped') > 0 && <>, {t('clients.billing.withoutInvoice', { n: n('empty') + n('skipped') })}</>}.
        {n('created') > 0 && ` ${t('clients.billing.reviewHint')}`}
      </p>
      <ul className="divide-y divide-border px-4 py-2">
        {results.map((r) => (
          <li key={r.projectId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="font-semibold">{r.project}</span>
            <span className="flex flex-wrap items-center gap-3">
              {r.amountCents != null && <span className="tabular-nums">{money(r.amountCents)}</span>}
              <ResultLine r={r} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** La clé du libellé (lue au rendu) et le ton du badge. */
const RUN_STATUS: Record<InvoiceRun['status'], { label: string; tone: 'ok' | 'muted' | 'late' }> = {
  created: { label: 'clients.billing.draftCreated', tone: 'ok' }, empty: { label: 'clients.billing.empty', tone: 'muted' },
  error: { label: 'clients.billing.error', tone: 'late' },
}

function History({ runs, loading, error }: { runs: InvoiceRun[] | null; loading: boolean; error: unknown }) {
  const t = useT()
  if (error) return <ErrorNote error={error} />
  if (loading && !runs) return <Spinner />
  if (!runs?.length) return <p className="text-sm text-muted-foreground">{t('clients.billing.noRuns')}</p>
  return (
    <TableStack>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2">{t('clients.billing.month')}</th>
            <th className="px-3 py-2">{t('clients.billing.project')}</th>
            <th className="px-3 py-2">{t('clients.billing.state')}</th>
            <th className="px-3 py-2 text-right">{t('clients.billing.amount')}</th>
            <th className="px-3 py-2">{t('clients.billing.draft')}</th>
            <th className="px-3 py-2">{t('clients.billing.launched')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 capitalize">{periodLabel(r.period)}</td>
              <td className="px-3 py-2"><Link to={`/projets/${r.project_id}`} className="font-semibold hover:text-accent">{r.project_name}</Link></td>
              <td className="px-3 py-2">
                <Badge tone={RUN_STATUS[r.status].tone}>{t(RUN_STATUS[r.status].label)}</Badge>
                {r.status === 'error' && <span className="mt-1 block text-xs text-late">{runError(r.error)}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.amount_cents != null ? money(r.amount_cents) : '—'}</td>
              <td className="px-3 py-2">
                {r.invoice_url ? <a href={r.invoice_url} target="_blank" rel="noreferrer" className="font-bold text-accent hover:text-accent-dark">{t('clients.open')} ↗</a> : '—'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDateTime(r.created_at)}{r.created_by_name ? ` · ${r.created_by_name}` : ` · ${t('clients.billing.automatic')}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableStack>
  )
}
