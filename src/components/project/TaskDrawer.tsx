import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../../lib/api'
import { fmtDate, fmtDateTime, fmtMinutes, fmtRelative, parseDuration, PRIORITY_LABEL, today } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { ProjectDetail, Task, TaskDetail } from '../../lib/types'
import { Avatar, Badge, Button, Checkbox, Confirm, Drawer, ErrorNote, Field, Input, PeoplePicker, Progress, Select, Spinner, Textarea, toast } from '../ui'
import { DoneToggle, DueLabel, isOverdue, MilestoneMark } from './shared'

/** La fiche d'une tâche : tout se modifie sur place, chaque changement part aussitôt. */

const RECURRENCE_LABEL: Record<string, string> = { none: 'Aucune', daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois' }

const ACTIVITY: Record<string, (d: any) => string> = {
  task_created: () => 'a créé la tâche',
  task_completed: () => 'a terminé la tâche',
  task_reopened: () => 'a rouvert la tâche',
  task_moved: (d) => `a déplacé la tâche dans « ${d?.column ?? '?'} »`,
  task_due: (d) => d?.due_date ? `a fixé l'échéance au ${fmtDate(d.due_date)}` : "a retiré l'échéance",
  file_added: (d) => `a joint « ${d?.filename ?? 'un fichier'} »`,
  time_logged: (d) => `a enregistré ${fmtMinutes(d?.minutes)}`,
}

const fmtSize = (n: number) => n < 1024 ? `${n} o` : n < 1024 ** 2 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} Mo`

export default function TaskDrawer({ taskId, onClose, onChanged }: { taskId: string | null; onClose: () => void; onChanged?: () => void }) {
  // On peut descendre dans une sous-tâche sans quitter le panneau.
  const [currentId, setCurrentId] = useState(taskId)
  useEffect(() => setCurrentId(taskId), [taskId])
  const { data: task, setData, error, reload } = useLoad<TaskDetail>(currentId ? `/tasks/${currentId}` : null)
  const shown = task && task.id === currentId ? task : null

  return (
    <Drawer open={Boolean(taskId)} onClose={onClose} title={shown?.title ?? 'Tâche'}>
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

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <button type="button" onClick={onClose} aria-label="Fermer la tâche" className="px-2 text-xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
)

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

function TaskBody({ task: t, setTask, reload, onClose, onChanged, openTask }:
  { task: TaskDetail; setTask: (t: TaskDetail) => void; reload: () => Promise<void>; onClose: () => void; onChanged: () => void; openTask: (id: string) => void }) {
  const { me, team, refresh } = useApp()
  const { data: project } = useLoad<ProjectDetail>(`/projects/${t.project_id}`, [t.project_id])
  const { data: siblings } = useLoad<Task[]>(`/tasks?project=${t.project_id}`, [t.project_id])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [description, setDescription] = useState(t.description)
  const [estimate, setEstimate] = useState(t.estimate_minutes ? fmtMinutes(t.estimate_minutes) : '')
  useEffect(() => { setTitle(t.title); setDescription(t.description) }, [t.title, t.description])
  useEffect(() => setEstimate(t.estimate_minutes ? fmtMinutes(t.estimate_minutes) : ''), [t.estimate_minutes])

  /** Écrit, recharge, prévient la vue appelante. L'affichage change avant la réponse. */
  const run = async (fn: () => Promise<unknown>, optimistic?: Partial<TaskDetail>) => {
    if (optimistic) setTask({ ...t, ...optimistic })
    try { await fn() } catch (e) { toast(errorText(e)) }
    await reload()
    onChanged()
  }
  const save = (patch: Record<string, unknown>, shown?: Partial<TaskDetail>) =>
    run(() => api.patch(`/tasks/${t.id}`, patch), { ...(patch as Partial<TaskDetail>), ...shown })

  const people = useMemo(() => {
    const active = team.filter((m) => m.active)
    const extra = t.assignees.filter((a) => !active.some((m) => m.id === a.id))
    return [...active, ...extra]
  }, [team, t.assignees])

  const done = Boolean(t.completed_at)
  const running = me?.running?.task_id === t.id

  const remove = async () => {
    try {
      await api.del(`/tasks/${t.id}`)
      toast('Tâche supprimée')
      onChanged()
      if (t.parent_id) openTask(t.parent_id); else onClose()
    } catch (e) { toast(errorText(e)) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
        <Button size="sm" variant={done ? 'outline' : 'primary'} onClick={() => save({ completed: !done }, { completed_at: done ? null : new Date().toISOString() })}>
          {done ? 'Rouvrir' : 'Terminer'}
        </Button>
        <span className="truncate text-xs font-bold text-muted-foreground">{t.project_code ? `${t.project_code}-` : '#'}{t.number}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="text-late" onClick={() => setConfirmDelete(true)}>Supprimer</Button>
        <CloseButton onClose={onClose} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pb-4 pt-4">
          {t.parent_id && (
            <button type="button" className="mb-2 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => openTask(t.parent_id!)}>
              ← Tâche parente
            </button>
          )}
          <div className="flex items-start gap-3">
            <span className="mt-2.5"><DoneToggle done={done} label="Terminée" onChange={(v) => save({ completed: v }, { completed_at: v ? new Date().toISOString() : null })} size={20} /></span>
            <Textarea aria-label="Titre de la tâche" rows={1} value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
              onBlur={() => { const v = title.trim(); if (v && v !== t.title) save({ title: v }); else setTitle(t.title) }}
              className={clsx('resize-none border-transparent px-1 py-1 font-display !text-xl hover:border-input [field-sizing:content]', done && 'text-muted-foreground line-through')} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-8">
            {t.blocked && <Badge tone="warn">Bloquée</Badge>}
            {t.is_milestone && <span className="inline-flex items-center gap-1.5 text-xs font-bold"><MilestoneMark /> Jalon</span>}
            {isOverdue(t) && <Badge tone="late">En retard</Badge>}
            {done && <Badge tone="ok">Terminée le {fmtDate(t.completed_at)}</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-border px-5 py-4 sm:grid-cols-2">
          <Field label="Projet">
            <Link to={`/projets/${t.project_id}`} className="flex items-center gap-2 py-2 text-sm font-semibold hover:text-accent">
              <span className="h-2.5 w-2.5 shrink-0" style={{ background: t.project_color }} aria-hidden="true" />
              <span className="truncate">{t.project_name}</span>
            </Link>
          </Field>
          <Field label="Étape">
            <Select value={t.stage_id ?? ''} onChange={(e) => save({ stage_id: e.target.value || null })}>
              <option value="">Sans étape</option>
              {project?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Colonne">
            <Select value={t.column_id ?? ''} onChange={(e) => e.target.value && save({ column_id: e.target.value })}>
              {!t.column_id && <option value="">—</option>}
              {project?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Priorité">
            <Select value={t.priority} onChange={(e) => save({ priority: e.target.value })}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <div className="space-y-1.5 sm:col-span-2">
            <span className="block text-xs font-medium text-muted-foreground">Assignés</span>
            <PeoplePicker people={people} value={t.assignees.map((a) => a.id)} placeholder="Assigner…"
              onChange={(ids) => save({ assignee_ids: ids }, { assignees: people.filter((p) => ids.includes(p.id)) })} />
          </div>
          <Field label="Début">
            <Input type="date" value={t.start_date ?? ''} max={t.due_date ?? undefined} onChange={(e) => save({ start_date: e.target.value || null })} />
          </Field>
          <Field label="Échéance">
            <Input type="date" value={t.due_date ?? ''} min={t.start_date ?? undefined} onChange={(e) => save({ due_date: e.target.value || null })} />
          </Field>
          <Field label="Estimation" hint="Par ex. 2h30, 1.5 ou 45m">
            <Input value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="—"
              onBlur={() => {
                const m = estimate.trim() ? parseDuration(estimate) : null
                if (estimate.trim() && m === null) { toast('Durée non reconnue'); setEstimate(t.estimate_minutes ? fmtMinutes(t.estimate_minutes) : ''); return }
                if (m !== t.estimate_minutes) save({ estimate_minutes: m })
              }} />
          </Field>
          <Field label="Récurrence" hint={t.recurrence !== 'none' ? 'La suivante naît quand celle-ci se termine.' : undefined}>
            <Select value={t.recurrence} onChange={(e) => save({ recurrence: e.target.value })}>
              {Object.entries(RECURRENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-x-5 gap-y-2 sm:col-span-2">
            <Checkbox label="Jalon" checked={t.is_milestone} onChange={(v) => save({ is_milestone: v })} />
            <Checkbox label="Visible par le client" checked={t.visible_to_client} onChange={(v) => save({ visible_to_client: v })} />
          </div>
          <div className="sm:col-span-2"><Tags tags={t.tags} onChange={(tags) => save({ tags })} /></div>
        </div>

        <Section title="Description">
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ce qu'il faut savoir pour faire cette tâche…"
            aria-label="Description" onBlur={() => description !== t.description && save({ description })} />
        </Section>

        <Checklist t={t} run={run} />
        <Subtasks t={t} run={run} openTask={openTask} />
        <Dependencies t={t} siblings={siblings ?? []} run={run} />
        <TimeSection t={t} run={run} running={running} refreshMe={refresh} />
        <Files t={t} run={run} />
        <Comments t={t} run={run} meId={me?.user.id} />
        <Section title="Historique">
          {t.activity.length ? (
            <ol className="space-y-1.5 text-[13px]">
              {t.activity.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="min-w-0 flex-1"><b className="font-semibold">{a.actor_name ?? 'Automatisation'}</b> {(ACTIVITY[a.kind] ?? (() => a.kind))(a.data)}</span>
                  <time className="shrink-0 text-xs text-muted-foreground" title={fmtDateTime(a.created_at)}>{fmtRelative(a.created_at)}</time>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">Rien pour l'instant.</p>}
        </Section>
      </div>

      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} title="Supprimer la tâche" confirmLabel="Supprimer" danger>
        « {t.title} » sera supprimée{t.subtasks.length ? `, avec ses ${t.subtasks.length} sous-tâches` : ''}, ainsi que ses commentaires et sa liste de contrôle.
      </Confirm>
    </div>
  )
}

type Run = (fn: () => Promise<unknown>, optimistic?: Partial<TaskDetail>) => Promise<void>

function Tags({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [v, setV] = useState('')
  const add = () => {
    const x = v.trim().replace(/,$/, '')
    if (x && !tags.includes(x)) onChange([...tags, x])
    setV('')
  }
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">Étiquettes</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 text-xs font-semibold">
            {tag}
            <button type="button" aria-label={`Retirer l'étiquette ${tag}`} className="text-muted-foreground hover:text-late" onClick={() => onChange(tags.filter((x) => x !== tag))}>×</button>
          </span>
        ))}
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ étiquette" aria-label="Ajouter une étiquette" maxLength={40}
          className="w-28 border border-dashed border-input bg-card px-2 py-0.5 text-xs focus:border-accent focus:outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} onBlur={add} />
      </div>
    </div>
  )
}

