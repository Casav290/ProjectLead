import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import NewProjectDialog from '../components/project/NewProjectDialog'
import { Button, ColorDot, Confirm, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, toast } from '../components/ui'
import { useT } from '../i18n'
import { api, errorText } from '../lib/api'
import { BILLING_LABEL, fmtDate } from '../lib/format'
import { useLoad } from '../lib/store'
import type { ProjectSummary } from '../lib/types'

/** Les modèles de projet : une structure (étapes, colonnes, tâches) à reprendre pour chaque nouveau projet. */
export default function Templates() {
  const t = useT()
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
  const remove = async (tpl: ProjectSummary) => {
    try { await api.del(`/projects/${tpl.id}`); toast(t('home.templates.deleted')); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <PageHeader title={t('home.templates.title')} subtitle={t('home.templates.subtitle')}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>{t('home.templates.new')}</Button>} />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : !data.length ? (
        <Empty title={t('home.templates.emptyTitle')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('home.templates.createOne')}</Button>}>
          {t('home.templates.emptyBody')}</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((tpl) => (
            <article key={tpl.id} className="flex min-w-0 flex-col border border-border bg-card">
              <div className="flex-1 p-4">
                <div className="flex items-start gap-2">
                  <ColorDot color={tpl.color} className="mt-1.5 h-3 w-3" />
                  <h2 className="min-w-0 text-base font-bold tracking-normal [overflow-wrap:anywhere]">
                    <Link to={`/projets/${tpl.id}`} className="hover:text-accent">{tpl.name}</Link></h2>
                </div>
                {tpl.description && <p className="clamp-2 mt-1 text-sm text-muted-foreground">{tpl.description}</p>}
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[[t('home.templates.stages'), tpl.stages_total], [t('home.templates.tasks'), tpl.tasks_total], [t('home.templates.billing'), BILLING_LABEL[tpl.billing_mode]]].map(([k, v]) => (
                    <div key={k} className="bg-head px-2 py-1.5">
                      <dt className="text-[10px] font-extrabold uppercase tracking-[.05em] text-muted-foreground">{k}</dt>
                      <dd className="truncate text-sm font-bold">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">{t('home.templates.updatedOn', { date: fmtDate(tpl.updated_at) })}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3">
                <Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={() => setUsing(tpl.id)}>{t('home.templates.useTemplate')}</Button>
                <Link to={`/projets/${tpl.id}`} className="text-xs font-bold text-accent hover:underline sm:ml-auto">{t('home.templates.open')}</Link>
                <button className="ml-auto text-xs font-semibold text-muted-foreground hover:text-late sm:ml-0" onClick={() => setRemoving(tpl)}>{t('common.delete')}</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={t('home.templates.new')}
        footer={<><Button onClick={() => setCreating(false)}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="new-template" disabled={busy || !name.trim()}>{t('home.templates.create')}</Button></>}>
        <form id="new-template" onSubmit={create} className="space-y-2">
          <Field label={t('home.templates.name')}><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('home.templates.namePlaceholder')} /></Field>
          <p className="text-xs text-muted-foreground">{t('home.templates.nameHint')}</p>
        </form>
      </Modal>
      <NewProjectDialog open={Boolean(using)} templateId={using} onClose={() => setUsing(null)} />
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} danger confirmLabel={t('common.delete')}
        title={t('home.templates.deleteTitle', { name: removing?.name ?? '' })}>{t('home.templates.deleteBody')}</Confirm>
    </>
  )
}
