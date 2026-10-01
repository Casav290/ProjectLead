import clsx from 'clsx'
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
         type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { errorText } from '../lib/api'
import { HEALTH_LABEL, PRIORITY_LABEL, STAGE_LABEL, STATUS_LABEL } from '../lib/format'
import type { Person } from '../lib/types'

/**
 * Composants communs, au visuel « Trait net » de la famille Lead (repris de CRMlead) :
 * angles vifs, aucune ombre, Archivo, une seule couleur d'action (ocre pour ProjectLead).
 */

type Variant = 'primary' | 'outline' | 'ghost' | 'danger'

export function Button({ variant = 'outline', className, size = 'md', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type={p.type ?? 'button'}
      className={clsx(
        'inline-flex items-center justify-center gap-[7px] font-bold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-[13px]',
        'transition-[filter,background-color,border-color] duration-[120ms] ease-crm',
        'disabled:opacity-40 disabled:pointer-events-none',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-accent-dark',
        variant === 'outline' && 'border border-input bg-card hover:bg-[#f4f2ef]',
        variant === 'ghost' && 'hover:bg-muted',
        variant === 'danger' && 'border border-late/40 bg-card text-late hover:bg-late/5',
        className,
      )}
      {...p}
    />
  )
}

export const ButtonLink = ({ to, variant = 'outline', className, children }: { to: string; variant?: Variant; className?: string; children: ReactNode }) => (
  <Link to={to} className={clsx('inline-flex items-center justify-center gap-[7px] px-3 py-2 text-[13px] font-bold whitespace-nowrap',
    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-accent-dark',
    variant === 'outline' && 'border border-input bg-card hover:bg-[#f4f2ef]',
    variant === 'ghost' && 'hover:bg-muted', className)}>{children}</Link>
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(!/\bw-/.test(className ?? '') && 'w-full',
    'max-w-full border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground',
    'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent', className)} {...p} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx('w-full border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground',
    'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent', className)} {...p} />
})

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(!/\bw-/.test(className ?? '') && 'w-full', 'border border-input bg-card px-3 py-2 text-sm',
    'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent', className)} {...p} />
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('block min-w-0 space-y-1.5', className)}>
      <label className="block min-w-0 space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        {children}
      </label>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {error && <span role="alert" className="block text-xs text-late">{error}</span>}
    </div>
  )
}

