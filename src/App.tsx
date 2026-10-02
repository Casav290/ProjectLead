import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner, Toaster } from './components/ui'
import { AppProvider, useApp } from './lib/store'
import Login from './pages/Login'
import Signup from './pages/Signup'

/** Chaque page se charge à l'ouverture : l'écran de connexion et l'accueil partent plus vite. */
const Invitation = lazy(() => import('./pages/Invitation'))
const Portal = lazy(() => import('./pages/Portal'))
const Booking = lazy(() => import('./pages/Booking'))
const BookingManage = lazy(() => import('./pages/BookingManage'))
const IntakeForm = lazy(() => import('./pages/IntakeForm'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const MyTasks = lazy(() => import('./pages/MyTasks'))
const Projects = lazy(() => import('./pages/Projects'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const Templates = lazy(() => import('./pages/Templates'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Agenda = lazy(() => import('./pages/Agenda'))
const Time = lazy(() => import('./pages/Time'))
const Workload = lazy(() => import('./pages/Workload'))
const Reports = lazy(() => import('./pages/Reports'))
const Clients = lazy(() => import('./pages/Clients'))
const ClientDetail = lazy(() => import('./pages/ClientDetail'))
const Billing = lazy(() => import('./pages/Billing'))
const Settings = lazy(() => import('./pages/Settings'))
const Search = lazy(() => import('./pages/Search'))
const Legal = lazy(() => import('./pages/Legal'))

/** Les pages publiques s'ouvrent avec ou sans session : le client n'a pas de compte. */
const PUBLIC = [
  { path: '/suivi/:token', el: <Portal /> },
  { path: '/rdv/gerer/:token', el: <BookingManage /> },
  { path: '/rdv/:slug', el: <Booking /> },
  { path: '/demande/:slug', el: <IntakeForm /> },
  { path: '/invitation/:token', el: <Invitation /> },
  { path: '/confidentialite', el: <Legal kind="privacy" /> },
  { path: '/conditions', el: <Legal kind="terms" /> },
]

function Routed() {
  const { me, loading } = useApp()
  const loc = useLocation()
  const isPublic = /^\/(suivi|rdv|demande|invitation)\/|^\/(confidentialite|conditions)$/.test(loc.pathname)
  if (isPublic) return <Routes>{PUBLIC.map((p) => <Route key={p.path} path={p.path} element={p.el} />)}</Routes>
  if (loading) return <Spinner />
  if (!me) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  return (
    <Layout>
      {/* Le cadre reste en place pendant le chargement d'une page. */}
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/taches" element={<MyTasks />} />
        <Route path="/projets" element={<Projects />} />
        <Route path="/projets/:id/*" element={<ProjectDetail />} />
        <Route path="/modeles" element={<Templates />} />
        <Route path="/emails" element={<Inbox />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/temps" element={<Time />} />
        <Route path="/charge" element={<Workload />} />
        <Route path="/rapports" element={<Reports />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/facturation" element={<Billing />} />
        <Route path="/reglages/*" element={<Settings />} />
        <Route path="/recherche" element={<Search />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/signup" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Suspense fallback={<Spinner />}>
        <Routed />
      </Suspense>
      <Toaster />
    </AppProvider>
  )
}
