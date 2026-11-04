import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { TourArt } from './art'
import type { TourEnd, TourStep } from './types'
import './tour.css'

/**
 * Le moteur de la visite guidée (commun aux applications Lead, aucun texte propre à une application) : fond assombri
 * avec une découpe nette autour de la vraie zone de l'écran, quatre coins de cadrage qui glissent d'une zone à l'autre,
 * et une carte posée à côté (bureau) ou en bas de l'écran (téléphone, en haut si la zone est en bas).
 *
 * Jamais bloquant : « Passer » à chaque étape, Échap ferme, un clic sur la zone montrée ferme la visite et ouvre la
 * zone. Clavier : flèches et Entrée. prefers-reduced-motion : la découpe saute, rien ne s'anime.
 */

type Rect = { x: number; y: number; w: number; h: number }
type Props = {
  steps: TourStep[]
  t: (key: string, vars?: Record<string, unknown>) => string
  onEnd: (why: TourEnd) => void
  /** Ouvrir ou refermer le menu latéral (écran étroit) quand la zone y vit. */
  onMenu?: (open: boolean) => void
}

const PAD = 6            // marge de la découpe autour de la zone
const GAP = 14           // entre la découpe et la carte
const EDGE = 12          // bord de l'écran
const NARROW = 640       // en dessous : carte en bas (ou en haut) de l'écran, pleine largeur
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = (x: number) => 1 - Math.pow(1 - x, 3.2)
const vw = () => document.documentElement.clientWidth
const vh = () => window.innerHeight

/** Les éléments visibles d'un sélecteur (affichés, dans l'écran, non nuls). */
function visible(selector: string): Element[] {
  return [...document.querySelectorAll(selector)].filter((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw() || r.top >= vh()) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  })
}

/** La zone d'une étape : l'enveloppe de ses éléments visibles (le premier visible par sélecteur), ou null. */
export function stepTargets(step: TourStep): Element[] {
  if (!step.target) return []
  const sels = Array.isArray(step.target) ? step.target : [step.target]
  return sels.map((s) => visible(s)[0]).filter(Boolean) as Element[]
}
function unionRect(els: Element[]): Rect | null {
  if (!els.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom)
  }
  // La découpe reste dans l'écran (jamais de défilement horizontal).
  const X1 = Math.max(2, x1 - PAD), Y1 = Math.max(2, y1 - PAD), X2 = Math.min(vw() - 2, x2 + PAD), Y2 = Math.min(vh() - 2, y2 + PAD)
  return { x: X1, y: Y1, w: X2 - X1, h: Y2 - Y1 }
}
const centerRect = (): Rect => ({ x: vw() / 2, y: vh() / 2, w: 0, h: 0 })
const same = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5

/** Où poser la carte : à côté de la découpe sur un grand écran ; en bas (ou en haut) de l'écran sur un petit. */
function place(hole: Rect | null, card: { w: number; h: number }): { x: number; y: number; docked: boolean } {
  const W = vw(), H = vh()
  if (W < NARROW) {
    const w = W - 2 * EDGE
    const bottom = H - card.h - EDGE
    // En bas, sauf si la découpe y serait cachée : alors en haut.
    if (!hole || hole.y + hole.h <= bottom - 8) return { x: EDGE, y: bottom, docked: true }
    if (hole.y >= card.h + EDGE + 8) return { x: EDGE, y: EDGE, docked: true }
    return { x: EDGE, y: hole.y + hole.h / 2 > H / 2 ? EDGE : bottom, docked: true && w > 0 }
  }
  if (!hole) return { x: (W - card.w) / 2, y: Math.max(EDGE, (H - card.h) / 2), docked: false }
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), H - card.h - EDGE)
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), W - card.w - EDGE)
  const cy = clampY(hole.y + hole.h / 2 - card.h / 2)
  if (hole.x + hole.w + GAP + card.w <= W - EDGE) return { x: hole.x + hole.w + GAP, y: cy, docked: false }
  if (hole.x - GAP - card.w >= EDGE) return { x: hole.x - GAP - card.w, y: cy, docked: false }
  const cx = clampX(hole.x + hole.w / 2 - card.w / 2)
  if (hole.y + hole.h + GAP + card.h <= H - EDGE) return { x: cx, y: hole.y + hole.h + GAP, docked: false }
  return { x: cx, y: Math.max(EDGE, hole.y - GAP - card.h), docked: false }
}

