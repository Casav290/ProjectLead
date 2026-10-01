import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Button, Card, Checkbox, Field, HealthBadge, Select, StageBadge, Textarea, toast } from '../../components/ui'
import { api, errorText } from '../../lib/api'
import { addDays, BILLING_LABEL, fmtDate, fmtDateTime, fmtMinutes, fmtRelative, HEALTH_LABEL, money as fmtMoney, PROJECT_ROLE_LABEL, today } from '../../lib/format'
import { useApp } from '../../lib/store'
import type { ProjectDetail, Stage } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }
type CalEvent = { id: string; title: string; starts_at: string; ends_at: string; location: string; project_id: string | null; all_day: boolean }

/** La couleur d'une étape selon son statut, pour la frise. */
export const stageTone = (s: Stage['status']) =>
  s === 'done' ? 'border-t-won' : s === 'in_progress' ? 'border-t-accent' : s === 'blocked' ? 'border-t-soon' : 'border-t-input'

/** Les étapes côte à côte, de gauche à droite. */
export function StageTimeline({ stages, to }: { stages: Stage[]; to?: string }) {
  if (!stages.length) return <p className="px-4 py-6 text-sm text-muted-foreground">Pas encore d’étape. {to && <Link to={to} className="font-semibold text-accent">Découper le projet en étapes</Link>}</p>
  return (
    <ol className="flex overflow-x-auto">
      {stages.map((s, i) => (
        <li key={s.id} className={clsx('min-w-[10rem] flex-1 border-t-4 px-4 py-3', i > 0 && 'border-l border-l-border', stageTone(s.status),
                                       s.status === 'in_progress' && 'bg-accent-veil/50')}>
          <p className="text-[11px] font-bold text-muted-foreground">Étape {i + 1}</p>
          <p className="font-bold leading-snug">{s.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StageBadge status={s.status} />
            {s.tasks_total > 0 && <span className="text-xs tabular-nums text-muted-foreground">{s.tasks_done}/{s.tasks_total}</span>}
          </div>
          {(s.status === 'done' ? s.completed_at : s.due_date) &&
            <p className="mt-1 text-xs text-muted-foreground">{s.status === 'done' ? `Terminée le ${fmtDate(s.completed_at)}` : `Prévue le ${fmtDate(s.due_date)}`}</p>}
        </li>
      ))}
    </ol>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'late' }) {
  return (
    <div className="min-w-0 border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[.05em] text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 font-display font-extrabold tabular-nums [overflow-wrap:anywhere]', value.length > 10 ? 'text-lg' : 'text-2xl', tone === 'late' && 'text-late')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Description({ project, onChanged }: Props) {
  const [text, setText] = useState(project.description)
  const [editing, setEditing] = useState(false)
  useEffect(() => setText(project.description), [project.description])
  const save = async () => {
    try { await api.patch(`/projects/${project.id}`, { description: text }); setEditing(false); onChanged() } catch (e) { toast(errorText(e)) }
  }
  return (
    <Card title="Description" action={!editing && <button className="text-xs font-bold text-accent hover:underline" onClick={() => setEditing(true)}>Modifier</button>}>
      <div className="px-4 py-3">
        {editing ? (
          <div className="space-y-2">
            <Textarea autoFocus rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Objectifs, périmètre, informations utiles à l’équipe…" />
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => { setText(project.description); setEditing(false) }}>Annuler</Button>
              <Button size="sm" variant="primary" onClick={save}>Enregistrer</Button>
            </div>
          </div>
        ) : project.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{project.description}</p>
          : <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>Ajouter une description…</button>}
      </div>
    </Card>
  )
}

function Updates({ project, onChanged }: Props) {
  const [health, setHealth] = useState(project.health)
  const [body, setBody] = useState('')
  const [share, setShare] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const u = project.last_update
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(`/projects/${project.id}/updates`, { health, body: body.trim(), share_with_client: share })
      setBody(''); setShare(false); setOpen(false); toast('Point d’avancement publié.'); onChanged()
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <Card title="Point d’avancement" action={!open && <Button size="sm" onClick={() => { setHealth(project.health); setOpen(true) }}>Nouveau point</Button>}>
      {open && (
        <form onSubmit={submit} className="space-y-3 border-b border-border bg-head px-4 py-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Santé du projet">
            {(['on_track', 'at_risk', 'off_track'] as const).map((h) => (
              <button key={h} type="button" role="radio" aria-checked={health === h} onClick={() => setHealth(h)}
                className={clsx('border px-3 py-1.5 text-xs font-bold', health === h
                  ? h === 'on_track' ? 'border-won bg-[#dcfce7] text-won' : h === 'at_risk' ? 'border-soon bg-[#ffedd5] text-soon' : 'border-late bg-[#fee2e2] text-late'
                  : 'border-input bg-card text-muted-foreground hover:bg-muted')}>{HEALTH_LABEL[h]}</button>
            ))}
          </div>
          <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ce qui a avancé, ce qui coince, la suite…" aria-label="Texte du point" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Checkbox label="Partager avec le client (page de suivi et prochain envoi)" checked={share} onChange={setShare} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setOpen(false)}>Annuler</Button>
              <Button size="sm" variant="primary" type="submit" disabled={busy}>Publier</Button>
            </div>
          </div>
        </form>
      )}
      <div className="px-4 py-3">
        {u ? (
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <HealthBadge health={u.health} /><span>{u.author_name ?? '—'}, {fmtRelative(u.created_at)}</span>
            </div>
            {u.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{u.body}</p>}
          </div>
        ) : <p className="text-sm text-muted-foreground">Aucun point pour l’instant. Un point régulier rassure l’équipe et le client.</p>}
      </div>
    </Card>
  )
}

