import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, ErrorNote, Field, Input, Select, Spinner, Textarea, toast } from '../ui'
import { api } from '../../lib/api'
import { useApp, useLoad } from '../../lib/store'
import { SettingsHeader } from './kit'
import { PlanCard } from '../PlanCard'
import { isLocale, LOCALE_NAMES, LOCALES, useT, type Locale } from '../../i18n'

const ZONES = ['Europe/Zurich', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Vienna', 'Europe/Brussels', 'Europe/Luxembourg',
  'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Lisbon', 'Europe/London', 'America/New_York', 'America/Montreal', 'UTC']

export default function Company() {
  const t = useT()
  const { me, refresh } = useApp()
  // Les chiffres de la formule, à jour à chaque visite (invitations, projets ouverts ailleurs).
  useEffect(() => { refresh() }, [])
  const [f, setF] = useState({ name: '', timezone: 'Europe/Zurich', currency: 'CHF', week_hours: '42', locale: 'fr' as Locale })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (me) setF({ name: me.account.name, timezone: me.account.timezone, currency: me.account.currency, week_hours: String(me.account.week_hours),
                    locale: isLocale(me.account.locale) ? me.account.locale : 'fr' })
  }, [me?.account.id])
  if (!me) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.patch('/account', { name: f.name.trim(), timezone: f.timezone, currency: f.currency, week_hours: Number(f.week_hours.replace(',', '.')),
        locale: f.locale })
      await refresh(); toast(t('settings.company.saved'))
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const zones = ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES]

  return (
    <>
      <SettingsHeader title={t('settings.menu.company')}>{t('settings.company.intro')}</SettingsHeader>
      <div className="max-w-2xl space-y-5">
        <PlanCard />
        <Card title={t('settings.company.identity')}>
          <form onSubmit={save} className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label={t('settings.company.name')} className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} />
            </Field>
            <Field label={t('settings.company.timezone')} hint={t('settings.company.timezoneHint')}>
              <Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                {zones.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
              </Select>
            </Field>
            <Field label={t('settings.company.currency')} hint={t('settings.company.currencyHint')}>
              <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {['CHF', 'EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label={t('settings.company.weekHours')} hint={t('settings.company.weekHoursHint')}>
              <Input inputMode="decimal" value={f.week_hours} onChange={(e) => setF({ ...f, week_hours: e.target.value })} required />
            </Field>
            <Field label={t('settings.company.docLocale')} hint={t('settings.company.docLocaleHint')} className="sm:col-span-2">
              <Select value={f.locale} onChange={(e) => { const v = e.target.value; if (isLocale(v)) setF({ ...f, locale: v }) }}>
                {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
              </Select>
            </Field>
            {error != null && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
            <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={busy || !f.name.trim()}>{t('common.save')}</Button></div>
          </form>
        </Card>
        <SignatureCard />
      </div>
    </>
  )
}

function SignatureCard() {
  const t = useT()
  const { data, loading } = useLoad<{ client_update_signature: string | null }>('/integrations')
  const [sig, setSig] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (data) setSig(data.client_update_signature ?? '') }, [data])
  const save = async () => {
    setBusy(true); setError(null)
    try { await api.patch('/integrations/settings', { client_update_signature: sig }); toast(t('settings.company.signatureSaved')) }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Card title={t('settings.company.signature')}>
      {loading && !data ? <Spinner /> : (
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">{t('settings.company.signatureHint')}</p>
          <Textarea rows={4} value={sig} onChange={(e) => setSig(e.target.value)} maxLength={2000}
            placeholder={t('settings.company.signaturePlaceholder')} aria-label={t('settings.company.signatureAria')} />
          <ErrorNote error={error} />
          <Button onClick={save} disabled={busy}>{t('settings.company.saveSignature')}</Button>
        </div>
      )}
    </Card>
  )
}
