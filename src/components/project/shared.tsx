import clsx from 'clsx'
import { useCallback, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { fmtShortDate, today } from '../../lib/format'
import { useLoad } from '../../lib/store'
import type { Task } from '../../lib/types'
import { Button, Input, toast } from '../ui'

/** Outils partagés par le tableau, la liste, le Gantt, le calendrier et « Mes tâches ». */

/** Les tâches d'un projet (premier niveau par défaut), rechargées à la demande. */
export function useProjectTasks(projectId: string, topOnly = true) {
  return useLoad<Task[]>(`/tasks?project=${projectId}${topOnly ? '&top=1' : ''}`, [projectId, topOnly])
}

/** Ouvrir une tâche : la fiche projet lit `?tache=<id>` et affiche le panneau. */
export function useOpenTask() {
  const [, setParams] = useSearchParams()
  return useCallback((id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tache', id); return n }), [setParams])
}

/** Une position entre deux voisines (tri par nombre à virgule, sans renuméroter). */
export function positionBetween(prev?: number | null, next?: number | null) {
  if (prev == null && next == null) return 1
  if (prev == null) return (next as number) - 1
  if (next == null) return prev + 1
  return (prev + next) / 2
}

export const isDone = (t: Pick<Task, 'completed_at'>) => Boolean(t.completed_at)
export const isOverdue = (t: Pick<Task, 'completed_at' | 'due_date'>) => !t.completed_at && Boolean(t.due_date) && (t.due_date as string) < today()

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** Échéance courte, en rouge quand elle est dépassée. */
export function DueLabel({ task, className }: { task: Pick<Task, 'completed_at' | 'due_date'>; className?: string }) {
  if (!task.due_date) return null
  const late = isOverdue(task)
  const isToday = !task.completed_at && task.due_date === today()
  return (
    <span className={clsx('whitespace-nowrap', late ? 'font-bold text-late' : isToday ? 'font-bold text-soon' : 'text-muted-foreground', className)}
          title={late ? 'Échéance dépassée' : undefined}>
      {fmtShortDate(task.due_date)}
    </span>
  )
}

/** Losange de jalon. */
export const MilestoneMark = ({ className }: { className?: string }) => (
  <span title="Jalon" aria-label="Jalon" className={clsx('inline-block h-2.5 w-2.5 shrink-0 rotate-45 bg-foreground', className)} />
)

/** Case « terminée » : un carré net, cochable au clavier. */
export function DoneToggle({ done, onChange, label, size = 18 }: { done: boolean; onChange: (v: boolean) => void; label: string; size?: number }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} title={done ? 'Rouvrir' : 'Terminer'}
      onClick={(e) => { e.stopPropagation(); onChange(!done) }}
      className={clsx('grid shrink-0 place-items-center border transition-colors duration-[120ms]',
        done ? 'border-won bg-won text-white' : 'border-input bg-card text-transparent hover:border-won hover:text-won')}
      style={{ width: size, height: size }}>
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
    </button>
  )
}

/** Terminer ou rouvrir une tâche. */
export async function setTaskDone(id: string, done: boolean) {
  await api.patch(`/tasks/${id}`, { completed: done })
  toast(done ? 'Tâche terminée' : 'Tâche rouverte')
}

/** Ajout rapide : un lien qui s'ouvre en champ, Entrée pour créer, Échap pour fermer. */
export function QuickAdd({ label = 'Ajouter une tâche', onAdd, className }: { label?: string; onAdd: (title: string) => Promise<unknown>; className?: string }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    setBusy(true)
    try { await onAdd(t); setTitle('') } catch (err) { toast(String((err as Error).message ?? err)) } finally { setBusy(false) }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className={clsx('w-full px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground', className)}>
        + {label}
      </button>
    )
  }
  return (
    <form onSubmit={submit} className={clsx('flex gap-1.5', className)}>
      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre de la tâche" aria-label="Titre de la nouvelle tâche"
        className="px-2 py-1.5 text-sm" disabled={busy}
        onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setTitle(''))}
        onBlur={() => !title.trim() && setOpen(false)} />
      <Button type="submit" size="sm" variant="primary" disabled={busy || !title.trim()}>Ajouter</Button>
    </form>
  )
}

/** Petits compteurs d'une carte : liste de contrôle, sous-tâches, commentaires. */
export function TaskCounters({ task }: { task: Task }) {
  const items: { key: string; label: string; text: string; d: string; full?: boolean }[] = []
  if (task.checklist_total) items.push({ key: 'c', label: 'Liste de contrôle', text: `${task.checklist_done}/${task.checklist_total}`,
    d: 'M3 5l2 2 3-3M3 12l2 2 3-3M11 6h10M11 13h10M11 20h10', full: task.checklist_done === task.checklist_total })
  if (task.subtasks_total) items.push({ key: 's', label: 'Sous-tâches', text: `${task.subtasks_done}/${task.subtasks_total}`,
    d: 'M5 4v10a3 3 0 0 0 3 3h11M15 13l4 4-4 4', full: task.subtasks_done === task.subtasks_total })
  if (task.comments) items.push({ key: 'm', label: 'Commentaires', text: String(task.comments), d: 'M4 5h16v11H9l-5 4z' })
  if (!items.length) return null
  return (
    <span className="inline-flex items-center gap-2.5 text-[11.5px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.key} className={clsx('inline-flex items-center gap-1', i.full && 'text-won')} title={i.label}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={i.d} /></svg>
          <span><span className="sr-only">{i.label} : </span>{i.text}</span>
        </span>
      ))}
    </span>
  )
}
