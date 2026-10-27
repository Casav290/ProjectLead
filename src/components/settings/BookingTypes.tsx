import { useEffect, useState, type FormEvent } from 'react'
import { AvatarStack, Badge, Button, Card, Checkbox, Confirm, Empty, ErrorNote, Field, Input, Modal, PeoplePicker, Spinner, Textarea, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtMinutes } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import { CopyField, ReadOnlyNote, SettingsHeader, slugify, SLUG_RE, origin, useRole } from './kit'
import { intlLocale, t, useT } from '../../i18n'

type Range = [string, string]
type Availability = Partial<Record<'1' | '2' | '3' | '4' | '5' | '6' | '7', Range[]>>
type BookingType = { id: string; slug: string; name: string; description: string; duration_minutes: number; buffer_minutes: number
  min_notice_hours: number; max_days_ahead: number; location: string; availability: Availability; host_ids: string[]
  create_project: boolean; project_id: string | null; active: boolean; upcoming: number; url: string }

const DAYS: (keyof Availability)[] = ['1', '2', '3', '4', '5', '6', '7']
/** Le nom du jour (1 = lundi) dans la langue en cours, par Intl : le 1er janvier 2024 est un lundi. */
const dayName = (d: keyof Availability, weekday: 'long' | 'short') => {
  const n = new Intl.DateTimeFormat(intlLocale(), { weekday, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, Number(d))))
  return n.charAt(0).toUpperCase() + n.slice(1)
}
const WEEKDAYS: Availability = Object.fromEntries(DAYS.slice(0, 5).map((d) => [d, [['09:00', '12:00'], ['13:30', '17:00']]]))
const publicLink = (t: Pick<BookingType, 'slug' | 'url'>) => (t.url?.startsWith('http') ? t.url : `${origin()}/rdv/${t.slug}`)

/** « Lun–Ven 09:00–12:00, 13:30–17:00 », pour la liste. */
function summary(a: Availability) {
  const open = DAYS.filter((d) => a[d]?.length)
  if (!open.length) return t('settings2.booking.noAvailability')
  return open.map((d) => `${dayName(d, 'short')} ${a[d]!.map(([s, e]) => `${s}–${e}`).join(', ')}`).join(' · ')
}

