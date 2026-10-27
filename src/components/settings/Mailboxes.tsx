import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Confirm, ErrorNote, Field, Input, Spinner, toast } from '../ui'
import { api, ApiError, errorText } from '../../lib/api'
import { fmtRelative } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import { CopyField, Note, SettingsHeader } from './kit'
import { t as tr, useT } from '../../i18n'

type Mailbox = { id: string; provider: 'google' | 'microsoft' | 'imap'; email: string; display_name: string | null; is_default: boolean
  shared: boolean; last_synced_at: string | null; sync_error: string | null; user_id: string; user_name: string; mine: boolean; messages: number }
type MailboxList = { configured: boolean; oauth: { google: boolean; microsoft: boolean }; mailboxes: Mailbox[] }
type Servers = { imapHost: string; imapPort: number; imapSecure: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean
  imapUser: 'address' | 'local'; smtpUser: 'address' | 'local' }
type Detected = { key: string; name?: string; oauth: 'google' | 'microsoft' | null; appPassword: boolean; servers: Servers | null }

const PROVIDER: Record<Mailbox['provider'], string> = { google: 'Gmail', microsoft: 'Microsoft 365', imap: 'IMAP' }
// Appelé au rendu : le texte suit la langue en cours.
const syncError = (code: string) => code === 'reconnect_required' || code === 'invalid_grant' ? tr('settings.mail.reconnect') : errorText(code)
const errorCode = (e: unknown) => e instanceof ApiError ? e.code : String((e as Error)?.message ?? e)

// Texte : `settings.mail.return.<clé>`, lu au rendu.
const RETURN: Record<string, { tone: 'ok' | 'late' | 'warn'; key: string }> = {
  ok: { tone: 'ok', key: 'ok' },
  erreur: { tone: 'late', key: 'error' },
  indisponible: { tone: 'warn', key: 'unavailable' },
}

