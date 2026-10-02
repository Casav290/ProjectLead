import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Confirm, ErrorNote, Field, Input, Select, Spinner, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { useApp, useLoad } from '../../lib/store'
import { CopyField, Note, SettingsHeader } from './kit'

type Settings = {
  crmlead_url: string | null; crmlead_key: boolean; invoicelead_url: string | null; invoicelead_key: boolean
  monthly_billing_auto: boolean; monthly_billing_day: number; invoice_language: 'fr' | 'de' | 'it' | 'en'
  client_update_signature: string | null; secret_configured: boolean
  lead_exchange: { inbox: string; configured: boolean }
}
type App = 'crmlead' | 'invoicelead'

const LANG: Record<string, string> = { fr: 'Français', de: 'Allemand', it: 'Italien', en: 'Anglais' }

export default function Integrations() {
  const { refresh } = useApp()
  const { data, error, loading, reload } = useLoad<Settings>('/integrations')
  const changed = () => { reload(); refresh() }

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorNote error={error} />
  const inbox = data.lead_exchange.inbox.startsWith('http') ? data.lead_exchange.inbox : `${window.location.origin}${data.lead_exchange.inbox}`

  return (
    <>
      <SettingsHeader title="Intégrations">ProjectLead travaille avec les autres apps de la famille Lead : les adresses viennent de CRMlead,
        les factures partent dans InvoiceLead.</SettingsHeader>
      <div className="max-w-3xl space-y-5">
        {!data.secret_configured && (
          <Note tone="warn">
            <p className="font-bold">Les clés ne peuvent pas être enregistrées.</p>
            <p className="mt-1 text-muted-foreground">Le serveur n'a pas de secret de chiffrement (variable <code className="font-mono">APP_SECRET</code>) :
              les clés d'API ne peuvent pas y être gardées en sécurité. La personne qui administre le serveur doit l'ajouter.</p>
          </Note>
        )}

        <LinkCard app="crmlead" data={data} onChange={changed}
          title="CRMlead" intro="Le carnet d'adresses : reprenez l'adresse et les contacts des entreprises de vos leads, et gardez-les à jour."
          keyHint={<>Créez une clé <code className="font-mono">crm_…</code> dans CRMlead → Intégrations, puis collez-la ici.</>}
          keyPlaceholder="crm_…" defaultUrl="https://crmlead.io">
          <CrmleadRefresh />
        </LinkCard>

        <LinkCard app="invoicelead" data={data} onChange={changed}
          title="InvoiceLead" intro="La facturation : chaque mois, un brouillon de facture par projet, que vous relisez et émettez dans InvoiceLead."
          keyHint={<>Créez une clé <code className="font-mono">il_live_…</code> dans InvoiceLead → Réglages → API (formule Pro+), puis collez-la ici.</>}
          keyPlaceholder="il_live_…" defaultUrl="https://invoicelead.io" language>
          <BillingSchedule data={data} onChange={reload} />
        </LinkCard>

        <Card title="Compte Lead et échange">
          <div className="space-y-3 p-4 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              {data.lead_exchange.configured ? <Badge tone="ok">Disponible</Badge> : <Badge>Non configuré sur ce serveur</Badge>}
            </p>
            <p>Les affaires gagnées dans CRMlead arrivent ici d'elles-mêmes, en projets « à qualifier » avec leur client, pour toute
              entreprise connectée à ProjectLead avec son Compte Lead. Rien à régler : CRMlead connaît l'adresse de réception.</p>
            <CopyField value={inbox} label="Adresse de réception" />
            {!data.lead_exchange.configured && (
              <p className="text-xs text-muted-foreground">L'échange passe par le Compte Lead : la personne qui administre le serveur doit
                y déclarer ProjectLead (variable <code className="font-mono">LEAD_ID_CLIENT_SECRET</code>).</p>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}

function LinkCard({ app, data, title, intro, keyHint, keyPlaceholder, defaultUrl, language, onChange, children }: {
  app: App; data: Settings; title: string; intro: string; keyHint: ReactNode; keyPlaceholder: string; defaultUrl: string
  language?: boolean; onChange: () => void; children?: ReactNode
}) {
  const savedUrl = data[`${app}_url`]
  const connected = Boolean(savedUrl && data[`${app}_key`])
  // L'adresse de l'application de la famille, déjà remplie : seule la clé est à coller.
  const [url, setUrl] = useState(savedUrl ?? defaultUrl)
  const [key, setKey] = useState('')
  const [lang, setLang] = useState(data.invoice_language)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  useEffect(() => { setUrl(savedUrl ?? defaultUrl); setLang(data.invoice_language) }, [savedUrl, defaultUrl, data.invoice_language])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.put(`/integrations/${app}`, { url: url.trim(), key: key.trim() || undefined, ...(language ? { invoice_language: lang } : {}) })
      setKey(''); toast(key ? `${title} branché : la clé est acceptée` : 'Enregistré'); onChange()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const disconnect = async () => {
    try { await api.del(`/integrations/${app}`); toast(`${title} déconnecté`); setKey(''); onChange() } catch (err) { toast(errorText(err)) }
  }

  return (
    <Card title={title} action={connected ? <Badge tone="ok">Branché</Badge> : <Badge>Non branché</Badge>}>
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">{intro}</p>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Adresse">
              <Input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder={defaultUrl} />
            </Field>
            <Field label="Clé d'API" hint={connected ? 'Une clé est enregistrée : laissez vide pour la garder.' : undefined}>
              <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} required={!connected}
                placeholder={connected ? '••••••••' : keyPlaceholder} />
            </Field>
            {language && (
              <Field label="Langue des factures">
                <Select value={lang} onChange={(e) => setLang(e.target.value as Settings['invoice_language'])}>
                  {Object.entries(LANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{keyHint} La clé est essayée avant d'être enregistrée, chiffrée.</p>
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !data.secret_configured || !url.trim() || (!connected && !key.trim())}>
              {busy ? 'Essai de la clé…' : connected ? 'Enregistrer' : `Brancher ${title}`}</Button>
            {connected && <Button variant="danger" onClick={() => setDisconnecting(true)}>Déconnecter</Button>}
          </div>
        </form>
        {connected && children}
      </div>
      <Confirm open={disconnecting} onClose={() => setDisconnecting(false)} title={`Déconnecter ${title} ?`} danger confirmLabel="Déconnecter"
        onConfirm={disconnect}>
        La clé est effacée de ProjectLead. Les données déjà reprises restent ; vous pourrez rebrancher {title} avec une nouvelle clé.
      </Confirm>
    </Card>
  )
}

function CrmleadRefresh() {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ updated: number; missing: number }>('/integrations/crmlead/refresh-clients')
      toast(`${r.updated} adresse${r.updated > 1 ? 's' : ''} mise${r.updated > 1 ? 's' : ''} à jour${r.missing ? `, ${r.missing} introuvable${r.missing > 1 ? 's' : ''} dans CRMlead` : ''}`)
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="min-w-0 flex-1 text-sm">Relire dans CRMlead l'adresse et les contacts de tous les <Link to="/clients" className="font-semibold text-accent">clients</Link> qui en viennent.</p>
      <Button onClick={run} disabled={busy}>{busy ? 'Mise à jour…' : 'Mettre à jour toutes les adresses'}</Button>
    </div>
  )
}

function BillingSchedule({ data, onChange }: { data: Settings; onChange: () => void }) {
  const [auto, setAuto] = useState(data.monthly_billing_auto)
  const [day, setDay] = useState(data.monthly_billing_day)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setAuto(data.monthly_billing_auto); setDay(data.monthly_billing_day) }, [data.monthly_billing_auto, data.monthly_billing_day])
  const save = async () => {
    setBusy(true)
    try { await api.patch('/integrations/settings', { monthly_billing_auto: auto, monthly_billing_day: day }); toast('Facturation automatique enregistrée'); onChange() }
    catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Checkbox checked={auto} onChange={setAuto} label="Créer automatiquement les brouillons du mois précédent, le" />
        <select value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Jour du mois" disabled={!auto}
          className="border border-input bg-card px-1 py-0.5 text-sm disabled:opacity-50">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-sm">du mois</span>
      </div>
      <p className="text-xs text-muted-foreground">Les brouillons attendent dans InvoiceLead ; rien n'est envoyé au client sans vous. Vous pouvez aussi les créer à la main
        depuis <Link to="/facturation" className="font-semibold text-accent">Facturation</Link>.</p>
      <Button onClick={save} disabled={busy || (auto === data.monthly_billing_auto && day === data.monthly_billing_day)}>Enregistrer</Button>
    </div>
  )
}
