import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ClientFields, draftToBody, emptyClient, isFromCrmlead, type ClientDraft } from '../components/clients/ClientFields'
import { Badge, Button, Empty, ErrorNote, Input, Modal, PageHeader, Spinner, TableStack, Tabs, toast } from '../components/ui'
import { NotUsed } from '../components/LeadLinks'
import { labels, useT } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useApp, useLoad } from '../lib/store'
import type { Client } from '../lib/types'

/** Le carnet d'adresses : les clients, repris de CRMlead ou saisis ici. */
export default function Clients() {
  const t = useT()
  const { me } = useApp()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [creating, setCreating] = useState(false)
  // Le dialogue d'import et sa recherche vivent dans l'adresse (?importer=crmlead&iq=…) : une reconnexion silencieuse au
  // Compte Lead (lead_reauth, src/lib/api.ts) ramène exactement ici, dialogue ouvert, recherche relancée.
  const [params, setParams] = useSearchParams()
  const importer = params.get('importer')
  const importQ = params.get('iq') ?? ''
  const openImport = (app: 'crmlead' | 'invoicelead' | null, iq = '') => setParams((p) => {
    const n = new URLSearchParams(p)
    if (app) n.set('importer', app); else n.delete('importer')
    if (app && iq) n.set('iq', iq); else n.delete('iq')
    return n
  }, { replace: true })
  const setImporting = (v: boolean) => openImport(v ? 'crmlead' : null)
  const setIlImporting = (v: boolean) => openImport(v ? 'invoicelead' : null)

  // La recherche part une fois la frappe posée.
  useEffect(() => { const tm = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(tm) }, [q])
  const path = `/clients?q=${encodeURIComponent(query)}${tab === 'archived' ? '&archived=1' : ''}`
  const { data, error, loading, reload } = useLoad<Client[]>(path)
  const rows = (data ?? []).filter((c) => (tab === 'archived' ? c.archived_at : !c.archived_at))

  return (
    <>
      <PageHeader title={t('clients.title')} subtitle={t('clients.subtitle')}
        actions={<>
          <Button onClick={() => setImporting(true)}>{t('clients.importCrm')}</Button>
          <Button onClick={() => setIlImporting(true)}>{t('clients.importIl')}</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>{t('clients.newClient')}</Button>
        </>} />

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('clients.searchPlaceholder')}
          aria-label={t('clients.searchAria')} className="w-full sm:w-80" />
      </div>
      <Tabs active={tab} onChange={(id) => setTab(id as typeof tab)}
        tabs={[{ id: 'active', label: t('clients.title') }, { id: 'archived', label: t('clients.tabArchived') }]} />

      <ErrorNote error={error} />
      {loading && !data ? <Spinner /> : rows.length === 0 ? (
        tab === 'archived' ? <Empty title={t('clients.emptyArchived')} /> : query
          ? <Empty title={t('clients.notFound')}>{t('clients.notFoundHint')}</Empty>
          : <Empty title={t('clients.emptyTitle')}
              action={<div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setImporting(true)}>{t('clients.importCrm')}</Button>
                <Button onClick={() => setIlImporting(true)}>{t('clients.importIl')}</Button>
                <Button variant="primary" onClick={() => setCreating(true)}>{t('clients.newClient')}</Button>
              </div>}>
              {t('clients.emptyHint')}
            </Empty>
      ) : (
        <TableStack>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2">{t('clients.col.client')}</th>
                <th className="px-3 py-2">{t('clients.field.contact')}</th>
                <th className="px-3 py-2">{t('clients.field.town')}</th>
                <th className="px-3 py-2">{t('clients.field.email')}</th>
                <th className="px-3 py-2 text-right">{t('clients.col.activeProjects')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2" data-label="">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/clients/${c.id}`} className="font-bold hover:text-accent break-words">{c.name}</Link>
                      {isFromCrmlead(c) && <Badge tone="info">CRMlead</Badge>}
                      {c.invoicelead_contact_id && <Badge>InvoiceLead</Badge>}
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
      <CrmleadImportDialog open={importer === 'crmlead'} onClose={() => { setImporting(false); reload() }} connected={Boolean(me?.features.crmlead)}
        initialQ={importQ} onQuery={(v) => openImport('crmlead', v)} />
      <InvoiceleadImportDialog open={importer === 'invoicelead'} onClose={() => { setIlImporting(false); reload() }} connected={Boolean(me?.features.invoicelead)}
        initialQ={importQ} onQuery={(v) => openImport('invoicelead', v)} />
    </>
  )
}

function NewClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
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
      toast(t('clients.added'))
      nav(`/clients/${id}`)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('clients.newClient')} wide
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="new-client" disabled={busy || !draft.name.trim()}>{t('clients.addClient')}</Button>
      </>}>
      <form id="new-client" onSubmit={submit} className="space-y-3">
        <ClientFields value={draft} onChange={setDraft} />
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}

type CrmResult = { id: string; title: string; company: string | null; address: string | null; status: string; imported: boolean }

const LEAD_STATUS: Record<string, string> = labels('clients.leadStatus', ['new', 'open', 'won', 'lost'])

type ImportProps = { open: boolean; onClose: () => void; connected: boolean; initialQ: string; onQuery: (q: string) => void }