/** Un champ d'ajout sur une ligne. */
function AddLine({ placeholder, onAdd, label }: { placeholder: string; onAdd: (v: string) => Promise<unknown>; label: string }) {
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
      <Button type="submit" size="sm" disabled={!v.trim()}>Ajouter</Button>
    </form>
  )
}

function Checklist({ t, run }: { t: TaskDetail; run: Run }) {
  const doneCount = t.checklist.filter((c) => c.done).length
  return (
    <Section title="Liste de contrôle" aside={t.checklist.length ? <span className="text-xs text-muted-foreground">{doneCount}/{t.checklist.length}</span> : null}>
      {t.checklist.length > 0 && <Progress label="Liste de contrôle" value={(doneCount / t.checklist.length) * 100} tone={doneCount === t.checklist.length ? 'ok' : 'accent'} className="mb-2" />}
      <ul className="space-y-0.5">
        {t.checklist.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 py-0.5">
            <Checkbox className="min-w-0 flex-1" checked={c.done} label={<span className={clsx(c.done && 'text-muted-foreground line-through')}>{c.label}</span>}
              onChange={(v) => run(() => api.patch(`/tasks/checklist/${c.id}`, { done: v }), { checklist: t.checklist.map((x) => x.id === c.id ? { ...x, done: v } : x) })} />
            <button type="button" aria-label={`Supprimer « ${c.label} »`} className="px-1 text-muted-foreground opacity-60 hover:text-late group-hover:opacity-100"
              onClick={() => run(() => api.del(`/tasks/checklist/${c.id}`), { checklist: t.checklist.filter((x) => x.id !== c.id) })}>×</button>
          </li>
        ))}
      </ul>
      <AddLine placeholder="Nouvel élément" label="Nouvel élément de la liste" onAdd={(label) => run(() => api.post(`/tasks/${t.id}/checklist`, { label }))} />
    </Section>
  )
}

