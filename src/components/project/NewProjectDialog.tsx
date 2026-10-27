import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { labels, useT } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { BILLING_LABEL, parseMoney, today } from '../../lib/format'
import { useApp } from '../../lib/store'
import type { Client, ProjectSummary } from '../../lib/types'
import { Button, Field, Input, Modal, PeoplePicker, Select } from '../ui'
import { UpgradeLink } from '../PlanCard'

type Billing = ProjectSummary['billing_mode']

/** Le libellé du montant selon le mode de facturation (rien pour « par étape » et « non facturable »). */
export const AMOUNT_LABEL: Partial<Record<Billing, string>> = labels('ptabs.newProject.amount', ['hourly', 'retainer', 'fixed'])
/** Les devises acceptées par le serveur (server/routes/projects.ts) ; la devise de l'entreprise sert de défaut. */
const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP']
const AMOUNT_FIELD: Partial<Record<Billing, 'hourly_rate_cents' | 'retainer_cents' | 'fixed_cents'>> = {
  hourly: 'hourly_rate_cents', retainer: 'retainer_cents', fixed: 'fixed_cents',
}

/**
 * Créer un projet : vierge ou depuis un modèle, avec son client (créé au vol au besoin),
 * son équipe et sa facturation. Ouvre la fiche du projet une fois créé.
 */
export default function NewProjectDialog({ open, onClose, templateId, clientId }:
  { open: boolean; onClose: () => void; templateId?: string | null; clientId?: string | null }) {
  const t = useT()
  const { me, team } = useApp()
  const currency = CURRENCIES.includes(me?.account.currency ?? '') ? (me?.account.currency as string) : 'CHF'
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
    const tpl = templates.find((x) => x.id === template)
    if (!tpl) return
    setBilling(tpl.billing_mode)
    const f = AMOUNT_FIELD[tpl.billing_mode]
    const v = f ? tpl[f] : null
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
        if (!newClient.trim()) throw new Error(t('ptabs.newProject.errNewClient'))
        client_id = (await api.post<{ id: string }>('/clients', { name: newClient.trim() })).id
        // Le client existe désormais : un nouvel essai le reprend au lieu d'en créer un second.
        setClients((cs) => [...cs, { id: client_id, name: newClient.trim() } as Client]); setClient(client_id); setNewClient(null)
      }
      const field = AMOUNT_FIELD[billing]
      const cents = field ? parseMoney(amount) : null
      if (field && amount.trim() && cents === null) throw new Error(t('ptabs.newProject.errAmount'))
      const r = await api.post<{ id: string }>('/projects', {
        name: name.trim(), client_id, template_id: template || null, start_date: start || null, due_date: due || null,
        owner_id: owner || null, member_ids: members.filter((m) => m !== owner), billing_mode: billing, currency,
        ...(field ? { [field]: cents } : {}), ...(full ? { status: 'lead' } : {}),
      })
      onClose()
      nav(`/projets/${r.id}`)
    } catch (err) {
      setError(err instanceof Error && !('status' in err) ? err.message : errorText(err))
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('ptabs.newProject.title')} wide
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="new-project" disabled={busy || !name.trim()}>{busy ? t('ptabs.newProject.creating') : t('ptabs.newProject.submit')}</Button>
      </>}>
      <form id="new-project" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {full && plan && (
          <p className="border border-soon/40 bg-soon/5 px-3 py-2 text-sm sm:col-span-2">
            {t('ptabs.newProject.planFull', { n: plan.projectLimit })}{' '}
            <UpgradeLink plan={plan}>{t('ptabs.newProject.upgrade')}</UpgradeLink>
          </p>
        )}
        <Field label={t('ptabs.newProject.name')} className="sm:col-span-2">
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ptabs.newProject.namePlaceholder')} />
        </Field>
        <div className="min-w-0 space-y-1.5">
          {newClient === null ? (
            <Field label={t('ptabs.field.client')}>
              <Select value={client} onChange={(e) => e.target.value === '__new' ? setNewClient('') : setClient(e.target.value)}>
                <option value="">{t('ptabs.field.noClient')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new">{t('ptabs.newProject.newClientOption')}</option>
              </Select>
            </Field>
          ) : (
            <Field label={t('ptabs.newProject.newClient')}>
              <Input autoFocus value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder={t('ptabs.newProject.newClientPlaceholder')} />
            </Field>
          )}
          {newClient !== null && <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setNewClient(null)}>
            {t('ptabs.newProject.pickExisting')}</button>}
        </div>
        <Field label={t('ptabs.newProject.template')} hint={template ? t('ptabs.newProject.templateHint') : undefined}>
          <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">{t('ptabs.newProject.blank')}</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label={t('ptabs.field.start')}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t('ptabs.field.due')}><Input type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label={t('ptabs.field.owner')}>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="min-w-0 space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">{t('ptabs.newProject.members')}</span>
          <PeoplePicker people={people.filter((p) => p.id !== owner)} value={members} onChange={setMembers} placeholder={t('ptabs.newProject.addPerson')} />
        </div>
        <Field label={t('ptabs.newProject.billing')}>
          <Select value={billing} onChange={(e) => setBilling(e.target.value as Billing)}>
            {(['hourly', 'retainer', 'fixed', 'milestone', 'none'] as Billing[]).map((b) => <option key={b} value={b}>{BILLING_LABEL[b]}</option>)}
          </Select>
        </Field>
        {AMOUNT_LABEL[billing] ? (
          <Field label={t('ptabs.field.withCurrency', { label: AMOUNT_LABEL[billing], currency })}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={billing === 'hourly' ? '120' : '5000'} />
          </Field>
        ) : (
          <p className="self-end pb-2 text-xs text-muted-foreground">
            {billing === 'milestone' ? t('ptabs.newProject.milestoneHint') : t('ptabs.newProject.noneHint')}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-late sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  )
}
