import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button } from '../components/ui'
import { PublicShell, publicError, publicFetch } from './Booking'

type Managed = { name: string; email: string; starts_at: string; ends_at: string; status: 'confirmed' | 'cancelled'; type_name: string
  location: string; account_name: string; timezone: string; slug: string }

/** Le lien reçu par email : voir son rendez-vous et l'annuler. */
export default function BookingManage() {
  const { token = '' } = useParams()
  const [b, setB] = useState<Managed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => publicFetch<Managed>(`/booking/manage/${token}`).then((x) => { setB(x); setError(null) }).catch((e) => setError(publicError(e)))
  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    setBusy(true)
    try { await publicFetch(`/booking/manage/${token}/cancel`, {}); await load(); setConfirming(false) }
    catch (e) { setError(publicError(e)) } finally { setBusy(false) }
  }

  if (!b) return <PublicShell><p className="border border-border bg-card p-6 text-center text-sm">{error ?? 'Chargement…'}</p></PublicShell>

  const when = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-CH', { timeZone: b.timezone, ...o })
  const past = Date.parse(b.starts_at) < Date.now()
  const cancelled = b.status === 'cancelled'

  return (
    <PublicShell account={b.account_name}>
      <div className="border border-input bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-muted-foreground">Votre rendez-vous</p>
            <h1 className="font-display text-2xl">{b.type_name}</h1>
          </div>
          {cancelled ? <Badge tone="late">Annulé</Badge> : past ? <Badge>Passé</Badge> : <Badge tone="ok">Confirmé</Badge>}
        </div>
        <dl className="mt-5 space-y-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Quand</dt>
            <dd className={cancelled ? 'line-through' : 'font-bold'}><span className="inline-block first-letter:uppercase">{when({ dateStyle: 'full' }).format(new Date(b.starts_at))}</span>,
              {' '}{when({ timeStyle: 'short' }).format(new Date(b.starts_at))} – {when({ timeStyle: 'short' }).format(new Date(b.ends_at))}</dd></div>
          {b.location && <div><dt className="text-xs text-muted-foreground">Où</dt><dd className="[overflow-wrap:anywhere]">{b.location}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">Avec</dt><dd>{b.account_name}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Au nom de</dt><dd className="[overflow-wrap:anywhere]">{b.name} · {b.email}</dd></div>
        </dl>
        {error && <p role="alert" className="mt-4 text-sm text-late">{error}</p>}
        {cancelled ? (
          <div className="mt-6 border-t border-border pt-4 text-sm">
            <p>Ce rendez-vous est annulé.</p>
            <Link to={`/rdv/${b.slug}`} className="mt-2 inline-block font-bold text-accent hover:underline">Prendre un nouveau rendez-vous</Link>
          </div>
        ) : !past && (
          <div className="mt-6 border-t border-border pt-4">
            {confirming ? (
              <div className="space-y-3">
                <p className="text-sm">Annuler ce rendez-vous ? {b.account_name} en sera prévenu.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={busy} onClick={cancel}>{busy ? 'Annulation…' : 'Oui, annuler'}</Button>
                  <Button onClick={() => setConfirming(false)}>Garder le rendez-vous</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={() => setConfirming(true)}>Annuler le rendez-vous</Button>
                <Link to={`/rdv/${b.slug}`} className="text-sm font-bold text-accent hover:underline">Choisir une autre date</Link>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Pour déplacer le rendez-vous, annulez-le puis choisissez un nouveau créneau.</p>
          </div>
        )}
      </div>
    </PublicShell>
  )
}
