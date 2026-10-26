import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, ButtonLink, Card, Checkbox, ErrorNote, Field, Select, Spinner, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtDate as formatDate } from '../../lib/format'
import { useLoad } from '../../lib/store'
import { NotUsed, OpenApp, type LinkedApp } from '../LeadLinks'
import { SettingsHeader, useRole } from './kit'

/**
 * Réglages → « Applications Lead » (liaison sans clé, 26.10.2026) : même entreprise dans le Compte Lead = reliées. Rien
 * à copier ni à coller ; ici, seulement l'état des liens et la facturation mensuelle vers InvoiceLead.
 */
type Status = 'linked' | 'not_used'
type Settings = {
  links: { company: string; email?: string; lead: boolean; crmlead: Status; invoicelead: Status }
  company: string
  last_deal_at: string | null; last_client_update_at: string | null; last_invoice_at: string | null
  monthly_billing_auto: boolean; monthly_billing_day: number; invoice_language: 'fr' | 'de' | 'it' | 'en'
  client_update_signature: string | null
}

const LANG: Record<string, string> = { fr: 'Français', de: 'Allemand', it: 'Italien', en: 'Anglais' }

const State = ({ s }: { s: Status }) => s === 'linked'
  ? <Badge tone="ok"><span data-link-badge="linked">Reliée</span></Badge>
  : <Badge><span data-link-badge="not_used">Pas encore utilisée</span></Badge>

export default function Integrations() {
  const { data, error, loading, reload } = useLoad<Settings>('/integrations?fresh=1')

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorNote error={error} />
  const l = data.links

  return (
    <>
      <SettingsHeader title="Applications Lead">ProjectLead travaille avec les autres applications de la famille Lead : les adresses
        viennent de CRMlead, les factures partent dans InvoiceLead.</SettingsHeader>
      <div className="max-w-3xl space-y-5">
        {l.lead ? (
          <p data-lead-company className="text-sm">Entreprise du Compte Lead : <b>{l.company}</b>{l.email ? ` (${l.email})` : ''}. Les applications
            ouvertes avec cette entreprise se relient toutes seules : rien à copier ni à coller.</p>
        ) : (
          <Card>
            <div className="space-y-3 p-4 text-sm">
              <p>Connectez-vous une fois avec votre Compte Lead pour relier vos applications.</p>
              <a href="/auth/lead/start?next=%2Freglages%2Fintegrations" className="inline-flex border border-input bg-card px-3 py-1.5 font-bold hover:bg-muted">
                Se connecter avec le Compte Lead</a>
            </div>
          </Card>
        )}

        <AppRow app="crmlead" title="CRMlead" state={l.crmlead}>
          <p className="text-sm">Les affaires gagnées dans CRMlead arrivent ici comme projets, et l'adresse de leurs clients reste à jour.
            Reprenez un autre client de CRMlead depuis <Link to="/clients" className="font-semibold text-accent">Clients</Link>. Pour arrêter
            l'envoi : CRMlead → Intégrations → Applications Lead.</p>
          {(data.last_deal_at || data.last_client_update_at) && (
            <p className="text-xs text-muted-foreground">
              {data.last_deal_at && <>Dernière affaire reçue : {formatDate(data.last_deal_at)}. </>}
              {data.last_client_update_at && <>Dernière adresse mise à jour : {formatDate(data.last_client_update_at)}.</>}
            </p>
          )}
        </AppRow>

        <AppRow app="invoicelead" title="InvoiceLead" state={l.invoicelead}>
          <p className="text-sm">Les brouillons de factures du mois partent dans InvoiceLead ; vous les relisez et les émettez là-bas.</p>
          {data.last_invoice_at && <p className="text-xs text-muted-foreground">Dernier brouillon créé : {formatDate(data.last_invoice_at)}.</p>}
          <BillingSchedule data={data} onChange={reload} />
        </AppRow>

        <Card title="API et outils extérieurs">
          <div className="space-y-2 p-4 text-sm">
            <p>Pour Zapier, Make, Claude, ChatGPT ou vos scripts. Pas besoin de clé pour relier les applications Lead.</p>
            <ButtonLink to="/reglages/api">Clés d'API pour les outils extérieurs</ButtonLink>
          </div>
        </Card>
      </div>
    </>
  )
}

function AppRow({ app, title, state, children }: { app: LinkedApp; title: string; state: Status; children: React.ReactNode }) {
  return (
    <Card title={title} action={<State s={state} />}>
      <div data-lead-app-row={app} className="space-y-3 p-4">
        {state === 'linked' ? <>{children}<OpenApp app={app} /></> : <NotUsed app={app} />}
      </div>
    </Card>
  )
}

/** Langue des factures et brouillons automatiques : seulement si InvoiceLead est reliée (la page est réservée aux administrateurs). */
function BillingSchedule({ data, onChange }: { data: Settings; onChange: () => void }) {
  const { isAdmin } = useRole()
  const [auto, setAuto] = useState(data.monthly_billing_auto)
  const [day, setDay] = useState(data.monthly_billing_day)
  const [lang, setLang] = useState(data.invoice_language)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setAuto(data.monthly_billing_auto); setDay(data.monthly_billing_day); setLang(data.invoice_language) },
    [data.monthly_billing_auto, data.monthly_billing_day, data.invoice_language])
  if (!isAdmin) return null
  const dirty = auto !== data.monthly_billing_auto || day !== data.monthly_billing_day || lang !== data.invoice_language
  const save = async () => {
    setBusy(true)
    try {
      await api.patch('/integrations/settings', { monthly_billing_auto: auto, monthly_billing_day: day, invoice_language: lang })
      toast('Facturation enregistrée'); onChange()
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Field label="Langue des factures" className="max-w-xs">
        <Select value={lang} onChange={(e) => setLang(e.target.value as Settings['invoice_language'])}>
          {Object.entries(LANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Checkbox checked={auto} onChange={setAuto} label="Créer les brouillons automatiquement le" />
        <select value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Jour du mois" disabled={!auto}
          className="border border-input bg-card px-1 py-0.5 text-sm disabled:opacity-50">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-sm">du mois</span>
      </div>
      <p className="text-xs text-muted-foreground">Les brouillons du mois précédent attendent dans InvoiceLead ; rien n'est envoyé au client sans vous.
        Vous pouvez aussi les créer à la main depuis <Link to="/facturation" className="font-semibold text-accent">Facturation</Link>.</p>
      <Button onClick={save} disabled={busy || !dirty}>Enregistrer</Button>
    </div>
  )
}
