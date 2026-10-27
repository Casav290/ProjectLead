import clsx from 'clsx'
import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getLocale, t, useT } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useApp } from '../lib/store'

/**
 * La bulle « Assistant IA » (cahier commun des applications Lead, 24.10.2026) : en bas à droite de toutes les pages
 * connectées (Layout), jamais sur les pages publiques. Le fil vit dans sessionStorage (onglet) et nulle part ailleurs :
 * le serveur ne garde pas les conversations. Une écriture proposée arrive en carte « À confirmer » ; seul « Confirmer »
 * l'exécute (POST /api/assistant/confirm).
 */

type Summary = { title: string; lines: string[] }
type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'confirm'; token: string; summary: Summary; state: 'pending' | 'busy' | 'done' | 'cancelled' | 'failed'; result?: string; path?: string | null }
type Action = { type: 'navigate'; path: string } | { type: 'confirm'; token: string; summary: Summary }
type Reply = { messages: unknown[]; reply: string; actions: Action[] }
type Saved = { api: unknown[]; items: Item[]; notes: string[] }

// Les clés des suggestions (shell.assistant.suggest.*), traduites au rendu.
const SUGGESTIONS = ['late', 'progress', 'task']

const storeKey = (userId: string) => `projectlead.assistant.${userId}`
const load = (userId: string): Saved => {
  try {
    const s = JSON.parse(sessionStorage.getItem(storeKey(userId)) ?? 'null')
    if (s && Array.isArray(s.api) && Array.isArray(s.items)) return { api: s.api, items: s.items, notes: Array.isArray(s.notes) ? s.notes : [] }
  } catch { /* stockage indisponible */ }
  return { api: [], items: [], notes: [] }
}
const save = (userId: string, s: Saved) => {
  try { sessionStorage.setItem(storeKey(userId), JSON.stringify(s)) } catch { /* plein ou refusé : le fil reste en mémoire */ }
}

const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'assistant_quota') return e.body?.scope === 'account' ? t('shell.assistant.err.quotaAccount') : t('shell.assistant.err.quotaUser')
    if (e.code === 'conversation_too_long') return t('shell.assistant.err.tooLong')
    if (e.code === 'assistant_not_configured') return t('shell.assistant.err.notConfigured')
    if (e.status === 401) return t('shell.assistant.err.session')
  }
  if (e instanceof TypeError) return t('shell.assistant.err.offline')
  return t('shell.assistant.err.noAnswer')
}

