import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { addressLine, ClientFields, clientToDraft, COUNTRIES, draftToBody, isFromCrmlead, LANGUAGES, type ClientDraft } from '../components/clients/ClientFields'
import { Badge, Button, Card, Checkbox, ColorDot, Confirm, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, StatusBadge, toast } from '../components/ui'
import { useT } from '../i18n'
import { api, errorText } from '../lib/api'
import { fmtDate, fmtRelative } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { Client, ClientContact } from '../lib/types'
import { appOrigin, OpenApp } from '../components/LeadLinks'

type ClientProject = { id: string; name: string; code: string | null; status: string; health: string; due_date: string | null; color: string }
type ClientEmail = { id: string; subject: string; from_email: string; direction: 'in' | 'out'; received_at: string; project_id: string | null }
type ClientFull = Client & { contacts: ClientContact[]; projects: ClientProject[]; emails: ClientEmail[] }

/** La fiche d'un client : coordonnées, contacts, projets et derniers échanges. */
export default function ClientDetail() {
  const t = useT()
  const { id } = useParams()
  const nav = useNavigate()
  const { me } = useApp()
  const { data: c, error, loading, reload } = useLoad<ClientFull>(`/clients/${id}`, [id])
  const [editing, setEditing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [archiving, setArchiving] = useState(false)

  if (loading && !c) return <Spinner />
  if (!c) return <><PageHeader title={t('clients.col.client')} back={{ to: '/clients', label: t('clients.title') }} /><ErrorNote error={error} /></>

  const fromCrm = isFromCrmlead(c)
  const refreshFromCrm = async () => {
    setRefreshing(true)
    try { await api.post(`/clients/${c.id}/crmlead/refresh`); toast(t('clients.refreshed')); reload() }
    catch (e) { toast(errorText(e)) } finally { setRefreshing(false) }
  }
  const setArchived = async (archived: boolean) => {
    try { await api.patch(`/clients/${c.id}`, { archived }); toast(archived ? t('clients.archivedToast') : t('clients.reactivatedToast')); reload() }
    catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <PageHeader back={{ to: '/clients', label: t('clients.title') }}
        title={<span className="inline-flex flex-wrap items-center gap-2">{c.name}
          {fromCrm && <Badge tone="info">CRMlead</Badge>}{c.archived_at && <Badge>{t('clients.archivedBadge')}</Badge>}</span>}
        subtitle={[c.kind === 'company' ? t('clients.kind.company') : t('clients.kind.person'), addressLine(c)].filter(Boolean).join(' · ')}
        actions={<>
          {fromCrm && (me?.features.crmlead
            ? <Button onClick={refreshFromCrm} disabled={refreshing}>{refreshing ? t('clients.refreshing') : t('clients.refreshCrm')}</Button>
            : <span className="inline-flex flex-wrap items-center gap-2 text-sm" data-link-state="not_used">{t('clients.crmNotUsed')}
                <OpenApp app="crmlead" /></span>)}
          {c.archived_at
            ? <Button onClick={() => setArchived(false)}>{t('clients.reactivate')}</Button>
            : <Button variant="danger" onClick={() => setArchiving(true)}>{t('clients.archive')}</Button>}
          <Button variant="primary" onClick={() => nav(`/projets?nouveau=1&client=${c.id}`)}>{t('clients.newProject')}</Button>
        </>} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-5">
          <Card title={t('clients.details')} action={<Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{t('common.edit')}</Button>}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <Row label={t('clients.field.contact')}>{c.contact_person}</Row>
              <Row label={t('clients.field.email')}>{c.email && <a href={`mailto:${c.email}`} className="hover:text-accent">{c.email}</a>}</Row>
              <Row label={t('clients.field.phone')}>{c.phone && <a href={`tel:${c.phone}`} className="hover:text-accent">{c.phone}</a>}</Row>
              <Row label={t('clients.field.address')}>
                {(c.street || c.town) && <>
                  {[c.street, c.building_number].filter(Boolean).join(' ')}{c.street && <br />}
                  {[c.postal_code, c.town].filter(Boolean).join(' ')}<br />{COUNTRIES[c.country] ?? c.country}
                </>}
              </Row>
              <Row label={t('clients.field.language')}>{LANGUAGES[c.language] ?? c.language}</Row>
              <Row label={t('clients.field.vat')}>{c.vat_number}</Row>
              {c.notes && <Row label={t('clients.field.notes')}><span className="whitespace-pre-line">{c.notes}</span></Row>}
            </dl>
            {(fromCrm || c.invoicelead_contact_id) && (
              <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                {fromCrm && <p>{t('clients.crmAddressNote')}</p>}
                {c.invoicelead_contact_id && (
                  <a className="font-bold text-accent hover:text-accent-dark" target="_blank" rel="noreferrer"
                     href={`${appOrigin('invoicelead')}/fr/app/contacts/${encodeURIComponent(c.invoicelead_contact_id)}`}>{t('clients.ilLinked')} ↗</a>)}
              </div>
            )}
          </Card>

          <Contacts client={c} onChange={reload} />
        </div>

        <div className="space-y-5">
          <Card title={t('clients.projectsCount', { n: c.projects.length })}>
            {c.projects.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t('clients.noProjects')}{' '}
                <Link to={`/projets?nouveau=1&client=${c.id}`} className="font-bold text-accent">{t('clients.openProject')}</Link></p>
            ) : (
              <ul className="divide-y divide-border">
                {c.projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/projets/${p.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-accent-veil">
                      <ColorDot color={p.color} />
                      <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] font-semibold break-words sm:basis-0">
                        {p.code && <><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{p.code}</span>{" "}</>}{p.name}
                      </span>
                      {p.due_date && <span className="text-xs text-muted-foreground">{t('clients.due', { date: fmtDate(p.due_date) })}</span>}
                      <StatusBadge status={p.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('clients.lastEmails')}>
            {c.emails.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t('clients.noEmails')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {c.emails.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
                    <span className={`text-[11px] font-extrabold uppercase ${m.direction === 'in' ? 'text-accent-dark' : 'text-muted-foreground'}`}>
                      {m.direction === 'in' ? t('clients.received') : t('clients.sent')}</span>
                    <span className="min-w-0 flex-1 break-words">
                      {m.project_id ? <Link to={`/projets/${m.project_id}`} className="font-semibold hover:text-accent">{m.subject || t('clients.noSubject')}</Link>
                        : <span className="font-semibold">{m.subject || t('clients.noSubject')}</span>}
                      <span className="block text-xs text-muted-foreground">{m.from_email}</span>
                    </span>
                    <span className="text-xs text-muted-foreground" title={fmtDate(m.received_at)}>{fmtRelative(m.received_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <EditClientDialog open={editing} client={c} onClose={() => setEditing(false)} onSaved={reload} />
      <Confirm open={archiving} onClose={() => setArchiving(false)} title={t('clients.archiveTitle')} danger confirmLabel={t('clients.archive')}
        onConfirm={() => setArchived(true)}>
        {t('clients.archiveBody')}
      </Confirm>
    </>
  )
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
  </>
)

function EditClientDialog({ open, client, onClose, onSaved }: { open: boolean; client: Client; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [draft, setDraft] = useState<ClientDraft>(() => clientToDraft(client))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (open) { setDraft(clientToDraft(client)); setError(null) } }, [open, client])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await api.patch(`/clients/${client.id}`, draftToBody(draft)); toast(t('clients.saved')); onSaved(); onClose() }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('clients.editClient')} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="edit-client" disabled={busy || !draft.name.trim()}>{t('common.save')}</Button></>}>
      <form id="edit-client" onSubmit={submit} className="space-y-3">
        {isFromCrmlead(client) && <p className="text-xs text-muted-foreground">{t('clients.crmEditNote')}</p>}
        <ClientFields value={draft} onChange={setDraft} />
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}

type ContactDraft = { name: string; email: string; phone: string; job_title: string; receives_updates: boolean }
const toContactDraft = (k?: ClientContact): ContactDraft => ({
  name: k?.name ?? '', email: k?.email ?? '', phone: k?.phone ?? '', job_title: k?.job_title ?? '', receives_updates: k?.receives_updates ?? true,
})

function Contacts({ client, onChange }: { client: ClientFull; onChange: () => void }) {
  const t = useT()
  const [editing, setEditing] = useState<ClientContact | 'new' | null>(null)
  const [removing, setRemoving] = useState<ClientContact | null>(null)

  const toggleUpdates = async (k: ClientContact, v: boolean) => {
    try { await api.patch(`/clients/contacts/${k.id}`, { receives_updates: v }); onChange() } catch (e) { toast(errorText(e)) }
  }
  const remove = async (k: ClientContact) => {
    try { await api.del(`/clients/contacts/${k.id}`); toast(t('clients.contactDeleted')); onChange() } catch (e) { toast(errorText(e)) }
  }

  return (
    <Card title={t('clients.contacts')} action={<Button size="sm" variant="ghost" onClick={() => setEditing('new')}>{t('common.add')}</Button>}>
      {client.contacts.length === 0 ? (
        <div className="p-4"><Empty title={t('clients.noContacts')}>{t('clients.noContactsHint')}</Empty></div>
      ) : (
        <ul className="divide-y divide-border">
          {client.contacts.map((k) => (
            <li key={k.id} className="space-y-1.5 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold break-words">{k.name || k.email || t('clients.noName')}</p>
                  {k.job_title && <p className="text-xs text-muted-foreground">{k.job_title}</p>}
                  <p className="text-xs break-words">
                    {[k.email && <a key="e" href={`mailto:${k.email}`} className="hover:text-accent">{k.email}</a>,
                      k.phone && <a key="p" href={`tel:${k.phone}`} className="hover:text-accent">{k.phone}</a>]
                      .filter(Boolean).reduce<ReactNode[]>((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(k)}>{t('common.edit')}</Button>
                <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(k)}>{t('common.delete')}</Button>
              </div>
              <Checkbox label={t('clients.receivesUpdates')} checked={k.receives_updates} onChange={(v) => toggleUpdates(k, v)} className="text-xs" />
            </li>
          ))}
        </ul>
      )}
      <ContactDialog clientId={client.id} contact={editing} onClose={() => setEditing(null)} onSaved={onChange} />
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} title={t('clients.deleteContactTitle')} danger confirmLabel={t('common.delete')}
        onConfirm={() => removing && remove(removing)}>
        {t('clients.deleteContactBody', { name: removing?.name || removing?.email || '' })}
      </Confirm>
    </Card>
  )
}

function ContactDialog({ clientId, contact, onClose, onSaved }:
  { clientId: string; contact: ClientContact | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [d, setD] = useState<ContactDraft>(toContactDraft())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (contact) { setD(toContactDraft(contact === 'new' ? undefined : contact)); setError(null) } }, [contact])
  const set = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) => setD((x) => ({ ...x, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const body = { name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim() || null, job_title: d.job_title.trim() || null,
                   receives_updates: d.receives_updates }
    try {
      if (contact === 'new') await api.post(`/clients/${clientId}/contacts`, body)
      else if (contact) await api.patch(`/clients/contacts/${contact.id}`, body)
      onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Modal open={Boolean(contact)} onClose={onClose} title={contact === 'new' ? t('clients.newContact') : t('clients.editContact')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="contact-form" disabled={busy || (!d.name.trim() && !d.email.trim())}>{t('common.save')}</Button></>}>
      <form id="contact-form" onSubmit={submit} className="space-y-3">
        <Field label={t('clients.field.name')}><Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={200} /></Field>
        <Field label={t('clients.field.jobTitle')}><Input value={d.job_title} onChange={(e) => set('job_title', e.target.value)} maxLength={120} /></Field>
        <Field label={t('clients.field.email')}><Input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('clients.field.phone')}><Input type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} maxLength={50} /></Field>
        <Checkbox label={t('clients.receivesUpdatesEmail')} checked={d.receives_updates} onChange={(v) => set('receives_updates', v)} />
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}
