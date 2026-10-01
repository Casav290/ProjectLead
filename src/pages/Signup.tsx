import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/store'
import { Button, Field, Input } from '../components/ui'

export function AuthShell({ title, children, subtitle }: { title: string; children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-extrabold">
        <span className="grid h-9 w-9 place-items-center bg-brand text-sm text-white">PL</span>ProjectLead
      </div>
      <div className="w-full max-w-sm border border-input bg-card p-6">
        <h1 className="mb-1 font-display text-2xl">{title}</h1>
        {subtitle && <p className="mb-4 text-sm text-muted-foreground">{subtitle}</p>}
        <div className={subtitle ? '' : 'mt-4'}>{children}</div>
      </div>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">La gestion de projet de la famille Lead, reliée à CRMlead et InvoiceLead.</p>
    </div>
  )
}

export default function Signup() {
  const { refresh } = useApp()
  const [f, setF] = useState({ name: '', email: '', password: '', company: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.post('/auth/signup', f); await refresh() } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <AuthShell title="Créer votre espace" subtitle="Un modèle de projet vous attend pour démarrer.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Votre nom"><Input required autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Entreprise"><Input required autoComplete="organization" value={f.company} onChange={set('company')} /></Field>
        <Field label="Email"><Input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mot de passe" hint="10 caractères au moins."><Input type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        {error && <p role="alert" className="text-sm text-late">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Création…' : 'Créer mon espace'}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">Déjà un compte ? <Link to="/login" className="font-semibold text-accent hover:underline">Se connecter</Link></p>
    </AuthShell>
  )
}
