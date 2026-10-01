import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Button, Checkbox, Confirm, Empty, Field, Input, Modal, StageBadge, Textarea, toast } from '../../components/ui'
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
    if (milestone && d.billing.trim() && cents === null) { setError('Montant illisible : écrivez par exemple 2500 ou 2500.50.'); return }
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
    <Modal open={open} onClose={onClose} title={stage ? 'Modifier l’étape' : 'Nouvelle étape'} wide
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="stage" disabled={busy || !d.name.trim()}>Enregistrer</Button></>}>
      <form id="stage" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" className="sm:col-span-2"><Input required value={d.name} onChange={up('name')} placeholder="Ex. Cadrage, Maquettes, Livraison" /></Field>
        <Field label="Description (pour l’équipe)" className="sm:col-span-2"><Textarea rows={3} value={d.description} onChange={up('description')} /></Field>
        <Field label="Note pour le client" hint="Visible sur la page de suivi et dans les emails de suivi." className="sm:col-span-2">
          <Textarea rows={2} value={d.client_note} onChange={up('client_note')} placeholder="Ex. Nous attendons vos textes pour avancer." />
        </Field>
        <Field label="Début"><Input type="date" value={d.start_date} onChange={up('start_date')} /></Field>
        <Field label="Échéance"><Input type="date" value={d.due_date} min={d.start_date || undefined} onChange={up('due_date')} /></Field>
        {milestone && <Field label={`Montant facturé à l’étape (${project.currency})`}><Input inputMode="decimal" value={d.billing} onChange={up('billing')} placeholder="2500" /></Field>}
        <Checkbox className="sm:col-span-2" label="Visible par le client (page de suivi et emails)"
          checked={d.visible_to_client} onChange={(v) => setD({ ...d, visible_to_client: v })} />
        {error && <p role="alert" className="text-sm text-late sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  )
}

/** Changer le statut d'une étape, en prévenant le client si on le souhaite. */
function StatusDialog({ project, change, onClose, onSaved }:
  { project: ProjectDetail; change: { stage: Stage; to: Stage['status'] } | null; onClose: () => void; onSaved: () => void }) {
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
      if (r.report?.error) toast(`Statut changé, mais le client n’a pas été prévenu : ${errorText(r.report.error)}`)
      else if (r.report?.recipients) toast(`Client prévenu (${r.report.recipients.join(', ')}).`)
      else toast('Statut changé.')
      onClose(); onSaved()
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Étape « ${change.stage.name} »`}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={submit} disabled={busy}>Confirmer</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="flex flex-wrap items-center gap-2">Passer de <StageBadge status={change.stage.status} /> à <StageBadge status={change.to} /></p>
        {canNotify ? <Checkbox label="Prévenir le client par email (suivi du projet envoyé aux contacts qui le reçoivent)" checked={notify} onChange={setNotify} />
          : <p className="text-xs text-muted-foreground">{project.client ? 'Cette étape est cachée au client : il ne sera pas prévenu.' : 'Projet sans client : personne à prévenir.'}</p>}
      </div>
    </Modal>
  )
}

/** Les étapes du projet : ordre, contenu, statut, montant si facturé par étape. */
export default function Stages({ project, onChanged }: Props) {
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
    try { await api.del(`/projects/stages/${s.id}`); toast('Étape supprimée.'); onChanged() } catch (e) { toast(errorText(e)) }
  }
  const total = order.reduce((s, x) => s + (x.billing_cents ?? 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Les étapes découpent le projet en grandes phases ; le client les suit sur sa page.
          {milestone && <> Total facturé par étape : <b className="text-foreground">{money(total, project.currency)}</b>.</>}
        </p>
        <Button variant="primary" onClick={() => setEditing('new')}>Nouvelle étape</Button>
      </div>
      {!order.length ? <Empty title="Aucune étape">Par exemple : Cadrage, Conception, Réalisation, Livraison.</Empty> : (
        <ol className="space-y-2">
          {order.map((s, i) => (
            <li key={s.id} className={clsx('flex flex-col gap-3 border border-border border-l-4 bg-card p-3 sm:flex-row sm:items-center', stageEdge(s.status))}>
              <div className="flex items-start gap-3 sm:flex-1">
                <div className="flex shrink-0 flex-col">
                  <button className="px-1.5 text-xs leading-5 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${s.name}`}>▲</button>
                  <button className="px-1.5 text-xs leading-5 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Descendre ${s.name}`}>▼</button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold"><span className="mr-1.5 text-muted-foreground">{i + 1}.</span>{s.name}</p>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                  {s.client_note && <p className="mt-1 border-l-2 border-accent-light pl-2 text-xs"><span className="font-semibold">Au client : </span>{s.client_note}</p>}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {(s.start_date || s.due_date) && <span>{s.start_date ? fmtDate(s.start_date) : '…'} → {s.due_date ? fmtDate(s.due_date) : '…'}</span>}
                    <span>{s.tasks_done}/{s.tasks_total} tâche{s.tasks_total > 1 ? 's' : ''}</span>
                    <span>{s.visible_to_client ? 'Visible par le client' : 'Cachée au client'}</span>
                    {milestone && <span className="font-semibold text-foreground">{s.billing_cents != null ? money(s.billing_cents, project.currency) : 'Montant à définir'}{s.invoiced_at && ' · facturé'}</span>}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-9 sm:pl-0">
                <select aria-label={`Statut de ${s.name}`} value={s.status} className="border border-input bg-card px-2 py-1.5 text-xs font-semibold"
                  onChange={(e) => setChange({ stage: s, to: e.target.value as Stage['status'] })}>
                  {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <Button size="sm" onClick={() => setEditing(s)}>Modifier</Button>
                <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(s)}>Supprimer</Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <StageDialog project={project} stage={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={onChanged} />
      <StatusDialog project={project} change={change} onClose={() => setChange(null)} onSaved={onChanged} />
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} danger confirmLabel="Supprimer"
        title={`Supprimer l’étape « ${removing?.name ?? ''} » ?`}>
        Ses tâches restent dans le projet, simplement sans étape.
      </Confirm>
    </div>
  )
}
