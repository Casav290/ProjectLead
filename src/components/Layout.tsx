import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { leave, leavingState, watchLeaving } from '../lib/arrival'
import { fmtRelative } from '../lib/format'
import { useApp } from '../lib/store'
import type { Notification } from '../lib/types'
import { useI18n, useT } from '../i18n'
import AppSwitcher from './AppSwitcher'
import Assistant from './Assistant'
import LanguageSelect from './LanguageSelect'
import { Avatar } from './ui'

/** La mise en page de l'application connectée : navigation à gauche, barre du haut, contenu. */

// `label` : la clé du libellé (shell.nav.*), traduite au rendu.

const NAV: { to: string; label: string; icon: string; badge?: 'inbox' }[] = [
  { to: '/', label: 'shell.nav.home', icon: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z' },
  { to: '/taches', label: 'shell.nav.tasks', icon: 'M4 6h2m4 0h10M4 12h2m4 0h10M4 18h2m4 0h10' },
  { to: '/projets', label: 'shell.nav.projects', icon: 'M3 7h7l2 2h9v11H3z' },
  { to: '/emails', label: 'shell.nav.emails', icon: 'M3 5h18v14H3zM3 5l9 8 9-8', badge: 'inbox' },
  { to: '/agenda', label: 'shell.nav.agenda', icon: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/temps', label: 'shell.nav.time', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2' },
  { to: '/charge', label: 'shell.nav.workload', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { to: '/rapports', label: 'shell.nav.reports', icon: 'M4 4v16h16M8 16l4-5 3 3 5-6' },
  { to: '/clients', label: 'shell.nav.clients', icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { to: '/facturation', label: 'shell.nav.billing', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6' },
  { to: '/modeles', label: 'shell.nav.templates', icon: 'M5 3h14v18H5zM9 7h6M9 11h6M9 15h3' },
  { to: '/reglages', label: 'shell.nav.settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 7.5 4 7 3 10l2 1v2l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z' },
]

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)

// `compact` : dans la barre du haut au téléphone, la marque seule (place pour le sélecteur de langue).
export const Brand = ({ compact }: { compact?: boolean }) => (
  <Link to="/" className="flex items-center gap-2 font-extrabold">
    <span className="grid h-7 w-7 place-items-center bg-brand text-[12px] text-white">PL</span>
    <span className={compact ? 'hidden sm:inline' : undefined}>ProjectLead</span>
  </Link>
)

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', h) }
  }, [open, close])
  return ref
}

function Timer() {
  const { me, refresh } = useApp()
  const t = useT()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!me?.running) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [me?.running])
  if (!me?.running) return null
  const s = Math.max(0, Math.floor((now - Date.parse(me.running.started_at)) / 1000))
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  return (
    <div className="flex items-center gap-2 border border-accent bg-accent-veil px-2 py-1 text-xs">
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      <Link to={`/projets/${me.running.project_id}`} className="hidden max-w-[180px] truncate font-semibold md:inline">
        {me.running.task_title ?? me.running.project_name}</Link>
      {/* Au téléphone, la barre est étroite : le point qui bat et un bouton carré ; le temps et « Arrêter » dès 640 px. */}
      <span className="hidden font-mono font-bold tabular-nums sm:inline">{hh}:{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span>
      <button className="bg-accent px-2 py-0.5 font-bold text-white hover:bg-accent-dark" aria-label={t('shell.timer.stop')} title={t('shell.timer.stop')}
              onClick={async () => { await api.post('/time/timer/stop'); refresh() }}>
        <span aria-hidden="true" className="inline-block h-2 w-2 bg-white align-middle sm:hidden" /><span className="hidden sm:inline">{t('shell.timer.stop')}</span></button>
    </div>
  )
}

