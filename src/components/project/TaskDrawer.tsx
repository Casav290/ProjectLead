import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { intlLocale, labels, t, useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { fmtDate, fmtDateTime, fmtMinutes, fmtRelative, parseDuration, PRIORITY_LABEL, today } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { ProjectDetail, Task, TaskDetail } from '../../lib/types'
import { Avatar, Badge, Button, Checkbox, Confirm, Drawer, ErrorNote, Field, Input, PeoplePicker, Progress, Select, Spinner, Textarea, toast } from '../ui'
import { DoneToggle, DueLabel, isOverdue, MilestoneMark } from './shared'

/** La fiche d'une tâche : tout se modifie sur place, chaque changement part aussitôt. */

const RECURRENCE_LABEL = labels('tasks.recurrence', ['none', 'daily', 'weekly', 'monthly'])

const ACTIVITY: Record<string, (d: any) => string> = {
  task_created: () => t('tasks.activity.created'),
  task_completed: () => t('tasks.activity.completed'),
  task_reopened: () => t('tasks.activity.reopened'),
  task_moved: (d) => t('tasks.activity.moved', { column: d?.column ?? '?' }),
  task_due: (d) => d?.due_date ? t('tasks.activity.dueSet', { date: fmtDate(d.due_date) }) : t('tasks.activity.dueCleared'),
  file_added: (d) => t('tasks.activity.fileAdded', { name: d?.filename ?? t('tasks.activity.aFile') }),
  time_logged: (d) => t('tasks.activity.timeLogged', { duration: fmtMinutes(d?.minutes) }),
}

const fmtSize = (n: number) => n < 1024 ? t('tasks.files.sizeB', { n }) : n < 1024 ** 2 ? t('tasks.files.sizeKB', { n: Math.round(n / 1024) })
  : t('tasks.files.sizeMB', { n: (n / 1024 ** 2).toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })

export default function TaskDrawer({ taskId, onClose, onChanged }: { taskId: string | null; onClose: () => void; onChanged?: () => void }) {
  const t = useT()
  // On peut descendre dans une sous-tâche sans quitter le panneau.
  const [currentId, setCurrentId] = useState(taskId)
  useEffect(() => setCurrentId(taskId), [taskId])
  const { data: task, setData, error, reload } = useLoad<TaskDetail>(currentId ? `/tasks/${currentId}` : null)
  const shown = task && task.id === currentId ? task : null

  return (
    <Drawer open={Boolean(taskId)} onClose={onClose} title={shown?.title ?? t('tasks.drawer.task')}>
      {!shown ? (
        <div className="flex h-full flex-col">
          <div className="flex justify-end border-b border-border px-3 py-2"><CloseButton onClose={onClose} /></div>
          {error ? <div className="p-5"><ErrorNote error={error} /></div> : <Spinner />}
        </div>
      ) : (
        <TaskBody key={shown.id} task={shown} setTask={setData as (t: TaskDetail) => void} reload={reload} onClose={onClose}
          onChanged={() => onChanged?.()} openTask={setCurrentId} />
      )}
    </Drawer>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const t = useT()
  return <button type="button" onClick={onClose} aria-label={t('tasks.drawer.closeTask')} className="px-2 text-xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-extrabold uppercase tracking-[.08em] text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function TaskBody({ task, setTask, reload, onClose, onChanged, openTask }:
  { task: TaskDetail; setTask: (t: TaskDetail) => void; reload: () => Promise<void>; onClose: () => void; onChanged: () => void; openTask: (id: string) => void }) {
  const t = useT()
  const { me, team, refresh } = useApp()
  const { data: project } = useLoad<ProjectDetail>(`/projects/${task.project_id}`, [task.project_id])
  const { data: siblings } = useLoad<Task[]>(`/tasks?project=${task.project_id}`, [task.project_id])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [estimate, setEstimate] = useState(task.estimate_minutes ? fmtMinutes(task.estimate_minutes) : '')
  useEffect(() => { setTitle(task.title); setDescription(task.description) }, [task.title, task.description])
  useEffect(() => setEstimate(task.estimate_minutes ? fmtMinutes(task.estimate_minutes) : ''), [task.estimate_minutes])

  /** Écrit, recharge, prévient la vue appelante. L'affichage change avant la réponse. */
  const run = async (fn: () => Promise<unknown>, optimistic?: Partial<TaskDetail>) => {
    if (optimistic) setTask({ ...task, ...optimistic })
    try { await fn() } catch (e) { toast(errorText(e)) }
    await reload()
    onChanged()
  }
  const save = (patch: Record<string, unknown>, shown?: Partial<TaskDetail>) =>
    run(() => api.patch(`/tasks/${task.id}`, patch), { ...(patch as Partial<TaskDetail>), ...shown })

  const people = useMemo(() => {
    const active = team.filter((m) => m.active)
    const extra = task.assignees.filter((a) => !active.some((m) => m.id === a.id))
    return [...active, ...extra]
  }, [team, task.assignees])

  const done = Boolean(task.completed_at)
  const running = me?.running?.task_id === task.id

  const remove = async () => {
    try {
      await api.del(`/tasks/${task.id}`)
      toast(t('tasks.drawer.deleted'))
      onChanged()
      if (task.parent_id) openTask(task.parent_id); else onClose()
    } catch (e) { toast(errorText(e)) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
        <Button size="sm" variant={done ? 'outline' : 'primary'} onClick={() => save({ completed: !done }, { completed_at: done ? null : new Date().toISOString() })}>
          {done ? t('tasks.drawer.reopen') : t('tasks.drawer.complete')}
        </Button>
        <span className="truncate text-xs font-bold text-muted-foreground">{task.project_code ? `${task.project_code}-` : '#'}{task.number}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="text-late" onClick={() => setConfirmDelete(true)}>{t('common.delete')}</Button>
        <CloseButton onClose={onClose} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pb-4 pt-4">
          {task.parent_id && (
            <button type="button" className="mb-2 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => openTask(task.parent_id!)}>
              {t('tasks.drawer.parent')}
            </button>
          )}
          <div className="flex items-start gap-3">
            <span className="mt-2.5"><DoneToggle done={done} label={t('tasks.drawer.doneLabel')} onChange={(v) => save({ completed: v }, { completed_at: v ? new Date().toISOString() : null })} size={20} /></span>
            <Textarea aria-label={t('tasks.drawer.titleLabel')} rows={1} value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
              onBlur={() => { const v = title.trim(); if (v && v !== task.title) save({ title: v }); else setTitle(task.title) }}
              className={clsx('resize-none border-transparent px-1 py-1 font-display !text-xl hover:border-input [field-sizing:content]', done && 'text-muted-foreground line-through')} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
            {task.blocked && <Badge tone="warn">{t('tasks.drawer.blocked')}</Badge>}
            {task.is_milestone && <span className="inline-flex items-center gap-1.5 text-xs font-bold"><MilestoneMark /> {t('tasks.drawer.milestone')}</span>}
            {isOverdue(task) && <Badge tone="late">{t('tasks.drawer.overdue')}</Badge>}
            {done && <Badge tone="ok">{t('tasks.drawer.doneOn', { date: fmtDate(task.completed_at) })}</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-border px-5 py-4 sm:grid-cols-2">
          <Field label={t('tasks.field.project')}>
            <Link to={`/projets/${task.project_id}`} className="flex items-center gap-2 py-2 text-sm font-semibold hover:text-accent">
              <span className="h-2.5 w-2.5 shrink-0" style={{ background: task.project_color }} aria-hidden="true" />
              <span className="truncate">{task.project_name}</span>
            </Link>
          </Field>
          <Field label={t('tasks.field.stage')}>
            <Select value={task.stage_id ?? ''} onChange={(e) => save({ stage_id: e.target.value || null })}>
              <option value="">{t('tasks.field.noStage')}</option>
              {project?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label={t('tasks.field.column')}>
            <Select value={task.column_id ?? ''} onChange={(e) => e.target.value && save({ column_id: e.target.value })}>
              {!task.column_id && <option value="">—</option>}
              {project?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('tasks.field.priority')}>
            <Select value={task.priority} onChange={(e) => save({ priority: e.target.value })}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <div className="space-y-1.5 sm:col-span-2">
            <span className="block text-xs font-medium text-muted-foreground">{t('tasks.field.assignees')}</span>
            <PeoplePicker people={people} value={task.assignees.map((a) => a.id)} placeholder={t('tasks.field.assign')}
              onChange={(ids) => save({ assignee_ids: ids }, { assignees: people.filter((p) => ids.includes(p.id)) })} />
          </div>
          <Field label={t('tasks.field.start')}>
            <Input type="date" value={task.start_date ?? ''} max={task.due_date ?? undefined} onChange={(e) => save({ start_date: e.target.value || null })} />
          </Field>
          <Field label={t('tasks.field.due')}>
            <Input type="date" value={task.due_date ?? ''} min={task.start_date ?? undefined} onChange={(e) => save({ due_date: e.target.value || null })} />
          </Field>
          <Field label={t('tasks.field.estimate')} hint={t('tasks.field.estimateHint')}>
            <Input value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="—"
              onBlur={() => {
                const m = estimate.trim() ? parseDuration(estimate) : null
                if (estimate.trim() && m === null) { toast(t('tasks.durationUnknown')); setEstimate(task.estimate_minutes ? fmtMinutes(task.estimate_minutes) : ''); return }
                if (m !== task.estimate_minutes) save({ estimate_minutes: m })
              }} />
          </Field>
          <Field label={t('tasks.field.recurrence')} hint={task.recurrence !== 'none' ? t('tasks.field.recurrenceHint') : undefined}>
            <Select value={task.recurrence} onChange={(e) => save({ recurrence: e.target.value })}>
              {Object.entries(RECURRENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-x-5 gap-y-2 sm:col-span-2">
            <Checkbox label={t('tasks.drawer.milestone')} checked={task.is_milestone} onChange={(v) => save({ is_milestone: v })} />
            <Checkbox label={t('tasks.field.visibleToClient')} checked={task.visible_to_client} onChange={(v) => save({ visible_to_client: v })} />
          </div>
          <div className="sm:col-span-2"><Tags tags={task.tags} onChange={(tags) => save({ tags })} /></div>
        </div>

        <Section title={t('tasks.section.description')}>
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('tasks.drawer.descriptionPlaceholder')}
            aria-label={t('tasks.section.description')} onBlur={() => description !== task.description && save({ description })} />
        </Section>

        <Checklist t={task} run={run} />
        <Subtasks t={task} run={run} openTask={openTask} />
        <Dependencies t={task} siblings={siblings ?? []} run={run} />
        <TimeSection t={task} run={run} running={running} refreshMe={refresh} />
        <Files t={task} run={run} />
        <Comments t={task} run={run} meId={me?.user.id} />
        <Section title={t('tasks.section.history')}>
          {task.activity.length ? (
            <ol className="space-y-1.5 text-[13px]">
              {task.activity.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="min-w-0 flex-1"><b className="font-semibold">{a.actor_name ?? t('tasks.drawer.automation')}</b> {(ACTIVITY[a.kind] ?? (() => a.kind))(a.data)}</span>
                  <time className="shrink-0 text-xs text-muted-foreground" title={fmtDateTime(a.created_at)}>{fmtRelative(a.created_at)}</time>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">{t('tasks.drawer.nothingYet')}</p>}
        </Section>
      </div>

      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} title={t('tasks.drawer.deleteTitle')} confirmLabel={t('common.delete')} danger>
        {task.subtasks.length ? t('tasks.drawer.deleteBodySubs', { title: task.title, n: task.subtasks.length }) : t('tasks.drawer.deleteBody', { title: task.title })}
      </Confirm>
    </div>
  )
}

type Run = (fn: () => Promise<unknown>, optimistic?: Partial<TaskDetail>) => Promise<void>

function Tags({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const t = useT()
  const [v, setV] = useState('')
  const add = () => {
    const x = v.trim().replace(/,$/, '')
    if (x && !tags.includes(x)) onChange([...tags, x])
    setV('')
  }
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">{t('tasks.tags.label')}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 text-xs font-semibold">
            {tag}
            <button type="button" aria-label={t('tasks.tags.remove', { tag })} className="text-muted-foreground hover:text-late" onClick={() => onChange(tags.filter((x) => x !== tag))}>×</button>
          </span>
        ))}
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={t('tasks.tags.placeholder')} aria-label={t('tasks.tags.add')} maxLength={40}
          className="w-28 border border-dashed border-input bg-card px-2 py-0.5 text-xs focus:border-accent focus:outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} onBlur={add} />
      </div>
    </div>
  )
}

/** Un champ d'ajout sur une ligne. */
function AddLine({ placeholder, onAdd, label }: { placeholder: string; onAdd: (v: string) => Promise<unknown>; label: string }) {
  const t = useT()
  const [v, setV] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!v.trim()) return
    await onAdd(v.trim())
    setV('')
  }
  return (
    <form onSubmit={submit} className="mt-2 flex gap-1.5">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} className="px-2 py-1.5 text-sm" />
      <Button type="submit" size="sm" disabled={!v.trim()}>{t('common.add')}</Button>
    </form>
  )
}

function Checklist({ t: task, run }: { t: TaskDetail; run: Run }) {
  const t = useT()
  const doneCount = task.checklist.filter((c) => c.done).length
  return (
    <Section title={t('tasks.section.checklist')} aside={task.checklist.length ? <span className="text-xs text-muted-foreground">{doneCount}/{task.checklist.length}</span> : null}>
      {task.checklist.length > 0 && <Progress label={t('tasks.section.checklist')} value={(doneCount / task.checklist.length) * 100} tone={doneCount === task.checklist.length ? 'ok' : 'accent'} className="mb-2" />}
      <ul className="space-y-0.5">
        {task.checklist.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 py-0.5">
            <Checkbox className="min-w-0 flex-1" checked={c.done} label={<span className={clsx(c.done && 'text-muted-foreground line-through')}>{c.label}</span>}
              onChange={(v) => run(() => api.patch(`/tasks/checklist/${c.id}`, { done: v }), { checklist: task.checklist.map((x) => x.id === c.id ? { ...x, done: v } : x) })} />
            <button type="button" aria-label={t('tasks.checklist.deleteItem', { label: c.label })} className="px-1 text-muted-foreground opacity-60 hover:text-late group-hover:opacity-100"
              onClick={() => run(() => api.del(`/tasks/checklist/${c.id}`), { checklist: task.checklist.filter((x) => x.id !== c.id) })}>×</button>
          </li>
        ))}
      </ul>
      <AddLine placeholder={t('tasks.checklist.newItem')} label={t('tasks.checklist.newItemLabel')} onAdd={(label) => run(() => api.post(`/tasks/${task.id}/checklist`, { label }))} />
    </Section>
  )
}

