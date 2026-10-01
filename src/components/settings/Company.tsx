import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, ErrorNote, Field, Input, Select, Spinner, Textarea, toast } from '../ui'
import { api } from '../../lib/api'
import { useApp, useLoad } from '../../lib/store'
import { SettingsHeader } from './kit'

const ZONES = ['Europe/Zurich', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Vienna', 'Europe/Brussels', 'Europe/Luxembourg',
  'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Lisbon', 'Europe/London', 'America/New_York', 'America/Montreal', 'UTC']

export default function Company() {
  const { me, refresh } = useApp()
  const [f, setF] = useState({ name: '', timezone: 'Europe/Zurich', currency: 'CHF', week_hours: '42' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (me) setF({ name: me.account.name, timezone: me.account.timezone, currency: me.account.currency, week_hours: String(me.account.week_hours) })
  }, [me?.account.id])
  if (!me) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.patch('/account', { name: f.name.trim(), timezone: f.timezone, currency: f.currency, week_hours: Number(f.week_hours.replace(',', '.')) })
      await refresh(); toast('Entreprise enregistrée')
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const zones = ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES]

  return (
    <>
      <SettingsHeader title="Entreprise">Ces réglages valent pour toute l'équipe.</SettingsHeader>
      <div className="max-w-2xl space-y-5">
        <Card title="Identité et calendrier">
          <form onSubmit={save} className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Nom de l'entreprise" className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} />
            </Field>
            <Field label="Fuseau horaire" hint="Pour les rendez-vous, les rappels et les échéances.">
              <Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                {zones.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
              </Select>
            </Field>
            <Field label="Devise" hint="Celle des nouveaux projets.">
              <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {['CHF', 'EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Heures par semaine" hint="Temps de travail de référence, pour la charge de l'équipe.">
              <Input inputMode="decimal" value={f.week_hours} onChange={(e) => setF({ ...f, week_hours: e.target.value })} required />
            </Field>
            {error != null && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
            <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={busy || !f.name.trim()}>Enregistrer</Button></div>
          </form>
        </Card>
        <SignatureCard />
      </div>
    </>
  )
}

function SignatureCard() {
  const { data, loading } = useLoad<{ client_update_signature: string | null }>('/integrations')
  const [sig, setSig] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (data) setSig(data.client_update_signature ?? '') }, [data])
  const save = async () => {
    setBusy(true); setError(null)
    try { await api.patch('/integrations/settings', { client_update_signature: sig }); toast('Signature enregistrée') }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Card title="Signature des suivis client">
      {loading && !data ? <Spinner /> : (
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">Ajoutée au bas des emails de suivi envoyés aux clients (avancement, prochaines étapes).</p>
          <Textarea rows={4} value={sig} onChange={(e) => setSig(e.target.value)} maxLength={2000}
            placeholder={'Meilleures salutations,\nL\'équipe'} aria-label="Signature" />
          <ErrorNote error={error} />
          <Button onClick={save} disabled={busy}>Enregistrer la signature</Button>
        </div>
      )}
    </Card>
  )
}
