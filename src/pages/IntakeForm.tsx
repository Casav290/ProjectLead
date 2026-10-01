import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Field, Input, Textarea } from '../components/ui'
import { PublicShell, publicError, publicFetch } from './Booking'

type Form = { name: string; intro: string; account: string }

/** Formulaire public de demande : chaque envoi ouvre un projet « à qualifier ». */
export default function IntakeForm() {
  const { slug = '' } = useParams()
  const [form, setForm] = useState<Form | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [f, setF] = useState({ name: '', email: '', company: '', phone: '', subject: '', message: '', website: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  useEffect(() => {
    publicFetch<Form>(`/forms/${slug}`).then((x) => { setForm(x); document.title = `${x.name} — ${x.account}` }).catch((e) => setLoadError(publicError(e)))
  }, [slug])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await publicFetch(`/forms/${slug}`, {
        name: f.name.trim(), email: f.email.trim(), subject: f.subject.trim(), message: f.message, website: f.website,
        ...(f.company.trim() ? { company: f.company.trim() } : {}), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      })
      setSent(true)
      window.scrollTo(0, 0)
    } catch (err) { setError(publicError(err)) } finally { setBusy(false) }
  }

  if (!form) return <PublicShell><p className="border border-border bg-card p-6 text-center text-sm">{loadError ?? 'Chargement…'}</p></PublicShell>

  return (
    <PublicShell account={form.account}>
      <div className="border border-input bg-card p-5 sm:p-6">
        {sent ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center bg-won text-white" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12l5 5 9-10" /></svg>
            </div>
            <h1 className="font-display text-2xl">Merci, votre demande est bien arrivée</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{form.account} l'a reçue et reviendra vers vous à l'adresse {f.email}.</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold text-muted-foreground">{form.account}</p>
            <h1 className="mt-1 font-display text-2xl">{form.name}</h1>
            {form.intro && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{form.intro}</p>}
            <form onSubmit={submit} className="mt-5 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nom et prénom"><Input required maxLength={120} autoComplete="name" value={f.name} onChange={set('name')} /></Field>
                <Field label="Email"><Input required type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
                <Field label="Entreprise (facultatif)"><Input maxLength={200} autoComplete="organization" value={f.company} onChange={set('company')} /></Field>
                <Field label="Téléphone (facultatif)"><Input type="tel" maxLength={50} autoComplete="tel" value={f.phone} onChange={set('phone')} /></Field>
              </div>
              <Field label="Objet de la demande"><Input required maxLength={200} value={f.subject} onChange={set('subject')} placeholder="Ex. Rénovation de nos bureaux" /></Field>
              <Field label="Votre message"><Textarea rows={6} maxLength={10000} value={f.message} onChange={set('message')} placeholder="Le contexte, les délais, le budget envisagé…" /></Field>
              {/* Piège à robots : invisible pour un humain, doit rester vide. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>Site web<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} name="website" /></label>
              </div>
              {error && <p role="alert" className="text-sm text-late">{error}</p>}
              <Button type="submit" variant="primary" className="w-full py-3 sm:w-auto" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</Button>
              <p className="text-xs text-muted-foreground">Vos coordonnées servent uniquement à répondre à votre demande.</p>
            </form>
          </>
        )}
      </div>
    </PublicShell>
  )
}
