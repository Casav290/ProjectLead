import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import NewProjectDialog from '../components/project/NewProjectDialog'
import { AvatarStack, Button, Checkbox, ColorDot, Empty, ErrorNote, HealthBadge, Input, PageHeader, Progress, Select, Spinner,
         StageBadge, StatusBadge, TableStack } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate, fmtMinutes, STATUS_LABEL, today } from '../lib/format'
import { useLoad } from '../lib/store'
import type { Client, ProjectSummary } from '../lib/types'

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const isLate = (p: ProjectSummary) => Boolean(p.due_date && p.due_date < today() && p.status !== 'done' && p.status !== 'cancelled')

/** Le temps passé face au budget en heures, en rouge au-delà. */
function TimeBudget({ p, bar }: { p: ProjectSummary; bar?: boolean }) {
  if (!p.budget_minutes) return <span className="tabular-nums">{fmtMinutes(p.minutes_spent)}</span>
  const over = p.minutes_spent > p.budget_minutes
  return (
    <span className="inline-block whitespace-nowrap">
      <span className={clsx('tabular-nums', over && 'font-bold text-late')}>{fmtMinutes(p.minutes_spent)}</span>
      <span className="text-muted-foreground"> / {fmtMinutes(p.budget_minutes)}</span>
      {bar && <Progress className="mt-1" value={pct(p.minutes_spent, p.budget_minutes)} tone={over ? 'late' : p.minutes_spent > p.budget_minutes * 0.85 ? 'warn' : 'accent'} />}
    </span>
  )
}

function Advance({ p, wide }: { p: ProjectSummary; wide?: boolean }) {
  return (
    <span className={clsx('block w-full min-w-[7rem]', !wide && 'max-w-[12rem]')}>
      <span className="flex justify-between gap-2 whitespace-nowrap text-xs tabular-nums">
        <span>{p.tasks_done}/{p.tasks_total} tâches</span>
        {p.stages_total > 0 && <span className="text-muted-foreground" title="Étapes terminées">{p.stages_done}/{p.stages_total} ét.</span>}
      </span>
      <Progress className="mt-1" value={pct(p.tasks_done, p.tasks_total)} tone={p.tasks_total && p.tasks_done === p.tasks_total ? 'ok' : 'accent'} />
    </span>
  )
}

const Due = ({ p }: { p: ProjectSummary }) =>
  p.due_date ? <span className={clsx('whitespace-nowrap tabular-nums', isLate(p) && 'font-bold text-late')}>{fmtDate(p.due_date)}</span>
    : <span className="text-muted-foreground">—</span>

function ProjectTable({ rows }: { rows: ProjectSummary[] }) {
  const nav = useNavigate()
  return (
    <TableStack>
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-head text-left text-[11px] font-extrabold uppercase tracking-[.05em] text-muted-foreground">
          <tr>
            {/* Libellé dessiné en CSS : au téléphone, le nom du projet devient le titre de la fiche. */}
            <th className="px-3 py-2 before:content-['Projet']" aria-label="Projet" />
            <th className="px-3 py-2">Client</th>
            <th className="px-3 py-2">Statut</th>
            <th className="px-3 py-2">Étape en cours</th>
            <th className="px-3 py-2">Avancement</th>
            <th className="px-3 py-2">Temps</th>
            <th className="px-3 py-2">Échéance</th>
            <th className="px-3 py-2">Équipe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="cursor-pointer border-t border-border align-middle hover:bg-[#faf9f7]" onClick={() => nav(`/projets/${p.id}`)}>
              <td className="max-w-[16rem] px-3 py-2.5">
                <span className="flex items-start gap-2">
                  <ColorDot color={p.color} className="mt-1.5 h-3 w-3" />
                  <span className="min-w-0">
                    <Link to={`/projets/${p.id}`} className="font-bold hover:text-accent" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                    <span className="block font-mono text-[11px] font-normal text-muted-foreground">{p.code}{p.archived_at && ' · archivé'}</span>
                  </span>
                </span>
              </td>
              <td className="max-w-[10rem] px-3 py-2.5">{p.client_name ?? <span className="text-muted-foreground">Interne</span>}</td>
              <td className="px-3 py-2.5"><span className="inline-flex flex-col items-end gap-1 sm:items-start"><StatusBadge status={p.status} /><HealthBadge health={p.health} /></span></td>
              <td className="px-3 py-2.5">
                {p.current_stage ? <span className="flex flex-col items-end gap-1 sm:items-start"><span className="font-semibold leading-tight">{p.current_stage.name}</span><StageBadge status={p.current_stage.status} /></span>
                  : <span className="text-muted-foreground">{p.stages_total ? 'Toutes terminées' : '—'}</span>}
              </td>
              <td className="px-3 py-2.5"><Advance p={p} /></td>
              <td className="px-3 py-2.5"><TimeBudget p={p} bar /></td>
              <td className="px-3 py-2.5"><Due p={p} /></td>
              <td className="px-3 py-2.5"><AvatarStack people={p.members} max={3} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableStack>
  )
}