export function Checkbox({ label, checked, onChange, className }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2 text-sm', className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={clsx('border border-border bg-card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <Link to={back.to} className="mb-1 inline-block text-xs font-semibold text-muted-foreground hover:text-foreground">← {back.label}</Link>}
        <h1 className="font-display text-2xl sm:text-3xl [overflow-wrap:anywhere]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide, footer }:
  { open: boolean; onClose?: () => void; title: string; children: ReactNode; wide?: boolean | 'xl'; footer?: ReactNode }) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !onClose) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    // Premier champ, sauf si l'on écrit déjà ailleurs dans la fenêtre : la saisie ne doit pas sauter de champ.
    setTimeout(() => {
      if (!box.current || box.current.contains(document.activeElement)) return
      box.current.querySelector<HTMLElement>('input,textarea,select')?.focus()
    }, 30)
    return () => before?.focus?.()
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-marine-deep/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={clsx('flex max-h-[92dvh] w-full flex-col border border-input bg-card sm:max-h-[calc(100dvh-2rem)]',
          wide === 'xl' ? 'sm:max-w-4xl' : wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="min-w-0 font-display text-xl [overflow-wrap:anywhere]">{title}</h2>
          {onClose && <button onClick={onClose} aria-label="Fermer" className="shrink-0 px-2 text-xl text-muted-foreground hover:bg-muted">×</button>}
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/** Panneau latéral (fiche de tâche) : à droite sur grand écran, plein écran au téléphone. */
export function Drawer({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-marine-deep/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-label={title} className="flex h-full w-full flex-col border-l border-input bg-card sm:max-w-2xl">{children}</aside>
    </div>
  )
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return <p className="p-8 text-center text-sm text-muted-foreground">{label}</p>
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <p role="alert" className="border-l-[3px] border-late bg-late/5 px-3 py-2 text-sm text-late">{errorText(error)}</p>
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-input bg-card px-6 py-10 text-center">
      <p className="font-bold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Étiquette à liseré gauche, petites capitales (Trait net). */
export function Badge({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'muted' | 'accent' | 'ok' | 'warn' | 'late' | 'info'; className?: string }) {
  return (
    <span className={clsx('inline-block whitespace-nowrap border-l-[3px] px-[8px] py-[2px] text-[10.5px] font-extrabold uppercase tracking-[.05em]',
      tone === 'muted' && 'border-l-[#a8a29e] bg-muted text-muted-foreground',
      tone === 'accent' && 'border-l-accent bg-accent-veil text-accent-dark',
      tone === 'ok' && 'border-l-[#16a34a] bg-[#dcfce7] text-[#15803d]',
      tone === 'warn' && 'border-l-[#ea580c] bg-[#ffedd5] text-[#c2410c]',
      tone === 'late' && 'border-l-[#dc2626] bg-[#fee2e2] text-[#b91c1c]',
      tone === 'info' && 'border-l-[#0284c7] bg-[#e0f2fe] text-[#0369a1]', className)}>{children}</span>
  )
}

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={status === 'active' ? 'accent' : status === 'done' ? 'ok' : status === 'on_hold' ? 'warn' : status === 'lead' ? 'info' : 'muted'}>
    {STATUS_LABEL[status] ?? status}</Badge>
)
export const HealthBadge = ({ health }: { health: string }) => (
  <Badge tone={health === 'on_track' ? 'ok' : health === 'at_risk' ? 'warn' : 'late'}>{HEALTH_LABEL[health] ?? health}</Badge>
)
export const StageBadge = ({ status }: { status: string }) => (
  <Badge tone={status === 'done' ? 'ok' : status === 'in_progress' ? 'accent' : status === 'blocked' ? 'warn' : 'muted'}>{STAGE_LABEL[status] ?? status}</Badge>
)
export const PriorityBadge = ({ priority }: { priority: string }) =>
  priority === 'normal' ? null : <Badge tone={priority === 'urgent' ? 'late' : priority === 'high' ? 'warn' : 'muted'}>{PRIORITY_LABEL[priority]}</Badge>

export function Avatar({ person, size = 24 }: { person: Pick<Person, 'name' | 'color'>; size?: number }) {
  const initials = (person.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span title={person.name} className="inline-grid shrink-0 place-items-center rounded-full font-bold text-white"
          style={{ width: size, height: size, fontSize: size * 0.4, background: person.color || '#57534e' }}>{initials}</span>
  )
}

export function AvatarStack({ people, max = 4, size = 22 }: { people: Pick<Person, 'name' | 'color'>[]; max?: number; size?: number }) {
  return (
    <span className="inline-flex items-center">
      {people.slice(0, max).map((p, i) => <span key={i} className={clsx(i && '-ml-1.5', 'rounded-full ring-2 ring-card')}><Avatar person={p} size={size} /></span>)}
      {people.length > max && <span className="ml-1 text-xs text-muted-foreground">+{people.length - max}</span>}
    </span>
  )
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'ok' | 'late' | 'warn' }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={clsx('h-1.5 w-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full', tone === 'accent' && 'bg-accent', tone === 'ok' && 'bg-won', tone === 'late' && 'bg-late', tone === 'warn' && 'bg-soon')} style={{ width: `${v}%` }} />
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: ReactNode; to?: string }[]; active: string; onChange?: (id: string) => void }) {
  return (
    <nav className="-mx-1 mb-4 flex gap-0 overflow-x-auto border-b border-input px-1" aria-label="Onglets">
      {tabs.map((t) => {
        const cls = clsx('whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-bold',
          active === t.id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')
        return t.to ? <Link key={t.id} to={t.to} className={cls} aria-current={active === t.id ? 'page' : undefined}>{t.label}</Link>
          : <button key={t.id} type="button" className={cls} onClick={() => onChange?.(t.id)} aria-current={active === t.id ? 'page' : undefined}>{t.label}</button>
      })}
    </nav>
  )
}

/** Un tableau qui devient une pile de fiches au téléphone (repris de CRMlead). */
export function TableStack({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelectorAll('table').forEach((table) => {
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '')
      table.querySelectorAll('tbody tr').forEach((tr) => {
        let i = 0
        for (const cell of [...tr.children] as HTMLTableCellElement[]) {
          const span = cell.colSpan || 1
          cell.setAttribute('data-label', span > 1 ? '' : heads[i] ?? '')
          i += span
        }
      })
    })
  })
  return <div ref={ref} className={clsx('table-stack border border-border bg-card sm:overflow-x-auto', className)}>{children}</div>
}

/** Un petit message éphémère en bas de l'écran. */
let pushToast: ((t: string) => void) | null = null
export const toast = (t: string) => pushToast?.(t)
export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([])
  useEffect(() => {
    pushToast = (text) => {
      const id = Date.now() + Math.random()
      setItems((x) => [...x, { id, text }])
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500)
    }
    return () => { pushToast = null }
  }, [])
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((i) => <div key={i.id} className="border border-input bg-foreground px-4 py-2 text-sm font-semibold text-background">{i.text}</div>)}
    </div>
  )
}

/** Sélection de personnes (intervenants, assignés). */
export function PeoplePicker({ people, value, onChange, placeholder = 'Ajouter…' }:
  { people: Person[]; value: string[]; onChange: (ids: string[]) => void; placeholder?: string }) {
  const chosen = people.filter((p) => value.includes(p.id))
  const rest = people.filter((p) => !value.includes(p.id))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosen.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 border border-input bg-card py-0.5 pl-0.5 pr-1.5 text-xs">
          <Avatar person={p} size={18} />{p.name}
          <button type="button" aria-label={`Retirer ${p.name}`} className="ml-0.5 text-muted-foreground hover:text-late" onClick={() => onChange(value.filter((v) => v !== p.id))}>×</button>
        </span>
      ))}
      {rest.length > 0 && (
        <select className="border border-dashed border-input bg-card px-2 py-1 text-xs" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">{placeholder}</option>
          {rest.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </div>
  )
}

export const ColorDot = ({ color, className }: { color: string; className?: string }) =>
  <span className={clsx('inline-block h-2.5 w-2.5 shrink-0', className)} style={{ background: color }} aria-hidden="true" />

export function Confirm({ open, title, children, onConfirm, onClose, confirmLabel = 'Confirmer', danger }:
  { open: boolean; title: string; children: ReactNode; onConfirm: () => void; onClose: () => void; confirmLabel?: string; danger?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</Button></>}>
      <div className="text-sm">{children}</div>
    </Modal>
  )
}
