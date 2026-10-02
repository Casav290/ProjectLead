import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorText } from '../../lib/api'
import { BILLING_LABEL, parseMoney, today } from '../../lib/format'
import { useApp } from '../../lib/store'
import type { Client, ProjectSummary } from '../../lib/types'
import { Button, Field, Input, Modal, PeoplePicker, Select } from '../ui'

type Billing = ProjectSummary['billing_mode']

/** Le libellé du montant selon le mode de facturation (rien pour « par étape » et « non facturable »). */
export const AMOUNT_LABEL: Partial<Record<Billing, string>> = {
  hourly: 'Taux horaire', retainer: 'Montant mensuel', fixed: 'Montant global',
}
const AMOUNT_FIELD: Partial<Record<Billing, 'hourly_rate_cents' | 'retainer_cents' | 'fixed_cents'>> = {
  hourly: 'hourly_rate_cents', retainer: 'retainer_cents', fixed: 'fixed_cents',
}

/**
 * Créer un projet : vierge ou depuis un modèle, avec son client (créé au vol au besoin),
 * son équipe et sa facturation. Ouvre la fiche du projet une fois créé.
 */
export default function NewProjectDialog({ open, onClose, templateId, clientId }:
  { open: boolean; onClose: () => void; templateId?: string | null; clientId?: string | null }) {
  const { me, team } = useApp()
  const nav = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [templates, setTemplates] = useState<ProjectSummary[]>([])
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [newClient, setNewClient] = useState<string | null>(null)
  const [template, setTemplate] = useState('')
  const [start, setStart] = useState(today())
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [billing, setBilling] = useState<Billing>('hourly')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(''); setNewClient(null); setDue(''); setMembers([]); setAmount(''); setError(null); setStart(today())
    setClient(clientId ?? ''); setTemplate(templateId ?? ''); setOwner(me?.user.id ?? '')
    setBilling('hourly')
    api.get<Client[]>('/clients').then(setClients).catch(() => {})
    api.get<ProjectSummary[]>('/projects?template=1').then(setTemplates).catch(() => {})
  }, [open, templateId, clientId, me?.user.id])

  // Un modèle apporte sa facturation : on la reprend comme point de départ.
  useEffect(() => {
    const t = templates.find((x) => x.id === template)
    if (!t) return
    setBilling(t.billing_mode)
    const f = AMOUNT_FIELD[t.billing_mode]
    const v = f ? t[f] : null
    setAmount(v ? String(v / 100) : '')
  }, [template, templates])

  const people = team.filter((m) => m.active)
  // Formule pleine (server/lib/plans.ts) : le projet naît « à qualifier » plutôt que d'être refusé.
  const plan = me?.plan
  const full = Boolean(plan && plan.projectLimit !== null && plan.openProjects >= plan.projectLimit)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      let client_id: string | null = client || null
      if (newClient !== null) {
        if (!newClient.trim()) throw new Error('Indiquez le nom du nouveau client.')
        client_id = (await api.post<{ id: string }>('/clients', { name: newClient.trim() })).id
        // Le client existe désormais : un nouvel essai le reprend au lieu d'en créer un second.
        setClients((cs) => [...cs, { id: client_id, name: newClient.trim() } as Client]); setClient(client_id); setNewClient(null)
      }
      const field = AMOUNT_FIELD[billing]
      const cents = field ? parseMoney(amount) : null
      if (field && amount.trim() && cents === null) throw new Error('Montant illisible : écrivez par exemple 120 ou 1500.50.')
      const r = await api.post<{ id: string }>('/projects', {
        name: name.trim(), client_id, template_id: template || null, start_date: start || null, due_date: due || null,
        owner_id: owner || null, member_ids: members.filter((m) => m !== owner), billing_mode: billing,
        ...(field ? { [field]: cents } : {}), ...(full ? { status: 'lead' } : {}),
      })
      onClose()
      nav(`/projets/${r.id}`)
    } catch (err) {
      setError(err instanceof Error && !('status' in err) ? err.message : errorText(err))
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau projet" wide
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" type="submit" form="new-project" disabled={busy || !name.trim()}>{busy ? 'Création…' : 'Créer le projet'}</Button>
      </>}>
      <form id="new-project" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {full && plan && (
          <p className="border border-soon/40 bg-soon/5 px-3 py-2 text-sm sm:col-span-2">
            Votre formule gratuite a déjà {plan.projectLimit} projets en cours. Celui-ci sera créé « à qualifier » : vous le passerez
            en cours quand un projet sera terminé ou archivé.{' '}
            <a href={plan.upgradeUrl} className="font-semibold text-accent-dark hover:underline">Passer à Pro</a>
          </p>
        )}
        <Field label="Nom du projet" className="sm:col-span-2">
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Refonte du site, Agrandissement…" />
        </Field>
        <div className="min-w-0 space-y-1.5">
          {newClient === null ? (
            <Field label="Client">
              <Select value={client} onChange={(e) => e.target.value === '__new' ? setNewClient('') : setClient(e.target.value)}>
                <option value="">Sans client (projet interne)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new">+ Nouveau client…</option>
              </Select>
            </Field>
          ) : (
            <Field label="Nouveau client">
              <Input autoFocus value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="Nom de l'entreprise ou de la personne" />
            </Field>
          )}
          {newClient !== null && <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setNewClient(null)}>
            Choisir un client existant</button>}
        </div>
        <Field label="Modèle" hint={template ? 'Étapes, colonnes et tâches du modèle seront reprises, dates décalées.' : undefined}>
          <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">Projet vierge</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Début"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Échéance"><Input type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Responsable">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="min-w-0 space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">Intervenants</span>
          <PeoplePicker people={people.filter((p) => p.id !== owner)} value={members} onChange={setMembers} placeholder="Ajouter une personne…" />
        </div>
        <Field label="Facturation">
          <Select value={billing} onChange={(e) => setBilling(e.target.value as Billing)}>
            {(['hourly', 'retainer', 'fixed', 'milestone', 'none'] as Billing[]).map((b) => <option key={b} value={b}>{BILLING_LABEL[b]}</option>)}
          </Select>
        </Field>
        {AMOUNT_LABEL[billing] ? (
          <Field label={`${AMOUNT_LABEL[billing]} (${me?.account.currency ?? 'CHF'})`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={billing === 'hourly' ? '120' : '5000'} />
          </Field>
        ) : (
          <p className="self-end pb-2 text-xs text-muted-foreground">
            {billing === 'milestone' ? 'Le montant se fixe sur chaque étape, dans l’onglet Étapes.' : 'Le temps passé reste suivi, sans être facturé.'}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-late sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  )
}
