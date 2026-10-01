import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Confirm, ErrorNote, Field, Input, Spinner, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtRelative } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import { CopyField, Note, SettingsHeader } from './kit'

type Mailbox = { id: string; provider: 'google' | 'microsoft' | 'imap'; email: string; display_name: string | null; is_default: boolean
  shared: boolean; last_synced_at: string | null; sync_error: string | null; user_id: string; user_name: string; mine: boolean; messages: number }
type MailboxList = { configured: boolean; oauth: { google: boolean; microsoft: boolean }; mailboxes: Mailbox[] }
type Servers = { imapHost: string; imapPort: number; imapSecure: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean
  imapUser: 'address' | 'local'; smtpUser: 'address' | 'local' }
type Detected = { key: string; name?: string; oauth: 'google' | 'microsoft' | null; appPassword: boolean; servers: Servers | null }

const PROVIDER: Record<Mailbox['provider'], string> = { google: 'Gmail', microsoft: 'Microsoft 365', imap: 'IMAP' }
const SYNC_ERRORS: Record<string, string> = {
  reconnect_required: "L'accès a expiré ou a été retiré : rebranchez la boîte.",
  invalid_grant: "L'accès a expiré ou a été retiré : rebranchez la boîte.",
}
const syncError = (code: string) => SYNC_ERRORS[code] ?? errorText(code)

const RETURN: Record<string, { tone: 'ok' | 'late' | 'warn'; text: string }> = {
  ok: { tone: 'ok', text: 'Boîte branchée. Les emails arrivent dans quelques instants.' },
  erreur: { tone: 'late', text: "Le branchement n'a pas abouti. Réessayez ; si cela persiste, utilisez l'IMAP." },
  indisponible: { tone: 'warn', text: "Le branchement en un clic n'est pas disponible sur ce serveur. Utilisez l'IMAP ci-dessous." },
}

