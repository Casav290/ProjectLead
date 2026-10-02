import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Confirm, ErrorNote, Field, Input, Spinner, toast } from '../ui'
import { api, ApiError, errorText } from '../../lib/api'
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
const errorCode = (e: unknown) => e instanceof ApiError ? e.code : String((e as Error)?.message ?? e)

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

            {data.configured && <ConnectCard oauth={data.oauth} first={data.mailboxes.length === 0} onDone={reload} />}
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

/** Les messageries proposées en tuiles, comme dans CRMlead ; « Autre » reconnaît la plupart des messageries suisses. */
const TILES = [
  { key: 'gmail', name: 'Gmail', hint: 'et Google Workspace', mark: 'G', color: '#c5221f', oauth: 'google' as const },
  { key: 'microsoft', name: 'Outlook', hint: 'et Microsoft 365', mark: 'O', color: '#0f6cbd', oauth: 'microsoft' as const },
  { key: 'icloud', name: 'iCloud', hint: "Mail d'Apple", mark: 'iC', color: '#3a3a3c', oauth: null },
  { key: 'yahoo', name: 'Yahoo', hint: 'Yahoo Mail', mark: 'Y', color: '#5f01d1', oauth: null },
  { key: 'other', name: 'Autre messagerie', hint: 'Infomaniak, Hostpoint, Bluewin, OVH…', mark: '@', color: '#57534e', oauth: null },
] as const
type Tile = typeof TILES[number]

