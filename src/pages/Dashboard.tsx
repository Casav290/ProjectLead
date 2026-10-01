import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { addDays, fmtMinutes, fmtRelative, fmtShortDate, fmtTime, hours, mondayOf, STATUS_LABEL, today, weekdayShort } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import { Card, ColorDot, Empty, ErrorNote, HealthBadge, PageHeader, PriorityBadge, Progress, Spinner, toast } from '../components/ui'

type DashTask = { id: string; title: string; due_date: string | null; priority: string; project_id: string; project_name: string; project_color: string }
type DashProject = { id: string; name: string; code: string | null; color: string; status: string; health: string; due_date: string | null
  client_name: string | null; tasks_total: number; tasks_done: number; tasks_late: number; minutes_spent: number; budget_minutes: number | null }
type DashEvent = { id: string; title: string; starts_at: string; ends_at: string; location: string; project_name: string | null }
type DashActivity = { kind: string; data: any; created_at: string; project_id: string; project_name: string; actor_name: string | null }
type Dashboard = {
  myTasks: DashTask[]; projects: DashProject[]; week: { entry_date: string; minutes: number }[]; events: DashEvent[]
  counts: { active: number; at_risk: number; late: number; inbox: number; leads: number }; activity: DashActivity[]
}

const longDate = (d: Date) => new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
const dayLabel = (iso: string) => new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))

/** Une ligne d'activité, dite en clair. */
function activityText(a: DashActivity) {
  const d = a.data ?? {}
  switch (a.kind) {
    case 'task_created': return `a créé la tâche « ${d.title} »`
    case 'task_completed': return `a terminé « ${d.title} »`
    case 'task_reopened': return `a rouvert « ${d.title} »`
    case 'task_deleted': return `a supprimé « ${d.title} »`
    case 'task_moved': return `a déplacé « ${d.title} » vers ${d.column}`
    case 'task_due': return `a changé l'échéance de « ${d.title} »`
    case 'time_logged': return `a saisi ${fmtMinutes(d.minutes)}`
    case 'email_in': return `Email reçu de ${d.from} : ${d.subject}`
    case 'email_out': return `Email envoyé : ${d.subject}`
    case 'event_created': return `a planifié « ${d.title} »`
    case 'file_added': return `a ajouté le fichier ${d.filename}`
    case 'member_added': return 'a ajouté un intervenant'
    case 'project_created': return 'a créé le projet'
    case 'project_status': return `a passé le projet en « ${STATUS_LABEL[d.to] ?? d.to} »`
    case 'project_update': return 'a publié un point de situation'
    case 'stage_created': return `a ajouté l'étape « ${d.name} »`
    case 'stage_done': return `Étape terminée : ${d.name}`
    case 'stage_status': return `a changé l'étape « ${d.name} »`
    case 'booking': return `Rendez-vous pris par ${d.name}`
    default: return a.kind
  }
}

