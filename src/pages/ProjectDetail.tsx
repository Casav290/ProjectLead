import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Board from '../components/project/Board'
import Gantt from '../components/project/Gantt'
import ListView from '../components/project/ListView'
import ProjectCalendar from '../components/project/ProjectCalendar'
import TaskDrawer from '../components/project/TaskDrawer'
import { Button, ColorDot, Confirm, ErrorNote, Field, HealthBadge, Input, Modal, Spinner, StatusBadge, Tabs, toast } from '../components/ui'
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

const TABS = [
  { id: '', label: "Vue d'ensemble" }, { id: 'tableau', label: 'Tableau' }, { id: 'liste', label: 'Liste' },
  { id: 'gantt', label: 'Gantt' }, { id: 'calendrier', label: 'Calendrier' }, { id: 'etapes', label: 'Étapes' },
  { id: 'temps', label: 'Temps' }, { id: 'fichiers', label: 'Fichiers' }, { id: 'activite', label: 'Activité' },
  { id: 'emails', label: 'Emails' }, { id: 'suivi', label: 'Suivi client' }, { id: 'reglages', label: 'Réglages' },
]

/** Le nom du projet, modifiable d'un clic. */
function EditableName({ project, onSaved }: { project: Project; onSaved: () => void }) {
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
      <Input autoFocus value={name} aria-label="Nom du projet" className="font-display text-2xl font-extrabold sm:text-3xl"
        onChange={(e) => setName(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(project.name); setEditing(false) } }} />
    )
  }
  return (
    <h1 className="font-display text-2xl sm:text-3xl [overflow-wrap:anywhere]">
      <button type="button" className="text-left hover:bg-muted" title="Renommer" onClick={() => setEditing(true)}>{project.name}</button>
    </h1>
  )
}

/** Le statut, sous forme d'étiquette qui ouvre la liste au clic. */
function StatusPicker({ project, onSaved }: { project: Project; onSaved: () => void }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center" title="Changer le statut">
      <StatusBadge status={project.status} />
      <span className="ml-0.5 text-[10px] text-muted-foreground" aria-hidden="true">▾</span>
      <select aria-label="Statut du projet" className="absolute inset-0 cursor-pointer opacity-0" value={project.status}
        onChange={async (e) => {
          try { await api.patch(`/projects/${project.id}`, { status: e.target.value }); onSaved() } catch (err) { toast(errorText(err)) }
        }}>
        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  )
}

function DuplicateDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [asTemplate, setAsTemplate] = useState(false)
  const [name, setName] = useState('')
  const [start, setStart] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (open) { setAsTemplate(project.is_template); setName(`${project.name} (copie)`); setStart(today()); setError(null) }
  }, [open, project])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await api.post<{ id: string }>(`/projects/${project.id}/duplicate`, { name: name.trim(), as_template: asTemplate, start_date: asTemplate ? null : start || null })
      onClose()
      toast(asTemplate ? 'Modèle créé.' : 'Projet dupliqué.')
      nav(`/projets/${r.id}`)
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Dupliquer le projet"
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" type="submit" form="dup" disabled={busy || !name.trim()}>Dupliquer</Button></>}>
      <form id="dup" onSubmit={submit} className="space-y-4">
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">En faire</legend>
          {[{ v: false, l: 'Un nouveau projet', d: 'Même client, mêmes étapes et tâches, dates recalées sur le début choisi.' },
            { v: true, l: 'Un modèle', d: 'Sans client ; réutilisable pour chaque projet du même genre.' }].map((o) => (
            <label key={String(o.v)} className={`flex cursor-pointer gap-2 border p-3 text-sm ${asTemplate === o.v ? 'border-accent bg-accent-veil' : 'border-input'}`}>
              <input type="radio" name="kind" className="mt-0.5 accent-[hsl(var(--accent))]" checked={asTemplate === o.v} onChange={() => setAsTemplate(o.v)} />
              <span><b className="block">{o.l}</b><span className="text-muted-foreground">{o.d}</span></span>
            </label>
          ))}
        </fieldset>
        <Field label="Nom"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!asTemplate && <Field label="Début du nouveau projet"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  )
}

