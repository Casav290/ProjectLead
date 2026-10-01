import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Button, Empty, ErrorNote, Spinner, Textarea, toast } from '../../components/ui'
import { api, errorText } from '../../lib/api'
import { fmtDate, fmtDateTime, fmtMinutes, fmtRelative, HEALTH_LABEL, money, PROJECT_ROLE_LABEL, STAGE_LABEL, STATUS_LABEL } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { ProjectDetail } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }
type Item = { type: 'activity' | 'comment'; id: string; kind: string; data: any; body: string | null; task_id: string | null
  created_at: string; actor_name: string | null; actor_color: string | null; task_title: string | null }

const q = (s?: string) => (s ? `« ${s} »` : '')

/** Une phrase lisible pour chaque genre d'événement du fil. */
function describe(it: Item, people: Map<string, string>): ReactNode {
  const d = it.data ?? {}
  const task = (t?: string) => it.task_id
    ? <Link to={`?tache=${it.task_id}`} className="font-semibold text-accent hover:underline">{q(t)}</Link> : <b>{q(t)}</b>
  switch (it.kind) {
    case 'project_created': return 'a créé le projet'
    case 'project_status': return <>a passé le projet de {STATUS_LABEL[d.from] ?? d.from} à <b>{STATUS_LABEL[d.to] ?? d.to}</b></>
    case 'project_update': return <>a publié un point d’avancement : <b>{HEALTH_LABEL[d.health] ?? d.health}</b></>
    case 'task_created': return <>a créé la tâche {task(d.title ?? it.task_title)}</>
    case 'task_completed': return <>a terminé la tâche {task(d.title ?? it.task_title)}</>
    case 'task_reopened': return <>a rouvert la tâche {task(d.title ?? it.task_title)}</>
    case 'task_moved': return <>a déplacé {task(d.title ?? it.task_title)} dans la colonne {q(d.column)}</>
    case 'task_due': return <>a fixé l’échéance de {task(d.title ?? it.task_title)} {d.due_date ? `au ${fmtDate(d.due_date)}` : '(retirée)'}</>
    case 'task_deleted': return <>a supprimé la tâche {q(d.title)}</>
    case 'stage_created': return <>a ajouté l’étape <b>{q(d.name)}</b></>
    case 'stage_status': return <>a passé l’étape <b>{q(d.name)}</b> à <b>{(STAGE_LABEL[d.to] ?? d.to)?.toLowerCase()}</b></>
    case 'stage_done': return <>Étape <b>{q(d.name)}</b> terminée{d.automatic ? ' automatiquement (toutes ses tâches sont faites)' : ''}</>
    case 'member_added': return <>a ajouté {people.get(d.user_id) ?? 'une personne'} comme {(PROJECT_ROLE_LABEL[d.role] ?? 'intervenant').toLowerCase()}</>
    case 'file_added': return <>a déposé le fichier <b>{d.filename}</b></>
    case 'time_logged': return <>a chronométré {fmtMinutes(d.minutes)}</>
    case 'email_in': return <>Email reçu{d.from ? ` de ${d.from}` : ''} : <b>{d.subject || '(sans objet)'}</b></>
    case 'email_out': return <>a écrit au client : <b>{d.subject}</b></>
    case 'client_report': return <>{d.automatic ? 'Suivi envoyé automatiquement' : 'a envoyé le suivi'} au client ({(d.recipients ?? []).join(', ')})</>
    case 'client_message': return <>Message du client {d.name}{d.email ? ` (${d.email})` : ''} depuis sa page de suivi</>
    case 'invoice_created': return <>Facture créée dans InvoiceLead{d.period ? ` pour ${d.period}` : ''}{d.amount_cents != null ? ` : ${money(d.amount_cents)}` : ''}</>
    case 'event_created': return <>a planifié <b>{q(d.title)}</b>{d.starts_at ? ` le ${fmtDateTime(d.starts_at)}` : ''}</>
    case 'booking': return <>{d.name} a réservé un rendez-vous{d.starts_at ? ` le ${fmtDateTime(d.starts_at)}` : ''}</>
    case 'from_crmlead': return 'Projet créé depuis une affaire gagnée dans CRMlead'
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
      <Textarea ref={ref} rows={3} value={body} placeholder="Écrire à l’équipe… tapez @ pour citer quelqu’un" aria-label="Commentaire"
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
        <span className="hidden text-xs text-muted-foreground sm:inline">Les personnes citées sont prévenues.</span>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !body.trim()}>Publier</Button>
      </div>
    </form>
  )
}

/** Le fil du projet : ce qui s'est passé, et les échanges de l'équipe. */
export default function Activity({ project }: Props) {
  const { team } = useApp()
  const { data, error, reload } = useLoad<Item[]>(`/projects/${project.id}/activity`)
  const people = new Map(team.map((m) => [m.id, m.name]))
  const names = team.map((m) => m.name).filter(Boolean)
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Composer project={project} onPosted={reload} />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : !data.length ? <Empty title="Rien pour l’instant">Les tâches, étapes, emails et échanges apparaîtront ici.</Empty> : (
        <ol className="border border-border bg-card">
          {data.map((it) => it.type === 'comment' ? (
            <li key={`c${it.id}`} className="flex gap-3 border-b border-border px-4 py-3 last:border-0">
              <Avatar person={{ name: it.actor_name ?? 'Client', color: it.actor_color ?? '#0284c7' }} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground"><b className="text-foreground">{it.actor_name ?? 'Client'}</b>
                  {it.task_title && <> sur <Link to={`?tache=${it.task_id}`} className="font-semibold text-accent hover:underline">{it.task_title}</Link></>}
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