function Subtasks({ t, run, openTask }: { t: TaskDetail; run: Run; openTask: (id: string) => void }) {
  const doneCount = t.subtasks.filter((s) => s.completed_at).length
  return (
    <Section title="Sous-tâches" aside={t.subtasks.length ? <span className="text-xs text-muted-foreground">{doneCount}/{t.subtasks.length}</span> : null}>
      <ul className="divide-y divide-border border-y border-border empty:hidden">
        {t.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-1.5">
            <DoneToggle done={Boolean(s.completed_at)} label={`Terminer « ${s.title} »`}
              onChange={(v) => run(() => api.patch(`/tasks/${s.id}`, { completed: v }),
                { subtasks: t.subtasks.map((x) => x.id === s.id ? { ...x, completed_at: v ? new Date().toISOString() : null } : x) })} />
            <button type="button" onClick={() => openTask(s.id)}
              className={clsx('min-w-0 flex-1 truncate text-left text-sm hover:text-accent', s.completed_at && 'text-muted-foreground line-through')}>{s.title}</button>
            <DueLabel task={s} className="text-xs" />
            {s.assignees.slice(0, 2).map((a) => <Avatar key={a.id} person={a} size={20} />)}
          </li>
        ))}
      </ul>
      <AddLine placeholder="Nouvelle sous-tâche" label="Nouvelle sous-tâche"
        onAdd={(title) => run(() => api.post('/tasks', { project_id: t.project_id, parent_id: t.id, stage_id: t.stage_id, title }))} />
    </Section>
  )
}

