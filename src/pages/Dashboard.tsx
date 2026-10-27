import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { intlLocale, t, useT } from '../i18n'
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

const longDate = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
const dayLabel = (iso: string) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))

/** Une ligne d'activité, dite en clair. */
function activityText(a: DashActivity) {
  const d = a.data ?? {}
  switch (a.kind) {
    case 'task_created': return t('home.activity.taskCreated', { title: d.title })
    case 'task_completed': return t('home.activity.taskCompleted', { title: d.title })
    case 'task_reopened': return t('home.activity.taskReopened', { title: d.title })
    case 'task_deleted': return t('home.activity.taskDeleted', { title: d.title })
    case 'task_moved': return t('home.activity.taskMoved', { title: d.title, column: d.column })
    case 'task_due': return t('home.activity.taskDue', { title: d.title })
    case 'time_logged': return t('home.activity.timeLogged', { duration: fmtMinutes(d.minutes) })
    case 'email_in': return t('home.activity.emailIn', { from: d.from, subject: d.subject })
    case 'email_out': return t('home.activity.emailOut', { subject: d.subject })
    case 'event_created': return t('home.activity.eventCreated', { title: d.title })
    case 'file_added': return t('home.activity.fileAdded', { name: d.filename })
    case 'member_added': return t('home.activity.memberAdded')
    case 'project_created': return t('home.activity.projectCreated')
    case 'project_status': return t('home.activity.projectStatus', { status: STATUS_LABEL[d.to] ?? d.to })
    case 'project_update': return t('home.activity.projectUpdate')
    case 'stage_created': return t('home.activity.stageCreated', { name: d.name })
    case 'stage_done': return t('home.activity.stageDone', { name: d.name })
    case 'stage_status': return t('home.activity.stageStatus', { name: d.name })
    case 'booking': return t('home.activity.booking', { name: d.name })
    default: return a.kind
  }
}

