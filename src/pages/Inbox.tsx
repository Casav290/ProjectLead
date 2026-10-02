import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { fmtDateTime, fmtRelative } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { Client, ProjectSummary } from '../lib/types'
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, Input, Modal, PageHeader, PeoplePicker, Select, Spinner, Tabs, Textarea,
         toast } from '../components/ui'

type InboxItem = { id: string; from_email: string; from_name: string | null; to_emails: string[]; subject: string; snippet: string; received_at: string
  status: 'new' | 'linked' | 'ignored'; project_id: string | null; project_name: string | null; client_id: string | null; client_name: string | null
  mailbox_email: string | null; known_client: { id: string; name: string } | null }
type Message = { id: string; from_email: string; from_name: string | null; to_emails: string[]; subject: string; body: string | null
  received_at: string; status: InboxItem['status']; project_id: string | null; client_id: string | null }

const FILTERS = [{ id: 'new', label: 'À trier' }, { id: 'linked', label: 'Rattachés' }, { id: 'ignored', label: 'Écartés' }, { id: 'all', label: 'Tous' }]
const STATUS: Record<string, { label: string; tone: 'accent' | 'ok' | 'muted' }> = {
  new: { label: 'À trier', tone: 'accent' }, linked: { label: 'Rattaché', tone: 'ok' }, ignored: { label: 'Écarté', tone: 'muted' },
}
const sender = (m: { from_name: string | null; from_email: string }) => m.from_name || m.from_email

/**
 * La boîte de réception des projets : chaque email reçu peut ouvrir un projet, rejoindre un
 * projet existant (éventuellement en tâche), ou être écarté.
 */
export default function Inbox() {
  const { refresh } = useApp()
  const [params, setParams] = useSearchParams()
  const status = params.get('filtre') ?? 'new'
  const selected = params.get('m')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t) }, [q])
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
      <PageHeader title="Emails" subtitle="Chaque demande reçue peut devenir un projet en deux clics." />
      {boxes && boxes.mailboxes.length === 0 && <CaptureHelp />}
      <div className={clsx('grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]')}>
        <div className={clsx('min-w-0', selected && 'hidden lg:block')}>
          <Tabs active={status} onChange={(id) => go({ filtre: id === 'new' ? null : id, m: null })} tabs={FILTERS} />
          <Input type="search" placeholder="Rechercher un objet, un expéditeur…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" aria-label="Rechercher" />
          <ErrorNote error={error} />
          {loading && !data ? <Spinner /> : !data?.length ? (
            <Empty title={debounced ? 'Aucun email ne correspond' : status === 'new' ? 'Rien à trier' : 'Aucun email ici'}>
              {status === 'new' && !debounced && 'Les nouveaux emails reçus arriveront ici.'}
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
                    <div className="truncate text-sm">{m.subject || '(sans objet)'}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{m.snippet}</div>
                    {(m.project_name || m.known_client || status === 'all') && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {status === 'all' && <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>}
                        {m.project_name ? <Badge tone="ok" className="max-w-full truncate">{m.project_name}</Badge>
                          : m.known_client && <Badge tone="info" className="max-w-full truncate">Client : {m.known_client.name}</Badge>}
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
                Choisissez un email pour le lire.</div>}
        </div>
      </div>
    </div>
  )
}

function CaptureHelp() {
  const { me } = useApp()
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast('Copié') } catch { toast('Copie impossible') } }
  if (!me) return null
  return (
    <div className="mb-5 border border-border border-l-[3px] border-l-accent bg-card px-4 py-3 text-sm">
      <p className="font-bold">Aucune boîte mail n'est encore branchée</p>
      <p className="mt-1 text-muted-foreground">
        Branchez votre messagerie (Gmail, Microsoft 365 ou IMAP) dans <Link to="/reglages/emails" className="font-semibold text-accent hover:underline">Réglages → Emails</Link>
        {me.inboundAddress ? ", ou transférez vos demandes à l'adresse de capture de l'entreprise" : ''} : les demandes de vos clients arriveront ici,
        prêtes à devenir des projets.
      </p>
      {me.inboundAddress && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 max-w-full truncate bg-muted px-2 py-1 font-mono text-xs">{me.inboundAddress}</code>
          <Button size="sm" onClick={() => copy(me.inboundAddress!)}>Copier l'adresse</Button>
        </div>
      )}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-semibold">Pour un script ou un relais de messagerie</summary>
        <p className="mt-1">Envoyez le message (JSON ou brut) en POST à :</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 max-w-full truncate bg-muted px-2 py-1 font-mono">{me.inboundUrl}</code>
          <Button size="sm" onClick={() => copy(me.inboundUrl)}>Copier</Button>
        </div>
      </details>
    </div>
  )
}

