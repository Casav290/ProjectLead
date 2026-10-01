import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Checkbox, Confirm, ErrorNote, Field, Input, Select, Textarea, toast } from '../../components/ui'
import { api, errorText } from '../../lib/api'
import { fmtDateTime, fmtRelative } from '../../lib/format'
import type { ProjectDetail } from '../../lib/types'
import { clientRecipients, RecipientPicker, type Recipient } from './Emails'

type Props = { project: ProjectDetail; onChanged: () => void }
type Report = { subject: string; text: string; html: string; recipients: string[]; portalUrl: string | null
  history: { id: string; recipients: string[]; subject: string; automatic: boolean; sent_at: string; sent_by_name: string | null }[] }

const FREQUENCY: Record<ProjectDetail['update_frequency'], string> = {
  none: 'Pas d’envoi automatique', weekly: 'Chaque semaine', biweekly: 'Toutes les deux semaines', monthly: 'Chaque mois',
}

/** Un interrupteur net, pour les réglages qui s'appliquent tout de suite. */
function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={clsx('flex cursor-pointer items-start justify-between gap-4 py-2.5', disabled && 'pointer-events-none opacity-50')}>
      <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className={clsx('relative mt-0.5 h-5 w-9 shrink-0 border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
        checked ? 'border-accent bg-accent' : 'border-input bg-muted')}>
        <span className={clsx('absolute top-[2px] h-3.5 w-3.5 bg-white transition-[left]', checked ? 'left-[18px]' : 'left-[2px] border border-input')} />
      </span>
    </label>
  )
}

function PortalSettings({ project, onChanged }: Props) {
  const [regen, setRegen] = useState(false)
  const set = async (patch: Partial<ProjectDetail>) => {
    try { await api.patch(`/projects/${project.id}`, patch); onChanged() } catch (e) { toast(errorText(e)) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(project.portal_url); toast('Lien copié.') } catch { toast('Copie impossible : sélectionnez le lien à la main.') }
  }
  const regenerate = async () => {
    try { await api.post(`/projects/${project.id}/portal/regenerate`); toast('Nouveau lien créé ; l’ancien ne fonctionne plus.'); onChanged() } catch (e) { toast(errorText(e)) }
  }
  const visibleStages = project.stages.filter((s) => s.visible_to_client).length
  return (
    <Card title="Page de suivi du client">
      <div className="divide-y divide-border px-4">
        <Switch checked={project.portal_enabled} onChange={(v) => set({ portal_enabled: v })} label="Page de suivi ouverte"
          hint="Le client suit son projet en ligne, sans compte, grâce à un lien personnel." />
        {project.portal_enabled && (
          <div className="space-y-2 py-3">
            <div className="flex gap-2">
              <Input readOnly value={project.portal_url} aria-label="Lien de la page de suivi" className="min-w-0 flex-1 bg-head font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button onClick={copy}>Copier</Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <a href={project.portal_url} target="_blank" rel="noreferrer" className="font-bold text-accent hover:underline">Ouvrir la page comme le client</a>
              <button className="font-bold text-muted-foreground hover:text-late" onClick={() => setRegen(true)}>Régénérer le lien</button>
            </div>
          </div>
        )}
        <Switch checked={project.portal_show_tasks} onChange={(v) => set({ portal_show_tasks: v })} label="Montrer les tâches suivies"
          hint="Seulement les tâches cochées « visible par le client »." />
        <Switch checked={project.portal_show_time} onChange={(v) => set({ portal_show_time: v })} label="Montrer le temps facturable"
          hint="Les heures facturables, mois par mois." />
      </div>
      <p className="border-t border-border bg-head px-4 py-2.5 text-xs text-muted-foreground">
        Le client voit {visibleStages} étape{visibleStages > 1 ? 's' : ''} sur {project.stages.length}, les points d’avancement partagés et les fichiers rendus visibles.{' '}
        <Link to={`/projets/${project.id}/etapes`} className="font-semibold text-accent">Choisir les étapes</Link>
      </p>
      <Confirm open={regen} onClose={() => setRegen(false)} onConfirm={regenerate} confirmLabel="Régénérer" danger title="Régénérer le lien ?">
        L’ancien lien cessera de fonctionner tout de suite. Utile si le lien a circulé au-delà du client.
      </Confirm>
    </Card>
  )
}