export default function Dashboard() {
  const { me } = useApp()
  const { data, error, loading, setData } = useLoad<Dashboard>('/dashboard')
  const [done, setDone] = useState<Set<string>>(new Set())

  if (loading && !data) return <Spinner />
  if (error || !data || !me) return <ErrorNote error={error ?? 'not_found'} />

  const complete = async (t: DashTask) => {
    setDone((s) => new Set(s).add(t.id))
    try {
      await api.patch(`/tasks/${t.id}`, { completed: true })
      toast(`« ${t.title} » terminée`)
      setTimeout(() => setData((d) => d && { ...d, myTasks: d.myTasks.filter((x) => x.id !== t.id) }), 600)
    } catch (e) {
      setDone((s) => { const n = new Set(s); n.delete(t.id); return n })
      toast('La tâche n\'a pas pu être terminée.')
    }
  }

  const t0 = today()
  const groups = [
    { id: 'late', label: 'En retard', tasks: data.myTasks.filter((t) => t.due_date && t.due_date.slice(0, 10) < t0) },
    { id: 'today', label: "Aujourd'hui", tasks: data.myTasks.filter((t) => t.due_date?.slice(0, 10) === t0) },
    { id: 'next', label: 'À venir', tasks: data.myTasks.filter((t) => !t.due_date || t.due_date.slice(0, 10) > t0).slice(0, 12) },
  ]
  const c = data.counts
  const tiles = [
    { label: 'Projets actifs', value: c.active, to: '/projets' },
    { label: 'À surveiller', value: c.at_risk, to: '/projets', tone: c.at_risk ? 'warn' : '' },
    { label: 'En retard', value: c.late, to: '/projets', tone: c.late ? 'late' : '' },
    { label: 'Emails à trier', value: c.inbox, to: '/emails', tone: c.inbox ? 'accent' : '' },
    { label: 'Demandes à qualifier', value: c.leads, to: '/projets', tone: c.leads ? 'accent' : '' },
  ]

  return (
    <div>
      <PageHeader title={`Bonjour ${me.user.name.split(' ')[0]}`} subtitle={<span className="first-letter:uppercase inline-block">{longDate(new Date())}</span>} />

      <div className="mb-5 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="group bg-card px-4 py-3 hover:bg-head">
            <div className={clsx('font-display text-3xl font-extrabold tabular-nums',
              t.tone === 'warn' && 'text-soon', t.tone === 'late' && 'text-late', t.tone === 'accent' && 'text-accent')}>{t.value}</div>
            <div className="text-xs font-semibold text-muted-foreground group-hover:text-foreground">{t.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title="Mes tâches" action={<Link to="/taches" className="text-xs font-bold text-accent hover:underline">Toutes mes tâches</Link>}>
            {data.myTasks.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Rien d'ouvert à votre nom. Belle journée.</p>
            ) : groups.filter((g) => g.tasks.length).map((g) => (
              <div key={g.id}>
                <h3 className={clsx('border-b border-border bg-head px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[.06em]',
                  g.id === 'late' ? 'text-late' : 'text-muted-foreground')}>{g.label} · {g.tasks.length}</h3>
                <ul>
                  {g.tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
                      <input type="checkbox" aria-label={`Terminer ${t.title}`} className="h-4 w-4 shrink-0 accent-[hsl(var(--accent))]"
                        checked={done.has(t.id)} disabled={done.has(t.id)} onChange={() => complete(t)} />
                      <div className="min-w-0 flex-1">
                        <Link to={`/projets/${t.project_id}?tache=${t.id}`}
                          className={clsx('block truncate text-sm font-semibold hover:text-accent', done.has(t.id) && 'text-muted-foreground line-through')}>{t.title}</Link>
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <ColorDot color={t.project_color} /><span className="truncate">{t.project_name}</span>
                        </span>
                      </div>
                      <PriorityBadge priority={t.priority} />
                      {t.due_date && <span className={clsx('shrink-0 text-xs tabular-nums', g.id === 'late' ? 'font-bold text-late' : 'text-muted-foreground')}>
                        {fmtShortDate(t.due_date)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>

          <Card title="Projets suivis" action={<Link to="/projets" className="text-xs font-bold text-accent hover:underline">Tous les projets</Link>}>
            {data.projects.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">Aucun projet en cours.</p> : (
              <ul>
                {data.projects.map((p) => {
                  const pct = p.tasks_total ? (p.tasks_done / p.tasks_total) * 100 : 0
                  const used = p.budget_minutes ? (p.minutes_spent / p.budget_minutes) * 100 : null
                  return (
                    <li key={p.id} className="border-b border-border last:border-b-0">
                      <Link to={`/projets/${p.id}`} className="grid gap-x-4 gap-y-2 px-4 py-3 hover:bg-head sm:grid-cols-[minmax(0,1fr)_150px_150px]">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <ColorDot color={p.color} />
                            <span className="truncate text-sm font-bold">{p.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <HealthBadge health={p.health} />
                            {p.client_name && <span className="truncate">{p.client_name}</span>}
                            {p.due_date && <span>· fin {fmtShortDate(p.due_date)}</span>}
                            {p.tasks_late > 0 && <span className="font-bold text-late">· {p.tasks_late} en retard</span>}
                          </div>
                        </div>
                        <div className="text-xs">
                          <div className="mb-1 flex justify-between text-muted-foreground"><span>Avancement</span><span className="tabular-nums">{p.tasks_done}/{p.tasks_total}</span></div>
                          <Progress value={pct} tone={pct >= 100 ? 'ok' : 'accent'} />
                        </div>
                        <div className="text-xs">
                          <div className="mb-1 flex justify-between gap-2 text-muted-foreground">
                            <span>Temps</span>
                            <span className={clsx('tabular-nums', used !== null && used > 100 && 'font-bold text-late')}>
                              {hours(p.minutes_spent)} h{p.budget_minutes ? ` / ${hours(p.budget_minutes)} h` : ''}</span>
                          </div>
                          {used !== null ? <Progress value={used} tone={used > 100 ? 'late' : used > 85 ? 'warn' : 'accent'} />
                            : <div className="text-[11px] text-muted-foreground">Sans budget d'heures</div>}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <WeekCard week={data.week} capacity={me.user.capacity_minutes} />

          <Card title="Prochains rendez-vous" action={<Link to="/agenda" className="text-xs font-bold text-accent hover:underline">Agenda</Link>}>
            {data.events.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">Rien de prévu ces sept prochains jours.</p> : (
              <ul>
                {data.events.map((e) => (
                  <li key={e.id} className="flex gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                    <div className="w-[72px] shrink-0 text-xs">
                      <div className="font-bold first-letter:uppercase">{dayLabel(e.starts_at)}</div>
                      <div className="tabular-nums text-muted-foreground">{fmtTime(e.starts_at)}–{fmtTime(e.ends_at)}</div>
                    </div>
                    <div className="min-w-0 text-sm">
                      <div className="truncate font-semibold">{e.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{[e.project_name, e.location].filter(Boolean).join(' · ')}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Activité récente">
            {data.activity.length === 0 ? <div className="p-4"><Empty title="Pas encore d'activité" /></div> : (
              <ul>
                {data.activity.slice(0, 12).map((a, i) => (
                  <li key={i} className="border-b border-border px-4 py-2 text-sm last:border-b-0">
                    <p className="[overflow-wrap:anywhere]">
                      {a.actor_name && !['email_in', 'stage_done', 'booking'].includes(a.kind) && <span className="font-semibold">{a.actor_name} </span>}
                      {activityText(a)}
                    </p>
                    <p className="mt-0.5 flex min-w-0 gap-1 text-xs text-muted-foreground">
                      <Link to={`/projets/${a.project_id}`} className="truncate hover:text-accent">{a.project_name}</Link>
                      <span className="shrink-0">· {fmtRelative(a.created_at)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Mon temps de la semaine : un petit histogramme par jour, face à la capacité. */
function WeekCard({ week, capacity }: { week: Dashboard['week']; capacity: number }) {
  const start = mondayOf(today())
  const perDay = capacity / 5
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i)
    return { d, minutes: week.find((w) => w.entry_date.slice(0, 10) === d)?.minutes ?? 0 }
  })
  const total = days.reduce((s, x) => s + x.minutes, 0)
  const max = Math.max(perDay, ...days.map((x) => x.minutes)) || 1
  return (
    <Card title="Mon temps cette semaine" action={<Link to="/temps" className="text-xs font-bold text-accent hover:underline">Feuille de temps</Link>}>
      <div className="px-4 py-3">
        <p className="text-sm"><span className="font-display text-2xl font-extrabold tabular-nums">{hours(total)} h</span>
          <span className="text-muted-foreground"> sur {hours(capacity)} h</span></p>
        <Progress className="mt-2" value={capacity ? (total / capacity) * 100 : 0} tone={total > capacity ? 'warn' : 'accent'} />
        <div className="relative mt-4 flex h-24 items-end gap-1.5">
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-input" style={{ bottom: `${(perDay / max) * 100}%` }}
               title={`Capacité : ${fmtMinutes(perDay)} par jour`} />
          {days.map((x) => (
            <div key={x.d} className="flex h-full flex-1 flex-col justify-end" title={`${weekdayShort(x.d)} : ${fmtMinutes(x.minutes)}`}>
              <div className={clsx('w-full', x.minutes > perDay ? 'bg-soon' : x.d === today() ? 'bg-accent' : 'bg-accent-light')}
                   style={{ height: `${(x.minutes / max) * 100}%`, minHeight: x.minutes ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {days.map((x) => <span key={x.d} className={clsx('flex-1 text-center text-[10.5px] uppercase', x.d === today() ? 'font-extrabold' : 'text-muted-foreground')}>
            {weekdayShort(x.d).replace('.', '').slice(0, 2)}</span>)}
        </div>
      </div>
    </Card>
  )
}
