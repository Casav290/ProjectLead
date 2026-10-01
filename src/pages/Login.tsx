import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/store'
import { Button, Field, Input } from '../components/ui'
import { AuthShell } from './Signup'

const ERRORS: Record<string, string> = {
  lead: 'La connexion par le Compte Lead a échoué. Réessayez.',
  session: 'La connexion a expiré en chemin. Réessayez.',
  formule: "Votre formule n'inclut pas ProjectLead.",
  lead_non_configure: "Le Compte Lead n'est pas encore branché sur ce serveur.",
}

/**
 * Connexion. Avec le Compte Lead branché, c'est l'entrée unique de la famille (comme InvoiceLead) :
 * le bouton seul, l'email et le mot de passe repliés pour les anciens accès.
 */
export default function Login() {
  const { refresh } = useApp()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(ERRORS[params.get('erreur') ?? ''] ?? null)
  const [busy, setBusy] = useState(false)
  const [leadId, setLeadId] = useState(false)
  const [withEmail, setWithEmail] = useState(false)
  useEffect(() => { api.get<{ leadId: boolean }>('/auth/options').then((o) => setLeadId(o.leadId)).catch(() => {}) }, [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.post('/auth/login', { email, password }); await refresh() } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <AuthShell title="Connexion">
      {leadId && (
        <>
          <a href="/auth/lead/start" className="flex w-full items-center justify-center bg-[#0E6D6E] px-3 py-2.5 text-sm font-bold text-white hover:brightness-110">
            Se connecter avec mon compte Lead</a>
          <p className="mt-3 text-center text-sm text-muted-foreground">Le même compte pour Scanlead, CRMlead, ProjectLead et InvoiceLead.</p>
          {error && !withEmail && <p role="alert" className="mt-3 text-sm text-late">{error}</p>}
          {params.get('upgrade') && <a className="mt-2 block text-sm font-semibold text-accent underline" href={params.get('upgrade')!}>Mettre à niveau ma formule</a>}
          {!withEmail && (
            <button type="button" onClick={() => setWithEmail(true)} className="mt-6 block w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline">
              Se connecter avec un email et un mot de passe</button>
          )}
        </>
      )}
      {(!leadId || withEmail) && (
        <form onSubmit={submit} className={leadId ? 'mt-6 space-y-3 border-t border-border pt-6' : 'space-y-3'}>
          <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Mot de passe"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-late">{error}</p>}
          {!leadId && params.get('upgrade') && <a className="block text-sm font-semibold text-accent underline" href={params.get('upgrade')!}>Mettre à niveau ma formule</a>}
          <Button type="submit" variant={leadId ? 'outline' : 'primary'} className="w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Button>
        </form>
      )}
      {!leadId && <p className="mt-4 text-center text-sm text-muted-foreground">Pas encore de compte ? <Link to="/signup" className="font-semibold text-accent hover:underline">Créer un espace</Link></p>}
    </AuthShell>
  )
}
