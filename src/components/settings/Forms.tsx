import { useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, Card, Checkbox, Confirm, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { useApp, useLoad } from '../../lib/store'
import { CopyField, ReadOnlyNote, SettingsHeader, slugify, SLUG_RE, origin, useRole } from './kit'
import { useT } from '../../i18n'

type IntakeForm = { id: string; slug: string; name: string; intro: string; template_id: string | null; template_name: string | null
  owner_id: string | null; active: boolean; received: number; url: string }
type Template = { id: string; name: string }

const publicLink = (f: Pick<IntakeForm, 'slug' | 'url'>) => (f.url?.startsWith('http') ? f.url : `${origin()}/demande/${f.slug}`)

/** Les formulaires de demande : chaque demande reçue ouvre un projet « à qualifier ». */
export default function Forms() {
  const t = useT()
  const { team } = useApp()
  const { canManage } = useRole()
  const { data, error, loading, reload } = useLoad<IntakeForm[]>('/forms')
  const [editing, setEditing] = useState<IntakeForm | 'new' | null>(null)

  const toggle = async (f: IntakeForm) => {
    try { await api.patch(`/forms/${f.id}`, { active: !f.active }); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title={t('settings2.forms.title')} action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>{t('settings2.forms.new')}</Button>}>
        {t('settings2.forms.intro')}
      </SettingsHeader>
      {!canManage && <ReadOnlyNote />}
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : data!.length === 0 ? (
        <Empty title={t('settings2.forms.emptyTitle')} action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>{t('settings2.shared.createFirst')}</Button>}>
          {t('settings2.forms.emptyText')}
        </Empty>
      ) : (
        <ul className="max-w-3xl space-y-3">
          {data!.map((f) => {
            const owner = team.find((m) => m.id === f.owner_id)
            return (
              <li key={f.id}>
                <Card>
                  <div className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-bold">
                          <span className="break-words">{f.name}</span>
                          {f.active ? <Badge tone="ok">{t('settings2.shared.active')}</Badge> : <Badge>{t('settings2.shared.disabled')}</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('settings2.forms.received', { n: f.received })}
                          {f.template_name && t('settings2.forms.templateOf', { name: f.template_name })}{owner && t('settings2.forms.ownerOf', { name: owner.name })}
                        </p>
                      </div>
                      {canManage && <>
                        <Button size="sm" variant="ghost" onClick={() => toggle(f)}>{f.active ? t('settings2.shared.disable') : t('settings2.shared.enable')}</Button>
                        <Button size="sm" onClick={() => setEditing(f)}>{t('common.edit')}</Button>
                      </>}
                    </div>
                    <CopyField value={publicLink(f)} label={t('settings2.shared.publicLinkOf', { name: f.name })} open />
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <FormDialog form={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}

function FormDialog({ form, onClose, onSaved }: { form: IntakeForm | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const { me, team } = useApp()
  const { data: templates } = useLoad<Template[]>(form ? '/projects?template=1' : null, [Boolean(form)])
  const [d, setD] = useState({ name: '', slug: '', intro: '', template_id: '', owner_id: '', active: true })
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    if (!form) return
    setD(form === 'new' ? { name: '', slug: '', intro: '', template_id: '', owner_id: me?.user.id ?? '', active: true }
      : { name: form.name, slug: form.slug, intro: form.intro, template_id: form.template_id ?? '', owner_id: form.owner_id ?? '', active: form.active })
    setSlugTouched(form !== 'new'); setError(null)
  }, [form, me?.user.id])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const body = { name: d.name.trim(), slug: d.slug, intro: d.intro, template_id: d.template_id || null, owner_id: d.owner_id || null, active: d.active }
    try {
      if (form === 'new') await api.post('/forms', body)
      else if (form) await api.patch(`/forms/${form.id}`, body)
      toast(t('settings2.forms.savedToast')); onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!form || form === 'new') return
    try { await api.del(`/forms/${form.id}`); toast(t('settings2.forms.deletedToast')); onSaved(); onClose() } catch (err) { setError(err) }
  }

  return (
    <Modal open={Boolean(form)} onClose={onClose} title={form === 'new' ? t('settings2.forms.new') : t('settings2.forms.editTitle')}
      footer={<>
        {form && form !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>{t('common.delete')}</Button>}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="intake-form" disabled={busy || !d.name.trim() || !SLUG_RE.test(d.slug)}>{t('common.save')}</Button>
      </>}>
      <form id="intake-form" onSubmit={save} className="space-y-3">
        <Field label={t('settings2.shared.name')}>
          <Input value={d.name} required maxLength={120} placeholder={t('settings2.forms.namePlaceholder')}
            onChange={(e) => setD({ ...d, name: e.target.value, slug: slugTouched ? d.slug : slugify(e.target.value) })} />
        </Field>
        <Field label={t('settings2.shared.pageAddress')} hint={`${origin()}/demande/${d.slug || '…'}`}
          error={d.slug && !SLUG_RE.test(d.slug) ? t('settings2.shared.slugError') : null}>
          <Input value={d.slug} required maxLength={61} onChange={(e) => { setSlugTouched(true); setD({ ...d, slug: e.target.value.toLowerCase() }) }} />
        </Field>
        <Field label={t('settings2.forms.intro2')} hint={t('settings2.forms.introHint')}>
          <Textarea rows={3} value={d.intro} onChange={(e) => setD({ ...d, intro: e.target.value })} maxLength={3000} />
        </Field>
        <Field label={t('settings2.forms.template')} hint={t('settings2.forms.templateHint')}>
          <Select value={d.template_id} onChange={(e) => setD({ ...d, template_id: e.target.value })}>
            <option value="">{t('settings2.forms.noTemplate')}</option>
            {templates?.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
          </Select>
        </Field>
        <Field label={t('settings2.forms.owner')} hint={t('settings2.forms.ownerHint')}>
          <Select value={d.owner_id} onChange={(e) => setD({ ...d, owner_id: e.target.value })}>
            {team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Checkbox label={t('settings2.forms.activeLabel')} checked={d.active} onChange={(v) => setD({ ...d, active: v })} />
        <ErrorNote error={error} />
      </form>
      <Confirm open={removing} onClose={() => setRemoving(false)} title={t('settings2.forms.deleteTitle')} danger confirmLabel={t('common.delete')} onConfirm={remove}>
        {t('settings2.forms.deleteText')}
      </Confirm>
    </Modal>
  )
}
