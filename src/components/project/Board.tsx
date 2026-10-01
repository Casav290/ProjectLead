import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { api, errorText } from '../../lib/api'
import { useApp } from '../../lib/store'
import type { Column, ProjectDetail, Task } from '../../lib/types'
import { AvatarStack, Badge, ErrorNote, PriorityBadge, Select, Spinner, toast } from '../ui'
import { DueLabel, MilestoneMark, positionBetween, QuickAdd, TaskCounters, useOpenTask, useProjectTasks } from './shared'

/** Tableau kanban : une colonne par état, glisser-déposer, couloirs facultatifs par étape ou par personne. */

type LaneMode = 'none' | 'stage' | 'person'
type Lane = { key: string; label: string; color?: string }

const NONE = '_'
/** Un conteneur = une colonne dans un couloir ; une carte = une tâche dans un conteneur (une tâche peut avoir deux personnes). */
const containerId = (col: string, lane: string) => `${lane}|${col}`
const cardId = (container: string, task: string) => `${container}|${task}`
const parseCard = (id: string) => { const [lane, col, task] = id.split('|'); return { lane, col, task, container: `${lane}|${col}` } }
const parseContainer = (id: string) => { const [lane, col] = id.split('|'); return { lane, col } }

const LANE_KEY = 'pl:board-lanes'

