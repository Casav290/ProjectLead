import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { addDays, fmtDate, fmtMinutes, hours, mondayOf, parseDuration, today } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { ProjectSummary, Task, TimeEntry } from '../lib/types'
import { Badge, Button, Card, Checkbox, ColorDot, Confirm, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, TableStack, Tabs,
         Textarea, toast } from '../components/ui'

type WeekRow = { project_id: string; project_name: string; project_color: string; task_id: string | null; task_title: string | null; entry_date: string; minutes: number }
type Line = { key: string; project_id: string; project_name: string; project_color: string; task_id: string | null; task_title: string | null; days: Record<string, number> }

/** 90 → « 1:30 », 0 → vide. */
const hm = (m?: number) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '')
const dayHead = (d: string) => new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00'))
const rangeLabel = (a: string, b: string) => {
  const f = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short' })
  return `${f.format(new Date(a + 'T12:00:00'))} – ${f.format(new Date(b + 'T12:00:00'))} ${b.slice(0, 4)}`
}
const firstOfMonth = () => today().slice(0, 8) + '01'

/** Les projets ouverts (pour saisir du temps) et leurs tâches, chargées à la demande. */
function useProjects() {
  const { data } = useLoad<ProjectSummary[]>('/projects')
  return useMemo(() => (data ?? []).filter((p) => !['done', 'cancelled'].includes(p.status)), [data])
}
function useTasks(projectId: string) {
  const [tasks, setTasks] = useState<Task[]>([])
  useEffect(() => {
    setTasks([])
    if (!projectId) return
    let alive = true
    api.get<Task[]>(`/tasks?project=${projectId}&status=open`).then((t) => alive && setTasks(t)).catch(() => {})
    return () => { alive = false }
  }, [projectId])
  return tasks
}

function ProjectTaskFields({ projects, projectId, taskId, onProject, onTask, extraTask }:
  { projects: ProjectSummary[]; projectId: string; taskId: string; onProject: (id: string) => void; onTask: (id: string) => void
    extraTask?: { id: string; title: string } | null }) {
  const tasks = useTasks(projectId)
  const list = extraTask && !tasks.some((t) => t.id === extraTask.id) ? [{ id: extraTask.id, title: extraTask.title }, ...tasks] : tasks
  return (
    <>
      <Field label="Projet">
        <Select required value={projectId} onChange={(e) => { onProject(e.target.value); onTask('') }}>
          <option value="">Choisir un projet…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.client_name ? `${p.name} — ${p.client_name}` : p.name}</option>)}
        </Select>
      </Field>
      <Field label="Tâche (facultatif)">
        <Select value={taskId} disabled={!projectId} onChange={(e) => onTask(e.target.value)}>
          <option value="">Sans tâche</option>
          {list.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </Select>
      </Field>
    </>
  )
}

export default function Time() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('vue') ?? 'semaine'
  const [from, to] = [firstOfMonth(), today()]
  return (
    <div>
      <PageHeader title="Temps" subtitle="Feuille de temps, saisies et chronomètre."
        actions={<a className="inline-flex items-center border border-input bg-card px-3 py-2 text-[13px] font-bold hover:bg-[#f4f2ef]"
                    href={`/api/time/export.csv?from=${from}&to=${to}`} download>Exporter le mois (CSV)</a>} />
      <Tabs active={tab} onChange={(id) => setParams(id === 'semaine' ? {} : { vue: id }, { replace: true })}
        tabs={[{ id: 'semaine', label: 'Semaine' }, { id: 'saisies', label: 'Saisies' }, { id: 'chrono', label: 'Chronomètre' }]} />
      {tab === 'semaine' && <WeekSheet />}
      {tab === 'saisies' && <Entries />}
      {tab === 'chrono' && <Stopwatch />}
    </div>
  )
}

// ------------------------------------------------------------------ semaine

