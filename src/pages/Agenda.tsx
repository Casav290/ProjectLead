import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { addDays, fmtDateTime, fmtRelative, mondayOf, today, weekdayShort } from '../lib/format'
import { intlLocale, labels, useT } from '../i18n'
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

const KIND = labels('agenda.kind', ['meeting', 'call', 'workshop', 'deadline', 'other'])
const pad = (n: number) => String(n).padStart(2, '0')
const dkey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const local = (s: string) => new Date(s + 'T12:00:00')
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(), o).format(local(s))

/** Les bornes affichées pour une vue et une date de référence. */
function bounds(view: View, cursor: string): [string, string] {
  if (view === 'week') { const m = mondayOf(cursor); return [m, addDays(m, 6)] }
  const first = cursor.slice(0, 8) + '01'
  const last = addDays(addDays(first, 32).slice(0, 8) + '01', -1)
  return view === 'month' ? [mondayOf(first), addDays(mondayOf(first), 41)] : [first, last]
}

export default function Agenda() {
  const t = useT()
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
        color: e.project_color ?? '#9a6a00', sub: [e.project_name ?? e.client_name, e.location].filter(Boolean).join(' · '), ev: e })),
      ...data.tasks.map((t) => ({ key: `t${t.id}`, type: 'task' as const, title: t.title, start: local(t.due_date.slice(0, 10)), end: local(t.due_date.slice(0, 10)),
        allDay: true, color: t.project_color, sub: t.project_name, done: !!t.completed_at, link: `/projets/${t.project_id}?tache=${t.id}` })),
      ...data.stages.map((s) => ({ key: `s${s.id}`, type: 'stage' as const, title: t('agenda.stagePrefix', { name: s.name }), start: local(s.due_date.slice(0, 10)), end: local(s.due_date.slice(0, 10)),
        allDay: true, color: s.project_color, sub: s.project_name, done: s.status === 'done', link: `/projets/${s.project_id}` })),
      ...data.external.map((x) => ({ key: `x${x.id}`, type: 'external' as const, title: x.title, start: new Date(x.starts_at), end: new Date(x.ends_at),
        allDay: x.all_day, color: '#a8a29e', sub: x.feed_name })),
    ]
    return list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
  }, [data, t])

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
    ? t('agenda.weekOf', { date: fmt(from, { day: 'numeric', month: 'long' }) })
    : fmt(cursor.slice(0, 8) + '15', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-5">
      <PageHeader title={t('agenda.title')} subtitle={t('agenda.subtitle')}
        actions={<Button variant="primary" onClick={() => setEditing({ date: selected })}>{t('agenda.newEvent')}</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex">
          <Button aria-label={t('agenda.previous')} onClick={() => move(-1)}>←</Button>
          <Button className="-ml-px" onClick={() => { setCursor(today()); setSelected(today()) }}>{t('agenda.today')}</Button>
          <Button className="-ml-px" aria-label={t('agenda.next')} onClick={() => move(1)}>→</Button>
        </div>
        <h2 className="font-display text-lg first-letter:uppercase">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select className="w-auto" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} aria-label={t('agenda.show')}>
            <option value="mine">{t('agenda.scope.mine')}</option>
            <option value="all">{t('agenda.scope.all')}</option>
          </Select>
        </div>
      </div>
      <Tabs active={view} onChange={(v) => setView(v as View)}
        tabs={[{ id: 'month', label: t('agenda.view.month') }, { id: 'week', label: t('agenda.view.week') }, { id: 'list', label: t('agenda.view.list') }]} />
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
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-accent" />{t('agenda.legend.event')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 border-2 border-accent" />{t('agenda.legend.deadline')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-[#a8a29e]" />{t('agenda.legend.external')}</span>
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
  const t = useT()
  const month = cursor.slice(0, 7)
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))
  // La grille commence le lundi (`from`) : les sept premiers jours donnent les noms courts dans la langue en cours.
  const weekdays = days.slice(0, 7).map((d) => weekdayShort(d))
  return (
    <div className="border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-head">
        {weekdays.map((w) => <div key={w} className="px-1 py-1.5 text-center text-[11px] font-bold uppercase text-muted-foreground sm:px-2 sm:text-left">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const list = byDay.get(d) ?? []
          return (
            // La case entière choisit le jour à la souris ; au clavier, c'est son numéro (un bouton) : pas de bouton dans un bouton.
            <div key={d} onClick={() => onSelect(d)}
              className={clsx('min-h-[64px] min-w-0 cursor-pointer border-border p-1 sm:min-h-[104px]', i % 7 !== 6 && 'border-r', i >= 7 && 'border-t',
                d.slice(0, 7) !== month && 'bg-head/70 text-muted-foreground', d === selected && 'outline outline-2 -outline-offset-2 outline-accent')}>
              <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(d) }} aria-pressed={d === selected}
                aria-label={t('agenda.dayAria', { day: fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }), n: list.length })}
                className={clsx('mb-1 inline-grid h-6 min-w-6 place-items-center px-1 text-xs font-bold tabular-nums', d === today() && 'bg-accent text-white')}>
                {+d.slice(8)}</button>
              <div className="hidden space-y-0.5 sm:block">
                {list.slice(0, 3).map((it) => <Chip key={it.key} it={it} onOpen={onOpen} />)}
                {list.length > 3 && <span className="block px-1 text-[11px] font-bold text-muted-foreground">{t('agenda.more', { n: list.length - 3 })}</span>}
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
  const t = useT()
  const clickable = !!(it.ev || it.link)
  return (
    <li>
      <button type="button" disabled={!clickable} onClick={() => onOpen(it)}
        className={clsx('flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm', clickable && 'hover:bg-head', 'disabled:cursor-default')}>
        <span className="w-[86px] shrink-0 text-xs tabular-nums text-muted-foreground">
          {it.allDay ? (it.type === 'task' || it.type === 'stage' ? t('agenda.row.deadline') : t('agenda.row.allDay')) : `${hhmm(it.start)} – ${hhmm(it.end)}`}
        </span>
        <span className="mt-1 h-2.5 w-2.5 shrink-0" style={it.type === 'event' || it.type === 'external' ? { background: it.color } : { border: `2px solid ${it.color}` }} />
        <span className="min-w-0 flex-1">
          <span className={clsx('block font-semibold [overflow-wrap:anywhere]', it.done && 'line-through opacity-60', it.type === 'external' && 'text-muted-foreground')}>{it.title}</span>
          {it.sub && <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>}
        </span>
        {it.ev && it.ev.kind !== 'meeting' && <Badge>{KIND[it.ev.kind]}</Badge>}
        {it.ev?.booking_id && <Badge tone="info">{t('agenda.booking')}</Badge>}
      </button>
    </li>
  )
}

