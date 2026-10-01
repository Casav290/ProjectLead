import clsx from 'clsx'
import { useState } from 'react'
import TaskDrawer from '../components/project/TaskDrawer'
import { DueLabel } from '../components/project/shared'
import { Avatar, Button, ErrorNote, Modal, PageHeader, PriorityBadge, Spinner } from '../components/ui'
import { addDays, fmtMinutes, fmtShortDate, hours, mondayOf, today } from '../lib/format'
import { useLoad } from '../lib/store'
import type { Task } from '../lib/types'

/** Charge de travail : heures estimées par personne et par semaine, face à sa capacité. */

type Workload = {
  weeks: number
  people: { id: string; name: string; color: string; capacity_minutes: number }[]
  load: { user_id: string; week: number; minutes: number; tasks: number }[]
  overdue: { user_id: string; tasks: number; minutes: number }[]
  logged: { user_id: string; week: number; minutes: number }[]
}
type Cell = { person: Workload['people'][number]; week: number | 'overdue'; from: string; to: string }

const WEEKS = 6

/** Vert sous 80 %, orange jusqu'à 100 %, rouge au-delà. */
const tone = (pct: number) => pct > 100 ? 'bg-[#fee2e2] text-[#b91c1c]' : pct >= 80 ? 'bg-[#ffedd5] text-[#c2410c]' : pct > 0 ? 'bg-[#dcfce7] text-[#15803d]' : 'text-muted-foreground'
const bar = (pct: number) => pct > 100 ? 'bg-late' : pct >= 80 ? 'bg-soon' : 'bg-won'