/** Mise en forme légère de la réponse (paragraphes, listes, gras, liens internes) : jamais de HTML brut. */
function inline(text: string, onLink: () => void): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)|`([^`]+)`/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={k++}>{m[1]}</strong>)
    else if (m[2]) out.push(<Link key={k++} to={m[3]} onClick={onLink} className="font-semibold text-accent-dark underline">{m[2]}</Link>)
    else if (m[4]) out.push(<code key={k++} className="bg-muted px-1 font-mono text-[12px]">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
function Rich({ text, onLink }: { text: string; onLink: () => void }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list.ordered ? 'ol' : 'ul'
    blocks.push(<L key={blocks.length} className={clsx('my-1 space-y-0.5 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>
      {list.items.map((t, i) => <li key={i}>{inline(t, onLink)}</li>)}</L>)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const b = line.match(/^\s*[-*•]\s+(.*)$/), o = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (b || o) {
      const ordered = Boolean(o)
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((b ?? o)![1])
      continue
    }
    flush()
    if (!line.trim()) continue
    const h = line.match(/^#{1,4}\s+(.*)$/)
    blocks.push(<p key={blocks.length} className={clsx('my-1', h && 'font-bold')}>{inline(h ? h[1] : line, onLink)}</p>)
  }
  flush()
  return <>{blocks}</>
}

const Sparkle = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
)

export default function Assistant() {
  const { me, refresh } = useApp()
  const tr = useT()
  const userId = me?.user.id ?? ''
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<Saved>(() => (userId ? load(userId) : { api: [], items: [], notes: [] }))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bubble = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const loc = useLocation()
  const small = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

  useEffect(() => { if (userId) setState(load(userId)) }, [userId])
  const update = useCallback((fn: (s: Saved) => Saved) => setState((s) => { const n = fn(s); if (userId) save(userId, n); return n }), [userId])

  // Focus : dans le champ à l'ouverture, rendu à la bulle à la fermeture (après le rendu, sans délai).
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) field.current?.focus()
    else if (wasOpen.current) bubble.current?.focus()
    wasOpen.current = open
  }, [open])
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }) }, [state.items.length, busy, open])

  const close = () => setOpen(false)

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    const notes = state.notes
    const content = notes.length
      // Une note pour le modèle (jamais affichée), qui répond dans la langue de l'interface (locale) :
      ? [{ type: 'text', text: `[Note de l’écran, pas une demande : ${notes.join(' ')}]` }, { type: 'text', text }] // i18n-ok
      : text
    update((s) => ({ ...s, items: [...s.items, { kind: 'user', text }] }))
    try {
      const r = await api.post<Reply>('/assistant', { messages: [...state.api, { role: 'user', content }], page: loc.pathname + loc.search, locale: getLocale() })
      const cards: Item[] = r.actions.filter((a): a is Extract<Action, { type: 'confirm' }> => a.type === 'confirm')
        .map((a) => ({ kind: 'confirm', token: a.token, summary: a.summary, state: 'pending' }))
      update((s) => ({ api: r.messages, notes: [], items: [...s.items, { kind: 'assistant', text: r.reply }, ...cards] }))
      const go = r.actions.find((a): a is Extract<Action, { type: 'navigate' }> => a.type === 'navigate')
      if (go) { nav(go.path); if (small()) setOpen(false) }
    } catch (e) {
      update((s) => ({ ...s, items: [...s.items, { kind: 'error', text: errorMessage(e) }] }))
    } finally {
      setBusy(false)
      setTimeout(() => field.current?.focus(), 30)
    }
  }

  const setCard = (token: string, patch: Partial<Extract<Item, { kind: 'confirm' }>>) =>
    update((s) => ({ ...s, items: s.items.map((i) => (i.kind === 'confirm' && i.token === token ? { ...i, ...patch } : i)) }))

  const confirm = async (card: Extract<Item, { kind: 'confirm' }>) => {
    setCard(card.token, { state: 'busy' })
    try {
      const r = await api.post<{ ok: boolean; message: string; path: string | null }>('/assistant/confirm', { token: card.token })
      setCard(card.token, { state: 'done', result: r.message, path: r.path })
      // Notes pour le modèle, jamais affichées.
      update((s) => ({ ...s, notes: [...s.notes, `la personne a confirmé « ${card.summary.title} » : c’est enregistré.`] })) // i18n-ok
      refresh()
      // La page ouverte relit ses données : on y retourne (ou on ouvre l'élément créé).
      window.dispatchEvent(new Event('pl:assistant-saved'))
      if (r.path && !small()) nav(r.path)
    } catch (e) {
      const msg = e instanceof ApiError
        ? (e.body?.message ?? (e.status === 403 ? t('shell.assistant.err.expired') : errorMessage(e)))
        : errorMessage(e)
      setCard(card.token, { state: 'failed', result: msg })
      update((s) => ({ ...s, notes: [...s.notes, `l’action « ${card.summary.title} » a échoué : ${msg}`] })) // i18n-ok
    }
  }
  const cancel = (card: Extract<Item, { kind: 'confirm' }>) => {
    setCard(card.token, { state: 'cancelled' })
    update((s) => ({ ...s, notes: [...s.notes, `la personne a annulé « ${card.summary.title} » : rien n’a été fait.`] })) // i18n-ok
  }
  const reset = () => { update(() => ({ api: [], items: [], notes: [] })); setInput(''); field.current?.focus() }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input) }
  }

  if (!me?.features.assistant) return null

  return (
    <>
      {!(open && small()) && (
        <button ref={bubble} type="button" onClick={() => (open ? close() : setOpen(true))}
          aria-label={open ? tr('shell.assistant.close') : tr('shell.assistant.open')} aria-expanded={open} aria-controls="assistant-ia"
          data-assistant-bubble
          className="fixed bottom-4 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-[0_6px_20px_rgba(0,0,0,0.22)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/40 sm:bottom-6 sm:right-6">
          {open ? <span className="text-2xl leading-none" aria-hidden="true">×</span> : <Sparkle className="h-7 w-7" />}
        </button>
      )}
      {open && (
        <section id="assistant-ia" role="dialog" aria-modal="false" aria-labelledby="assistant-ia-title" onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); close() }
        }} data-assistant-panel
          className="fixed inset-0 z-50 flex flex-col border border-input bg-card sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[600px] sm:max-h-[calc(100dvh-8rem)] sm:w-[400px] sm:shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
          <header className="flex items-center gap-2 border-b border-border bg-brand px-4 py-3 text-white">
            <Sparkle className="h-5 w-5 shrink-0" />
            <h2 id="assistant-ia-title" className="flex-1 font-display text-base font-bold">{tr('shell.assistant.title')}</h2>
            <button type="button" onClick={reset} disabled={busy} className="px-2 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60">{tr('shell.assistant.new')}</button>
            <button type="button" onClick={close} aria-label={tr('shell.assistant.close')} className="grid h-8 w-8 place-items-center text-xl hover:bg-white/15">×</button>
          </header>
          <div ref={thread} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {!state.items.length && (
              <div className="space-y-3 pt-2">
                <p className="text-muted-foreground">{tr('shell.assistant.intro')}</p>
                <ul className="space-y-2">
                  {SUGGESTIONS.map((k) => tr(`shell.assistant.suggest.${k}`)).map((s) => (
                    <li key={s}><button type="button" onClick={() => send(s)} className="w-full border border-input bg-[#f7f5f3] px-3 py-2 text-left hover:border-accent">{s}</button></li>
                  ))}
                </ul>
              </div>
            )}
            {state.items.map((it, i) => (
              <Fragment key={i}>
                {it.kind === 'user' && <div className="ml-8 whitespace-pre-wrap bg-accent-veil px-3 py-2 [overflow-wrap:anywhere]">{it.text}</div>}
                {it.kind === 'assistant' && <div className="mr-4 [overflow-wrap:anywhere]"><Rich text={it.text} onLink={() => { if (small()) setOpen(false) }} /></div>}
                {it.kind === 'error' && <p role="alert" className="border-l-[3px] border-late bg-late/5 px-3 py-2 text-late">{it.text}</p>}
                {it.kind === 'confirm' && (
                  <div className="border border-accent bg-card" data-assistant-confirm={it.state}>
                    <p className="border-b border-border bg-accent-veil px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-accent-dark">
                      {it.state === 'done' ? tr('shell.assistant.card.done') : it.state === 'cancelled' ? tr('shell.assistant.card.cancelled')
                        : it.state === 'failed' ? tr('shell.assistant.card.failed') : tr('shell.assistant.card.pending')}</p>
                    <div className="px-3 py-2">
                      <p className="font-bold">{it.summary.title}</p>
                      <ul className="mt-1 space-y-0.5 text-[13px]">{it.summary.lines.map((l, j) => <li key={j} className="[overflow-wrap:anywhere]">{l}</li>)}</ul>
                      {it.result && <p className={clsx('mt-2 text-[13px] font-semibold', it.state === 'failed' ? 'text-late' : 'text-won')}>{it.result}</p>}
                      {it.state === 'done' && it.path && <Link to={it.path} className="mt-1 inline-block text-[13px] font-semibold text-accent-dark underline" onClick={() => { if (small()) setOpen(false) }}>{tr('shell.assistant.card.open')}</Link>}
                      {(it.state === 'pending' || it.state === 'busy') && (
                        <div className="mt-3 flex gap-2">
                          <button type="button" disabled={it.state === 'busy'} onClick={() => confirm(it)}
                            className="bg-brand px-3 py-1.5 font-bold text-white hover:bg-accent-dark disabled:opacity-60">{it.state === 'busy' ? tr('shell.assistant.card.saving') : tr('common.confirm')}</button>
                          <button type="button" disabled={it.state === 'busy'} onClick={() => cancel(it)}
                            className="border border-input px-3 py-1.5 font-semibold hover:bg-muted disabled:opacity-60">{tr('common.cancel')}</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
            {busy && <p className="flex items-center gap-2 text-muted-foreground" role="status"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />{tr('shell.assistant.working')}</p>}
          </div>
          <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(input) }}>
            <textarea ref={field} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} disabled={busy} rows={2} maxLength={4000}
              aria-label={tr('shell.assistant.inputLabel')} placeholder={tr('shell.assistant.placeholder')}
              className="max-h-40 min-h-[44px] flex-1 resize-none border border-input bg-[#f7f5f3] px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60" />
            <button type="submit" disabled={busy || !input.trim()} className="h-[44px] bg-brand px-4 font-bold text-white hover:bg-accent-dark disabled:opacity-50">{tr('shell.assistant.send')}</button>
          </form>
        </section>
      )}
    </>
  )
}
