import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { intlLocale, useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { fmtMinutes, PRIORITY_LABEL } from '../../lib/format'
import { useApp } from '../../lib/store'
import type { ProjectDetail, Task } from '../../lib/types'
import { AvatarStack, Badge, Button, Confirm, ErrorNote, Input, Select, Spinner, toast } from '../ui'
import { DoneToggle, isOverdue, MilestoneMark, PRIORITY_RANK, QuickAdd, setTaskDone, useOpenTask, useProjectTasks } from './shared'

/** Liste des tâches groupées par étape : tri, filtres, sélection multiple et actions groupées. */

type SortKey = 'position' | 'number' | 'title' | 'due' | 'priority' | 'estimate' | 'spent'
type Status = 'open' | 'done' | 'all'

const SORTS: Record<SortKey, (a: Task, b: Task) => number> = {
  position: (a, b) => a.position - b.position || a.number - b.number,
  number: (a, b) => a.number - b.number,
  title: (a, b) => a.title.localeCompare(b.title, intlLocale()),
  due: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
  priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  estimate: (a, b) => (a.estimate_minutes ?? -1) - (b.estimate_minutes ?? -1),
  spent: (a, b) => a.minutes_spent - b.minutes_spent,
}

export default function ListView({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const t = useT()
  const { data, setData, error, loading, reload } = useProjectTasks(project.id)
  const { me, team } = useApp()
  const openTask = useOpenTask()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'position', dir: 1 })
  const [status, setStatus] = useState<Status>('open')
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)

  const tasks = useMemo(() => data ?? [], [data])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks.filter((t) => (status === 'all' || (status === 'open' ? !t.completed_at : t.completed_at))
      && (!mine || t.assignees.some((a) => a.id === me?.user.id))
      && (!needle || t.title.toLowerCase().includes(needle) || t.tags.some((g) => g.toLowerCase().includes(needle)) || String(t.number) === needle))
      .sort((a, b) => SORTS[sort.key](a, b) * sort.dir || a.number - b.number)
  }, [tasks, status, mine, q, sort, me?.user.id])

  const groups = useMemo(() => {
    const known = new Set(project.stages.map((s) => s.id))
    return [
      ...project.stages.map((s) => ({ id: s.id, name: s.name, stage: s, tasks: visible.filter((t) => t.stage_id === s.id) })),
      { id: '', name: t('tasks.field.noStage'), stage: null, tasks: visible.filter((t) => !t.stage_id || !known.has(t.stage_id)) },
    ].filter((g) => g.stage || g.tasks.length)
  }, [project.stages, visible, t])

  const changed = async () => { await reload(); onChanged() }
  const patch = async (t: Task, p: Partial<Task>) => {
    setData(tasks.map((x) => (x.id === t.id ? { ...x, ...p } : x)))
    try { await api.patch(`/tasks/${t.id}`, p) } catch (e) { toast(errorText(e)) }
    await changed()
  }
  const toggleDone = async (t: Task, v: boolean) => {
    setData(tasks.map((x) => (x.id === t.id ? { ...x, completed_at: v ? new Date().toISOString() : null } : x)))
    try { await setTaskDone(t.id, v) } catch (e) { toast(errorText(e)) }
    await changed()
  }
  const bulk = async (p: Record<string, unknown>, label: string) => {
    const ids = [...selected]
    try {
      await api.post('/tasks/bulk', { ids, patch: p })
      toast(t('tasks.list.bulkDone', { label, n: ids.length }))
      if (p.delete) setSelected(new Set())
    } catch (e) { toast(errorText(e)) }
    await changed()
  }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const header = (key: SortKey, label: string, className?: string) => (
    <th className={clsx('px-2 py-2 text-left', className)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-foreground"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? '↑' : '↓'}</span>}
      </button>
    </th>
  )

  if (loading && !data) return <Spinner />
  if (error) return <ErrorNote error={error} />

  const people = team.filter((m) => m.active)

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tasks.list.search')} aria-label={t('tasks.list.search')}
          className="w-full px-2 py-1.5 text-sm sm:w-56" />
        <Select aria-label={t('tasks.list.status')} value={status} onChange={(e) => setStatus(e.target.value as Status)} className="w-auto px-2 py-1.5 text-sm">
          <option value="open">{t('tasks.list.open')}</option>
          <option value="done">{t('tasks.list.done')}</option>
          <option value="all">{t('tasks.list.all')}</option>
        </Select>
        <Button size="sm" variant={mine ? 'primary' : 'outline'} aria-pressed={mine} onClick={() => setMine((v) => !v)}>{t('tasks.list.mine')}</Button>
        <span className="ml-auto text-xs text-muted-foreground">{t('tasks.list.count', { n: visible.length })}</span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border border-accent bg-accent-veil px-3 py-2 text-sm" role="toolbar" aria-label={t('tasks.list.bulkActions')}>
          <b>{t('tasks.list.selected', { n: selected.size })}</b>
          <Button size="sm" onClick={() => bulk({ completed: true }, t('tasks.list.bulkCompleted'))}>{t('tasks.drawer.complete')}</Button>
          <Select aria-label={t('tasks.list.bulkPriority')} value="" onChange={(e) => e.target.value && bulk({ priority: e.target.value }, t('tasks.list.priorityChanged'))}
            className="w-auto px-2 py-1 text-xs">
            <option value="">{t('tasks.list.priorityPick')}</option>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="inline-flex items-center gap-1 text-xs">
            {t('tasks.field.due')}
            <input type="date" className="border border-input bg-card px-2 py-1 text-xs" aria-label={t('tasks.list.bulkDue')}
              onChange={(e) => e.target.value && bulk({ due_date: e.target.value }, t('tasks.list.dueSet'))} />
          </label>
          <Select aria-label={t('tasks.list.bulkAssign')} value="" onChange={(e) => e.target.value && bulk({ add_assignee: e.target.value }, t('tasks.list.assigned'))}
            className="w-auto px-2 py-1 text-xs">
            <option value="">{t('tasks.list.assignTo')}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>{t('common.delete')}</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>{t('tasks.list.deselect')}</Button>
        </div>
      )}

      <div className="overflow-x-auto border border-border bg-card">
        <table className="w-full border-collapse text-sm max-sm:block sm:min-w-[980px]">
          <thead className="max-sm:hidden bg-head text-[10.5px] font-extrabold tracking-[.08em] text-muted-foreground">
            <tr className="border-b border-input">
              <th className="w-9 px-2 py-2"><span className="sr-only">{t('tasks.list.selection')}</span></th>
              <th className="w-8 px-1 py-2"><span className="sr-only">{t('tasks.drawer.doneLabel')}</span></th>
              {header('number', t('tasks.list.colNumber'), 'w-14')}
              {header('title', t('tasks.list.colTitle'))}
              <th className="w-28 px-2 py-2 text-left uppercase">{t('tasks.field.assignees')}</th>
              {header('due', t('tasks.field.due'), 'w-36')}
              {header('priority', t('tasks.field.priority'), 'w-28')}
              {header('estimate', t('tasks.list.colEstimate'), 'w-20')}
              {header('spent', t('tasks.list.colSpent'), 'w-20')}
              <th className="w-32 px-2 py-2 text-left uppercase">{t('tasks.field.column')}</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.id)
            const allSel = g.tasks.length > 0 && g.tasks.every((t) => selected.has(t.id))
            return (
              <tbody key={g.id || 'none'} className="max-sm:block">
                <tr className="border-b border-border bg-[#faf9f7] max-sm:flex max-sm:items-center">
                  <td className="px-2 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--accent))]" aria-label={t('tasks.list.selectGroup', { name: g.name })}
                      checked={allSel} disabled={!g.tasks.length}
                      onChange={() => setSelected((s) => { const n = new Set(s); g.tasks.forEach((t) => (allSel ? n.delete(t.id) : n.add(t.id))); return n })} />
                  </td>
                  <td colSpan={9} className="px-1 py-2">
                    <button type="button" aria-expanded={!isCollapsed} className="inline-flex items-center gap-2 text-[13px] font-extrabold"
                      onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n })}>
                      <span className={clsx('inline-block w-3 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} aria-hidden="true">›</span>
                      {g.name}
                      <span className="text-xs font-semibold text-muted-foreground">{g.tasks.length}</span>
                    </button>
                  </td>
                </tr>
                {!isCollapsed && g.tasks.map((t) => (
                  <Row key={t.id} task={t} selected={selected.has(t.id)} onSelect={() => toggle(t.id)} onOpen={() => openTask(t.id)}
                    onDone={(v) => toggleDone(t, v)} onPatch={(p) => patch(t, p)} />
                ))}
                {!isCollapsed && (
                  <tr className="border-b border-border max-sm:block">
                    <td className="max-sm:hidden" />
                    <td colSpan={9} className="px-1 py-1 max-sm:block">
                      <QuickAdd className="max-w-lg" onAdd={async (title) => {
                        await api.post('/tasks', { project_id: project.id, stage_id: g.id || null, title })
                        await changed()
                      }} />
                    </td>
                  </tr>
                )}
              </tbody>
            )
          })}
        </table>
      </div>

      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('tasks.list.deleteTitle')} confirmLabel={t('common.delete')} danger
        onConfirm={() => bulk({ delete: true }, t('tasks.list.deleted'))}>
        {t('tasks.list.deleteBody', { n: selected.size })}
      </Confirm>
    </div>
  )
}