function ProjectCards({ rows }: { rows: ProjectSummary[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((p) => (
        <Link key={p.id} to={`/projets/${p.id}`} className="group flex min-w-0 flex-col border border-border border-t-[3px] bg-card p-4 hover:border-input"
              style={{ borderTopColor: p.color }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {p.code && <p className="font-mono text-[11px] text-muted-foreground">{p.code}</p>}
              <h3 className="font-bold leading-snug group-hover:text-accent [overflow-wrap:anywhere]">{p.name}</h3>
              <p className="text-sm text-muted-foreground">{p.client_name ?? 'Projet interne'}</p>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <HealthBadge health={p.health} />
            {p.current_stage && <span className="text-xs text-muted-foreground">Étape : <b className="text-foreground">{p.current_stage.name}</b></span>}
          </div>
          <div className="mt-4"><Advance p={p} wide /></div>
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-border pt-3 text-xs">
            <div className="space-y-0.5">
              <p><span className="text-muted-foreground">Temps </span><TimeBudget p={p} /></p>
              <p><span className="text-muted-foreground">Échéance </span><Due p={p} /></p>
            </div>
            <AvatarStack people={p.members} />
          </div>
        </Link>
      ))}
    </div>
  )
}

/** Le portefeuille de projets : filtres, tableau ou cartes. */
export default function Projects() {
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const status = params.get('statut') ?? ''
  const client = params.get('client') ?? ''
  const mine = params.get('miens') === '1'
  const archived = params.get('archives') === '1'
  const view = params.get('vue') === 'cartes' ? 'cards' : 'table'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q)
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t) }, [q])

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params)
    if (v) n.set(k, v); else n.delete(k)
    setParams(n, { replace: true })
  }
  useEffect(() => { if ((params.get('q') ?? '') !== debounced) set('q', debounced || null) }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = new URLSearchParams()
  if (status) query.set('status', status)
  if (client) query.set('client', client)
  if (debounced) query.set('q', debounced)
  if (mine) query.set('mine', '1')
  if (archived) query.set('archived', '1')
  const { data, error, loading } = useLoad<ProjectSummary[]>(`/projects?${query}`)
  const [clients, setClients] = useState<Client[]>([])
  useEffect(() => { api.get<Client[]>('/clients').then(setClients).catch(() => {}) }, [])
  const filtered = Boolean(status || client || debounced || mine || archived)

  return (
    <>
      <PageHeader title="Projets" subtitle={data ? `${data.length} projet${data.length > 1 ? 's' : ''}` : undefined}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>Nouveau projet</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 border border-border bg-card p-3">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, code ou client…" aria-label="Rechercher" className="w-full sm:w-64" />
        <Select value={status} onChange={(e) => set('statut', e.target.value || null)} aria-label="Statut" className="w-[calc(50%-0.25rem)] sm:w-44">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={client} onChange={(e) => set('client', e.target.value || null)} aria-label="Client" className="w-[calc(50%-0.25rem)] sm:w-52">
          <option value="">Tous les clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Checkbox label="Mes projets" checked={mine} onChange={(v) => set('miens', v ? '1' : null)} className="px-1" />
        <Checkbox label="Archivés" checked={archived} onChange={(v) => set('archives', v ? '1' : null)} className="px-1" />
        <div className="ml-auto flex border border-input" role="group" aria-label="Affichage">
          {(['table', 'cards'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => set('vue', v === 'cards' ? 'cartes' : null)}
              className={clsx('px-3 py-1.5 text-xs font-bold', view === v ? 'bg-accent text-white' : 'bg-card text-muted-foreground hover:bg-muted')}>
              {v === 'table' ? 'Tableau' : 'Cartes'}</button>
          ))}
        </div>
      </div>

      <ErrorNote error={error} />
      {!data ? (loading && <Spinner />)
        : !data.length ? (
          filtered
            ? <Empty title="Aucun projet ne correspond">Élargissez les filtres ou cherchez autrement.</Empty>
            : <Empty title="Pas encore de projet" action={<Button variant="primary" onClick={() => setCreating(true)}>Créer le premier projet</Button>}>
                Un projet réunit étapes, tâches, temps passé et suivi du client.</Empty>
        ) : view === 'table' ? <ProjectTable rows={data} /> : <ProjectCards rows={data} />}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
