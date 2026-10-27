import { useEffect, useState, type FormEvent } from 'react'
import { Avatar, Badge, Button, Card, ErrorNote, Field, Input, toast } from '../ui'
import { api } from '../../lib/api'
import { ROLE_LABEL } from '../../lib/format'
import { useApp } from '../../lib/store'
import { CopyField, SettingsHeader } from './kit'
import { useT } from '../../i18n'
import LanguageSelect from '../LanguageSelect'

export const SWATCHES = ['#4f46e5', '#0f6e70', '#0284c7', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#57534e']

export function ColorChoice({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('settings.profile.color')}>
      {SWATCHES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} onClick={() => onChange(c)}
          className={`h-7 w-7 border-2 ${value.toLowerCase() === c ? 'border-foreground' : 'border-transparent'}`} style={{ background: c }} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('settings.profile.otherColor')} className="h-7 w-9 cursor-pointer border border-input bg-card p-0.5" />
    </div>
  )
}

export default function Profile() {
  const t = useT()
  const { me, refresh, refreshTeam } = useApp()
  const [name, setName] = useState(me?.user.name ?? '')
  const [color, setColor] = useState(me?.user.color ?? '#4f46e5')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (me) { setName(me.user.name); setColor(me.user.color) } }, [me?.user.name, me?.user.color])
  if (!me) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.patch('/me', { name: name.trim(), color }); await Promise.all([refresh(), refreshTeam()]); toast(t('settings.profile.saved')) }
    catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <>
      <SettingsHeader title={t('settings.menu.profile')}>{t('settings.profile.intro')}</SettingsHeader>
      <div className="max-w-2xl space-y-5">
        <Card title={t('settings.group.you')}>
          <form onSubmit={save} className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <Avatar person={{ name: name || me.user.name, color }} size={44} />
              <div className="min-w-0 text-sm">
                <p className="font-bold break-words">{me.user.email}</p>
                <p className="text-muted-foreground">{t('settings.profile.roleAt', { role: ROLE_LABEL[me.user.role], company: me.account.name })}</p>
              </div>
            </div>
            <Field label={t('settings.team.name')}><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Field>
            <Field label={t('settings.profile.color')}><ColorChoice value={color} onChange={setColor} /></Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{t('common.save')}</Button>
          </form>
          <div className="space-y-1.5 border-t border-border p-4">
            <span className="block text-xs font-medium text-muted-foreground">{t('settings.profile.uiLanguage')}</span>
            <LanguageSelect />
            <p className="text-xs text-muted-foreground">{t('settings.profile.uiLanguageHint')}</p>
          </div>
        </Card>

        <Card title={t('settings.profile.leadAccount')}>
          <div className="space-y-2 p-4 text-sm">
            {me.user.lead_linked ? (
              <p className="flex flex-wrap items-center gap-2"><Badge tone="ok">{t('settings.profile.linked')}</Badge>
                {t('settings.profile.linkedText')}</p>
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-2"><Badge>{t('settings.profile.notLinked')}</Badge>{t('settings.profile.notLinkedText')}</p>
                {me.features.leadId && <p className="text-muted-foreground">{t('settings.profile.linkHowTo')}</p>}
              </>
            )}
          </div>
        </Card>

        <PasswordCard />

        <DeleteAccountCard linked={me.user.lead_linked} />

        <Card title={t('settings.profile.calendarElsewhere')}>
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted-foreground">{t('settings.profile.icalText')}</p>
            <CopyField value={me.icalUrl} label={t('settings.profile.icalLink')} />
          </div>
        </Card>
      </div>
    </>
  )
}

function PasswordCard() {
  const t = useT()
  const { me } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api.post('/me/password', { current: current || undefined, next }); setCurrent(''); setNext(''); toast(t('settings.profile.passwordChanged')) }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Card title={t('settings.mail.password')}>
      <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label={t('settings.profile.currentPassword')} hint={me?.user.lead_linked ? t('settings.profile.currentPasswordHint') : undefined}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label={t('settings.profile.newPassword')} hint={t('settings.profile.newPasswordHint')}>
          <Input type="password" autoComplete="new-password" minLength={10} required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        {error != null && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
        <div className="sm:col-span-2"><Button type="submit" disabled={busy || next.length < 10}>{t('settings.profile.changePassword')}</Button></div>
      </form>
    </Card>
  )
}

/**
 * « Supprimer mon compte » (exigé par Apple, règle 5.1.1 v, et par Google Play) : le compte est le Compte Lead, commun
 * aux apps Lead ; sa suppression se fait chez ERPlead (https://erplead.io/account/delete, reconnexion récente exigée),
 * que l'app mobile ouvre dans sa vue web. Un accès d'avant le Compte Lead (e-mail et mot de passe) écrit au support.
 */
function DeleteAccountCard({ linked }: { linked: boolean }) {
  const t = useT()
  return (
    <Card title={t('settings.profile.deleteAccount')}>
      <div className="space-y-3 p-4 text-sm" data-account-delete="">
        {linked ? (
          <>
            <p className="text-muted-foreground">{t('settings.profile.deleteLinkedText')}</p>
            <a href="https://erplead.io/account/delete" className="inline-flex h-9 items-center border border-late px-3 text-[13px] font-bold text-late hover:bg-late/5">
              {t('settings.profile.deleteAccount')}</a>
          </>
        ) : (
          <p className="text-muted-foreground">{t('settings.profile.deleteWriteBefore')}{' '}
            <a href={`mailto:support@scanlead.io?subject=${encodeURIComponent(t('settings.profile.deleteMailSubject'))}`} className="font-semibold text-accent-dark hover:underline">
              {/* i18n-ok */}support@scanlead.io</a>{t('settings.profile.deleteWriteAfter')}</p>
        )}
      </div>
    </Card>
  )
}
