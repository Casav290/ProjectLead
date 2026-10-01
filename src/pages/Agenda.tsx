import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { addDays, fmtDateTime, fmtRelative, mondayOf, today } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { Client, ProjectSummary } from '../lib/types'
import { Badge, Button, Card, Checkbox, Confirm, ErrorNote, Field, Input, Modal, PageHeader, PeoplePicker, Select, Spinner, Tabs, Textarea,
         toast } from '../components/ui'

type Attendee = { user_id: string | null; email: string | null; name: string | null }
type Ev = { id: string; title: string; description: string; location: string; kind: string; starts_at: string; ends_at: string; all_day: boolean
  project_id: string | null; client_id: string | null; project_name: string | null; project_color: string | null; client_name: string | null
  organizer_id: string | null; organizer_name: string | null; booking_id: string | null; attendees: Attendee[] }
type Feed = { id: string; name: string; color: string; last_synced_at: string | null; sync_error: string | null; events: number }
type Booking = { id: string; name: string; email: string; company: string | null; starts_at: string; ends_at: string; status: string
  type_name: string; host_name: string | null; project_id: string | null; project_name: string | null }
type CalData = {
  events: Ev[]
  tasks: { id: string; title: string; due_date: string; completed_at: string | null; is_milestone: boolean; project_id: string; project_name: string; project_color: string }[]
  stages: { id: string; name: string; due_date: string; status: string; project_id: string; project_name: string; project_color: string }[]
  external: { id: string; title: string; starts_at: string; ends_at: string; all_day: boolean; feed_name: string; color: string }[]
}
type Item = { key: string; type: 'event' | 'task' | 'stage' | 'external'; title: string; start: Date; end: Date; allDay: boolean; color: string
  sub?: string; done?: boolean; ev?: Ev; link?: string }
type View = 'month' | 'week' | 'list'

const KIND: Record<string, string> = { meeting: 'Réunion', call: 'Appel', workshop: 'Atelier', deadline: 'Échéance', other: 'Autre' }
const pad = (n: number) => String(n).padStart(2, '0')
const dkey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const local = (s: string) => new Date(s + 'T12:00:00')
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-CH', o).format(local(s))
const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

/** Les bornes affichées pour une vue et une date de référence. */
function bounds(view: View, cursor: string): [string, string] {
  if (view === 'week') { const m = mondayOf(cursor); return [m, addDays(m, 6)] }
  const first = cursor.slice(0, 8) + '01'
  const last = addDays(addDays(first, 32).slice(0, 8) + '01', -1)
  return view === 'month' ? [mondayOf(first), addDays(mondayOf(first), 41)] : [first, last]
}

