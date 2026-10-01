import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import NewProjectDialog from '../components/project/NewProjectDialog'
import { Button, ColorDot, Confirm, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, toast } from '../components/ui'
import { api, errorText } from '../lib/api'
import { BILLING_LABEL, fmtDate } from '../lib/format'
import { useLoad } from '../lib/store'
import type { ProjectSummary } from '../lib/types'

/** Les modèles de projet : une structure (étapes, colonnes, tâches) à reprendre pour chaque nouveau projet. */
export default function Templates() {
  const nav = useNavigate()
  const { data, error, reload } = useLoad<ProjectSummary[]>('/projects?template=1')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [using, setUsing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ProjectSummary | null>(null)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api.post<{ id: string }>('/projects', { name: name.trim(), is_template: true, status: 'planned' })
      setCreating(false); setName('')
      nav(`/projets/${r.id}/etapes`)
    } catch (err) { toast(errorText(err)) } finally { setBusy(false) }
  }
  const remove = async (t: ProjectSummary) => {
    try { await api.del(`/projects/${t.id}`); toast('Modèle supprimé.'); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <PageHeader title="Modèles" subtitle="Un projet type, prêt à resservir : ses étapes, colonnes et tâches sont recopiées, dates recalées."
        actions={<Button variant="primary" onClick={() => setCreating(true)}>Nouveau modèle</Button>} />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : !data.length ? (
        <Empty title="Aucun modèle" action={<Button variant="primary" onClick={() => setCreating(true)}>Créer un modèle</Button>}>
          Créez-en un de zéro, ou ouvrez un projet réussi et choisissez « Dupliquer / en faire un modèle ».</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((t) => (
            <article key={t.id} className="flex min-w-0 flex-col border border-border bg-card">
              <div className="flex-1 p-4">
                <div className="flex items-start gap-2">
                  <ColorDot color={t.color} className="mt-1.5 h-3 w-3" />
                  <h2 className="min-w-0 text-base font-bold tracking-normal [overflow-wrap:anywhere]">
                    <Link to={`/projets/${t.id}`} className="hover:text-accent">{t.name}</Link></h2>
                </div>
                {t.description && <p className="clamp-2 mt-1 text-sm text-muted-foreground">{t.description}</p>}
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[['Étapes', t.stages_total], ['Tâches', t.tasks_total], ['Facturation', BILLING_LABEL[t.billing_mode]]].map(([k, v]) => (
                    <div key={k} className="bg-head px-2 py-1.5">
                      <dt className="text-[10px] font-extrabold uppercase tracking-[.05em] text-muted-foreground">{k}</dt>
                      <dd className="truncate text-sm font-bold">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Modifié le {fmtDate(t.updated_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3">
                <Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={() => setUsing(t.id)}>Nouveau projet depuis ce modèle</Button>
                <Link to={`/projets/${t.id}`} className="text-xs font-bold text-accent hover:underline sm:ml-auto">Ouvrir</Link>
                <button className="ml-auto text-xs font-semibold text-muted-foreground hover:text-late sm:ml-0" onClick={() => setRemoving(t)}>Supprimer</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau modèle"
        footer={<><Button onClick={() => setCreating(false)}>Annuler</Button><Button variant="primary" type="submit" form="new-template" disabled={busy || !name.trim()}>Créer le modèle</Button></>}>
        <form id="new-template" onSubmit={create} className="space-y-2">
          <Field label="Nom du modèle"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Site vitrine, Rénovation de cuisine" /></Field>
          <p className="text-xs text-muted-foreground">Vous ajouterez ensuite ses étapes et ses tâches, comme pour un projet.</p>
        </form>
      </Modal>
      <NewProjectDialog open={Boolean(using)} templateId={using} onClose={() => setUsing(null)} />
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} danger confirmLabel="Supprimer"
        title={`Supprimer « ${removing?.name ?? ''} » ?`}>Le modèle disparaît pour de bon ; les projets déjà créés avec lui ne changent pas.</Confirm>
    </>
  )
}
