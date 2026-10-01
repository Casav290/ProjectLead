import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLoad } from '../lib/store'
import { Card, ColorDot, Empty, ErrorNote, Input, PageHeader, Spinner, StatusBadge } from '../components/ui'

type Results = {
  projects: { id: string; name: string; code: string | null; status: string; color: string }[]
  tasks: { id: string; title: string; project_id: string; project_name: string; completed_at: string | null }[]
  clients: { id: string; name: string; town: string | null; email: string | null }[]
}

/** Recherche globale : projets, tâches et clients. */
export default function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [text, setText] = useState(q)
  useEffect(() => setText(q), [q])
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) setParams(text.trim() ? { q: text.trim() } : {}, { replace: true }) }, 300)
    return () => clearTimeout(t)
  }, [text, q, setParams])
  const { data, error, loading } = useLoad<Results>(q.length >= 2 ? `/search?q=${encodeURIComponent(q)}` : null)
  const count = data ? data.projects.length + data.tasks.length + data.clients.length : 0

  return (
    <div className="space-y-5">
      <PageHeader title="Recherche" />
      <form onSubmit={(e) => { e.preventDefault(); setParams(text.trim() ? { q: text.trim() } : {}) }}>
        <Input type="search" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Un projet, une tâche, un client…"
          aria-label="Rechercher" className="py-3 text-base" />
      </form>
      {q.length < 2 ? <p className="text-sm text-muted-foreground">Tapez au moins deux lettres.</p>
        : loading && !data ? <Spinner label="Recherche…" />
        : error ? <ErrorNote error={error} />
        : count === 0 ? <Empty title={`Aucun résultat pour « ${q} »`}>Essayez un autre mot, un code de projet ou le nom d'un client.</Empty>
        : data && (
          <div className="grid gap-5 lg:grid-cols-2">
            {data.projects.length > 0 && (
              <Card title={`Projets · ${data.projects.length}`}>
                <ul className="divide-y divide-border">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <Link to={`/projets/${p.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-head">
                        <ColorDot color={p.color} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                        {p.code && <span className="hidden text-xs text-muted-foreground sm:inline">{p.code}</span>}
                        <StatusBadge status={p.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {data.clients.length > 0 && (
              <Card title={`Clients · ${data.clients.length}`}>
                <ul className="divide-y divide-border">
                  {data.clients.map((c) => (
                    <li key={c.id}>
                      <Link to={`/clients/${c.id}`} className="block px-4 py-2.5 text-sm hover:bg-head">
                        <span className="block truncate font-semibold">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{[c.town, c.email].filter(Boolean).join(' · ') || '–'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {data.tasks.length > 0 && (
              <Card title={`Tâches · ${data.tasks.length}`} className="lg:col-span-2">
                <ul className="divide-y divide-border">
                  {data.tasks.map((t) => (
                    <li key={t.id}>
                      <Link to={`/projets/${t.project_id}?tache=${t.id}`} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-sm hover:bg-head">
                        <span className={`min-w-0 flex-1 font-semibold [overflow-wrap:anywhere] ${t.completed_at ? 'text-muted-foreground line-through' : ''}`}>{t.title}</span>
                        <span className="max-w-full truncate text-xs text-muted-foreground">{t.project_name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
    </div>
  )
}
