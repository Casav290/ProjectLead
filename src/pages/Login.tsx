import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/store'
import { Button, Input, Spinner } from '../components/ui'
import { AuthField, AuthShell, AuthSwitch, authLink } from '../components/AuthShell'
import { RefusedScreen } from '../components/RefusedScreen'
import { getLocale, useT } from '../i18n'
import { departsAlone, formuleOf, leadStart as baseLeadStart, requestedPage } from '../lib/arrival'

// Les retours en erreur (`?erreur=<code>`) : le texte est la clé `shell.login.err.<code>`, traduite au rendu.
// `formule` : ancien refus de formule (avant le 02.10.2026, tout compte entre désormais) : on propose simplement de réessayer.
const ERRORS = new Set(['lead', 'session', 'email', 'portee', 'formule', 'lead_non_configure'])

/**
 * L'adresse de départ vers le Compte Lead (src/lib/arrival.ts), reprise par l'inscription et l'invitation, avec la
 * langue de l'écran (`locale=`) : le serveur la passe à ERPlead (ui_locales), qui s'ouvre dans la même langue.
 */
export const leadStart = (next: string | null, signup = false, switchAccount = false) =>
  baseLeadStart(next, signup, switchAccount, getLocale())

/**
 * Connexion. Comme InvoiceLead : pas d'écran intermédiaire, tout droit vers la connexion commune
 * du Compte Lead. L'écran ne reste que pour dire une erreur et proposer de réessayer. L'email et le
 * mot de passe restent en secours (`/login?acces=email`) pour les accès créés avant le Compte Lead.
 */
export default function Login() {
  const { refresh } = useApp()
  const t = useT()
  const loc = useLocation()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const code = params.get('erreur') ?? ''
  // Le retour en erreur se redit dans la langue en cours ; une erreur de saisie (e-mail) est gardée telle quelle.
  const [error, setError] = useState<{ key?: string; text?: string } | null>(code ? { key: `shell.login.err.${ERRORS.has(code) ? code : 'lead'}` } : null)
  const shown = error ? (error.key ? t(error.key) : error.text ?? null) : null
  const [busy, setBusy] = useState(false)
  const [leadId, setLeadId] = useState<boolean | null>(null)
  const withEmail = params.get('acces') === 'email'
  // La page demandée avant la connexion : une adresse profonde ouverte sans session y ramène.
  const next = requestedPage(loc.pathname, loc.search)
  // Un seul départ, jamais après un retour en erreur (pas de boucle) : src/lib/arrival.ts.
  const direct = departsAlone({ leadId, code, withEmail })

  useEffect(() => { api.get<{ leadId: boolean }>('/auth/options').then((o) => setLeadId(o.leadId)).catch(() => setLeadId(false)) }, [])
  useEffect(() => { if (direct) window.location.replace(leadStart(next)) }, [direct, next])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.post('/auth/login', { email, password }); await refresh() } catch (err) { setError({ text: errorText(err) }) } finally { setBusy(false) }
  }

  if (leadId === null || direct) return <AuthShell><Spinner label={t('shell.login.connecting')} /></AuthShell>

  // Arrivée refusée (places prises, accès retiré) : un écran qui dit quoi faire selon la formule de l'entreprise (lue
  // dans l'adresse), « Changer de compte » et le Compte ERPlead (src/components/RefusedScreen.tsx).
  if (leadId && (code === 'places' || code === 'desactive')) {
    return <RefusedScreen reason={code} formule={formuleOf(params.get('formule'))} next={next} />
  }

  if (leadId && !withEmail) {
    return (
      <AuthShell title={t('shell.login.title')}>
        {shown && <p role="alert" className="mb-6 border border-late bg-late/5 px-3 py-2 text-sm text-late">{shown}</p>}
        <a href={leadStart(next)} data-testid="lead-login"
          className="flex h-10 w-full items-center justify-center bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-accent-dark">
          {code === 'email' ? t('shell.login.confirmedEnter') : t('shell.login.retryLead')}</a>
        <p className="mt-3 text-center text-sm text-muted-foreground">{t('shell.auth.sameAccount')}</p>
        <AuthSwitch><Link to="/login?acces=email" className={authLink}>{t('shell.login.withEmail')}</Link></AuthSwitch>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('shell.login.title')}>
      <form onSubmit={submit} className="space-y-4">
        <AuthField id="email" label={t('shell.auth.email')}>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </AuthField>
        <AuthField id="password" label={t('shell.auth.password')}>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
        </AuthField>
        {shown && <p role="alert" className="text-sm text-late">{shown}</p>}
        <Button type="submit" variant="primary" className="h-10 w-full" disabled={busy}>{busy ? t('shell.login.loggingIn') : t('shell.login.submit')}</Button>
      </form>
      {leadId
        ? <AuthSwitch><a href={leadStart(next)} className={authLink}>{t('shell.login.withLead')}</a></AuthSwitch>
        : <AuthSwitch>{t('shell.login.noAccount')} <Link to="/signup" className={authLink}>{t('shell.signup.title')}</Link></AuthSwitch>}
    </AuthShell>
  )
}
