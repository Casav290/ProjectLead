import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Board from '../components/project/Board'
import Gantt from '../components/project/Gantt'
import ListView from '../components/project/ListView'
import ProjectCalendar from '../components/project/ProjectCalendar'
import TaskDrawer from '../components/project/TaskDrawer'
import { Button, ColorDot, Confirm, ErrorNote, Field, HealthBadge, Input, Modal, Spinner, StatusBadge, Tabs, toast } from '../components/ui'
import { useT } from '../i18n'
import { api, errorText } from '../lib/api'
import { STATUS_LABEL, today } from '../lib/format'
import { useApp, useLoad } from '../lib/store'
import type { ProjectDetail as Project } from '../lib/types'
import Activity from './project/Activity'
import Emails from './project/Emails'
import Files from './project/Files'
import FollowUp from './project/FollowUp'
import Overview from './project/Overview'
import ProjectSettings from './project/ProjectSettings'
import Stages from './project/Stages'
import TimeTab from './project/TimeTab'

// Les libellés sont lus au rendu (t), pour suivre la langue.
const TABS = [
  { id: '', key: 'overview' }, { id: 'tableau', key: 'board' }, { id: 'liste', key: 'list' },
  { id: 'gantt', key: 'gantt' }, { id: 'calendrier', key: 'calendar' }, { id: 'etapes', key: 'stages' },
  { id: 'temps', key: 'time' }, { id: 'fichiers', key: 'files' }, { id: 'activite', key: 'activity' },
  { id: 'emails', key: 'emails' }, { id: 'suivi', key: 'followUp' }, { id: 'reglages', key: 'settings' },
]

/** Le nom du projet, modifiable d'un clic. */
function EditableName({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  useEffect(() => setName(project.name), [project.name])
  const save = async () => {
    setEditing(false)
    const n = name.trim()
    if (!n || n === project.name) { setName(project.name); return }
    try { await api.patch(`/projects/${project.id}`, { name: n }); onSaved() } catch (e) { toast(errorText(e)); setName(project.name) }
  }
  if (editing) {
    return (
      <Input autoFocus value={name} aria-label={t('project.header.nameAria')} className="font-display text-2xl font-extrabold sm:text-3xl"
        onChange={(e) => setName(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(project.name); setEditing(false) } }} />
    )
  }
  return (
    <h1 className="font-display text-2xl sm:text-3xl [overflow-wrap:anywhere]">
      <button type="button" className="text-left hover:bg-muted" title={t('project.header.rename')} onClick={() => setEditing(true)}>{project.name}</button>
    </h1>
  )
}

/** Le statut, sous forme d'étiquette qui ouvre la liste au clic. */
function StatusPicker({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const t = useT()
  return (
    <label className="relative inline-flex cursor-pointer items-center" title={t('project.header.changeStatus')}>
      <StatusBadge status={project.status} />
      <span className="ml-0.5 text-[10px] text-muted-foreground" aria-hidden="true">▾</span>
      <select aria-label={t('project.header.statusAria')} className="absolute inset-0 cursor-pointer opacity-0" value={project.status}
        onChange={async (e) => {
          try { await api.patch(`/projects/${project.id}`, { status: e.target.value }); onSaved() } catch (err) { toast(errorText(err)) }
        }}>
        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  )
}

function DuplicateDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const t = useT()
  const nav = useNavigate()
  const [asTemplate, setAsTemplate] = useState(false)
  const [name, setName] = useState('')
  const [start, setStart] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (open) { setAsTemplate(project.is_template); setName(t('project.dup.copyName', { name: project.name })); setStart(today()); setError(null) }
  }, [open, project]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api.post<{ id: string }>(`/projects/${project.id}/duplicate`, { name: name.trim(), as_template: asTemplate, start_date: asTemplate ? null : start || null })
      onClose()
      toast(asTemplate ? t('project.dup.templateCreated') : t('project.dup.duplicated'))
      nav(`/projets/${r.id}`)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('project.dup.title')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="dup" disabled={busy || !name.trim()}>{t('project.dup.submit')}</Button></>}>
      <form id="dup" onSubmit={submit} className="space-y-4">
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{t('project.dup.makeA')}</legend>
          {[{ v: false, l: t('project.dup.newProject'), d: t('project.dup.newProjectHint') },
            { v: true, l: t('project.dup.template'), d: t('project.dup.templateHint') }].map((o) => (
            <label key={String(o.v)} className={`flex cursor-pointer gap-2 border p-3 text-sm ${asTemplate === o.v ? 'border-accent bg-accent-veil' : 'border-input'}`}>
              <input type="radio" name="kind" className="mt-0.5 accent-[hsl(var(--accent))]" checked={asTemplate === o.v} onChange={() => setAsTemplate(o.v)} />
              <span><b className="block">{o.l}</b><span className="text-muted-foreground">{o.d}</span></span>
            </label>
          ))}
        </fieldset>
        <Field label={t('project.dup.name')}><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!asTemplate && <Field label={t('project.dup.start')}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}