export default function Mailboxes() {
  const t = useT()
  const { me } = useApp()
  const [params, setParams] = useSearchParams()
  const back = RETURN[params.get('boite') ?? '']
  const { data, error, loading, reload } = useLoad<MailboxList>('/mail/mailboxes')
  const [removing, setRemoving] = useState<Mailbox | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)

  const patch = async (m: Mailbox, body: Partial<Pick<Mailbox, 'is_default' | 'shared'>>) => {
    try { await api.patch(`/mail/mailboxes/${m.id}`, body); reload() } catch (e) { toast(errorText(e)) }
  }
  const sync = async (m: Mailbox) => {
    setSyncing(m.id)
    try {
      const r = await api.post<{ imported: number; error: string | null }>(`/mail/mailboxes/${m.id}/sync`)
      toast(r.error ? syncError(r.error) : r.imported ? t('settings.mail.imported', { n: r.imported }) : t('settings.mail.nothingNew'))
      reload()
    } catch (e) { toast(errorText(e)) } finally { setSyncing(null) }
  }
  const remove = async (m: Mailbox) => {
    try { await api.del(`/mail/mailboxes/${m.id}`); toast(t('settings.mail.removed')); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title={t('settings.mail.title')}>
        {t('settings.mail.introBefore')}<Link to="/emails" className="font-semibold text-accent">{t('settings.mail.title')}</Link>{t('settings.mail.introAfter')}
      </SettingsHeader>

      <div className="max-w-3xl space-y-5">
        {back && (
          <Note tone={back.tone}>
            <span className="flex flex-wrap items-center justify-between gap-2">{t(`settings.mail.return.${back.key}`)}
              <button className="text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => { params.delete('boite'); setParams(params, { replace: true }) }}>{t('settings.mail.hide')}</button>
            </span>
          </Note>
        )}

        {loading && !data ? <Spinner /> : !data ? <ErrorNote error={error} /> : (
          <>
            {!data.configured && (
              <Note tone="warn">
                <p className="font-bold">{t('settings.mail.notConfigured')}</p>
                {/* i18n-ok */}<p className="mt-1 text-muted-foreground">{t('settings.mail.noSecretBefore')}<code className="font-mono">APP_SECRET</code>{t('settings.mail.noSecretAfter')}</p>
              </Note>
            )}

            <Card title={t('settings.mail.connected')}>
              {data.mailboxes.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">{t('settings.mail.none')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.mailboxes.map((m) => {
                    const editable = m.mine || me?.user.role === 'admin'
                    return (
                      <li key={m.id} className="space-y-2 px-4 py-3">
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 font-bold">
                              <span className="break-words">{m.email}</span>
                              <Badge tone="muted">{PROVIDER[m.provider]}</Badge>
                              {m.is_default && <Badge tone="accent">{t('settings.mail.default')}</Badge>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {m.mine ? t('settings.mail.yours') : t('settings.mail.ofUser', { name: m.user_name })} · {t('settings.mail.count', { n: m.messages })} ·{' '}
                              {m.last_synced_at ? t('settings.mail.syncedAgo', { when: fmtRelative(m.last_synced_at) }) : t('settings.mail.notSynced')}
                            </p>
                          </div>
                          <Button size="sm" onClick={() => sync(m)} disabled={syncing === m.id}>{syncing === m.id ? t('settings.mail.syncing') : t('settings.mail.sync')}</Button>
                          {editable && <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(m)}>{t('settings.mail.remove')}</Button>}
                        </div>
                        {m.sync_error && <p className="border-l-[3px] border-late bg-late/5 px-3 py-1.5 text-xs text-late">{syncError(m.sync_error)}</p>}
                        {editable && (
                          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                            <Checkbox label={t('settings.mail.defaultForSending')} checked={m.is_default} onChange={(v) => v && patch(m, { is_default: true })} />
                            <Checkbox label={t('settings.mail.sharedTeam')} checked={m.shared} onChange={(v) => patch(m, { shared: v })} />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            {data.configured && <ConnectCard oauth={data.oauth} first={data.mailboxes.length === 0} onDone={reload} />}
          </>
        )}

        {me && (
          <Card title={me.inboundAddress ? t('settings.mail.capture') : t('settings.mail.relay')}>
            <div className="space-y-3 p-4 text-sm">
              {me.inboundAddress ? (
                <>
                  <p>{t('settings.mail.captureBefore')}<Link to="/emails" className="font-semibold text-accent">{t('settings.mail.title')}</Link>{t('settings.mail.captureAfter')}</p>
                  <CopyField value={me.inboundAddress} label={t('settings.mail.capture')} />
                </>
              ) : (
                <p>{t('settings.mail.relayBefore')}<Link to="/emails" className="font-semibold text-accent">{t('settings.mail.title')}</Link>{t('settings.mail.relayAfter')}</p>
              )}
              <details className="text-xs text-muted-foreground" open={!me.inboundAddress}>
                <summary className="cursor-pointer font-semibold">{t('settings.mail.relaySummary')}</summary>
                {/* i18n-ok */}<p className="mt-2">{t('settings.mail.endpointBefore')}<code className="font-mono">from, to, subject, text, html</code>{t('settings.mail.endpointMiddle')}<code className="font-mono">message/rfc822</code>{t('settings.mail.endpointAfter')}</p>
                <div className="mt-2"><CopyField value={me.inboundUrl} label={t('settings.mail.endpoint')} /></div>
              </details>
            </div>
          </Card>
        )}
      </div>

      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} title={t('settings.mail.removeTitle')} danger confirmLabel={t('settings.mail.remove')}
        onConfirm={() => removing && remove(removing)}>
        {t('settings.mail.removeBody', { email: removing?.email ?? '' })}
      </Confirm>
    </>
  )
}

/** Les messageries proposées en tuiles, comme dans CRMlead ; « Autre » reconnaît la plupart des messageries suisses. */
const TILES = [
  // Libellés traduits (`settings.mail.tile.<key>Hint`, et le nom pour « other ») lus au rendu par tileName / tileHint.
  { key: 'gmail', name: 'Gmail', mark: 'G', color: '#c5221f', oauth: 'google' as const }, // i18n-ok
  { key: 'microsoft', name: 'Outlook', mark: 'O', color: '#0f6cbd', oauth: 'microsoft' as const }, // i18n-ok
  { key: 'icloud', name: 'iCloud', mark: 'iC', color: '#3a3a3c', oauth: null }, // i18n-ok
  { key: 'yahoo', name: 'Yahoo', mark: 'Y', color: '#5f01d1', oauth: null }, // i18n-ok
  { key: 'other', name: '', mark: '@', color: '#57534e', oauth: null },
] as const
type Tile = typeof TILES[number]
const tileName = (t: Tile) => t.key === 'other' ? tr('settings.mail.tile.other') : t.name
const tileHint = (t: Tile) => tr(`settings.mail.tile.${t.key}Hint`)

/** Où créer un mot de passe d'application, pour les messageries qui l'exigent. */
// L'étape : `settings.mail.appPassword.<clé>`, lue au rendu.
const APP_PASSWORD: Record<string, { url: string }> = {
  gmail: { url: 'https://myaccount.google.com/apppasswords' },
  icloud: { url: 'https://account.apple.com/account/manage' },
  yahoo: { url: 'https://login.yahoo.com/myaccount/security/app-password' },
}

/** Le domaine de l'adresse correspond-il à la tuile ? Sert à proposer d'emblée l'adresse de la personne. */
const FITS: Record<string, RegExp> = { gmail: /@(gmail|googlemail)\.com$/i, icloud: /@(icloud|me|mac)\.com$/i, yahoo: /@yahoo\./i }

function Mark({ t, small }: { t: Tile; small?: boolean }) {
  return <span aria-hidden="true" className={small ? 'grid h-7 w-7 shrink-0 place-items-center text-[11px] font-extrabold text-white' : 'grid h-10 w-10 place-items-center text-sm font-extrabold text-white'}
    style={{ background: t.color }}>{t.mark}</span>
}

/**
 * Brancher une boîte : choisir sa messagerie, donner l'adresse et le mot de passe, rien d'autre. Les serveurs
 * sont reconnus d'après l'adresse ; les réglages avancés ne servent qu'au cas rare où ils ne le sont pas. Le
 * serveur éprouve IMAP et SMTP avant d'enregistrer : un mot de passe qui ne marche pas n'est jamais rangé.
 * Autant de boîtes qu'on veut : chacune la sienne, partagée avec l'équipe si on le souhaite.
 */
function ConnectCard({ oauth, first, onDone }: { oauth: MailboxList['oauth']; first: boolean; onDone: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(first)
  const [tile, setTile] = useState<Tile | null>(null)
  useEffect(() => { setOpen(first); setTile(null) }, [first])

  if (!open) return (
    <div><Button variant="primary" onClick={() => setOpen(true)}>{t('settings.mail.connectAnother')}</Button></div>
  )
  return (
    <Card title={first ? t('settings.mail.connectOne') : t('settings.mail.connectAnother')}
      action={!first ? <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setTile(null) }}>{t('common.cancel')}</Button> : undefined}>
      <div className="p-4">
        {tile ? <ConnectForm tile={tile} oauth={oauth} onBack={() => setTile(null)} onDone={() => { setTile(null); setOpen(false); onDone() }} /> : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{t('settings.mail.chooseProvider')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TILES.map((tl) => {
                const oneClick = tl.oauth ? oauth[tl.oauth] : false
                // Outlook ne se branche que par Microsoft : l'accès par mot de passe y est fermé.
                const available = oneClick || tl.key !== 'microsoft'
                return oneClick ? (
                  <a key={tl.key} href={`/api/mail/oauth/${tl.oauth}/start`}
                    className="flex min-h-[112px] flex-col items-center justify-center gap-2 border border-input bg-card px-3 py-4 text-center hover:border-accent hover:bg-muted">
                    <Mark t={tl} /><span className="text-sm font-bold">{tileName(tl)}</span><span className="text-xs text-muted-foreground">{tileHint(tl)}</span>
                  </a>
                ) : (
                  <button key={tl.key} type="button" disabled={!available} onClick={() => setTile(tl)}
                    className="flex min-h-[112px] flex-col items-center justify-center gap-2 border border-input bg-card px-3 py-4 text-center hover:border-accent hover:bg-muted disabled:pointer-events-none disabled:opacity-50">
                    <Mark t={tl} /><span className="text-sm font-bold">{tileName(tl)}</span>
                    <span className="text-xs text-muted-foreground">{available ? tileHint(tl) : t('settings.mail.soon')}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

function ConnectForm({ tile, oauth, onBack, onDone }: { tile: Tile; oauth: MailboxList['oauth']; onBack: () => void; onDone: () => void }) {
  const t = useT()
  const { me } = useApp()
  // L'adresse de la personne, proposée d'emblée quand elle va avec la messagerie choisie (Gmail pour une adresse Gmail…).
  const own = me?.user.email ?? ''
  const [email, setEmail] = useState(FITS[tile.key]?.test(own) ? own : '')
  const [password, setPassword] = useState('')
  const [shared, setShared] = useState(false)
  const [found, setFound] = useState<Detected | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [edited, setEdited] = useState(false)
  const [sv, setSv] = useState({ imap_host: '', imap_port: '993', imap_secure: true, smtp_host: '', smtp_port: '465', smtp_secure: true, username: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setAdv = (patch: Partial<typeof sv>) => { setEdited(true); setSv({ ...sv, ...patch }) }

  // La messagerie est reconnue dès l'adresse saisie : serveurs préremplis, conseils adaptés.
  useEffect(() => {
    setFound(null)
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) return
    const timer = setTimeout(async () => {
      setDetecting(true)
      try {
        const d = await api.get<Detected>(`/mail/mailboxes/detect?email=${encodeURIComponent(email.trim())}`)
        setFound(d)
        if (d.servers && !edited) {
          const s = d.servers
          setSv({ imap_host: s.imapHost, imap_port: String(s.imapPort), imap_secure: s.imapSecure, smtp_host: s.smtpHost,
                  smtp_port: String(s.smtpPort), smtp_secure: s.smtpSecure, username: s.imapUser === 'local' ? email.trim().split('@')[0] : email.trim() })
        } else if (d.key === 'unknown') setAdvanced(true)
      } catch { /* la reconnaissance n'est qu'une aide : le branchement la refait de toute façon */ } finally { setDetecting(false) }
    }, 400)
    return () => clearTimeout(timer)
  }, [email])

  // La messagerie reconnue l'emporte sur la tuile : une adresse Google Workspace choisie sous « Autre » demande
  // bien un mot de passe d'application Google.
  const key = found?.key && !['other', 'unknown'].includes(found.key) ? found.key : tile.key
  const name = found?.name ?? tileName(tile)
  const needsAppPassword = found ? found.appPassword : ['gmail', 'icloud', 'yahoo'].includes(tile.key)
  const oneClick = found?.oauth && oauth[found.oauth] ? found.oauth : null
  const noImap = Boolean(found && !found.servers && found.key !== 'unknown' && !oneClick)
  const guide = APP_PASSWORD[key]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const manual = (advanced || edited) && sv.imap_host.trim()
      await api.post('/mail/mailboxes/imap', {
        email: email.trim(), password, shared,
        ...(manual ? { imap_host: sv.imap_host.trim(), imap_port: Number(sv.imap_port), imap_secure: sv.imap_secure, smtp_host: sv.smtp_host.trim(),
                       smtp_port: Number(sv.smtp_port), smtp_secure: sv.smtp_secure, username: sv.username.trim() || undefined } : {}),
      })
      toast(t('settings.mail.connectedToast', { email: email.trim() })); onDone()
    } catch (err) {
      const code = errorCode(err)
      if (code === 'servers_unknown') setAdvanced(true)
      setError(needsAppPassword && (code === 'imap_auth_failed' || code === 'smtp_auth_failed')
        ? t('settings.mail.appPasswordRefused', { name })
        : errorText(err))
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-3">
        <Mark t={TILES.find((tl) => tl.key === key) ?? tile} small />
        <p className="flex-1 text-sm font-bold">{t('settings.mail.connectName', { name })}</p>
        <Button size="sm" variant="ghost" onClick={onBack}>← {t('settings.mail.tile.other')}</Button>
      </div>
      <Field label={t('settings.mail.address')} hint={detecting ? t('settings.mail.detecting') : found?.name && tile.key === 'other' ? t('settings.mail.recognized', { name: found.name }) : undefined}>
        <Input type="email" autoComplete="off" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {oneClick ? (
        <Note>{t('settings.mail.oneClick')}{' '}
          <a href={`/api/mail/oauth/${oneClick}/start`} className="font-bold text-accent-dark">{oneClick === 'google' ? t('settings.mail.withGoogle') : t('settings.mail.withMicrosoft')}</a>.</Note>
      ) : noImap ? (
        <Note tone="warn">{t('settings.mail.noImap', { name })}</Note>
      ) : (
        <>
          {needsAppPassword && (
            <ol className="list-decimal space-y-1 bg-muted px-4 py-3 pl-8 text-sm">
              <li>{guide ? t(`settings.mail.appPassword.${key}`) : t('settings.mail.appPassword.generic')}{' '}
                {guide && <a href={guide.url} target="_blank" rel="noreferrer" className="font-bold text-accent-dark underline">{t('settings.mail.openPage')}</a>}</li>
              <li>{t('settings.mail.appPasswordStep2')}</li>
              <li>{t('settings.mail.appPasswordStep3')}</li>
            </ol>
          )}
          <Field label={needsAppPassword ? t('settings.mail.appPasswordLabel') : t('settings.mail.password')}
            hint={needsAppPassword ? undefined : t('settings.mail.passwordHint')}>
            <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Checkbox label={t('settings.mail.shareWithTeam')} checked={shared} onChange={setShared} />
          <details open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-xs font-bold text-muted-foreground">{t('settings.mail.advanced')}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-6">
              <Field label={t('settings.mail.imapServer')} className="sm:col-span-3"><Input value={sv.imap_host} onChange={(e) => setAdv({ imap_host: e.target.value })} placeholder={t('settings.mail.imapPlaceholder')} /></Field>
              <Field label={t('settings.mail.port')} className="sm:col-span-1"><Input inputMode="numeric" value={sv.imap_port} onChange={(e) => setAdv({ imap_port: e.target.value })} /></Field>
              {/* i18n-ok */}<div className="flex items-end pb-2 sm:col-span-2"><Checkbox label="SSL/TLS" checked={sv.imap_secure} onChange={(v) => setAdv({ imap_secure: v })} /></div>
              <Field label={t('settings.mail.smtpServer')} className="sm:col-span-3"><Input value={sv.smtp_host} onChange={(e) => setAdv({ smtp_host: e.target.value })} placeholder={t('settings.mail.smtpPlaceholder')} /></Field>
              <Field label={t('settings.mail.port')} className="sm:col-span-1"><Input inputMode="numeric" value={sv.smtp_port} onChange={(e) => setAdv({ smtp_port: e.target.value })} /></Field>
              {/* i18n-ok */}<div className="flex items-end pb-2 sm:col-span-2"><Checkbox label="SSL/TLS" checked={sv.smtp_secure} onChange={(v) => setAdv({ smtp_secure: v })} /></div>
              <Field label={t('settings.mail.username')} hint={t('settings.mail.usernameHint')} className="sm:col-span-6"><Input value={sv.username} onChange={(e) => setAdv({ username: e.target.value })} /></Field>
            </div>
          </details>
          {error && <p role="alert" className="text-sm text-late">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy || !email || !password}>{busy ? t('settings.mail.checking') : t('settings.mail.connectBox')}</Button>
        </>
      )}
    </form>
  )
}
