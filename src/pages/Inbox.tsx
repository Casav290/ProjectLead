import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { fmtDateTime, fmtRelative, STATUS_LABEL } from '../lib/format'
import { labels, useT } from '../i18n'
import { useApp, useLoad } from '../lib/store'
import type { Client, ProjectSummary } from '../lib/types'
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, Input, Modal, PageHeader, PeoplePicker, Select, Spinner, Tabs, Textarea,
         toast } from '../components/ui'

type InboxItem = { id: string; from_email: string; from_name: string | null; to_emails: string[]; subject: string; snippet: string; received_at: string
  status: 'new' | 'linked' | 'ignored'; project_id: string | null; project_name: string | null; client_id: string | null; client_name: string | null
  mailbox_email: string | null; known_client: { id: string; name: string } | null }
type Message = { id: string; from_email: string; from_name: string | null; to_emails: string[]; subject: string; body: string | null
  received_at: string; status: InboxItem['status']; project_id: string | null; client_id: string | null }

// Les libellés sont lus à chaque accès (labels, getters) : ils suivent la langue en cours.
const FILTER_LABEL = labels('inbox.filter', ['new', 'linked', 'ignored', 'all'])
const STATUS_TEXT = labels('inbox.status', ['new', 'linked', 'ignored'])
const FILTERS = (['new', 'linked', 'ignored', 'all'] as const).map((id) => ({ id, get label() { return FILTER_LABEL[id] } }))
const STATUS: Record<string, { label: string; tone: 'accent' | 'ok' | 'muted' }> = {
  new: { get label() { return STATUS_TEXT.new }, tone: 'accent' }, linked: { get label() { return STATUS_TEXT.linked }, tone: 'ok' },
  ignored: { get label() { return STATUS_TEXT.ignored }, tone: 'muted' },
}
const sender = (m: { from_name: string | null; from_email: string }) => m.from_name || m.from_email

/**
 * La boîte de réception des projets : chaque email reçu peut ouvrir un projet, rejoindre un
 * projet existant (éventuellement en tâche), ou être écarté.
 */