function Dependencies({ t, siblings, run }: { t: TaskDetail; siblings: Task[]; run: Run }) {
  const [mode, setMode] = useState<'waits' | 'blocks'>('waits')
  const linked = new Set([t.id, ...t.dependencies.map((d) => d.id), ...t.blocking.map((d) => d.id)])
  const candidates = siblings.filter((s) => !linked.has(s.id))
  const add = (other: string) => run(() => mode === 'waits'
    ? api.post(`/tasks/${t.id}/dependencies`, { depends_on_id: other })
    : api.post(`/tasks/${other}/dependencies`, { depends_on_id: t.id }))
  const Row = ({ d, onRemove }: { d: TaskDetail['dependencies'][number]; onRemove: () => void }) => (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span className={clsx('h-2 w-2 shrink-0', d.completed_at ? 'bg-won' : 'bg-soon')} aria-hidden="true" />
      <span className="shrink-0 text-xs text-muted-foreground">#{d.number}</span>
      <span className={clsx('min-w-0 flex-1 truncate', d.completed_at && 'text-muted-foreground line-through')}>{d.title}</span>
      <span className="sr-only">{d.completed_at ? 'terminée' : 'ouverte'}</span>
      <button type="button" aria-label={`Retirer le lien avec « ${d.title} »`} className="px-1 text-muted-foreground hover:text-late" onClick={onRemove}>×</button>
    </li>
  )
  return (
    <Section title="Dépendances" aside={t.blocked ? <Badge tone="warn">Bloquée</Badge> : null}>
      {t.dependencies.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-bold text-muted-foreground">Attend</p>
          <ul>{t.dependencies.map((d) => <Row key={d.id} d={d} onRemove={() => run(() => api.del(`/tasks/${t.id}/dependencies/${d.id}`))} />)}</ul>
        </div>
      )}
      {t.blocking.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-bold text-muted-foreground">Bloque</p>
          <ul>{t.blocking.map((d) => <Row key={d.id} d={d} onRemove={() => run(() => api.del(`/tasks/${d.id}/dependencies/${t.id}`))} />)}</ul>
        </div>
      )}
      <div className="flex gap-1.5">
        <Select aria-label="Sens du lien" value={mode} onChange={(e) => setMode(e.target.value as 'waits')} className="w-auto px-2 py-1.5 text-sm">
          <option value="waits">Attend</option>
          <option value="blocks">Bloque</option>
        </Select>
        <Select aria-label="Tâche liée" value="" onChange={(e) => e.target.value && add(e.target.value)} className="min-w-0 flex-1 px-2 py-1.5 text-sm">
          <option value="">{candidates.length ? 'Choisir une tâche…' : 'Aucune autre tâche'}</option>
          {candidates.map((s) => <option key={s.id} value={s.id}>#{s.number} {s.title}</option>)}
        </Select>
      </div>
    </Section>
  )
}

