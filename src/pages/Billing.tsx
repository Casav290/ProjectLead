import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, ButtonLink, Card, Empty, ErrorNote, PageHeader, Select, Spinner, TableStack, toast } from '../components/ui'
import { api, errorText } from '../lib/api'
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
  invoiceId?: string; invoiceUrl?: string; amountCents?: number; error?: string }
type InvoiceRun = { id: string; project_id: string; project_name: string; period: string; status: 'created' | 'empty' | 'error'
  invoice_id: string | null; invoice_url: string | null; amount_cents: number | null; error: string | null; created_at: string; created_by_name: string | null }

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const shiftPeriod = (p: string, n: number) => {
  const d = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const thisPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
/** On ne facture pas un mois qui n'a pas commencé. */
const clampPeriod = (p: string) => (p > thisPeriod() ? thisPeriod() : p)
const YEARS = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - 5 + i))

const UNIT: Record<string, string> = { hour: 'h', month: 'mois', flat: 'forfait', day: 'jour', piece: 'pce' }
const qty = (n: number) => n.toLocaleString('fr-CH', { maximumFractionDigits: 2 })

/** Les erreurs de facturation, dites pour qu'on sache quoi faire. */
const runError = (code?: string | null) => {
  if (!code) return 'Erreur inconnue.'
  if (code === 'client_missing') return 'Ajoutez un client au projet, puis relancez.'
  return errorText(code)
}

export default function Billing() {
  const { me } = useApp()
  const [period, setPeriod] = useState(() => shiftPeriod(thisPeriod(), -1))
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
      toast(ok ? `${ok} brouillon${ok > 1 ? 's' : ''} créé${ok > 1 ? 's' : ''} dans InvoiceLead` : 'Aucun brouillon créé')
      await reload(); runs.reload()
    } catch (e) { setRunErr(e) } finally { setRunning(false) }
  }

  return (
    <>
      <PageHeader title="Facturation" subtitle="Chaque mois, un brouillon de facture par projet, préparé dans InvoiceLead." />

      {!connected && (
        <div className="mb-5 border-l-[3px] border-soon bg-card px-4 py-3 text-sm">
          <p className="font-bold">InvoiceLead n'est pas branché.</p>
          <p className="mt-1 text-muted-foreground">L'aperçu ci-dessous montre ce que chaque projet facturerait. Pour créer les brouillons,
            reliez InvoiceLead avec une clé d'API (formule Pro+).</p>
          {me?.user.role === 'admin'
            ? <ButtonLink to="/reglages/integrations" className="mt-3 border border-input bg-card">Brancher InvoiceLead</ButtonLink>
            : <p className="mt-2 text-muted-foreground">Un administrateur peut le faire dans Réglages → Intégrations.</p>}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button aria-label="Mois précédent" onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
        <Select value={period.slice(5, 7)} aria-label="Mois facturé" className="w-36"
          onChange={(e) => setPeriod(clampPeriod(`${period.slice(0, 4)}-${e.target.value}`))}>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m[0].toUpperCase() + m.slice(1)}</option>)}
        </Select>
        <Select value={period.slice(0, 4)} aria-label="Année" className="w-24"
          onChange={(e) => setPeriod(clampPeriod(`${e.target.value}-${period.slice(5, 7)}`))}>
          {[...new Set([period.slice(0, 4), ...YEARS])].sort().map((y) => <option key={y}>{y}</option>)}
        </Select>
        <Button aria-label="Mois suivant" disabled={period >= thisPeriod()} onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
      </div>

      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Rien n'est émis d'ici : ProjectLead crée des <strong className="text-foreground">brouillons</strong> dans InvoiceLead, que vous relisez
        et émettez là-bas. InvoiceLead calcule la TVA et la QR-facture. Le temps et les étapes repris sont marqués facturés : ils ne
        partiront pas deux fois.
      </p>

      <ErrorNote error={error} />
      {loading && !projects.length ? <Spinner /> : projects.length === 0 ? (
        <Empty title="Aucun projet facturable">
          Les projets à l'heure, au forfait mensuel, par étape ou au forfait global apparaissent ici. Choisissez le mode de facturation
          dans les réglages du projet.
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
            <strong>{chosen.length}</strong> projet{chosen.length > 1 ? 's' : ''} sélectionné{chosen.length > 1 ? 's' : ''}
            {totals.length > 0 && <> · {totals.map(([cur, c]) => money(c, cur)).join(' + ')} HT</>}
          </span>
          <Button variant="primary" className="ml-auto" disabled={!connected || running || chosen.length === 0} onClick={run}>
            {running ? 'Création en cours…' : 'Créer les brouillons dans InvoiceLead'}
          </Button>
          {runErr != null && <div className="w-full"><ErrorNote error={runErr} /></div>}
        </div>
      )}
      {projects.length > 0 && !canRun && (
        <p className="mt-4 text-sm text-muted-foreground">Un responsable ou un administrateur crée les brouillons du mois.</p>
      )}

      {results && <Results results={results} />}

      <h2 className="mb-3 mt-10 text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">Historique</h2>
      <History runs={runs.data} loading={runs.loading} error={runs.error} />
    </>
  )
}

