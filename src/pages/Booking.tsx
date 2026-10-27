import clsx from 'clsx'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import LanguageSelect from '../components/LanguageSelect'
import { Button, Field, Input, Textarea } from '../components/ui'
import { getLocale, intlLocale, labels, t, useT } from '../i18n'

type Slot = { start: string; label: string }
type Page = { name: string; description: string; duration_minutes: number; location: string; account: string; timezone: string
  slots: { date: string; times: Slot[] }[] }
type Done = { starts_at: string; host: string; manage_url: string }

/** Pages publiques : mise en page autonome, sobre, sans la navigation de l'application. */
export function PublicShell({ account, children, wide }: { account?: string; children: ReactNode; wide?: boolean }) {
  const t = useT()
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className={clsx('mx-auto flex items-center gap-2 px-4 py-3', wide ? 'max-w-4xl' : 'max-w-xl')}>
          <span className="grid h-7 w-7 shrink-0 place-items-center bg-brand text-[11px] font-extrabold text-white">
            {(account ?? 'PL').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
          <span className="truncate text-sm font-extrabold">{account ?? ''}</span>
          <LanguageSelect className="ml-auto shrink-0" />
        </div>
      </header>
      <main className={clsx('mx-auto px-4 py-6 sm:py-10', wide ? 'max-w-4xl' : 'max-w-xl')}>{children}</main>
      <footer className="pb-8 text-center text-xs text-muted-foreground">{t('public.poweredBy')}</footer>
    </div>
  )
}

export const PUBLIC_ERRORS = labels('public.errors', ['not_found', 'slot_taken', 'invalid_input', 'too_many', 'not_cancellable'])

