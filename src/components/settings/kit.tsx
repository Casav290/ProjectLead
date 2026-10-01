import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { Button, toast } from '../ui'
import { useApp } from '../../lib/store'

/** Petites pièces communes aux pages de réglages. */

export function SettingsHeader({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-2xl">
        <h1 className="font-display text-2xl">{title}</h1>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  )
}

/** Un lien à copier : champ en lecture seule et bouton « Copier ». */
export function CopyField({ value, label, open }: { value: string; label?: string; open?: boolean }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); toast('Copié'); setTimeout(() => setDone(false), 1500) }
    catch { toast('Copie impossible : sélectionnez le texte') }
  }
  return (
    <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">
      <input readOnly value={value} aria-label={label ?? 'Lien'} onFocus={(e) => e.target.select()}
        className="min-w-0 flex-1 basis-full border border-input bg-muted px-3 py-2 font-mono text-xs sm:basis-auto" />
      <Button onClick={copy}>{done ? 'Copié' : 'Copier'}</Button>
      {open && <a href={value} target="_blank" rel="noreferrer"
        className="inline-flex items-center border border-input bg-card px-3 py-2 text-[13px] font-bold hover:bg-[#f4f2ef]">Ouvrir ↗</a>}
    </div>
  )
}

export function Note({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'ok' | 'late'; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('border-l-[3px] bg-card px-4 py-3 text-sm', className,
      tone === 'info' && 'border-accent', tone === 'warn' && 'border-soon', tone === 'ok' && 'border-won', tone === 'late' && 'border-late')}>
      {children}
    </div>
  )
}

export function useRole() {
  const { me } = useApp()
  const role = me?.user.role ?? 'member'
  return { role, isAdmin: role === 'admin', canManage: role === 'admin' || role === 'manager' }
}

export const ReadOnlyNote = ({ who = 'un responsable ou un administrateur' }: { who?: string }) => (
  <Note className="mb-4">Vous consultez ces réglages ; seul {who} peut les modifier.</Note>
)

/** « mon-type-de-rdv » à partir d'un nom. */
export const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/

export const origin = () => window.location.origin