function Subtasks({ t: task, run, openTask }: { t: TaskDetail; run: Run; openTask: (id: string) => void }) {
  const t = useT()
  const doneCount = task.subtasks.filter((s) => s.completed_at).length
  return (
    <Section title={t('tasks.section.subtasks')} aside={task.subtasks.length ? <span className="text-xs text-muted-foreground">{doneCount}/{task.subtasks.length}</span> : null}>
      <ul className="divide-y divide-border border-y border-border empty:hidden">
        {task.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-1.5">
            <DoneToggle done={Boolean(s.completed_at)} label={t('tasks.subtasks.complete', { title: s.title })}
              onChange={(v) => run(() => api.patch(`/tasks/${s.id}`, { completed: v }),
                { subtasks: task.subtasks.map((x) => x.id === s.id ? { ...x, completed_at: v ? new Date().toISOString() : null } : x) })} />
            <button type="button" onClick={() => openTask(s.id)}
              className={clsx('min-w-0 flex-1 truncate text-left text-sm hover:text-accent', s.completed_at && 'text-muted-foreground line-through')}>{s.title}</button>
            <DueLabel task={s} className="text-xs" />
            {s.assignees.slice(0, 2).map((a) => <Avatar key={a.id} person={a} size={20} />)}
          </li>
        ))}
      </ul>
      <AddLine placeholder={t('tasks.subtasks.new')} label={t('tasks.subtasks.new')}
        onAdd={(title) => run(() => api.post('/tasks', { project_id: task.project_id, parent_id: task.id, stage_id: task.stage_id, title }))} />
    </Section>
  )
}

