import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClientFields, draftToBody, emptyClient, isFromCrmlead, type ClientDraft } from '../components/clients/ClientFields'
import { Badge, Button, ButtonLink, Empty, ErrorNote, Input, Modal, PageHeader, Spinner, TableStack, Tabs, toast } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useApp, useLoad } from '../lib/store'
import type { Client } from '../lib/types'

/** Le carnet d'adresses : les clients, repris de CRMlead ou saisis ici. */
export default function Clients() {
  const { me } = useApp()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)

  // La recherche part une fois la frappe posée.
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const path = `/clients?q=${encodeURIComponent(query)}${tab === 'archived' ? '&archived=1' : ''}`
  const { data, error, loading, reload } = useLoad<Client[]>(path)
  const rows = (data ?? []).filter((c) => (tab === 'archived' ? c.archived_at : !c.archived_at))

  return (
    <>
      <PageHeader title="Clients" subtitle="Le carnet d'adresses des projets, repris de CRMlead ou saisi ici."
        actions={<>
          <Button onClick={() => setImporting(true)}>Importer depuis CRMlead</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>Nouveau client</Button>
        </>} />

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, email ou localité…"
          aria-label="Rechercher un client" className="w-full sm:w-80" />
      </div>
      <Tabs active={tab} onChange={(id) => setTab(id as typeof tab)}
        tabs={[{ id: 'active', label: 'Clients' }, { id: 'archived', label: 'Archivés' }]} />

      <ErrorNote error={error} />
      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        tab === 'archived' ? <Empty title="Aucun client archivé" /> : query
          ? <Empty title="Aucun client trouvé">Essayez un autre nom, ou cherchez-le dans CRMlead.</Empty>
          : <Empty title="Aucun client pour l'instant"
              action={<div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setImporting(true)}>Importer depuis CRMlead</Button>
                <Button variant="primary" onClick={() => setCreating(true)}>Nouveau client</Button>
              </div>}>
              Reprenez vos adresses depuis CRMlead, ou saisissez votre premier client.
            </Empty>
      ) : (
        <TableStack>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Localité</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2 text-right">Projets actifs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2" data-label="">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/clients/${c.id}`} className="font-bold hover:text-accent break-words">{c.name}</Link>
                      {isFromCrmlead(c) && <Badge tone="info">CRMlead</Badge>}
                    </span>
                  </td>
                  <td className="px-3 py-2">{c.contact_person ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2">{[c.postal_code, c.town].filter(Boolean).join(' ') || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 break-words">
                    {c.email ? <a href={`mailto:${c.email}`} className="hover:text-accent">{c.email}</a> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.active_projects ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableStack>
      )}

      <NewClientDialog open={creating} onClose={() => setCreating(false)} />
      <CrmleadImportDialog open={importing} onClose={() => { setImporting(false); reload() }} connected={Boolean(me?.features.crmlead)} />
    </>
  )
}

function NewClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [draft, setDraft] = useState<ClientDraft>(emptyClient)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (open) { setDraft(emptyClient()); setError(null) } }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { id } = await api.post<{ id: string }>('/clients', draftToBody(draft))
      toast('Client ajouté')
      nav(`/clients/${id}`)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau client" wide
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" type="submit" form="new-client" disabled={busy || !draft.name.trim()}>Ajouter le client</Button>
      </>}>
      <form id="new-client" onSubmit={submit} className="space-y-3">
        <ClientFields value={draft} onChange={setDraft} />
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}

type CrmResult = { id: string; title: string; company: string | null; address: string | null; status: string; imported: boolean }

const LEAD_STATUS: Record<string, string> = { new: 'Nouveau', open: 'En cours', won: 'Gagné', lost: 'Perdu' }

function CrmleadImportDialog({ open, onClose, connected }: { open: boolean; onClose: () => void; connected: boolean }) {
  const { me } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CrmResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [taking, setTaking] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notConnected, setNotConnected] = useState(!connected)

  useEffect(() => { if (open) { setQ(''); setResults(null); setError(null); setNotConnected(!connected) } }, [open, connected])

  const search = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true); setError(null)
    try {
      setResults(await api.get<CrmResult[]>(`/clients/crmlead/search?q=${encodeURIComponent(q.trim())}`))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'crmlead_not_configured') setNotConnected(true)
      else setError(err)
    } finally { setBusy(false) }
  }

  const take = async (r: CrmResult) => {
    setTaking(r.id)
    try {
      const { id } = await api.post<{ id: string }>('/clients/crmlead/import', { leadId: r.id })
      toast(`${r.company || r.title} repris de CRMlead`)
      setResults((x) => x?.map((y) => (y.id === r.id ? { ...y, imported: true } : y)) ?? null)
      return id
    } catch (err) { setError(err); return null } finally { setTaking(null) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Importer depuis CRMlead" wide>
      {notConnected ? (
        <div className="space-y-3 text-sm">
          <p>CRMlead n'est pas encore branché à ProjectLead. Une fois relié, vous retrouvez ici les entreprises de vos leads
             et reprenez leur adresse et leurs contacts en un clic, sans rien ressaisir.</p>
          {me?.user.role === 'admin'
            ? <ButtonLink to="/reglages/integrations" variant="primary">Brancher CRMlead</ButtonLink>
            : <p className="text-muted-foreground">Demandez à un administrateur de le brancher dans Réglages → Intégrations.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <form onSubmit={search} className="flex gap-2">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom de l'entreprise ou du lead"
              aria-label="Rechercher dans CRMlead" />
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Recherche…' : 'Rechercher'}</Button>
          </form>
          <ErrorNote error={error} />
          {results && (results.length === 0
            ? <p className="text-sm text-muted-foreground">Rien trouvé dans CRMlead pour cette recherche.</p>
            : (
              <ul className="divide-y divide-border border border-border">
                {results.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold break-words">{r.company || r.title}</p>
                      {r.company && r.title !== r.company && <p className="text-xs text-muted-foreground break-words">{r.title}</p>}
                      <p className="text-xs text-muted-foreground break-words">{r.address || 'Sans adresse'}</p>
                    </div>
                    {LEAD_STATUS[r.status] && <Badge>{LEAD_STATUS[r.status]}</Badge>}
                    {r.imported ? (
                      <span className="text-xs font-bold text-muted-foreground">Déjà repris</span>
                    ) : (
                      <Button size="sm" variant="primary" disabled={taking === r.id} onClick={() => take(r)}>
                        {taking === r.id ? 'Reprise…' : 'Reprendre'}
                      </Button>
                    )}
                    {r.imported && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        // Le client repris est retrouvé (ou rafraîchi) par son lien CRMlead.
                        const id = await take(r)
                        if (id) nav(`/clients/${id}`)
                      }}>Ouvrir</Button>
                    )}
                  </li>
                ))}
              </ul>
            ))}
          {!results && <p className="text-sm text-muted-foreground">L'adresse et les contacts sont repris tels quels ; la fiche reste liée à CRMlead pour les mises à jour.</p>}
        </div>
      )}
    </Modal>
  )
}
