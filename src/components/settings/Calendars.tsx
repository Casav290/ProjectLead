import { useState, type FormEvent } from 'react'
import { Button, Card, ColorDot, Confirm, ErrorNote, Field, Input, Spinner, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtRelative } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import { ColorChoice } from './Profile'
import { CopyField, SettingsHeader } from './kit'
import { useT } from '../../i18n'

type Feed = { id: string; name: string; color: string; last_synced_at: string | null; sync_error: string | null; events: number }
type SyncResult = { ok: true; count: number } | { ok: false; error: string }

/** Les marches à suivre par service : nom, puis clés des textes (traduits au rendu). */
const HELP = [
  { id: 'google', steps: 'settings2.cal.help.google.steps', back: 'settings2.cal.help.google.back' },
  { id: 'outlook', steps: 'settings2.cal.help.outlook.steps', back: 'settings2.cal.help.outlook.back' },
  { id: 'icloud', steps: 'settings2.cal.help.icloud.steps', back: 'settings2.cal.help.icloud.back' },
]

export default function Calendars() {
  const t = useT()
  const { me } = useApp()
  const { data, error, loading, reload } = useLoad<Feed[]>('/calendar/feeds')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState('#57534e')
  const [busy, setBusy] = useState(false)
  const [addErr, setAddErr] = useState<unknown>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Feed | null>(null)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setAddErr(null)
    try {
      const r = await api.post<{ id: string } & SyncResult>('/calendar/feeds', { name: name.trim(), url: url.trim(), color })
      toast(r.ok ? t('settings2.cal.addedToast', { n: r.count }) : t('settings2.cal.addedReadFailed'))
      setName(''); setUrl(''); reload()
    } catch (err) { setAddErr(err) } finally { setBusy(false) }
  }
  const sync = async (f: Feed) => {
    setSyncing(f.id)
    try {
      const r = await api.post<SyncResult>(`/calendar/feeds/${f.id}/sync`)
      toast(r.ok ? t('settings2.cal.syncedToast', { n: r.count }) : t('settings2.cal.readFailed'))
      reload()
    } catch (err) { toast(errorText(err)) } finally { setSyncing(null) }
  }
  const remove = async (f: Feed) => {
    try { await api.del(`/calendar/feeds/${f.id}`); toast(t('settings2.cal.removedToast')); reload() } catch (err) { toast(errorText(err)) }
  }

  return (
    <>
      <SettingsHeader title={t('settings2.cal.title')}>{t('settings2.cal.intro')}</SettingsHeader>
      <div className="max-w-3xl space-y-5">
        {me && (
          <Card title={t('settings2.cal.feedTitle')}>
            <div className="space-y-2 p-4 text-sm">
              <p className="text-muted-foreground">{t('settings2.cal.feedText')}</p>
              <CopyField value={me.icalUrl} label={t('settings2.cal.feedLabel')} />
            </div>
          </Card>
        )}

        <Card title={t('settings2.cal.externalTitle')}>
          <div className="px-4 pt-3 text-sm text-muted-foreground">{t('settings2.cal.externalText')}</div>
          {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} /></div> : (
            data!.length === 0 ? <p className="px-4 py-4 text-sm">{t('settings2.cal.externalEmpty')}</p> : (
              <ul className="mt-3 divide-y divide-border border-t border-border">
                {data!.map((f) => (
                  <li key={f.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ColorDot color={f.color} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold break-words">{f.name}</span>
                        <span className="block text-xs text-muted-foreground">{t('settings2.cal.events', { n: f.events })} ·{' '}
                          {f.last_synced_at ? t('settings2.cal.syncedAgo', { when: fmtRelative(f.last_synced_at) }) : t('settings2.cal.notSynced')}</span>
                      </span>
                      <Button size="sm" onClick={() => sync(f)} disabled={syncing === f.id}>{syncing === f.id ? t('settings2.cal.reading') : t('settings2.cal.resync')}</Button>
                      <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(f)}>{t('settings2.cal.remove')}</Button>
                    </div>
                    {f.sync_error && <p className="border-l-[3px] border-late bg-late/5 px-3 py-1.5 text-xs text-late">
                      {t('settings2.cal.syncError', { error: f.sync_error })}</p>}
                  </li>
                ))}
              </ul>
            )
          )}
          <form onSubmit={add} className="space-y-3 border-t border-border p-4">
            <p className="text-sm font-bold">{t('settings2.cal.addTitle')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('settings2.shared.name')}><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder={t('settings2.cal.namePlaceholder')} /></Field>
              <Field label={t('settings2.cal.urlLabel')} className="sm:col-span-2">
                {/* i18n-ok */}
                <Input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
              </Field>
            </div>
            <Field label={t('settings2.cal.color')}><ColorChoice value={color} onChange={setColor} /></Field>
            <ErrorNote error={addErr} />
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || !url.trim()}>{busy ? t('settings2.cal.readingCalendar') : t('common.add')}</Button>
          </form>
        </Card>

        <Card title={t('settings2.cal.whereTitle')}>
          <ul className="divide-y divide-border">
            {HELP.map((h) => (
              <li key={h.id} className="space-y-1 px-4 py-3 text-sm">
                <p className="font-bold">{t(`settings2.cal.help.${h.id}.name`)}</p>
                <p>{t(h.steps)}</p>
                <p className="text-xs text-muted-foreground">{t(h.back)}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} title={t('settings2.cal.removeTitle')} danger confirmLabel={t('settings2.cal.remove')}
        onConfirm={() => removing && remove(removing)}>{t('settings2.cal.removeText')}</Confirm>
    </>
  )
}