function Dependencies({ t: task, siblings, run }: { t: TaskDetail; siblings: Task[]; run: Run }) {
  const t = useT()
  const [mode, setMode] = useState<'waits' | 'blocks'>('waits')
  const linked = new Set([task.id, ...task.dependencies.map((d) => d.id), ...task.blocking.map((d) => d.id)])
  const candidates = siblings.filter((s) => !linked.has(s.id))
  const add = (other: string) => run(() => mode === 'waits'
    ? api.post(`/tasks/${task.id}/dependencies`, { depends_on_id: other })
    : api.post(`/tasks/${other}/dependencies`, { depends_on_id: task.id }))
  const Row = ({ d, onRemove }: { d: TaskDetail['dependencies'][number]; onRemove: () => void }) => (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span className={clsx('h-2 w-2 shrink-0', d.completed_at ? 'bg-won' : 'bg-soon')} aria-hidden="true" />
      <span className="shrink-0 text-xs text-muted-foreground">#{d.number}</span>
      <span className={clsx('min-w-0 flex-1 truncate', d.completed_at && 'text-muted-foreground line-through')}>{d.title}</span>
      <span className="sr-only">{d.completed_at ? t('tasks.deps.done') : t('tasks.deps.open')}</span>
      <button type="button" aria-label={t('tasks.deps.remove', { title: d.title })} className="px-1 text-muted-foreground hover:text-late" onClick={onRemove}>×</button>
    </li>
  )
  return (
    <Section title={t('tasks.section.dependencies')} aside={task.blocked ? <Badge tone="warn">{t('tasks.drawer.blocked')}</Badge> : null}>
      {task.dependencies.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-bold text-muted-foreground">{t('tasks.deps.waits')}</p>
          <ul>{task.dependencies.map((d) => <Row key={d.id} d={d} onRemove={() => run(() => api.del(`/tasks/${task.id}/dependencies/${d.id}`))} />)}</ul>
        </div>
      )}
      {task.blocking.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-bold text-muted-foreground">{t('tasks.deps.blocks')}</p>
          <ul>{task.blocking.map((d) => <Row key={d.id} d={d} onRemove={() => run(() => api.del(`/tasks/${d.id}/dependencies/${task.id}`))} />)}</ul>
        </div>
      )}
      <div className="flex gap-1.5">
        <Select aria-label={t('tasks.deps.direction')} value={mode} onChange={(e) => setMode(e.target.value as 'waits')} className="w-auto px-2 py-1.5 text-sm">
          <option value="waits">{t('tasks.deps.waits')}</option>
          <option value="blocks">{t('tasks.deps.blocks')}</option>
        </Select>
        <Select aria-label={t('tasks.deps.linked')} value="" onChange={(e) => e.target.value && add(e.target.value)} className="min-w-0 flex-1 px-2 py-1.5 text-sm">
          <option value="">{candidates.length ? t('tasks.deps.choose') : t('tasks.deps.none')}</option>
          {candidates.map((s) => <option key={s.id} value={s.id}>#{s.number} {s.title}</option>)}
        </Select>
      </div>
    </Section>
  )
}

