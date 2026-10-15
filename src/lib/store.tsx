import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { isLeaving, stopLeaving } from './arrival'
import type { Me, Member } from './types'

/** L'état commun : la personne connectée, son entreprise, et l'équipe (pour les sélecteurs). */
type Store = {
  me: Me | null; loading: boolean; refresh: () => Promise<void>
  team: Member[]; refreshTeam: () => Promise<void>
}
const Ctx = createContext<Store>({ me: null, loading: true, refresh: async () => {}, team: [], refreshTeam: async () => {} })

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<Member[]>([])
  // Pendant « Se déconnecter » (src/lib/arrival.ts, startLeaving), un 401 ne ferme pas l'espace : l'écran de connexion
  // repartirait vers le Compte Lead et couperait sa déconnexion encore en route.
  const refresh = useCallback(async () => {
    if (isLeaving()) return
    try { setMe(await api.get<Me>('/me')) } catch { if (!isLeaving()) setMe(null) } finally { setLoading(false) }
  }, [])
  const refreshTeam = useCallback(async () => {
    try { setTeam((await api.get<{ members: Member[] }>('/team')).members) } catch { /* hors connexion */ }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (me) refreshTeam() }, [me?.user.id, refreshTeam])
  useEffect(() => {
    const h = () => { if (!isLeaving()) setMe(null) }
    window.addEventListener('pl:unauthenticated', h)
    return () => window.removeEventListener('pl:unauthenticated', h)
  }, [])
  // La page quittée par « Se déconnecter » revient du cache arrière (bouton Précédent) : elle relit la session.
  useEffect(() => {
    const h = (e: PageTransitionEvent) => { if (e.persisted && isLeaving()) { stopLeaving(); refresh() } }
    window.addEventListener('pageshow', h)
    return () => window.removeEventListener('pageshow', h)
  }, [refresh])
  // Le compteur de notifications et le chronomètre restent à jour sans recharger la page.
  useEffect(() => {
    if (!me) return
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [me?.user.id, refresh])
  return <Ctx.Provider value={{ me, loading, refresh, team, refreshTeam }}>{children}</Ctx.Provider>
}

export const useApp = () => useContext(Ctx)

/** Charger une ressource de l'API, avec rechargement à la demande. */
export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const reload = useCallback(async () => {
    if (!path) return
    setLoading(true)
    try { setData(await api.get<T>(path)); setError(null) } catch (e) { setError(e) } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])
  useEffect(() => { reload() }, [reload])
  return { data, setData, error, loading, reload }
}