export default function BookingTypes() {
  const t = useT()
  const { team } = useApp()
  const { canManage } = useRole()
  const { data, error, loading, reload } = useLoad<BookingType[]>('/booking')
  const [editing, setEditing] = useState<BookingType | 'new' | null>(null)

  const toggle = async (bt: BookingType) => {
    try { await api.patch(`/booking/${bt.id}`, { active: !bt.active }); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title={t('settings2.booking.title')} action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>{t('settings2.booking.new')}</Button>}>
        {t('settings2.booking.intro')}
      </SettingsHeader>
      {!canManage && <ReadOnlyNote />}
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : data!.length === 0 ? (
        <Empty title={t('settings2.booking.emptyTitle')} action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>{t('settings2.shared.createFirst')}</Button>}>
          {t('settings2.booking.emptyText')}
        </Empty>
      ) : (
        <ul className="max-w-3xl space-y-3">
          {data!.map((bt) => (
            <li key={bt.id}>
              <Card>
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-bold">
                        <span className="break-words">{bt.name}</span>
                        {bt.active ? <Badge tone="ok">{t('settings2.shared.active')}</Badge> : <Badge>{t('settings2.shared.disabled')}</Badge>}
                        {bt.create_project && <Badge tone="info">{t('settings2.booking.opensProject')}</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtMinutes(bt.duration_minutes)}{bt.location && ` · ${bt.location}`} · {t('settings2.booking.upcoming', { n: bt.upcoming })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{summary(bt.availability ?? {})}</p>
                    </div>
                    <AvatarStack people={team.filter((m) => bt.host_ids.includes(m.id))} />
                    {canManage && <>
                      <Button size="sm" variant="ghost" onClick={() => toggle(bt)}>{bt.active ? t('settings2.shared.disable') : t('settings2.shared.enable')}</Button>
                      <Button size="sm" onClick={() => setEditing(bt)}>{t('common.edit')}</Button>
                    </>}
                  </div>
                  <CopyField value={publicLink(bt)} label={t('settings2.shared.publicLinkOf', { name: bt.name })} open />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <TypeDialog type={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}

type Draft = Omit<BookingType, 'id' | 'upcoming' | 'url'>
const blank = (hostId?: string): Draft => ({
  slug: '', name: '', description: '', duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 12, max_days_ahead: 30, location: '',
  availability: WEEKDAYS, host_ids: hostId ? [hostId] : [], create_project: false, project_id: null, active: true,
})

function TypeDialog({ type, onClose, onSaved }: { type: BookingType | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const { me, team } = useApp()
  const [d, setD] = useState<Draft>(blank())
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!type) return
    if (type === 'new') { setD(blank(me?.user.id)); setSlugTouched(false) }
    else { const { id: _i, upcoming: _u, url: _l, ...rest } = type; setD({ ...rest, availability: rest.availability ?? {} }); setSlugTouched(true) }
    setError(null)
  }, [type, me?.user.id])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setName = (name: string) => setD((x) => ({ ...x, name, slug: slugTouched ? x.slug : slugify(name) }))
  const num = (k: 'duration_minutes' | 'buffer_minutes' | 'min_notice_hours' | 'max_days_ahead') => ({
    inputMode: 'numeric' as const, value: String(d[k]), onChange: (e: { target: { value: string } }) => set(k, Number(e.target.value.replace(/\D/g, '')) || 0),
  })

  const ranges = (day: keyof Availability) => d.availability[day] ?? []
  const setRanges = (day: keyof Availability, r: Range[]) => set('availability', { ...d.availability, [day]: r })
  const badRange = Object.values(d.availability).some((rs) => rs?.some(([s, e]) => !s || !e || s >= e))
  const valid = d.name.trim() && SLUG_RE.test(d.slug) && !badRange && d.duration_minutes >= 5 && d.max_days_ahead >= 1

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const availability = Object.fromEntries(Object.entries(d.availability).filter(([, r]) => r?.length))
    const body = { ...d, name: d.name.trim(), availability }
    try {
      if (type === 'new') await api.post('/booking', body)
      else if (type) await api.patch(`/booking/${type.id}`, body)
      toast(t('settings2.booking.savedToast')); onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!type || type === 'new') return
    try { await api.del(`/booking/${type.id}`); toast(t('settings2.booking.deletedToast')); onSaved(); onClose() } catch (err) { setError(err) }
  }

  return (
    <Modal open={Boolean(type)} onClose={onClose} wide title={type === 'new' ? t('settings2.booking.new') : t('settings2.booking.editTitle')}
      footer={<>
        {type && type !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>{t('common.delete')}</Button>}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="booking-form" disabled={busy || !valid}>{t('common.save')}</Button>
      </>}>
      <form id="booking-form" onSubmit={save} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings2.shared.name')}><Input value={d.name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder={t('settings2.booking.namePlaceholder')} /></Field>
          <Field label={t('settings2.shared.pageAddress')} hint={`${origin()}/rdv/${d.slug || '…'}`}
            error={d.slug && !SLUG_RE.test(d.slug) ? t('settings2.shared.slugError') : null}>
            <Input value={d.slug} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()) }} required maxLength={61} />
          </Field>
          <Field label={t('settings2.booking.description')} className="sm:col-span-2" hint={t('settings2.booking.descriptionHint')}>
            <Textarea rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} />
          </Field>
          <Field label={t('settings2.booking.location')} className="sm:col-span-2" hint={t('settings2.booking.locationHint')}>
            <Input value={d.location} onChange={(e) => set('location', e.target.value)} maxLength={300} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t('settings2.booking.duration')}><Input {...num('duration_minutes')} /></Field>
          <Field label={t('settings2.booking.buffer')} hint={t('settings2.booking.bufferHint')}><Input {...num('buffer_minutes')} /></Field>
          <Field label={t('settings2.booking.notice')} hint={t('settings2.booking.noticeHint')}><Input {...num('min_notice_hours')} /></Field>
          <Field label={t('settings2.booking.horizon')} hint={t('settings2.booking.horizonHint')}><Input {...num('max_days_ahead')} /></Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">{t('settings2.booking.availability', { tz: me?.account.timezone ?? '' })}</legend>
          <ul className="divide-y divide-border border border-border">
            {DAYS.map((day) => { const label = dayName(day, 'long'); return (
              <li key={day} className="flex flex-col gap-x-3 gap-y-1.5 px-3 py-2 sm:flex-row sm:items-center">
                <span className="shrink-0 text-sm font-semibold sm:w-20">{label}</span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {ranges(day).length === 0 && <span className="text-sm text-muted-foreground">{t('settings2.booking.closed')}</span>}
                  {ranges(day).map(([s, e], i) => (
                    <span key={i} className={`inline-flex max-w-full items-center gap-1 border px-1 py-0.5 ${s && e && s < e ? 'border-input' : 'border-late'}`}>
                      <input type="time" value={s} aria-label={t('settings2.booking.rangeStart', { day: label, n: i + 1 })} className="min-w-0 bg-transparent text-sm"
                        onChange={(ev) => setRanges(day, ranges(day).map((r, j) => (j === i ? [ev.target.value, r[1]] : r)))} />
                      <span className="text-muted-foreground">–</span>
                      <input type="time" value={e} aria-label={t('settings2.booking.rangeEnd', { day: label, n: i + 1 })} className="min-w-0 bg-transparent text-sm"
                        onChange={(ev) => setRanges(day, ranges(day).map((r, j) => (j === i ? [r[0], ev.target.value] : r)))} />
                      <button type="button" aria-label={t('settings2.booking.removeRange')} className="px-1 text-muted-foreground hover:text-late"
                        onClick={() => setRanges(day, ranges(day).filter((_, j) => j !== i))}>×</button>
                    </span>
                  ))}
                  {ranges(day).length < 6 && (
                    <button type="button" className="text-xs font-bold text-accent hover:text-accent-dark"
                      onClick={() => { const last = ranges(day).at(-1); setRanges(day, [...ranges(day), last ? [last[1], last[1] < '17:00' ? '18:00' : '20:00'] : ['09:00', '12:00']]) }}>
                      {t('settings2.booking.addRange')}</button>
                  )}
                </div>
              </li>
            ) })}
          </ul>
          {badRange && <p className="text-xs text-late">{t('settings2.booking.badRange')}</p>}
        </fieldset>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">{t('settings2.booking.hosts')}</span>
          <PeoplePicker people={team.filter((m) => m.active)} value={d.host_ids} onChange={(v) => set('host_ids', v)} placeholder={t('settings2.booking.addHost')} />
          <span className="block text-xs text-muted-foreground">{t('settings2.booking.hostsHint')}</span>
        </div>

        <div className="space-y-2">
          <Checkbox label={t('settings2.booking.createProject')} checked={d.create_project} onChange={(v) => set('create_project', v)} />
          <Checkbox label={t('settings2.booking.activeLabel')} checked={d.active} onChange={(v) => set('active', v)} />
        </div>
        <ErrorNote error={error} />
      </form>
      <Confirm open={removing} onClose={() => setRemoving(false)} title={t('settings2.booking.deleteTitle')} danger confirmLabel={t('common.delete')} onConfirm={remove}>
        {t('settings2.booking.deleteText')}
      </Confirm>
    </Modal>
  )
}
