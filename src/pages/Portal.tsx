import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Field, HealthBadge, Input, StageBadge, Textarea } from '../components/ui'
import { fmtDate, fmtDateTime, fmtMinutes, fmtRelative, STATUS_LABEL } from '../lib/format'

type PortalData = {
  project: { name: string; code: string | null; description: string; status: string; health: string; start_date: string | null
             due_date: string | null; color: string; account: string; client: string | null; owner: string | null }
  progress: number
  stages: { id: string; name: string; status: 'todo' | 'in_progress' | 'done' | 'blocked'; start_date: string | null; due_date: string | null
            client_note: string; completed_at: string | null; tasks_total: number; tasks_done: number }[]
  tasks: { id: string; title: string; due_date: string | null; completed_at: string | null; is_milestone: boolean; stage_name: string | null }[]
  updates: { health: string; body: string; created_at: string; author_name: string | null }[]
  files: { id: string; filename: string; size: number; created_at: string }[]
  time: { month: string; minutes: number }[]
  events: { title: string; starts_at: string; ends_at: string; location: string }[]
}

const size = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} Mo`
const month = (m: string) => new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric' }).format(new Date(`${m}-15T12:00:00`))

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-xs font-extrabold uppercase tracking-[.08em] text-muted-foreground sm:px-6">{title}</h2>
      <div className="px-4 py-4 sm:px-6">{children}</div>
    </section>
  )
}

const dot = (s: string) => s === 'done' ? 'bg-won border-won' : s === 'in_progress' ? 'bg-accent border-accent' : s === 'blocked' ? 'bg-soon border-soon' : 'bg-card border-input'

function Stages({ stages }: { stages: PortalData['stages'] }) {
  return (
    <ol className="relative">
      {stages.map((s, i) => (
        <li key={s.id} className="relative flex gap-4 pb-6 last:pb-0">
          {i < stages.length - 1 && <span aria-hidden="true" className={clsx('absolute left-[7px] top-5 h-[calc(100%-12px)] w-0.5', s.status === 'done' ? 'bg-won' : 'bg-border')} />}
          <span aria-hidden="true" className={clsx('relative mt-1 h-4 w-4 shrink-0 rounded-full border-2', dot(s.status))}>
            {s.status === 'done' && <svg viewBox="0 0 16 16" className="absolute inset-0 h-full w-full text-white"><path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className={clsx('font-bold', s.status === 'todo' && 'text-muted-foreground')}>{s.name}</h3>
              <StageBadge status={s.status} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {s.status === 'done' && s.completed_at ? `Terminée le ${fmtDate(s.completed_at)}`
                : s.status === 'done' ? '' : s.due_date ? `Prévue pour le ${fmtDate(s.due_date)}` : s.start_date ? `À partir du ${fmtDate(s.start_date)}` : ''}
              {s.tasks_total > 0 && <>{(s.completed_at || (s.status !== 'done' && (s.due_date || s.start_date))) && ' · '}{s.tasks_done} sur {s.tasks_total} tâches faites</>}
            </p>
            {s.client_note && <p className="mt-2 border-l-[3px] border-accent bg-accent-veil px-3 py-2 text-sm">{s.client_note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function MessageForm({ token, owner }: { token: string; owner: string | null }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [body, setBody] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'busy'>('idle')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('sending')
    try {
      const r = await fetch(`/api/public/portal/${token}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), body: body.trim() }) })
      if (r.status === 429) { setState('busy'); return }
      if (!r.ok) throw new Error()
      setState('sent'); setBody('')
    } catch { setState('error') }
  }
  if (state === 'sent') {
    return (
      <div className="border-l-[3px] border-won bg-[#dcfce7] px-4 py-3 text-sm text-[#15803d]">
        <p className="font-bold">Message transmis, merci.</p>
        <p>{owner ? `${owner} vous répondra` : 'L’équipe vous répondra'} par email.</p>
        <button className="mt-2 font-semibold underline" onClick={() => setState('idle')}>Écrire un autre message</button>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Votre nom"><Input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Votre email"><Input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Message" className="sm:col-span-2"><Textarea required rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Une question, une remarque, un document à venir…" /></Field>
      {state === 'error' && <p role="alert" className="text-sm text-late sm:col-span-2">L’envoi a échoué. Réessayez dans un instant.</p>}
      {state === 'busy' && <p role="alert" className="text-sm text-late sm:col-span-2">Beaucoup de messages viennent d’être envoyés. Réessayez dans une heure, ou écrivez directement à l’équipe.</p>}
      <div className="sm:col-span-2"><Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={state === 'sending'}>{state === 'sending' ? 'Envoi…' : 'Envoyer à l’équipe'}</Button></div>
    </form>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md border border-border bg-card px-6 py-10 text-center">
        <p className="font-display text-5xl font-extrabold text-accent-light">404</p>
        <h1 className="mt-3 font-display text-xl">Ce lien de suivi n’est pas ou plus valable</h1>
        <p className="mt-2 text-sm text-muted-foreground">Il a peut-être été renouvelé, ou le suivi en ligne a été fermé. Demandez le lien à jour à votre interlocuteur : il vous le renverra volontiers.</p>
      </div>
    </div>
  )
}