function WeekSheet() {
  const [start, setStart] = useState(() => mondayOf(today()))
  const { data, error, loading, reload } = useLoad<{ rows: WeekRow[]; capacity_minutes: number }>(`/time/week?start=${start}`)
  const [added, setAdded] = useState<Line[]>([])
  const [adding, setAdding] = useState(false)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  useEffect(() => setAdded([]), [start])

  const lines = useMemo(() => {
    const map = new Map<string, Line>()
    for (const r of data?.rows ?? []) {
      const key = `${r.project_id}:${r.task_id ?? ''}`
      const l = map.get(key) ?? { key, project_id: r.project_id, project_name: r.project_name, project_color: r.project_color,
                                   task_id: r.task_id, task_title: r.task_title, days: {} }
      l.days[r.entry_date.slice(0, 10)] = (l.days[r.entry_date.slice(0, 10)] ?? 0) + r.minutes
      map.set(key, l)
    }
    for (const a of added) if (!map.has(a.key)) map.set(a.key, a)
    return [...map.values()]
  }, [data, added])

  const save = async (l: Line, d: string, minutes: number) => {
    try {
      await api.put('/time/week/cell', { project_id: l.project_id, task_id: l.task_id, entry_date: d, minutes })
      await reload()
    } catch (e) { toast(errorText(e)); await reload() }
  }

  const dayTotal = (d: string) => lines.reduce((s, l) => s + (l.days[d] ?? 0), 0)
  const total = days.reduce((s, d) => s + dayTotal(d), 0)
  const capacity = data?.capacity_minutes ?? 2400
  const perDay = capacity / 5
  const isThisWeek = start === mondayOf(today())

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex">
          <Button aria-label="Semaine précédente" onClick={() => setStart(addDays(start, -7))}>←</Button>
          <Button className="-ml-px" disabled={isThisWeek} onClick={() => setStart(mondayOf(today()))}>Cette semaine</Button>
          <Button className="-ml-px" aria-label="Semaine suivante" onClick={() => setStart(addDays(start, 7))}>→</Button>
        </div>
        <span className="text-sm font-bold">{rangeLabel(days[0], days[6])}</span>
        <span className="ml-auto text-sm">
          <span className={clsx('font-extrabold tabular-nums', total > capacity && 'text-soon')}>{hours(total)} h</span>
          <span className="text-muted-foreground"> sur {hours(capacity)} h de capacité</span>
        </span>
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Spinner /> : (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-head text-xs text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 bg-head px-3 py-2 text-left font-semibold">Projet / tâche</th>
                {days.map((d) => <th key={d} className={clsx('w-[74px] px-1 py-2 text-center font-semibold first-letter:uppercase', d === today() && 'text-accent-dark')}>{dayHead(d)}</th>)}
                <th className="w-[70px] px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">Aucune heure cette semaine. Ajoutez une ligne pour commencer.</td></tr>
              )}
              {lines.map((l) => (
                <tr key={l.key} className="border-t border-border">
                  <td className="sticky left-0 z-10 w-[140px] max-w-[140px] border-r border-border bg-card px-3 py-1.5 sm:w-auto sm:max-w-[260px] sm:border-r-0">
                    <div className="flex min-w-0 items-center gap-1.5 font-semibold"><ColorDot color={l.project_color} /><span className="truncate">{l.project_name}</span></div>
                    <div className="truncate pl-4 text-xs text-muted-foreground">{l.task_title ?? 'Sans tâche'}</div>
                  </td>
                  {days.map((d) => <td key={d} className={clsx('px-1 py-1', d === today() && 'bg-accent-veil/60')}>
                    <Cell value={l.days[d] ?? 0} label={`${l.project_name}, ${dayHead(d)}`} onSave={(m) => save(l, d, m)} /></td>)}
                  <td className="px-3 py-1.5 text-right font-bold tabular-nums">{hm(days.reduce((s, d) => s + (l.days[d] ?? 0), 0)) || '0:00'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-input bg-head text-xs">
              <tr>
                <td className="sticky left-0 z-10 bg-head px-3 py-2 font-bold">Total du jour</td>
                {days.map((d) => {
                  const t = dayTotal(d), weekend = new Date(d + 'T12:00:00').getDay() % 6 === 0
                  return <td key={d} className={clsx('px-1 py-2 text-center font-bold tabular-nums', !weekend && t > perDay && 'text-soon')}>
                    {hm(t) || '–'}{!weekend && <div className="font-normal text-muted-foreground">/ {hm(perDay)}</div>}</td>
                })}
                <td className="px-3 py-2 text-right font-extrabold tabular-nums">{hm(total) || '0:00'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setAdding(true)}>+ Ajouter une ligne</Button>
        <p className="text-xs text-muted-foreground">Saisissez « 1:30 », « 1.5 » ou « 90m ». Une cellule vide efface le temps du jour.</p>
      </div>
      {adding && <AddLine onClose={() => setAdding(false)} onAdd={(l) => { setAdded((a) => [...a, l]); setAdding(false) }} />}
    </div>
  )
}

function Cell({ value, onSave, label }: { value: number; onSave: (m: number) => void; label: string }) {
  const [text, setText] = useState(hm(value))
  useEffect(() => setText(hm(value)), [value])
  const commit = () => {
    const m = text.trim() ? parseDuration(text) : 0
    if (m === null || m > 1440) { toast('Durée non reconnue : écrivez par exemple 1:30.'); setText(hm(value)); return }
    if (m !== value) onSave(m)
    else setText(hm(value))
  }
  return (
    <input aria-label={label} inputMode="decimal" value={text} placeholder="–"
      className="w-full border border-transparent bg-transparent px-1 py-1.5 text-center tabular-nums placeholder:text-input hover:border-input focus:border-accent focus:bg-card focus:outline-none"
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(hm(value)) } }} />
  )
}

