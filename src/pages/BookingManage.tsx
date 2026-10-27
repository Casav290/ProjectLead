import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button } from '../components/ui'
import { intlLocale, useT } from '../i18n'
import { PublicShell, publicError, publicFetch } from './Booking'

type Managed = { name: string; email: string; starts_at: string; ends_at: string; status: 'confirmed' | 'cancelled'; type_name: string
  location: string; account_name: string; timezone: string; slug: string }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Le lien reçu par email : voir son rendez-vous et l'annuler. */
export default function BookingManage() {
  const t = useT()
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

  if (!b) return <PublicShell><p className="border border-border bg-card p-6 text-center text-sm">{error ?? t('common.loading')}</p></PublicShell>

  const when = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(), { timeZone: b.timezone, ...o })
  const past = Date.parse(b.starts_at) < Date.now()
  const cancelled = b.status === 'cancelled'

  return (
    <PublicShell account={b.account_name}>
      <div className="border border-input bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-muted-foreground">{t('public.manage.yourBooking')}</p>
            <h1 className="font-display text-2xl">{b.type_name}</h1>
          </div>
          {cancelled ? <Badge tone="late">{t('public.manage.cancelled')}</Badge> : past ? <Badge>{t('public.manage.past')}</Badge> : <Badge tone="ok">{t('public.manage.confirmed')}</Badge>}
        </div>
        <dl className="mt-5 space-y-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">{t('public.manage.when')}</dt>
            <dd className={cancelled ? 'line-through' : 'font-bold'}>{cap(when({ dateStyle: 'full' }).format(new Date(b.starts_at)))},
              {' '}{when({ timeStyle: 'short' }).format(new Date(b.starts_at))} – {when({ timeStyle: 'short' }).format(new Date(b.ends_at))}</dd></div>
          {b.location && <div><dt className="text-xs text-muted-foreground">{t('public.manage.where')}</dt><dd className="[overflow-wrap:anywhere]">{b.location}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">{t('public.manage.with')}</dt><dd>{b.account_name}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('public.manage.bookedBy')}</dt><dd className="[overflow-wrap:anywhere]">{b.name} · {b.email}</dd></div>
        </dl>
        {error && <p role="alert" className="mt-4 text-sm text-late">{error}</p>}
        {cancelled ? (
          <div className="mt-6 border-t border-border pt-4 text-sm">
            <p>{t('public.manage.isCancelled')}</p>
            <Link to={`/rdv/${b.slug}`} className="mt-2 inline-block font-bold text-accent hover:underline">{t('public.manage.newBooking')}</Link>
          </div>
        ) : !past && (
          <div className="mt-6 border-t border-border pt-4">
            {confirming ? (
              <div className="space-y-3">
                <p className="text-sm">{t('public.manage.cancelAsk', { account: b.account_name })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={busy} onClick={cancel}>{busy ? t('public.manage.cancelling') : t('public.manage.yesCancel')}</Button>
                  <Button onClick={() => setConfirming(false)}>{t('public.manage.keep')}</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={() => setConfirming(true)}>{t('public.manage.cancel')}</Button>
                <Link to={`/rdv/${b.slug}`} className="text-sm font-bold text-accent hover:underline">{t('public.manage.otherDate')}</Link>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{t('public.manage.moveNote')}</p>
          </div>
        )}
      </div>
    </PublicShell>
  )
}