export default function WorkloadPage() {
  const [from, setFrom] = useState(() => mondayOf(today()))
  const { data, error, loading } = useLoad<Workload>(`/time/workload?from=${from}&weeks=${WEEKS}`, [from])
  const [cell, setCell] = useState<Cell | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const weekStarts = Array.from({ length: data?.weeks ?? WEEKS }, (_, i) => addDays(from, i * 7))
  const thisMonday = mondayOf(today())

  return (
    <div className="min-w-0">
      <PageHeader title="Charge de travail" subtitle="Heures estimées des tâches ouvertes, par semaine d'échéance, face à la capacité de chacun."
        actions={
          <div className="flex">
            <Button aria-label="Semaine précédente" onClick={() => setFrom(addDays(from, -7))}>‹</Button>
            <Button className="-ml-px" onClick={() => setFrom(thisMonday)} disabled={from === thisMonday}>Cette semaine</Button>
            <Button className="-ml-px" aria-label="Semaine suivante" onClick={() => setFrom(addDays(from, 7))}>›</Button>
          </div>
        } />

      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : data && (
        <>
          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="bg-head text-[10.5px] font-extrabold uppercase tracking-[.08em] text-muted-foreground">
                <tr className="border-b border-input">
                  <th className="sticky left-0 z-10 w-40 bg-head sm:w-52 px-3 py-2 text-left">Personne</th>
                  <th className="w-24 border-l border-[#eeebe7] px-2 py-2 text-center">En retard</th>
                  {weekStarts.map((w) => (
                    <th key={w} className={clsx('border-l border-[#eeebe7] px-2 py-2 text-center', w === thisMonday && 'text-accent')}>
                      <span className="block">{w === thisMonday ? 'Cette semaine' : 'Semaine du'}</span>
                      <span className="block font-semibold normal-case tracking-normal">{fmtShortDate(w)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => {
                  const od = data.overdue.find((o) => o.user_id === p.id)
                  return (
                    <tr key={p.id} className="border-b border-[#eeebe7]">
                      <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
                        <span className="flex items-center gap-2">
                          <Avatar person={p} size={26} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{p.name}</span>
                            <span className="block text-xs text-muted-foreground">{hours(p.capacity_minutes)} h / sem.</span>
                          </span>
                        </span>
                      </th>
                      <td className="border-l border-[#eeebe7] p-1 text-center">
                        {od?.tasks ? (
                          <button type="button" onClick={() => setCell({ person: p, week: 'overdue', from: '', to: addDays(from, -1) })}
                            className="w-full px-1 py-1.5 font-bold text-late hover:bg-late/5" aria-label={`${od.tasks} tâches en retard pour ${p.name}`}>
                            {od.tasks} <span className="text-xs font-semibold">tâche{od.tasks > 1 ? 's' : ''}</span>
                            <span className="block text-[11px] font-normal">{fmtMinutes(od.minutes)}</span>
                          </button>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      {weekStarts.map((w, i) => {
                        const l = data.load.find((x) => x.user_id === p.id && x.week === i)
                        const logged = data.logged.find((x) => x.user_id === p.id && x.week === i)?.minutes ?? 0
                        const minutes = l?.minutes ?? 0
                        const pct = p.capacity_minutes ? (minutes / p.capacity_minutes) * 100 : 0
                        return (
                          <td key={w} className="border-l border-[#eeebe7] p-1">
                            <button type="button" disabled={!l} onClick={() => setCell({ person: p, week: i, from: w, to: addDays(w, 6) })}
                              aria-label={`${p.name}, semaine du ${fmtShortDate(w)} : ${hours(minutes)} h estimées sur ${hours(p.capacity_minutes)}`}
                              className={clsx('w-full px-2 py-1.5 text-center enabled:hover:outline enabled:hover:outline-1 enabled:hover:outline-accent', tone(pct))}>
                              <span className="block text-[13px] font-bold">{minutes ? `${hours(minutes)} h` : '—'}{minutes ? <span className="font-semibold opacity-80"> · {Math.round(pct)} %</span> : null}</span>
                              {minutes > 0 && <span className="mt-1 block h-1 w-full bg-black/5"><span className={clsx('block h-full', bar(pct))} style={{ width: `${Math.min(100, pct)}%` }} /></span>}
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">{logged ? `${hours(logged)} h saisies` : ' '}</span>
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-won align-middle" />moins de 80 %</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-soon align-middle" />80 à 100 %</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-late align-middle" />au-delà de la capacité</span>
            <span>Une tâche sans estimation compte une heure, partagée entre ses assignés.</span>
          </p>
        </>
      )}

      <CellTasks cell={openId ? null : cell} onClose={() => setCell(null)} onOpen={setOpenId} />
      <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function CellTasks({ cell, onClose, onOpen }: { cell: Cell | null; onClose: () => void; onOpen: (id: string) => void }) {
  const path = !cell ? null : cell.week === 'overdue'
    ? `/tasks?assignee=${cell.person.id}&status=open&to=${cell.to}`
    : `/tasks?assignee=${cell.person.id}&status=open&from=${cell.from}&to=${cell.to}`
  const { data, error, loading } = useLoad<Task[]>(path, [path])
  // Même règle que le calcul de charge : la semaine de l'échéance (ou du début, sans échéance).
  const list = (data ?? []).filter((t) => {
    if (!cell) return false
    const d = t.due_date ?? t.start_date
    if (!d) return false
    return cell.week === 'overdue' ? Boolean(t.due_date) && (t.due_date as string) <= cell.to : d >= cell.from && d <= cell.to
  })
  const title = !cell ? '' : cell.week === 'overdue' ? `${cell.person.name} — en retard` : `${cell.person.name} — semaine du ${fmtShortDate(cell.from)}`
  return (
    <Modal open={Boolean(cell)} onClose={onClose} title={title} wide>
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : !list.length ? (
        <p className="text-sm text-muted-foreground">Aucune tâche ouverte.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(t.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left hover:bg-accent-veil">
                <span className="h-2.5 w-2.5 shrink-0" style={{ background: t.project_color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 font-semibold">{t.title}</span>
                <span className="text-xs text-muted-foreground">{t.project_name}</span>
                <PriorityBadge priority={t.priority} />
                <span className="w-16 text-right text-xs">{t.estimate_minutes ? fmtMinutes(t.estimate_minutes) : <span className="text-muted-foreground">1 h ?</span>}</span>
                <DueLabel task={t} className="w-14 text-right text-xs" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
