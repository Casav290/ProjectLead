import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import clsx from 'clsx'
import { useMemo, useState, type FormEvent } from 'react'
import { intlLocale, useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { addDays, fmtDate, fmtTime, mondayOf, today, weekdayShort } from '../../lib/format'
import { useLoad } from '../../lib/store'
import type { ProjectDetail, Task } from '../../lib/types'
import { Button, ErrorNote, Field, Input, Modal, Spinner, toast } from '../ui'
import { isOverdue, useOpenTask, useProjectTasks } from './shared'

/** Calendrier du mois : échéances des tâches et des étapes, rendez-vous du projet. */

type CalEvent = { id: string; title: string; starts_at: string; ends_at: string; all_day: boolean; project_id: string | null; kind: string; location: string }
type Item =
  | { kind: 'task'; id: string; date: string; task: Task }
  | { kind: 'stage'; id: string; date: string; title: string; done: boolean }
  | { kind: 'event'; id: string; date: string; ev: CalEvent }

/** Les jours de la semaine, du lundi au dimanche, dans la langue en cours (le 1er janvier 2024 est un lundi). */
const weekdays = () => Array.from({ length: 7 }, (_, i) => weekdayShort(addDays('2024-01-01', i)))
const monthTitle = (d: string) => new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric' }).format(new Date(d + 'T12:00:00'))
const dayTitle = (d: string) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d + 'T12:00:00'))
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function ProjectCalendar({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const t = useT()
  const [month, setMonth] = useState(() => today().slice(0, 8) + '01')
  const { data, setData, error, loading, reload } = useProjectTasks(project.id, false)
  const gridFrom = mondayOf(month)
  const nextMonth = addDays(month, 32).slice(0, 8) + '01'
  const gridTo = addDays(mondayOf(addDays(nextMonth, -1)), 6)
  const { data: cal } = useLoad<{ events: CalEvent[] }>(`/calendar/events?from=${gridFrom}&to=${gridTo}&scope=all`, [gridFrom, gridTo])
  const openTask = useOpenTask()
  const [create, setCreate] = useState<string | null>(null)

  const tasks = useMemo(() => data ?? [], [data])
  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>()
    const push = (i: Item) => map.set(i.date, [...(map.get(i.date) ?? []), i])
    for (const s of project.stages) if (s.due_date) push({ kind: 'stage', id: s.id, date: s.due_date, title: s.name, done: s.status === 'done' })
    for (const e of cal?.events ?? []) if (e.project_id === project.id) push({ kind: 'event', id: e.id, date: localDay(e.starts_at), ev: e })
    for (const x of tasks) if (x.due_date) push({ kind: 'task', id: x.id, date: x.due_date, task: x })
    return map
  }, [tasks, project, cal])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const moved = tasks.find((x) => x.id === active.id)
    const day = over ? String(over.id) : null
    if (!moved || !day || day === moved.due_date) return
    const patch: Partial<Task> = { due_date: day }
    if (moved.start_date && moved.start_date > day) patch.start_date = day
    setData(tasks.map((x) => (x.id === moved.id ? { ...x, ...patch } : x)))
    try { await api.patch(`/tasks/${moved.id}`, patch); toast(t('ptabs.calendar.dueToast', { date: fmtDate(day) })) } catch (e) { toast(errorText(e)) }
    await reload()
    onChanged()
  }

  if (loading && !data) return <Spinner />
  if (error) return <ErrorNote error={error} />

  const weeks: string[][] = []
  for (let d = gridFrom; d <= gridTo; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)))
  const monthDays = [...byDay.keys()].filter((d) => d.startsWith(month.slice(0, 7))).sort()

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 font-display text-xl capitalize">{monthTitle(month)}</h2>
        <div className="flex">
          <Button size="sm" aria-label={t('ptabs.calendar.prevMonth')} onClick={() => setMonth(addDays(month, -1).slice(0, 8) + '01')}>‹</Button>
          <Button size="sm" className="-ml-px" onClick={() => setMonth(today().slice(0, 8) + '01')}>{t('ptabs.common.today')}</Button>
          <Button size="sm" className="-ml-px" aria-label={t('ptabs.calendar.nextMonth')} onClick={() => setMonth(nextMonth)}>›</Button>
        </div>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setCreate(today())}>{t('ptabs.calendar.newTask')}</Button>
      </div>

      {/* Grand écran : la grille du mois, où l'on glisse les tâches d'un jour à l'autre */}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="hidden border-l border-t border-border bg-card sm:block">
          <div className="grid grid-cols-7 bg-head">
            {weekdays().map((w) => <div key={w} className="border-b border-r border-input px-2 py-1.5 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-muted-foreground">{w}</div>)}
          </div>
          {weeks.map((w) => (
            <div key={w[0]} className="grid grid-cols-7">
              {w.map((d) => <Day key={d} date={d} inMonth={d.startsWith(month.slice(0, 7))} items={byDay.get(d) ?? []} onOpen={openTask} onCreate={() => setCreate(d)} />)}
            </div>
          ))}
        </div>
      </DndContext>

      {/* Téléphone : les jours du mois qui ont quelque chose, en liste */}
      <div className="space-y-3 sm:hidden">
        {monthDays.length === 0 && <p className="border border-dashed border-input bg-card p-6 text-center text-sm text-muted-foreground">{t('ptabs.calendar.nothing')}</p>}
        {monthDays.map((d) => (
          <section key={d} className="border border-border bg-card">
            <h3 className={clsx('border-b border-border px-3 py-1.5 text-[13px] font-bold first-letter:uppercase', d === today() && 'text-accent')}>{dayTitle(d)}</h3>
            <ul className="space-y-1 p-2">
              {(byDay.get(d) ?? []).map((i) => <li key={i.kind + i.id}><Chip item={i} onOpen={openTask} /></li>)}
            </ul>
          </section>
        ))}
      </div>

      <QuickCreate date={create} project={project} onClose={() => setCreate(null)} onDone={async () => { await reload(); onChanged() }} />
    </div>
  )
}