/** Un appel à l'API publique, sans session ; l'erreur porte le code renvoyé. */
export async function publicFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/public${path}`, body === undefined ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `http_${res.status}`)
  return data as T
}
export const publicError = (e: unknown) => PUBLIC_ERRORS[(e as Error)?.message] ?? t('public.errorGeneric')

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const dayFmt = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(), o).format(new Date(s + 'T12:00:00'))

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)

/** Prise de rendez-vous publique, façon Calendly : un jour, une heure, ses coordonnées. */
export default function Booking() {
  const t = useT()
  const { slug = '' } = useParams()
  const [from, setFrom] = useState<string | null>(null)
  const [page, setPage] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [day, setDay] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [firstDay, setFirstDay] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (start: string | null, keepDay = false) => {
    setLoading(true)
    try {
      const p = await publicFetch<Page>(`/booking/${slug}?days=14${start ? `&from=${start}` : ''}`)
      setPage(p); setError(null)
      setFirstDay((f) => f ?? p.slots[0]?.date ?? null)
      if (!keepDay) setDay(p.slots.find((s) => s.times.length)?.date ?? p.slots[0]?.date ?? null)
    } catch (e) { setError(publicError(e)) } finally { setLoading(false) }
  }, [slug])
  useEffect(() => { load(from) }, [load, from])
  useEffect(() => { if (page) document.title = `${page.name} — ${page.account}` }, [page])

  if (error && !page) return <PublicShell><p className="border border-border bg-card p-6 text-center text-sm">{error}</p></PublicShell>
  if (!page) return <PublicShell><p className="p-8 text-center text-sm text-muted-foreground">{t('common.loading')}</p></PublicShell>

  const current = page.slots.find((s) => s.date === day)
  const last = page.slots[page.slots.length - 1]?.date
  const canBack = !!firstDay && !!page.slots[0] && page.slots[0].date > firstDay
  const none = page.slots.every((s) => !s.times.length)

  return (
    <PublicShell account={page.account} wide>
      <div className="grid border border-input bg-card md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-border p-5 md:border-b-0 md:border-r">
          <p className="text-sm font-semibold text-muted-foreground">{page.account}</p>
          <h1 className="mt-1 font-display text-2xl">{page.name}</h1>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-center gap-2"><Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />{t('public.booking.duration', { n: page.duration_minutes })}</li>
            {page.location && <li className="flex items-start gap-2 [overflow-wrap:anywhere]"><Icon d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />{page.location}</li>}
            <li className="flex items-center gap-2 text-muted-foreground"><Icon d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z" />{t('public.booking.timezone', { zone: page.timezone.split('/').pop()?.replace('_', ' ') })}</li>
          </ul>
          {page.description && <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{page.description}</p>}
          {slot && !done && (
            <div className="mt-5 border-l-[3px] border-accent bg-accent-veil px-3 py-2 text-sm">
              <div className="font-bold first-letter:uppercase">{dayFmt(day!, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              <div>{slot.label}</div>
            </div>
          )}
        </aside>

        <section className="min-w-0 p-5">
          {done ? <Confirmed page={page} done={done} />
            : slot ? <Details slug={slug} page={page} slot={slot} onBack={() => setSlot(null)} onDone={setDone}
                       onTaken={() => { setSlot(null); setNotice(PUBLIC_ERRORS.slot_taken); load(from, true) }} />
            : (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-bold">{t('public.booking.pickDay')}</h2>
                  <div className="flex">
                    <Button size="sm" aria-label={t('public.booking.prevDays')} disabled={!canBack || loading}
                      onClick={() => setFrom(plus(page.slots[0].date, -14) < firstDay! ? firstDay : plus(page.slots[0].date, -14))}>←</Button>
                    <Button size="sm" className="-ml-px" aria-label={t('public.booking.nextDays')} disabled={loading || !last} onClick={() => setFrom(plus(last!, 1))}>→</Button>
                  </div>
                </div>
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" role="listbox" aria-label={t('public.booking.days')}>
                  {page.slots.map((s) => {
                    const free = s.times.length > 0
                    return (
                      <button key={s.date} type="button" role="option" aria-selected={s.date === day} disabled={!free} onClick={() => setDay(s.date)}
                        className={clsx('flex w-[58px] shrink-0 flex-col items-center border px-1 py-2 text-center',
                          s.date === day ? 'border-accent bg-accent text-white' : free ? 'border-input bg-card hover:border-accent' : 'border-border bg-head text-muted-foreground opacity-60')}>
                        <span className="text-[10.5px] font-bold uppercase">{dayFmt(s.date, { weekday: 'short' }).replace('.', '')}</span>
                        <span className="font-display text-lg font-extrabold leading-tight">{+s.date.slice(8)}</span>
                        <span className="text-[10.5px]">{dayFmt(s.date, { month: 'short' }).replace('.', '')}</span>
                      </button>
                    )
                  })}
                </div>
                {(notice || error) && <p role="alert" className="mt-2 border-l-[3px] border-late bg-late/5 px-3 py-2 text-sm text-late">{notice || error}</p>}
                <h2 className="mb-3 mt-5 font-bold first-letter:uppercase">
                  {current ? dayFmt(current.date, { weekday: 'long', day: 'numeric', month: 'long' }) : t('public.booking.time')}
                </h2>
                {loading ? <p className="text-sm text-muted-foreground">{t('public.booking.loadingSlots')}</p>
                  : none ? <p className="text-sm text-muted-foreground">{t('public.booking.noSlots')}</p>
                  : !current?.times.length ? <p className="text-sm text-muted-foreground">{t('public.booking.noSlotsDay')}</p>
                  : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {current.times.map((t) => (
                        <button key={t.start} type="button" onClick={() => { setSlot(t); setNotice(null) }}
                          className="border border-accent/50 bg-card py-2.5 text-sm font-bold tabular-nums text-accent hover:bg-accent hover:text-white">{t.label}</button>
                      ))}
                    </div>
                  )}
              </>
            )}
        </section>
      </div>
    </PublicShell>
  )
}

function Details({ slug, page, slot, onBack, onDone, onTaken }:
  { slug: string; page: Page; slot: Slot; onBack: () => void; onDone: (d: Done) => void; onTaken: () => void }) {
  const t = useT()
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', message: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await publicFetch<Done>(`/booking/${slug}`, {
        starts_at: slot.start, name: f.name.trim(), email: f.email.trim(), message: f.message, locale: getLocale(),
        ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.company.trim() ? { company: f.company.trim() } : {}),
      })
      onDone(r)
    } catch (err) {
      if ((err as Error).message === 'slot_taken') { onTaken(); return }
      setError(publicError(err)); setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <button type="button" onClick={onBack} className="text-xs font-bold text-muted-foreground hover:text-foreground">← {t('public.booking.changeTime')}</button>
      <h2 className="font-bold">{t('public.booking.yourDetails')}</h2>
      <p className="text-sm text-muted-foreground">
        {page.name}, <span className="first-letter:uppercase">{new Intl.DateTimeFormat(intlLocale(), { timeZone: page.timezone, dateStyle: 'full' }).format(new Date(slot.start))}</span>{' '}{t('public.booking.atTime', { time: slot.label })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('public.field.fullName')}><Input required autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label={t('public.field.email')}><Input required type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label={t('public.field.phoneOptional')}><Input type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label={t('public.field.companyOptional')}><Input autoComplete="organization" value={f.company} onChange={set('company')} /></Field>
      </div>
      <Field label={t('public.booking.messageOptional')}><Textarea rows={4} value={f.message} onChange={set('message')} placeholder={t('public.booking.messagePlaceholder')} /></Field>
      {error && <p role="alert" className="text-sm text-late">{error}</p>}
      <Button type="submit" variant="primary" className="w-full py-3 sm:w-auto" disabled={busy}>{busy ? t('public.booking.booking') : t('public.booking.confirm')}</Button>
      <p className="text-xs text-muted-foreground">{t('public.booking.confirmNote')}</p>
    </form>
  )
}

function Confirmed({ page, done }: { page: Page; done: Done }) {
  const t = useT()
  const when = new Intl.DateTimeFormat(intlLocale(), { timeZone: page.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(done.starts_at))
  return (
    <div className="py-4 text-center sm:py-8">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center bg-won text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12l5 5 9-10" /></svg>
      </div>
      <h2 className="font-display text-2xl">{t('public.booking.confirmed')}</h2>
      <p className="mt-2 text-sm"><span className="font-bold first-letter:uppercase">{when}</span><br />{t('public.booking.withHost', { host: done.host, account: page.account })}</p>
      {page.location && <p className="mt-1 text-sm text-muted-foreground">{page.location}</p>}
      <p className="mt-4 text-sm text-muted-foreground">{t('public.booking.confirmedNote')}</p>
      <a href={done.manage_url.replace(/^https?:\/\/[^/]+/, '')} className="mt-4 inline-block text-sm font-bold text-accent hover:underline">{t('public.booking.manage')}</a>
    </div>
  )
}
