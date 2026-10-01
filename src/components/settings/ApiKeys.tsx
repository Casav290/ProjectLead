import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, Confirm, ErrorNote, Field, Input, Spinner, TableStack, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtDate, fmtRelative } from '../../lib/format'
import { useLoad } from '../../lib/store'
import { CopyField, Note, ReadOnlyNote, SettingsHeader, origin, useRole } from './kit'

type ApiKey = { id: string; name: string; prefix: string; last_used_at: string | null; revoked_at: string | null; created_at: string; user_name: string }

const ENDPOINTS: [string, string, string][] = [
  ['GET', '/api/v1/projects', 'Les projets en cours (500 au plus).'],
  ['GET', '/api/v1/projects/:id', 'Un projet et ses étapes.'],
  ['POST', '/api/v1/projects', 'Ouvrir un projet : name, description, client_id, template_id, start_date, due_date ; external_id évite les doublons.'],
  ['GET', '/api/v1/tasks?project=:id', 'Les tâches, éventuellement d\'un projet.'],
  ['POST', '/api/v1/tasks', 'Créer une tâche : project_id, title, description, due_date, priority.'],
  ['POST', '/api/v1/time', 'Saisir du temps : project_id, task_id, entry_date, minutes, note, billable.'],
]

export default function ApiKeys() {
  const { canManage } = useRole()
  const { data, error, loading, reload } = useLoad<ApiKey[]>('/api-keys')
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createErr, setCreateErr] = useState<unknown>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setCreateErr(null)
    try { const r = await api.post<{ key: string }>('/api-keys', { name: name.trim() }); setFresh(r.key); setName(''); reload() }
    catch (err) { setCreateErr(err) } finally { setBusy(false) }
  }
  const revoke = async (k: ApiKey) => {
    try { await api.del(`/api-keys/${k.id}`); toast('Clé révoquée'); reload() } catch (err) { toast(errorText(err)) }
  }
  const sample = `curl ${origin()}/api/v1/projects \\\n  -H "Authorization: Bearer ${fresh ?? 'pl_votre_cle'}"`

  return (
    <>
      <SettingsHeader title="API">Reliez ProjectLead à vos autres outils (Make, n8n, Zapier, un script). Une clé agit au nom de la personne qui l'a créée.</SettingsHeader>
      <div className="max-w-3xl space-y-5">
        {!canManage && <ReadOnlyNote />}
        {canManage && (
          <Card title="Nouvelle clé">
            <div className="space-y-3 p-4">
              {fresh ? (
                <>
                  <Note tone="warn"><strong>Copiez cette clé maintenant :</strong> elle ne sera plus jamais affichée.</Note>
                  <CopyField value={fresh} label="Nouvelle clé d'API" />
                  <Button onClick={() => setFresh(null)}>J'ai copié la clé</Button>
                </>
              ) : (
                <form onSubmit={create} className="flex flex-wrap items-end gap-2">
                  <Field label="Nom de la clé" className="min-w-0 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="Make — devis" /></Field>
                  <Button type="submit" variant="primary" disabled={busy || !name.trim()}>Créer la clé</Button>
                </form>
              )}
              <ErrorNote error={createErr} />
            </div>
          </Card>
        )}

        {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : data!.length > 0 && (
          <TableStack>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-3 py-2">Clé</th>
                  <th className="px-3 py-2">Créée par</th>
                  <th className="px-3 py-2">Dernier usage</th>
                  {canManage && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {data!.map((k) => (
                  <tr key={k.id} className={k.revoked_at ? 'text-muted-foreground' : ''}>
                    <td className="px-3 py-2" data-label="">
                      <span className="font-bold">{k.name}</span> <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>
                      {k.revoked_at && <> <Badge>Révoquée</Badge></>}
                    </td>
                    <td className="px-3 py-2">{k.user_name}, le {fmtDate(k.created_at)}</td>
                    <td className="px-3 py-2">{k.last_used_at ? fmtRelative(k.last_used_at) : 'Jamais'}</td>
                    {canManage && <td className="px-3 py-2 text-right">
                      {!k.revoked_at && <Button size="sm" variant="ghost" className="text-late" onClick={() => setRevoking(k)}>Révoquer</Button>}
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableStack>
        )}

        <Card title="Points d'accès">
          <div className="space-y-4 p-4 text-sm">
            <p>Chaque appel porte la clé dans l'en-tête <code className="font-mono text-xs">Authorization: Bearer pl_…</code>. Les réponses sont en JSON,
              sous <code className="font-mono text-xs">data</code>.</p>
            <ul className="divide-y divide-border border border-border">
              {ENDPOINTS.map(([m, path, what]) => (
                <li key={m + path} className="px-3 py-2">
                  <p className="font-mono text-xs break-words"><span className={m === 'GET' ? 'font-bold text-accent-dark' : 'font-bold text-won'}>{m}</span> {path}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{what}</p>
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-1.5 text-xs font-bold text-muted-foreground">Exemple</p>
              <pre className="overflow-x-auto bg-marine-deep px-3 py-2.5 font-mono text-xs text-white">{sample}</pre>
            </div>
          </div>
        </Card>
      </div>
      <Confirm open={Boolean(revoking)} onClose={() => setRevoking(null)} title="Révoquer cette clé ?" danger confirmLabel="Révoquer"
        onConfirm={() => revoking && revoke(revoking)}>
        Les outils qui utilisent « {revoking?.name} » perdront l'accès immédiatement.
      </Confirm>
    </>
  )
}