function PreviewCard({ p, checked, selectable, onToggle, result }:
  { p: PreviewProject; checked: boolean; selectable: boolean; onToggle: (v: boolean) => void; result?: RunResult }) {
  const done = p.existing?.status === 'created'
  const empty = p.lines.length === 0
  return (
    <section className={clsx('border bg-card', checked ? 'border-accent' : 'border-border', (done || empty) && 'opacity-90')}>
      <header className="flex flex-wrap items-start gap-3 px-4 py-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--accent))] disabled:opacity-30" checked={checked} disabled={!selectable}
          aria-label={`Facturer ${p.project.name}`} onChange={(e) => onToggle(e.target.checked)} />
        <div className="min-w-0 flex-1">
          <Link to={`/projets/${p.project.id}`} className="font-bold hover:text-accent break-words">
            {p.project.code && <><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{p.project.code}</span>{" "}</>}{p.project.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {p.client ? <Link to={`/clients/${p.client.id}`} className="hover:text-foreground">{p.client.name}</Link>
              : <span className="font-bold text-late">Sans client : ajoutez un client au projet</span>}
            {' · '}{BILLING_LABEL[p.project.billing_mode] ?? p.project.billing_mode}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {done ? <Badge tone="ok">Déjà facturé</Badge>
            : empty ? <Badge>Rien à facturer</Badge>
            : p.existing?.status === 'error' ? <Badge tone="late">Dernier essai en erreur</Badge> : null}
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
                <th className="px-4 py-1.5 font-semibold">Description</th>
                <th className="px-2 py-1.5 text-right font-semibold">Quantité</th>
                <th className="px-2 py-1.5 font-semibold">Unité</th>
                <th className="px-2 py-1.5 text-right font-semibold">Prix</th>
                <th className="px-4 py-1.5 text-right font-semibold">Montant</th>
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
              Ouvrir le brouillon dans InvoiceLead ↗</a>
          )}
        </footer>
      ) : null}
    </section>
  )
}

function ResultLine({ r }: { r: RunResult }) {
  if (r.status === 'created') return (
    <span className="flex flex-wrap items-center gap-2"><Badge tone="ok">Brouillon créé</Badge>
      {r.invoiceUrl && <a href={r.invoiceUrl} target="_blank" rel="noreferrer" className="font-bold text-accent hover:text-accent-dark">Ouvrir dans InvoiceLead ↗</a>}
    </span>
  )
  if (r.status === 'error') return <span className="flex flex-wrap items-center gap-2"><Badge tone="late">Erreur</Badge><span className="text-late">{runError(r.error)}</span></span>
  if (r.status === 'skipped') return <span className="flex items-center gap-2"><Badge>Passé</Badge>Ce mois est déjà facturé.</span>
  return <span className="flex items-center gap-2"><Badge>Vide</Badge>Rien à facturer ce mois-ci.</span>
}

function Results({ results }: { results: RunResult[] }) {
  const n = (s: RunResult['status']) => results.filter((r) => r.status === s).length
  return (
    <Card title="Résultat" className="mt-5">
      <p className="px-4 pt-3 text-sm">
        {n('created')} brouillon{n('created') > 1 ? 's' : ''} créé{n('created') > 1 ? 's' : ''}
        {n('error') > 0 && <>, <span className="font-bold text-late">{n('error')} en erreur</span></>}
        {n('empty') + n('skipped') > 0 && <>, {n('empty') + n('skipped')} sans facture</>}.
        {n('created') > 0 && ' Relisez-les et émettez-les dans InvoiceLead.'}
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

const RUN_STATUS: Record<InvoiceRun['status'], { label: string; tone: 'ok' | 'muted' | 'late' }> = {
  created: { label: 'Brouillon créé', tone: 'ok' }, empty: { label: 'Vide', tone: 'muted' }, error: { label: 'Erreur', tone: 'late' },
}

function History({ runs, loading, error }: { runs: InvoiceRun[] | null; loading: boolean; error: unknown }) {
  if (error) return <ErrorNote error={error} />
  if (loading && !runs) return <Spinner />
  if (!runs?.length) return <p className="text-sm text-muted-foreground">Aucune facturation lancée pour l'instant.</p>
  return (
    <TableStack>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2">Mois</th>
            <th className="px-3 py-2">Projet</th>
            <th className="px-3 py-2">État</th>
            <th className="px-3 py-2 text-right">Montant</th>
            <th className="px-3 py-2">Brouillon</th>
            <th className="px-3 py-2">Lancé</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 capitalize">{periodLabel(r.period)}</td>
              <td className="px-3 py-2"><Link to={`/projets/${r.project_id}`} className="font-semibold hover:text-accent">{r.project_name}</Link></td>
              <td className="px-3 py-2">
                <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                {r.status === 'error' && <span className="mt-1 block text-xs text-late">{runError(r.error)}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.amount_cents != null ? money(r.amount_cents) : '—'}</td>
              <td className="px-3 py-2">
                {r.invoice_url ? <a href={r.invoice_url} target="_blank" rel="noreferrer" className="font-bold text-accent hover:text-accent-dark">Ouvrir ↗</a> : '—'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDateTime(r.created_at)}{r.created_by_name ? ` · ${r.created_by_name}` : ' · automatique'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableStack>
  )
}
