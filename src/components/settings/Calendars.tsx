import { useState, type FormEvent } from 'react'
import { Button, Card, ColorDot, Confirm, ErrorNote, Field, Input, Spinner, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtRelative } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import { ColorChoice } from './Profile'
import { CopyField, SettingsHeader } from './kit'

type Feed = { id: string; name: string; color: string; last_synced_at: string | null; sync_error: string | null; events: number }
type SyncResult = { ok: true; count: number } | { ok: false; error: string }

const HELP = [
  { name: 'Google Agenda', steps: 'Dans Google Agenda, ouvrez les paramètres de l\'agenda, section « Intégrer l\'agenda », et copiez l\'« Adresse secrète au format iCal ».',
    back: 'Pour voir ProjectLead dans Google : « Autres agendas » → + → « À partir de l\'URL », collez votre lien iCal.' },
  { name: 'Outlook / Microsoft 365', steps: 'Dans Outlook sur le web : Paramètres → Calendrier → Calendriers partagés → « Publier un calendrier », choisissez « Peut afficher tous les détails » et copiez le lien ICS.',
    back: 'Pour voir ProjectLead dans Outlook : « Ajouter un calendrier » → « S\'abonner à partir du web ».' },
  { name: 'iCloud (Apple)', steps: 'Dans Calendrier sur iCloud.com, partagez l\'agenda en « Calendrier public » et copiez le lien (webcal://…).',
    back: 'Pour voir ProjectLead sur Mac ou iPhone : Fichier → « Nouvel abonnement à un calendrier », collez votre lien iCal.' },
]

export default function Calendars() {
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
      toast(r.ok ? `Agenda ajouté : ${r.count} événement${r.count > 1 ? 's' : ''}` : 'Agenda ajouté, mais sa lecture a échoué')
      setName(''); setUrl(''); reload()
    } catch (err) { setAddErr(err) } finally { setBusy(false) }
  }
  const sync = async (f: Feed) => {
    setSyncing(f.id)
    try {
      const r = await api.post<SyncResult>(`/calendar/feeds/${f.id}/sync`)
      toast(r.ok ? `${r.count} événement${r.count > 1 ? 's' : ''} relu${r.count > 1 ? 's' : ''}` : 'La lecture a échoué')
      reload()
    } catch (err) { toast(errorText(err)) } finally { setSyncing(null) }
  }
  const remove = async (f: Feed) => {
    try { await api.del(`/calendar/feeds/${f.id}`); toast('Agenda retiré'); reload() } catch (err) { toast(errorText(err)) }
  }

  return (
    <>
      <SettingsHeader title="Agendas">Voyez ProjectLead dans votre agenda habituel, et vos autres agendas dans ProjectLead.</SettingsHeader>
      <div className="max-w-3xl space-y-5">
        {me && (
          <Card title="ProjectLead dans votre agenda">
            <div className="space-y-2 p-4 text-sm">
              <p className="text-muted-foreground">Vos réunions, rendez-vous et échéances de tâches, mis à jour automatiquement. Ce lien est personnel.</p>
              <CopyField value={me.icalUrl} label="Lien iCal personnel" />
            </div>
          </Card>
        )}

        <Card title="Agendas extérieurs">
          <div className="px-4 pt-3 text-sm text-muted-foreground">Leurs événements s'affichent dans l'Agenda (en lecture) et comptent comme occupés pour la prise de rendez-vous.</div>
          {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} /></div> : (
            data!.length === 0 ? <p className="px-4 py-4 text-sm">Aucun agenda extérieur pour l'instant.</p> : (
              <ul className="mt-3 divide-y divide-border border-t border-border">
                {data!.map((f) => (
                  <li key={f.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ColorDot color={f.color} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold break-words">{f.name}</span>
                        <span className="block text-xs text-muted-foreground">{f.events} événement{f.events > 1 ? 's' : ''} ·{' '}
                          {f.last_synced_at ? `relu ${fmtRelative(f.last_synced_at)}` : 'pas encore relu'}</span>
                      </span>
                      <Button size="sm" onClick={() => sync(f)} disabled={syncing === f.id}>{syncing === f.id ? 'Lecture…' : 'Resynchroniser'}</Button>
                      <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(f)}>Retirer</Button>
                    </div>
                    {f.sync_error && <p className="border-l-[3px] border-late bg-late/5 px-3 py-1.5 text-xs text-late">
                      Lecture impossible ({f.sync_error}). Vérifiez que le lien est toujours valable et public.</p>}
                  </li>
                ))}
              </ul>
            )
          )}
          <form onSubmit={add} className="space-y-3 border-t border-border p-4">
            <p className="text-sm font-bold">Ajouter un agenda</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nom"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="Agenda perso" /></Field>
              <Field label="Lien iCal (https:// ou webcal://)" className="sm:col-span-2">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
              </Field>
            </div>
            <Field label="Couleur"><ColorChoice value={color} onChange={setColor} /></Field>
            <ErrorNote error={addErr} />
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || !url.trim()}>{busy ? 'Lecture de l\'agenda…' : 'Ajouter'}</Button>
          </form>
        </Card>

        <Card title="Où trouver le lien">
          <ul className="divide-y divide-border">
            {HELP.map((h) => (
              <li key={h.name} className="space-y-1 px-4 py-3 text-sm">
                <p className="font-bold">{h.name}</p>
                <p>{h.steps}</p>
                <p className="text-xs text-muted-foreground">{h.back}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} title="Retirer cet agenda ?" danger confirmLabel="Retirer"
        onConfirm={() => removing && remove(removing)}>Ses événements disparaissent de l'Agenda de ProjectLead ; l'agenda d'origine n'est pas touché.</Confirm>
    </>
  )
}