function TimeSection({ t, run, running, refreshMe }: { t: TaskDetail; run: Run; running: boolean; refreshMe: () => Promise<void> }) {
  const [minutes, setMinutes] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const total = t.time.reduce((s, e) => s + (e.minutes ?? 0), 0)
  const timer = async () => {
    try {
      if (running) { await api.post('/time/timer/stop'); toast('Chronomètre arrêté') }
      else { await api.post('/time/timer/start', { project_id: t.project_id, task_id: t.id }); toast('Chronomètre lancé') }
      await refreshMe()
      await run(async () => {})
    } catch (e) { toast(errorText(e)) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const m = parseDuration(minutes)
    if (!m) { toast('Durée non reconnue'); return }
    await run(() => api.post('/time/entries', { project_id: t.project_id, task_id: t.id, entry_date: date, minutes: m, note }))
    setMinutes(''); setNote('')
  }
  return (
    <Section title="Temps" aside={
      <span className="text-xs text-muted-foreground">{fmtMinutes(total)}{t.estimate_minutes ? ` sur ${fmtMinutes(t.estimate_minutes)} estimées` : ''}</span>}>
      {t.estimate_minutes ? <Progress label="Temps passé sur l'estimation" value={(total / t.estimate_minutes) * 100} tone={total > t.estimate_minutes ? 'late' : 'accent'} className="mb-3" /> : null}
      <Button size="sm" variant={running ? 'danger' : 'primary'} onClick={timer}>{running ? 'Arrêter le chronomètre' : 'Lancer le chronomètre'}</Button>
      <form onSubmit={submit} className="mt-3 grid grid-cols-[5.5rem_1fr] gap-1.5 sm:grid-cols-[5.5rem_9.5rem_1fr_auto]">
        <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="1h30" aria-label="Durée" className="px-2 py-1.5 text-sm" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="px-2 py-1.5 text-sm" />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (facultatif)" aria-label="Note" className="col-span-2 px-2 py-1.5 text-sm sm:col-span-1" />
        <Button type="submit" size="sm" disabled={!minutes.trim()} className="col-span-2 sm:col-span-1">Saisir</Button>
      </form>
      {t.time.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-y border-border text-sm">
          {t.time.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 py-1.5">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{fmtDate(e.entry_date)}</span>
              <span className="min-w-0 flex-1 truncate">{e.user_name}{e.note ? <span className="text-muted-foreground"> — {e.note}</span> : null}</span>
              <span className="shrink-0 font-semibold">{e.minutes == null ? 'en cours' : fmtMinutes(e.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Files({ t, run }: { t: TaskDetail; run: Run }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    await run(async () => {
      for (const f of Array.from(files)) {
        const form = new FormData()
        form.append('file', f)
        form.append('task_id', t.id)
        await api.upload(`/projects/${t.project_id}/files`, form)
      }
    })
    setBusy(false)
    if (input.current) input.current.value = ''
  }
  return (
    <Section title="Fichiers" aside={
      <>
        <input ref={input} type="file" multiple className="sr-only" id={`files-${t.id}`} onChange={(e) => upload(e.target.files)} />
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Envoi…' : 'Joindre'}</Button>
      </>}>
      {t.files.length ? (
        <ul className="divide-y divide-border border-y border-border text-sm">
          {t.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-1.5">
              <a href={`/api/projects/files/${f.id}`} className="min-w-0 flex-1 truncate font-semibold hover:text-accent">{f.filename}</a>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(f.size)}</span>
              <button type="button" aria-label={`Supprimer ${f.filename}`} className="px-1 text-muted-foreground hover:text-late"
                onClick={() => run(() => api.del(`/projects/files/${f.id}`), { files: t.files.filter((x) => x.id !== f.id) })}>×</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Aucun fichier joint (15 Mo au plus par fichier).</p>}
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

function Comments({ t, run, meId }: { t: TaskDetail; run: Run; meId?: string }) {
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
    await run(() => api.post(`/tasks/${t.id}/comments`, { body: text.trim() }))
    setText('')
  }
  return (
    <Section title={`Commentaires${t.comment_list.length ? ` (${t.comment_list.length})` : ''}`}>
      <ul className="space-y-3">
        {t.comment_list.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar person={{ name: c.author_name ?? '?', color: c.author_color ?? '' }} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <b className="text-[13px]">{c.author_name ?? 'Ancien membre'}</b>
                <time className="text-muted-foreground" title={fmtDateTime(c.created_at)}>{fmtRelative(c.created_at)}</time>
                {c.edited_at && <span className="text-muted-foreground">(modifié)</span>}
                {c.author_id === meId && editing?.id !== c.id && (
                  <span className="ml-auto flex gap-2">
                    <button type="button" className="font-semibold text-muted-foreground hover:text-foreground" onClick={() => setEditing({ id: c.id, body: c.body })}>Modifier</button>
                    <button type="button" className="font-semibold text-muted-foreground hover:text-late"
                      onClick={() => run(() => api.del(`/tasks/comments/${c.id}`), { comment_list: t.comment_list.filter((x) => x.id !== c.id) })}>Supprimer</button>
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
                  <Textarea rows={3} value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} aria-label="Modifier le commentaire" autoFocus />
                  <div className="flex gap-1.5">
                    <Button type="submit" size="sm" variant="primary">Enregistrer</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Annuler</Button>
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
          <Textarea ref={area} rows={2} value={text} placeholder="Écrire un commentaire… (@ pour citer quelqu'un)" aria-label="Nouveau commentaire"
            onChange={(e) => onType(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (mention && matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(matches[0].name); return }
              if (e.key === 'Escape' && mention) { e.stopPropagation(); setMention(null); return }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }} />
          {mention && matches.length > 0 && (
            <ul role="listbox" aria-label="Personnes à citer" className="absolute bottom-full left-0 z-10 mb-1 w-64 max-w-full border border-input bg-card py-1">
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
            <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl + Entrée pour envoyer</span>
            <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>Commenter</Button>
          </div>
        </div>
      </form>
    </Section>
  )
}
