import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TourEnd, TourStep } from './types'

/**
 * Quand la visite s'ouvre (04.11.2026) :
 * - seule, au PREMIER passage d'une personne : le serveur le dit (`due`, users.tour_pending, db/034) ; dès qu'elle
 *   s'ouvre, `markSeen` le retient côté serveur (une seule fois, sur tous les appareils, app mobile comprise) et dans
 *   ce navigateur (au cas où l'envoi échoue) ;
 * - à la demande, par « Revoir la visite » (`start()`), autant de fois qu'on veut, sans rien écrire.
 * Les personnes déjà là avant la visite ont `due` faux : rien ne s'ouvre seul, elles la lancent quand elles veulent.
 */
const Tour = lazy(() => import('./Tour'))

type Ctx = { start: () => void; open: boolean }
const TourCtx = createContext<Ctx>({ start: () => {}, open: false })
export const useTour = () => useContext(TourCtx)

const seenKey = (user: string) => `lead.tour.seen.${user}`
const seenHere = (user: string) => { try { return localStorage.getItem(seenKey(user)) === '1' } catch { return false } }
const keepHere = (user: string) => { try { localStorage.setItem(seenKey(user), '1') } catch { /* navigation privée */ } }

type Props = {
  children: ReactNode
  /** La personne connectée (null : rien ne s'ouvre). */
  userId: string | null
  /** La visite est due (premier passage, drapeau du serveur). */
  due: boolean
  steps: TourStep[]
  t: (key: string, vars?: Record<string, unknown>) => string
  /** Retenir côté serveur que la visite s'est ouverte (POST). */
  markSeen: () => Promise<unknown>
  onMenu?: (open: boolean) => void
  /** Attente avant l'ouverture automatique : la page a le temps de se poser. */
  delay?: number
}

export function TourProvider({ children, userId, due, steps, t, markSeen, onMenu, delay = 900 }: Props) {
  const [open, setOpen] = useState(false)
  const auto = useRef<string | null>(null)
  const start = useCallback(() => setOpen(true), [])

  useEffect(() => {
    if (!userId || !due || auto.current === userId || seenHere(userId)) return
    auto.current = userId
    const id = window.setTimeout(() => {
      keepHere(userId)
      markSeen().catch(() => { /* hors connexion : ce navigateur s'en souvient quand même */ })
      setOpen(true)
    }, delay)
    return () => { clearTimeout(id); if (auto.current === userId) auto.current = null }
  }, [userId, due, delay, markSeen])

  const onEnd = useCallback((_why: TourEnd) => setOpen(false), [])
  const value = useMemo(() => ({ start, open }), [start, open])
  return (
    <TourCtx.Provider value={value}>
      {children}
      {open && steps.length > 0 && <Suspense fallback={null}><Tour steps={steps} t={t} onEnd={onEnd} onMenu={onMenu} /></Suspense>}
    </TourCtx.Provider>
  )
}
