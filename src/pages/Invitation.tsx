import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, Field, Input, Spinner } from '../components/ui'
import { errorText } from '../lib/api'
import { ROLE_LABEL } from '../lib/format'
import { AuthShell, AuthSwitch, authLink } from '../components/AuthShell'
import { leadStart } from './Login'

type Invite = { email: string; role: string; account: string; hasUser: boolean; hasPassword?: boolean; leadId?: boolean }

/**
 * Accepter une invitation à rejoindre une entreprise (page publique, sans session). Avec le Compte Lead branché, on
 * l'accepte par lui (passage entre applications, 13.10.2026) : la connexion revient ici, l'invitation est prise pour la
 * personne connectée à la même adresse vérifiée, et l'espace de l'entreprise s'ouvre. Aucun mot de passe ProjectLead à
 * créer ; celui d'un accès d'avant le Compte Lead reste accepté.
 */
export default function Invitation() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const [inv, setInv] = useState<Invite | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [withPassword, setWithPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const url = `/api/auth/invitation/${encodeURIComponent(token)}`

  useEffect(() => {
    fetch(url).then(async (r) => (r.ok ? setInv(await r.json()) : setInvalid(true))).catch(() => setInvalid(true))
  }, [url])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await fetch(`${url}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(inv?.hasUser ? { password } : { name: name.trim(), password }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `http_${r.status}`)
      window.location.href = '/'
    } catch (err) { setError(errorText(err)); setBusy(false) }
  }

  if (invalid) return (
    <AuthShell title="Invitation introuvable">
      <p className="text-sm text-muted-foreground">Ce lien a expiré ou a déjà servi. Demandez une nouvelle invitation à la personne qui vous a invité.</p>
      <Link to="/login" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">Se connecter</Link>
    </AuthShell>
  )
  if (!inv) return <Spinner />

  const subtitle = <>Vous êtes invité comme <strong className="text-foreground">{(ROLE_LABEL[inv.role] ?? inv.role).toLowerCase()}</strong> avec l'adresse {inv.email}.</>
  const form = (
    <form onSubmit={submit} className="space-y-3">
      {inv.hasUser ? (
        <p className="text-sm text-muted-foreground">Vous avez déjà un compte ProjectLead : confirmez avec votre mot de passe.</p>
      ) : (
        <Field label="Votre nom"><Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
      )}
      <Field label="Mot de passe" hint={inv.hasUser ? undefined : '10 caractères au moins.'}>
        <Input type="password" autoComplete={inv.hasUser ? 'current-password' : 'new-password'} required minLength={10}
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-sm text-late">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Un instant…' : "Accepter l'invitation"}</Button>
    </form>
  )

  if (!inv.leadId) return <AuthShell title={`Rejoindre ${inv.account}`} subtitle={subtitle}>{form}</AuthShell>

  return (
    <AuthShell title={`Rejoindre ${inv.account}`} subtitle={subtitle}>
      {params.get('erreur') === 'adresse' && (
        <div role="alert" className="mb-6 border border-late bg-late/5 px-3 py-2 text-sm text-late">
          Vous êtes connecté au Compte Lead avec une autre adresse. Cette invitation est pour {inv.email} : connectez-vous
          au Compte Lead avec cette adresse pour l'accepter. <Link to="/" className="font-semibold underline">Aller à mon espace</Link>
        </div>
      )}
      <a href={leadStart(`/invitation/${token}`)} data-testid="lead-accept"
        className="flex h-10 w-full items-center justify-center bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-accent-dark">
        Accepter avec mon Compte Lead</a>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        Connectez-vous avec l'adresse {inv.email}, ou créez votre Compte Lead à l'étape suivante. Le même compte pour toutes les applications Lead.
      </p>
      {inv.hasPassword && (withPassword
        ? <div className="mt-6 border-t border-border pt-6">{form}</div>
        : <AuthSwitch><button type="button" onClick={() => setWithPassword(true)} className={authLink}>J'ai un mot de passe ProjectLead</button></AuthSwitch>)}
    </AuthShell>
  )
}
