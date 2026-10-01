import { useEffect, useState } from 'react'
import { Button, Card, Checkbox, Confirm, Field, Input, Select, toast } from '../../components/ui'
import { api, errorText } from '../../lib/api'
import { BILLING_LABEL, parseMoney } from '../../lib/format'
import { useApp } from '../../lib/store'
import type { Client, Column, ProjectDetail } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }

const COLORS = ['#8e2a6b', '#0f6e70', '#15803d', '#ca8a04', '#c2410c', '#b91c1c', '#be185d', '#7c3aed', '#0284c7', '#57534e']
const VAT: Record<string, string> = { normal: 'Taux normal', reduced: 'Taux réduit', lodging: 'Hébergement', exempt: 'Exonéré', export: 'Exportation' }
const amount = (c: number | null) => (c == null ? '' : String(c / 100))

type Draft = { name: string; code: string; color: string; client_id: string; owner_id: string; start_date: string; due_date: string
  budget_hours: string; budget: string; billing_mode: ProjectDetail['billing_mode']; hourly: string; retainer: string; fixed: string
  vat_code: string; currency: string; visibility: ProjectDetail['visibility'] }

const draftOf = (p: ProjectDetail): Draft => ({
  name: p.name, code: p.code ?? '', color: p.color, client_id: p.client_id ?? '', owner_id: p.owner_id ?? '', start_date: p.start_date ?? '',
  due_date: p.due_date ?? '', budget_hours: p.budget_minutes != null ? String(Math.round((p.budget_minutes / 60) * 100) / 100) : '', budget: amount(p.budget_cents),
  billing_mode: p.billing_mode, hourly: amount(p.hourly_rate_cents), retainer: amount(p.retainer_cents), fixed: amount(p.fixed_cents),
  vat_code: p.vat_code, currency: p.currency, visibility: p.visibility,
})