/** Où créer un mot de passe d'application, pour les messageries qui l'exigent. */
const APP_PASSWORD: Record<string, { url: string; step: string }> = {
  gmail: { url: 'https://myaccount.google.com/apppasswords', step: 'Ouvrez la page des mots de passe d\'application Google (la validation en deux étapes doit être activée sur le compte).' },
  icloud: { url: 'https://account.apple.com/account/manage', step: 'Ouvrez votre compte Apple, rubrique « Connexion et sécurité », puis « Mots de passe pour app ».' },
  yahoo: { url: 'https://login.yahoo.com/myaccount/security/app-password', step: 'Ouvrez la sécurité de votre compte Yahoo, puis « Générer un mot de passe d\'application ».' },
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
  const [open, setOpen] = useState(first)
  const [tile, setTile] = useState<Tile | null>(null)
  useEffect(() => { setOpen(first); setTile(null) }, [first])

  if (!open) return (
    <div><Button variant="primary" onClick={() => setOpen(true)}>Brancher une autre boîte</Button></div>
  )
  return (
    <Card title={first ? 'Brancher une boîte' : 'Brancher une autre boîte'}
      action={!first ? <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setTile(null) }}>Annuler</Button> : undefined}>
      <div className="p-4">
        {tile ? <ConnectForm tile={tile} oauth={oauth} onBack={() => setTile(null)} onDone={() => { setTile(null); setOpen(false); onDone() }} /> : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">Choisissez votre messagerie. Vous pourrez en brancher autant que vous voulez.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TILES.map((t) => {
                const oneClick = t.oauth ? oauth[t.oauth] : false
                // Outlook ne se branche que par Microsoft : l'accès par mot de passe y est fermé.
                const available = oneClick || t.key !== 'microsoft'
                return oneClick ? (
                  <a key={t.key} href={`/api/mail/oauth/${t.oauth}/start`}
                    className="flex min-h-[112px] flex-col items-center justify-center gap-2 border border-input bg-card px-3 py-4 text-center hover:border-accent hover:bg-muted">
                    <Mark t={t} /><span className="text-sm font-bold">{t.name}</span><span className="text-xs text-muted-foreground">{t.hint}</span>
                  </a>
                ) : (
                  <button key={t.key} type="button" disabled={!available} onClick={() => setTile(t)}
                    className="flex min-h-[112px] flex-col items-center justify-center gap-2 border border-input bg-card px-3 py-4 text-center hover:border-accent hover:bg-muted disabled:pointer-events-none disabled:opacity-50">
                    <Mark t={t} /><span className="text-sm font-bold">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{available ? t.hint : 'Bientôt disponible'}</span>
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
    const t = setTimeout(async () => {
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
    return () => clearTimeout(t)
  }, [email])

  // La messagerie reconnue l'emporte sur la tuile : une adresse Google Workspace choisie sous « Autre » demande
  // bien un mot de passe d'application Google.
  const key = found?.key && !['other', 'unknown'].includes(found.key) ? found.key : tile.key
  const name = found?.name ?? tile.name
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
      toast(`${email.trim()} est branchée`); onDone()
    } catch (err) {
      const code = errorCode(err)
      if (code === 'servers_unknown') setAdvanced(true)
      setError(needsAppPassword && (code === 'imap_auth_failed' || code === 'smtp_auth_failed')
        ? `Mot de passe refusé. ${name} n'accepte pas votre mot de passe habituel : créez un mot de passe d'application (étape 1) et collez-le ici.`
        : errorText(err))
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-3">
        <Mark t={TILES.find((t) => t.key === key) ?? tile} small />
        <p className="flex-1 text-sm font-bold">Brancher {name}</p>
        <Button size="sm" variant="ghost" onClick={onBack}>← Autre messagerie</Button>
      </div>
      <Field label="Adresse email" hint={detecting ? 'Recherche des réglages…' : found?.name && tile.key === 'other' ? `Messagerie reconnue : ${found.name}` : undefined}>
        <Input type="email" autoComplete="off" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {oneClick ? (
        <Note>Cette adresse se branche en un clic :{' '}
          <a href={`/api/mail/oauth/${oneClick}/start`} className="font-bold text-accent-dark">{oneClick === 'google' ? 'brancher avec Google' : 'brancher avec Microsoft'}</a>.</Note>
      ) : noImap ? (
        <Note tone="warn">{name} n'accepte plus l'IMAP par mot de passe : cette messagerie se branchera en un clic dès que ce sera ouvert sur ProjectLead.</Note>
      ) : (
        <>
          {needsAppPassword && (
            <ol className="list-decimal space-y-1 bg-muted px-4 py-3 pl-8 text-sm">
              <li>{guide?.step ?? 'Dans les réglages de sécurité de votre compte, créez un mot de passe d\'application.'}{' '}
                {guide && <a href={guide.url} target="_blank" rel="noreferrer" className="font-bold text-accent-dark underline">Ouvrir la page</a>}</li>
              <li>Créez un mot de passe nommé « ProjectLead » et copiez-le.</li>
              <li>Collez-le ci-dessous, puis cliquez sur « Brancher la boîte ».</li>
            </ol>
          )}
          <Field label={needsAppPassword ? "Mot de passe d'application" : 'Mot de passe'}
            hint={needsAppPassword ? undefined : 'Celui de la messagerie. Il est chiffré, et sert seulement à lire et envoyer les emails.'}>
            <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Checkbox label="Partager avec l'équipe (tout le monde voit les emails de cette boîte)" checked={shared} onChange={setShared} />
          <details open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-xs font-bold text-muted-foreground">Réglages avancés (serveurs)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-6">
              <Field label="Serveur IMAP" className="sm:col-span-3"><Input value={sv.imap_host} onChange={(e) => setAdv({ imap_host: e.target.value })} placeholder="imap.exemple.ch" /></Field>
              <Field label="Port" className="sm:col-span-1"><Input inputMode="numeric" value={sv.imap_port} onChange={(e) => setAdv({ imap_port: e.target.value })} /></Field>
              <div className="flex items-end pb-2 sm:col-span-2"><Checkbox label="SSL/TLS" checked={sv.imap_secure} onChange={(v) => setAdv({ imap_secure: v })} /></div>
              <Field label="Serveur SMTP" className="sm:col-span-3"><Input value={sv.smtp_host} onChange={(e) => setAdv({ smtp_host: e.target.value })} placeholder="smtp.exemple.ch" /></Field>
              <Field label="Port" className="sm:col-span-1"><Input inputMode="numeric" value={sv.smtp_port} onChange={(e) => setAdv({ smtp_port: e.target.value })} /></Field>
              <div className="flex items-end pb-2 sm:col-span-2"><Checkbox label="SSL/TLS" checked={sv.smtp_secure} onChange={(v) => setAdv({ smtp_secure: v })} /></div>
              <Field label="Identifiant" hint="Souvent l'adresse entière." className="sm:col-span-6"><Input value={sv.username} onChange={(e) => setAdv({ username: e.target.value })} /></Field>
            </div>
          </details>
          {error && <p role="alert" className="text-sm text-late">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy || !email || !password}>{busy ? 'Vérification…' : 'Brancher la boîte'}</Button>
        </>
      )}
    </form>
  )
}
