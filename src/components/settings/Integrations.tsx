import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, ButtonLink, Card, Checkbox, ErrorNote, Field, Select, Spinner, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtDate as formatDate } from '../../lib/format'
import { useLoad } from '../../lib/store'
import { NotUsed, OpenApp, type LinkedApp } from '../LeadLinks'
import { SettingsHeader, useRole } from './kit'
import { labels, useT } from '../../i18n'

/**
 * Réglages → « Applications Lead » (liaison sans clé, 26.10.2026) : même entreprise dans le Compte Lead = reliées. Rien
 * à copier ni à coller ; ici, seulement l'état des liens et la facturation mensuelle vers InvoiceLead.
 */
type Status = 'linked' | 'not_used'
type Settings = {
  links: { company: string; email?: string; lead: boolean; crmlead: Status; invoicelead: Status }
  company: string
  last_deal_at: string | null; last_client_update_at: string | null; last_invoice_at: string | null
  monthly_billing_auto: boolean; monthly_billing_day: number; invoice_language: 'fr' | 'de' | 'it' | 'en' | 'es'
  client_update_signature: string | null
}

const LANG = labels('settings.integrations.lang', ['fr', 'de', 'it', 'en', 'es'])

function State({ s }: { s: Status }) {
  const t = useT()
  return s === 'linked'
    ? <Badge tone="ok"><span data-link-badge="linked">{t('settings.integrations.linked')}</span></Badge>
    : <Badge><span data-link-badge="not_used">{t('settings.integrations.notUsed')}</span></Badge>
}

export default function Integrations() {
  const t = useT()
  const { data, error, loading, reload } = useLoad<Settings>('/integrations?fresh=1')

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorNote error={error} />
  const l = data.links

  return (
    <>
      <SettingsHeader title={t('settings.menu.integrations')}>{t('settings.integrations.intro')}</SettingsHeader>
      <div className="max-w-3xl space-y-5">
        {l.lead ? (
          <p data-lead-company className="text-sm">{t('settings.integrations.companyLabel')} <b>{l.company}</b>{l.email ? ` (${l.email})` : ''}{t('settings.integrations.companyAfter')}</p>
        ) : (
          <Card>
            <div className="space-y-3 p-4 text-sm">
              <p>{t('settings.integrations.signInOnce')}</p>
              <a href="/auth/lead/start?next=%2Freglages%2Fintegrations" className="inline-flex border border-input bg-card px-3 py-1.5 font-bold hover:bg-muted">
                {t('settings.integrations.signIn')}</a>
            </div>
          </Card>
        )}

        {/* i18n-ok */}<AppRow app="crmlead" title="CRMlead" state={l.crmlead}>
          <p className="text-sm">{t('settings.integrations.crmBefore')}<Link to="/clients" className="font-semibold text-accent">{t('settings.integrations.clients')}</Link>{t('settings.integrations.crmAfter')}</p>
          {(data.last_deal_at || data.last_client_update_at) && (
            <p className="text-xs text-muted-foreground">
              {data.last_deal_at && <>{t('settings.integrations.lastDeal', { date: formatDate(data.last_deal_at) })} </>}
              {data.last_client_update_at && <>{t('settings.integrations.lastAddress', { date: formatDate(data.last_client_update_at) })}</>}
            </p>
          )}
        </AppRow>

        {/* i18n-ok */}<AppRow app="invoicelead" title="InvoiceLead" state={l.invoicelead}>
          <p className="text-sm">{t('settings.integrations.invoiceText')}</p>
          {data.last_invoice_at && <p className="text-xs text-muted-foreground">{t('settings.integrations.lastInvoice', { date: formatDate(data.last_invoice_at) })}</p>}
          <BillingSchedule data={data} onChange={reload} />
        </AppRow>

        <Card title={t('settings.integrations.apiTitle')}>
          <div className="space-y-2 p-4 text-sm">
            <p>{t('settings.integrations.apiText')}</p>
            <ButtonLink to="/reglages/api">{t('settings.integrations.apiKeys')}</ButtonLink>
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
  const t = useT()
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
      toast(t('settings.integrations.billingSaved')); onChange()
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Field label={t('settings.integrations.invoiceLanguage')} className="max-w-xs">
        <Select value={lang} onChange={(e) => setLang(e.target.value as Settings['invoice_language'])}>
          {Object.entries(LANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Checkbox checked={auto} onChange={setAuto} label={t('settings.integrations.autoBefore')} />
        <select value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label={t('settings.integrations.dayOfMonth')} disabled={!auto}
          className="border border-input bg-card px-1 py-0.5 text-sm disabled:opacity-50">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-sm">{t('settings.integrations.autoAfter')}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.integrations.draftsBefore')}<Link to="/facturation" className="font-semibold text-accent">{t('settings.integrations.billing')}</Link>{t('settings.integrations.draftsAfter')}</p>
      <Button onClick={save} disabled={busy || !dirty}>{t('common.save')}</Button>
    </div>
  )
}
