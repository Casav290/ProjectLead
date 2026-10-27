import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, Confirm, ErrorNote, Field, Input, Spinner, TableStack, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtDate, fmtRelative } from '../../lib/format'
import { useLoad } from '../../lib/store'
import { CopyField, Note, ReadOnlyNote, SettingsHeader, origin, useRole } from './kit'
import { useT } from '../../i18n'

type ApiKey = { id: string; name: string; prefix: string; last_used_at: string | null; revoked_at: string | null; created_at: string; user_name: string }

/** Méthode, chemin, clé de la description (traduite au rendu). */
const ENDPOINTS: [string, string, string][] = [
  ['GET', '/api/v1/projects', 'settings2.api.ep.listProjects'],
  ['GET', '/api/v1/projects/:id', 'settings2.api.ep.getProject'],
  ['POST', '/api/v1/projects', 'settings2.api.ep.createProject'],
  ['GET', '/api/v1/tasks?project=:id', 'settings2.api.ep.listTasks'],
  ['POST', '/api/v1/tasks', 'settings2.api.ep.createTask'],
  ['POST', '/api/v1/time', 'settings2.api.ep.logTime'],
]

export default function ApiKeys() {
  const t = useT()
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
    try { await api.del(`/api-keys/${k.id}`); toast(t('settings2.api.revokedToast')); reload() } catch (err) { toast(errorText(err)) }
  }
  const sample = `curl ${origin()}/api/v1/projects \\\n  -H "Authorization: Bearer ${fresh ?? t('settings2.api.sampleKey')}"`

  return (
    <>
      <SettingsHeader title={t('settings2.api.title')}>{t('settings2.api.intro')}</SettingsHeader>
      <div className="max-w-3xl space-y-5">
        {!canManage && <ReadOnlyNote />}
        {canManage && (
          <Card title={t('settings2.api.newKey')}>
            <div className="space-y-3 p-4">
              {fresh ? (
                <>
                  <Note tone="warn"><strong>{t('settings2.api.copyNow')}</strong> {t('settings2.api.neverShown')}</Note>
                  <CopyField value={fresh} label={t('settings2.api.newKeyLabel')} />
                  <Button onClick={() => setFresh(null)}>{t('settings2.api.copied')}</Button>
                </>
              ) : (
                <form onSubmit={create} className="flex flex-wrap items-end gap-2">
                  <Field label={t('settings2.api.keyName')} className="min-w-0 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder={t('settings2.api.keyNamePlaceholder')} /></Field>
                  <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{t('settings2.api.createKey')}</Button>
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
                  <th className="px-3 py-2">{t('settings2.api.colKey')}</th>
                  <th className="px-3 py-2">{t('settings2.api.colCreatedBy')}</th>
                  <th className="px-3 py-2">{t('settings2.api.colLastUsed')}</th>
                  {canManage && <th className="px-3 py-2"><span className="sr-only">{t('settings2.api.colActions')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {data!.map((k) => (
                  <tr key={k.id} className={k.revoked_at ? 'text-muted-foreground' : ''}>
                    <td className="px-3 py-2" data-label="">
                      <span className="font-bold">{k.name}</span> <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>
                      {k.revoked_at && <> <Badge>{t('settings2.api.revoked')}</Badge></>}
                    </td>
                    <td className="px-3 py-2">{t('settings2.api.createdOn', { name: k.user_name, date: fmtDate(k.created_at) })}</td>
                    <td className="px-3 py-2">{k.last_used_at ? fmtRelative(k.last_used_at) : t('settings2.api.never')}</td>
                    {canManage && <td className="px-3 py-2 text-right">
                      {!k.revoked_at && <Button size="sm" variant="ghost" className="text-late" onClick={() => setRevoking(k)}>{t('settings2.api.revoke')}</Button>}
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableStack>
        )}

        <Card title={t('settings2.api.endpoints')}>
          <div className="space-y-4 p-4 text-sm">
            <p>{t('settings2.api.authBefore')} <code className="font-mono text-xs">Authorization: Bearer pl_…</code>{t('settings2.api.authAfter')}{' '}{/* i18n-ok */}
              <code className="font-mono text-xs">data</code>.</p>{/* i18n-ok */}
            <ul className="divide-y divide-border border border-border">
              {ENDPOINTS.map(([m, path, what]) => (
                <li key={m + path} className="px-3 py-2">
                  <p className="font-mono text-xs break-words"><span className={m === 'GET' ? 'font-bold text-accent-dark' : 'font-bold text-won'}>{m}</span> {path}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(what)}</p>
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-1.5 text-xs font-bold text-muted-foreground">{t('settings2.api.example')}</p>
              <pre className="overflow-x-auto bg-marine-deep px-3 py-2.5 font-mono text-xs text-white">{sample}</pre>
            </div>
          </div>
        </Card>
      </div>
      <Confirm open={Boolean(revoking)} onClose={() => setRevoking(null)} title={t('settings2.api.revokeTitle')} danger confirmLabel={t('settings2.api.revoke')}
        onConfirm={() => revoking && revoke(revoking)}>
        {t('settings2.api.revokeText', { name: revoking?.name ?? '' })}
      </Confirm>
    </>
  )
}
