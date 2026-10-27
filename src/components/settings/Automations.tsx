import clsx from 'clsx'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Checkbox, Confirm, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { PRIORITY_LABEL } from '../../lib/format'
import { useApp, useLoad } from '../../lib/store'
import type { Member, ProjectDetail } from '../../lib/types'
import { ReadOnlyNote, SettingsHeader, useRole } from './kit'
import { labels, t, useT } from '../../i18n'

type Trigger = 'task_completed' | 'task_moved' | 'stage_completed' | 'task_created' | 'project_completed'
type Action = 'notify' | 'assign' | 'set_priority' | 'move_column' | 'complete_stage' | 'send_client_update' | 'create_task'
type Params = { to?: 'owner' | 'members' | 'assignees'; message?: string; user_id?: string; priority?: string; column_name?: string
  title?: string; due_in_days?: number | null }
type Conditions = { column_id?: string; stage_id?: string }
type Automation = { id: string; name: string; project_id: string | null; project_name: string | null; trigger: Trigger
  conditions: Conditions; action: Action; params: Params; active: boolean; runs: number }

const TRIGGER_KEYS: Trigger[] = ['task_completed', 'task_moved', 'stage_completed', 'task_created', 'project_completed']
const ACTION_KEYS: Action[] = ['notify', 'assign', 'set_priority', 'move_column', 'complete_stage', 'send_client_update', 'create_task']
const TO_KEYS: NonNullable<Params['to']>[] = ['owner', 'members', 'assignees']
/** Fragments de phrase (« quand … alors … ») et libellés des listes, qui suivent la langue. */
const TRIGGERS = labels('settings2.auto.trigger', TRIGGER_KEYS)
const TRIGGER_OPTIONS = labels('settings2.auto.triggerOption', TRIGGER_KEYS)
const ACTIONS = labels('settings2.auto.action', ACTION_KEYS)
const ACTION_OPTIONS = labels('settings2.auto.actionOption', ACTION_KEYS)
const TO = labels('settings2.auto.to', TO_KEYS)
const TO_OPTIONS = labels('settings2.auto.toOption', TO_KEYS)
/** Les actions qui portent sur une tâche n'ont pas de sens quand l'événement n'en a pas. */
const TASK_ACTIONS: Action[] = ['assign', 'set_priority', 'move_column']
const hasTask = (tg: Trigger) => tg.startsWith('task_')

function sentence(a: Pick<Automation, 'trigger' | 'action' | 'params' | 'project_name'>, team: Member[], columnName?: string) {
  const where = a.project_name ? t('settings2.auto.whenProject', { name: a.project_name }) : ''
  const when = t('settings2.auto.when', { trigger: TRIGGERS[a.trigger], column: columnName ? t('settings2.auto.whenColumn', { name: columnName }) : '', project: where })
  const p = a.params
  let then: string = ACTIONS[a.action]
  if (a.action === 'notify') then = t('settings2.auto.then.notify', { to: p.to ? TO[p.to] : t('settings2.auto.toTeam') })
  if (a.action === 'assign') then = t('settings2.auto.then.assign', { name: team.find((m) => m.id === p.user_id)?.name ?? '…' })
  if (a.action === 'set_priority') then = t('settings2.auto.then.setPriority', { priority: (PRIORITY_LABEL[p.priority ?? ''] ?? '…').toLowerCase() })
  if (a.action === 'move_column') then = t('settings2.auto.then.moveColumn', { name: p.column_name || '…' })
  if (a.action === 'create_task') then = t('settings2.auto.then.createTask', { title: p.title || '…' }) + (p.due_in_days != null ? t('settings2.auto.then.createTaskDue', { n: p.due_in_days }) : '')
  return { when, then }
}

