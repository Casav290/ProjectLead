import clsx from 'clsx'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ApiKeys from '../components/settings/ApiKeys'
import Automations from '../components/settings/Automations'
import BookingTypes from '../components/settings/BookingTypes'
import Calendars from '../components/settings/Calendars'
import Company from '../components/settings/Company'
import Forms from '../components/settings/Forms'
import Integrations from '../components/settings/Integrations'
import Mailboxes from '../components/settings/Mailboxes'
import Profile from '../components/settings/Profile'
import Team from '../components/settings/Team'
import { useRole } from '../components/settings/kit'

/** Les réglages : un menu à gauche, la page à droite ; au téléphone, la liste puis la page. */

type Item = { to: string; label: string; hint: string; admin?: boolean }
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Vous', items: [
    { to: 'profil', label: 'Profil', hint: 'Nom, couleur, mot de passe' },
    { to: 'emails', label: 'Emails', hint: 'Boîtes branchées, adresse de capture' },
    { to: 'agendas', label: 'Agendas', hint: 'Lien iCal, agendas extérieurs' },
  ] },
  { title: 'Entreprise', items: [
    { to: 'entreprise', label: 'Entreprise', hint: 'Nom, fuseau, devise, signature', admin: true },
    { to: 'equipe', label: 'Équipe', hint: 'Membres, invitations, équipes' },
    { to: 'integrations', label: 'Intégrations', hint: 'CRMlead, InvoiceLead, Compte Lead', admin: true },
  ] },
  { title: 'Travail', items: [
    { to: 'rendez-vous', label: 'Rendez-vous', hint: 'Pages de prise de rendez-vous' },
    { to: 'formulaires', label: 'Formulaires', hint: 'Demandes qui ouvrent un projet' },
    { to: 'automatisations', label: 'Automatisations', hint: 'Quand … alors …' },
    { to: 'api', label: 'API', hint: "Clés d'accès et documentation" },
  ] },
]

function Menu({ list }: { list?: boolean }) {
  const { isAdmin } = useRole()
  return (
    <nav aria-label="Réglages" className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-3 text-[11px] font-extrabold uppercase tracking-[.08em] text-muted-foreground">{g.title}</p>
          <ul className={clsx(list && 'divide-y divide-border border border-border bg-card')}>
            {g.items.filter((i) => isAdmin || !i.admin).map((i) => (
              <li key={i.to}>
                <NavLink to={`/reglages/${i.to}`}
                  className={({ isActive }) => clsx('block px-3', list ? 'py-3' : 'border-l-2 py-1.5 text-[13.5px]',
                    !list && (isActive ? 'border-accent bg-accent-veil font-bold text-accent-dark' : 'border-transparent hover:bg-muted'))}>
                  {list ? <span className="flex items-center justify-between gap-3">
                    <span><span className="block font-bold">{i.label}</span><span className="block text-xs text-muted-foreground">{i.hint}</span></span>
                    <span aria-hidden="true" className="text-muted-foreground">›</span>
                  </span> : i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export default function Settings() {
  const { pathname } = useLocation()
  const { isAdmin } = useRole()
  const index = /^\/reglages\/?$/.test(pathname)
  const adminOnly = (el: JSX.Element) => (isAdmin ? el : <Navigate to="/reglages/profil" replace />)

  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <aside className={clsx(index ? 'block' : 'hidden', 'lg:block')}>
        <h1 className="mb-4 font-display text-2xl">Réglages</h1>
        <div className="lg:hidden"><Menu list /></div>
        <div className="hidden lg:sticky lg:top-4 lg:block"><Menu /></div>
      </aside>
      <div className={clsx('min-w-0', index && 'hidden lg:block')}>
        {!index && <Link to="/reglages" className="mb-3 inline-block text-xs font-semibold text-muted-foreground hover:text-foreground lg:hidden">← Réglages</Link>}
        <Routes>
          <Route index element={<Profile />} />
          <Route path="profil" element={<Profile />} />
          <Route path="entreprise" element={adminOnly(<Company />)} />
          <Route path="equipe" element={<Team />} />
          <Route path="emails" element={<Mailboxes />} />
          <Route path="agendas" element={<Calendars />} />
          <Route path="rendez-vous" element={<BookingTypes />} />
          <Route path="formulaires" element={<Forms />} />
          <Route path="automatisations" element={<Automations />} />
          <Route path="integrations" element={adminOnly(<Integrations />)} />
          <Route path="api" element={<ApiKeys />} />
          <Route path="*" element={<Navigate to="/reglages" replace />} />
        </Routes>
      </div>
    </div>
  )
}
