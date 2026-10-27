import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Button, Empty, ErrorNote, Spinner, Textarea, toast } from '../../components/ui'
import { rich } from '../../components/project/shared'
import { getLocale, t, useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { fmtDate, fmtDateTime, fmtMinutes, fmtRelative, HEALTH_LABEL, money, PROJECT_ROLE_LABEL, STAGE_LABEL, STATUS_LABEL } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { ProjectDetail } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }
type Item = { type: 'activity' | 'comment'; id: string; kind: string; data: any; body: string | null; task_id: string | null
  created_at: string; actor_name: string | null; actor_color: string | null; task_title: string | null }

const q = (s?: string) => (s ? t('ptabs.activity.quoted', { s }) : '')
/** Un libellé en minuscule au milieu d'une phrase (sauf en allemand, où les noms gardent leur majuscule). */
const lower = (s?: string) => (s && getLocale() !== 'de' ? s.toLowerCase() : s)

/** Une phrase lisible pour chaque genre d'événement du fil (appelée au rendu : suit la langue). */
function describe(it: Item, people: Map<string, string>): ReactNode {
  const d = it.data ?? {}
  const task = (title?: string) => it.task_id
    ? <Link to={`?tache=${it.task_id}`} className="font-semibold text-accent hover:underline">{q(title)}</Link> : <b>{q(title)}</b>
  const tk = () => task(d.title ?? it.task_title)
  const at = (iso?: string) => (iso ? t('ptabs.activity.onDate', { date: fmtDateTime(iso) }) : '')
  switch (it.kind) {
    case 'project_created': return t('ptabs.activity.projectCreated')
    case 'project_status': return rich(t('ptabs.activity.projectStatus', { from: STATUS_LABEL[d.from] ?? d.from }), { to: <b>{STATUS_LABEL[d.to] ?? d.to}</b> })
    case 'project_update': return rich(t('ptabs.activity.projectUpdate'), { health: <b>{HEALTH_LABEL[d.health] ?? d.health}</b> })
    case 'task_created': return rich(t('ptabs.activity.taskCreated'), { task: tk() })
    case 'task_completed': return rich(t('ptabs.activity.taskCompleted'), { task: tk() })
    case 'task_reopened': return rich(t('ptabs.activity.taskReopened'), { task: tk() })
    case 'task_moved': return rich(t('ptabs.activity.taskMoved', { column: q(d.column) }), { task: tk() })
    case 'task_due': return rich(d.due_date ? t('ptabs.activity.taskDue', { date: fmtDate(d.due_date) }) : t('ptabs.activity.taskDueRemoved'), { task: tk() })
    case 'task_deleted': return t('ptabs.activity.taskDeleted', { title: q(d.title) })
    case 'stage_created': return rich(t('ptabs.activity.stageCreated'), { name: <b>{q(d.name)}</b> })
    case 'stage_status': return rich(t('ptabs.activity.stageStatus'), { name: <b>{q(d.name)}</b>, status: <b>{lower(STAGE_LABEL[d.to] ?? d.to)}</b> })
    case 'stage_done': return rich(d.automatic ? t('ptabs.activity.stageDoneAuto') : t('ptabs.activity.stageDone'), { name: <b>{q(d.name)}</b> })
    case 'member_added': return t('ptabs.activity.memberAdded', { person: people.get(d.user_id) ?? t('ptabs.activity.somebody'),
      role: lower(PROJECT_ROLE_LABEL[d.role] ?? PROJECT_ROLE_LABEL.member) })
    case 'file_added': return rich(t('ptabs.activity.fileAdded'), { name: <b>{d.filename}</b> })
    case 'time_logged': return t('ptabs.activity.timeLogged', { duration: fmtMinutes(d.minutes) })
    case 'email_in': return rich(d.from ? t('ptabs.activity.emailInFrom', { from: d.from }) : t('ptabs.activity.emailIn'),
      { subject: <b>{d.subject || t('ptabs.emails.noSubject')}</b> })
    case 'email_out': return rich(t('ptabs.activity.emailOut'), { subject: <b>{d.subject}</b> })
    case 'client_report': {
      const recipients = (d.recipients ?? []).join(', ')
      return d.automatic ? t('ptabs.activity.clientReportAuto', { recipients }) : t('ptabs.activity.clientReport', { recipients })
    }
    case 'client_message': return d.email ? t('ptabs.activity.clientMessageEmail', { name: d.name, email: d.email }) : t('ptabs.activity.clientMessage', { name: d.name })
    case 'invoice_created': return t('ptabs.activity.invoiceCreated', {
      period: d.period ? t('ptabs.activity.invoicePeriod', { period: d.period }) : '',
      amount: d.amount_cents != null ? t('ptabs.activity.invoiceAmount', { amount: money(d.amount_cents) }) : '' })
    case 'event_created': return rich(t('ptabs.activity.eventCreated', { when: at(d.starts_at) }), { title: <b>{q(d.title)}</b> })
    case 'booking': return t('ptabs.activity.booking', { name: d.name, when: at(d.starts_at) })
    case 'from_crmlead': return t('ptabs.activity.fromCrmlead')
    default: return it.kind.replace(/_/g, ' ')
  }
}