function AddLine({ onClose, onAdd }: { onClose: () => void; onAdd: (l: Line) => void }) {
  const projects = useProjects()
  const [projectId, setProjectId] = useState('')
  const [taskId, setTaskId] = useState('')
  const tasks = useTasks(projectId)
  const add = () => {
    const p = projects.find((x) => x.id === projectId)
    if (!p) return
    const t = tasks.find((x) => x.id === taskId)
    onAdd({ key: `${p.id}:${taskId}`, project_id: p.id, project_name: p.name, project_color: p.color, task_id: taskId || null, task_title: t?.title ?? null, days: {} })
  }
  return (
    <Modal open onClose={onClose} title="Ajouter une ligne"
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!projectId} onClick={add}>Ajouter</Button></>}>
      <div className="space-y-3">
        <ProjectTaskFields projects={projects} projectId={projectId} taskId={taskId} onProject={setProjectId} onTask={setTaskId} />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ saisies

function Entries() {
  const { me, team } = useApp()
  const [f, setF] = useState({ from: firstOfMonth(), to: today(), project: '', user: 'me' })
  const qs = new URLSearchParams({ from: f.from, to: f.to, user: f.user, ...(f.project ? { project: f.project } : {}) })
  const { data, error, loading, reload } = useLoad<TimeEntry[]>(`/time/entries?${qs}`)
  const { data: allProjects } = useLoad<ProjectSummary[]>('/projects')
  const [editing, setEditing] = useState<TimeEntry | 'new' | null>(null)
  const [removing, setRemoving] = useState<TimeEntry | null>(null)
  const manager = me?.user.role !== 'member'
  const rows = (data ?? []).filter((e) => e.minutes !== null)
  const total = rows.reduce((s, e) => s + (e.minutes ?? 0), 0)
  const billable = rows.reduce((s, e) => s + (e.billable ? e.minutes ?? 0 : 0), 0)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const remove = async (e: TimeEntry) => {
    try { await api.del(`/time/entries/${e.id}`); toast('Saisie supprimée'); reload() } catch (err) { toast(errorText(err)) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <Field label="Du"><Input type="date" value={f.from} onChange={set('from')} className="w-full sm:w-40" /></Field>
        <Field label="Au"><Input type="date" value={f.to} onChange={set('to')} className="w-full sm:w-40" /></Field>
        <Field label="Projet" className="col-span-2 sm:col-span-1">
          <Select value={f.project} onChange={set('project')} className="w-full sm:w-56">
            <option value="">Tous les projets</option>
            {(allProjects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {manager && (
          <Field label="Personne" className="col-span-2 sm:col-span-1">
            <Select value={f.user} onChange={set('user')} className="w-full sm:w-48">
              <option value="me">Moi</option>
              <option value="all">Toute l'équipe</option>
              {team.filter((m) => m.id !== me?.user.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="col-span-2 flex gap-2 sm:ml-auto">
          <a className="inline-flex items-center border border-input bg-card px-3 py-2 text-[13px] font-bold hover:bg-[#f4f2ef]"
             href={`/api/time/export.csv?from=${f.from}&to=${f.to}`} download>CSV</a>
          <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => setEditing('new')}>+ Saisir du temps</Button>
        </div>
      </div>
      <ErrorNote error={error} />
      <p className="text-sm text-muted-foreground">
        <span className="font-bold text-foreground">{fmtMinutes(total)}</span> sur la période, dont {fmtMinutes(billable)} facturables · {rows.length} saisie{rows.length > 1 ? 's' : ''}
      </p>
      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        <Empty title="Aucune saisie sur cette période" action={<Button variant="primary" onClick={() => setEditing('new')}>Saisir du temps</Button>}>
          Changez la période ou ajoutez une saisie.
        </Empty>
      ) : (
        <TableStack>
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-head text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                {f.user !== 'me' && <th className="px-3 py-2 text-left font-semibold">Personne</th>}
                <th className="px-3 py-2 text-left font-semibold">Projet</th>
                <th className="px-3 py-2 text-left font-semibold">Tâche</th>
                <th className="px-3 py-2 text-left font-semibold">Note</th>
                <th className="px-3 py-2 text-right font-semibold">Durée</th>
                <th className="px-3 py-2 text-left font-semibold">Statut</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(e.entry_date)}</td>
                  {f.user !== 'me' && <td className="px-3 py-2">{e.user_name}</td>}
                  <td className="max-w-[220px] px-3 py-2">
                    <div className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5"><ColorDot color={e.project_color} /><span className="truncate font-semibold">{e.project_name}</span></span>
                      {e.client_name && <span className="block truncate pl-4 text-xs text-muted-foreground">{e.client_name}</span>}
                    </div>
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2">{e.task_title ?? <span className="text-muted-foreground">–</span>}</td>
                  <td className="max-w-[240px] px-3 py-2 text-muted-foreground [overflow-wrap:anywhere]">{e.note || '–'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">{hm(e.minutes ?? 0)}</td>
                  <td className="px-3 py-2">
                    {e.invoiced_at ? <Badge tone="ok">Facturé{e.invoice_ref ? ` · ${e.invoice_ref}` : ''}</Badge>
                      : e.billable ? <Badge tone="accent">Facturable</Badge> : <Badge>Non facturable</Badge>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!e.invoiced_at && (manager || e.user_id === me?.user.id) && (
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Modifier</Button>
                        <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(e)}>Supprimer</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableStack>
      )}
      {editing && <EntryForm entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <Confirm open={!!removing} title="Supprimer la saisie" danger confirmLabel="Supprimer" onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)}>
        {removing && <>Supprimer {fmtMinutes(removing.minutes)} du {fmtDate(removing.entry_date)} sur « {removing.project_name} » ?</>}
      </Confirm>
    </div>
  )
}

function EntryForm({ entry, onClose, onSaved }: { entry: TimeEntry | null; onClose: () => void; onSaved: () => void }) {
  const { me, team } = useApp()
  const projects = useProjects()
  const [f, setF] = useState({
    project_id: entry?.project_id ?? '', task_id: entry?.task_id ?? '', entry_date: entry?.entry_date.slice(0, 10) ?? today(),
    duration: entry ? hm(entry.minutes ?? 0) : '', billable: entry?.billable ?? true, note: entry?.note ?? '', user_id: me?.user.id ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Un projet terminé reste choisissable quand on corrige une saisie existante.
  const list = entry && !projects.some((p) => p.id === entry.project_id)
    ? [{ id: entry.project_id, name: entry.project_name, client_name: entry.client_name } as ProjectSummary, ...projects] : projects
  const project = list.find((p) => p.id === f.project_id)
  const nonBillable = project?.billing_mode === 'none'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const minutes = parseDuration(f.duration)
    if (!minutes || minutes > 1440) { setError('Indiquez une durée, par exemple 1:30 ou 2.'); return }
    setBusy(true); setError(null)
    const body = { project_id: f.project_id, task_id: f.task_id || null, entry_date: f.entry_date, minutes, billable: nonBillable ? false : f.billable, note: f.note }
    try {
      if (entry) await api.patch(`/time/entries/${entry.id}`, body)
      else await api.post('/time/entries', { ...body, ...(f.user_id && f.user_id !== me?.user.id ? { user_id: f.user_id } : {}) })
      toast(entry ? 'Saisie modifiée' : 'Temps enregistré')
      onSaved()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={entry ? 'Modifier la saisie' : 'Saisir du temps'}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="entry-form" disabled={busy || !f.project_id}>
        {busy ? 'Enregistrement…' : 'Enregistrer'}</Button></>}>
      <form id="entry-form" onSubmit={submit} className="space-y-3">
        {!entry && me?.user.role !== 'member' && team.length > 1 && (
          <Field label="Pour">
            <Select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>
              {team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.id === me?.user.id ? `${m.name} (moi)` : m.name}</option>)}
            </Select>
          </Field>
        )}
        <ProjectTaskFields projects={list} projectId={f.project_id} taskId={f.task_id}
          extraTask={entry?.task_id && entry.task_id === f.task_id ? { id: entry.task_id, title: entry.task_title ?? '' } : null}
          onProject={(id) => setF((x) => ({ ...x, project_id: id }))} onTask={(id) => setF((x) => ({ ...x, task_id: id }))} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" required value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></Field>
          <Field label="Durée"><Input required placeholder="1:30" inputMode="decimal" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
        </div>
        <Field label="Note"><Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ce qui a été fait" /></Field>
        {nonBillable ? <p className="text-xs text-muted-foreground">Ce projet n'est pas facturable : le temps est noté sans montant.</p>
          : <Checkbox label="Facturable" checked={f.billable} onChange={(v) => setF({ ...f, billable: v })} />}
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ chronomètre

function Stopwatch() {
  const { me, refresh } = useApp()
  const projects = useProjects()
  const [f, setF] = useState({ project_id: '', task_id: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const running = me?.running ?? null
  const { data: todays, reload } = useLoad<TimeEntry[]>(`/time/entries?from=${today()}&to=${today()}`)
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [running])

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await api.post('/time/timer/start', { project_id: f.project_id, task_id: f.task_id || null, note: f.note }); await refresh(); setF({ ...f, note: '' }) }
    catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ minutes?: number }>('/time/timer/stop')
      if (r.minutes) toast(`${fmtMinutes(r.minutes)} enregistrées`)
      await refresh(); reload()
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }

  const s = running ? Math.max(0, Math.floor((now - Date.parse(running.started_at)) / 1000)) : 0
  const clock = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const done = (todays ?? []).filter((e) => e.minutes !== null)

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Chronomètre">
        <div className="p-4">
          {running ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.06em] text-accent">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />En cours depuis {new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(new Date(running.started_at))}
              </div>
              <div className="font-display text-5xl font-extrabold tabular-nums">{clock}</div>
              <div className="text-sm">
                <div className="font-bold">{running.project_name}</div>
                <div className="text-muted-foreground">{running.task_title ?? 'Sans tâche'}</div>
              </div>
              <Button variant="primary" className="w-full sm:w-auto" disabled={busy} onClick={stop}>Arrêter et enregistrer</Button>
            </div>
          ) : (
            <form onSubmit={start} className="space-y-3">
              <ProjectTaskFields projects={projects} projectId={f.project_id} taskId={f.task_id}
                onProject={(id) => setF((x) => ({ ...x, project_id: id }))} onTask={(id) => setF((x) => ({ ...x, task_id: id }))} />
              <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Sur quoi travaillez-vous ?" /></Field>
              <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={busy || !f.project_id}>Démarrer</Button>
              <p className="text-xs text-muted-foreground">Le chronomètre continue même si vous fermez la page. Il s'affiche en haut de l'écran.</p>
            </form>
          )}
        </div>
      </Card>
      <Card title="Aujourd'hui" action={<span className="text-sm font-bold tabular-nums">{fmtMinutes(done.reduce((s, e) => s + (e.minutes ?? 0), 0))}</span>}>
        {done.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">Rien d'enregistré aujourd'hui.</p> : (
          <ul>
            {done.map((e) => (
              <li key={e.id} className="flex items-start gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
                <ColorDot color={e.project_color} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.project_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{[e.task_title, e.note].filter(Boolean).join(' · ') || 'Sans tâche'}</div>
                </div>
                <span className="font-bold tabular-nums">{hm(e.minutes ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