/** La page de suivi du client : publique, sans compte, en lecture seule (sauf le mot à l'équipe). */
export default function Portal() {
  const { token = '' } = useParams()
  const [data, setData] = useState<PortalData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')
  useEffect(() => {
    let alive = true
    fetch(`/api/public/portal/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!alive) return
        if (r.status === 404) { setState('missing'); return }
        if (!r.ok) throw new Error()
        setData(await r.json()); setState('ok')
      })
      .catch(() => alive && setState('error'))
    return () => { alive = false }
  }, [token])
  useEffect(() => { if (data) document.title = `${data.project.name} · Suivi de projet` }, [data])

  if (state === 'missing') return <NotFound />
  if (state === 'error') return <p className="p-8 text-center text-sm text-muted-foreground">La page ne répond pas. Rechargez-la dans un instant.</p>
  if (!data) return <p className="p-8 text-center text-sm text-muted-foreground">Chargement…</p>
  const { project: p } = data
  const doneStages = data.stages.filter((s) => s.status === 'done').length
  const openTasks = data.tasks.filter((t) => !t.completed_at)
  const doneTasks = data.tasks.filter((t) => t.completed_at)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-input bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="min-w-0 truncate text-sm font-extrabold">{p.account}</span>
          <span className="shrink-0 text-xs text-muted-foreground">Suivi de projet</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-10">
        <div className="border border-border border-t-4 bg-card px-4 py-5 sm:px-6" style={{ borderTopColor: p.color }}>
          {p.client && <p className="text-sm text-muted-foreground">Pour {p.client}</p>}
          <h1 className="mt-1 font-display text-3xl leading-tight sm:text-4xl [overflow-wrap:anywhere]">{p.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{STATUS_LABEL[p.status] ?? p.status}</span>
            {p.status !== 'done' && <HealthBadge health={p.health} />}
          </div>
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">Avancement</span>
              <span className="font-display text-2xl font-extrabold tabular-nums">{data.progress} %</span>
            </div>
            <div className="mt-1.5 h-2.5 bg-muted" role="progressbar" aria-valuenow={data.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent" style={{ width: `${data.progress}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {data.stages.length ? `${doneStages} étape${doneStages > 1 ? 's' : ''} terminée${doneStages > 1 ? 's' : ''} sur ${data.stages.length}` : 'Étapes à venir'}
              {p.due_date && ` · échéance prévue le ${fmtDate(p.due_date)}`}
            </p>
          </div>
          {p.description && <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-sm leading-relaxed">{p.description}</p>}
          {p.owner && <p className="mt-4 text-xs text-muted-foreground">Votre interlocuteur : <b className="text-foreground">{p.owner}</b></p>}
        </div>

        {data.stages.length > 0 && <Section title="Étapes"><Stages stages={data.stages} /></Section>}

        {data.updates.length > 0 && (
          <Section title="Points d’avancement">
            <ol className="space-y-5">
              {data.updates.slice(0, 5).map((u, i) => (
                <li key={i} className={clsx(i > 0 && 'border-t border-border pt-5')}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <HealthBadge health={u.health} /><span>{fmtDate(u.created_at)}{u.author_name && `, ${u.author_name}`}</span>
                  </div>
                  {u.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{u.body}</p>}
                </li>
              ))}
            </ol>
          </Section>
        )}

        {data.tasks.length > 0 && (
          <Section title="Tâches suivies">
            <ul className="divide-y divide-border">
              {[...openTasks, ...doneTasks].map((t) => (
                <li key={t.id} className="flex items-start gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <span aria-hidden="true" className={clsx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center border', t.completed_at ? 'border-won bg-won text-white' : 'border-input')}>
                    {t.completed_at && <svg viewBox="0 0 16 16" className="h-3 w-3"><path d="M3.5 8.2l3 3 6-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx(t.completed_at && 'text-muted-foreground line-through decoration-input')}>{t.title}</span>
                    {t.is_milestone && <span className="ml-2 text-[10.5px] font-extrabold uppercase tracking-wide text-accent-dark">Jalon</span>}
                    {t.stage_name && <span className="block text-xs text-muted-foreground">{t.stage_name}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t.completed_at ? `Fait le ${fmtDate(t.completed_at)}` : t.due_date ? `Pour le ${fmtDate(t.due_date)}` : ''}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {data.events.length > 0 && (
          <Section title="Prochains rendez-vous">
            <ul className="space-y-3">
              {data.events.map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="w-12 shrink-0 border border-border bg-head py-1 text-center leading-tight">
                    <span className="block text-lg font-extrabold">{new Date(e.starts_at).getDate()}</span>
                    <span className="block text-[10px] font-bold uppercase text-muted-foreground">{new Intl.DateTimeFormat('fr-CH', { month: 'short' }).format(new Date(e.starts_at))}</span>
                  </span>
                  <span className="min-w-0"><b className="block">{e.title}</b>
                    <span className="text-muted-foreground">{fmtDateTime(e.starts_at)}{e.location && ` · ${e.location}`}</span></span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {data.files.length > 0 && (
          <Section title="Documents">
            <ul className="divide-y divide-border">
              {data.files.map((f) => (
                <li key={f.id}>
                  <a href={`/api/public/portal/${token}/files/${f.id}`} download className="group flex items-center gap-3 py-2.5 text-sm first:pt-0">
                    <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center bg-accent-veil text-accent">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></svg>
                    </span>
                    <span className="min-w-0 flex-1 font-semibold group-hover:text-accent [overflow-wrap:anywhere]">{f.filename}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{size(f.size)} · {fmtRelative(f.created_at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {data.time.length > 0 && (
          <Section title="Temps facturable">
            <ul className="divide-y divide-border text-sm">
              {data.time.map((t) => (
                <li key={t.month} className="flex justify-between py-2 first:pt-0 last:pb-0"><span className="first-letter:uppercase">{month(t.month)}</span><b className="tabular-nums">{fmtMinutes(t.minutes)}</b></li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Écrire à l’équipe"><MessageForm token={token} owner={p.owner} /></Section>
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-muted-foreground sm:px-6">
        Page de suivi tenue à jour par {p.account} avec ProjectLead.
      </footer>
    </div>
  )
}
