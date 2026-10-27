import { useState } from 'react'
import { Avatar, Button, Card, Checkbox, Empty, ErrorNote, Field, Input, Select, Spinner, TableStack, toast } from '../../components/ui'
import { useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { fmtDate, fmtMinutes, money, parseDuration, today } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { ProjectDetail, Task, TimeEntry } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }

function AddEntry({ project, onAdded }: { project: ProjectDetail; onAdded: () => void }) {
  const t = useT()
  const { me, team } = useApp()
  const { data: tasks } = useLoad<Task[]>(`/tasks?project=${project.id}&status=open`)
  const [date, setDate] = useState(today())
  const [user, setUser] = useState(me?.user.id ?? '')
  const [task, setTask] = useState('')
  const [duration, setDuration] = useState('')
  const [note, setNote] = useState('')
  const [billable, setBillable] = useState(project.billing_mode !== 'none')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canPickUser = me?.user.role !== 'member'
  const minutes = parseDuration(duration)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!minutes) { setError(t('ptabs.time.errDuration')); return }
    setBusy(true); setError(null)
    try {
      await api.post('/time/entries', { project_id: project.id, task_id: task || null, entry_date: date, minutes, note: note.trim(), billable,
                                        ...(canPickUser && user && user !== me?.user.id ? { user_id: user } : {}) })
      setDuration(''); setNote(''); toast(t('ptabs.time.added', { duration: fmtMinutes(minutes) })); onAdded()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <Card title={t('ptabs.time.addTitle')}>
      <form onSubmit={submit} className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_7rem]">
        <Field label={t('ptabs.time.date')}><Input type="date" required value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        {canPickUser ? (
          <Field label={t('ptabs.time.person')}>
            <Select value={user} onChange={(e) => setUser(e.target.value)}>
              {team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        ) : <div className="hidden lg:block" />}
        <Field label={t('ptabs.time.taskOptional')}>
          <Select value={task} onChange={(e) => setTask(e.target.value)}>
            <option value="">{t('ptabs.time.noTask')}</option>
            {(tasks ?? []).map((x) => <option key={x.id} value={x.id}>#{x.number} {x.title}</option>)}
          </Select>
        </Field>
        <Field label={t('ptabs.time.duration')} hint={minutes ? `= ${fmtMinutes(minutes)}` : t('ptabs.time.durationHint')}>
          <Input required value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1:30" inputMode="decimal" />
        </Field>
        <Field label={t('ptabs.time.note')} className="sm:col-span-2 lg:col-span-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ptabs.time.notePlaceholder')} /></Field>
        <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-1">
          {project.billing_mode !== 'none' && <Checkbox label={t('ptabs.time.billable')} checked={billable} onChange={setBillable} />}
          <Button type="submit" variant="primary" disabled={busy || !duration.trim()}>{t('common.add')}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-late sm:col-span-2 lg:col-span-4">{error}</p>}
      </form>
    </Card>
  )
}

/** Le temps passé sur le projet : saisie, détail, totaux par personne. */
export default function TimeTab({ project, onChanged }: Props) {
  const t = useT()
  const { me } = useApp()
  const { data: entries, error, reload } = useLoad<TimeEntry[]>(`/time/entries?project=${project.id}&user=all`)
  const done = (entries ?? []).filter((e) => e.minutes != null)

  const byPerson = (() => {
    const m = new Map<string, { name: string; minutes: number; billable: number }>()
    for (const e of done) {
      const x = m.get(e.user_id) ?? { name: e.user_name, minutes: 0, billable: 0 }
      x.minutes += e.minutes ?? 0
      if (e.billable) x.billable += e.minutes ?? 0
      m.set(e.user_id, x)
    }
    return [...m.entries()].sort((a, b) => b[1].minutes - a[1].minutes)
  })()
  const total = done.reduce((s, e) => s + (e.minutes ?? 0), 0)
  const billable = done.filter((e) => e.billable).reduce((s, e) => s + (e.minutes ?? 0), 0)
  const invoiced = done.filter((e) => e.invoiced_at).reduce((s, e) => s + (e.minutes ?? 0), 0)
  const changed = () => { reload(); onChanged() }
  const remove = async (e: TimeEntry) => {
    try { await api.del(`/time/entries/${e.id}`); toast(t('ptabs.time.deleted')); changed() } catch (err) { toast(errorText(err)) }
  }
  const color = (uid: string) => project.members_detail.find((m) => m.id === uid)?.color ?? '#57534e'

  return (
    <div className="space-y-4">
      <AddEntry project={project} onAdded={changed} />
      <ErrorNote error={error} />
      {!entries ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {!done.length ? <Empty title={t('ptabs.time.emptyTitle')}>{t('ptabs.time.emptyBody')}</Empty> : (
              <TableStack>
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-head text-left text-[11px] font-extrabold uppercase tracking-[.05em] text-muted-foreground">
                    <tr><th className="px-3 py-2">{t('ptabs.time.date')}</th><th className="px-3 py-2">{t('ptabs.time.person')}</th><th className="px-3 py-2">{t('ptabs.time.taskAndNote')}</th>
                        <th className="px-3 py-2 text-right">{t('ptabs.time.duration')}</th><th className="px-3 py-2">{t('ptabs.time.billing')}</th><th className="px-3 py-2"><span className="sr-only">{t('ptabs.field.actions')}</span></th></tr>
                  </thead>
                  <tbody>
                    {done.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(e.entry_date)}</td>
                        <td className="whitespace-nowrap px-3 py-2">{e.user_name}</td>
                        <td className="max-w-[22rem] px-3 py-2">
                          {e.task_title && <span className="block font-semibold">{e.task_title}</span>}
                          {e.note ? <span className="text-muted-foreground">{e.note}</span> : !e.task_title && <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{fmtMinutes(e.minutes)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {e.invoiced_at ? <span className="font-semibold text-won">{t('ptabs.time.invoiced')}{e.invoice_ref && ` · ${e.invoice_ref}`}</span>
                            : e.billable ? t('ptabs.time.billable') : <span className="text-muted-foreground">{t('ptabs.time.notBillable')}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!e.invoiced_at && (e.user_id === me?.user.id || me?.user.role !== 'member') &&
                            <button className="text-xs font-semibold text-muted-foreground hover:text-late" onClick={() => remove(e)}>{t('common.delete')}</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableStack>
            )}
          </div>
          <div className="min-w-0 space-y-4">
            <Card title={t('ptabs.time.totals')}>
              <dl className="grid grid-cols-2 gap-y-2 px-4 py-3 text-sm">
                <dt className="text-muted-foreground">{t('ptabs.time.spent')}</dt><dd className="text-right font-bold tabular-nums">{fmtMinutes(total)}</dd>
                {project.budget_minutes != null && <>
                  <dt className="text-muted-foreground">{t('ptabs.settings.budget')}</dt>
                  <dd className={`text-right tabular-nums ${total > project.budget_minutes ? 'font-bold text-late' : ''}`}>{fmtMinutes(project.budget_minutes)}</dd>
                </>}
                <dt className="text-muted-foreground">{t('ptabs.time.billable')}</dt>
                <dd className="text-right tabular-nums">{fmtMinutes(billable)}{total > 0 && <span className="text-muted-foreground"> ({Math.round((billable / total) * 100)} %)</span>}</dd>
                <dt className="text-muted-foreground">{t('ptabs.time.alreadyInvoiced')}</dt>
                <dd className="text-right tabular-nums">{fmtMinutes(invoiced)}{billable > 0 && <span className="text-muted-foreground"> ({Math.round((invoiced / billable) * 100)} %)</span>}</dd>
                {project.billing_mode === 'hourly' && <>
                  <dt className="text-muted-foreground">{t('ptabs.time.billableValue')}</dt><dd className="text-right font-semibold tabular-nums">{money(project.billable_cents, project.currency)}</dd>
                </>}
              </dl>
            </Card>
            <Card title={t('ptabs.time.byPerson')}>
              {!byPerson.length ? <p className="px-4 py-3 text-sm text-muted-foreground">—</p> : (
                <ul className="divide-y divide-border">
                  {byPerson.map(([uid, p]) => (
                    <li key={uid} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                      <Avatar person={{ name: p.name, color: color(uid) }} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-right tabular-nums"><b>{fmtMinutes(p.minutes)}</b>
                        {p.billable !== p.minutes && <span className="block text-[11px] text-muted-foreground">{t('ptabs.time.billableCount', { duration: fmtMinutes(p.billable) })}</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
