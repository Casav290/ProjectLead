import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Button, Checkbox, Confirm, Empty, Field, Input, Modal, StageBadge, Textarea, toast } from '../../components/ui'
import { useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { fmtDate, money, parseMoney, STAGE_LABEL } from '../../lib/format'
import type { ProjectDetail, Stage } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }
type Draft = { name: string; description: string; client_note: string; start_date: string; due_date: string; visible_to_client: boolean; billing: string }

const stageEdge = (s: Stage['status']) =>
  s === 'done' ? 'border-l-won' : s === 'in_progress' ? 'border-l-accent' : s === 'blocked' ? 'border-l-soon' : 'border-l-input'

const empty: Draft = { name: '', description: '', client_note: '', start_date: '', due_date: '', visible_to_client: true, billing: '' }

function StageDialog({ project, stage, open, onClose, onSaved }:
  { project: ProjectDetail; stage: Stage | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [d, setD] = useState<Draft>(empty)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const milestone = project.billing_mode === 'milestone'
  useEffect(() => {
    if (!open) return
    setError(null)
    setD(stage ? { name: stage.name, description: stage.description, client_note: stage.client_note, start_date: stage.start_date ?? '',
                   due_date: stage.due_date ?? '', visible_to_client: stage.visible_to_client, billing: stage.billing_cents != null ? String(stage.billing_cents / 100) : '' } : empty)
  }, [open, stage])
  const up = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = milestone ? parseMoney(d.billing) : undefined
    if (milestone && d.billing.trim() && cents === null) { setError(t('project.stages.badAmount')); return }
    setBusy(true); setError(null)
    const payload = { name: d.name.trim(), description: d.description, client_note: d.client_note, start_date: d.start_date || null,
                      due_date: d.due_date || null, visible_to_client: d.visible_to_client, ...(milestone ? { billing_cents: cents } : {}) }
    try {
      if (stage) await api.patch(`/projects/stages/${stage.id}`, payload)
      else await api.post(`/projects/${project.id}/stages`, payload)
      onClose(); onSaved()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={stage ? t('project.stages.editTitle') : t('project.stages.new')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="stage" disabled={busy || !d.name.trim()}>{t('common.save')}</Button></>}>
      <form id="stage" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('project.stages.name')} className="sm:col-span-2"><Input required value={d.name} onChange={up('name')} placeholder={t('project.stages.namePlaceholder')} /></Field>
        <Field label={t('project.stages.description')} className="sm:col-span-2"><Textarea rows={3} value={d.description} onChange={up('description')} /></Field>
        <Field label={t('project.stages.clientNote')} hint={t('project.stages.clientNoteHint')} className="sm:col-span-2">
          <Textarea rows={2} value={d.client_note} onChange={up('client_note')} placeholder={t('project.stages.clientNotePlaceholder')} />
        </Field>
        <Field label={t('project.stages.start')}><Input type="date" value={d.start_date} onChange={up('start_date')} /></Field>
        <Field label={t('project.stages.due')}><Input type="date" value={d.due_date} min={d.start_date || undefined} onChange={up('due_date')} /></Field>
        {milestone && <Field label={t('project.stages.amount', { currency: project.currency })}><Input inputMode="decimal" value={d.billing} onChange={up('billing')} placeholder="2500" /></Field>}
        <Checkbox className="sm:col-span-2" label={t('project.stages.visibleLabel')}
          checked={d.visible_to_client} onChange={(v) => setD({ ...d, visible_to_client: v })} />
        {error && <p role="alert" className="text-sm text-late sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  )
}

/** Changer le statut d'une étape, en prévenant le client si on le souhaite. */
function StatusDialog({ project, change, onClose, onSaved }:
  { project: ProjectDetail; change: { stage: Stage; to: Stage['status'] } | null; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [notify, setNotify] = useState(false)
  const [busy, setBusy] = useState(false)
  const canNotify = Boolean(project.client) && Boolean(change?.stage.visible_to_client)
  useEffect(() => { if (change) setNotify(canNotify && change.to === 'done') }, [change, canNotify])
  if (!change) return null
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api.patch<{ report: { recipients?: string[]; error?: string } | null }>(`/projects/stages/${change.stage.id}`,
        { status: change.to, notify_client: notify && canNotify })
      if (r.report?.error) toast(t('project.stages.changedNotNotified', { error: errorText(r.report.error) }))
      else if (r.report?.recipients) toast(t('project.stages.clientNotified', { list: r.report.recipients.join(', ') }))
      else toast(t('project.stages.statusChanged'))
      onClose(); onSaved()
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={t('project.stages.stageTitle', { name: change.stage.name })}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={submit} disabled={busy}>{t('common.confirm')}</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="flex flex-wrap items-center gap-2">{t('project.stages.moveFrom')} <StageBadge status={change.stage.status} /> {t('project.stages.moveTo')} <StageBadge status={change.to} /></p>
        {canNotify ? <Checkbox label={t('project.stages.notifyClient')} checked={notify} onChange={setNotify} />
          : <p className="text-xs text-muted-foreground">{project.client ? t('project.stages.hiddenNoNotify') : t('project.stages.noClient')}</p>}
      </div>
    </Modal>
  )
}

/** Les étapes du projet : ordre, contenu, statut, montant si facturé par étape. */
export default function Stages({ project, onChanged }: Props) {
  const t = useT()
  const [editing, setEditing] = useState<Stage | null | 'new'>(null)
  const [change, setChange] = useState<{ stage: Stage; to: Stage['status'] } | null>(null)
  const [removing, setRemoving] = useState<Stage | null>(null)
  const [order, setOrder] = useState(project.stages)
  useEffect(() => setOrder(project.stages), [project.stages])
  const milestone = project.billing_mode === 'milestone'

  const move = async (i: number, dir: -1 | 1) => {
    const next = [...order]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    setOrder(next)
    try { await api.post(`/projects/${project.id}/stages/order`, { ids: next.map((s) => s.id) }); onChanged() } catch (e) { toast(errorText(e)); setOrder(project.stages) }
  }
  const remove = async (s: Stage) => {
    try { await api.del(`/projects/stages/${s.id}`); toast(t('project.stages.deleted')); onChanged() } catch (e) { toast(errorText(e)) }
  }
  const total = order.reduce((s, x) => s + (x.billing_cents ?? 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t('project.stages.intro')}
          {milestone && <>{' '}{t('project.stages.milestoneTotal')}{' '}<b className="text-foreground">{money(total, project.currency)}</b>.</>}
        </p>
        <Button variant="primary" onClick={() => setEditing('new')}>{t('project.stages.new')}</Button>
      </div>
      {!order.length ? <Empty title={t('project.stages.emptyTitle')}>{t('project.stages.emptyText')}</Empty> : (
        <ol className="space-y-2">
          {order.map((s, i) => (
            <li key={s.id} className={clsx('flex flex-col gap-3 border border-border border-l-4 bg-card p-3 sm:flex-row sm:items-center', stageEdge(s.status))}>
              <div className="flex items-start gap-3 sm:flex-1">
                <div className="flex shrink-0 flex-col">
                  <button className="px-1.5 text-xs leading-5 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('project.stages.moveUp', { name: s.name })}>▲</button>
                  <button className="px-1.5 text-xs leading-5 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={t('project.stages.moveDown', { name: s.name })}>▼</button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold"><span className="mr-1.5 text-muted-foreground">{i + 1}.</span>{s.name}</p>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                  {s.client_note && <p className="mt-1 border-l-2 border-accent-light pl-2 text-xs"><span className="font-semibold">{t('project.stages.toClient')} </span>{s.client_note}</p>}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {(s.start_date || s.due_date) && <span>{s.start_date ? fmtDate(s.start_date) : '…'} → {s.due_date ? fmtDate(s.due_date) : '…'}</span>}
                    <span>{t('project.stages.taskCount', { done: s.tasks_done, total: s.tasks_total })}</span>
                    <span>{s.visible_to_client ? t('project.stages.visible') : t('project.stages.hidden')}</span>
                    {milestone && <span className="font-semibold text-foreground">{s.billing_cents != null ? money(s.billing_cents, project.currency) : t('project.stages.amountTbd')}{s.invoiced_at && ` · ${t('project.stages.invoiced')}`}</span>}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-9 sm:pl-0">
                <select aria-label={t('project.stages.statusOf', { name: s.name })} value={s.status} className="border border-input bg-card px-2 py-1.5 text-xs font-semibold"
                  onChange={(e) => setChange({ stage: s, to: e.target.value as Stage['status'] })}>
                  {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <Button size="sm" onClick={() => setEditing(s)}>{t('common.edit')}</Button>
                <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(s)}>{t('common.delete')}</Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <StageDialog project={project} stage={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={onChanged} />
      <StatusDialog project={project} change={change} onClose={() => setChange(null)} onSaved={onChanged} />
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} danger confirmLabel={t('common.delete')}
        title={t('project.stages.deleteAsk', { name: removing?.name ?? '' })}>
        {t('project.stages.deleteText')}
      </Confirm>
    </div>
  )
}
