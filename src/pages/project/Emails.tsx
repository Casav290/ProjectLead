import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Button, Card, Empty, ErrorNote, Field, Input, Spinner, Textarea, toast } from '../../components/ui'
import { rich } from '../../components/project/shared'
import { useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { useLoad } from '../../lib/store'
import type { ProjectDetail } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }
type Mail = { id: string; direction: 'in' | 'out'; from_email: string; from_name: string | null; to_emails: string[]; subject: string; body: string; received_at: string }
export type Recipient = { email: string; label?: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Les adresses du client : la fiche client, puis ses contacts. */
export function clientRecipients(project: ProjectDetail): Recipient[] {
  const out: Recipient[] = []
  const seen = new Set<string>()
  const add = (email: string | null | undefined, label?: string) => {
    const e = email?.trim().toLowerCase()
    if (e && !seen.has(e)) { seen.add(e); out.push({ email: e, label }) }
  }
  if (project.client) add(project.client.email, project.client.contact_person ?? project.client.name)
  for (const c of project.contacts) add(c.email, [c.name, c.job_title].filter(Boolean).join(', '))
  return out
}

/** Des cases à cocher pour les adresses connues, et un champ pour en ajouter une. */
export function RecipientPicker({ options, value, onChange }: { options: Recipient[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = useT()
  const [extra, setExtra] = useState('')
  const [bad, setBad] = useState(false)
  const all: Recipient[] = [...options, ...value.filter((v) => !options.some((o) => o.email === v)).map((email) => ({ email }))]
  const add = () => {
    const e = extra.trim().toLowerCase()
    if (!e) return
    if (!EMAIL.test(e)) { setBad(true); return }
    if (!value.includes(e)) onChange([...value, e])
    setExtra(''); setBad(false)
  }
  return (
    <div className="space-y-2">
      {all.length > 0 && (
        <ul className="space-y-1">
          {all.map((r) => (
            <li key={r.email}>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--accent))]" checked={value.includes(r.email)}
                  onChange={(e) => onChange(e.target.checked ? [...value, r.email] : value.filter((v) => v !== r.email))} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{r.email}{r.label && <span className="text-muted-foreground"> · {r.label}</span>}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input type="email" value={extra} placeholder={t('ptabs.emails.addAddressPlaceholder')} aria-label={t('ptabs.emails.addAddress')} className={clsx('min-w-0 flex-1 py-1.5', bad && 'border-late')}
          onChange={(e) => { setExtra(e.target.value); setBad(false) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <Button size="sm" onClick={add} disabled={!extra.trim()}>{t('common.add')}</Button>
      </div>
      {bad && <p className="text-xs text-late">{t('ptabs.emails.invalid')}</p>}
    </div>
  )
}

function Compose({ project, onSent, onCancel }: { project: ProjectDetail; onSent: () => void; onCancel: () => void }) {
  const t = useT()
  const options = clientRecipients(project)
  const [to, setTo] = useState<string[]>(options.slice(0, 1).map((o) => o.email))
  const [subject, setSubject] = useState(`${project.name}`)
  const [body, setBody] = useState(() => `${t('ptabs.emails.greeting')}\n\n`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!to.length) { setError(new Error('no_recipient')); return }
    setBusy(true); setError(null)
    try { await api.post(`/projects/${project.id}/emails`, { to, subject: subject.trim(), body }); toast(t('ptabs.emails.sent')); onSent() }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Card title={t('ptabs.emails.compose')}>
      <form onSubmit={submit} className="grid gap-4 px-4 py-3 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('ptabs.emails.recipients')}</p>
          <RecipientPicker options={options} value={to} onChange={setTo} />
        </div>
        <div className="min-w-0 space-y-3">
          <Field label={t('ptabs.emails.subject')}><Input required value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label={t('ptabs.emails.message')}><Textarea required rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={onCancel}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy || !to.length || !subject.trim() || !body.trim()}>{busy ? t('ptabs.emails.sending') : t('ptabs.emails.send')}</Button>
          </div>
        </div>
      </form>
    </Card>
  )
}

/** Les emails rattachés au projet, reçus et envoyés. */
export default function Emails({ project, onChanged }: Props) {
  const t = useT()
  const { data, error, reload } = useLoad<Mail[]>(`/projects/${project.id}/emails`)
  const [open, setOpen] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  useEffect(() => setOpen(null), [project.id])
  return (
    <div className="space-y-4">
      {writing ? <Compose project={project} onCancel={() => setWriting(false)} onSent={() => { setWriting(false); reload(); onChanged() }} /> : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{rich(t('ptabs.emails.intro'), { code: project.code ? <> (<span className="font-mono">{project.code}</span>)</> : '' })}</p>
          <Button variant="primary" onClick={() => setWriting(true)}>{t('ptabs.emails.compose')}</Button>
        </div>
      )}
      <ErrorNote error={error} />
      {!data ? <Spinner /> : !data.length ? <Empty title={t('ptabs.emails.emptyTitle')}>{t('ptabs.emails.emptyBody')}</Empty> : (
        <ul className="border border-border bg-card">
          {data.map((m) => {
            const isOpen = open === m.id
            return (
              <li key={m.id} className="border-b border-border last:border-0">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.id)}
                  className={clsx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#faf9f7]', isOpen && 'bg-head')}>
                  <span className={clsx('mt-0.5 shrink-0 px-1.5 text-[10px] font-extrabold uppercase', m.direction === 'in' ? 'bg-[#e0f2fe] text-[#0369a1]' : 'bg-accent-veil text-accent-dark')}>
                    {m.direction === 'in' ? t('ptabs.emails.received') : t('ptabs.emails.sentLabel')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.subject || t('ptabs.emails.noSubject')}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.direction === 'in' ? t('ptabs.emails.from', { who: m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email }) : t('ptabs.emails.to', { who: m.to_emails.join(', ') })}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(m.received_at)}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    <p className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{t('ptabs.emails.fromTo', { from: m.from_email, to: m.to_emails.join(', ') })}</p>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body || t('ptabs.emails.emptyMessage')}</pre>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