function DayList({ day, items, onOpen, onCreate }: { day: string; items: Item[]; onOpen: (it: Item) => void; onCreate: () => void }) {
  const t = useT()
  return (
    <Card title={<span className="first-letter:uppercase">{fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
      action={<Button size="sm" onClick={onCreate}>{t('agenda.eventThisDay')}</Button>}>
      {items.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">{t('agenda.nothingDay')}</p>
        : <ul className="divide-y divide-border">{items.map((it) => <Row key={it.key} it={it} onOpen={onOpen} />)}</ul>}
    </Card>
  )
}

function WeekView({ from, byDay, onOpen, onCreate }: { from: string; byDay: Map<string, Item[]>; onOpen: (it: Item) => void; onCreate: (d: string) => void }) {
  const t = useT()
  return (
    <div className="grid border border-border bg-card lg:grid-cols-7">
      {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d, i) => {
        const list = byDay.get(d) ?? []
        return (
          <div key={d} className={clsx('min-w-0 border-border lg:min-h-[320px]', i > 0 && 'border-t lg:border-l lg:border-t-0')}>
            <div className={clsx('flex items-center justify-between border-b border-border px-2 py-1.5 text-xs font-bold', d === today() ? 'bg-accent-veil text-accent-dark' : 'bg-head')}>
              <span className="first-letter:uppercase">{fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <button type="button" aria-label={t('agenda.newEventOn', { date: d })} className="px-1 text-muted-foreground hover:text-accent" onClick={() => onCreate(d)}>+</button>
            </div>
            <div className="space-y-1 p-1.5">
              {list.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground lg:hidden">{t('agenda.nothing')}</p>}
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
  const t = useT()
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (byDay.get(d)?.length) days.push(d)
  if (!days.length) return <p className="border border-dashed border-input bg-card px-4 py-8 text-center text-sm text-muted-foreground">{t('agenda.nothingMonth')}</p>
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
  const t = useT()
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
    if (badEmail) { setError(t('agenda.form.invalidEmail', { email: badEmail })); return }
    const s = new Date(`${f.date}T${f.all_day ? '00:00' : f.start}:00`), endAt = new Date(`${f.date}T${f.all_day ? '23:59' : f.end}:00`)
    if (endAt < s) { setError(t('agenda.form.endBeforeStart')); return }
    setBusy(true); setError(null)
    const body = { title: f.title, kind: f.kind, starts_at: s.toISOString(), ends_at: endAt.toISOString(), all_day: f.all_day, location: f.location,
      description: f.description, project_id: f.project_id || null, client_id: f.client_id || null,
      attendee_user_ids: f.users, attendee_emails: emails, send_invites: f.send_invites && emails.length > 0 }
    try {
      if (ev) await api.patch(`/calendar/events/${ev.id}`, body)
      else await api.post('/calendar/events', body)
      toast(body.send_invites ? t('agenda.form.savedInvites') : t('agenda.form.saved'))
      onSaved()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const remove = async () => {
    try {
      await api.del(`/calendar/events/${ev!.id}${notify && emails.length ? '?notify=1' : ''}`)
      toast(notify && emails.length ? t('agenda.form.deletedNotified') : t('agenda.form.deleted'))
      onSaved()
    } catch (err) { toast(errorText(err)) }
  }

  return (
    <Modal open onClose={onClose} wide title={ev ? t('agenda.form.editTitle') : t('agenda.form.newTitle')}
      footer={<>
        {ev && !readOnly && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>{t('common.delete')}</Button>}
        <Button onClick={onClose}>{readOnly ? t('common.close') : t('common.cancel')}</Button>
        {!readOnly && <Button variant="primary" type="submit" form="event-form" disabled={busy || !f.title.trim()}>{busy ? t('agenda.form.saving') : t('common.save')}</Button>}
      </>}>
      <form id="event-form" onSubmit={submit} className="space-y-3">
        <fieldset disabled={readOnly} className="space-y-3">
          {ev?.organizer_name && ev.organizer_id !== me?.user.id && <p className="text-xs text-muted-foreground">{t('agenda.form.organizedBy', { name: ev.organizer_name })}</p>}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label={t('agenda.form.title')}><Input required value={f.title} onChange={set('title')} placeholder={t('agenda.form.titlePlaceholder')} /></Field>
            <Field label={t('agenda.form.type')}><Select value={f.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_136px_136px]">
            <Field label={t('agenda.form.date')} className="col-span-2 sm:col-span-1"><Input type="date" required value={f.date} onChange={set('date')} /></Field>
            {!f.all_day && <>
              <Field label={t('agenda.form.start')}><Input type="time" required value={f.start} onChange={set('start')} /></Field>
              <Field label={t('agenda.form.end')}><Input type="time" required value={f.end} onChange={set('end')} /></Field>
            </>}
          </div>
          <Checkbox label={t('agenda.form.allDay')} checked={f.all_day} onChange={(v) => setF({ ...f, all_day: v })} />
          <Field label={t('agenda.form.location')}><Input value={f.location} onChange={set('location')} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('agenda.form.project')}>
              <Select value={f.project_id} onChange={(e) => {
                const p = projects?.find((x) => x.id === e.target.value)
                setF({ ...f, project_id: e.target.value, client_id: f.client_id || p?.client_id || '' })
              }}>
                <option value="">{t('common.none')}</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t('agenda.form.client')}>
              <Select value={f.client_id} onChange={set('client_id')}>
                <option value="">{t('common.none')}</option>
                {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('agenda.form.description')}><Textarea rows={3} value={f.description} onChange={set('description')} /></Field>
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">{t('agenda.form.teamAttendees')}</span>
            <PeoplePicker people={team.filter((m) => m.active && m.id !== me?.user.id)} value={f.users} onChange={(users) => setF({ ...f, users })} placeholder={t('agenda.form.addPerson')} />
          </div>
          <Field label={t('agenda.form.guests')} hint={t('agenda.form.guestsHint')} error={badEmail ? t('agenda.form.invalidEmail', { email: badEmail }) : null}>
            <Input value={f.emails} onChange={set('emails')} placeholder={t('agenda.form.guestsPlaceholder')} inputMode="email" />
          </Field>
          {emails.length > 0 && (
            <Checkbox checked={f.send_invites} onChange={(v) => setF({ ...f, send_invites: v })}
              label={<>{ev ? t('agenda.form.sendUpdate') : t('agenda.form.sendInvites')} <span className="text-muted-foreground">{t('agenda.form.withIcs')}</span></>} />
          )}
          {error && <p role="alert" className="text-sm text-late">{error}</p>}
        </fieldset>
      </form>
      <Confirm open={removing} title={t('agenda.form.deleteTitle')} danger confirmLabel={t('common.delete')} onClose={() => setRemoving(false)} onConfirm={remove}>
        <p>{t('agenda.form.deleteQuestion', { title: ev?.title })}{ev?.booking_id && ` ${t('agenda.form.bookingCancelled')}`}</p>
        {emails.length > 0 && <Checkbox className="mt-3" checked={notify} onChange={setNotify} label={t('agenda.form.notifyGuests', { n: emails.length })} />}
      </Confirm>
    </Modal>
  )
}

// ------------------------------------------------------------------ mes agendas

function MyCalendars({ icalUrl, onSynced }: { icalUrl: string; onSynced: () => void }) {
  const t = useT()
  const { data: feeds, error, reload } = useLoad<Feed[]>('/calendar/feeds')
  const [f, setF] = useState({ name: '', url: '', color: '#57534e' })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Feed | null>(null)
  const [help, setHelp] = useState(false)

  const copy = async () => {
    try { await navigator.clipboard.writeText(icalUrl); toast(t('agenda.cal.copied')) } catch { toast(t('agenda.cal.copyFailed')) }
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('add'); setErr(null)
    try {
      const r = await api.post<{ error?: string | null; imported?: number }>('/calendar/feeds', f)
      toast(r.error ? t('agenda.cal.addedReadFailed') : t('agenda.cal.added'))
      setF({ name: '', url: '', color: '#57534e' }); reload(); onSynced()
    } catch (e2) { setErr(errorText(e2)) } finally { setBusy(null) }
  }
  const sync = async (feed: Feed) => {
    setBusy(feed.id)
    try { await api.post(`/calendar/feeds/${feed.id}/sync`); toast(t('agenda.cal.synced')); reload(); onSynced() } catch (e2) { toast(errorText(e2)) } finally { setBusy(null) }
  }
  const remove = async (feed: Feed) => {
    try { await api.del(`/calendar/feeds/${feed.id}`); toast(t('agenda.cal.removed')); reload(); onSynced() } catch (e2) { toast(errorText(e2)) }
  }

  return (
    <Card title={t('agenda.cal.title')}>
      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <h3 className="text-sm font-bold">{t('agenda.cal.seeTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('agenda.cal.seeText')}</p>
          <div className="flex min-w-0 gap-2">
            <Input readOnly value={icalUrl} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 font-mono text-xs" aria-label={t('agenda.cal.icalAria')} />
            <Button onClick={copy}>{t('agenda.cal.copy')}</Button>
          </div>
          <button type="button" className="text-xs font-bold text-accent hover:underline" onClick={() => setHelp(!help)} aria-expanded={help}>
            {help ? t('agenda.cal.hideHelp') : t('agenda.cal.howTo')}</button>
          {help && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li><b>{t('agenda.cal.googleName')}</b>{t('agenda.cal.help.google')}</li>
              <li><b>Outlook</b>{t('agenda.cal.help.outlook')}</li>
              <li><b>{t('agenda.cal.appleName')}</b>{t('agenda.cal.help.apple')}</li>
              <li>{t('agenda.cal.help.private')}</li>
            </ul>
          )}
        </section>

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-bold">{t('agenda.cal.externalTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('agenda.cal.externalText')}</p>
          <ErrorNote error={error} />
          {(feeds ?? []).length > 0 && (
            <ul className="divide-y divide-border border border-border">
              {feeds!.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0" style={{ background: x.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{x.name}</div>
                    <div className={clsx('text-xs', x.sync_error ? 'text-late' : 'text-muted-foreground')}>
                      {x.sync_error ? t('agenda.cal.readError', { error: x.sync_error })
                        : t('agenda.cal.feedStatus', { n: x.events, when: x.last_synced_at ? fmtRelative(x.last_synced_at) : t('agenda.cal.never') })}
                    </div>
                  </div>
                  <Button size="sm" disabled={busy === x.id} onClick={() => sync(x)}>{busy === x.id ? t('agenda.cal.reading') : t('agenda.cal.resync')}</Button>
                  <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(x)}>{t('agenda.cal.remove')}</Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={add} className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_44px]">
              <Input required placeholder={t('agenda.cal.namePlaceholder')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label={t('agenda.cal.nameAria')} />
              <Input required placeholder={t('agenda.cal.urlPlaceholder')} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} aria-label={t('agenda.cal.urlAria')} />
              <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label={t('agenda.cal.color')} className="h-[38px] w-16 border sm:w-full border-input bg-card p-1" />
            </div>
            {err && <p role="alert" className="text-sm text-late">{err}</p>}
            <Button type="submit" disabled={busy === 'add'}>{busy === 'add' ? t('agenda.cal.readingCal') : t('agenda.cal.connect')}</Button>
          </form>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-bold text-foreground">{t('agenda.cal.whereTitle')}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>{t('agenda.cal.googleName')}</b>{t('agenda.cal.where.google')}</li>
              <li><b>Outlook / Microsoft 365</b>{t('agenda.cal.where.outlook')}</li>{/* i18n-ok : noms de produits */}
              <li><b>Apple iCloud</b>{t('agenda.cal.where.icloud')}</li>{/* i18n-ok : nom de produit */}
            </ul>
          </details>
        </section>
      </div>
      <Confirm open={!!removing} title={t('agenda.cal.removeTitle')} danger confirmLabel={t('agenda.cal.remove')} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)}>
        {t('agenda.cal.removeText', { name: removing?.name })}
      </Confirm>
    </Card>
  )
}

function Bookings() {
  const t = useT()
  const { data, error, loading } = useLoad<Booking[]>('/booking/bookings')
  const now = Date.now()
  const upcoming = (data ?? []).filter((b) => Date.parse(b.starts_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const past = (data ?? []).filter((b) => Date.parse(b.starts_at) < now)
  const list = [...upcoming, ...past].slice(0, 15)
  return (
    <Card title={t('agenda.bookings.title')} action={<Link to="/reglages/rendez-vous" className="whitespace-nowrap text-xs font-bold text-accent hover:underline">{t('agenda.bookings.types')}</Link>}>
      {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} /></div> : list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t('agenda.bookings.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((b) => (
            <li key={b.id} className={clsx('px-4 py-2.5 text-sm', Date.parse(b.starts_at) < now && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.name}</span>
                {b.company && <span className="text-muted-foreground">· {b.company}</span>}
                <span className="ml-auto">{b.status === 'cancelled' ? <Badge tone="late">{t('agenda.bookings.cancelled')}</Badge> : Date.parse(b.starts_at) < now ? <Badge>{t('agenda.bookings.past')}</Badge> : <Badge tone="ok">{t('agenda.bookings.confirmed')}</Badge>}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtDateTime(b.starts_at)} · {b.type_name}{b.host_name ? ` ${t('agenda.bookings.with', { name: b.host_name })}` : ''}

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