function Reader({ id, item, onBack, onChanged }: { id: string; item: InboxItem | null; onBack: () => void; onChanged: () => void }) {
  const { data: m, error, loading, reload } = useLoad<Message>(`/mail/messages/${id}`)
  const [modal, setModal] = useState<'project' | 'link' | 'reply' | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading && !m) return <Spinner />
  if (error || !m) return <div className="space-y-3"><Button size="sm" onClick={onBack}>← Retour</Button><ErrorNote error={error ?? 'not_found'} /></div>

  const setStatus = async (status: 'new' | 'ignored') => {
    setBusy(true)
    try {
      await api.post(`/mail/messages/${m.id}/status`, { status })
      toast(status === 'ignored' ? 'Email écarté' : 'Remis à trier')
      await reload(); onChanged()
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  const done = async () => { setModal(null); await reload(); onChanged() }
  const projectName = item?.project_id === m.project_id ? item?.project_name : null

  return (
    <article className="border border-border bg-card">
      <header className="space-y-3 border-b border-border px-4 py-4 sm:px-5">
        <Button size="sm" className="lg:hidden" onClick={onBack}>← Retour à la liste</Button>
        <div className="flex flex-wrap items-start gap-2">
          <h2 className="min-w-0 flex-1 font-display text-xl [overflow-wrap:anywhere]">{m.subject || '(sans objet)'}</h2>
          <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
        </div>
        <div className="text-sm">
          <div className="[overflow-wrap:anywhere]"><span className="font-bold">{sender(m)}</span>{m.from_name && <span className="text-muted-foreground"> &lt;{m.from_email}&gt;</span>}</div>
          <div className="text-xs text-muted-foreground">
            {fmtDateTime(m.received_at)}{m.to_emails?.length ? ` · à ${m.to_emails.join(', ')}` : ''}{item?.mailbox_email ? ` · boîte ${item.mailbox_email}` : ''}
          </div>
          {m.project_id && (
            <p className="mt-2 text-sm">Rattaché au projet <Link to={`/projets/${m.project_id}`} className="font-bold text-accent hover:underline">{projectName ?? 'ouvrir le projet'}</Link></p>
          )}
          {!m.project_id && item?.known_client && <p className="mt-2 text-xs text-muted-foreground">Expéditeur connu : client <b className="text-foreground">{item.known_client.name}</b>.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {m.status !== 'linked' && <Button variant="primary" onClick={() => setModal('project')}>Créer un projet</Button>}
          {m.status !== 'linked' && <Button onClick={() => setModal('link')}>Rattacher à un projet</Button>}
          <Button onClick={() => setModal('reply')}>Répondre</Button>
          {m.status === 'new' && <Button variant="ghost" disabled={busy} onClick={() => setStatus('ignored')}>Écarter</Button>}
          {m.status !== 'new' && <Button variant="ghost" disabled={busy} onClick={() => setStatus('new')}>Remettre à trier</Button>}
        </div>
      </header>
      <div className="px-4 py-4 sm:px-5">
        {m.body ? <div className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body}</div>
          : <p className="text-sm text-muted-foreground">Le texte de cet email n'a pas pu être relu chez le fournisseur.</p>}
      </div>
      {modal === 'project' && <CreateProject m={m} item={item} onClose={() => setModal(null)} onDone={onChanged} />}
      {modal === 'link' && <LinkProject m={m} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'reply' && <Reply m={m} onClose={() => setModal(null)} onDone={done} />}
    </article>
  )
}

function CreateProject({ m, item, onClose, onDone }: { m: Message; item: InboxItem | null; onClose: () => void; onDone: () => void }) {
  const { me, team } = useApp()
  const navigate = useNavigate()
  const { data: clients } = useLoad<Client[]>('/clients')
  const { data: templates } = useLoad<ProjectSummary[]>('/projects?template=1')
  const known = item?.known_client ?? null
  const [f, setF] = useState({
    name: m.subject || `Demande de ${sender(m)}`, client: m.client_id ?? known?.id ?? 'auto', client_name: '', template_id: '',
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
      toast('Projet créé')
      onDone()
      navigate(`/projets/${r.id}`)
    } catch (err) { setError(errorText(err)); setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} wide title="Créer un projet depuis cet email"
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="mail-project" disabled={busy || !f.name.trim()}>
        {busy ? 'Création…' : 'Créer le projet'}</Button></>}>
      <form id="mail-project" onSubmit={submit} className="space-y-3">
        <Field label="Nom du projet"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Client" hint={f.client === 'auto' ? `Un client sera créé d'après l'expéditeur (${m.from_email}).` : undefined}>
          <Select value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>
            {known && <option value={known.id}>{known.name} (reconnu)</option>}
            <option value="auto">Nouveau client depuis l'expéditeur</option>
            {(clients ?? []).filter((c) => c.id !== known?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {f.client === 'auto' && (
          <Field label="Nom du nouveau client (facultatif)" hint="Laissé vide : le nom de domaine de l'entreprise, ou le nom de la personne.">
            <Input value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} placeholder={m.from_name ?? ''} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Modèle">
            <Select value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })}>
              <option value="">Projet vierge</option>
              {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Statut">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
              <option value="lead">À qualifier</option>
              <option value="planned">Planifié</option>
              <option value="active">En cours</option>
            </Select>
          </Field>
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">Intervenants</span>
          <PeoplePicker people={team.filter((t) => t.active)} value={f.member_ids} onChange={(member_ids) => setF({ ...f, member_ids })} />
        </div>
        <Checkbox checked={f.first_task} onChange={(v) => setF({ ...f, first_task: v })}
          label={<>Créer la tâche « Répondre à {sender(m)} » <span className="text-muted-foreground">(pour demain, à mon nom)</span></>} />
        <p className="text-xs text-muted-foreground">Le texte de l'email devient la description du projet.</p>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
      </form>
    </Modal>
  )
}

function LinkProject({ m, onClose, onDone }: { m: Message; onClose: () => void; onDone: () => void }) {
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
      toast(r.task_id ? 'Rattaché, tâche créée' : 'Email rattaché au projet')
      onDone()
    } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Rattacher à un projet"
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="mail-link" disabled={busy || !projectId}>Rattacher</Button></>}>
      <form id="mail-link" onSubmit={submit} className="space-y-3">
        <Field label="Projet">
          <Select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choisir un projet…</option>
            {open.map((p) => <option key={p.id} value={p.id}>{p.client_name ? `${p.name} — ${p.client_name}` : p.name}</option>)}
          </Select>
        </Field>
        <Checkbox checked={asTask} onChange={setAsTask} label="En faire une tâche (l'objet devient le titre, le texte la description)" />
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
      </form>
    </Modal>
  )
}

function Reply({ m, onClose, onDone }: { m: Message; onClose: () => void; onDone: () => void }) {
  const [body, setBody] = useState(`Bonjour${m.from_name ? ` ${m.from_name.split(' ')[0]}` : ''},\n\n`)
  const [cc, setCc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const list = cc.split(/[\s,;]+/).filter(Boolean)
    const bad = list.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
    if (bad) { setError(`Adresse non valable : ${bad}`); return }
    setBusy(true); setError(null)
    try {
      await api.post(`/mail/messages/${m.id}/reply`, { body, cc: list })
      toast('Réponse envoyée')
      onDone()
    } catch (err) { setError(errorText(err)); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} wide title={`Répondre à ${sender(m)}`}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="mail-reply" disabled={busy || !body.trim()}>
        {busy ? 'Envoi…' : 'Envoyer'}</Button></>}>
      <form id="mail-reply" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">À : {m.from_email} · Objet : {/^re\s*:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`}</p>
        <Field label="Copie à (facultatif)"><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="collegue@exemple.ch" /></Field>
        <Field label="Message" hint="Le message d'origine est cité à la suite."><Textarea rows={10} required value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
      </form>
    </Modal>
  )
}
