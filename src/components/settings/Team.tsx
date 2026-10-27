import { useEffect, useState, type FormEvent } from 'react'
import { Avatar, Button, Card, ColorDot, Confirm, Empty, ErrorNote, Field, Input, Modal, PeoplePicker, Select, Spinner, TableStack, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtDate, money, parseMoney, ROLE_LABEL } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { Member } from '../../lib/types'
import { ColorChoice } from './Profile'
import { UpgradeLink } from '../PlanCard'
import { CopyField, Note, SettingsHeader, useRole } from './kit'
import { getLocale, intlLocale, LOCALE_NAMES, LOCALES, isLocale, useT, type Locale } from '../../i18n'

type TeamRow = { id: string; name: string; color: string; member_ids: string[] }
export type InvitationRow = { id: string; email: string; role: Member['role']; expires_at: string; created_at: string }
type TeamData = { members: Member[]; teams: TeamRow[]; invitations: InvitationRow[] }

const hoursText = (min: number) => (min / 60).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })
// Formats lus au rendu : ils suivent la langue en cours.
const seenDate = () => new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
const seenTime = () => new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' })

export default function Team() {
  const t = useT()
  const { me, refreshTeam, refresh } = useApp()
  const { isAdmin, canManage } = useRole()
  const { data, error, loading, reload } = useLoad<TeamData>('/team')
  const [editing, setEditing] = useState<Member | null>(null)
  const [inviting, setInviting] = useState(false)
  const [team, setTeam] = useState<TeamRow | 'new' | null>(null)
  const [revoking, setRevoking] = useState<InvitationRow | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const changed = () => { reload(); refreshTeam(); refresh() }

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorNote error={error} />
  const cur = me?.account.currency ?? 'CHF'
  const active = data.members.filter((m) => m.active)

  const revoke = async (i: InvitationRow) => {
    try { await api.del(`/team/invitations/${i.id}`); toast(isAdmin ? t('settings.team.toastInviteRemoved') : t('settings.team.toastInviteRevoked')); reload(); refresh() } catch (e) { toast(errorText(e)) }
  }
  const remove = async (m: Member) => {
    try { await api.post(`/team/members/${m.id}/remove`); toast(t('settings.team.toastRemoved')); changed() } catch (e) { toast(errorText(e)) }
  }
  const restore = async (m: Member) => {
    try { await api.post(`/team/members/${m.id}/restore`); toast(t('settings.team.toastRestored')); changed() } catch (e) { toast(errorText(e)) }
  }
  const who = (m: Member | null) => m?.name || m?.email || ''

  return (
    <>
      <SettingsHeader title={t('settings.team.title')} action={canManage && <Button variant="primary" onClick={() => setInviting(true)}>{t('settings.team.invite')}</Button>}>
        {t('settings.team.intro', { company: me?.account.name ?? '' })}
      </SettingsHeader>
      {me?.plan.seats != null && me.plan.members + me.plan.invited >= me.plan.seats && (
        <p className="-mt-2 mb-5 border border-border bg-card px-3 py-2 text-sm">
          {me.plan.tier === 'pro_plus' ? t('settings.team.seatsFullProPlus')
            : <>{t('settings.team.seatsFull', { plan: me.plan.name, n: me.plan.seats })}
                {' '}<UpgradeLink plan={me.plan}>{t('settings.team.upgradeProPlus')}</UpgradeLink></>}
        </p>
      )}

      <SeatList members={data.members} invitations={data.invitations} seatsMax={me?.plan.seats ?? null} meId={me?.user.id ?? ''}
        isAdmin={isAdmin} canManage={canManage} currency={cur} onEdit={setEditing} onRemove={setRemoving} onRevoke={setRevoking} onRestore={restore} />

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">{t('settings.team.teams')}</h2>
          {canManage && <Button size="sm" onClick={() => setTeam('new')}>{t('settings.team.newTeam')}</Button>}
        </div>
        {data.teams.length === 0 ? (
          <Empty title={t('settings.team.noTeams')}>{t('settings.team.noTeamsHint')}</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.teams.map((tm) => {
              const people = data.members.filter((m) => tm.member_ids.includes(m.id))
              return (
                <li key={tm.id}>
                  <Card>
                    <div className="flex items-start gap-3 p-4">
                      <ColorDot color={tm.color} className="mt-1.5" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold break-words">{tm.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{people.length ? people.map((p) => p.name).join(', ') : t('settings.team.nobodyYet')}</p>
                      </div>
                      {canManage && <Button size="sm" variant="ghost" onClick={() => setTeam(tm)}>{t('common.edit')}</Button>}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <MemberDialog member={editing} currency={cur} onClose={() => setEditing(null)} onSaved={changed} />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} onSent={reload} />
      <TeamDialog team={team} people={active} onClose={() => setTeam(null)} onSaved={changed} />
      <Confirm open={Boolean(revoking)} onClose={() => setRevoking(null)} title={isAdmin ? t('settings.team.removeInviteTitle') : t('settings.team.revokeInviteTitle')} danger
        confirmLabel={isAdmin ? t('settings.team.remove') : t('settings.team.revoke')} onConfirm={() => revoking && revoke(revoking)}>
        {t('settings.team.revokeInviteBody', { email: revoking?.email ?? '' })}</Confirm>
      {/* « Retirer » en deux temps : la confirmation nomme la personne et dit l'effet (suites de l'abonnement, point 2). */}
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} title={t('settings.team.removePersonTitle', { name: who(removing) })} danger confirmLabel={t('settings.team.remove')}
        onConfirm={() => removing && remove(removing)}>
        <p>{t('settings.team.removePersonBody1', { name: who(removing) })}</p>
        <p className="mt-2">{t('settings.team.removePersonBody2')}</p>
      </Confirm>
    </>
  )
}

/** La dernière venue d'une personne dans cette entreprise (`data-last-seen` : date ISO, ou « never » si aucune n'est notée). */
function LastSeen({ at }: { at: string | null }) {
  const t = useT()
  if (!at) return <span data-last-seen="never" title={t('settings.team.neverSeenTitle')}>{t('settings.team.neverSeen')}</span>
  const d = new Date(at)
  return <span data-last-seen={at}>{seenDate().format(d)}, {seenTime().format(d)}</span>
}

/**
 * Les places de la formule (Réglages → Équipe ; suites de l'abonnement, 15.10.2026, point 2) : une ligne par place
 * occupée (personne active, invitation en attente), avec sa dernière venue pour l'administrateur (le serveur ne la
 * donne qu'à lui, comme le coût horaire) ; « Retirer » pour l'administrateur sur
 * chaque ligne sauf la sienne (une invitation se retire en la révoquant ; un responsable la révoque comme avant) ; les
 * personnes retirées à part, avec « Rétablir ». Contrat de page du banc : [data-seat-list] (data-seats-used,
 * data-seats-max), [data-seat-holder], [data-last-seen], [data-seat-remove], [data-seat-removed].
 */
export function SeatList({ members, invitations, seatsMax, meId, isAdmin, canManage, currency, onEdit, onRemove, onRevoke, onRestore }: {
  members: Member[]; invitations: InvitationRow[]; seatsMax: number | null; meId: string; isAdmin: boolean; canManage: boolean; currency: string
  onEdit: (m: Member) => void; onRemove: (m: Member) => void; onRevoke: (i: InvitationRow) => void; onRestore: (m: Member) => void
}) {
  const t = useT()
  const active = members.filter((m) => m.active)
  const removed = members.filter((m) => !m.active)
  const used = active.length + invitations.length
  const places = (seatsMax === null ? t('settings.team.seatsUsed', { n: used }) : t('settings.team.seatsUsedOf', { n: used, max: seatsMax }))
    + (invitations.length ? t('settings.team.seatsPending', { n: invitations.length }) : '')
  return (
    <>
      <section className="mb-8" data-seat-list="" data-seats-used={used} data-seats-max={seatsMax ?? ''}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">{t('settings.team.members', { n: active.length })}</h2>
          <p className="text-xs text-muted-foreground">{places}</p>
        </div>
        <TableStack>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2">{t('settings.team.colPerson')}</th>
                <th className="px-3 py-2">{t('settings.team.colRole')}</th>
                {isAdmin && <th className="px-3 py-2">{t('settings.team.colLastSeen')}</th>}
                {canManage && <th className="px-3 py-2 text-right">{t('settings.team.colRate')}</th>}
                {isAdmin && <th className="px-3 py-2 text-right">{t('settings.team.colCost')}</th>}
                <th className="px-3 py-2 text-right">{t('settings.team.colCapacity')}</th>
                {canManage && <th className="px-3 py-2"><span className="sr-only">{t('settings.team.colActions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id} data-seat-holder={(m.email ?? '').toLowerCase()}>
                  <td className="px-3 py-2" data-label="">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar person={m} size={28} />
                      <span className="min-w-0">
                        <span className="block font-bold break-words">{m.name || m.email}{m.id === meId && <span className="font-normal text-muted-foreground"> {t('settings.team.you')}</span>}</span>
                        <span className="block break-all text-xs text-muted-foreground">{m.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABEL[m.role]}</td>
                  {isAdmin && <td className="whitespace-nowrap px-3 py-2 tabular-nums"><LastSeen at={m.last_seen_at} /></td>}
                  {canManage && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m.hourly_rate_cents ? money(m.hourly_rate_cents, currency) : '—'}</td>}
                  {isAdmin && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m.cost_rate_cents ? money(m.cost_rate_cents, currency) : '—'}</td>}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{t('settings.team.hours', { h: hoursText(m.capacity_minutes) })}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      {isAdmin && (
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => onEdit(m)}>{t('common.edit')}</Button>
                          {m.id !== meId && (
                            <Button size="sm" variant="ghost" className="text-late" data-seat-remove="" aria-label={t('settings.team.removeAria', { name: m.name || m.email || '' })}
                              onClick={() => onRemove(m)}>{t('settings.team.remove')}</Button>
                          )}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {invitations.map((i) => (
                <tr key={i.id} data-seat-holder={i.email.toLowerCase()}>
                  <td className="px-3 py-2" data-label="">
                    <span className="block font-bold break-all">{i.email}</span>
                    <span className="block text-xs text-muted-foreground">{isAdmin ? t('settings.team.invitedOn', { date: fmtDate(i.created_at) }) : t('settings.team.invitePending')}</span>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABEL[i.role]}</td>
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <span data-last-seen="never">{t('settings.team.invitePending')}</span>
                      <span className="block text-xs text-muted-foreground">{t('settings.team.validUntil', { date: fmtDate(i.expires_at) })}</span>
                    </td>
                  )}
                  {canManage && <td className="px-3 py-2 text-right text-muted-foreground">—</td>}
                  {isAdmin && <td className="px-3 py-2 text-right text-muted-foreground">—</td>}
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      {isAdmin
                        ? <Button size="sm" variant="ghost" className="text-late" data-seat-remove="" aria-label={t('settings.team.removeInviteAria', { email: i.email })}
                            onClick={() => onRevoke(i)}>{t('settings.team.remove')}</Button>
                        : <Button size="sm" variant="ghost" className="text-late" onClick={() => onRevoke(i)}>{t('settings.team.revoke')}</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableStack>
      </section>

      {removed.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">{t('settings.team.removedTitle', { n: removed.length })}</h2>
          <p className="mb-2 text-sm text-muted-foreground">{t('settings.team.removedHint')}</p>
          <ul className="divide-y divide-border border border-border bg-card">
            {removed.map((m) => (
              <li key={m.id} data-seat-removed={(m.email ?? '').toLowerCase()} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words">{m.name || m.email}</span>
                  <span className="block break-all text-xs text-muted-foreground">{m.email}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {m.lead_disabled ? t('settings.team.leftLead') : t('settings.team.removedByAdmin')}
                  {isAdmin && <> {t('settings.team.lastSeen')} <LastSeen at={m.last_seen_at} /></>}</span>
                {isAdmin && (
                  <span className="inline-flex gap-1">
                    {!m.lead_disabled && <Button size="sm" onClick={() => onRestore(m)}>{t('settings.team.restore')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => onEdit(m)}>{t('common.edit')}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function MemberDialog({ member, currency, onClose, onSaved }: { member: Member | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const { me } = useApp()
  const [f, setF] = useState({ role: 'member' as Member['role'], rate: '', cost: '', capacity: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (member) {
      setF({ role: member.role, rate: member.hourly_rate_cents ? String(member.hourly_rate_cents / 100) : '',
             cost: member.cost_rate_cents ? String(member.cost_rate_cents / 100) : '', capacity: hoursText(member.capacity_minutes) })
      setError(null)
    }
  }, [member])
  const rate = parseMoney(f.rate || '0'), cost = parseMoney(f.cost || '0')
  const capacity = Number(f.capacity.replace(',', '.'))
  const valid = rate != null && cost != null && Number.isFinite(capacity) && capacity >= 0 && capacity <= 168

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!member || !valid) return
    setBusy(true); setError(null)
    try {
      // Sa place (retirer, rétablir) se règle dans la liste, pas ici.
      await api.patch(`/team/members/${member.id}`, { role: f.role, hourly_rate_cents: rate, cost_rate_cents: cost,
        capacity_minutes: Math.round(capacity * 60) })
      toast(t('settings.team.saved')); onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const self = member?.id === me?.user.id
  return (
    <Modal open={Boolean(member)} onClose={onClose} title={member?.name || member?.email || ''}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="member-form" disabled={busy || !valid}>{t('common.save')}</Button></>}>
      <form id="member-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('settings.team.colRole')} className="sm:col-span-2"
          hint={f.role === 'admin' ? t('settings.team.roleAdminHint') : f.role === 'manager'
            ? t('settings.team.roleManagerHint') : t('settings.team.roleMemberHint')}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Member['role'] })}>
            {(['admin', 'manager', 'member'] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field label={t('settings.team.rateLabel', { currency })} hint={t('settings.team.rateHint')}>
          <Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="0.00" />
        </Field>
        <Field label={t('settings.team.costLabel', { currency })} hint={t('settings.team.costHint')}>
          <Input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="0.00" />
        </Field>
        <Field label={t('settings.team.capacityLabel')} className="sm:col-span-2">
          <Input inputMode="decimal" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        </Field>
        {self && <p className="text-xs text-muted-foreground sm:col-span-2">{t('settings.team.selfNote')}</p>}
        {error != null && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
      </form>
    </Modal>
  )
}

function InviteDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: () => void }) {
  const t = useT()
  const { isAdmin } = useRole()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Member['role']>('member')
  // Langue de l'e-mail d'invitation : par défaut, celle de l'interface.
  const [locale, setLocale] = useState<Locale>(getLocale())
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (open) { setEmail(''); setRole('member'); setLocale(getLocale()); setLink(null); setError(null) } }, [open])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api.post<{ link: string }>('/team/invite', { email: email.trim(), role, locale })
      setLink(r.link.startsWith('http') ? r.link : `${window.location.origin}${r.link}`)
      onSent()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('settings.team.invite')}
      footer={link ? <Button variant="primary" onClick={onClose}>{t('settings.team.done')}</Button>
        : <><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="invite-form" disabled={busy || !email.includes('@')}>{t('settings.team.sendInvite')}</Button></>}>
      {link ? (
        <div className="space-y-3 text-sm">
          <Note tone="ok">{t('settings.team.inviteSentBefore')}<strong>{email}</strong>{t('settings.team.inviteSentAfter')}</Note>
          <p className="text-muted-foreground">{t('settings.team.inviteLinkHint')}</p>
          <CopyField value={link} label={t('settings.team.inviteLink')} />
        </div>
      ) : (
        <form id="invite-form" onSubmit={send} className="space-y-3">
          <Field label={t('settings.team.email')}><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t('settings.team.colRole')}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
              <option value="member">{ROLE_LABEL.member}</option>
              <option value="manager">{ROLE_LABEL.manager}</option>
              {isAdmin && <option value="admin">{ROLE_LABEL.admin}</option>}
            </Select>
          </Field>
          <Field label={t('settings.team.inviteLocale')}>
            <Select value={locale} onChange={(e) => { if (isLocale(e.target.value)) setLocale(e.target.value) }}>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
            </Select>
          </Field>
          <ErrorNote error={error} />
        </form>
      )}
    </Modal>
  )
}

function TeamDialog({ team, people, onClose, onSaved }: { team: TeamRow | 'new' | null; people: Member[]; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#0f6e70')
  const [ids, setIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!team) return
    setName(team === 'new' ? '' : team.name); setColor(team === 'new' ? '#0f6e70' : team.color)
    setIds(team === 'new' ? [] : team.member_ids); setError(null)
  }, [team])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const body = { name: name.trim(), color, member_ids: ids }
      if (team === 'new') await api.post('/team/teams', body)
      else if (team) await api.patch(`/team/teams/${team.id}`, body)
      onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!team || team === 'new') return
    try { await api.del(`/team/teams/${team.id}`); toast(t('settings.team.teamDeleted')); onSaved(); onClose() } catch (err) { setError(err) }
  }
  return (
    <Modal open={Boolean(team)} onClose={onClose} title={team === 'new' ? t('settings.team.newTeam') : t('settings.team.editTeam')}
      footer={<>
        {team && team !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>{t('common.delete')}</Button>}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="team-form" disabled={busy || !name.trim()}>{t('common.save')}</Button>
      </>}>
      <form id="team-form" onSubmit={save} className="space-y-3">
        <Field label={t('settings.team.name')}><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></Field>
        <Field label={t('settings.profile.color')}><ColorChoice value={color} onChange={setColor} /></Field>
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">{t('settings.team.membersLabel')}</span>
          <PeoplePicker people={people} value={ids} onChange={setIds} placeholder={t('settings.team.addPerson')} />
        </div>
        <ErrorNote error={error} />
      </form>
      <Confirm open={removing} onClose={() => setRemoving(false)} title={t('settings.team.deleteTeamTitle')} danger confirmLabel={t('common.delete')} onConfirm={remove}>
        {t('settings.team.deleteTeamBody')}
      </Confirm>
    </Modal>
  )
}
