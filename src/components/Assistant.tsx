import clsx from 'clsx'
import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getLocale, isLocale, t, useI18n, useT } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useApp } from '../lib/store'
import { CardText, Rich } from './assistantText'

/**
 * La bulle « Assistant IA » (cahier commun des applications Lead, 24.10.2026) : en bas à droite de toutes les pages
 * connectées (Layout), jamais sur les pages publiques. Le fil vit dans sessionStorage (onglet) et nulle part ailleurs :
 * le serveur ne garde pas les conversations. Une écriture proposée arrive en carte « À confirmer » ; seul « Confirmer »
 * l'exécute (POST /api/assistant/confirm).
 *
 * Alignement des bulles (28.10.2026) : « Page ouverte : <nom> » quand la bulle navigue (B5) ; texte sans balisage brut
 * (assistantText.tsx, B6) ; « avant → après » lu « devient » (B7) ; focus, Échap, préfixes lus « Vous : » /
 * « Assistant IA : » (B8) ; rien de masqué par la bulle, cachée à l'impression, champ en 16 px au téléphone (B9) ; fil
 * propre à la personne ET à l'entreprise (B10) ; mention « peut se tromper » sous le champ (B11) ; un fil refusé par le
 * service se recommence par le bouton « Nouvelle conversation » du message (B3).
 */

type Group = { title: string; lines: string[]; more?: number }
type Summary = { title: string; lines: string[]; groups?: Group[] }
type Link = { label: string; path: string }
type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'page'; label: string }
  | { kind: 'error'; text: string; reset?: boolean }
  | { kind: 'confirm'; token: string; summary: Summary; state: 'pending' | 'busy' | 'done' | 'cancelled' | 'failed'; result?: string; path?: string | null; links?: Link[] }
type Action = { type: 'navigate'; path: string; label?: string } | { type: 'confirm'; token: string; summary: Summary }
type Reply = { messages: unknown[]; reply: string; actions: Action[] }
type Saved = { api: unknown[]; items: Item[]; notes: string[] }

// Les clés des suggestions (shell.assistant.suggest.*), traduites au rendu ; « plan » : le scénario d'Ève (27.10.2026).
const SUGGESTIONS = ['late', 'plan', 'task']

/**
 * Le fil vit dans sessionStorage, sous une clé propre à la personne ET à l'entreprise (B10) : une autre personne, ou la
 * même dans une autre entreprise, dans le même onglet, ne le voit pas. Stockage plein ou refusé : le fil reste en mémoire.
 */
const storeKey = (accountId: string, userId: string) => `projectlead.assistant.${accountId}.${userId}`
const EMPTY: Saved = { api: [], items: [], notes: [] }
const load = (key: string): Saved => {
  try {
    const s = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (s && Array.isArray(s.api) && Array.isArray(s.items)) return { api: s.api, items: s.items, notes: Array.isArray(s.notes) ? s.notes : [] }
  } catch { /* stockage indisponible */ }
  return EMPTY
}
const save = (key: string, s: Saved) => {
  try { sessionStorage.setItem(key, JSON.stringify(s)) } catch { /* plein ou refusé : le fil reste en mémoire */ }
}

/** L'erreur d'une demande, dans le fil. Un fil que le service refuse (B3) porte le bouton « Nouvelle conversation ». */
const errorItem = (e: unknown): Extract<Item, { kind: 'error' }> => {
  if (e instanceof ApiError) {
    if (e.code === 'assistant_history' || e.code === 'conversation_too_long') return { kind: 'error', text: t('shell.assistant.err.history'), reset: true }
    if (e.code === 'assistant_timeout') return { kind: 'error', text: t('shell.assistant.err.timeout') }
    if (e.code === 'assistant_busy') return { kind: 'error', text: t('shell.assistant.err.busy') }
    if (e.code === 'assistant_quota') return { kind: 'error', text: e.body?.scope === 'account' ? t('shell.assistant.err.quotaAccount') : t('shell.assistant.err.quotaUser') }
    if (e.code === 'assistant_not_configured') return { kind: 'error', text: t('shell.assistant.err.notConfigured') }
    if (e.status === 401) return { kind: 'error', text: t('shell.assistant.err.session') }
  }
  if (e instanceof TypeError) return { kind: 'error', text: t('shell.assistant.err.offline') }
  return { kind: 'error', text: t('shell.assistant.err.noAnswer') }
}