export default function Automations() {
  const t = useT()
  const { team } = useApp()
  const { canManage } = useRole()
  const { data, error, loading, reload } = useLoad<Automation[]>('/automations')
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)

  const toggle = async (a: Automation) => {
    try { await api.patch(`/automations/${a.id}`, { active: !a.active }); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title={t('settings2.auto.title')} action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>{t('settings2.auto.new')}</Button>}>
        {t('settings2.auto.intro')}
      </SettingsHeader>
      {!canManage && <ReadOnlyNote />}
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : data!.length === 0 ? (
        <Empty title={t('settings2.auto.emptyTitle')} action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>{t('settings2.auto.createFirst')}</Button>}>
          {t('settings2.auto.emptyText')}
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
                        <span className="font-semibold text-accent-dark">{s.when}</span>{a.conditions?.column_id && t('settings2.auto.columnChosen')}{t('settings2.auto.thenSuffix', { then: s.then })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {a.runs ? t('settings2.auto.runs', { n: a.runs }) : t('settings2.auto.notRun')}{!a.active && t('settings2.auto.paused')}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <Checkbox label={t('settings2.auto.active')} checked={a.active} onChange={() => toggle(a)} className="text-xs" />
                        <Button size="sm" onClick={() => setEditing(a)}>{t('common.edit')}</Button>
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
  const t = useT()
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

  const actions = ACTION_KEYS.filter((a) => hasTask(d.trigger) || !TASK_ACTIONS.includes(a))
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
    const body = { name: d.name.trim() || t('settings2.auto.ruleName', { when: s.when, then: s.then }).slice(0, 120), project_id: d.project_id || null, trigger: d.trigger,
                   conditions, action: d.action, params, active: d.active }
    try {
      if (automation === 'new') await api.post('/automations', body)
      else if (automation) await api.patch(`/automations/${automation.id}`, body)
      toast(t('settings2.auto.savedToast')); onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!automation || automation === 'new') return
    try { await api.del(`/automations/${automation.id}`); toast(t('settings2.auto.deletedToast')); onSaved(); onClose() } catch (err) { setError(err) }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={automation === 'new' ? t('settings2.auto.new') : t('settings2.auto.editTitle')}
      footer={<>
        {automation && automation !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>{t('common.delete')}</Button>}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="automation-form" disabled={busy || missing}>{t('common.save')}</Button>
      </>}>
      <form id="automation-form" onSubmit={save} className="space-y-5">
        <fieldset className="space-y-3 border-l-[3px] border-accent pl-4">
          <legend className="mb-2 text-sm font-extrabold uppercase tracking-[.06em] text-accent-dark">{t('settings2.auto.whenLegend')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings2.auto.event')}>
              <Select value={d.trigger} onChange={(e) => {
                const tg = e.target.value as Trigger
                setD((x) => ({ ...x, trigger: tg, column_id: '', ...(!hasTask(tg) && TASK_ACTIONS.includes(x.action) ? { action: 'notify' as Action, params: { to: 'owner' as const, message: '' } } : {}) }))
              }}>
                {TRIGGER_KEYS.map((tg) => <option key={tg} value={tg}>{TRIGGER_OPTIONS[tg]}</option>)}
              </Select>
            </Field>
            <Field label={t('settings2.auto.project')} hint={t('settings2.auto.projectHint')}>
              <Select value={d.project_id} onChange={(e) => setD((x) => ({ ...x, project_id: e.target.value, column_id: '', stage_id: '' }))}>
                <option value="">{t('settings2.auto.allProjects')}</option>
                {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            {d.trigger === 'task_moved' && (
              <Field label={t('settings2.auto.toColumn')} hint={d.project_id ? undefined : t('settings2.auto.toColumnHint')}>
                <Select value={d.column_id} disabled={!project} onChange={(e) => set('column_id', e.target.value)}>
                  <option value="">{t('settings2.auto.anyColumn')}</option>
                  {project?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            {d.project_id && d.trigger !== 'project_completed' && (project?.stages.length ?? 0) > 0 && (
              <Field label={t('settings2.auto.inStage')}>
                <Select value={d.stage_id} onChange={(e) => set('stage_id', e.target.value)}>
                  <option value="">{t('settings2.auto.anyStage')}</option>
                  {project!.stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-3 border-l-[3px] border-won pl-4">
          <legend className="mb-2 text-sm font-extrabold uppercase tracking-[.06em] text-won">{t('settings2.auto.thenLegend')}</legend>
          <Field label={t('settings2.auto.actionLabel')}>
            <Select value={d.action} onChange={(e) => setAction(e.target.value as Action)}>
              {actions.map((a) => <option key={a} value={a}>{ACTION_OPTIONS[a]}</option>)}
            </Select>
          </Field>
          {d.action === 'notify' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('settings2.auto.whoNotify')}>
                <Select value={d.params.to ?? 'owner'} onChange={(e) => setParam('to', e.target.value as Params['to'])}>
                  {TO_KEYS.filter((k) => k !== 'assignees' || hasTask(d.trigger))
                    .map((k) => <option key={k} value={k}>{TO_OPTIONS[k]}</option>)}
                </Select>
              </Field>
              <Field label={t('settings2.auto.message')} hint={t('settings2.auto.messageHint')}>
                <Input value={d.params.message ?? ''} onChange={(e) => setParam('message', e.target.value)} maxLength={300} />
              </Field>
            </div>
          )}
          {d.action === 'assign' && (
            <Field label={t('settings2.auto.assignTo')}>
              <Select value={d.params.user_id ?? ''} onChange={(e) => setParam('user_id', e.target.value)}>
                <option value="">{t('settings2.auto.choosePerson')}</option>
                {team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          )}
          {d.action === 'set_priority' && (
            <Field label={t('settings2.auto.newPriority')}>
              <Select value={d.params.priority ?? 'high'} onChange={(e) => setParam('priority', e.target.value)}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          )}
          {d.action === 'move_column' && (
            <Field label={t('settings2.auto.columnName')} hint={t('settings2.auto.columnNameHint')}>
              <Input value={d.params.column_name ?? ''} onChange={(e) => setParam('column_name', e.target.value)} maxLength={100}
                list="automation-columns" placeholder={t('settings2.auto.columnPlaceholder')} />
              {project && <datalist id="automation-columns">{project.columns.map((c) => <option key={c.id} value={c.name} />)}</datalist>}
            </Field>
          )}
          {d.action === 'send_client_update' && (
            <Field label={t('settings2.auto.coverNote')} hint={t('settings2.auto.coverNoteHint')}>
              <Textarea rows={2} value={d.params.message ?? ''} onChange={(e) => setParam('message', e.target.value)} maxLength={2000} />
            </Field>
          )}
          {d.action === 'create_task' && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
              <Field label={t('settings2.auto.taskTitle')}><Input value={d.params.title ?? ''} onChange={(e) => setParam('title', e.target.value)} maxLength={500} /></Field>
              <Field label={t('settings2.auto.dueIn')} hint={t('settings2.auto.dueInHint')}>
                <Input inputMode="numeric" value={d.params.due_in_days ?? ''}
                  onChange={(e) => setParam('due_in_days', e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')))} />
              </Field>
            </div>
          )}
        </fieldset>

        <p className="bg-muted px-3 py-2 text-sm"><strong>{s.when}</strong>{t('settings2.auto.thenSuffix', { then: s.then })}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings2.auto.ruleNameLabel')} hint={t('settings2.auto.ruleNameHint')}>
            <Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
          </Field>
          <div className="flex items-end pb-2"><Checkbox label={t('settings2.auto.active')} checked={d.active} onChange={(v) => set('active', v)} /></div>
        </div>
        <ErrorNote error={error} />
      </form>
      <Confirm open={removing} onClose={() => setRemoving(false)} title={t('settings2.auto.deleteTitle')} danger confirmLabel={t('common.delete')} onConfirm={remove}>
        {t('settings2.auto.deleteText')}
      </Confirm>
    </Modal>
  )
}
