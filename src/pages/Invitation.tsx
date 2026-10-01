import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Field, Input, Spinner } from '../components/ui'
import { errorText } from '../lib/api'
import { ROLE_LABEL } from '../lib/format'
import { AuthShell } from '../components/AuthShell'

type Invite = { email: string; role: string; account: string; hasUser: boolean }

/** Accepter une invitation à rejoindre une entreprise (page publique, sans session). */
export default function Invitation() {
  const { token = '' } = useParams()
  const [inv, setInv] = useState<Invite | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
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

  return (
    <AuthShell title={`Rejoindre ${inv.account}`}
      subtitle={<>Vous êtes invité comme <strong className="text-foreground">{(ROLE_LABEL[inv.role] ?? inv.role).toLowerCase()}</strong> avec l'adresse {inv.email}.</>}>
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
    </AuthShell>
  )
}