/** La fiche d'un projet : en-tête, onglets en sous-routes, fiche de tâche en panneau (`?tache=`). */
export default function ProjectDetail() {
  const t = useT()
  const { id = '', '*': rest = '' } = useParams()
  const tab = rest.split('/')[0]
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { me, refresh } = useApp()
  const { data: project, error, reload } = useLoad<Project>(`/projects/${id}`)
  const [dup, setDup] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const taskId = params.get('tache')

  if (error && !project) return <div className="space-y-3"><ErrorNote error={error} /><Link className="text-sm font-semibold text-accent" to="/projets">← {t('project.header.projects')}</Link></div>
  if (!project || project.id !== id) return <Spinner />

  const base = `/projets/${id}`
  const closeTask = () => { const n = new URLSearchParams(params); n.delete('tache'); setParams(n, { replace: true }) }
  const running = me?.running?.project_id === project.id
  const startTimer = async () => {
    try { await api.post('/time/timer/start', { project_id: project.id }); await refresh(); toast(t('project.header.timerStarted')) } catch (e) { toast(errorText(e)) }
  }
  const archive = async () => {
    try {
      await api.del(`/projects/${project.id}`)
      if (project.is_template) { toast(t('project.header.templateDeleted')); nav('/modeles') }
      else { toast(project.archived_at ? t('project.header.unarchived') : t('project.header.archived')); reload() }
    } catch (e) { toast(errorText(e)) }
  }
  const props = { project, onChanged: reload }

  return (
    <>
      <div className="mb-4">
        <Link to={project.is_template ? '/modeles' : '/projets'} className="mb-1 inline-block text-xs font-semibold text-muted-foreground hover:text-foreground">
          ← {project.is_template ? t('project.header.templates') : t('project.header.projects')}</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[18rem]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <ColorDot color={project.color} className="h-3 w-3" />
              {project.code && <span className="font-mono">{project.code}</span>}
              {project.is_template && <span className="font-bold uppercase tracking-wide text-accent-dark">{t('project.header.template')}</span>}
              {project.client && <Link to={`/clients/${project.client.id}`} className="font-semibold text-foreground hover:text-accent">{project.client.name}</Link>}
            </div>
            <EditableName project={project} onSaved={reload} />
            {!project.is_template && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusPicker project={project} onSaved={reload} />
                <HealthBadge health={project.health} />
                {project.archived_at && <span className="text-xs font-semibold text-muted-foreground">{t('project.header.archivedBadge')}</span>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!project.is_template && (running
              ? <span className="inline-flex items-center gap-2 border border-accent bg-accent-veil px-3 py-2 text-[13px] font-bold text-accent-dark">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />{t('project.header.timerRunning')}</span>
              : <Button onClick={startTimer}>{t('project.header.timer')}</Button>)}
            <Button onClick={() => setDup(true)}>{project.is_template ? t('project.dup.submit') : <><span className="sm:hidden">{t('project.dup.submit')}</span><span className="hidden sm:inline">{t('project.header.duplicateOrTemplate')}</span></>}</Button>
            <Button variant={project.is_template ? 'danger' : 'outline'} onClick={() => setArchiving(true)}>
              {project.is_template ? t('common.delete') : project.archived_at ? t('project.header.unarchive') : t('project.header.archive')}</Button>
          </div>
        </div>
      </div>

      <Tabs active={tab} tabs={TABS.map((x) => ({ id: x.id, label: t(`project.tabs.${x.key}`), to: x.id ? `${base}/${x.id}` : base }))} />

      {tab === '' && <Overview {...props} />}
      {tab === 'tableau' && <Board {...props} />}
      {tab === 'liste' && <ListView {...props} />}
      {tab === 'gantt' && <Gantt {...props} />}
      {tab === 'calendrier' && <ProjectCalendar {...props} />}
      {tab === 'etapes' && <Stages {...props} />}
      {tab === 'temps' && <TimeTab {...props} />}
      {tab === 'fichiers' && <Files {...props} />}
      {tab === 'activite' && <Activity {...props} />}
      {tab === 'emails' && <Emails {...props} />}
      {tab === 'suivi' && <FollowUp {...props} />}
      {tab === 'reglages' && <ProjectSettings {...props} />}
      {!TABS.some((x) => x.id === tab) && <p className="text-sm text-muted-foreground">{t('project.tabs.unknown')} <Link className="text-accent" to={base}>{t('project.tabs.backToOverview')}</Link></p>}

      <TaskDrawer taskId={taskId} onClose={closeTask} onChanged={reload} />
      <DuplicateDialog project={project} open={dup} onClose={() => setDup(false)} />
      <Confirm open={archiving} onClose={() => setArchiving(false)} onConfirm={archive} danger={project.is_template}
        title={project.is_template ? t('project.header.deleteTemplateAsk') : project.archived_at ? t('project.header.unarchiveAsk') : t('project.header.archiveAsk')}
        confirmLabel={project.is_template ? t('common.delete') : project.archived_at ? t('project.header.unarchive') : t('project.header.archive')}>
        {project.is_template ? t('project.header.deleteTemplateText')
          : project.archived_at ? t('project.header.unarchiveText')
          : t('project.header.archiveText')}
      </Confirm>
    </>
  )
}
