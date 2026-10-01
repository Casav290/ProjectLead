import clsx from 'clsx'
import { useRef, useState } from 'react'
import { Button, Confirm, Empty, ErrorNote, Spinner, TableStack, toast } from '../../components/ui'
import { api, errorText } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { useLoad } from '../../lib/store'
import type { ProjectDetail } from '../../lib/types'

type Props = { project: ProjectDetail; onChanged: () => void }
type FileRow = { id: string; filename: string; mime: string; size: number; task_id: string | null; visible_to_client: boolean
  created_at: string; uploaded_by_name: string | null; task_title: string | null }

export const fmtSize = (n: number) =>
  n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} Mo`

/** Les fichiers du projet (et de ses tâches) ; certains se partagent avec le client. */
export default function Files({ project }: Props) {
  const { data, error, reload } = useLoad<FileRow[]>(`/projects/${project.id}/files`)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [drag, setDrag] = useState(false)
  const [removing, setRemoving] = useState<FileRow | null>(null)

  const upload = async (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length) return
    setBusy(list.length)
    for (const f of list) {
      if (f.size > 15 * 1024 * 1024) { toast(`« ${f.name} » dépasse 15 Mo.`); setBusy((n) => n - 1); continue }
      const form = new FormData()
      form.append('file', f)
      try { await api.upload(`/projects/${project.id}/files`, form) } catch (e) { toast(`« ${f.name} » : ${errorText(e)}`) }
      setBusy((n) => n - 1)
    }
    if (input.current) input.current.value = ''
    reload()
  }
  const toggle = async (f: FileRow) => {
    try { await api.patch(`/projects/files/${f.id}`, { visible_to_client: !f.visible_to_client }); reload() } catch (e) { toast(errorText(e)) }
  }
  const remove = async (f: FileRow) => {
    try { await api.del(`/projects/files/${f.id}`); toast('Fichier supprimé.'); reload() } catch (e) { toast(errorText(e)) }
  }

  return (
    <div className="space-y-4">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
           onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }}
           className={clsx('flex flex-col items-center gap-2 border-2 border-dashed px-4 py-6 text-center text-sm',
                           drag ? 'border-accent bg-accent-veil' : 'border-input bg-card')}>
        <p className="font-semibold">{busy ? `Envoi en cours (${busy})…` : 'Déposez des fichiers ici'}</p>
        <p className="text-xs text-muted-foreground">ou</p>
        <Button onClick={() => input.current?.click()} disabled={busy > 0}>Choisir des fichiers</Button>
        <p className="text-xs text-muted-foreground">15 Mo au plus par fichier.</p>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : !data.length ? <Empty title="Aucun fichier">Devis, maquettes, comptes rendus : tout au même endroit, et à portée du client si vous le souhaitez.</Empty> : (
        <TableStack>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-head text-left text-[11px] font-extrabold uppercase tracking-[.05em] text-muted-foreground">
              <tr><th className="px-3 py-2">Fichier</th><th className="px-3 py-2">Taille</th><th className="px-3 py-2">Déposé</th>
                  <th className="px-3 py-2">Visible par le client</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr key={f.id} className="border-t border-border">
                  <td className="max-w-[24rem] px-3 py-2">
                    <a href={`/api/projects/files/${f.id}`} className="font-semibold text-accent hover:underline [overflow-wrap:anywhere]" download>{f.filename}</a>
                    {f.task_title && <span className="block text-xs text-muted-foreground">Tâche : {f.task_title}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{fmtSize(f.size)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDate(f.created_at)}{f.uploaded_by_name && `, ${f.uploaded_by_name}`}</td>
                  <td className="px-3 py-2">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--accent))]" checked={f.visible_to_client} onChange={() => toggle(f)} />
                      <span className="text-xs">{f.visible_to_client ? 'Oui' : 'Non'}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-xs font-semibold text-muted-foreground hover:text-late" onClick={() => setRemoving(f)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableStack>
      )}
      {data && data.some((f) => f.visible_to_client) && !project.portal_enabled &&
        <p className="text-xs text-muted-foreground">La page de suivi est fermée : le client ne voit pas encore ces fichiers (onglet Suivi client).</p>}
      <Confirm open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} danger confirmLabel="Supprimer"
        title="Supprimer ce fichier ?">« {removing?.filename} » sera effacé pour de bon.</Confirm>
    </div>
  )
}
