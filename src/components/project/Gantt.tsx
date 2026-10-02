import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { api, errorText } from '../../lib/api'
import { addDays, daysBetween, fmtDate, mondayOf, today } from '../../lib/format'
import type { ProjectDetail, Stage, Task } from '../../lib/types'
import { Button, ErrorNote, Spinner, toast } from '../ui'
import { isOverdue, useOpenTask, useProjectTasks } from './shared'

/** Diagramme de Gantt maison : barres glissables, jalons, dépendances, ligne du jour. */

type Scale = 'day' | 'week' | 'month'
const DAY_W: Record<Scale, number> = { day: 30, week: 14, month: 4.5 }
const ROW_H = 34
const HEAD_H = 44
const SCALE_LABEL: Record<Scale, string> = { day: 'Jour', week: 'Semaine', month: 'Mois' }

type Row = { kind: 'stage'; stage: Stage | null; label: string } | { kind: 'task'; task: Task }
type Drag = { id: string; mode: 'move' | 'end'; x0: number; delta: number; moved: boolean }

const monthName = (d: string, long = false) => new Intl.DateTimeFormat('fr-CH', { month: long ? 'long' : 'short' }).format(new Date(d + 'T12:00:00'))
/** Numéro de semaine ISO. */
const isoWeek = (d: string) => {
  const x = new Date(d + 'T12:00:00')
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7))
  const jan4 = new Date(x.getFullYear(), 0, 4)
  return 1 + Math.round(((x.getTime() - jan4.getTime()) / 86400e3 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}

/** Dates affichées d'une tâche : sans début, elle occupe le jour de son échéance. */
const span = (t: Task): [string, string] | null => {
  const end = t.due_date ?? t.start_date
  if (!end) return null
  const start = t.start_date && t.start_date <= end ? t.start_date : end
  return [start, end]
}

export default function Gantt({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const { data, setData, error, loading, reload } = useProjectTasks(project.id)
  const openTask = useOpenTask()
  const [scale, setScale] = useState<Scale>('week')
  const [drag, setDrag] = useState<Drag | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const tasks = useMemo(() => data ?? [], [data])
  const dayW = DAY_W[scale]

  // Bornes de l'échelle : tout ce qui est daté, plus aujourd'hui, avec une marge.
  const [from, days] = useMemo(() => {
    const dates = [today(), project.start_date, project.due_date,
      ...tasks.flatMap((t) => [t.start_date, t.due_date]), ...project.stages.flatMap((s) => [s.start_date, s.due_date])]
      .filter(Boolean).map((d) => (d as string).slice(0, 10)).sort()
    let a = addDays(dates[0], -7), b = addDays(dates[dates.length - 1], 21)
    if (scale !== 'day') a = mondayOf(a)
    if (scale === 'month') { a = a.slice(0, 8) + '01'; b = addDays(b, 31) }
    return [a, Math.max(daysBetween(a, b), 42)]
  }, [tasks, project, scale])

  const rows = useMemo<Row[]>(() => {
    const ordered = [...tasks].sort((a, b) => (span(a)?.[0] ?? '9999').localeCompare(span(b)?.[0] ?? '9999') || a.position - b.position)
    const known = new Set(project.stages.map((s) => s.id))
    const out: Row[] = []
    for (const s of project.stages) {
      out.push({ kind: 'stage', stage: s, label: s.name })
      for (const t of ordered) if (t.stage_id === s.id) out.push({ kind: 'task', task: t })
    }
    const rest = ordered.filter((t) => !t.stage_id || !known.has(t.stage_id))
    if (rest.length) {
      if (project.stages.length) out.push({ kind: 'stage', stage: null, label: 'Sans étape' })
      for (const t of rest) out.push({ kind: 'task', task: t })
    }
    return out
  }, [tasks, project.stages])

  // À l'ouverture, on amène la ligne du jour à l'écran.
  const centered = useRef(false)
  useEffect(() => {
    if (centered.current || !scroller.current || !data) return
    centered.current = true
    scroller.current.scrollLeft = Math.max(0, daysBetween(from, today()) * dayW - 160)
  }, [data, from, dayW])

  const x = (d: string) => daysBetween(from, d) * dayW
  const width = days * dayW

  /** Les dates d'une tâche, décalées par le glisser en cours. */
  const shown = (t: Task): [string, string] | null => {
    const s = span(t)
    if (!s || drag?.id !== t.id || !drag.delta) return s
    if (drag.mode === 'move') return [addDays(s[0], drag.delta), addDays(s[1], drag.delta)]
    const end = addDays(s[1], drag.delta)
    return [s[0], end < s[0] ? s[0] : end]
  }

  const onPointerDown = (e: RPointerEvent, t: Task, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: t.id, mode, x0: e.clientX, delta: 0, moved: false })
  }
  const onPointerMove = (e: RPointerEvent) => {
    if (!drag) return
    const px = e.clientX - drag.x0
    setDrag({ ...drag, delta: Math.round(px / dayW), moved: drag.moved || Math.abs(px) > 4 })
  }
  const onPointerUp = async (t: Task) => {
    const d = drag
    setDrag(null)
    if (!d) return
    if (!d.moved) { openTask(t.id); return }
    if (!d.delta) return
    const s = span(t)!
    const patch: Partial<Task> = {}
    if (d.mode === 'move') {
      if (t.start_date) patch.start_date = addDays(s[0], d.delta)
      if (t.due_date) patch.due_date = addDays(t.due_date, d.delta)
    } else {
      const end = addDays(s[1], d.delta)
      patch.due_date = end < s[0] ? s[0] : end
      if (!t.start_date && patch.due_date !== s[1]) patch.start_date = s[0] // la tâche s'étire depuis son ancien jour
    }
    setData(tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))
    try {
      await api.patch(`/tasks/${t.id}`, patch)
      toast(`« ${t.title} » : ${patch.start_date ? fmtDate(patch.start_date) + ' → ' : ''}${fmtDate(patch.due_date ?? t.due_date)}`)
    } catch (err) { toast(errorText(err)) }
    await reload()
    onChanged()
  }

  if (loading && !data) return <Spinner />
  if (error) return <ErrorNote error={error} />

  // Graduations : bandes du haut (mois ou années) et cases du bas (jours, semaines, mois).
  const top: { label: string; x: number; w: number }[] = []
  const bottom: { label: string; x: number; w: number; weekend?: boolean }[] = []
  for (let i = 0; i < days;) {
    const d = addDays(from, i)
    if (scale === 'month') {
      const next = addDays(d.slice(0, 8) + '01', 32).slice(0, 8) + '01'
      const n = Math.min(daysBetween(d, next), days - i)
      bottom.push({ label: monthName(d), x: i * dayW, w: n * dayW })
      i += n
    } else if (scale === 'week') {
      const n = Math.min(7 - ((new Date(d + 'T12:00:00').getDay() + 6) % 7), days - i)
      bottom.push({ label: `S${isoWeek(d)}`, x: i * dayW, w: n * dayW })
      i += n
    } else {
      const wd = new Date(d + 'T12:00:00').getDay()
      bottom.push({ label: d.slice(8), x: i * dayW, w: dayW, weekend: wd === 0 || wd === 6 })
      i += 1
    }
  }
  for (let i = 0; i < days;) {
    const d = addDays(from, i)
    if (scale === 'month') {
      const next = `${+d.slice(0, 4) + 1}-01-01`
      const n = Math.min(daysBetween(d, next), days - i)
      top.push({ label: d.slice(0, 4), x: i * dayW, w: n * dayW })
      i += n
    } else {
      const next = addDays(d.slice(0, 8) + '01', 32).slice(0, 8) + '01'
      const n = Math.min(daysBetween(d, next), days - i)
      top.push({ label: `${monthName(d, true)} ${d.slice(0, 4)}`, x: i * dayW, w: n * dayW })
      i += n
    }
  }

  // Flèches de dépendance : de la fin de la tâche attendue au début de celle qui attend.
  const rowIndex = new Map<string, number>()
  rows.forEach((r, i) => r.kind === 'task' && rowIndex.set(r.task.id, i))
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const arrows: { key: string; d: string; late: boolean }[] = []
  for (const t of tasks) {
    const ti = rowIndex.get(t.id), ts = shown(t)
    if (ti === undefined || !ts) continue
    for (const dep of t.depends_on) {
      const p = byId.get(dep), pi = rowIndex.get(dep), ps = p && shown(p)
      if (!p || pi === undefined || !ps) continue
      const x1 = x(addDays(ps[1], 1)), y1 = pi * ROW_H + ROW_H / 2
      const x2 = x(ts[0]), y2 = ti * ROW_H + ROW_H / 2
      const mid = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10))
      const path = x2 - 6 >= x1 + 6
        ? `M${x1},${y1} H${mid} V${y2} H${x2}`
        : `M${x1},${y1} h6 V${y1 + (y2 > y1 ? ROW_H / 2 : -ROW_H / 2)} H${x2 - 8} V${y2} H${x2}`
      arrows.push({ key: `${dep}-${t.id}`, d: path, late: x2 < x1 })
    }
  }
  const todayX = x(today())
  const undated = tasks.filter((t) => !span(t)).length

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex border border-input" role="group" aria-label="Échelle">
          {(['day', 'week', 'month'] as Scale[]).map((s) => (
            <button key={s} type="button" aria-pressed={scale === s} onClick={() => { setScale(s); centered.current = false }}
              className={clsx('px-3 py-1.5 text-[13px] font-bold', scale === s ? 'bg-foreground text-background' : 'bg-card hover:bg-muted')}>{SCALE_LABEL[s]}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, todayX - 160), behavior: 'smooth' })}>Aujourd'hui</Button>
        <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Legend className="bg-accent" label="En cours" />
          <Legend className="bg-late" label="En retard" />
          <Legend className="bg-won" label="Terminée" />
          {undated > 0 && <span>{undated} sans date</span>}
        </span>
      </div>

      {!rows.length ? <p className="text-sm text-muted-foreground">Aucune tâche dans ce projet.</p> : (
        <div ref={scroller} className="relative max-h-[75vh] overflow-auto [--gantt-left:150px] sm:[--gantt-left:260px] overscroll-x-contain border border-border bg-card">
          <div className="relative" style={{ width: `calc(var(--gantt-left) + ${width}px)` }}>
            {/* En-tête : reste en haut au défilement vertical */}
            <div className="sticky top-0 z-20 flex bg-head" style={{ height: HEAD_H }}>
              <div className="sticky left-0 z-10 flex w-[var(--gantt-left)] shrink-0 items-end border-b border-r border-input bg-head px-3 pb-1.5 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-muted-foreground">
                Tâche
              </div>
              <div className="relative shrink-0 border-b border-input" style={{ width }}>
                {top.map((m, i) => (
                  // `overflow: clip` (et non hidden) : le nom du mois reste collé au bord, lisible, quand le début du mois défile sous la colonne des tâches.
                  <div key={i} className="absolute top-0 h-[22px] whitespace-nowrap border-l border-input text-[11px] font-bold capitalize leading-[22px] [overflow:clip]"
                       style={{ left: m.x, width: m.w }}>
                    <span className="sticky inline-block px-1.5" style={{ left: 'var(--gantt-left)' }}>{m.label}</span>
                  </div>
                ))}
                {bottom.map((b, i) => (
                  <div key={i} className={clsx('absolute top-[22px] h-[22px] overflow-hidden border-l border-border text-center text-[10.5px] leading-[22px] text-muted-foreground',
                    b.weekend && 'bg-muted')} style={{ left: b.x, width: b.w }}>{b.w >= 16 ? b.label : ''}</div>
                ))}
              </div>
            </div>

            <div className="relative">
              {rows.map((r) => (
                <div key={r.kind === 'task' ? r.task.id : `s-${r.stage?.id ?? 'none'}`} className="flex" style={{ height: ROW_H }}>
                  <div className={clsx('sticky left-0 z-10 flex w-[var(--gantt-left)] shrink-0 items-center gap-2 border-b border-r border-border px-3',
                    r.kind === 'stage' ? 'bg-[#faf9f7]' : 'bg-card')}>
                    {r.kind === 'stage' ? (
                      <span className="truncate text-[12.5px] font-extrabold">{r.label}</span>
                    ) : (
                      <button type="button" onClick={() => openTask(r.task.id)} title={r.task.title}
                        className={clsx('flex min-w-0 items-center gap-1.5 pl-2 text-left text-[13px] hover:text-accent',
                          r.task.completed_at && 'text-muted-foreground line-through')}>
                        <span className="truncate">{r.task.title}</span>
                      </button>
                    )}
                  </div>
                  <div className={clsx('relative shrink-0 border-b border-[#f1eeeb]', r.kind === 'stage' && 'bg-[#faf9f7]')} style={{ width }}>
                    {r.kind === 'stage' ? <StageBar stage={r.stage} x={x} dayW={dayW} /> : (
                      <TaskBar task={r.task} span={shown(r.task)} x={x} dayW={dayW} dragging={drag?.id === r.task.id}
                        onDown={onPointerDown} onMove={onPointerMove} onUp={() => onPointerUp(r.task)} onCancel={() => setDrag(null)} onOpen={() => openTask(r.task.id)} />
                    )}
                  </div>
                </div>
              ))}

              {/* Calques : week-ends (échelle jour), dépendances, aujourd'hui */}
              <div className="pointer-events-none absolute inset-y-0 left-[var(--gantt-left)]" style={{ width }} aria-hidden="true">
                {scale === 'day' && bottom.filter((b) => b.weekend).map((b, i) => (
                  <div key={i} className="absolute inset-y-0 bg-foreground/[.025]" style={{ left: b.x, width: b.w }} />
                ))}
                <svg className="absolute inset-0 overflow-visible" width={width} height={rows.length * ROW_H}>
                  <defs>
                    <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" fill="#78716c" />
                    </marker>
                    <marker id="gantt-arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" fill="hsl(var(--late))" />
                    </marker>
                  </defs>
                  {arrows.map((a) => (
                    <path key={a.key} d={a.d} fill="none" stroke={a.late ? 'hsl(var(--late))' : '#78716c'} strokeWidth="1.3"
                      markerEnd={`url(#${a.late ? 'gantt-arrow-late' : 'gantt-arrow'})`} />
                  ))}
                </svg>
                {todayX >= 0 && todayX <= width && (
                  <div className="absolute inset-y-0 w-0 border-l-2 border-soon" style={{ left: todayX + dayW / 2 }}>
                    <span className="absolute -top-0 left-1 whitespace-nowrap bg-soon px-1 text-[10px] font-bold text-white">Aujourd'hui</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Glissez une barre pour décaler ses dates, tirez son bord droit pour changer l'échéance. Un clic ouvre la tâche.</p>
    </div>
  )
}

const Legend = ({ className, label }: { className: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className={clsx('h-2.5 w-4', className)} aria-hidden="true" />{label}</span>
)

function StageBar({ stage, x, dayW }: { stage: Stage | null; x: (d: string) => number; dayW: number }) {
  if (!stage) return null
  const end = stage.due_date ?? stage.start_date
  if (!end) return null
  const start = stage.start_date && stage.start_date <= end ? stage.start_date : end
  const left = x(start), w = x(addDays(end, 1)) - left
  const pct = stage.tasks_total ? stage.tasks_done / stage.tasks_total : 0
  return (
    <div className="absolute top-1/2 h-2 -translate-y-1/2 bg-foreground/25" style={{ left, width: Math.max(w, dayW) }}
         title={`${stage.name} : ${fmtDate(start)} → ${fmtDate(end)}`}>
      <div className="h-full bg-foreground/80" style={{ width: `${pct * 100}%` }} />
      <span className="absolute -bottom-1 left-0 h-3 w-[3px] bg-foreground" />
      <span className="absolute -bottom-1 right-0 h-3 w-[3px] bg-foreground" />
    </div>
  )
}

function TaskBar({ task: t, span: s, x, dayW, dragging, onDown, onMove, onUp, onCancel, onOpen }: {
  task: Task; span: [string, string] | null; x: (d: string) => number; dayW: number; dragging: boolean; onOpen: () => void
  onDown: (e: RPointerEvent, t: Task, mode: Drag['mode']) => void; onMove: (e: RPointerEvent) => void; onUp: () => void; onCancel: () => void
}) {
  if (!s) return <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] italic text-muted-foreground">sans date</span>
  const done = Boolean(t.completed_at)
  const tone = done ? 'bg-won' : isOverdue(t) ? 'bg-late' : 'bg-accent'
  const handlers = {
    onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onCancel,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } },
  }
  const label = `${t.title} : ${s[0] !== s[1] ? `${fmtDate(s[0])} → ` : ''}${fmtDate(s[1])}`
  if (t.is_milestone) {
    const cx = x(s[1]) + dayW / 2
    return (
      <div role="button" tabIndex={0} aria-label={`Jalon ${label}`} title={label} {...handlers}
        onPointerDown={(e) => onDown(e, t, 'move')}
        className={clsx('absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab touch-pan-y', done ? 'bg-won' : 'bg-foreground',
          dragging && 'cursor-grabbing ring-2 ring-accent-light')} style={{ left: cx }}>
      </div>
    )
  }
  const left = x(s[0]), w = Math.max(x(addDays(s[1], 1)) - left, 6)
  return (
    <>
      <div role="button" tabIndex={0} aria-label={label} title={label} {...handlers}
        onPointerDown={(e) => onDown(e, t, 'move')}
        className={clsx('group absolute top-[7px] h-5 cursor-grab touch-pan-y', tone, done && 'opacity-70', dragging && 'cursor-grabbing outline outline-2 outline-accent-light')}
        style={{ left, width: w }}>
        {t.blocked && !done && <span className="absolute inset-y-0 left-0 w-1 bg-soon" aria-hidden="true" />}
        <span role="presentation" onPointerDown={(e) => onDown(e, t, 'end')}
          className="absolute inset-y-0 -right-1 w-3 cursor-ew-resize after:absolute after:inset-y-1 after:right-1.5 after:w-0.5 after:bg-white/70 after:opacity-0 group-hover:after:opacity-100" />
      </div>
      {w < 120 && (
        <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-muted-foreground" style={{ left: left + w + 6 }}>
          {t.assignees.map((a) => a.name.split(' ')[0]).join(', ')}
        </span>
      )}
    </>
  )
}
