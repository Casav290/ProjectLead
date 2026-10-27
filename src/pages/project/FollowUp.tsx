import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Checkbox, Confirm, ErrorNote, Field, Input, Select, Textarea, toast } from '../../components/ui'
import { isLocale, labels, LOCALE_NAMES, LOCALES, useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { fmtDateTime, fmtRelative } from '../../lib/format'
import type { ProjectDetail } from '../../lib/types'
import { clientRecipients, RecipientPicker, type Recipient } from './Emails'

type Props = { project: ProjectDetail; onChanged: () => void }
type Report = { subject: string; text: string; html: string; recipients: string[]; portalUrl: string | null
  history: { id: string; recipients: string[]; subject: string; automatic: boolean; sent_at: string; sent_by_name: string | null }[] }

const FREQUENCY = labels('project.followUp.frequency', ['none', 'weekly', 'biweekly', 'monthly'])

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
  const t = useT()
  const [regen, setRegen] = useState(false)
  const set = async (patch: Partial<ProjectDetail>) => {
    try { await api.patch(`/projects/${project.id}`, patch); onChanged() } catch (e) { toast(errorText(e)) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(project.portal_url); toast(t('project.followUp.linkCopied')) } catch { toast(t('project.followUp.copyFailed')) }
  }
  const regenerate = async () => {
    try { await api.post(`/projects/${project.id}/portal/regenerate`); toast(t('project.followUp.linkRegenerated')); onChanged() } catch (e) { toast(errorText(e)) }
  }
  const visibleStages = project.stages.filter((s) => s.visible_to_client).length
  return (
    <Card title={t('project.followUp.portalTitle')}>
      <div className="divide-y divide-border px-4">
        <Switch checked={project.portal_enabled} onChange={(v) => set({ portal_enabled: v })} label={t('project.followUp.portalOpen')}
          hint={t('project.followUp.portalOpenHint')} />
        {project.portal_enabled && (
          <div className="space-y-2 py-3">
            <div className="flex gap-2">
              <Input readOnly value={project.portal_url} aria-label={t('project.followUp.portalLinkAria')} className="min-w-0 flex-1 bg-head font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button onClick={copy}>{t('project.followUp.copy')}</Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <a href={project.portal_url} target="_blank" rel="noreferrer" className="font-bold text-accent hover:underline">{t('project.followUp.openAsClient')}</a>
              <button className="font-bold text-muted-foreground hover:text-late" onClick={() => setRegen(true)}>{t('project.followUp.regenerateLink')}</button>
            </div>
          </div>
        )}
        <Switch checked={project.portal_show_tasks} onChange={(v) => set({ portal_show_tasks: v })} label={t('project.followUp.showTasks')}
          hint={t('project.followUp.showTasksHint')} />
        <Switch checked={project.portal_show_time} onChange={(v) => set({ portal_show_time: v })} label={t('project.followUp.showTime')}
          hint={t('project.followUp.showTimeHint')} />
      </div>
      <p className="border-t border-border bg-head px-4 py-2.5 text-xs text-muted-foreground">
        {t('project.followUp.clientSees', { n: visibleStages, total: project.stages.length })}{' '}
        <Link to={`/projets/${project.id}/etapes`} className="font-semibold text-accent">{t('project.followUp.chooseStages')}</Link>
      </p>
      <Confirm open={regen} onClose={() => setRegen(false)} onConfirm={regenerate} confirmLabel={t('project.followUp.regenerate')} danger title={t('project.followUp.regenerateAsk')}>
        {t('project.followUp.regenerateText')}
      </Confirm>
    </Card>
  )
}

/**
 * La langue des documents du client (suivi envoyé, page de suivi, brouillons de facture) : `doc_locale` du projet,
 * null = la langue de l'entreprise.
 */
