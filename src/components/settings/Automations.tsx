import clsx from 'clsx'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Checkbox, Confirm, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { PRIORITY_LABEL } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { Member, ProjectDetail } from '../../lib/types'
import { ReadOnlyNote, SettingsHeader, useRole } from './kit'

type Trigger = 'task_completed' | 'task_moved' | 'stage_completed' | 'task_created' | 'project_completed'
type Action = 'notify' | 'assign' | 'set_priority' | 'move_column' | 'complete_stage' | 'send_client_update' | 'create_task'
type Params = { to?: 'owner' | 'members' | 'assignees'; message?: string; user_id?: string; priority?: string; column_name?: string
  title?: string; due_in_days?: number | null }
type Conditions = { column_id?: string; stage_id?: string }
type Automation = { id: string; name: string; project_id: string | null; project_name: string | null; trigger: Trigger
  conditions: Conditions; action: Action; params: Params; active: boolean; runs: number }

const TRIGGERS: Record<Trigger, string> = {
  task_completed: 'une tâche est terminée', task_moved: 'une tâche est déplacée', stage_completed: 'une étape est terminée',
  task_created: 'une tâche est créée', project_completed: 'le projet est terminé',
}
const ACTIONS: Record<Action, string> = {
  notify: 'prévenir', assign: 'assigner la tâche', set_priority: 'changer la priorité', move_column: 'déplacer la tâche dans la colonne',
  complete_stage: 'terminer l\'étape si toutes ses tâches le sont', send_client_update: 'envoyer le suivi au client', create_task: 'créer une tâche',
}
const TO: Record<NonNullable<Params['to']>, string> = { owner: 'le chef de projet', members: 'les intervenants', assignees: 'les personnes assignées' }
/** Les actions qui portent sur une tâche n'ont pas de sens quand l'événement n'en a pas. */
const TASK_ACTIONS: Action[] = ['assign', 'set_priority', 'move_column']
const hasTask = (t: Trigger) => t.startsWith('task_')

function sentence(a: Pick<Automation, 'trigger' | 'action' | 'params' | 'project_name'>, team: Member[], columnName?: string) {
  const where = a.project_name ? ` dans « ${a.project_name} »` : ''
  const when = `Quand ${TRIGGERS[a.trigger]}${columnName ? ` vers « ${columnName} »` : ''}${where}`
  const p = a.params
  let then: string = ACTIONS[a.action]
  if (a.action === 'notify') then = `prévenir ${p.to ? TO[p.to] : 'l\'équipe'}`
  if (a.action === 'assign') then = `assigner la tâche à ${team.find((m) => m.id === p.user_id)?.name ?? '…'}`
  if (a.action === 'set_priority') then = `passer la tâche en priorité ${(PRIORITY_LABEL[p.priority ?? ''] ?? '…').toLowerCase()}`
  if (a.action === 'move_column') then = `déplacer la tâche dans « ${p.column_name || '…'} »`
  if (a.action === 'create_task') then = `créer la tâche « ${p.title || '…'} »${p.due_in_days != null ? `, à faire dans ${p.due_in_days} jour${p.due_in_days > 1 ? 's' : ''}` : ''}`
  return { when, then }
}