function Day({ date, inMonth, items, onOpen, onCreate }: { date: string; inMonth: boolean; items: Item[]; onOpen: (id: string) => void; onCreate: () => void }) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: date })
  const isToday = date === today()
  return (
    <div ref={setNodeRef} onClick={(e) => e.target === e.currentTarget && onCreate()}
      className={clsx('group relative min-h-[112px] min-w-0 border-b border-r border-border p-1', !inMonth && 'bg-[#faf9f7]', isOver && 'bg-accent-veil')}>
      <div className="pointer-events-none mb-1 flex items-center justify-between">
        <span className={clsx('px-1 text-xs font-bold', isToday ? 'bg-accent text-white' : inMonth ? 'text-foreground' : 'text-muted-foreground')}>{+date.slice(8)}</span>
      </div>
      <button type="button" onClick={onCreate} aria-label={t('ptabs.calendar.addOn', { date: fmtDate(date) })}
        className="absolute right-1 top-1 px-1 text-sm font-bold text-muted-foreground opacity-0 hover:text-accent focus:opacity-100 group-hover:opacity-100">+</button>
      <ul className="space-y-0.5">
        {items.map((i) => <li key={i.kind + i.id}>{i.kind === 'task' ? <DraggableChip item={i} onOpen={onOpen} /> : <Chip item={i} onOpen={onOpen} />}</li>)}
      </ul>
    </div>
  )
}

function DraggableChip({ item, onOpen }: { item: Extract<Item, { kind: 'task' }>; onOpen: (id: string) => void }) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-roledescription={t('ptabs.calendar.draggable')}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={clsx('relative touch-manipulation', isDragging && 'z-30 opacity-90')}>
      <Chip item={item} onOpen={onOpen} />
    </div>
  )
}

function Chip({ item: i, onOpen }: { item: Item; onOpen: (id: string) => void }) {
  const t = useT()
  if (i.kind === 'stage') {
    return (
      <div className={clsx('flex items-center gap-1.5 border-l-[3px] border-foreground bg-muted px-1.5 py-0.5 text-[11.5px] font-bold', i.done && 'opacity-60')} title={t('ptabs.calendar.stageEnd', { title: i.title })}>
        <span className="truncate">{t('ptabs.calendar.stage', { title: i.title })}</span>
      </div>
    )
  }
  if (i.kind === 'event') {
    return (
      <div className="truncate border-l-[3px] border-[#0284c7] bg-[#e0f2fe] px-1.5 py-0.5 text-[11.5px] text-[#0369a1]" title={`${i.ev.title}${i.ev.location ? ` — ${i.ev.location}` : ''}`}>
        {!i.ev.all_day && <b className="mr-1">{fmtTime(i.ev.starts_at)}</b>}{i.ev.title}
      </div>
    )
  }
  const task = i.task
  const done = Boolean(task.completed_at)
  return (
    <button type="button" onClick={() => onOpen(task.id)} title={task.title}
      className={clsx('flex w-full min-w-0 cursor-grab items-center gap-1 border-l-[3px] bg-card px-1.5 py-0.5 text-left text-[11.5px] hover:bg-accent-veil',
        done ? 'border-won text-muted-foreground line-through' : isOverdue(task) ? 'border-late' : 'border-accent', 'border-y border-r border-y-border border-r-border')}>
      {task.is_milestone && <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-foreground" aria-label={t('ptabs.shared.milestone')} />}
      <span className="truncate font-semibold">{task.title}</span>
    </button>
  )
}

function QuickCreate({ date, project, onClose, onDone }: { date: string | null; project: ProjectDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastDate, setLastDate] = useState<string | null>(null)
  if (date !== lastDate) { setLastDate(date); setDue(date ?? ''); setTitle('') }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      await api.post('/tasks', { project_id: project.id, title: title.trim(), due_date: due || null })
      toast(t('ptabs.calendar.created'))
      await onDone()
      onClose()
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <Modal open={Boolean(date)} onClose={onClose} title={t('ptabs.calendar.newTask')}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('ptabs.calendar.title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field label={t('ptabs.field.due')}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || !title.trim()}>{t('common.create')}</Button>
        </div>
      </form>
    </Modal>
  )
}
