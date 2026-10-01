import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner, Toaster } from './components/ui'
import { AppProvider, useApp } from './lib/store'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Invitation from './pages/Invitation'
import Portal from './pages/Portal'
import Booking from './pages/Booking'
import BookingManage from './pages/BookingManage'
import IntakeForm from './pages/IntakeForm'
import Dashboard from './pages/Dashboard'
import MyTasks from './pages/MyTasks'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Templates from './pages/Templates'
import Inbox from './pages/Inbox'
import Agenda from './pages/Agenda'
import Time from './pages/Time'
import Workload from './pages/Workload'
import Reports from './pages/Reports'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Billing from './pages/Billing'
import Settings from './pages/Settings'
import Search from './pages/Search'

/** Les pages publiques s'ouvrent avec ou sans session : le client n'a pas de compte. */
const PUBLIC = [
  { path: '/suivi/:token', el: <Portal /> },
  { path: '/rdv/gerer/:token', el: <BookingManage /> },
  { path: '/rdv/:slug', el: <Booking /> },
  { path: '/demande/:slug', el: <IntakeForm /> },
  { path: '/invitation/:token', el: <Invitation /> },
]

function Routed() {
  const { me, loading } = useApp()
  const loc = useLocation()
  const isPublic = /^\/(suivi|rdv|demande|invitation)\//.test(loc.pathname)
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
    </Layout>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Routed />
      <Toaster />
    </AppProvider>
  )
}