function Row({ task, selected, onSelect, onOpen, onDone, onPatch }:
  { task: Task; selected: boolean; onSelect: () => void; onOpen: () => void; onDone: (v: boolean) => void; onPatch: (p: Partial<Task>) => void }) {
  const t = useT()
  const done = Boolean(task.completed_at)
  const late = isOverdue(task)
  return (
    <tr className={clsx('border-b border-[#eeebe7] hover:bg-accent-veil max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:pb-1', selected && 'bg-accent-veil')}>
      <td className="px-2 py-1.5">
        <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--accent))]" checked={selected} onChange={onSelect} aria-label={t('tasks.list.selectTask', { title: task.title })} />
      </td>
      <td className="px-1 py-1.5"><DoneToggle done={done} onChange={onDone} label={t('tasks.list.doneTask', { title: task.title })} /></td>
      <td className="px-2 py-1.5 text-xs text-muted-foreground max-sm:hidden">{task.number}</td>
      <td className="px-2 py-1.5 max-sm:min-w-0 max-sm:grow max-sm:basis-[calc(100%-4.5rem)] sm:max-w-0">
        <button type="button" onClick={onOpen} className="flex w-full min-w-0 items-center gap-2 text-left hover:text-accent">
          {task.is_milestone && <MilestoneMark />}
          <span className={clsx('truncate font-semibold max-sm:whitespace-normal', done && 'text-muted-foreground line-through')}>{task.title}</span>
          {task.blocked && !done && <Badge tone="warn">{t('tasks.drawer.blocked')}</Badge>}
          {task.subtasks_total > 0 && <span className="shrink-0 text-xs text-muted-foreground">{task.subtasks_done}/{task.subtasks_total}</span>}
        </button>
      </td>
      <td className="px-2 py-1.5 max-sm:ml-[3.75rem] max-sm:px-0">{task.assignees.length ? <AvatarStack people={task.assignees} size={22} max={3} /> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-2 py-1 max-sm:w-40">
        <input type="date" value={task.due_date ?? ''} aria-label={t('tasks.list.dueOf', { title: task.title })} onChange={(e) => onPatch({ due_date: e.target.value || null })}
          className={clsx('w-full border border-transparent bg-transparent px-1 py-0.5 text-[13px] hover:border-input focus:border-accent focus:outline-none',
            late ? 'font-bold text-late' : !task.due_date && 'text-muted-foreground')} />
      </td>
      <td className="px-2 py-1 max-sm:w-28">
        <select value={task.priority} aria-label={t('tasks.list.priorityOf', { title: task.title })} onChange={(e) => onPatch({ priority: e.target.value as Task['priority'] })}
          className={clsx('w-full border border-transparent bg-transparent px-1 py-0.5 text-[13px] hover:border-input focus:border-accent focus:outline-none',
            task.priority === 'urgent' && 'font-bold text-late', task.priority === 'high' && 'font-bold text-soon', task.priority === 'low' && 'text-muted-foreground')}>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 text-[13px] text-muted-foreground max-sm:hidden">{task.estimate_minutes ? fmtMinutes(task.estimate_minutes) : '—'}</td>
      <td className={clsx('px-2 py-1.5 text-[13px] max-sm:hidden', task.estimate_minutes && task.minutes_spent > task.estimate_minutes ? 'font-bold text-late' : 'text-muted-foreground')}>
        {task.minutes_spent ? fmtMinutes(task.minutes_spent) : '—'}
      </td>
      <td className="truncate px-2 py-1.5 text-[13px] max-sm:hidden">{task.column_name ?? '—'}</td>
    </tr>
  )
}