function GeneralForm({ project, onChanged }: Props) {
  const { team } = useApp()
  const [d, setD] = useState(() => draftOf(project))
  const [clients, setClients] = useState<Client[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setD(draftOf(project)), [project])
  useEffect(() => { api.get<Client[]>('/clients').then(setClients).catch(() => {}) }, [])
  const up = <K extends keyof Draft>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value as Draft[K] })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const money = (s: string, label: string) => {
      if (!s.trim()) return null
      const v = parseMoney(s)
      if (v === null) throw new Error(`${label} : montant illisible.`)
      return v
    }
    try {
      const h = d.budget_hours.trim() ? Number(d.budget_hours.replace(',', '.')) : null
      if (h !== null && !(h >= 0)) throw new Error('Budget en heures illisible.')
      setBusy(true)
      await api.patch(`/projects/${project.id}`, {
        name: d.name.trim(), code: d.code.trim() || null, color: d.color, client_id: d.client_id || null, owner_id: d.owner_id || null,
        start_date: d.start_date || null, due_date: d.due_date || null,
        budget_minutes: h === null ? null : Math.round(h * 60), budget_cents: money(d.budget, 'Budget'),
        billing_mode: d.billing_mode, hourly_rate_cents: money(d.hourly, 'Taux horaire'), retainer_cents: money(d.retainer, 'Forfait mensuel'),
        fixed_cents: money(d.fixed, 'Forfait global'), vat_code: d.vat_code, currency: d.currency, visibility: d.visibility,
      })
      toast('Réglages enregistrés.'); onChanged()
    } catch (err) { setError(err instanceof Error && !('status' in err) ? err.message : errorText(err)) } finally { setBusy(false) }
  }
  const cur = d.currency

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card title="Le projet">
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Nom" className="sm:col-span-2"><Input required value={d.name} onChange={up('name')} /></Field>
          <Field label="Code" hint="Repris dans l’objet des emails pour les rattacher au projet."><Input value={d.code} onChange={up('code')} className="font-mono" /></Field>
          <div className="min-w-0 space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">Couleur</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Couleur">
              {COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={d.color === c} aria-label={c} onClick={() => setD({ ...d, color: c })}
                  className={`h-7 w-7 border-2 ${d.color === c ? 'border-foreground' : 'border-transparent'}`} style={{ background: c }} />
              ))}
              <input type="color" value={d.color} onChange={up('color')} aria-label="Autre couleur" className="h-7 w-9 cursor-pointer border border-input bg-card p-0.5" />
            </div>
          </div>
          {!project.is_template && (
            <Field label="Client">
              <Select value={d.client_id} onChange={up('client_id')}>
                <option value="">Sans client (projet interne)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Responsable">
            <Select value={d.owner_id} onChange={up('owner_id')}>
              {team.filter((m) => m.active || m.id === d.owner_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Début"><Input type="date" value={d.start_date} onChange={up('start_date')} /></Field>
          <Field label="Échéance"><Input type="date" value={d.due_date} min={d.start_date || undefined} onChange={up('due_date')} /></Field>
          <Field label="Visibilité" className="sm:col-span-2">
            <Select value={d.visibility} onChange={up('visibility')}>
              <option value="account">Toute l’entreprise</option>
              <option value="members">Intervenants seulement</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Budget et facturation">
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Budget en heures"><Input inputMode="decimal" value={d.budget_hours} onChange={up('budget_hours')} placeholder="Ex. 80" /></Field>
          <Field label={`Budget en montant (${cur})`}><Input inputMode="decimal" value={d.budget} onChange={up('budget')} placeholder="Ex. 12000" /></Field>
          <Field label="Mode de facturation">
            <Select value={d.billing_mode} onChange={up('billing_mode')}>
              {(['hourly', 'retainer', 'fixed', 'milestone', 'none'] as const).map((b) => <option key={b} value={b}>{BILLING_LABEL[b]}</option>)}
            </Select>
          </Field>
          <Field label={`Taux horaire (${cur})`} hint={d.billing_mode === 'hourly' ? 'Un taux propre à un intervenant ou à la personne prime.' : 'Sert à valoriser le temps passé.'}>
            <Input inputMode="decimal" value={d.hourly} onChange={up('hourly')} placeholder="Ex. 120" />
          </Field>
          {d.billing_mode === 'retainer' && <Field label={`Forfait mensuel (${cur})`}><Input inputMode="decimal" value={d.retainer} onChange={up('retainer')} /></Field>}
          {d.billing_mode === 'fixed' && <Field label={`Forfait global (${cur})`}><Input inputMode="decimal" value={d.fixed} onChange={up('fixed')} /></Field>}
          {d.billing_mode === 'milestone' && <p className="self-end pb-2 text-xs text-muted-foreground">Le montant de chaque étape se règle dans l’onglet Étapes.</p>}
          <Field label="TVA">
            <Select value={d.vat_code} onChange={up('vat_code')}>{Object.entries(VAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          <Field label="Devise">
            <Select value={d.currency} onChange={up('currency')}>{['CHF', 'EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        </div>
      </Card>
      {error && <p role="alert" className="border-l-[3px] border-late bg-late/5 px-3 py-2 text-sm text-late">{error}</p>}
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={busy || !d.name.trim()}>Enregistrer les réglages</Button></div>
    </form>
  )
}

function ColumnRow({ col, index, count, onMove, onDelete, onSaved }:
  { col: Column; index: number; count: number; onMove: (dir: -1 | 1) => void; onDelete: () => void; onSaved: () => void }) {
  const [name, setName] = useState(col.name)
  const [wip, setWip] = useState(col.wip_limit ? String(col.wip_limit) : '')
  useEffect(() => { setName(col.name); setWip(col.wip_limit ? String(col.wip_limit) : '') }, [col])
  const patch = async (b: Partial<Column>) => {
    try { await api.patch(`/projects/columns/${col.id}`, b); onSaved() } catch (e) { toast(errorText(e)) }
  }
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 last:border-0">
      <span className="flex flex-col">
        <button type="button" className="px-1 text-[10px] leading-4 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Monter ${col.name}`}>▲</button>
        <button type="button" className="px-1 text-[10px] leading-4 text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Descendre ${col.name}`}>▼</button>
      </span>
      <Input value={name} aria-label="Nom de la colonne" className="w-auto min-w-0 flex-1 py-1.5 sm:max-w-xs"
        onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== col.name ? patch({ name: name.trim() }) : setName(col.name)} />
      <Checkbox label="Terminée" checked={col.is_done} onChange={(v) => patch({ is_done: v })} />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Limite
        <Input value={wip} inputMode="numeric" aria-label="Limite d’en-cours" placeholder="—" className="w-14 py-1.5 text-center"
          onChange={(e) => setWip(e.target.value.replace(/\D/g, ''))}
          onBlur={() => { const n = wip ? Number(wip) : null; if (n !== col.wip_limit) patch({ wip_limit: n && n > 0 ? n : null }) }} />
      </label>
      <button type="button" className="ml-auto text-xs font-semibold text-muted-foreground hover:text-late" onClick={onDelete} disabled={count <= 1}>Supprimer</button>
    </li>
  )
}

function Columns({ project, onChanged }: Props) {
  const [cols, setCols] = useState(project.columns)
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Column | null>(null)
  useEffect(() => setCols(project.columns), [project.columns])
  const move = async (i: number, dir: -1 | 1) => {
    const next = [...cols]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    setCols(next)
    try { await api.post(`/projects/${project.id}/columns/order`, { ids: next.map((c) => c.id) }); onChanged() } catch (e) { toast(errorText(e)); setCols(project.columns) }
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try { await api.post(`/projects/${project.id}/columns`, { name: name.trim() }); setName(''); onChanged() } catch (err) { toast(errorText(err)) }
  }
  const remove = async (c: Column) => {
    try { await api.del(`/projects/columns/${c.id}`); toast('Colonne supprimée.'); onChanged() } catch (e) { toast(errorText(e)) }
  }
  return (
    <Card title="Colonnes du tableau">
      <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        Une tâche posée dans une colonne « terminée » est cochée faite. La limite signale une colonne trop chargée.</p>
      <ul>{cols.map((c, i) => <ColumnRow key={c.id} col={c} index={i} count={cols.length} onMove={(d) => move(i, d)} onDelete={() => setRemoving(c)} onSaved={onChanged} />)}</ul>
      <form onSubmit={add} className="flex gap-2 border-t border-border px-4 py-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle colonne" aria-label="Nouvelle colonne" className="min-w-0 flex-1 py-1.5 sm:max-w-xs" />
        <Button size="sm" type="submit" disabled={!name.trim()}>Ajouter</Button>
      </form>
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} danger confirmLabel="Supprimer"
        title={`Supprimer la colonne « ${removing?.name ?? ''} » ?`}>Ses tâches passent dans la première colonne restante.</Confirm>
    </Card>
  )
}

/** Les réglages du projet : identité, dates, budget, facturation, visibilité, colonnes. */
export default function ProjectSettings(props: Props) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="min-w-0"><GeneralForm {...props} /></div>
      <div className="min-w-0"><Columns {...props} /></div>
    </div>
  )
}