function TimeSection({ t: task, run, running, refreshMe }: { t: TaskDetail; run: Run; running: boolean; refreshMe: () => Promise<void> }) {
  const t = useT()
  const [minutes, setMinutes] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const total = task.time.reduce((s, e) => s + (e.minutes ?? 0), 0)
  const timer = async () => {
    try {
      if (running) { await api.post('/time/timer/stop'); toast(t('tasks.time.stopped')) }
      else { await api.post('/time/timer/start', { project_id: task.project_id, task_id: task.id }); toast(t('tasks.time.started')) }
      await refreshMe()
      await run(async () => {})
    } catch (e) { toast(errorText(e)) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const m = parseDuration(minutes)
    if (!m) { toast(t('tasks.durationUnknown')); return }
    await run(() => api.post('/time/entries', { project_id: task.project_id, task_id: task.id, entry_date: date, minutes: m, note }))
    setMinutes(''); setNote('')
  }
  return (
    <Section title={t('tasks.section.time')} aside={
      <span className="text-xs text-muted-foreground">{task.estimate_minutes ? t('tasks.time.ofEstimate', { total: fmtMinutes(total), estimate: fmtMinutes(task.estimate_minutes) }) : fmtMinutes(total)}</span>}>
      {task.estimate_minutes ? <Progress label={t('tasks.time.progressLabel')} value={(total / task.estimate_minutes) * 100} tone={total > task.estimate_minutes ? 'late' : 'accent'} className="mb-3" /> : null}
      <Button size="sm" variant={running ? 'danger' : 'primary'} onClick={timer}>{running ? t('tasks.time.stop') : t('tasks.time.start')}</Button>
      <form onSubmit={submit} className="mt-3 grid grid-cols-[5.5rem_1fr] gap-1.5 sm:grid-cols-[5.5rem_9.5rem_1fr_auto]">
        <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="1h30" aria-label={t('tasks.time.duration')} className="px-2 py-1.5 text-sm" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('tasks.time.date')} className="px-2 py-1.5 text-sm" />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('tasks.time.notePlaceholder')} aria-label={t('tasks.time.note')} className="col-span-2 px-2 py-1.5 text-sm sm:col-span-1" />
        <Button type="submit" size="sm" disabled={!minutes.trim()} className="col-span-2 sm:col-span-1">{t('tasks.time.log')}</Button>
      </form>
      {task.time.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-y border-border text-sm">
          {task.time.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 py-1.5">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{fmtDate(e.entry_date)}</span>
              <span className="min-w-0 flex-1 truncate">{e.user_name}{e.note ? <span className="text-muted-foreground"> — {e.note}</span> : null}</span>
              <span className="shrink-0 font-semibold">{e.minutes == null ? t('tasks.time.running') : fmtMinutes(e.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Files({ t: task, run }: { t: TaskDetail; run: Run }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    await run(async () => {
      for (const f of Array.from(files)) {
        const form = new FormData()
        form.append('file', f)
        form.append('task_id', task.id)
        await api.upload(`/projects/${task.project_id}/files`, form)
      }
    })
    setBusy(false)
    if (input.current) input.current.value = ''
  }
  return (
    <Section title={t('tasks.section.files')} aside={
      <>
        <input ref={input} type="file" multiple className="sr-only" id={`files-${task.id}`} onChange={(e) => upload(e.target.files)} />
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? t('tasks.files.uploading') : t('tasks.files.attach')}</Button>
      </>}>
      {task.files.length ? (
        <ul className="divide-y divide-border border-y border-border text-sm">
          {task.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-1.5">
              <a href={`/api/projects/files/${f.id}`} className="min-w-0 flex-1 truncate font-semibold hover:text-accent">{f.filename}</a>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(f.size)}</span>
              <button type="button" aria-label={t('tasks.files.delete', { name: f.filename })} className="px-1 text-muted-foreground hover:text-late"
                onClick={() => run(() => api.del(`/projects/files/${f.id}`), { files: task.files.filter((x) => x.id !== f.id) })}>×</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">{t('tasks.files.empty')}</p>}
    </Section>
  )
}

/** Le texte d'un commentaire, avec les @mentions en évidence. */
function CommentText({ body, names }: { body: string; names: string[] }) {
  const sorted = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!sorted.length) return <>{body}</>
  const re = new RegExp(`(@(?:${sorted.join('|')}))`, 'gi')
  return <>{body.split(re).map((part, i) => i % 2 ? <span key={i} className="bg-accent-veil font-semibold text-accent-dark">{part}</span> : part)}</>
}

function Comments({ t: task, run, meId }: { t: TaskDetail; run: Run; meId?: string }) {
  const t = useT()
  const { team, me } = useApp()
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const names = team.map((m) => m.name)
  const matches = mention ? team.filter((m) => m.active && m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : []

  const onType = (value: string, caret: number) => {
    setText(value)
    const m = value.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,30})$/)
    setMention(m ? { query: m[1], start: caret - m[1].length - 1 } : null)
  }
  const pick = (name: string) => {
    if (!mention) return
    const caret = mention.start + 1 + mention.query.length
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`
    setText(next)
    setMention(null)
    requestAnimationFrame(() => { const pos = mention.start + name.length + 2; area.current?.focus(); area.current?.setSelectionRange(pos, pos) })
  }
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) return
    await run(() => api.post(`/tasks/${task.id}/comments`, { body: text.trim() }))
    setText('')
  }
  return (
    <Section title={task.comment_list.length ? t('tasks.comments.titleCount', { n: task.comment_list.length }) : t('tasks.comments.title')}>
      <ul className="space-y-3">
        {task.comment_list.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar person={{ name: c.author_name ?? '?', color: c.author_color ?? '' }} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <b className="text-[13px]">{c.author_name ?? t('tasks.comments.formerMember')}</b>
                <time className="text-muted-foreground" title={fmtDateTime(c.created_at)}>{fmtRelative(c.created_at)}</time>
                {c.edited_at && <span className="text-muted-foreground">{t('tasks.comments.edited')}</span>}
                {c.author_id === meId && editing?.id !== c.id && (
                  <span className="ml-auto flex gap-2">
                    <button type="button" className="font-semibold text-muted-foreground hover:text-foreground" onClick={() => setEditing({ id: c.id, body: c.body })}>{t('common.edit')}</button>
                    <button type="button" className="font-semibold text-muted-foreground hover:text-late"
                      onClick={() => run(() => api.del(`/tasks/comments/${c.id}`), { comment_list: task.comment_list.filter((x) => x.id !== c.id) })}>{t('common.delete')}</button>
                  </span>
                )}
              </div>
              {editing?.id === c.id ? (
                <form className="mt-1 space-y-1.5" onSubmit={async (e) => {
                  e.preventDefault()
                  if (!editing.body.trim()) return
                  await run(() => api.patch(`/tasks/comments/${c.id}`, { body: editing.body.trim() }))
                  setEditing(null)
                }}>
                  <Textarea rows={3} value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} aria-label={t('tasks.comments.editLabel')} autoFocus />
                  <div className="flex gap-1.5">
                    <Button type="submit" size="sm" variant="primary">{t('common.save')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                  </div>
                </form>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]"><CommentText body={c.body} names={names} /></p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="relative mt-3 flex gap-2.5">
        {me && <Avatar person={me.user} size={26} />}
        <div className="relative min-w-0 flex-1 space-y-1.5">
          <Textarea ref={area} rows={2} value={text} placeholder={t('tasks.comments.placeholder')} aria-label={t('tasks.comments.newLabel')}
            onChange={(e) => onType(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (mention && matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(matches[0].name); return }
              if (e.key === 'Escape' && mention) { e.stopPropagation(); setMention(null); return }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }} />
          {mention && matches.length > 0 && (
            <ul role="listbox" aria-label={t('tasks.comments.mentionList')} className="absolute bottom-full left-0 z-10 mb-1 w-64 max-w-full border border-input bg-card py-1">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.name)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent-veil">
                    <Avatar person={m} size={20} />{m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-end gap-2 sm:justify-between">
            <span className="hidden text-xs text-muted-foreground sm:inline">{t('tasks.comments.shortcut')}</span>
            <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>{t('tasks.comments.submit')}</Button>
          </div>
        </div>
      </form>
    </Section>
  )
}