/** Le suivi du client : page en ligne, envoi périodique, envoi à la demande avec aperçu. */
export default function FollowUp({ project, onChanged }: Props) {
  const [message, setMessage] = useState('')
  const [debounced, setDebounced] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [to, setTo] = useState<string[] | null>(null)
  const [sending, setSending] = useState(false)
  const [view, setView] = useState<'html' | 'text'>('html')

  useEffect(() => { const t = setTimeout(() => setDebounced(message.trim()), 400); return () => clearTimeout(t) }, [message])
  const load = () => api.get<Report>(`/projects/${project.id}/client-report?message=${encodeURIComponent(debounced)}`)
    .then((r) => { setReport(r); setError(null); setTo((x) => x ?? r.recipients) }).catch(setError)
  // Le projet rechargé (étapes, réglages) se reflète aussi dans l'aperçu.
  useEffect(() => { load() }, [project, debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const options: Recipient[] = [...clientRecipients(project)]
  for (const e of report?.recipients ?? []) if (!options.some((o) => o.email === e)) options.push({ email: e })
  const receives = new Set(project.contacts.filter((c) => c.receives_updates && c.email).map((c) => c.email!.toLowerCase()))
  for (const o of options) if (receives.has(o.email)) o.label = `${o.label ?? ''}${o.label ? ' · ' : ''}reçoit le suivi`

  const send = async () => {
    if (!to?.length) { toast(errorText(new Error('no_recipient'))); return }
    setSending(true)
    try {
      const r = await api.post<{ recipients: string[] }>(`/projects/${project.id}/client-report`, { recipients: to, message: message.trim() || null })
      toast(`Suivi envoyé à ${r.recipients.join(', ')}.`)
      setMessage(''); onChanged()
    } catch (e) { toast(errorText(e)) } finally { setSending(false) }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <PortalSettings project={project} onChanged={onChanged} />
        <Card title="Envoi automatique">
          <div className="space-y-2 px-4 py-3">
            <Field label="Fréquence">
              <Select value={project.update_frequency} onChange={async (e) => {
                try { await api.patch(`/projects/${project.id}`, { update_frequency: e.target.value }); toast('Fréquence enregistrée.'); onChanged() } catch (err) { toast(errorText(err)) }
              }}>
                {Object.entries(FREQUENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground">
              {project.update_frequency === 'none' ? 'Le suivi part seulement quand vous l’envoyez.' : 'Le suivi part tout seul aux contacts qui le reçoivent, avec le contenu de l’aperçu.'}
              {project.last_update_sent_at && <> Dernier envoi {fmtRelative(project.last_update_sent_at)}.</>}
            </p>
          </div>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card title="Envoyer le suivi maintenant">
          <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <Field label="Mot d’introduction" hint="Remplace la phrase d’ouverture du message.">
              <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Voici où en est le projet « ${project.name} ».`} />
            </Field>
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Destinataires</p>
              {to === null ? <p className="text-sm text-muted-foreground">…</p> : <RecipientPicker options={options} value={to} onChange={setTo} />}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">{to?.length ? `${to.length} destinataire${to.length > 1 ? 's' : ''}` : 'Choisissez au moins un destinataire.'}</p>
            <Button variant="primary" onClick={send} disabled={sending || !to?.length}>{sending ? 'Envoi…' : 'Envoyer le suivi'}</Button>
          </div>
        </Card>

        <Card title="Aperçu" action={
          <div className="flex border border-input text-xs font-bold" role="group" aria-label="Format de l'aperçu">
            {(['html', 'text'] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}
                className={clsx('px-2.5 py-1', view === v ? 'bg-accent text-white' : 'bg-card text-muted-foreground hover:bg-muted')}>{v === 'html' ? 'Mise en page' : 'Texte'}</button>
            ))}
          </div>}>
          <ErrorNote error={error} />
          {report && <p className="border-b border-border px-4 py-2 text-sm"><span className="text-muted-foreground">Objet : </span><b>{report.subject}</b></p>}
          {!report ? <p className="p-4 text-sm text-muted-foreground">Préparation de l’aperçu…</p>
            : view === 'html' ? <iframe title="Aperçu du message" sandbox="" srcDoc={report.html} className="block h-[560px] w-full border-0 bg-[#eceae7]" />
            : <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed">{report.text}</pre>}
        </Card>

        <Card title="Historique des envois">
          {!report?.history.length ? <p className="px-4 py-3 text-sm text-muted-foreground">Aucun suivi envoyé pour l’instant.</p> : (
            <ul className="divide-y divide-border">
              {report.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{h.recipients.join(', ')}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(h.sent_at)} · {h.automatic ? 'automatique' : h.sent_by_name ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
