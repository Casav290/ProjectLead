import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { addressLine, ClientFields, clientToDraft, COUNTRIES, draftToBody, isFromCrmlead, LANGUAGES, type ClientDraft } from '../components/clients/ClientFields'
import { Badge, Button, Card, Checkbox, ColorDot, Confirm, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, StatusBadge, toast } from '../components/ui'
import { api, errorText } from '../lib/api'
import { fmtDate, fmtRelative } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { Client, ClientContact } from '../lib/types'

type ClientProject = { id: string; name: string; code: string | null; status: string; health: string; due_date: string | null; color: string }
type ClientEmail = { id: string; subject: string; from_email: string; direction: 'in' | 'out'; received_at: string; project_id: string | null }
type ClientFull = Client & { contacts: ClientContact[]; projects: ClientProject[]; emails: ClientEmail[] }

/** La fiche d'un client : coordonnées, contacts, projets et derniers échanges. */
export default function ClientDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { me } = useApp()
  const { data: c, error, loading, reload } = useLoad<ClientFull>(`/clients/${id}`, [id])
  const { data: links } = useLoad<{ invoicelead_url: string | null }>(c?.invoicelead_contact_id ? '/integrations' : null, [c?.invoicelead_contact_id])
  const [editing, setEditing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [archiving, setArchiving] = useState(false)

  if (loading && !c) return <Spinner />
  if (!c) return <><PageHeader title="Client" back={{ to: '/clients', label: 'Clients' }} /><ErrorNote error={error} /></>

  const fromCrm = isFromCrmlead(c)
  const refreshFromCrm = async () => {
    setRefreshing(true)
    try { await api.post(`/clients/${c.id}/crmlead/refresh`); toast('Adresse et contacts mis à jour depuis CRMlead'); reload() }
    catch (e) { toast(errorText(e)) } finally { setRefreshing(false) }
  }
  const setArchived = async (archived: boolean) => {
    try { await api.patch(`/clients/${c.id}`, { archived }); toast(archived ? 'Client archivé' : 'Client réactivé'); reload() }
    catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <PageHeader back={{ to: '/clients', label: 'Clients' }}
        title={<span className="inline-flex flex-wrap items-center gap-2">{c.name}
          {fromCrm && <Badge tone="info">CRMlead</Badge>}{c.archived_at && <Badge>Archivé</Badge>}</span>}
        subtitle={[c.kind === 'company' ? 'Société' : 'Personne', addressLine(c)].filter(Boolean).join(' · ')}
        actions={<>
          {fromCrm && <Button onClick={refreshFromCrm} disabled={refreshing || !me?.features.crmlead}
            title={me?.features.crmlead ? undefined : "CRMlead n'est plus branché"}>{refreshing ? 'Mise à jour…' : 'Mettre à jour depuis CRMlead'}</Button>}
          {c.archived_at
            ? <Button onClick={() => setArchived(false)}>Réactiver</Button>
            : <Button variant="danger" onClick={() => setArchiving(true)}>Archiver</Button>}
          <Button variant="primary" onClick={() => nav(`/projets?nouveau=1&client=${c.id}`)}>Nouveau projet</Button>
        </>} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-5">
          <Card title="Coordonnées" action={<Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Modifier</Button>}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <Row label="Contact">{c.contact_person}</Row>
              <Row label="Email">{c.email && <a href={`mailto:${c.email}`} className="hover:text-accent">{c.email}</a>}</Row>
              <Row label="Téléphone">{c.phone && <a href={`tel:${c.phone}`} className="hover:text-accent">{c.phone}</a>}</Row>
              <Row label="Adresse">
                {(c.street || c.town) && <>
                  {[c.street, c.building_number].filter(Boolean).join(' ')}{c.street && <br />}
                  {[c.postal_code, c.town].filter(Boolean).join(' ')}<br />{COUNTRIES[c.country] ?? c.country}
                </>}
              </Row>
              <Row label="Langue">{LANGUAGES[c.language] ?? c.language}</Row>
              <Row label="N° TVA">{c.vat_number}</Row>
              {c.notes && <Row label="Notes"><span className="whitespace-pre-line">{c.notes}</span></Row>}
            </dl>
            {(fromCrm || c.invoicelead_contact_id) && (
              <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                {fromCrm && <p>Adresse reprise de CRMlead : « Mettre à jour depuis CRMlead » relit l'adresse et les contacts.</p>}
                {c.invoicelead_contact_id && (links?.invoicelead_url
                  ? <a className="font-bold text-accent hover:text-accent-dark" target="_blank" rel="noreferrer"
                       href={`${links.invoicelead_url}/fr/app/contacts/${c.invoicelead_contact_id}`}>Contact InvoiceLead lié ↗</a>
                  : <p>Contact InvoiceLead lié.</p>)}
              </div>
            )}
          </Card>

          <Contacts client={c} onChange={reload} />
        </div>

        <div className="space-y-5">
          <Card title={`Projets (${c.projects.length})`}>
            {c.projects.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Aucun projet pour ce client.{' '}
                <Link to={`/projets?nouveau=1&client=${c.id}`} className="font-bold text-accent">Ouvrir un projet</Link></p>
            ) : (
              <ul className="divide-y divide-border">
                {c.projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/projets/${p.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-accent-veil">
                      <ColorDot color={p.color} />
                      <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] font-semibold break-words sm:basis-0">
                        {p.code && <><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{p.code}</span>{" "}</>}{p.name}
                      </span>
                      {p.due_date && <span className="text-xs text-muted-foreground">Échéance {fmtDate(p.due_date)}</span>}
                      <StatusBadge status={p.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Derniers emails">
            {c.emails.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Aucun email échangé avec ce client dans ProjectLead.</p>
            ) : (
              <ul className="divide-y divide-border">
                {c.emails.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
                    <span className={`text-[11px] font-extrabold uppercase ${m.direction === 'in' ? 'text-accent-dark' : 'text-muted-foreground'}`}>
                      {m.direction === 'in' ? 'Reçu' : 'Envoyé'}</span>
                    <span className="min-w-0 flex-1 break-words">
                      {m.project_id ? <Link to={`/projets/${m.project_id}`} className="font-semibold hover:text-accent">{m.subject || '(sans objet)'}</Link>
                        : <span className="font-semibold">{m.subject || '(sans objet)'}</span>}
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
      <Confirm open={archiving} onClose={() => setArchiving(false)} title="Archiver ce client ?" danger confirmLabel="Archiver"
        onConfirm={() => setArchived(true)}>
        Le client disparaît du carnet et des choix de client ; ses projets et leur historique restent intacts. Vous pouvez le réactiver à tout moment.
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
  const [draft, setDraft] = useState<ClientDraft>(() => clientToDraft(client))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (open) { setDraft(clientToDraft(client)); setError(null) } }, [open, client])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await api.patch(`/clients/${client.id}`, draftToBody(draft)); toast('Fiche enregistrée'); onSaved(); onClose() }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Modifier le client" wide
      footer={<><Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" type="submit" form="edit-client" disabled={busy || !draft.name.trim()}>Enregistrer</Button></>}>
      <form id="edit-client" onSubmit={submit} className="space-y-3">
        {isFromCrmlead(client) && <p className="text-xs text-muted-foreground">Cette fiche vient de CRMlead : une mise à jour depuis CRMlead remplacera l'adresse saisie ici.</p>}
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
  const [editing, setEditing] = useState<ClientContact | 'new' | null>(null)
  const [removing, setRemoving] = useState<ClientContact | null>(null)

  const toggleUpdates = async (k: ClientContact, v: boolean) => {
    try { await api.patch(`/clients/contacts/${k.id}`, { receives_updates: v }); onChange() } catch (e) { toast(errorText(e)) }
  }
  const remove = async (k: ClientContact) => {
    try { await api.del(`/clients/contacts/${k.id}`); toast('Contact supprimé'); onChange() } catch (e) { toast(errorText(e)) }
  }

  return (
    <Card title="Contacts" action={<Button size="sm" variant="ghost" onClick={() => setEditing('new')}>Ajouter</Button>}>
      {client.contacts.length === 0 ? (
        <div className="p-4"><Empty title="Aucun contact">Ajoutez les personnes à qui envoyer le suivi de projet.</Empty></div>
      ) : (
        <ul className="divide-y divide-border">
          {client.contacts.map((k) => (
            <li key={k.id} className="space-y-1.5 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold break-words">{k.name || k.email || 'Sans nom'}</p>
                  {k.job_title && <p className="text-xs text-muted-foreground">{k.job_title}</p>}
                  <p className="text-xs break-words">
                    {[k.email && <a key="e" href={`mailto:${k.email}`} className="hover:text-accent">{k.email}</a>,
                      k.phone && <a key="p" href={`tel:${k.phone}`} className="hover:text-accent">{k.phone}</a>]
                      .filter(Boolean).reduce<ReactNode[]>((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(k)}>Modifier</Button>
                <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(k)}>Supprimer</Button>
              </div>
              <Checkbox label="Reçoit le suivi de projet" checked={k.receives_updates} onChange={(v) => toggleUpdates(k, v)} className="text-xs" />
            </li>
          ))}
        </ul>
      )}
      <ContactDialog clientId={client.id} contact={editing} onClose={() => setEditing(null)} onSaved={onChange} />
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} title="Supprimer ce contact ?" danger confirmLabel="Supprimer"
        onConfirm={() => removing && remove(removing)}>
        {removing?.name || removing?.email} ne recevra plus le suivi des projets de ce client.
      </Confirm>
    </Card>
  )
}

function ContactDialog({ clientId, contact, onClose, onSaved }:
  { clientId: string; contact: ClientContact | 'new' | null; onClose: () => void; onSaved: () => void }) {
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
    <Modal open={Boolean(contact)} onClose={onClose} title={contact === 'new' ? 'Nouveau contact' : 'Modifier le contact'}
      footer={<><Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" type="submit" form="contact-form" disabled={busy || (!d.name.trim() && !d.email.trim())}>Enregistrer</Button></>}>
      <form id="contact-form" onSubmit={submit} className="space-y-3">
        <Field label="Nom"><Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={200} /></Field>
        <Field label="Fonction"><Input value={d.job_title} onChange={(e) => set('job_title', e.target.value)} maxLength={120} /></Field>
        <Field label="Email"><Input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Téléphone"><Input type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} maxLength={50} /></Field>
        <Checkbox label="Reçoit le suivi de projet par email" checked={d.receives_updates} onChange={(v) => set('receives_updates', v)} />
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}
