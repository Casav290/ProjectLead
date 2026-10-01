import clsx from 'clsx'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import TaskDrawer from '../components/project/TaskDrawer'
import { DoneToggle, DueLabel, MilestoneMark, PRIORITY_RANK, setTaskDone } from '../components/project/shared'
import { Badge, Button, Empty, ErrorNote, Input, PageHeader, PriorityBadge, Select, Spinner, toast } from '../components/ui'
import { api, errorText } from '../lib/api'
import { addDays, fmtRelative, mondayOf, today } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { ProjectSummary, Task } from '../lib/types'

/** Mes tâches, tous projets confondus, rangées par urgence. */

type SectionKey = 'late' | 'today' | 'week' | 'later' | 'none' | 'done'
const SECTIONS: { key: SectionKey; title: string; tone?: string }[] = [
  { key: 'late', title: 'En retard', tone: 'text-late' },
  { key: 'today', title: "Aujourd'hui", tone: 'text-soon' },
  { key: 'week', title: 'Cette semaine' },
  { key: 'later', title: 'Plus tard' },
  { key: 'none', title: 'Sans date' },
  { key: 'done', title: 'Terminées récemment' },
]

function sectionOf(t: Task, now: string, weekEnd: string, recent: string): SectionKey | null {
  if (t.completed_at) return t.completed_at.slice(0, 10) >= recent ? 'done' : null
  if (!t.due_date) return 'none'
  if (t.due_date < now) return 'late'
  if (t.due_date === now) return 'today'
  if (t.due_date <= weekEnd) return 'week'
  return 'later'
}

export default function MyTasks() {
  const { me } = useApp()
  const { data, setData, error, loading, reload } = useLoad<Task[]>('/tasks?assignee=me')
  const { data: projects } = useLoad<ProjectSummary[]>('/projects')
  const [project, setProject] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set(['done']))

  const tasks = useMemo(() => data ?? [], [data])
  const groups = useMemo(() => {
    const now = today(), weekEnd = addDays(mondayOf(now), 6), recent = addDays(now, -7)
    const out = Object.fromEntries(SECTIONS.map((s) => [s.key, [] as Task[]])) as Record<SectionKey, Task[]>
    for (const t of tasks) {
      if (project && t.project_id !== project) continue
      const k = sectionOf(t, now, weekEnd, recent)
      if (k) out[k].push(t)
    }
    for (const k of Object.keys(out) as SectionKey[]) {
      out[k].sort(k === 'done'
        ? (a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
        : (a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    }
    return out
  }, [tasks, project])

  const projectOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>()
    for (const t of tasks) seen.set(t.project_id, { id: t.project_id, name: t.project_name, color: t.project_color })
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [tasks])

  const toggle = async (t: Task, v: boolean) => {
    setData(tasks.map((x) => (x.id === t.id ? { ...x, completed_at: v ? new Date().toISOString() : null } : x)))
    try { await setTaskDone(t.id, v) } catch (e) { toast(errorText(e)) }
    reload()
  }

  const openCount = tasks.filter((t) => !t.completed_at).length

  return (
    <div className="min-w-0">
      <PageHeader title="Mes tâches" subtitle={data ? `${openCount} ouverte${openCount > 1 ? 's' : ''}, ${groups.late.length} en retard` : undefined}
        actions={projectOptions.length > 1 && (
          <Select aria-label="Filtrer par projet" value={project} onChange={(e) => setProject(e.target.value)} className="w-auto max-w-[16rem]">
            <option value="">Tous les projets</option>
            {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )} />

      <QuickAdd projects={(projects ?? []).filter((p) => !['done', 'cancelled'].includes(p.status))} defaultProject={project}
        meId={me?.user.id} onCreated={reload} />

      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : !tasks.length ? (
        <Empty title="Aucune tâche ne vous est confiée">Les tâches qu'on vous assigne dans les projets apparaissent ici.</Empty>
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((s) => {
            const list = groups[s.key]
            if (!list.length && s.key !== 'today') return null
            const isCollapsed = collapsed.has(s.key)
            return (
              <section key={s.key} className="border border-border bg-card">
                <h2>
                  <button type="button" aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n })}
                    className="flex w-full items-center gap-2 border-b border-border bg-head px-4 py-2.5 text-left">
                    <span className={clsx('inline-block w-3 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} aria-hidden="true">›</span>
                    <span className={clsx('text-[12px] font-extrabold uppercase tracking-[.08em]', s.tone ?? 'text-foreground')}>{s.title}</span>
                    <span className="text-xs font-semibold text-muted-foreground">{list.length}</span>
                  </button>
                </h2>
                {!isCollapsed && (list.length ? (
                  <ul className="divide-y divide-[#eeebe7]">
                    {list.map((t) => <Row key={t.id} task={t} onToggle={(v) => toggle(t, v)} onOpen={() => setOpenId(t.id)} />)}
                  </ul>
                ) : <p className="px-4 py-3 text-sm text-muted-foreground">Rien ici.</p>)}
              </section>
            )
          })}
        </div>
      )}

      <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  )
}

function Row({ task: t, onToggle, onOpen }: { task: Task; onToggle: (v: boolean) => void; onOpen: () => void }) {
  const done = Boolean(t.completed_at)
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 hover:bg-accent-veil sm:items-center">
      <span className="mt-0.5 sm:mt-0"><DoneToggle done={done} onChange={onToggle} label={`Terminée : ${t.title}`} /></span>
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2 text-left hover:text-accent sm:flex-1">
          {t.is_milestone && <MilestoneMark />}
          <span className={clsx('font-semibold [overflow-wrap:anywhere] sm:truncate', done && 'text-muted-foreground line-through')}>{t.title}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:mt-0 sm:shrink-0">
          {t.blocked && !done && <Badge tone="warn">Bloquée</Badge>}
          <PriorityBadge priority={t.priority} />
          <Link to={`/projets/${t.project_id}?tache=${t.id}`} className="inline-flex max-w-[14rem] items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <span className="h-2 w-2 shrink-0" style={{ background: t.project_color }} aria-hidden="true" />
            <span className="truncate">{t.project_name}</span>
          </Link>
          {done ? <span className="text-muted-foreground">{fmtRelative(t.completed_at)}</span> : <DueLabel task={t} className="w-14 text-right" />}
        </div>
      </div>
    </li>
  )
}

function QuickAdd({ projects, defaultProject, meId, onCreated }: { projects: ProjectSummary[]; defaultProject: string; meId?: string; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = project || defaultProject || projects[0]?.id || ''
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !chosen) return
    setBusy(true)
    try {
      await api.post('/tasks', { project_id: chosen, title: title.trim(), due_date: due || null, assignee_ids: meId ? [meId] : [] })
      setTitle(''); setDue('')
      toast('Tâche ajoutée')
      onCreated()
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  if (!projects.length) return null
  return (
    <form onSubmit={submit} className="mb-5 grid grid-cols-1 gap-2 border border-border bg-card p-3 sm:grid-cols-[1fr_14rem_10rem_auto]">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ajouter une tâche pour moi…" aria-label="Titre de la nouvelle tâche" />
      <Select aria-label="Projet" value={chosen} onChange={(e) => setProject(e.target.value)}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Échéance" />
      <Button type="submit" variant="primary" disabled={busy || !title.trim()}>Ajouter</Button>
    </form>
  )
}