function Bell() {
  const { me, refresh } = useApp()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[] | null>(null)
  const nav = useNavigate()
  const ref = useClickOutside(open, () => setOpen(false))
  useEffect(() => { if (open) api.get<Notification[]>('/notifications').then(setItems).catch(() => {}) }, [open])
  const readAll = async () => { await api.post('/notifications/read', {}); refresh(); setItems((x) => x?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null) }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label={t('shell.bell.title')} aria-expanded={open}
              className="relative grid h-9 w-9 place-items-center text-muted-foreground hover:bg-muted">
        <Icon d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />
        {Boolean(me?.unread) && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-late px-1 text-[10px] font-bold leading-4 text-white">{me!.unread > 99 ? '99+' : me!.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] border border-input bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{t('shell.bell.title')}</span>
            <button className="text-xs font-semibold text-accent hover:underline" onClick={readAll}>{t('shell.bell.readAll')}</button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {!items ? <li className="p-4 text-sm text-muted-foreground">…</li> : !items.length ? <li className="p-4 text-sm text-muted-foreground">{t('shell.bell.empty')}</li>
              : items.map((n) => (
                <li key={n.id}>
                  <button className={clsx('block w-full border-b border-border px-3 py-2 text-left hover:bg-muted', !n.read_at && 'bg-accent-veil/60')}
                    onClick={async () => { setOpen(false); if (!n.read_at) { await api.post('/notifications/read', { ids: [n.id] }); refresh() } if (n.link) nav(n.link) }}>
                    <span className="block text-sm font-semibold">{n.title}</span>
                    {n.body && <span className="clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                    <span className="block text-[11px] text-muted-foreground">{fmtRelative(n.created_at)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { me } = useApp()
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const leaving = useSyncExternalStore(watchLeaving, leavingState)
  if (!me) return null
  // La page part vers la déconnexion du Compte Lead : rien ne la renvoie vers la connexion entre-temps, et un 2e clic
  // relance la même sortie, jamais /login (leave, src/lib/arrival.ts). Bouton : « Déconnexion… », désactivé tant que la
  // fermeture de session n'a pas répondu.
  const logout = () => leave(() => api.post<{ redirect: string | null }>('/auth/logout'), (to) => { window.location.href = to })
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 px-1 py-1 hover:bg-muted" aria-label={t('shell.user.account')}>
        <Avatar person={me.user} size={28} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-60 border border-input bg-card py-1 text-sm">
          <div className="border-b border-border px-3 py-2"><p className="font-bold">{me.user.name}</p><p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
            <p className="text-xs text-muted-foreground">{me.account.name}</p></div>
          <Link to="/reglages/profil" onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-muted">{t('shell.user.profile')}</Link>
          <Link to="/reglages" onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-muted">{t('shell.nav.settings')}</Link>
          <button onClick={logout} disabled={Boolean(leaving && !leaving.to)} aria-busy={leaving ? true : undefined}
                  className="block w-full px-3 py-2 text-left hover:bg-muted disabled:cursor-wait disabled:text-muted-foreground">
            {leaving ? t('shell.user.loggingOut') : t('shell.user.logout')}</button>
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { me } = useApp()
  const { locale, t } = useI18n()
  const [menu, setMenu] = useState(false)
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => setMenu(false), [loc.pathname])
  // Une écriture confirmée dans l'Assistant IA : la page ouverte se recharge pour la montrer.
  const [saved, setSaved] = useState(0)
  useEffect(() => {
    const h = () => setSaved((n) => n + 1)
    window.addEventListener('pl:assistant-saved', h)
    return () => window.removeEventListener('pl:assistant-saved', h)
  }, [])
  const side = (
    <nav className="flex flex-col gap-0.5 p-2" aria-label={t('shell.nav.main')}>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'}
          className={({ isActive }) => clsx('flex items-center gap-2.5 px-3 py-2 text-[13.5px] font-semibold',
            isActive ? 'bg-accent-veil text-accent-dark shadow-[inset_3px_0_0_0_hsl(var(--accent))]' : 'text-[#44403c] hover:bg-muted')}>
          <Icon d={n.icon} /><span className="flex-1">{t(n.label)}</span>
          {n.badge === 'inbox' && Boolean(me?.inbox) && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold leading-4 text-white">{me!.inbox}</span>}
        </NavLink>
      ))}
    </nav>
  )
  return (
    // L'organisation ERPlead de l'espace ouvert : les contrôles de la famille vérifient qu'on est bien chez soi.
    <div className="flex min-h-screen" data-lead-org={me?.account.lead_org ?? undefined}>
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-input bg-card lg:flex">
        <div className="flex h-14 items-center border-b border-border px-4"><Brand /></div>
        <div className="flex-1 overflow-y-auto">{side}</div>
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{me?.account.name}</div>
      </aside>
      {menu && (
        <div className="fixed inset-0 z-40 bg-marine-deep/40 lg:hidden" onClick={() => setMenu(false)}>
          <aside className="h-full w-64 overflow-y-auto border-r border-input bg-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 items-center border-b border-border px-4"><Brand /></div>{side}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1 sm:gap-2 border-b border-input bg-card px-3 sm:px-4">
          <button className="grid h-9 w-9 place-items-center hover:bg-muted lg:hidden" aria-label={t('shell.nav.menu')} onClick={() => setMenu(true)}>
            <Icon d="M4 6h16M4 12h16M4 18h16" />
          </button>
          <span className="lg:hidden"><Brand compact /></span>
          <form className="ml-2 hidden max-w-sm flex-1 md:block" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/recherche?q=${encodeURIComponent(q.trim())}`) }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('shell.search.placeholder')} aria-label={t('common.search')}
                   className="w-full border border-input bg-[#f7f5f3] px-3 py-1.5 text-sm focus:border-accent focus:outline-none" />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <Timer />
            <Link to="/recherche" className="grid h-9 w-9 place-items-center text-muted-foreground hover:bg-muted md:hidden" aria-label={t('common.search')}><Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></Link>
            {/* Au téléphone, le globe seul (le nom de la langue dès 640 px) : la barre reste lisible à 375 px. */}
            <LanguageSelect className="max-sm:[&_select]:w-9 max-sm:[&_select]:pl-0 max-sm:[&_select]:text-transparent max-sm:[&_option]:text-foreground" />
            <Bell />
            <AppSwitcher locale={locale} />
            <UserMenu />
          </div>
        </header>
        {/* En bas, la place de la bulle de l'Assistant IA : rien du contenu ne reste caché dessous. */}
        <main key={saved} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-5 sm:px-6">{children}</main>
      </div>
      <Assistant />
    </div>
  )
}
