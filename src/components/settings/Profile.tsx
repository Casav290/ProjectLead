import { useEffect, useState, type FormEvent } from 'react'
import { Avatar, Badge, Button, Card, ErrorNote, Field, Input, toast } from '../ui'
import { api } from '../../lib/api'
import { ROLE_LABEL } from '../../lib/format'
import { useApp } from '../../lib/store'
import { CopyField, SettingsHeader } from './kit'

export const SWATCHES = ['#4f46e5', '#0f6e70', '#0284c7', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#57534e']

export function ColorChoice({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Couleur">
      {SWATCHES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} onClick={() => onChange(c)}
          className={`h-7 w-7 border-2 ${value.toLowerCase() === c ? 'border-foreground' : 'border-transparent'}`} style={{ background: c }} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Autre couleur" className="h-7 w-9 cursor-pointer border border-input bg-card p-0.5" />
    </div>
  )
}

export default function Profile() {
  const { me, refresh, refreshTeam } = useApp()
  const [name, setName] = useState(me?.user.name ?? '')
  const [color, setColor] = useState(me?.user.color ?? '#4f46e5')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (me) { setName(me.user.name); setColor(me.user.color) } }, [me?.user.name, me?.user.color])
  if (!me) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.patch('/me', { name: name.trim(), color }); await Promise.all([refresh(), refreshTeam()]); toast('Profil enregistré') }
    catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <>
      <SettingsHeader title="Profil">Votre nom et votre couleur apparaissent sur les tâches, le planning et l'agenda.</SettingsHeader>
      <div className="max-w-2xl space-y-5">
        <Card title="Vous">
          <form onSubmit={save} className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <Avatar person={{ name: name || me.user.name, color }} size={44} />
              <div className="min-w-0 text-sm">
                <p className="font-bold break-words">{me.user.email}</p>
                <p className="text-muted-foreground">{ROLE_LABEL[me.user.role]} chez {me.account.name}</p>
              </div>
            </div>
            <Field label="Nom"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Field>
            <Field label="Couleur"><ColorChoice value={color} onChange={setColor} /></Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>Enregistrer</Button>
          </form>
        </Card>

        <Card title="Compte Lead">
          <div className="space-y-2 p-4 text-sm">
            {me.user.lead_linked ? (
              <p className="flex flex-wrap items-center gap-2"><Badge tone="ok">Lié</Badge>
                Vous vous connectez avec votre Compte Lead, le même que pour CRMlead et InvoiceLead.</p>
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-2"><Badge>Non lié</Badge>Vous vous connectez avec votre email et votre mot de passe.</p>
                {me.features.leadId && <p className="text-muted-foreground">Pour lier votre Compte Lead, déconnectez-vous puis reconnectez-vous :
                  la connexion passe par le Compte Lead. Utilisez la même adresse e-mail, votre accès est repris tel quel.</p>}
              </>
            )}
          </div>
        </Card>

        <PasswordCard />

        <Card title="Mon agenda ailleurs">
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted-foreground">Abonnez Google Agenda, Outlook ou Apple Calendrier à ce lien pour y voir vos réunions et vos
              échéances ProjectLead. Il est personnel : ne le partagez pas.</p>
            <CopyField value={me.icalUrl} label="Lien iCal personnel" />
          </div>
        </Card>
      </div>
    </>
  )
}

function PasswordCard() {
  const { me } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.post('/me/password', { current: current || undefined, next }); setCurrent(''); setNext(''); toast('Mot de passe changé') }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Card title="Mot de passe">
      <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Mot de passe actuel" hint={me?.user.lead_linked ? 'Laissez vide si vous n\'en avez jamais défini.' : undefined}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nouveau mot de passe" hint="10 caractères au moins.">
          <Input type="password" autoComplete="new-password" minLength={10} required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        {error != null && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
        <div className="sm:col-span-2"><Button type="submit" disabled={busy || next.length < 10}>Changer le mot de passe</Button></div>
      </form>
    </Card>
  )
}