export default function Mailboxes() {
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
      toast(r.error ? syncError(r.error) : r.imported ? `${r.imported} email${r.imported > 1 ? 's' : ''} importé${r.imported > 1 ? 's' : ''}` : 'Rien de nouveau')
      reload()
    } catch (e) { toast(errorText(e)) } finally { setSyncing(null) }
  }
  const remove = async (m: Mailbox) => {
    try { await api.del(`/mail/mailboxes/${m.id}`); toast('Boîte retirée'); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title="Emails">
        Branchez vos boîtes : les emails des clients arrivent dans <Link to="/emails" className="font-semibold text-accent">Emails</Link>,
        où chacun peut ouvrir un projet, rejoindre un projet existant ou devenir une tâche.
      </SettingsHeader>

      <div className="max-w-3xl space-y-5">
        {back && (
          <Note tone={back.tone}>
            <span className="flex flex-wrap items-center justify-between gap-2">{back.text}
              <button className="text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => { params.delete('boite'); setParams(params, { replace: true }) }}>Masquer</button>
            </span>
          </Note>
        )}

        {loading && !data ? <Spinner /> : !data ? <ErrorNote error={error} /> : (
          <>
            {!data.configured && (
              <Note tone="warn">
                <p className="font-bold">Le branchement des boîtes n'est pas disponible.</p>
                <p className="mt-1 text-muted-foreground">Le serveur n'a pas de secret de chiffrement (variable <code className="font-mono">APP_SECRET</code>) :
                  sans lui, les accès aux boîtes ne peuvent pas être gardés en sécurité. La personne qui administre le serveur doit l'ajouter.
                  L'adresse de capture ci-dessous fonctionne quand même.</p>
              </Note>
            )}

            <Card title="Boîtes branchées">
              {data.mailboxes.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">Aucune boîte branchée pour l'instant.</p>
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
                              {m.is_default && <Badge tone="accent">Par défaut</Badge>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {m.mine ? 'Votre boîte' : `Boîte de ${m.user_name}`} · {m.messages} email{m.messages > 1 ? 's' : ''} ·{' '}
                              {m.last_synced_at ? `synchronisée ${fmtRelative(m.last_synced_at)}` : 'pas encore synchronisée'}
                            </p>
                          </div>
                          <Button size="sm" onClick={() => sync(m)} disabled={syncing === m.id}>{syncing === m.id ? 'Synchronisation…' : 'Synchroniser'}</Button>
                          {editable && <Button size="sm" variant="ghost" className="text-late" onClick={() => setRemoving(m)}>Retirer</Button>}
                        </div>
                        {m.sync_error && <p className="border-l-[3px] border-late bg-late/5 px-3 py-1.5 text-xs text-late">{syncError(m.sync_error)}</p>}
                        {editable && (
                          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                            <Checkbox label="Boîte par défaut pour les envois" checked={m.is_default} onChange={(v) => v && patch(m, { is_default: true })} />
                            <Checkbox label="Partagée avec l'équipe" checked={m.shared} onChange={(v) => patch(m, { shared: v })} />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            {data.configured && <ConnectCard oauth={data.oauth} onDone={reload} />}
          </>
        )}

        {me && (
          <Card title={me.inboundAddress ? 'Adresse de capture' : "Relais d'emails"}>
            <div className="space-y-3 p-4 text-sm">
              {me.inboundAddress ? (
                <>
                  <p>Transférez un email à cette adresse, ou mettez-la en copie d'un échange avec un client : il arrive dans
                    {' '}<Link to="/emails" className="font-semibold text-accent">Emails</Link>, où il peut devenir un projet en un clic. Pratique
                    sans boîte branchée, ou depuis le téléphone.</p>
                  <CopyField value={me.inboundAddress} label="Adresse de capture" />
                </>
              ) : (
                <p>Un relais d'emails ou un script peut aussi déposer des messages dans <Link to="/emails" className="font-semibold text-accent">Emails</Link>,
                  où ils deviennent un projet en un clic.</p>
              )}
              <details className="text-xs text-muted-foreground" open={!me.inboundAddress}>
                <summary className="cursor-pointer font-semibold">Pour un relais d'emails ou un script</summary>
                <p className="mt-2">Le même point d'entrée accepte un POST, en JSON (<code className="font-mono">from, to, subject, text, html</code>) ou en
                  message brut (<code className="font-mono">message/rfc822</code>) :</p>
                <div className="mt-2"><CopyField value={me.inboundUrl} label="Adresse du point d'entrée" /></div>
              </details>
            </div>
          </Card>
        )}
      </div>

      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} title="Retirer cette boîte ?" danger confirmLabel="Retirer"
        onConfirm={() => removing && remove(removing)}>
        ProjectLead cesse de lire {removing?.email}. Les emails déjà rattachés aux projets restent.
      </Confirm>
    </>
  )
}

function ConnectCard({ oauth, onDone }: { oauth: MailboxList['oauth']; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shared, setShared] = useState(false)
  const [found, setFound] = useState<Detected | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [sv, setSv] = useState({ imap_host: '', imap_port: '993', imap_secure: true, smtp_host: '', smtp_port: '465', smtp_secure: true, username: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // La messagerie est reconnue dès l'adresse saisie : serveurs préremplis, conseils adaptés.
  useEffect(() => {
    setFound(null)
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) return
    const t = setTimeout(async () => {
      setDetecting(true)
      try {
        const d = await api.get<Detected>(`/mail/mailboxes/detect?email=${encodeURIComponent(email.trim())}`)
        setFound(d)
        if (d.servers) {
          const s = d.servers
          setSv({ imap_host: s.imapHost, imap_port: String(s.imapPort), imap_secure: s.imapSecure, smtp_host: s.smtpHost,
                  smtp_port: String(s.smtpPort), smtp_secure: s.smtpSecure, username: s.imapUser === 'local' ? email.trim().split('@')[0] : email.trim() })
        } else if (d.key === 'unknown') setAdvanced(true)
      } catch { /* la détection n'est qu'une aide */ } finally { setDetecting(false) }
    }, 500)
    return () => clearTimeout(t)
  }, [email])

  const oneClick = found?.oauth && oauth[found.oauth] ? found.oauth : null
  const noImap = found && !found.servers && found.key !== 'unknown'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const manual = advanced && sv.imap_host.trim()
      await api.post('/mail/mailboxes/imap', {
        email: email.trim(), password, shared,
        ...(manual ? { imap_host: sv.imap_host.trim(), imap_port: Number(sv.imap_port), imap_secure: sv.imap_secure, smtp_host: sv.smtp_host.trim(),
                       smtp_port: Number(sv.smtp_port), smtp_secure: sv.smtp_secure, username: sv.username.trim() || undefined } : {}),
      })
      toast('Boîte branchée'); setEmail(''); setPassword(''); setAdvanced(false); onDone()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <Card title="Brancher une boîte">
      <div className="space-y-5 p-4">
        {(oauth.google || oauth.microsoft) && (
          <div className="space-y-2">
            <p className="text-sm font-bold">En un clic</p>
            <div className="flex flex-wrap gap-2">
              {oauth.google && <a href="/api/mail/oauth/google/start" className="inline-flex items-center gap-2 border border-input bg-card px-3 py-2 text-[13px] font-bold hover:bg-[#f4f2ef]">Brancher Gmail / Google Workspace</a>}
              {oauth.microsoft && <a href="/api/mail/oauth/microsoft/start" className="inline-flex items-center gap-2 border border-input bg-card px-3 py-2 text-[13px] font-bold hover:bg-[#f4f2ef]">Brancher Microsoft 365 / Outlook</a>}
            </div>
            <p className="text-xs text-muted-foreground">Vous autorisez ProjectLead chez votre fournisseur, puis revenez ici. Aucun mot de passe n'est conservé.</p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm font-bold">{oauth.google || oauth.microsoft ? 'Ou par IMAP / SMTP' : 'Par IMAP / SMTP'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Adresse email" hint={detecting ? 'Recherche des réglages…' : found?.name ? `Messagerie reconnue : ${found.name}` : undefined}>
              <Input type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={found?.appPassword ? "Mot de passe d'application" : 'Mot de passe'}
              hint={found?.appPassword ? `${found.name ?? 'Cette messagerie'} refuse le mot de passe habituel : créez un mot de passe d'application dans les réglages de sécurité du compte.` : undefined}>
              <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>
          {oneClick && (
            <Note>Cette adresse se branche plus simplement en un clic :{' '}
              <a href={`/api/mail/oauth/${oneClick}/start`} className="font-bold text-accent">{oneClick === 'google' ? 'brancher avec Google' : 'brancher avec Microsoft'}</a>.</Note>
          )}
          {noImap && !oneClick && (
            <Note tone="warn">{found?.name ?? 'Cette messagerie'} n'accepte plus l'IMAP par mot de passe. Demandez à l'administrateur du serveur d'activer le branchement en un clic.</Note>
          )}
          <Checkbox label="Partager avec l'équipe (tout le monde voit les emails de cette boîte)" checked={shared} onChange={setShared} />

          <details open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-xs font-bold text-muted-foreground">Réglages avancés (serveurs)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-6">
              <Field label="Serveur IMAP" className="sm:col-span-3"><Input value={sv.imap_host} onChange={(e) => setSv({ ...sv, imap_host: e.target.value })} placeholder="imap.exemple.ch" /></Field>
              <Field label="Port" className="sm:col-span-1"><Input inputMode="numeric" value={sv.imap_port} onChange={(e) => setSv({ ...sv, imap_port: e.target.value })} /></Field>
              <div className="flex items-end pb-2 sm:col-span-2"><Checkbox label="SSL/TLS" checked={sv.imap_secure} onChange={(v) => setSv({ ...sv, imap_secure: v })} /></div>
              <Field label="Serveur SMTP" className="sm:col-span-3"><Input value={sv.smtp_host} onChange={(e) => setSv({ ...sv, smtp_host: e.target.value })} placeholder="smtp.exemple.ch" /></Field>
              <Field label="Port" className="sm:col-span-1"><Input inputMode="numeric" value={sv.smtp_port} onChange={(e) => setSv({ ...sv, smtp_port: e.target.value })} /></Field>
              <div className="flex items-end pb-2 sm:col-span-2"><Checkbox label="SSL/TLS" checked={sv.smtp_secure} onChange={(v) => setSv({ ...sv, smtp_secure: v })} /></div>
              <Field label="Identifiant" hint="Souvent l'adresse entière." className="sm:col-span-6"><Input value={sv.username} onChange={(e) => setSv({ ...sv, username: e.target.value })} /></Field>
            </div>
          </details>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" disabled={busy || !email || !password}>{busy ? 'Vérification…' : 'Brancher la boîte'}</Button>
        </form>
      </div>
    </Card>
  )
}