function Members({ project, onChanged }: Props) {
  const { team } = useApp()
  const [user, setUser] = useState('')
  const [role, setRole] = useState('member')
  const ids = new Set(project.members_detail.map((m) => m.id))
  const candidates = team.filter((m) => m.active && !ids.has(m.id))
  const call = async (f: () => Promise<unknown>) => { try { await f(); onChanged() } catch (e) { toast(errorText(e)) } }
  return (
    <Card title="Intervenants">
      <ul className="divide-y divide-border">
        {project.members_detail.map((m) => (
          <li key={m.id} className="flex items-center gap-2.5 px-4 py-2.5">
            <Avatar person={m} size={28} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{m.name}</p>
              <p className="text-xs text-muted-foreground">{fmtMinutes(m.minutes)} passées</p>
            </div>
            <select aria-label={`Rôle de ${m.name}`} value={m.role} className="border border-transparent bg-transparent py-1 text-xs font-semibold hover:border-input"
              onChange={(e) => call(() => api.post(`/projects/${project.id}/members`, { user_id: m.id, role: e.target.value, hourly_rate_cents: m.hourly_rate_cents }))}>
              {Object.entries(PROJECT_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button aria-label={`Retirer ${m.name}`} title="Retirer du projet" className="px-1.5 text-lg leading-none text-muted-foreground hover:text-late"
              onClick={() => call(() => api.del(`/projects/${project.id}/members/${m.id}`))}>×</button>
          </li>
        ))}
      </ul>
      {candidates.length > 0 && (
        <form className="flex flex-wrap gap-2 border-t border-border px-4 py-3"
          onSubmit={(e) => { e.preventDefault(); if (user) call(() => api.post(`/projects/${project.id}/members`, { user_id: user, role })).then(() => setUser('')) }}>
          <Select value={user} onChange={(e) => setUser(e.target.value)} aria-label="Personne à ajouter" className="w-full py-1.5 text-xs">
            <option value="">Ajouter une personne…</option>
            {candidates.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rôle" className="min-w-0 flex-1 py-1.5 text-xs">
            {Object.entries(PROJECT_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Button size="sm" type="submit" disabled={!user}>Ajouter</Button>
        </form>
      )}
    </Card>
  )
}

function ClientCard({ project }: Props) {
  const c = project.client
  return (
    <Card title="Client">
      {!c ? <p className="px-4 py-3 text-sm text-muted-foreground">Projet interne, sans client. <Link to={`/projets/${project.id}/reglages`} className="font-semibold text-accent">Lui en associer un</Link></p> : (
        <div className="space-y-3 px-4 py-3 text-sm">
          <div>
            <Link to={`/clients/${c.id}`} className="font-bold hover:text-accent">{c.name}</Link>
            {c.contact_person && <p className="text-muted-foreground">{c.contact_person}</p>}
            {c.email && <a href={`mailto:${c.email}`} className="block break-all text-accent hover:underline">{c.email}</a>}
            {c.phone && <a href={`tel:${c.phone}`} className="block">{c.phone}</a>}
            {(c.town || c.street) && <p className="text-muted-foreground">{[c.street && `${c.street} ${c.building_number ?? ''}`.trim(), [c.postal_code, c.town].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>}
          </div>
          {project.contacts.length > 0 && (
            <ul className="space-y-2 border-t border-border pt-3">
              {project.contacts.map((ct) => (
                <li key={ct.id}>
                  <p className="font-semibold">{ct.name}{ct.job_title && <span className="font-normal text-muted-foreground"> · {ct.job_title}</span>}</p>
                  {ct.email && <a href={`mailto:${ct.email}`} className="break-all text-xs text-accent hover:underline">{ct.email}</a>}
                  {ct.receives_updates && <span className="ml-2 text-[11px] text-muted-foreground">reçoit le suivi</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function UpcomingEvents({ project }: Props) {
  const [events, setEvents] = useState<CalEvent[] | null>(null)
  useEffect(() => {
    api.get<{ events: CalEvent[] }>(`/calendar/events?from=${today()}&to=${addDays(today(), 90)}&scope=all`)
      .then((r) => setEvents(r.events.filter((e) => e.project_id === project.id && Date.parse(e.ends_at) >= Date.now()).slice(0, 5)))
      .catch(() => setEvents([]))
  }, [project.id])
  return (
    <Card title="Prochains rendez-vous" action={<Link to="/agenda" className="text-xs font-bold text-accent hover:underline">Agenda</Link>}>
      {!events ? <p className="px-4 py-3 text-sm text-muted-foreground">…</p> : !events.length
        ? <p className="px-4 py-3 text-sm text-muted-foreground">Rien de prévu dans les trois prochains mois.</p>
        : <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-2.5 text-sm">
                <p className="font-semibold">{e.title}</p>
                <p className="text-xs text-muted-foreground">{e.all_day ? fmtDate(e.starts_at) : fmtDateTime(e.starts_at)}{e.location && ` · ${e.location}`}</p>
              </li>
            ))}
          </ul>}
    </Card>
  )
}

/** Vue d'ensemble : où en est le projet, d'un coup d'œil. */
export default function Overview(props: Props) {
  const { project: p } = props
  const overBudget = Boolean(p.budget_minutes && p.minutes_spent > p.budget_minutes)
  const money = (c: number | null | undefined, cur: string) => fmtMoney(c, cur).replace(/[.,]00$/, '')
  const amount = p.billing_mode === 'fixed' ? money(p.fixed_cents, p.currency)
    : p.billing_mode === 'retainer' ? `${money(p.retainer_cents, p.currency)} / mois`
    : p.billing_mode === 'milestone' ? money(p.stages.reduce((s, x) => s + (x.billing_cents ?? 0), 0), p.currency)
    : p.billing_mode === 'none' ? '—' : money(p.billable_cents, p.currency)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="Tâches" value={`${p.tasks_done}/${p.tasks_total}`} sub={p.tasks_total ? `${Math.round((p.tasks_done / p.tasks_total) * 100)} % terminées` : 'Aucune tâche'} />
          <Stat label="En retard" value={String(p.tasks_late)} sub={p.tasks_late ? 'tâches à rattraper' : 'Rien en retard'} tone={p.tasks_late ? 'late' : undefined} />
          <Stat label="Temps passé" value={fmtMinutes(p.minutes_spent)} tone={overBudget ? 'late' : undefined}
                sub={p.budget_minutes ? `sur ${fmtMinutes(p.budget_minutes)} prévues${overBudget ? ' : budget dépassé' : ''}` : 'Pas de budget en heures'} />
          <Stat label={p.billing_mode === 'hourly' ? 'Facturable' : BILLING_LABEL[p.billing_mode]} value={amount}
                sub={p.billing_mode === 'hourly' ? 'temps facturable valorisé' : p.billing_mode === 'milestone' ? 'total des étapes' : undefined} />
        </div>
        <Card title="Étapes" action={<Link to={`/projets/${p.id}/etapes`} className="text-xs font-bold text-accent hover:underline">Gérer</Link>}>
          <StageTimeline stages={p.stages} to={`/projets/${p.id}/etapes`} />
        </Card>
        <Updates {...props} />
        <Description {...props} />
      </div>
      <div className="min-w-0 space-y-4">
        <Members {...props} />
        <ClientCard {...props} />
        <UpcomingEvents {...props} />
      </div>
    </div>
  )
}