function DocLocale({ project, onChanged }: Props) {
  const t = useT()
  const value = isLocale(project.doc_locale) ? project.doc_locale : ''
  const change = async (v: string) => {
    try { await api.patch(`/projects/${project.id}`, { doc_locale: isLocale(v) ? v : null }); toast(t('project.followUp.docLocaleSaved')); onChanged() }
    catch (e) { toast(errorText(e)) }
  }
  return (
    <Card title={t('project.followUp.docLocaleTitle')}>
      <div className="space-y-2 px-4 py-3">
        <Field label={t('project.followUp.docLocaleLabel')}>
          <Select value={value} onChange={(e) => change(e.target.value)} data-doc-locale="">
            <option value="">{t('project.followUp.docLocaleCompany')}</option>
            {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">{t('project.followUp.docLocaleHint')}</p>
      </div>
    </Card>
  )
}

/** Le suivi du client : page en ligne, envoi périodique, envoi à la demande avec aperçu. */
export default function FollowUp({ project, onChanged }: Props) {
  const t = useT()
  const [message, setMessage] = useState('')
  const [debounced, setDebounced] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [to, setTo] = useState<string[] | null>(null)
  const [sending, setSending] = useState(false)
  const [view, setView] = useState<'html' | 'text'>('html')

  useEffect(() => { const h = setTimeout(() => setDebounced(message.trim()), 400); return () => clearTimeout(h) }, [message])
  const load = () => api.get<Report>(`/projects/${project.id}/client-report?message=${encodeURIComponent(debounced)}`)
    .then((r) => { setReport(r); setError(null); setTo((x) => x ?? r.recipients) }).catch(setError)
  // Le projet rechargé (étapes, réglages) se reflète aussi dans l'aperçu.
  useEffect(() => { load() }, [project, debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const options: Recipient[] = [...clientRecipients(project)]
  for (const e of report?.recipients ?? []) if (!options.some((o) => o.email === e)) options.push({ email: e })
  const receives = new Set(project.contacts.filter((c) => c.receives_updates && c.email).map((c) => c.email!.toLowerCase()))
  for (const o of options) if (receives.has(o.email)) o.label = `${o.label ?? ''}${o.label ? ' · ' : ''}${t('project.followUp.receivesUpdates')}`

  const send = async () => {
    if (!to?.length) { toast(errorText(new Error('no_recipient'))); return }
    setSending(true)
    try {
      const r = await api.post<{ recipients: string[] }>(`/projects/${project.id}/client-report`, { recipients: to, message: message.trim() || null })
      toast(t('project.followUp.sentTo', { list: r.recipients.join(', ') }))
      setMessage(''); onChanged()
    } catch (e) { toast(errorText(e)) } finally { setSending(false) }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <PortalSettings project={project} onChanged={onChanged} />
        <DocLocale project={project} onChanged={onChanged} />
        <Card title={t('project.followUp.autoTitle')}>
          <div className="space-y-2 px-4 py-3">
            <Field label={t('project.followUp.frequencyLabel')}>
              <Select value={project.update_frequency} onChange={async (e) => {
                try { await api.patch(`/projects/${project.id}`, { update_frequency: e.target.value }); toast(t('project.followUp.frequencySaved')); onChanged() } catch (err) { toast(errorText(err)) }
              }}>
                {Object.entries(FREQUENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground">
              {project.update_frequency === 'none' ? t('project.followUp.autoNone') : t('project.followUp.autoOn')}
              {project.last_update_sent_at && <>{' '}{t('project.followUp.lastSent', { when: fmtRelative(project.last_update_sent_at) })}</>}
            </p>
          </div>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card title={t('project.followUp.sendNowTitle')}>
          <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <Field label={t('project.followUp.intro')} hint={t('project.followUp.introHint')}>
              <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('project.followUp.introPlaceholder', { name: project.name })} />
            </Field>
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('project.followUp.recipients')}</p>
              {to === null ? <p className="text-sm text-muted-foreground">…</p> : <RecipientPicker options={options} value={to} onChange={setTo} />}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">{to?.length ? t('project.followUp.recipientCount', { n: to.length }) : t('project.followUp.pickRecipient')}</p>
            <Button variant="primary" onClick={send} disabled={sending || !to?.length}>{sending ? t('project.followUp.sending') : t('project.followUp.send')}</Button>
          </div>
        </Card>

        <Card title={t('project.followUp.preview')} action={
          <div className="flex border border-input text-xs font-bold" role="group" aria-label={t('project.followUp.previewFormat')}>
            {(['html', 'text'] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}
                className={clsx('px-2.5 py-1', view === v ? 'bg-accent text-white' : 'bg-card text-muted-foreground hover:bg-muted')}>{v === 'html' ? t('project.followUp.viewHtml') : t('project.followUp.viewText')}</button>
            ))}
          </div>}>
          <ErrorNote error={error} />
          {report && <p className="border-b border-border px-4 py-2 text-sm"><span className="text-muted-foreground">{t('project.followUp.subject')} </span><b>{report.subject}</b></p>}
          {!report ? <p className="p-4 text-sm text-muted-foreground">{t('project.followUp.previewLoading')}</p>
            : view === 'html' ? <iframe title={t('project.followUp.previewAria')} sandbox="" srcDoc={report.html} className="block h-[560px] w-full border-0 bg-[#eceae7]" />
            : <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed">{report.text}</pre>}
        </Card>

        <Card title={t('project.followUp.history')}>
          {!report?.history.length ? <p className="px-4 py-3 text-sm text-muted-foreground">{t('project.followUp.noHistory')}</p> : (
            <ul className="divide-y divide-border">
              {report.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{h.recipients.join(', ')}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(h.sent_at)} · {h.automatic ? t('project.followUp.automatic') : h.sent_by_name ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