export default function Automations() {
  const { team } = useApp()
  const { canManage } = useRole()
  const { data, error, loading, reload } = useLoad<Automation[]>('/automations')
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)

  const toggle = async (a: Automation) => {
    try { await api.patch(`/automations/${a.id}`, { active: !a.active }); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title="Automatisations" action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>Nouvelle automatisation</Button>}>
        Des règles « quand … alors … » qui font le travail répétitif à votre place. Une règle sans projet vaut pour tous les projets ;
        une règle ne déclenche jamais une autre règle.
      </SettingsHeader>
      {!canManage && <ReadOnlyNote />}
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : data!.length === 0 ? (
        <Empty title="Aucune automatisation" action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>Créer la première</Button>}>
          Par exemple : quand une tâche est terminée, terminer l'étape si toutes ses tâches le sont.
        </Empty>
      ) : (
        <ul className="max-w-3xl space-y-3">
          {data!.map((a) => {
            const s = sentence(a, team)
            return (
              <li key={a.id}>
                <Card className={clsx(!a.active && 'opacity-70')}>
                  <div className="flex flex-wrap items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold break-words">{a.name}</p>
                      <p className="mt-1 text-sm">
                        <span className="font-semibold text-accent-dark">{s.when}</span>{a.conditions?.column_id && ' (colonne choisie)'}, alors {s.then}.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {a.runs ? `Exécutée ${a.runs} fois` : 'Pas encore exécutée'}{!a.active && ' · en pause'}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <Checkbox label="Active" checked={a.active} onChange={() => toggle(a)} className="text-xs" />
                        <Button size="sm" onClick={() => setEditing(a)}>Modifier</Button>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <AutomationDialog automation={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}

type Draft = { name: string; project_id: string; trigger: Trigger; column_id: string; stage_id: string; action: Action; params: Params; active: boolean }
const blank = (): Draft => ({ name: '', project_id: '', trigger: 'task_completed', column_id: '', stage_id: '', action: 'notify',
  params: { to: 'owner', message: '' }, active: true })

function AutomationDialog({ automation, onClose, onSaved }: { automation: Automation | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { team } = useApp()
  const open = Boolean(automation)
  const { data: projects } = useLoad<{ id: string; name: string }[]>(open ? '/projects' : null, [open])
  const [d, setD] = useState<Draft>(blank)
  const { data: loaded } = useLoad<ProjectDetail>(open && d.project_id ? `/projects/${d.project_id}` : null, [d.project_id])
  // Sans projet choisi, le dernier projet chargé ne compte plus.
  const project = d.project_id && loaded?.id === d.project_id ? loaded : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (!automation) return
    setD(automation === 'new' ? blank() : {
      name: automation.name, project_id: automation.project_id ?? '', trigger: automation.trigger, column_id: automation.conditions?.column_id ?? '',
      stage_id: automation.conditions?.stage_id ?? '', action: automation.action, params: automation.params ?? {}, active: automation.active,
    })
    setError(null)
  }, [automation])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setParam = <K extends keyof Params>(k: K, v: Params[K]) => setD((x) => ({ ...x, params: { ...x.params, [k]: v } }))
  const setAction = (action: Action) => setD((x) => ({ ...x, action,
    params: action === 'notify' ? { to: 'owner', message: '' } : action === 'set_priority' ? { priority: 'high' }
      : action === 'create_task' ? { title: '', due_in_days: 3 } : {} }))

  const actions = (Object.keys(ACTIONS) as Action[]).filter((a) => hasTask(d.trigger) || !TASK_ACTIONS.includes(a))
  const projectName = projects?.find((p) => p.id === d.project_id)?.name ?? null
  const columnName = d.trigger === 'task_moved' ? project?.columns.find((c) => c.id === d.column_id)?.name : undefined
  const s = sentence({ trigger: d.trigger, action: d.action, params: d.params, project_name: projectName }, team, columnName)

  const missing = (d.action === 'assign' && !d.params.user_id) || (d.action === 'move_column' && !d.params.column_name?.trim())
    || (d.action === 'create_task' && !d.params.title?.trim())

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const conditions: Conditions = {}
    if (d.project_id && d.trigger === 'task_moved' && d.column_id) conditions.column_id = d.column_id
    if (d.project_id && d.stage_id && d.trigger !== 'project_completed') conditions.stage_id = d.stage_id
    const params: Params = { ...d.params }
    if (params.message !== undefined) params.message = params.message.trim()
    const body = { name: d.name.trim() || `${s.when}, alors ${s.then}`.slice(0, 120), project_id: d.project_id || null, trigger: d.trigger,
                   conditions, action: d.action, params, active: d.active }
    try {
      if (automation === 'new') await api.post('/automations', body)
      else if (automation) await api.patch(`/automations/${automation.id}`, body)
      toast('Automatisation enregistrée'); onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!automation || automation === 'new') return
    try { await api.del(`/automations/${automation.id}`); toast('Automatisation supprimée'); onSaved(); onClose() } catch (err) { setError(err) }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={automation === 'new' ? 'Nouvelle automatisation' : 'Modifier l\'automatisation'}
      footer={<>
        {automation && automation !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>Supprimer</Button>}
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" type="submit" form="automation-form" disabled={busy || missing}>Enregistrer</Button>
      </>}>
      <form id="automation-form" onSubmit={save} className="space-y-5">
        <fieldset className="space-y-3 border-l-[3px] border-accent pl-4">
          <legend className="mb-2 text-sm font-extrabold uppercase tracking-[.06em] text-accent-dark">Quand</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Événement">
              <Select value={d.trigger} onChange={(e) => {
                const t = e.target.value as Trigger
                setD((x) => ({ ...x, trigger: t, column_id: '', ...(!hasTask(t) && TASK_ACTIONS.includes(x.action) ? { action: 'notify' as Action, params: { to: 'owner' as const, message: '' } } : {}) }))
              }}>
                {(Object.keys(TRIGGERS) as Trigger[]).map((t) => <option key={t} value={t}>{TRIGGERS[t][0].toUpperCase() + TRIGGERS[t].slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Projet" hint="Facultatif : sinon, tous les projets.">
              <Select value={d.project_id} onChange={(e) => setD((x) => ({ ...x, project_id: e.target.value, column_id: '', stage_id: '' }))}>
                <option value="">Tous les projets</option>
                {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            {d.trigger === 'task_moved' && (
              <Field label="Vers la colonne" hint={d.project_id ? undefined : 'Choisissez un projet pour filtrer par colonne.'}>
                <Select value={d.column_id} disabled={!project} onChange={(e) => set('column_id', e.target.value)}>
                  <option value="">N'importe quelle colonne</option>
                  {project?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            {d.project_id && d.trigger !== 'project_completed' && (project?.stages.length ?? 0) > 0 && (
              <Field label="Dans l'étape">
                <Select value={d.stage_id} onChange={(e) => set('stage_id', e.target.value)}>
                  <option value="">N'importe quelle étape</option>
                  {project!.stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-3 border-l-[3px] border-won pl-4">
          <legend className="mb-2 text-sm font-extrabold uppercase tracking-[.06em] text-won">Alors</legend>
          <Field label="Action">
            <Select value={d.action} onChange={(e) => setAction(e.target.value as Action)}>
              {actions.map((a) => <option key={a} value={a}>{ACTIONS[a][0].toUpperCase() + ACTIONS[a].slice(1)}</option>)}
            </Select>
          </Field>
          {d.action === 'notify' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Qui prévenir">
                <Select value={d.params.to ?? 'owner'} onChange={(e) => setParam('to', e.target.value as Params['to'])}>
                  {(Object.keys(TO) as NonNullable<Params['to']>[]).filter((k) => k !== 'assignees' || hasTask(d.trigger))
                    .map((k) => <option key={k} value={k}>{TO[k][0].toUpperCase() + TO[k].slice(1)}</option>)}
                </Select>
              </Field>
              <Field label="Message" hint="Facultatif : sinon, le nom de la règle et de la tâche.">
                <Input value={d.params.message ?? ''} onChange={(e) => setParam('message', e.target.value)} maxLength={300} />
              </Field>
            </div>
          )}
          {d.action === 'assign' && (
            <Field label="Assigner à">
              <Select value={d.params.user_id ?? ''} onChange={(e) => setParam('user_id', e.target.value)}>
                <option value="">Choisir une personne…</option>
                {team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          )}
          {d.action === 'set_priority' && (
            <Field label="Nouvelle priorité">
              <Select value={d.params.priority ?? 'high'} onChange={(e) => setParam('priority', e.target.value)}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          )}
          {d.action === 'move_column' && (
            <Field label="Nom de la colonne" hint="Le nom exact, sans tenir compte des majuscules. Sans colonne de ce nom, rien ne bouge.">
              <Input value={d.params.column_name ?? ''} onChange={(e) => setParam('column_name', e.target.value)} maxLength={100}
                list="automation-columns" placeholder="À valider" />
              {project && <datalist id="automation-columns">{project.columns.map((c) => <option key={c.id} value={c.name} />)}</datalist>}
            </Field>
          )}
          {d.action === 'send_client_update' && (
            <Field label="Mot d'accompagnement" hint="Facultatif. Le suivi part aux contacts du client qui le reçoivent.">
              <Textarea rows={2} value={d.params.message ?? ''} onChange={(e) => setParam('message', e.target.value)} maxLength={2000} />
            </Field>
          )}
          {d.action === 'create_task' && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
              <Field label="Titre de la tâche"><Input value={d.params.title ?? ''} onChange={(e) => setParam('title', e.target.value)} maxLength={500} /></Field>
              <Field label="Échéance dans (jours)" hint="Vide : sans échéance.">
                <Input inputMode="numeric" value={d.params.due_in_days ?? ''}
                  onChange={(e) => setParam('due_in_days', e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')))} />
              </Field>
            </div>
          )}
        </fieldset>

        <p className="bg-muted px-3 py-2 text-sm"><strong>{s.when}</strong>, alors {s.then}.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom de la règle" hint="Facultatif : la phrase ci-dessus sinon.">
            <Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
          </Field>
          <div className="flex items-end pb-2"><Checkbox label="Active" checked={d.active} onChange={(v) => set('active', v)} /></div>
        </div>
        <ErrorNote error={error} />
      </form>
      <Confirm open={removing} onClose={() => setRemoving(false)} title="Supprimer cette automatisation ?" danger confirmLabel="Supprimer" onConfirm={remove}>
        La règle cesse de s'appliquer. Pour la suspendre, désactivez-la plutôt.
      </Confirm>
    </Modal>
  )
}
