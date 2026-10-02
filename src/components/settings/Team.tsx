import { useEffect, useState, type FormEvent } from 'react'
import { Avatar, Badge, Button, Card, Checkbox, ColorDot, Confirm, Empty, ErrorNote, Field, Input, Modal, PeoplePicker, Select, Spinner, TableStack, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { fmtDate, money, parseMoney, ROLE_LABEL } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { Member } from '../../lib/types'
import { ColorChoice } from './Profile'
import { CopyField, Note, SettingsHeader, useRole } from './kit'

type TeamRow = { id: string; name: string; color: string; member_ids: string[] }
type InvitationRow = { id: string; email: string; role: Member['role']; expires_at: string; created_at: string }
type TeamData = { members: Member[]; teams: TeamRow[]; invitations: InvitationRow[] }

const hoursText = (min: number) => (min / 60).toLocaleString('fr-CH', { maximumFractionDigits: 1 })

export default function Team() {
  const { me, refreshTeam, refresh } = useApp()
  const { isAdmin, canManage } = useRole()
  const { data, error, loading, reload } = useLoad<TeamData>('/team')
  const [editing, setEditing] = useState<Member | null>(null)
  const [inviting, setInviting] = useState(false)
  const [team, setTeam] = useState<TeamRow | 'new' | null>(null)
  const [revoking, setRevoking] = useState<InvitationRow | null>(null)
  const changed = () => { reload(); refreshTeam(); refresh() }

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorNote error={error} />
  const cur = me?.account.currency ?? 'CHF'
  const active = data.members.filter((m) => m.active)

  const revoke = async (i: InvitationRow) => {
    try { await api.del(`/team/invitations/${i.id}`); toast('Invitation révoquée'); reload(); refresh() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title="Équipe" action={canManage && <Button variant="primary" onClick={() => setInviting(true)}>Inviter une personne</Button>}>
        Les personnes de {me?.account.name}, leurs rôles, leurs taux et leur disponibilité.
      </SettingsHeader>
      {me?.plan.seats != null && me.plan.members + me.plan.invited >= me.plan.seats && (
        <p className="-mt-2 mb-5 border border-border bg-card px-3 py-2 text-sm">
          {me.plan.tier === 'pro_plus' ? 'Les 5 places de Pro+ sont prises : retirez une personne ou une invitation pour en inviter une autre.'
            : <>Votre formule {me.plan.name} compte {me.plan.seats === 1 ? '1 personne' : `${me.plan.seats} personnes`}, et toutes les places sont prises.
                {' '}<a href={me.plan.upgradeUrl} className="font-semibold text-accent-dark hover:underline">Pro+ pour inviter jusqu'à 5 personnes</a></>}
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">Membres ({active.length})</h2>
        <TableStack>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2">Personne</th>
                <th className="px-3 py-2">Rôle</th>
                {canManage && <th className="px-3 py-2 text-right">Vente / h</th>}
                {isAdmin && <th className="px-3 py-2 text-right">Coût / h</th>}
                <th className="px-3 py-2 text-right">Capacité / sem.</th>
                {isAdmin && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'text-muted-foreground'}>
                  <td className="px-3 py-2" data-label="">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar person={m} size={28} />
                      <span className="min-w-0">
                        <span className="block font-bold break-words">{m.name || m.email}{m.id === me?.user.id && <span className="font-normal text-muted-foreground"> (vous)</span>}</span>
                        <span className="block break-all text-xs text-muted-foreground">{m.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABEL[m.role]}{!m.active && <> <Badge>Désactivé</Badge></>}</td>
                  {canManage && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m.hourly_rate_cents ? money(m.hourly_rate_cents, cur) : '—'}</td>}
                  {isAdmin && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m.cost_rate_cents ? money(m.cost_rate_cents, cur) : '—'}</td>}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{hoursText(m.capacity_minutes)} h</td>
                  {isAdmin && <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Modifier</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableStack>
      </section>

      {canManage && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">Invitations en attente</h2>
          {data.invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune invitation en attente.</p>
          ) : (
            <ul className="divide-y divide-border border border-border bg-card">
              {data.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 font-semibold break-words">{i.email}</span>
                  <span className="text-muted-foreground">{ROLE_LABEL[i.role]}</span>
                  <span className="text-xs text-muted-foreground">valable jusqu'au {fmtDate(i.expires_at)}</span>
                  <Button size="sm" variant="ghost" className="text-late" onClick={() => setRevoking(i)}>Révoquer</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold uppercase tracking-[.06em] text-muted-foreground">Équipes</h2>
          {canManage && <Button size="sm" onClick={() => setTeam('new')}>Nouvelle équipe</Button>}
        </div>
        {data.teams.length === 0 ? (
          <Empty title="Aucune équipe">Regroupez les personnes par métier ou par pôle (graphisme, développement…) pour filtrer la charge et les projets.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.teams.map((t) => {
              const people = data.members.filter((m) => t.member_ids.includes(m.id))
              return (
                <li key={t.id}>
                  <Card>
                    <div className="flex items-start gap-3 p-4">
                      <ColorDot color={t.color} className="mt-1.5" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold break-words">{t.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{people.length ? people.map((p) => p.name).join(', ') : 'Personne pour l\'instant'}</p>
                      </div>
                      {canManage && <Button size="sm" variant="ghost" onClick={() => setTeam(t)}>Modifier</Button>}
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
      <Confirm open={Boolean(revoking)} onClose={() => setRevoking(null)} title="Révoquer l'invitation ?" danger confirmLabel="Révoquer"
        onConfirm={() => revoking && revoke(revoking)}>Le lien envoyé à {revoking?.email} ne fonctionnera plus.</Confirm>
    </>
  )
}

function MemberDialog({ member, currency, onClose, onSaved }: { member: Member | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const { me } = useApp()
  const [f, setF] = useState({ role: 'member' as Member['role'], active: true, rate: '', cost: '', capacity: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (member) {
      setF({ role: member.role, active: member.active, rate: member.hourly_rate_cents ? String(member.hourly_rate_cents / 100) : '',
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
      await api.patch(`/team/members/${member.id}`, { role: f.role, active: f.active, hourly_rate_cents: rate, cost_rate_cents: cost,
        capacity_minutes: Math.round(capacity * 60) })
      toast('Enregistré'); onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const self = member?.id === me?.user.id
  return (
    <Modal open={Boolean(member)} onClose={onClose} title={member?.name || member?.email || ''}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="member-form" disabled={busy || !valid}>Enregistrer</Button></>}>
      <form id="member-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="Rôle" className="sm:col-span-2"
          hint={f.role === 'admin' ? 'Tout, y compris l\'entreprise, les intégrations et les taux.' : f.role === 'manager'
            ? 'Projets, clients, facturation, invitations, automatisations.' : 'Ses projets, ses tâches et son temps.'}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Member['role'] })}>
            {(['admin', 'manager', 'member'] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field label={`Taux de vente (${currency} / h)`} hint="Facturé au client, sauf taux propre au projet.">
          <Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="0.00" />
        </Field>
        <Field label={`Coût horaire (${currency} / h)`} hint="Pour la rentabilité ; jamais montré au client.">
          <Input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="0.00" />
        </Field>
        <Field label="Capacité (heures par semaine)" className="sm:col-span-2">
          <Input inputMode="decimal" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        </Field>
        <Checkbox className="sm:col-span-2" checked={f.active} onChange={(v) => setF({ ...f, active: v })}
          label="Actif : peut se connecter et recevoir des tâches" />
        {self && <p className="text-xs text-muted-foreground sm:col-span-2">C'est vous : l'entreprise garde toujours au moins un administrateur actif.</p>}
        {error != null && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
      </form>
    </Modal>
  )
}

function InviteDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: () => void }) {
  const { isAdmin } = useRole()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Member['role']>('member')
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { if (open) { setEmail(''); setRole('member'); setLink(null); setError(null) } }, [open])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api.post<{ link: string }>('/team/invite', { email: email.trim(), role })
      setLink(r.link.startsWith('http') ? r.link : `${window.location.origin}${r.link}`)
      onSent()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Inviter une personne"
      footer={link ? <Button variant="primary" onClick={onClose}>Terminé</Button>
        : <><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="invite-form" disabled={busy || !email.includes('@')}>Envoyer l'invitation</Button></>}>
      {link ? (
        <div className="space-y-3 text-sm">
          <Note tone="ok">Invitation envoyée à <strong>{email}</strong>. Elle est valable 14 jours.</Note>
          <p className="text-muted-foreground">Si l'email tarde, transmettez ce lien vous-même :</p>
          <CopyField value={link} label="Lien d'invitation" />
        </div>
      ) : (
        <form id="invite-form" onSubmit={send} className="space-y-3">
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Rôle">
            <Select value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
              <option value="member">{ROLE_LABEL.member}</option>
              <option value="manager">{ROLE_LABEL.manager}</option>
              {isAdmin && <option value="admin">{ROLE_LABEL.admin}</option>}
            </Select>
          </Field>
          <ErrorNote error={error} />
        </form>
      )}
    </Modal>
  )
}

function TeamDialog({ team, people, onClose, onSaved }: { team: TeamRow | 'new' | null; people: Member[]; onClose: () => void; onSaved: () => void }) {
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
    try { await api.del(`/team/teams/${team.id}`); toast('Équipe supprimée'); onSaved(); onClose() } catch (err) { setError(err) }
  }
  return (
    <Modal open={Boolean(team)} onClose={onClose} title={team === 'new' ? 'Nouvelle équipe' : 'Modifier l\'équipe'}
      footer={<>
        {team && team !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>Supprimer</Button>}
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" type="submit" form="team-form" disabled={busy || !name.trim()}>Enregistrer</Button>
      </>}>
      <form id="team-form" onSubmit={save} className="space-y-3">
        <Field label="Nom"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></Field>
        <Field label="Couleur"><ColorChoice value={color} onChange={setColor} /></Field>
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">Membres</span>
          <PeoplePicker people={people} value={ids} onChange={setIds} placeholder="Ajouter une personne…" />
        </div>
        <ErrorNote error={error} />
      </form>
      <Confirm open={removing} onClose={() => setRemoving(false)} title="Supprimer l'équipe ?" danger confirmLabel="Supprimer" onConfirm={remove}>
        Les personnes restent dans l'entreprise ; seul le regroupement disparaît.
      </Confirm>
    </Modal>
  )
}
