import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/store'
import { Button, Input, Spinner } from '../components/ui'
import { AuthField, AuthShell, AuthSwitch, authLink } from '../components/AuthShell'
import { leadStart } from './Login'

/**
 * Inscription. Avec le Compte Lead branché, elle se fait là-bas (écran « Créer un compte » du
 * Compte Lead), comme pour InvoiceLead : tout compte entre en Gratuit, et la formule ProjectLead (prise dans
 * ProjectLead, Réglages → Entreprise) fixe ensuite les quantités. Le
 * formulaire local ne sert qu'aux serveurs sans Compte Lead (développement, essais).
 */
export default function Signup() {
  const { refresh } = useApp()
  const t = useT()
  const [f, setF] = useState({ name: '', email: '', password: '', company: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [leadId, setLeadId] = useState<boolean | null>(null)
  useEffect(() => { api.get<{ leadId: boolean }>('/auth/options').then((o) => setLeadId(o.leadId)).catch(() => setLeadId(false)) }, [])
  useEffect(() => { if (leadId) window.location.replace(leadStart(null, true)) }, [leadId])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.post('/auth/signup', f); await refresh() } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  if (leadId !== false) return <AuthShell><Spinner label={t('shell.signup.opening')} /></AuthShell>
  return (
    <AuthShell title={t('shell.signup.title')}>
      <form onSubmit={submit} className="space-y-4">
        <AuthField id="name" label={t('shell.auth.yourName')}><Input id="name" required autoComplete="name" value={f.name} onChange={set('name')} className="h-10" /></AuthField>
        <AuthField id="company" label={t('shell.signup.company')}><Input id="company" required autoComplete="organization" value={f.company} onChange={set('company')} className="h-10" /></AuthField>
        <AuthField id="email" label={t('shell.auth.email')}><Input id="email" type="email" required autoComplete="email" value={f.email} onChange={set('email')} className="h-10" /></AuthField>
        <AuthField id="password" label={t('shell.auth.password')} hint={t('shell.auth.passwordHint')}>
          <Input id="password" type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} className="h-10" />
        </AuthField>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
        <Button type="submit" variant="primary" className="h-10 w-full" disabled={busy}>{busy ? t('shell.signup.creating') : t('shell.signup.submit')}</Button>
      </form>
      <AuthSwitch>{t('shell.signup.haveAccount')} <Link to="/login" className={authLink}>{t('shell.login.submit')}</Link></AuthSwitch>
    </AuthShell>
  )
}