/** Le refus d'un « Confirmer » (B7) : expirée, déjà utilisée, droits, élément disparu, réseau — chacun son texte. */
const confirmError = (e: unknown): string => {
  if (e instanceof ApiError) {
    if (typeof e.body?.message === 'string' && e.body.message) return e.body.message
    if (e.code === 'token_expired') return t('shell.assistant.err.expired')
    if (e.code === 'token_used') return t('shell.assistant.err.used')
    if (e.status === 403) return t('shell.assistant.err.forbidden')
    if (e.status === 404 || e.status === 410) return t('shell.assistant.err.gone')
  }
  return errorItem(e).text
}

const Sparkle = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
)

export default function Assistant() {
  const { me, refresh } = useApp()
  const tr = useT()
  const { setLocale, locale } = useI18n()
  const key = me ? storeKey(me.account.id, me.user.id) : ''
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<Saved>(() => (key ? load(key) : EMPTY))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bubble = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const loc = useLocation()
  const small = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

  useEffect(() => { if (key) setState(load(key)) }, [key])
  const update = useCallback((fn: (s: Saved) => Saved) => setState((s) => { const n = fn(s); if (key) save(key, n); return n }), [key])

  // Focus : dans le champ à l'ouverture, rendu à la bulle à la fermeture (après le rendu, sans délai).
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) field.current?.focus()
    else if (wasOpen.current) bubble.current?.focus()
    wasOpen.current = open
  }, [open])
  // Une réponse arrive : on montre son début (une longue carte se lit de haut en bas) ; sinon le bas du fil.
  useEffect(() => {
    const t = thread.current
    if (!t) return
    const last = state.items.length - 1
    let at = -1
    for (let k = last; k >= 0; k--) if (state.items[k].kind === 'assistant') { at = k; break }
    const reply = !busy && state.items[last]?.kind === 'confirm' && at >= 0 ? t.querySelector<HTMLElement>(`[data-item="${at}"]`) : null
    if (reply && t.scrollHeight - reply.offsetTop > t.clientHeight) t.scrollTo({ top: Math.max(0, reply.offsetTop - 8) })
    else t.scrollTo({ top: t.scrollHeight })
  }, [state.items.length, busy, open])

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
      const go = r.actions.find((a): a is Extract<Action, { type: 'navigate' }> => a.type === 'navigate')
      // L'écran ouvert se dit par son nom (B5), jamais par son chemin.
      const opened: Item[] = go?.label ? [{ kind: 'page', label: go.label }] : []
      const said: Item[] = r.reply ? [{ kind: 'assistant', text: r.reply }] : []
      update((s) => ({ api: r.messages, notes: [], items: [...s.items, ...said, ...opened, ...cards] }))
      if (go) { nav(go.path); if (small()) setOpen(false) }
    } catch (e) {
      update((s) => ({ ...s, items: [...s.items, errorItem(e)] }))
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
      const r = await api.post<{ ok: boolean; message: string; path: string | null; label?: string | null; links?: Link[]; locale?: string }>('/assistant/confirm', { token: card.token, locale: getLocale() })
      setCard(card.token, { state: 'done', result: r.message, path: r.path, links: r.links ?? [] })
      // Une carte « langue de l'interface » confirmée : l'écran change de langue sur place.
      if (isLocale(r.locale) && r.locale !== getLocale()) setLocale(r.locale).catch(() => {})
      // Le résultat (et ses liens) en bas de la carte : à l'écran.
      setTimeout(() => thread.current?.querySelector(`[data-card="${card.token.slice(-16)}"]`)?.scrollIntoView({ block: 'end' }), 50)
      // Notes pour le modèle, jamais affichées.
      update((s) => ({ ...s, notes: [...s.notes, `la personne a confirmé « ${card.summary.title} » : c’est enregistré (${r.message}).`] })) // i18n-ok
      refresh()
      // La page ouverte relit ses données : on y retourne (ou on ouvre l'élément créé).
      window.dispatchEvent(new Event('pl:assistant-saved'))
      if (r.path && !small()) {
        nav(r.path)
        const label = r.label
        if (label) update((s) => ({ ...s, items: [...s.items, { kind: 'page', label }] }))
      }
    } catch (e) {
      const msg = confirmError(e)
      setCard(card.token, { state: 'failed', result: msg })
      update((s) => ({ ...s, notes: [...s.notes, `l’action « ${card.summary.title} » a échoué : ${msg}`] })) // i18n-ok
    }
  }
  const cancel = (card: Extract<Item, { kind: 'confirm' }>) => {
    setCard(card.token, { state: 'cancelled' })
    update((s) => ({ ...s, notes: [...s.notes, `la personne a annulé « ${card.summary.title} » : rien n’a été fait.`] })) // i18n-ok
  }
  const reset = () => { update(() => EMPTY); setInput(''); field.current?.focus() }

  // Entrée envoie ; Maj+Entrée va à la ligne ; jamais pendant une composition (IME : japonais, accents morts…).
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.preventDefault(); send(input) }
  }
  const fr = locale === 'fr'

  if (!me?.features.assistant) return null

  return (
    <>
      {!(open && small()) && (
        <button ref={bubble} type="button" onClick={() => (open ? close() : setOpen(true))}
          aria-label={open ? tr('shell.assistant.close') : tr('shell.assistant.open')} aria-expanded={open} aria-controls="assistant-ia"
          data-assistant-bubble
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-[0_6px_20px_rgba(0,0,0,0.22)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/40 print:hidden sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-6">
          {open ? <span className="text-2xl leading-none" aria-hidden="true">×</span> : <Sparkle className="h-7 w-7" />}
        </button>
      )}
      {open && (
        <section id="assistant-ia" role="dialog" aria-modal="false" aria-labelledby="assistant-ia-title" onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); close() }
        }} data-assistant-panel
          className="fixed inset-0 z-50 flex flex-col border border-input bg-card print:hidden min-[641px]:inset-auto min-[641px]:bottom-24 min-[641px]:right-6 min-[641px]:h-[600px] min-[641px]:max-h-[calc(100dvh-8rem)] min-[641px]:w-[400px] min-[641px]:shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
          <header className="flex items-center gap-2 border-b border-border bg-brand px-4 py-3 text-white">
            <Sparkle className="h-5 w-5 shrink-0" />
            <h2 id="assistant-ia-title" className="flex-1 font-display text-base font-bold">{tr('shell.assistant.title')}</h2>
            <button type="button" onClick={reset} disabled={busy} data-assistant-reset className="px-2 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-60">{tr('shell.assistant.new')}</button>
            <button type="button" onClick={close} aria-label={tr('shell.assistant.close')} className="grid h-8 w-8 place-items-center text-xl hover:bg-white/15">×</button>
          </header>
          <div ref={thread} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite" data-assistant-log>
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
                {it.kind === 'user' && <div data-assistant-user className="ml-8 whitespace-pre-wrap bg-accent-veil px-3 py-2 [overflow-wrap:anywhere]"><span className="sr-only">{tr('shell.assistant.you')} </span>{it.text}</div>}
                {it.kind === 'assistant' && <div data-item={i} className="mr-4 [overflow-wrap:anywhere]"><span className="sr-only">{tr('shell.assistant.bot')} </span><Rich text={it.text} fr={fr} onLink={() => { if (small()) setOpen(false) }} /></div>}
                {it.kind === 'page' && <p data-assistant-opened className="text-xs font-semibold text-muted-foreground">{tr('shell.assistant.pageOpened', { label: it.label })}</p>}
                {it.kind === 'error' && (
                  <div role="alert" className="border-l-[3px] border-late bg-late/5 px-3 py-2 text-late">
                    <p>{it.text}</p>
                    {it.reset && <button type="button" onClick={reset} disabled={busy} data-assistant-reset-inline
                      className="mt-2 border border-late px-2 py-1 text-xs font-bold hover:bg-late/10 disabled:opacity-60">{tr('shell.assistant.new')}</button>}
                  </div>
                )}
                {it.kind === 'confirm' && (
                  <div className="border border-accent bg-card" data-assistant-confirm={it.state} data-card={it.token.slice(-16)}>
                    <p className="border-b border-border bg-accent-veil px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-accent-dark">
                      {it.state === 'done' ? tr('shell.assistant.card.done') : it.state === 'cancelled' ? tr('shell.assistant.card.cancelled')
                        : it.state === 'failed' ? tr('shell.assistant.card.failed') : tr('shell.assistant.card.pending')}</p>
                    <div className="px-3 py-2">
                      <p className="font-bold">{it.summary.title}</p>
                      <ul className="mt-1 space-y-0.5 text-[13px]">{it.summary.lines.map((l, j) => <li key={j} className="[overflow-wrap:anywhere]"><CardText text={l} becomes={tr('shell.assistant.card.becomes')} /></li>)}</ul>
                      {it.summary.groups?.map((g, j) => (
                        <div key={j} className="mt-2 border-l-2 border-accent-light pl-2" data-assistant-group>
                          <p className="text-[13px] font-bold [overflow-wrap:anywhere]">{g.title}</p>
                          <ul className="space-y-0.5 text-[12.5px] text-muted-foreground">
                            {g.lines.map((l, k) => {
                              // « Titre · dates · estimation · après … » : le titre en avant, le reste en retrait.
                              const at = l.indexOf(' · ')
                              const becomes = tr('shell.assistant.card.becomes')
                              return <li key={k} className="[overflow-wrap:anywhere]">{at > 0 ? <><span className="font-semibold text-foreground"><CardText text={l.slice(0, at)} becomes={becomes} /></span><CardText text={l.slice(at)} becomes={becomes} /></> : <CardText text={l} becomes={becomes} />}</li>
                            })}
                            {Boolean(g.more) && <li className="text-muted-foreground">{tr('shell.assistant.card.more', { n: g.more })}</li>}
                          </ul>
                        </div>
                      ))}
                      {it.result && <p className={clsx('mt-2 text-[13px] font-semibold', it.state === 'failed' ? 'text-late' : 'text-won')}>{it.result}</p>}
                      {it.state === 'done' && (it.links?.length ? (
                        <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] font-semibold">
                          <span className="text-muted-foreground">{tr('shell.assistant.card.view')}</span>
                          {it.links.map((l) => <Link key={l.path} to={l.path} className="text-accent-dark underline" onClick={() => { if (small()) setOpen(false) }}>{tr(`project.tabs.${l.label}`)}</Link>)}
                        </p>
                      ) : it.path && <Link to={it.path} className="mt-1 inline-block text-[13px] font-semibold text-accent-dark underline" onClick={() => { if (small()) setOpen(false) }}>{tr('shell.assistant.card.open')}</Link>)}
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
          <form className="flex items-end gap-2 border-t border-border px-3 pb-1.5 pt-3" onSubmit={(e) => { e.preventDefault(); send(input) }}>
            <textarea ref={field} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} disabled={busy} rows={2} maxLength={4000}
              aria-label={tr('shell.assistant.inputLabel')} aria-describedby="assistant-ia-note" placeholder={tr('shell.assistant.placeholder')} data-assistant-input
              className="max-h-40 min-h-[44px] flex-1 resize-none border border-input bg-[#f7f5f3] px-3 py-2 text-base focus:border-accent focus:outline-none disabled:opacity-60 min-[641px]:text-sm" />
            <button type="submit" disabled={busy || !input.trim()} className="h-[44px] bg-brand px-4 font-bold text-white hover:bg-accent-dark disabled:opacity-50">{tr('shell.assistant.send')}</button>
          </form>
          <p id="assistant-ia-note" data-assistant-note className="px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-[11.5px] text-muted-foreground">{tr('shell.assistant.note')}</p>
        </section>
      )}
    </>
  )
}