/** La fiche d'un projet : en-tête, onglets en sous-routes, fiche de tâche en panneau (`?tache=`). */
export default function ProjectDetail() {
  const { id = '', '*': rest = '' } = useParams()
  const tab = rest.split('/')[0]
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { me, refresh } = useApp()
  const { data: project, error, reload } = useLoad<Project>(`/projects/${id}`)
  const [dup, setDup] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const taskId = params.get('tache')

  if (error && !project) return <div className="space-y-3"><ErrorNote error={error} /><Link className="text-sm font-semibold text-accent" to="/projets">← Projets</Link></div>
  if (!project || project.id !== id) return <Spinner />

  const base = `/projets/${id}`
  const closeTask = () => { const n = new URLSearchParams(params); n.delete('tache'); setParams(n, { replace: true }) }
  const running = me?.running?.project_id === project.id
  const startTimer = async () => {
    try { await api.post('/time/timer/start', { project_id: project.id }); await refresh(); toast('Chronomètre lancé.') } catch (e) { toast(errorText(e)) }
  }
  const archive = async () => {
    try {
      await api.del(`/projects/${project.id}`)
      if (project.is_template) { toast('Modèle supprimé.'); nav('/modeles') }
      else { toast(project.archived_at ? 'Projet ressorti des archives.' : 'Projet archivé.'); reload() }
    } catch (e) { toast(errorText(e)) }
  }
  const props = { project, onChanged: reload }

  return (
    <>
      <div className="mb-4">
        <Link to={project.is_template ? '/modeles' : '/projets'} className="mb-1 inline-block text-xs font-semibold text-muted-foreground hover:text-foreground">
          ← {project.is_template ? 'Modèles' : 'Projets'}</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[18rem]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <ColorDot color={project.color} className="h-3 w-3" />
              {project.code && <span className="font-mono">{project.code}</span>}
              {project.is_template && <span className="font-bold uppercase tracking-wide text-accent-dark">Modèle</span>}
              {project.client && <Link to={`/clients/${project.client.id}`} className="font-semibold text-foreground hover:text-accent">{project.client.name}</Link>}
            </div>
            <EditableName project={project} onSaved={reload} />
            {!project.is_template && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusPicker project={project} onSaved={reload} />
                <HealthBadge health={project.health} />
                {project.archived_at && <span className="text-xs font-semibold text-muted-foreground">Archivé</span>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!project.is_template && (running
              ? <span className="inline-flex items-center gap-2 border border-accent bg-accent-veil px-3 py-2 text-[13px] font-bold text-accent-dark">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />Chronomètre en marche</span>
              : <Button onClick={startTimer}>Chronomètre</Button>)}
            <Button onClick={() => setDup(true)}>{project.is_template ? 'Dupliquer' : <><span className="sm:hidden">Dupliquer</span><span className="hidden sm:inline">Dupliquer / en faire un modèle</span></>}</Button>
            <Button variant={project.is_template ? 'danger' : 'outline'} onClick={() => setArchiving(true)}>
              {project.is_template ? 'Supprimer' : project.archived_at ? 'Désarchiver' : 'Archiver'}</Button>
          </div>
        </div>
      </div>

      <Tabs active={tab} tabs={TABS.map((t) => ({ ...t, to: t.id ? `${base}/${t.id}` : base }))} />

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
      {!TABS.some((t) => t.id === tab) && <p className="text-sm text-muted-foreground">Onglet inconnu. <Link className="text-accent" to={base}>Revenir à la vue d’ensemble</Link></p>}

      <TaskDrawer taskId={taskId} onClose={closeTask} onChanged={reload} />
      <DuplicateDialog project={project} open={dup} onClose={() => setDup(false)} />
      <Confirm open={archiving} onClose={() => setArchiving(false)} onConfirm={archive} danger={project.is_template}
        title={project.is_template ? 'Supprimer le modèle ?' : project.archived_at ? 'Désarchiver le projet ?' : 'Archiver le projet ?'}
        confirmLabel={project.is_template ? 'Supprimer' : project.archived_at ? 'Désarchiver' : 'Archiver'}>
        {project.is_template ? 'Le modèle disparaît pour de bon ; les projets déjà créés avec lui ne changent pas.'
          : project.archived_at ? 'Le projet revient dans le portefeuille.'
          : 'Le projet quitte le portefeuille et sa page de suivi se ferme. Rien n’est effacé : il reste visible avec le filtre « Archivés ».'}
      </Confirm>
    </>
  )
}