export default function Agenda() {
  const { me } = useApp()
  const navigate = useNavigate()
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'list' : 'month'))
  const [cursor, setCursor] = useState(today())
  const [selected, setSelected] = useState(today())
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [editing, setEditing] = useState<Ev | { date: string } | null>(null)
  const [from, to] = bounds(view, cursor)
  const { data, error, loading, reload } = useLoad<CalData>(`/calendar/events?from=${from}&to=${to}&scope=${scope}`)

  const items = useMemo(() => {
    if (!data) return []
    const list: Item[] = [
      ...data.events.map((e) => ({ key: `e${e.id}`, type: 'event' as const, title: e.title, start: new Date(e.starts_at), end: new Date(e.ends_at), allDay: e.all_day,
        color: e.project_color ?? '#8e2a6b', sub: [e.project_name ?? e.client_name, e.location].filter(Boolean).join(' · '), ev: e })),
      ...data.tasks.map((t) => ({ key: `t${t.id}`, type: 'task' as const, title: t.title, start: local(t.due_date.slice(0, 10)), end: local(t.due_date.slice(0, 10)),
        allDay: true, color: t.project_color, sub: t.project_name, done: !!t.completed_at, link: `/projets/${t.project_id}?tache=${t.id}` })),
      ...data.stages.map((s) => ({ key: `s${s.id}`, type: 'stage' as const, title: `Étape : ${s.name}`, start: local(s.due_date.slice(0, 10)), end: local(s.due_date.slice(0, 10)),
        allDay: true, color: s.project_color, sub: s.project_name, done: s.status === 'done', link: `/projets/${s.project_id}` })),
      ...data.external.map((x) => ({ key: `x${x.id}`, type: 'external' as const, title: x.title, start: new Date(x.starts_at), end: new Date(x.ends_at),
        allDay: x.all_day, color: '#a8a29e', sub: x.feed_name })),
    ]
    return list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
  }, [data])

  /** Les éléments de chaque jour ; un événement sur plusieurs jours apparaît chaque jour. */
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const it of items) {
      const last = it.end > it.start ? dkey(new Date(it.end.getTime() - 1)) : dkey(it.start)
      let d = dkey(it.start)
      for (let i = 0; i < 42 && d <= last; i++, d = addDays(d, 1)) m.set(d, [...(m.get(d) ?? []), it])
    }
    return m
  }, [items])

  const open = (it: Item) => {
    if (it.ev) setEditing(it.ev)
    else if (it.link) navigate(it.link)
  }
  const move = (n: number) => {
    const next = view === 'week' ? addDays(cursor, 7 * n) : (() => {
      const [y, m] = [+cursor.slice(0, 4), +cursor.slice(5, 7) - 1 + n]
      return `${y + Math.floor(m / 12)}-${pad(((m % 12) + 12) % 12 + 1)}-01`
    })()
    setCursor(next); setSelected(next)
  }
  const title = view === 'week'
    ? `Semaine du ${fmt(from, { day: 'numeric', month: 'long' })}`
    : fmt(cursor.slice(0, 8) + '15', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-5">
      <PageHeader title="Agenda" subtitle="Réunions, rendez-vous, échéances des tâches et vos agendas extérieurs."
        actions={<Button variant="primary" onClick={() => setEditing({ date: selected })}>+ Nouvel événement</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex">
          <Button aria-label="Précédent" onClick={() => move(-1)}>←</Button>
          <Button className="-ml-px" onClick={() => { setCursor(today()); setSelected(today()) }}>Aujourd'hui</Button>
          <Button className="-ml-px" aria-label="Suivant" onClick={() => move(1)}>→</Button>
        </div>
        <h2 className="font-display text-lg first-letter:uppercase">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select className="w-auto" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} aria-label="Afficher">
            <option value="mine">Mon agenda</option>
            <option value="all">Toute l'équipe</option>
          </Select>
        </div>
      </div>
      <Tabs active={view} onChange={(v) => setView(v as View)}
        tabs={[{ id: 'month', label: 'Mois' }, { id: 'week', label: 'Semaine' }, { id: 'list', label: 'Liste' }]} />
      <ErrorNote error={error} />
      {loading && !data ? <Spinner /> : (
        <>
          {view === 'month' && <MonthView cursor={cursor} from={from} byDay={byDay} selected={selected} onSelect={setSelected} onOpen={open} />}
          {view === 'month' && (
            <DayList day={selected} items={byDay.get(selected) ?? []} onOpen={open} onCreate={() => setEditing({ date: selected })} />
          )}
          {view === 'week' && <WeekView from={from} byDay={byDay} onOpen={open} onCreate={(d) => setEditing({ date: d })} />}
          {view === 'list' && <ListView from={from} to={to} byDay={byDay} onOpen={open} />}
        </>
      )}
      <p className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-accent" />Événement (couleur du projet)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 border-2 border-accent" />Échéance de tâche ou d'étape</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-[#a8a29e]" />Agenda extérieur</span>
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <MyCalendars icalUrl={me?.icalUrl ?? ''} onSynced={reload} />
        <Bookings />
      </div>

      {editing && <EventForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

// ------------------------------------------------------------------ vues

function Chip({ it, onOpen, compact }: { it: Item; onOpen: (it: Item) => void; compact?: boolean }) {
  const deadline = it.type === 'task' || it.type === 'stage'
  const label = <>{!it.allDay && <span className="tabular-nums">{hhmm(it.start)} </span>}{it.title}</>
  const cls = clsx('block w-full truncate px-1.5 py-[3px] text-left text-[11.5px] leading-tight',
    it.type === 'external' ? 'bg-muted text-muted-foreground' : deadline ? 'border-l-[3px] bg-card' : 'text-white',
    it.done && 'line-through opacity-60', (it.ev || it.link) ? 'hover:brightness-95' : 'cursor-default')
  const style = it.type === 'event' ? { background: it.color } : deadline ? { borderColor: it.color } : undefined
  if (compact) return <span className="block h-1.5 w-full" style={{ background: it.color }} title={it.title} />
  return <button type="button" className={cls} style={style} title={`${it.title}${it.sub ? ` — ${it.sub}` : ''}`} onClick={(e) => { e.stopPropagation(); onOpen(it) }}>{label}</button>
}

function MonthView({ cursor, from, byDay, selected, onSelect, onOpen }:
  { cursor: string; from: string; byDay: Map<string, Item[]>; selected: string; onSelect: (d: string) => void; onOpen: (it: Item) => void }) {
  const month = cursor.slice(0, 7)
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))
  return (
    <div className="border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-head">
        {WEEKDAYS.map((w) => <div key={w} className="px-1 py-1.5 text-center text-[11px] font-bold uppercase text-muted-foreground sm:px-2 sm:text-left">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const list = byDay.get(d) ?? []
          return (
            <div key={d} role="button" tabIndex={0} onClick={() => onSelect(d)} onKeyDown={(e) => e.key === 'Enter' && onSelect(d)}
              aria-label={`${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}, ${list.length} élément(s)`}
              className={clsx('min-h-[64px] min-w-0 cursor-pointer border-border p-1 sm:min-h-[104px]', i % 7 !== 6 && 'border-r', i >= 7 && 'border-t',
                d.slice(0, 7) !== month && 'bg-head/70 text-muted-foreground', d === selected && 'outline outline-2 -outline-offset-2 outline-accent')}>
              <div className={clsx('mb-1 inline-grid h-6 min-w-6 place-items-center px-1 text-xs font-bold tabular-nums', d === today() && 'bg-accent text-white')}>
                {+d.slice(8)}</div>
              <div className="hidden space-y-0.5 sm:block">
                {list.slice(0, 3).map((it) => <Chip key={it.key} it={it} onOpen={onOpen} />)}
                {list.length > 3 && <span className="block px-1 text-[11px] font-bold text-muted-foreground">+{list.length - 3} de plus</span>}
              </div>
              <div className="space-y-0.5 sm:hidden">{list.slice(0, 4).map((it) => <Chip key={it.key} it={it} onOpen={onOpen} compact />)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({ it, onOpen }: { it: Item; onOpen: (it: Item) => void }) {
  const clickable = !!(it.ev || it.link)
  return (
    <li>
      <button type="button" disabled={!clickable} onClick={() => onOpen(it)}
        className={clsx('flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm', clickable && 'hover:bg-head', 'disabled:cursor-default')}>
        <span className="w-[86px] shrink-0 text-xs tabular-nums text-muted-foreground">
          {it.allDay ? (it.type === 'task' || it.type === 'stage' ? 'Échéance' : 'Journée') : `${hhmm(it.start)} – ${hhmm(it.end)}`}
        </span>
        <span className="mt-1 h-2.5 w-2.5 shrink-0" style={it.type === 'event' || it.type === 'external' ? { background: it.color } : { border: `2px solid ${it.color}` }} />
        <span className="min-w-0 flex-1">
          <span className={clsx('block font-semibold [overflow-wrap:anywhere]', it.done && 'line-through opacity-60', it.type === 'external' && 'text-muted-foreground')}>{it.title}</span>
          {it.sub && <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>}
        </span>
        {it.ev && it.ev.kind !== 'meeting' && <Badge>{KIND[it.ev.kind]}</Badge>}
        {it.ev?.booking_id && <Badge tone="info">Rendez-vous</Badge>}
      </button>
    </li>
  )
}

function DayList({ day, items, onOpen, onCreate }: { day: string; items: Item[]; onOpen: (it: Item) => void; onCreate: () => void }) {
  return (
    <Card title={<span className="first-letter:uppercase">{fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
      action={<Button size="sm" onClick={onCreate}>+ Événement ce jour</Button>}>
      {items.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">Rien ce jour-là.</p>
        : <ul className="divide-y divide-border">{items.map((it) => <Row key={it.key} it={it} onOpen={onOpen} />)}</ul>}
    </Card>
  )
}

function WeekView({ from, byDay, onOpen, onCreate }: { from: string; byDay: Map<string, Item[]>; onOpen: (it: Item) => void; onCreate: (d: string) => void }) {
  return (
    <div className="grid border border-border bg-card lg:grid-cols-7">
      {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d, i) => {
        const list = byDay.get(d) ?? []
        return (
          <div key={d} className={clsx('min-w-0 border-border lg:min-h-[320px]', i > 0 && 'border-t lg:border-l lg:border-t-0')}>
            <div className={clsx('flex items-center justify-between border-b border-border px-2 py-1.5 text-xs font-bold', d === today() ? 'bg-accent-veil text-accent-dark' : 'bg-head')}>
              <span className="first-letter:uppercase">{fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <button type="button" aria-label={`Nouvel événement le ${d}`} className="px-1 text-muted-foreground hover:text-accent" onClick={() => onCreate(d)}>+</button>
            </div>
            <div className="space-y-1 p-1.5">
              {list.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground lg:hidden">Rien</p>}
              {list.map((it) => (
                <div key={it.key}>
                  <Chip it={it} onOpen={onOpen} />
                  {it.sub && <p className="truncate px-1.5 text-[10.5px] text-muted-foreground">{it.sub}</p>}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ListView({ from, to, byDay, onOpen }: { from: string; to: string; byDay: Map<string, Item[]>; onOpen: (it: Item) => void }) {
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (byDay.get(d)?.length) days.push(d)
  if (!days.length) return <p className="border border-dashed border-input bg-card px-4 py-8 text-center text-sm text-muted-foreground">Rien de prévu ce mois-ci.</p>
  return (
    <div className="border border-border bg-card">
      {days.map((d) => (
        <section key={d}>
          <h3 className={clsx('border-b border-t border-border px-4 py-1.5 text-xs font-extrabold first:border-t-0 first-letter:uppercase',
            d === today() ? 'bg-accent-veil text-accent-dark' : 'bg-head')}>{fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          <ul className="divide-y divide-border">{byDay.get(d)!.map((it) => <Row key={it.key} it={it} onOpen={onOpen} />)}</ul>
        </section>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ formulaire

function EventForm({ initial, onClose, onSaved }: { initial: Ev | { date: string }; onClose: () => void; onSaved: () => void }) {
  const { me, team } = useApp()
  const ev = 'id' in initial ? initial : null
  const { data: projects } = useLoad<ProjectSummary[]>('/projects')
  const { data: clients } = useLoad<Client[]>('/clients')
  const start = ev ? new Date(ev.starts_at) : null, end = ev ? new Date(ev.ends_at) : null
  const [f, setF] = useState({
    title: ev?.title ?? '', kind: ev?.kind ?? 'meeting', date: start ? dkey(start) : (initial as { date: string }).date,
    start: start ? hhmm(start) : '09:00', end: end ? hhmm(end) : '10:00', all_day: ev?.all_day ?? false, location: ev?.location ?? '',
    project_id: ev?.project_id ?? '', client_id: ev?.client_id ?? '', description: ev?.description ?? '',
    users: ev ? ev.attendees.filter((a) => a.user_id && a.user_id !== me?.user.id).map((a) => a.user_id!) : [],
    emails: ev ? ev.attendees.filter((a) => !a.user_id && a.email).map((a) => a.email!).join(', ') : '',
    send_invites: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [notify, setNotify] = useState(true)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const emails = f.emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  const badEmail = emails.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
  const readOnly = !!ev && ev.organizer_id !== me?.user.id && me?.user.role === 'member'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (badEmail) { setError(`Adresse non valable : ${badEmail}`); return }
    const s = new Date(`${f.date}T${f.all_day ? '00:00' : f.start}:00`), t = new Date(`${f.date}T${f.all_day ? '23:59' : f.end}:00`)
    if (t < s) { setError("L'heure de fin précède l'heure de début."); return }
    setBusy(true); setError(null)
    const body = { title: f.title, kind: f.kind, starts_at: s.toISOString(), ends_at: t.toISOString(), all_day: f.all_day, location: f.location,
      description: f.description, project_id: f.project_id || null, client_id: f.client_id || null,
      attendee_user_ids: f.users, attendee_emails: emails, send_invites: f.send_invites && emails.length > 0 }
    try {
      if (ev) await api.patch(`/calendar/events/${ev.id}`, body)
      else await api.post('/calendar/events', body)
      toast(body.send_invites ? 'Enregistré, invitations envoyées' : 'Événement enregistré')
      onSaved()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const remove = async () => {
    try {
      await api.del(`/calendar/events/${ev!.id}${notify && emails.length ? '?notify=1' : ''}`)
      toast(notify && emails.length ? 'Supprimé, invités prévenus' : 'Événement supprimé')
      onSaved()
    } catch (err) { toast(errorText(err)) }
  }

  return (
    <Modal open onClose={onClose} wide title={ev ? 'Modifier l\'événement' : 'Nouvel événement'}
      footer={<>
        {ev && !readOnly && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>Supprimer</Button>}
        <Button onClick={onClose}>{readOnly ? 'Fermer' : 'Annuler'}</Button>
        {!readOnly && <Button variant="primary" type="submit" form="event-form" disabled={busy || !f.title.trim()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>}
      </>}>
      <form id="event-form" onSubmit={submit} className="space-y-3">
        <fieldset disabled={readOnly} className="space-y-3">
          {ev?.organizer_name && ev.organizer_id !== me?.user.id && <p className="text-xs text-muted-foreground">Organisé par {ev.organizer_name}.</p>}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label="Titre"><Input required value={f.title} onChange={set('title')} placeholder="Réunion de lancement" /></Field>
            <Field label="Type"><Select value={f.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_136px_136px]">
            <Field label="Date" className="col-span-2 sm:col-span-1"><Input type="date" required value={f.date} onChange={set('date')} /></Field>
            {!f.all_day && <>
              <Field label="Début"><Input type="time" required value={f.start} onChange={set('start')} /></Field>
              <Field label="Fin"><Input type="time" required value={f.end} onChange={set('end')} /></Field>
            </>}
          </div>
          <Checkbox label="Toute la journée" checked={f.all_day} onChange={(v) => setF({ ...f, all_day: v })} />
          <Field label="Lieu ou lien de visioconférence"><Input value={f.location} onChange={set('location')} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Projet">
              <Select value={f.project_id} onChange={(e) => {
                const p = projects?.find((x) => x.id === e.target.value)
                setF({ ...f, project_id: e.target.value, client_id: f.client_id || p?.client_id || '' })
              }}>
                <option value="">Aucun</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Client">
              <Select value={f.client_id} onChange={set('client_id')}>
                <option value="">Aucun</option>
                {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Description"><Textarea rows={3} value={f.description} onChange={set('description')} /></Field>
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">Participants de l'équipe</span>
            <PeoplePicker people={team.filter((m) => m.active && m.id !== me?.user.id)} value={f.users} onChange={(users) => setF({ ...f, users })} placeholder="Ajouter une personne…" />
          </div>
          <Field label="Invités extérieurs" hint="Adresses email séparées par des virgules." error={badEmail ? `Adresse non valable : ${badEmail}` : null}>
            <Input value={f.emails} onChange={set('emails')} placeholder="client@exemple.ch" inputMode="email" />
          </Field>
          {emails.length > 0 && (
            <Checkbox checked={f.send_invites} onChange={(v) => setF({ ...f, send_invites: v })}
              label={<>Envoyer {ev ? 'la mise à jour' : 'les invitations'} par email <span className="text-muted-foreground">(avec le fichier d'agenda joint)</span></>} />
          )}
          {error && <p role="alert" className="text-sm text-late">{error}</p>}
        </fieldset>
      </form>
      <Confirm open={removing} title="Supprimer l'événement" danger confirmLabel="Supprimer" onClose={() => setRemoving(false)} onConfirm={remove}>
        <p>Supprimer « {ev?.title} » ?{ev?.booking_id && ' Le rendez-vous pris en ligne sera annulé.'}</p>
        {emails.length > 0 && <Checkbox className="mt-3" checked={notify} onChange={setNotify} label={`Prévenir les invités (${emails.length}) de l'annulation`} />}
      </Confirm>
    </Modal>
  )
}

// ------------------------------------------------------------------ mes agendas

function MyCalendars({ icalUrl, onSynced }: { icalUrl: string; onSynced: () => void }) {
  const { data: feeds, error, reload } = useLoad<Feed[]>('/calendar/feeds')
  const [f, setF] = useState({ name: '', url: '', color: '#57534e' })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Feed | null>(null)
  const [help, setHelp] = useState(false)

  const copy = async () => {
    try { await navigator.clipboard.writeText(icalUrl); toast('Lien copié') } catch { toast('Copie impossible : sélectionnez le lien.') }
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('add'); setErr(null)
    try {
      const r = await api.post<{ error?: string | null; imported?: number }>('/calendar/feeds', f)
      toast(r.error ? 'Agenda ajouté, mais la lecture a échoué' : 'Agenda ajouté')
      setF({ name: '', url: '', color: '#57534e' }); reload(); onSynced()
    } catch (e2) { setErr(errorText(e2)) } finally { setBusy(null) }
  }
  const sync = async (feed: Feed) => {
    setBusy(feed.id)
    try { await api.post(`/calendar/feeds/${feed.id}/sync`); toast('Agenda relu'); reload(); onSynced() } catch (e2) { toast(errorText(e2)) } finally { setBusy(null) }
  }
  const remove = async (feed: Feed) => {
    try { await api.del(`/calendar/feeds/${feed.id}`); toast('Agenda retiré'); reload(); onSynced() } catch (e2) { toast(errorText(e2)) }
  }

  return (
    <Card title="Mes agendas">
      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <h3 className="text-sm font-bold">Voir ProjectLead dans votre agenda</h3>
          <p className="text-sm text-muted-foreground">Ajoutez ce lien dans Google Agenda, Outlook ou Apple Calendrier : vos réunions et les échéances de vos tâches y apparaîtront et se mettront à jour toutes seules.</p>
          <div className="flex min-w-0 gap-2">
            <Input readOnly value={icalUrl} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 font-mono text-xs" aria-label="Lien iCalendar personnel" />
            <Button onClick={copy}>Copier</Button>
          </div>
          <button type="button" className="text-xs font-bold text-accent hover:underline" onClick={() => setHelp(!help)} aria-expanded={help}>
            {help ? 'Masquer l\'aide' : 'Comment l\'ajouter ?'}</button>
          {help && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li><b>Google Agenda</b> : Autres agendas, « + », À partir de l'URL, collez le lien.</li>
              <li><b>Outlook</b> : Ajouter un calendrier, S'abonner à partir du web, collez le lien.</li>
              <li><b>Apple Calendrier</b> : Fichier, Nouvel abonnement à un calendrier, collez le lien.</li>
              <li>Ce lien est personnel : ne le partagez pas.</li>
            </ul>
          )}
        </section>

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-bold">Agendas extérieurs</h3>
          <p className="text-sm text-muted-foreground">Vos rendez-vous personnels s'affichent en gris et bloquent les créneaux de prise de rendez-vous. Ils restent privés.</p>
          <ErrorNote error={error} />
          {(feeds ?? []).length > 0 && (
            <ul className="divide-y divide-border border border-border">
              {feeds!.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0" style={{ background: x.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{x.name}</div>
                    <div className={clsx('text-xs', x.sync_error ? 'text-late' : 'text-muted-foreground')}>
                      {x.sync_error ? `Lecture impossible : ${x.sync_error}` : `${x.events} événement${x.events > 1 ? 's' : ''} · lu ${x.last_synced_at ? fmtRelative(x.last_synced_at) : 'jamais'}`}
                    </div>
                  </div>
                  <Button size="sm" disabled={busy === x.id} onClick={() => sync(x)}>{busy === x.id ? 'Lecture…' : 'Resynchroniser'}</Button>
                  <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(x)}>Retirer</Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={add} className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_44px]">
              <Input required placeholder="Nom (ex. Perso)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Nom de l'agenda" />
              <Input required placeholder="https://… ou webcal://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} aria-label="Adresse iCal secrète" />
              <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="Couleur" className="h-[38px] w-16 border sm:w-full border-input bg-card p-1" />
            </div>
            {err && <p role="alert" className="text-sm text-late">{err}</p>}
            <Button type="submit" disabled={busy === 'add'}>{busy === 'add' ? 'Lecture de l\'agenda…' : 'Brancher cet agenda'}</Button>
          </form>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-bold text-foreground">Où trouver l'adresse iCal secrète ?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>Google Agenda</b> : Paramètres, choisissez l'agenda, Intégrer l'agenda, « Adresse secrète au format iCal ».</li>
              <li><b>Outlook / Microsoft 365</b> : Paramètres, Calendrier, Calendriers partagés, Publier un calendrier, lien « ICS ».</li>
              <li><b>Apple iCloud</b> : dans Calendrier, partagez l'agenda en « Calendrier public » et copiez le lien webcal://.</li>
            </ul>
          </details>
        </section>
      </div>
      <Confirm open={!!removing} title="Retirer l'agenda" danger confirmLabel="Retirer" onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)}>
        Retirer « {removing?.name} » ? Ses événements disparaîtront de ProjectLead ; l'agenda d'origine n'est pas touché.
      </Confirm>
    </Card>
  )
}

function Bookings() {
  const { data, error, loading } = useLoad<Booking[]>('/booking/bookings')
  const now = Date.now()
  const upcoming = (data ?? []).filter((b) => Date.parse(b.starts_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const past = (data ?? []).filter((b) => Date.parse(b.starts_at) < now)
  const list = [...upcoming, ...past].slice(0, 15)
  return (
    <Card title="Rendez-vous pris" action={<Link to="/reglages/rendez-vous" className="whitespace-nowrap text-xs font-bold text-accent hover:underline">Types de rendez-vous</Link>}>
      {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} /></div> : list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Aucun rendez-vous pris en ligne ces 30 derniers jours. Partagez votre page de prise de rendez-vous (Réglages) pour en recevoir.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((b) => (
            <li key={b.id} className={clsx('px-4 py-2.5 text-sm', Date.parse(b.starts_at) < now && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.name}</span>
                {b.company && <span className="text-muted-foreground">· {b.company}</span>}
                <span className="ml-auto">{b.status === 'cancelled' ? <Badge tone="late">Annulé</Badge> : Date.parse(b.starts_at) < now ? <Badge>Passé</Badge> : <Badge tone="ok">Confirmé</Badge>}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtDateTime(b.starts_at)} · {b.type_name}{b.host_name ? ` avec ${b.host_name}` : ''}
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs">
                <a href={`mailto:${b.email}`} className="text-accent hover:underline">{b.email}</a>
                {b.project_id && <Link to={`/projets/${b.project_id}`} className="truncate text-accent hover:underline">{b.project_name}</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