export default function Inbox() {
  const t = useT()
  const { refresh } = useApp()
  const [params, setParams] = useSearchParams()
  const status = params.get('filtre') ?? 'new'
  const selected = params.get('m')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(h) }, [q])
  const { data, error, loading, reload } = useLoad<InboxItem[]>(`/mail/inbox?status=${status}&q=${encodeURIComponent(debounced)}`)
  const { data: boxes } = useLoad<{ mailboxes: unknown[] }>('/mail/mailboxes')

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k)
    setParams(p, { replace: true })
  }
  const item = data?.find((x) => x.id === selected) ?? null
  const changed = async () => { await reload(); refresh() }

  return (
    <div>
      <PageHeader title={t('inbox.title')} subtitle={t('inbox.subtitle')} />
      {boxes && boxes.mailboxes.length === 0 && <CaptureHelp />}
      <div className={clsx('grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]')}>
        <div className={clsx('min-w-0', selected && 'hidden lg:block')}>
          <Tabs active={status} onChange={(id) => go({ filtre: id === 'new' ? null : id, m: null })} tabs={FILTERS} />
          <Input type="search" placeholder={t('inbox.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" aria-label={t('common.search')} />
          <ErrorNote error={error} />
          {loading && !data ? <Spinner /> : !data?.length ? (
            <Empty title={debounced ? t('inbox.empty.noMatch') : status === 'new' ? t('inbox.empty.nothingToSort') : t('inbox.empty.none')}>
              {status === 'new' && !debounced && t('inbox.empty.hint')}
            </Empty>
          ) : (
            <ul className="border border-border bg-card">
              {data.map((m) => (
                <li key={m.id} className="border-b border-border last:border-b-0">
                  <button type="button" onClick={() => go({ m: m.id })} aria-current={m.id === selected}
                    className={clsx('block w-full px-4 py-3 text-left hover:bg-head', m.id === selected && 'bg-accent-veil hover:bg-accent-veil',
                      m.status === 'new' && 'border-l-[3px] border-l-accent')}>
                    <div className="flex items-baseline gap-2">
                      <span className={clsx('min-w-0 flex-1 truncate text-sm', m.status === 'new' ? 'font-extrabold' : 'font-semibold')}>{sender(m)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{fmtRelative(m.received_at)}</span>
                    </div>
                    <div className="truncate text-sm">{m.subject || t('inbox.noSubject')}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{m.snippet}</div>
                    {(m.project_name || m.known_client || status === 'all') && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {status === 'all' && <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>}
                        {m.project_name ? <Badge tone="ok" className="max-w-full truncate">{m.project_name}</Badge>
                          : m.known_client && <Badge tone="info" className="max-w-full truncate">{t('inbox.clientBadge', { name: m.known_client.name })}</Badge>}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={clsx('min-w-0', !selected && 'hidden lg:block')}>
          {selected ? <Reader key={selected} id={selected} item={item} onBack={() => go({ m: null })} onChanged={changed} />
            : <div className="hidden h-full min-h-[300px] place-items-center border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground lg:grid">
                {t('inbox.choose')}</div>}
        </div>
      </div>
    </div>
  )
}

function CaptureHelp() {
  const t = useT()
  const { me } = useApp()
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast(t('inbox.copied')) } catch { toast(t('inbox.copyFailed')) } }
  if (!me) return null
  return (
    <div className="mb-5 border border-border border-l-[3px] border-l-accent bg-card px-4 py-3 text-sm">
      <p className="font-bold">{t('inbox.capture.title')}</p>
      <p className="mt-1 text-muted-foreground">
        {t('inbox.capture.before')} <Link to="/reglages/emails" className="font-semibold text-accent hover:underline">{t('inbox.capture.link')}</Link>
        {me.inboundAddress ? t('inbox.capture.orForward') : ''}{t('inbox.capture.after')}
      </p>
      {me.inboundAddress && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 max-w-full truncate bg-muted px-2 py-1 font-mono text-xs">{me.inboundAddress}</code>
          <Button size="sm" onClick={() => copy(me.inboundAddress!)}>{t('inbox.capture.copyAddress')}</Button>
        </div>
      )}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-semibold">{t('inbox.capture.script')}</summary>
        <p className="mt-1">{t('inbox.capture.postTo')}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 max-w-full truncate bg-muted px-2 py-1 font-mono">{me.inboundUrl}</code>
          <Button size="sm" onClick={() => copy(me.inboundUrl)}>{t('inbox.capture.copy')}</Button>
        </div>
      </details>
    </div>
  )
}

function Reader({ id, item, onBack, onChanged }: { id: string; item: InboxItem | null; onBack: () => void; onChanged: () => void }) {
  const t = useT()
  const { data: m, error, loading, reload } = useLoad<Message>(`/mail/messages/${id}`)
  const [modal, setModal] = useState<'project' | 'link' | 'reply' | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading && !m) return <Spinner />
  if (error || !m) return <div className="space-y-3"><Button size="sm" onClick={onBack}>← {t('common.back')}</Button><ErrorNote error={error ?? 'not_found'} /></div>

  const setStatus = async (status: 'new' | 'ignored') => {
    setBusy(true)
    try {
      await api.post(`/mail/messages/${m.id}/status`, { status })
      toast(status === 'ignored' ? t('inbox.reader.ignoredToast') : t('inbox.reader.resortedToast'))
      await reload(); onChanged()
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  const done = async () => { setModal(null); await reload(); onChanged() }
  const projectName = item?.project_id === m.project_id ? item?.project_name : null

  return (
    <article className="border border-border bg-card">
      <header className="space-y-3 border-b border-border px-4 py-4 sm:px-5">
        <Button size="sm" className="lg:hidden" onClick={onBack}>{t('inbox.reader.backToList')}</Button>
        <div className="flex flex-wrap items-start gap-2">
          <h2 className="min-w-0 flex-1 font-display text-xl [overflow-wrap:anywhere]">{m.subject || t('inbox.noSubject')}</h2>
          <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
        </div>
        <div className="text-sm">
          {/* i18n-ok : chevrons de l'adresse */}
          <div className="[overflow-wrap:anywhere]"><span className="font-bold">{sender(m)}</span>{m.from_name && <span className="text-muted-foreground"> &lt;{m.from_email}&gt;</span>}</div>
          <div className="text-xs text-muted-foreground">
            {fmtDateTime(m.received_at)}{m.to_emails?.length ? ` · ${t('inbox.reader.to', { list: m.to_emails.join(', ') })}` : ''}{item?.mailbox_email ? ` · ${t('inbox.reader.mailbox', { email: item.mailbox_email })}` : ''}
          </div>
          {m.project_id && (
            <p className="mt-2 text-sm">{t('inbox.reader.linkedTo')} <Link to={`/projets/${m.project_id}`} className="font-bold text-accent hover:underline">{projectName ?? t('inbox.reader.openProject')}</Link></p>
          )}
          {!m.project_id && item?.known_client && <p className="mt-2 text-xs text-muted-foreground">{t('inbox.reader.knownSender')} <b className="text-foreground">{item.known_client.name}</b>.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {m.status !== 'linked' && <Button variant="primary" onClick={() => setModal('project')}>{t('inbox.reader.createProject')}</Button>}
          {m.status !== 'linked' && <Button onClick={() => setModal('link')}>{t('inbox.reader.linkProject')}</Button>}
          <Button onClick={() => setModal('reply')}>{t('inbox.reader.reply')}</Button>
          {m.status === 'new' && <Button variant="ghost" disabled={busy} onClick={() => setStatus('ignored')}>{t('inbox.reader.ignore')}</Button>}
          {m.status !== 'new' && <Button variant="ghost" disabled={busy} onClick={() => setStatus('new')}>{t('inbox.reader.resort')}</Button>}
        </div>
      </header>
      <div className="px-4 py-4 sm:px-5">
        {m.body ? <div className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body}</div>
          : <p className="text-sm text-muted-foreground">{t('inbox.reader.noBody')}</p>}
      </div>
      {modal === 'project' && <CreateProject m={m} item={item} onClose={() => setModal(null)} onDone={onChanged} />}
      {modal === 'link' && <LinkProject m={m} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'reply' && <Reply m={m} onClose={() => setModal(null)} onDone={done} />}
    </article>
  )
}

function CreateProject({ m, item, onClose, onDone }: { m: Message; item: InboxItem | null; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const { me, team } = useApp()
  const navigate = useNavigate()
  const { data: clients } = useLoad<Client[]>('/clients')
  const { data: templates } = useLoad<ProjectSummary[]>('/projects?template=1')
  const known = item?.known_client ?? null
  const [f, setF] = useState({
    name: m.subject || t('inbox.create.defaultName', { name: sender(m) }), client: m.client_id ?? known?.id ?? 'auto', client_name: '', template_id: '',
    member_ids: me ? [me.user.id] : [], status: 'lead' as 'lead' | 'planned' | 'active', first_task: true,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api.post<{ id: string }>(`/mail/messages/${m.id}/project`, {
        name: f.name, template_id: f.template_id || null, member_ids: f.member_ids, status: f.status, first_task: f.first_task,
        ...(f.client === 'auto' ? (f.client_name.trim() ? { client_name: f.client_name.trim() } : {}) : { client_id: f.client }),
      })
      toast(t('inbox.create.toast'))
      onDone()
      navigate(`/projets/${r.id}`)
    } catch (err) { setError(errorText(err)); setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} wide title={t('inbox.create.title')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="mail-project" disabled={busy || !f.name.trim()}>
        {busy ? t('inbox.create.creating') : t('inbox.create.submit')}</Button></>}>
      <form id="mail-project" onSubmit={submit} className="space-y-3">
        <Field label={t('inbox.create.name')}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('inbox.create.client')} hint={f.client === 'auto' ? t('inbox.create.clientHint', { email: m.from_email }) : undefined}>
          <Select value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
            {known && <option value={known.id}>{t('inbox.create.recognized', { name: known.name })}</option>}
            <option value="auto">{t('inbox.create.newClient')}</option>
            {(clients ?? []).filter((c) => c.id !== known?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {f.client === 'auto' && (
          <Field label={t('inbox.create.newClientName')} hint={t('inbox.create.newClientHint')}>
            <Input value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} placeholder={m.from_name ?? ''} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('inbox.create.template')}>
            <Select value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })}>
              <option value="">{t('inbox.create.blank')}</option>
              {(templates ?? []).map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </Select>
          </Field>
          <Field label={t('inbox.create.status')}>
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
              <option value="lead">{STATUS_LABEL.lead}</option>
              <option value="planned">{STATUS_LABEL.planned}</option>
              <option value="active">{STATUS_LABEL.active}</option>
            </Select>
          </Field>
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">{t('inbox.create.members')}</span>
          <PeoplePicker people={team.filter((p) => p.active)} value={f.member_ids} onChange={(member_ids) => setF({ ...f, member_ids })} />
        </div>
        <Checkbox checked={f.first_task} onChange={(v) => setF({ ...f, first_task: v })}
          label={<>{t('inbox.create.firstTask', { name: sender(m) })} <span className="text-muted-foreground">{t('inbox.create.firstTaskNote')}</span></>} />
        <p className="text-xs text-muted-foreground">{t('inbox.create.bodyNote')}</p>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
      </form>
    </Modal>
  )
}

function LinkProject({ m, onClose, onDone }: { m: Message; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const { data: projects } = useLoad<ProjectSummary[]>('/projects')
  const open = (projects ?? []).filter((p) => !['done', 'cancelled'].includes(p.status))
  const [projectId, setProjectId] = useState('')
  const [asTask, setAsTask] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Le projet du client de l'expéditeur, proposé d'abord.
  useEffect(() => {
    if (projectId || !m.client_id) return
    const p = open.find((x) => x.client_id === m.client_id)
    if (p) setProjectId(p.id)
  }, [open, m.client_id, projectId])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api.post<{ task_id: string | null }>(`/mail/messages/${m.id}/link`, { project_id: projectId, as_task: asTask })
      toast(r.task_id ? t('inbox.link.toastTask') : t('inbox.link.toast'))
      onDone()
    } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={t('inbox.reader.linkProject')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="mail-link" disabled={busy || !projectId}>{t('inbox.link.submit')}</Button></>}>
      <form id="mail-link" onSubmit={submit} className="space-y-3">
        <Field label={t('inbox.link.project')}>
          <Select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('inbox.link.choose')}</option>
            {open.map((p) => <option key={p.id} value={p.id}>{p.client_name ? `${p.name} — ${p.client_name}` : p.name}</option>)}
          </Select>
        </Field>
        <Checkbox checked={asTask} onChange={setAsTask} label={t('inbox.link.asTask')} />
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
      </form>
    </Modal>
  )
}

function Reply({ m, onClose, onDone }: { m: Message; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [body, setBody] = useState(`${t('inbox.reply.greeting')}${m.from_name ? ` ${m.from_name.split(' ')[0]}` : ''},\n\n`)
  const [cc, setCc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const list = cc.split(/[\s,;]+/).filter(Boolean)
    const bad = list.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
    if (bad) { setError(t('inbox.reply.invalidEmail', { email: bad })); return }
    setBusy(true); setError(null)
    try {
      await api.post(`/mail/messages/${m.id}/reply`, { body, cc: list })
      toast(t('inbox.reply.sent'))
      onDone()
    } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} wide title={t('inbox.reply.title', { name: sender(m) })}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="mail-reply" disabled={busy || !body.trim()}>
        {busy ? t('inbox.reply.sending') : t('inbox.reply.send')}</Button></>}>
      <form id="mail-reply" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{t('inbox.reply.header', { email: m.from_email, subject: /^re\s*:/i.test(m.subject) ? m.subject : `Re: ${m.subject}` })}</p>
        <Field label={t('inbox.reply.cc')}><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder={t('inbox.reply.ccPlaceholder')} /></Field>
        <Field label={t('inbox.reply.message')} hint={t('inbox.reply.messageHint')}>
<Textarea rows={10} required value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
      </form>
    </Modal>
  )
}