export default function Board({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const { data, setData, error, loading, reload } = useProjectTasks(project.id)
  const { team } = useApp()
  const openTask = useOpenTask()
  const [laneMode, setLaneMode] = useState<LaneMode>(() => {
    try { return (localStorage.getItem(LANE_KEY) as LaneMode) || 'none' } catch { return 'none' }
  })
  useEffect(() => { try { localStorage.setItem(LANE_KEY, laneMode) } catch { /* navigation privée */ } }, [laneMode])

  const tasks = useMemo(() => data ?? [], [data])
  const columns = project.columns
  const lanes = useMemo<Lane[]>(() => {
    if (laneMode === 'stage') return [...project.stages.map((s) => ({ key: s.id, label: s.name })), { key: NONE, label: 'Sans étape' }]
    if (laneMode === 'person') {
      const ids = new Set(tasks.flatMap((t) => t.assignees.map((a) => a.id)))
      const people = [...project.members_detail, ...team].filter((p, i, all) => ids.has(p.id) && all.findIndex((x) => x.id === p.id) === i)
      return [...people.sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ key: p.id, label: p.name, color: p.color })),
        { key: NONE, label: 'Non assignées' }]
    }
    return [{ key: NONE, label: '' }]
  }, [laneMode, project.stages, project.members_detail, team, tasks])

  const laneOf = (t: Task): string[] => {
    if (laneMode === 'stage') return [t.stage_id && project.stages.some((s) => s.id === t.stage_id) ? t.stage_id : NONE]
    if (laneMode === 'person') return t.assignees.length ? t.assignees.map((a) => a.id) : [NONE]
    return [NONE]
  }

  // Les cartes de chaque conteneur, dans l'ordre ; gardées localement pendant un glisser.
  const computed = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const l of lanes) for (const c of columns) map[containerId(c.id, l.key)] = []
    const firstCol = columns[0]?.id
    for (const t of [...tasks].sort((a, b) => a.position - b.position || a.number - b.number)) {
      const col = t.column_id && columns.some((c) => c.id === t.column_id) ? t.column_id : firstCol
      if (!col) continue
      for (const l of laneOf(t)) map[containerId(col, l)]?.push(cardId(containerId(col, l), t.id))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, lanes, columns])
  const [items, setItems] = useState(computed)
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => { if (!active) setItems(computed) }, [computed, active])

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Au doigt : un appui maintenu lance le glisser, un geste rapide fait défiler.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findContainer = (id: string) => (id in items ? id : Object.keys(items).find((k) => items[k].includes(id)))

  const onDragStart = (e: DragStartEvent) => setActive(String(e.active.id))

  /** Pendant le glisser, la carte change de conteneur : les autres s'écartent. */
  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over) return
    const from = findContainer(String(a.id)), to = findContainer(String(over.id))
    if (!from || !to || from === to) return
    setItems((prev) => {
      const src = prev[from].filter((x) => x !== a.id)
      const dst = [...prev[to]]
      const newId = cardId(to, parseCard(String(a.id)).task)
      if (dst.includes(newId)) return prev // la tâche est déjà dans ce couloir (autre personne)
      const overIndex = dst.indexOf(String(over.id))
      dst.splice(overIndex < 0 ? dst.length : overIndex, 0, String(a.id))
      return { ...prev, [from]: src, [to]: dst }
    })
  }

  const onDragEnd = async ({ active: a, over }: DragEndEvent) => {
    setActive(null)
    const id = String(a.id)
    const to = over ? findContainer(String(over.id)) : undefined
    if (!to) { setItems(computed); return }
    let list = items[to]
    const oldIndex = list.indexOf(id), overIndex = list.indexOf(String(over!.id))
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) list = arrayMove(list, oldIndex, overIndex)
    const index = list.indexOf(id)
    if (index < 0) { setItems(computed); return }
    setItems((prev) => ({ ...prev, [to]: list }))

    const task = byId.get(parseCard(id).task)!
    const origin = parseCard(id)
    const target = parseContainer(to)
    const neighbour = (i: number) => (list[i] ? byId.get(parseCard(list[i]).task)?.position : undefined)
    const position = positionBetween(neighbour(index - 1), neighbour(index + 1))
    if (origin.container === to && list.join() === computed[to].join()) return

    const patch: Record<string, unknown> = { position }
    if (target.col !== task.column_id) patch.column_id = target.col
    if (origin.lane !== target.lane) {
      if (laneMode === 'stage') patch.stage_id = target.lane === NONE ? null : target.lane
      if (laneMode === 'person') {
        const ids = task.assignees.map((x) => x.id).filter((x) => x !== origin.lane)
        patch.assignee_ids = target.lane === NONE ? [] : [...new Set([...ids, target.lane])]
      }
    }
    setData(tasks.map((t) => t.id === task.id ? { ...t, position, column_id: target.col } : t))
    try { await api.patch(`/tasks/${task.id}`, patch) } catch (e) { toast(errorText(e)) }
    await reload()
    onChanged()
  }

  const add = async (col: Column, lane: string, title: string) => {
    const body: Record<string, unknown> = { project_id: project.id, column_id: col.id, title }
    if (laneMode === 'stage' && lane !== NONE) body.stage_id = lane
    if (laneMode === 'person' && lane !== NONE) body.assignee_ids = [lane]
    await api.post('/tasks', body)
    await reload()
    onChanged()
  }

  if (loading && !data) return <Spinner />
  if (error) return <ErrorNote error={error} />
  if (!columns.length) return <p className="text-sm text-muted-foreground">Ce projet n'a pas encore de colonnes.</p>

  const activeTask = active ? byId.get(parseCard(active).task) : undefined
  const openCount = (colId: string) => tasks.filter((t) => t.column_id === colId && !t.completed_at).length

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="board-lanes" className="text-xs font-medium text-muted-foreground">Couloirs</label>
        <Select id="board-lanes" value={laneMode} onChange={(e) => setLaneMode(e.target.value as LaneMode)} className="w-auto px-2 py-1.5 text-sm">
          <option value="none">Aucun</option>
          <option value="stage">Par étape</option>
          <option value="person">Par personne</option>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">{tasks.length} tâche{tasks.length > 1 ? 's' : ''}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
        onDragCancel={() => { setActive(null); setItems(computed) }}>
        <div className="board-scroll -mx-4 px-4 pb-3 sm:mx-0 sm:px-0">
          <div className="inline-flex min-w-full flex-col gap-4">
            {/* En-têtes de colonnes, communs à tous les couloirs */}
            <div className="flex gap-3">
              {columns.map((c) => {
                const n = openCount(c.id)
                const over = c.wip_limit != null && n > c.wip_limit
                return (
                  <div key={c.id} className={clsx('flex w-[272px] shrink-0 items-center gap-2 border-b-2 px-1 pb-1.5',
                    over ? 'border-late' : c.is_done ? 'border-won' : 'border-foreground')}>
                    <h3 className="min-w-0 flex-1 truncate text-[13px] font-extrabold uppercase tracking-[.05em]">{c.name}</h3>
                    <span className={clsx('text-xs font-bold', over ? 'text-late' : 'text-muted-foreground')}
                      title={c.wip_limit != null ? `Limite d'en-cours : ${c.wip_limit}` : undefined}>
                      {c.is_done ? tasks.filter((t) => t.column_id === c.id).length : n}{c.wip_limit != null && ` / ${c.wip_limit}`}
                    </span>
                    {over && <Badge tone="late">Limite dépassée</Badge>}
                  </div>
                )
              })}
            </div>
            {lanes.map((l) => (
              <div key={l.key}>
                {laneMode !== 'none' && (
                  <div className="sticky left-0 mb-2 flex w-max items-center gap-2 text-sm font-bold">
                    {l.color && <span className="h-2.5 w-2.5" style={{ background: l.color }} aria-hidden="true" />}
                    {l.label}
                    <span className="text-xs font-semibold text-muted-foreground">
                      {columns.reduce((s, c) => s + (items[containerId(c.id, l.key)]?.length ?? 0), 0)}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  {columns.map((c) => (
                    <BoardColumn key={c.id} id={containerId(c.id, l.key)} ids={items[containerId(c.id, l.key)] ?? []} byId={byId}
                      onOpen={openTask} onAdd={(title) => add(c, l.key, title)} tall={laneMode === 'none'} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{activeTask ? <Card task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

function BoardColumn({ id, ids, byId, onOpen, onAdd, tall }:
  { id: string; ids: string[]; byId: Map<string, Task>; onOpen: (id: string) => void; onAdd: (title: string) => Promise<void>; tall: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div className={clsx('flex w-[272px] shrink-0 flex-col border border-border bg-[#f5f3f1] p-1.5', isOver && 'border-accent')}>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={clsx('flex flex-col gap-1.5', tall ? 'min-h-[120px]' : 'min-h-[44px]')}>
          {ids.map((cid) => {
            const t = byId.get(parseCard(cid).task)
            return t ? <SortableCard key={cid} id={cid} task={t} onOpen={onOpen} /> : null
          })}
        </div>
      </SortableContext>
      <QuickAdd label="Ajouter une carte" onAdd={onAdd} className="mt-1" />
    </div>
  )
}

function SortableCard({ id, task, onOpen }: { id: string; task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}
      aria-roledescription="carte déplaçable" aria-label={task.title}
      onClick={() => onOpen(task.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(task.id); else listeners?.onKeyDown?.(e) }}
      className={clsx('touch-manipulation', isDragging && 'opacity-30')}>
      <Card task={task} />
    </div>
  )
}

function Card({ task: t, overlay }: { task: Task; overlay?: boolean }) {
  const done = Boolean(t.completed_at)
  return (
    <article className={clsx('cursor-grab select-none border bg-card px-2.5 py-2 text-left hover:border-accent',
      overlay ? 'rotate-1 cursor-grabbing border-accent' : 'border-border', t.blocked && !done && 'stripe-today')}>
      <div className="flex items-start gap-1.5">
        {t.is_milestone && <MilestoneMark className="mt-1.5" />}
        <p className={clsx('clamp-2 min-w-0 flex-1 text-[13.5px] font-semibold leading-snug [overflow-wrap:anywhere]', done && 'text-muted-foreground line-through')}>
          {t.title}
        </p>
      </div>
      {(t.priority !== 'normal' || t.blocked || t.tags.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <PriorityBadge priority={t.priority} />
          {t.blocked && !done && <Badge tone="warn">Bloquée</Badge>}
          {t.tags.slice(0, 3).map((tag) => <span key={tag} className="bg-muted px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">{tag}</span>)}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <DueLabel task={t} />
        <TaskCounters task={t} />
        <span className="ml-auto">{t.assignees.length > 0 && <AvatarStack people={t.assignees} size={20} max={3} />}</span>
      </div>
    </article>
  )
}
