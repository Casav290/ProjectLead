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

/** Connexion : le Compte Lead d'abord (famille Lead), l'email et le mot de passe ensuite. */
export default function Login() {
  const { refresh } = useApp()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(ERRORS[params.get('erreur') ?? ''] ?? null)
  const [busy, setBusy] = useState(false)
  const [leadId, setLeadId] = useState(false)
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
          <p className="my-4 text-center text-xs text-muted-foreground">ou avec votre email</p>
        </>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Mot de passe"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
        {params.get('upgrade') && <a className="block text-sm font-semibold text-accent underline" href={params.get('upgrade')!}>Mettre à niveau ma formule</a>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">Pas encore de compte ? <Link to="/signup" className="font-semibold text-accent hover:underline">Créer un espace</Link></p>
    </AuthShell>
  )
}