function CrmleadImportDialog({ open, onClose, connected, initialQ, onQuery }: ImportProps) {
  const t = useT()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CrmResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [taking, setTaking] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notConnected, setNotConnected] = useState(!connected)

  const search = async (e?: FormEvent, text = q) => {
    e?.preventDefault()
    setBusy(true); setError(null)
    onQuery(text.trim())
    try {
      setResults(await api.get<CrmResult[]>(`/clients/crmlead/search?q=${encodeURIComponent(text.trim())}`))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'crmlead_not_used') setNotConnected(true)
      else setError(err)
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!open) return
    setQ(initialQ); setResults(null); setError(null); setNotConnected(!connected)
    // Retour d'une reconnexion silencieuse : la recherche d'avant est relancée.
    if (connected && initialQ) search(undefined, initialQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected])

  const take = async (r: CrmResult) => {
    setTaking(r.id)
    try {
      const { id } = await api.post<{ id: string }>('/clients/crmlead/import', { leadId: r.id })
      toast(t('clients.takenCrm', { name: r.company || r.title }))
      setResults((x) => x?.map((y) => (y.id === r.id ? { ...y, imported: true } : y)) ?? null)
      return id
    } catch (err) { setError(err); return null } finally { setTaking(null) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('clients.importCrm')} wide>
      {notConnected ? (
        <div className="space-y-3 text-sm">
          <NotUsed app="crmlead" />
          <p className="text-muted-foreground">{t('clients.crmNotUsedHint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <form onSubmit={search} className="flex gap-2">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('clients.crmSearchPlaceholder')}
              aria-label={t('clients.crmSearchAria')} />
            <Button type="submit" variant="primary" disabled={busy}>{busy ? t('clients.searching') : t('common.search')}</Button>
          </form>
          <ErrorNote error={error} />
          {results && (results.length === 0
            ? <p className="text-sm text-muted-foreground">{t('clients.crmNothing')}</p>
            : (
              <ul className="divide-y divide-border border border-border">
                {results.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold break-words">{r.company || r.title}</p>
                      {r.company && r.title !== r.company && <p className="text-xs text-muted-foreground break-words">{r.title}</p>}
                      <p className="text-xs text-muted-foreground break-words">{r.address || t('clients.noAddress')}</p>
                    </div>
                    {LEAD_STATUS[r.status] && <Badge>{LEAD_STATUS[r.status]}</Badge>}
                    {r.imported ? (
                      <span className="text-xs font-bold text-muted-foreground">{t('clients.alreadyTaken')}</span>
                    ) : (
                      <Button size="sm" variant="primary" disabled={taking === r.id} onClick={() => take(r)}>
                        {taking === r.id ? t('clients.taking') : t('clients.take')}
                      </Button>
                    )}
                    {r.imported && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        // Le client repris est retrouvé (ou rafraîchi) par son lien CRMlead.
                        const id = await take(r)
                        if (id) nav(`/clients/${id}`)
                      }}>{t('clients.open')}</Button>
                    )}
                  </li>
                ))}
              </ul>
            ))}
          {!results && <p className="text-sm text-muted-foreground">{t('clients.crmHint')}</p>}
        </div>
      )}
    </Modal>
  )
}

type IlResult = { id: string; name: string; email: string | null; address: string | null; imported: boolean }

/** Le carnet de contacts d'InvoiceLead : un contact, ou tous d'un coup. */
function InvoiceleadImportDialog({ open, onClose, connected, initialQ, onQuery }: ImportProps) {
  const t = useT()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<IlResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [taking, setTaking] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notConnected, setNotConnected] = useState(!connected)

  const [searched, setSearched] = useState('')
  const search = async (e?: FormEvent, text = q) => {
    e?.preventDefault()
    setBusy(true); setError(null)
    onQuery(text.trim())
    try {
      setResults(await api.get<IlResult[]>(`/clients/invoicelead/search?q=${encodeURIComponent(text.trim())}`))
      setSearched(text.trim())
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invoicelead_not_used') setNotConnected(true)
      else setError(err)
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!open) return
    setQ(initialQ); setResults(null); setError(null); setNotConnected(!connected)
    if (connected) search(undefined, initialQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected])

  const take = async (r: IlResult | null) => {
    setTaking(r?.id ?? 'all')
    try {
      const { count } = await api.post<{ id: string; count: number }>('/clients/invoicelead/import',
        r ? { contactId: r.id, q: searched } : { all: true, q: searched })
      toast(r ? t('clients.takenIl', { name: r.name }) : t('clients.takenIlCount', { n: count }))
      setResults((x) => x?.map((y) => (!r || y.id === r.id ? { ...y, imported: true } : y)) ?? null)
    } catch (err) { setError(err) } finally { setTaking(null) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('clients.importIl')} wide>
      {notConnected ? (
        <div className="space-y-3 text-sm">
          <NotUsed app="invoicelead" />
          <p className="text-muted-foreground">{t('clients.ilNotUsedHint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <form onSubmit={search} className="flex gap-2">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('clients.ilSearchPlaceholder')}
              aria-label={t('clients.ilSearchAria')} />
            <Button type="submit" disabled={busy}>{busy ? t('clients.searching') : t('common.search')}</Button>
          </form>
          <ErrorNote error={error} />
          {results && results.length > 0 && results.some((r) => !r.imported) && (
            <Button variant="primary" disabled={taking !== null} onClick={() => take(null)}>
              {taking === 'all' ? t('clients.taking') : t('clients.takeAll')}
            </Button>
          )}
          {results && (results.length === 0
            ? <p className="text-sm text-muted-foreground">{t('clients.ilNothing')}</p>
            : (
              <ul className="divide-y divide-border border border-border">
                {results.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold break-words">{r.name}</p>
                      <p className="text-xs text-muted-foreground break-words">{[r.address, r.email].filter(Boolean).join(' · ') || t('clients.noAddress')}</p>
                    </div>
                    {r.imported
                      ? <span className="text-xs font-bold text-muted-foreground">{t('clients.alreadyTaken')}</span>
                      : <Button size="sm" variant="primary" disabled={taking !== null} onClick={() => take(r)}>
                          {taking === r.id ? t('clients.taking') : t('clients.take')}
                        </Button>}
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </Modal>
  )
}