/** Met en valeur les @mentions connues dans un commentaire. */
function Body({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'gi')
  return <>{text.split(re).map((part, i) => i % 2 ? <span key={i} className="bg-accent-veil font-semibold text-accent-dark">{part}</span> : part)}</>
}

function Composer({ project, onPosted }: { project: ProjectDetail; onPosted: () => void }) {
  const t = useT()
  const { team } = useApp()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const matches = mention ? team.filter((m) => m.active && m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : []

  const onInput = (v: string, caret: number) => {
    setBody(v)
    const m = /(?:^|\s)@([^\s@]*)$/.exec(v.slice(0, caret))
    setMention(m ? { start: caret - m[1].length - 1, query: m[1] } : null)
  }
  const pick = (name: string) => {
    if (!mention) return
    const caret = mention.start + 1 + mention.query.length
    const next = `${body.slice(0, mention.start)}@${name} ${body.slice(caret)}`
    setBody(next); setMention(null)
    requestAnimationFrame(() => { const pos = mention.start + name.length + 2; ref.current?.focus(); ref.current?.setSelectionRange(pos, pos) })
  }
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    try { await api.post(`/projects/${project.id}/comments`, { body: body.trim() }); setBody(''); onPosted() } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="relative border border-border bg-card p-3">
      <Textarea ref={ref} rows={3} value={body} placeholder={t('ptabs.activity.placeholder')} aria-label={t('ptabs.activity.comment')}
        onChange={(e) => onInput(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (mention && matches.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(matches[0].name) }
          else if (e.key === 'Escape') setMention(null)
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }} />
      {mention && matches.length > 0 && (
        <ul className="absolute left-3 right-3 z-10 max-w-xs border border-input bg-card py-1 sm:right-auto sm:w-64" role="listbox">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); pick(m.name) }}>
                <Avatar person={m} size={20} />{m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">{t('ptabs.activity.mentionHint')}</span>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !body.trim()}>{t('ptabs.activity.publish')}</Button>
      </div>
    </form>
  )
}

/** Le fil du projet : ce qui s'est passé, et les échanges de l'équipe. */
export default function Activity({ project }: Props) {
  const t = useT()
  const { team } = useApp()
  const { data, error, reload } = useLoad<Item[]>(`/projects/${project.id}/activity`)
  const people = new Map(team.map((m) => [m.id, m.name]))
  const names = team.map((m) => m.name).filter(Boolean)
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Composer project={project} onPosted={reload} />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : !data.length ? <Empty title={t('ptabs.activity.emptyTitle')}>{t('ptabs.activity.emptyBody')}</Empty> : (
        <ol className="border border-border bg-card">
          {data.map((it) => it.type === 'comment' ? (
            <li key={`c${it.id}`} className="flex gap-3 border-b border-border px-4 py-3 last:border-0">
              <Avatar person={{ name: it.actor_name ?? t('ptabs.activity.client'), color: it.actor_color ?? '#0284c7' }} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground"><b className="text-foreground">{it.actor_name ?? t('ptabs.activity.client')}</b>
                  {it.task_title && <> {rich(t('ptabs.activity.onTask'), { task: <Link to={`?tache=${it.task_id}`} className="font-semibold text-accent hover:underline">{it.task_title}</Link> })}</>}
                  {' · '}<time dateTime={it.created_at} title={fmtDateTime(it.created_at)}>{fmtRelative(it.created_at)}</time></p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]"><Body text={it.body ?? ''} names={names} /></p>
              </div>
            </li>
          ) : (
            <li key={`a${it.id}`} className="flex items-baseline gap-3 border-b border-border px-4 py-2 text-sm last:border-0">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-input" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-muted-foreground [overflow-wrap:anywhere]">
                {it.actor_name && !['email_in', 'client_message', 'invoice_created', 'stage_done', 'booking', 'from_crmlead'].includes(it.kind) &&
                  <b className="text-foreground">{it.actor_name} </b>}
                <span className="text-foreground/80">{describe(it, people)}</span>
                {it.task_id && it.task_title && !['task_created', 'task_completed', 'task_reopened', 'task_moved', 'task_due'].includes(it.kind) &&
                  <> · <Link to={`?tache=${it.task_id}`} className="text-accent hover:underline">{it.task_title}</Link></>}
              </p>
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={it.created_at} title={fmtDateTime(it.created_at)}>{fmtRelative(it.created_at)}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
