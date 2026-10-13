import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/store'
import { Button, Input, Spinner } from '../components/ui'
import { AuthField, AuthShell, AuthSwitch, authLink } from '../components/AuthShell'
import { leadEntry } from '../lib/leadFamily'

const ERRORS: Record<string, string> = {
  lead: 'La connexion par le Compte Lead a échoué. Réessayez.',
  session: 'La connexion a expiré en chemin. Réessayez.',
  email: 'Confirmez d\'abord votre adresse e-mail avec le lien envoyé par ERPlead (le lien peut se redemander dans votre compte, sur erplead.io), puis revenez ici.',
  portee: 'Le Compte Lead n\'a pas transmis votre organisation. Reprenez la connexion depuis projectlead.io, sans modifier l\'adresse.',
  // Ancien refus de formule (avant le 02.10.2026, tout compte entre désormais) : on propose simplement de réessayer.
  formule: 'La connexion doit être refaite. Réessayez.',
  lead_non_configure: "Le Compte Lead n'est pas encore branché sur ce serveur.",
}

/**
 * Les arrivées refusées sans autre issue (server/routes/auth.ts, ArrivalRefused) : jamais d'espace à part, un écran qui
 * dit quoi faire. Pas de nouveau départ automatique : il redonnerait le même refus.
 */
const REFUSED: Record<string, { title: string; text: string }> = {
  places: {
    title: 'Toutes les places ProjectLead de votre entreprise sont prises',
    text: 'Votre entreprise a déjà autant de personnes dans ProjectLead que sa formule le permet. Un administrateur peut libérer une place (Réglages → Équipe) ou prendre une formule avec plus de places (Réglages → Entreprise).',
  },
  desactive: {
    title: 'Votre accès à ProjectLead est désactivé',
    text: 'Un administrateur de votre entreprise a désactivé votre accès à ProjectLead. Demandez-lui de le réactiver (Réglages → Équipe).',
  },
}

/** L'adresse de départ vers le Compte Lead, avec la page demandée pour y revenir ensuite. */
export function leadStart(next: string | null, signup = false) {
  const q = new URLSearchParams()
  if (signup) q.set('signup', '1')
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/^\/(login|signup)\b/.test(next)) q.set('next', next)
  const s = q.toString()
  return `/auth/lead/start${s ? `?${s}` : ''}`
}

/**
 * Connexion. Comme InvoiceLead : pas d'écran intermédiaire, tout droit vers la connexion commune
 * du Compte Lead. L'écran ne reste que pour dire une erreur et proposer de réessayer. L'email et le
 * mot de passe restent en secours (`/login?acces=email`) pour les accès créés avant le Compte Lead.
 */
export default function Login() {
  const { refresh } = useApp()
  const loc = useLocation()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const code = params.get('erreur') ?? ''
  const [error, setError] = useState<string | null>(ERRORS[code] ?? (code ? ERRORS.lead : null))
  const [busy, setBusy] = useState(false)
  const [leadId, setLeadId] = useState<boolean | null>(null)
  const withEmail = params.get('acces') === 'email'
  // La page demandée avant la connexion : une adresse profonde ouverte sans session y ramène.
  const next = params.get('next') ?? (loc.pathname !== '/' && loc.pathname !== '/login' ? loc.pathname + loc.search : null)
  const direct = leadId === true && !code && !withEmail

  useEffect(() => { api.get<{ leadId: boolean }>('/auth/options').then((o) => setLeadId(o.leadId)).catch(() => setLeadId(false)) }, [])
  useEffect(() => { if (direct) window.location.replace(leadStart(next)) }, [direct, next])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.post('/auth/login', { email, password }); await refresh() } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  if (leadId === null || direct) return <AuthShell><Spinner label="Connexion au Compte Lead…" /></AuthShell>

  if (leadId && REFUSED[code]) {
    return (
      <AuthShell title={REFUSED[code].title}>
        <p role="alert" className="mb-6 text-sm text-muted-foreground">{REFUSED[code].text}</p>
        <a href={leadStart(next)} data-testid="lead-login"
          className="flex h-10 w-full items-center justify-center bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-accent-dark">
          Réessayer</a>
        <AuthSwitch><a href={leadEntry('erplead')} className={authLink}>Retour à mon Compte Lead</a></AuthSwitch>
      </AuthShell>
    )
  }

  if (leadId && !withEmail) {
    return (
      <AuthShell title="Connexion">
        {error && <p role="alert" className="mb-6 border border-late bg-late/5 px-3 py-2 text-sm text-late">{error}</p>}
        <a href={leadStart(next)} data-testid="lead-login"
          className="flex h-10 w-full items-center justify-center bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-accent-dark">
          {code === 'email' ? 'J\'ai confirmé mon adresse, entrer' : 'Réessayer avec mon Compte Lead'}</a>
        <p className="mt-3 text-center text-sm text-muted-foreground">Le même compte pour toutes les applications Lead.</p>
        <AuthSwitch><Link to="/login?acces=email" className={authLink}>Se connecter avec un e-mail et un mot de passe</Link></AuthSwitch>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Connexion">
      <form onSubmit={submit} className="space-y-4">
        <AuthField id="email" label="E-mail">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </AuthField>
        <AuthField id="password" label="Mot de passe">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
        </AuthField>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
        <Button type="submit" variant="primary" className="h-10 w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Button>
      </form>
      {leadId
        ? <AuthSwitch><a href={leadStart(next)} className={authLink}>Se connecter avec mon Compte Lead</a></AuthSwitch>
        : <AuthSwitch>Pas encore de compte ? <Link to="/signup" className={authLink}>Créer un compte</Link></AuthSwitch>}
    </AuthShell>
  )
}