/** Les quatre coins de cadrage autour de la découpe. */
function marks(r: Rect): string {
  const o = 5, l = Math.max(6, Math.min(14, r.w / 3, r.h / 3))
  // Les coins restent dans l'écran, même pour une zone collée au bord (menu du téléphone).
  const x1 = Math.max(1.5, r.x - o), y1 = Math.max(1.5, r.y - o), x2 = Math.min(vw() - 1.5, r.x + r.w + o), y2 = Math.min(vh() - 1.5, r.y + r.h + o)
  return `M${x1} ${y1 + l}V${y1}H${x1 + l}M${x2 - l} ${y1}H${x2}V${y1 + l}M${x2} ${y2 - l}V${y2}H${x2 - l}M${x1 + l} ${y2}H${x1}V${y2 - l}`
}

export default function Tour({ steps, t, onEnd, onMenu }: Props) {
  const [i, setI] = useState(0)
  const [hole, setHole] = useState<Rect>(centerRect)       // la découpe affichée (animée)
  const [goal, setGoal] = useState<Rect | null>(null)       // la découpe visée (null : pas de zone)
  const [pos, setPos] = useState<{ x: number; y: number; docked: boolean } | null>(null)
  const [entering, setEntering] = useState(true)
  const card = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const anim = useRef(0)
  const holeRef = useRef(hole)
  holeRef.current = hole
  const menuOpen = useRef(false)
  const dir = useRef(1)
  const step = steps[i]
  const last = i === steps.length - 1

  const setMenu = useCallback((open: boolean) => {
    if (menuOpen.current === open) return
    menuOpen.current = open
    onMenu?.(open)
  }, [onMenu])

  const end = useCallback((why: TourEnd) => {
    cancelAnimationFrame(anim.current)
    if (why !== 'target') setMenu(false)
    onEnd(why)
  }, [onEnd, setMenu])

  // Chaque étape : le menu ouvert ou refermé, puis la zone cherchée (une zone absente fait passer l'étape).
  useEffect(() => {
    if (!step) return
    let cancelled = false
    const find = (tries: number) => {
      if (cancelled) return
      if (!step.target) { setGoal(null); return }
      const els = stepTargets(step)
      // Écran étroit : la zone vit dans le menu replié, la visite l'ouvre et cherche encore.
      if (!els.length && step.inMenu && !menuOpen.current) { setMenu(true); setTimeout(() => find(tries), 60); return }
      if (!els.length) {
        if (tries > 0) { setTimeout(() => find(tries - 1), 120); return }
        // Zone introuvable (écran inhabituel) : on n'arrête jamais la visite, on va à l'étape suivante.
        const next = i + dir.current
        if (next >= 0 && next < steps.length) setI(next); else end('done')
        return
      }
      setGoal(unionRect(els))
    }
    if (!step.target || !step.inMenu) setMenu(false)
    requestAnimationFrame(() => requestAnimationFrame(() => find(6)))
    return () => { cancelled = true }
  }, [i, step, steps.length, setMenu, end])

  // La découpe glisse vers la zone visée.
  useEffect(() => {
    const to = goal ?? centerRect()
    const from = holeRef.current
    cancelAnimationFrame(anim.current)
    if (reduced() || same(from, to)) { setHole(to); return }
    const t0 = performance.now(), D = 440
    const tick = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / D))
      setHole({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k })
      if (k < 1) anim.current = requestAnimationFrame(tick)
    }
    anim.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(anim.current)
  }, [goal])

  // La carte se place selon la zone visée (pas la découpe en mouvement : elle part tout de suite vers sa place).
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(place(goal, { w: r.width, h: r.height }))
  }, [goal, i])

  // L'écran change (rotation, clavier, fenêtre) ou la page bouge : on remesure.
  useEffect(() => {
    const again = () => {
      if (!step) return
      const g = step.target ? unionRect(stepTargets(step)) : null
      setGoal((prev) => (g && prev && same(g, prev)) || (!g && !prev) ? prev : g)
      const el = card.current
      if (el) { const r = el.getBoundingClientRect(); setPos(place(g, { w: r.width, h: r.height })) }
    }
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    const id = window.setInterval(again, 400)
    return () => { window.removeEventListener('resize', again); window.removeEventListener('scroll', again, true); clearInterval(id) }
  }, [step])

  // Première image : la carte apparaît en place ; puis le focus va au bouton principal de chaque étape.
  useEffect(() => { const id = requestAnimationFrame(() => setEntering(false)); return () => cancelAnimationFrame(id) }, [])
  useEffect(() => { primary.current?.focus({ preventScroll: true }) }, [i])
  // En partant (passer, terminer, quitter la page), le menu ouvert par la visite se referme.
  useEffect(() => () => { if (menuOpen.current) onMenu?.(false) }, [onMenu])

  const go = (d: number) => {
    dir.current = d
    const n = i + d
    if (n < 0) return
    if (n >= steps.length) { end('done'); return }
    setI(n)
  }
  // Le clavier, où que soit le focus : Échap passe, les flèches avancent ou reviennent.
  const keys = useRef<(e: globalThis.KeyboardEvent) => void>(() => {})
  const [kbd, setKbd] = useState(false)
  keys.current = (e) => {
    if (!kbd && (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter')) setKbd(true)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end('skip') }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
  }
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => keys.current(e)
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [])
  // Un clic sur la zone montrée : la visite se ferme et la zone s'ouvre (on ne retient jamais quelqu'un de pressé).
  const onVeil = (e: MouseEvent) => {
    if (!goal) return
    const inside = e.clientX >= goal.x && e.clientX <= goal.x + goal.w && e.clientY >= goal.y && e.clientY <= goal.y + goal.h
    if (!inside) return
    const el = stepTargets(step).find((x) => { const r = x.getBoundingClientRect(); return e.clientX >= r.left - PAD && e.clientX <= r.right + PAD && e.clientY >= r.top - PAD && e.clientY <= r.bottom + PAD })
    end('target')
    ;(el as HTMLElement | undefined)?.click()
  }

  if (!step) return null
  const W = typeof window === 'undefined' ? 0 : vw(), H = typeof window === 'undefined' ? 0 : vh()
  const shade = `M0 0H${W}V${H}H0Z M${hole.x} ${hole.y}V${hole.y + hole.h}H${hole.x + hole.w}V${hole.y}Z`
  const docked = pos?.docked ?? W < NARROW
  return (
    <div className="plt-root" data-kbd={kbd ? '' : undefined} onPointerDown={() => kbd && setKbd(false)} data-tour-open data-tour-step={step.id} data-entering={entering || !pos ? '' : undefined}>
      <svg className="plt-veil" width={W} height={H} onClick={onVeil} aria-hidden="true">
        <path className="plt-shade" fillRule="evenodd" d={shade} />
        {goal && hole.w > 1 && <path className="plt-marks" d={marks(hole)} />}
        {goal && <rect className="plt-hit" x={goal.x} y={goal.y} width={goal.w} height={goal.h} />}
      </svg>
      <div ref={card} className="plt-card" role="dialog" aria-modal="false" aria-labelledby="plt-title" aria-describedby="plt-text"
           data-docked={docked ? '' : undefined} tabIndex={-1}
           style={{ transform: `translate3d(${Math.round(pos?.x ?? 0)}px, ${Math.round(pos?.y ?? 0)}px, 0)`, ...(docked ? { width: W - 2 * EDGE } : {}) }}>
        {step.art && <div className="plt-art" key={`art-${step.id}`}><TourArt name={step.art} /></div>}
        <div className="plt-body">
          <div className="plt-kicker" aria-hidden="true">
            {steps.map((s, k) => <span key={s.id} className="plt-seg" data-on={k <= i ? '' : undefined}><i /></span>)}
          </div>
          <p className="plt-sr" aria-live="polite">{t('tour.progress', { n: i + 1, total: steps.length })}</p>
          <h2 id="plt-title" key={`t-${step.id}`} className="plt-title plt-in">{t(step.title)}</h2>
          <p id="plt-text" key={`b-${step.id}`} className="plt-text plt-in-2">{t(step.body)}</p>
          <div className="plt-actions plt-in-2" key={`a-${step.id}`}>
            <button type="button" className="plt-skip" onClick={() => end('skip')} data-tour-skip>{t('tour.skip')}</button>
            {i > 0 && <button type="button" className="plt-btn" onClick={() => go(-1)} data-tour-back>{t('tour.back')}</button>}
            {step.action && (
              <button type="button" className="plt-btn" data-tour-action
                      onClick={() => { const run = step.action!.run; end('action'); setTimeout(run, 60) }}>{t(step.action.label)}</button>
            )}
            <button ref={primary} type="button" className="plt-btn" data-primary="" data-tour-next onClick={() => go(1)}>
              {i === 0 ? t('tour.start') : last ? t('tour.done') : t('tour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