export default function Dashboard() {
  const t = useT()
  const { me } = useApp()
  const { data, error, loading, setData } = useLoad<Dashboard>('/dashboard')
  const [done, setDone] = useState<Set<string>>(new Set())

  if (loading && !data) return <Spinner />
  if (error || !data || !me) return <ErrorNote error={error ?? 'not_found'} />

  const complete = async (task: DashTask) => {
    setDone((s) => new Set(s).add(task.id))
    try {
      await api.patch(`/tasks/${task.id}`, { completed: true })
      toast(t('home.dash.taskDone', { title: task.title }))
      setTimeout(() => setData((d) => d && { ...d, myTasks: d.myTasks.filter((x) => x.id !== task.id) }), 600)
    } catch (e) {
      setDone((s) => { const n = new Set(s); n.delete(task.id); return n })
      toast(t('home.dash.taskFailed'))
    }
  }

  const t0 = today()
  const groups = [
    { id: 'late', label: t('home.dash.late'), tasks: data.myTasks.filter((t) => t.due_date && t.due_date.slice(0, 10) < t0) },
    { id: 'today', label: t('home.dash.today'), tasks: data.myTasks.filter((t) => t.due_date?.slice(0, 10) === t0) },
    { id: 'next', label: t('home.dash.upcoming'), tasks: data.myTasks.filter((t) => !t.due_date || t.due_date.slice(0, 10) > t0).slice(0, 12) },
  ]
  const c = data.counts
  const tiles = [
    { label: t('home.dash.activeProjects'), value: c.active, to: '/projets?statut=active' },
    { label: t('home.dash.atRisk'), value: c.at_risk, to: '/projets', tone: c.at_risk ? 'warn' : '' },
    { label: t('home.dash.late'), value: c.late, to: '/projets', tone: c.late ? 'late' : '' },
    { label: t('home.dash.inbox'), value: c.inbox, to: '/emails', tone: c.inbox ? 'accent' : '' },
    { label: t('home.dash.leads'), value: c.leads, to: '/projets?statut=lead', tone: c.leads ? 'accent' : '' },
  ]

  return (
    <div>
      <PageHeader title={t('home.dash.hello', { name: me.user.name.split(' ')[0] })} subtitle={<span className="first-letter:uppercase inline-block">{longDate(new Date())}</span>} />

      <div className="mb-5 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile, i) => (
          <Link key={tile.label} to={tile.to} className={clsx('group bg-card px-4 py-3 hover:bg-head', i === 4 && 'col-span-2 lg:col-span-1')}>
            <div className={clsx('font-display text-3xl font-extrabold tabular-nums',
              tile.tone === 'warn' && 'text-soon', tile.tone === 'late' && 'text-late', tile.tone === 'accent' && 'text-accent')}>{tile.value}</div>
            <div className="text-xs font-semibold text-muted-foreground group-hover:text-foreground">{tile.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title={t('home.dash.myTasks')} action={<Link to="/taches" className="whitespace-nowrap text-xs font-bold text-accent hover:underline">{t('home.dash.allMyTasks')}</Link>}>
            {data.myTasks.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t('home.dash.noTasks')}</p>
            ) : groups.filter((g) => g.tasks.length).map((g) => (
              <div key={g.id}>
                <h3 className={clsx('border-b border-border bg-head px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[.06em]',
                  g.id === 'late' ? 'text-late' : 'text-muted-foreground')}>{g.label} · {g.tasks.length}</h3>
                <ul>
                  {g.tasks.map((task) => (
                    <li key={task.id} className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
                      <input type="checkbox" aria-label={t('home.dash.completeTask', { title: task.title })} className="h-4 w-4 shrink-0 accent-[hsl(var(--accent))]"
                        checked={done.has(task.id)} disabled={done.has(task.id)} onChange={() => complete(task)} />
                      <div className="min-w-0 flex-1">
                        <Link to={`/projets/${task.project_id}?tache=${task.id}`}
                          className={clsx('block truncate text-sm font-semibold hover:text-accent', done.has(task.id) && 'text-muted-foreground line-through')}>{task.title}</Link>
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <ColorDot color={task.project_color} /><span className="truncate">{task.project_name}</span>
                        </span>
                      </div>
                      <PriorityBadge priority={task.priority} />
                      {task.due_date && <span className={clsx('shrink-0 text-xs tabular-nums', g.id === 'late' ? 'font-bold text-late' : 'text-muted-foreground')}>
                        {fmtShortDate(task.due_date)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>

          <Card title={t('home.dash.followed')} action={<Link to="/projets" className="whitespace-nowrap text-xs font-bold text-accent hover:underline">{t('home.dash.allProjects')}</Link>}>
            {data.projects.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t('home.dash.noProjects')}</p> : (
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
                            {p.due_date && <span>{t('home.dash.ends', { date: fmtShortDate(p.due_date) })}</span>}
                            {p.tasks_late > 0 && <span className="font-bold text-late">{t('home.dash.lateCount', { n: p.tasks_late })}</span>}
                          </div>
                        </div>
                        <div className="text-xs">
                          <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('home.dash.progress')}</span><span className="tabular-nums">{p.tasks_done}/{p.tasks_total}</span></div>
                          <Progress value={pct} tone={pct >= 100 ? 'ok' : 'accent'} />
                        </div>
                        <div className="text-xs">
                          <div className="mb-1 flex justify-between gap-2 text-muted-foreground">
                            <span>{t('home.dash.time')}</span>
                            <span className={clsx('tabular-nums', used !== null && used > 100 && 'font-bold text-late')}>
                              {hours(p.minutes_spent)} h{p.budget_minutes ? ` / ${hours(p.budget_minutes)} h` : ''}</span>
                          </div>
                          {used !== null ? <Progress label={t('home.dash.budgetUsed')} value={used} tone={used > 100 ? 'late' : used > 85 ? 'warn' : 'accent'} />
                            : <div className="text-[11px] text-muted-foreground">{t('home.dash.noBudget')}</div>}
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

          <Card title={t('home.dash.events')} action={<Link to="/agenda" className="whitespace-nowrap text-xs font-bold text-accent hover:underline">{t('home.dash.agenda')}</Link>}>
            {data.events.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">{t('home.dash.noEvents')}</p> : (
              <ul>
                {data.events.map((e) => (
                  <li key={e.id} className="flex gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                    <div className="w-[92px] shrink-0 text-xs">
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

          <Card title={t('home.dash.activity')}>
            {data.activity.length === 0 ? <div className="p-4"><Empty title={t('home.dash.noActivity')} /></div> : (
              <ul>
                {data.activity.slice(0, 8).map((a, i) => (
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
  const t = useT()
  const start = mondayOf(today())
  const perDay = capacity / 5
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i)
    return { d, minutes: week.find((w) => w.entry_date.slice(0, 10) === d)?.minutes ?? 0 }
  })
  const total = days.reduce((s, x) => s + x.minutes, 0)
  const max = Math.max(perDay, ...days.map((x) => x.minutes)) || 1
  return (
    <Card title={t('home.dash.myWeek')} action={<Link to="/temps" className="whitespace-nowrap text-xs font-bold text-accent hover:underline">{t('home.dash.timesheet')}</Link>}>
      <div className="px-4 py-3">
        <p className="text-sm"><span className="font-display text-2xl font-extrabold tabular-nums">{hours(total)} h</span>
          <span className="text-muted-foreground"> {t('home.dash.ofCapacity', { hours: hours(capacity) })}</span></p>
        <Progress label={t('home.dash.weekProgress')} className="mt-2" value={capacity ? (total / capacity) * 100 : 0} tone={total > capacity ? 'warn' : 'accent'} />
        <div className="relative mt-4 flex h-24 items-end gap-1.5">
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-input" style={{ bottom: `${(perDay / max) * 100}%` }}
               title={t('home.dash.capacityPerDay', { duration: fmtMinutes(perDay) })} />
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
