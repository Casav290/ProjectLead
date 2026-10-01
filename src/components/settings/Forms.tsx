import { useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, Card, Checkbox, Confirm, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea, toast } from '../ui'
import { api, errorText } from '../../lib/api'
import { useApp, useLoad } from '../../lib/store'
import { CopyField, ReadOnlyNote, SettingsHeader, slugify, SLUG_RE, origin, useRole } from './kit'

type IntakeForm = { id: string; slug: string; name: string; intro: string; template_id: string | null; template_name: string | null
  owner_id: string | null; active: boolean; received: number; url: string }
type Template = { id: string; name: string }

const publicLink = (f: Pick<IntakeForm, 'slug' | 'url'>) => (f.url?.startsWith('http') ? f.url : `${origin()}/demande/${f.slug}`)

/** Les formulaires de demande : chaque demande reçue ouvre un projet « à qualifier ». */
export default function Forms() {
  const { team } = useApp()
  const { canManage } = useRole()
  const { data, error, loading, reload } = useLoad<IntakeForm[]>('/forms')
  const [editing, setEditing] = useState<IntakeForm | 'new' | null>(null)

  const toggle = async (f: IntakeForm) => {
    try { await api.patch(`/forms/${f.id}`, { active: !f.active }); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <>
      <SettingsHeader title="Formulaires" action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>Nouveau formulaire</Button>}>
        Un formulaire public à mettre sur votre site ou dans votre signature : chaque demande ouvre un projet « à qualifier », avec son client,
        d'après le modèle choisi, et prévient le responsable.
      </SettingsHeader>
      {!canManage && <ReadOnlyNote />}
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : data!.length === 0 ? (
        <Empty title="Aucun formulaire" action={canManage && <Button variant="primary" onClick={() => setEditing('new')}>Créer le premier</Button>}>
          Par exemple « Demande de devis » ou « Demande de support ».
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
                          {f.active ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {f.received} demande{f.received > 1 ? 's' : ''} reçue{f.received > 1 ? 's' : ''}
                          {f.template_name && ` · modèle « ${f.template_name} »`}{owner && ` · responsable : ${owner.name}`}
                        </p>
                      </div>
                      {canManage && <>
                        <Button size="sm" variant="ghost" onClick={() => toggle(f)}>{f.active ? 'Désactiver' : 'Activer'}</Button>
                        <Button size="sm" onClick={() => setEditing(f)}>Modifier</Button>
                      </>}
                    </div>
                    <CopyField value={publicLink(f)} label={`Lien public de ${f.name}`} open />
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
      toast('Formulaire enregistré'); onSaved(); onClose()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!form || form === 'new') return
    try { await api.del(`/forms/${form.id}`); toast('Formulaire supprimé'); onSaved(); onClose() } catch (err) { setError(err) }
  }

  return (
    <Modal open={Boolean(form)} onClose={onClose} title={form === 'new' ? 'Nouveau formulaire' : 'Modifier le formulaire'}
      footer={<>
        {form && form !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => setRemoving(true)}>Supprimer</Button>}
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" type="submit" form="intake-form" disabled={busy || !d.name.trim() || !SLUG_RE.test(d.slug)}>Enregistrer</Button>
      </>}>
      <form id="intake-form" onSubmit={save} className="space-y-3">
        <Field label="Nom">
          <Input value={d.name} required maxLength={120} placeholder="Demande de devis"
            onChange={(e) => setD({ ...d, name: e.target.value, slug: slugTouched ? d.slug : slugify(e.target.value) })} />
        </Field>
        <Field label="Adresse de la page" hint={`${origin()}/demande/${d.slug || '…'}`}
          error={d.slug && !SLUG_RE.test(d.slug) ? 'Lettres minuscules, chiffres et tirets.' : null}>
          <Input value={d.slug} required maxLength={61} onChange={(e) => { setSlugTouched(true); setD({ ...d, slug: e.target.value.toLowerCase() }) }} />
        </Field>
        <Field label="Introduction" hint="Le texte d'accueil du formulaire.">
          <Textarea rows={3} value={d.intro} onChange={(e) => setD({ ...d, intro: e.target.value })} maxLength={3000} />
        </Field>
        <Field label="Modèle de projet" hint="Ses étapes sont reprises dans le projet ouvert.">
          <Select value={d.template_id} onChange={(e) => setD({ ...d, template_id: e.target.value })}>
            <option value="">Aucun modèle</option>
            {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Responsable" hint="Prévenu à chaque demande, chef du projet ouvert.">
          <Select value={d.owner_id} onChange={(e) => setD({ ...d, owner_id: e.target.value })}>
            {team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Checkbox label="Actif : la page publique accepte des demandes" checked={d.active} onChange={(v) => setD({ ...d, active: v })} />
        <ErrorNote error={error} />
      </form>
      <Confirm open={removing} onClose={() => setRemoving(false)} title="Supprimer ce formulaire ?" danger confirmLabel="Supprimer" onConfirm={remove}>
        La page publique cesse de fonctionner ; les projets déjà ouverts restent.
      </Confirm>
    </Modal>
  )
}
