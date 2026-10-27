import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { getLocale } from '../i18n'
import { HERE_APP, LEAD_FAMILY, leadLocale } from '../lib/leadFamily'

/**
 * Le lanceur à 9 points de la famille Lead (demande d'Ève du 13.10.2026), le même dans les six applications : les six
 * applications, toujours dans le même ordre (src/lib/leadFamily.ts), aucune cachée ni bloquée par la formule. Chaque
 * entrée est un lien simple vers l'adresse d'entrée de l'autre application, dans le même onglet : avec la session
 * ERPlead ouverte, on arrive directement dans l'espace de son entreprise. ProjectLead reste à sa place, sans lien,
 * « Vous êtes ici ».
 *
 * Panneau de 320 px aligné à droite ; sous 480 px, fixé à 16 px des bords, sous l'en-tête, avec son propre défilement.
 * Se ferme par Échap (le focus revient au bouton à 9 points), par un clic ou un toucher en dehors (le focus revient au
 * bouton s'il se perdait), ou par le choix d'une entrée (audit CNX-12). Les pastilles de deux lettres sont décoratives
 * (aria-hidden) : le nom de l'application les suit (CNX-13). Points d'accroche des contrôles : `data-lead-launcher` sur
 * le bouton, `data-lead-app` sur chaque entrée.
 */
export type LauncherEvent = { type: string; key?: string; target?: unknown }

/**
 * Ce qu'un événement du document fait au lanceur ouvert : Échap le ferme et rend le focus au bouton ; un clic ou un
 * toucher hors du lanceur le ferme (le focus ne revient au bouton que s'il se perd) ; le reste ne change rien.
 */
export function launcherDismiss(e: LauncherEvent, inside: (target: unknown) => boolean): { close: boolean; refocus?: 'always' | 'if-lost' } {
  if (e.type === 'keydown') return e.key === 'Escape' ? { close: true, refocus: 'always' } : { close: false }
  if (e.type === 'pointerdown' || e.type === 'mousedown') return inside(e.target) ? { close: false } : { close: true, refocus: 'if-lost' }
  return { close: false }
}

export default function AppSwitcher({ locale, initialOpen = false }: { locale?: string | null; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  // La langue de l'interface (Layout passe useI18n().locale) ; sans elle, la langue en cours.
  const l = leadLocale(locale ?? getLocale())
  const title = LEAD_FAMILY.title[l]
  useEffect(() => {
    if (!open) return
    const onEvent = (e: Event) => {
      const d = launcherDismiss(e as LauncherEvent, (t) => Boolean(box.current?.contains(t as Node)))
      if (!d.close) return
      setOpen(false)
      if (d.refocus === 'always') button.current?.focus()
      // Clic en dehors : le focus suit ce qui a été cliqué ; s'il se perd (fond de page), il revient au bouton.
      else setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) button.current?.focus() }, 0)
    }
    document.addEventListener('pointerdown', onEvent); document.addEventListener('keydown', onEvent)
    return () => { document.removeEventListener('pointerdown', onEvent); document.removeEventListener('keydown', onEvent) }
  }, [open])
  const choose = () => { setOpen(false); button.current?.focus() }

  return (
    <div ref={box} className="relative">
      <button ref={button} type="button" data-lead-launcher onClick={() => setOpen(!open)} aria-expanded={open} aria-label={title} title={title}
              className="grid h-11 w-11 place-items-center text-muted-foreground hover:bg-muted min-[480px]:h-9 min-[480px]:w-9">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          {[4, 12, 20].flatMap((x) => [4, 12, 20].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />))}
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label={title}
             className="fixed left-4 right-4 top-16 z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto border border-input bg-card p-2
                        min-[480px]:absolute min-[480px]:left-auto min-[480px]:right-0 min-[480px]:top-11 min-[480px]:w-80 min-[480px]:max-h-[calc(100dvh-4rem)]">
          <p className="px-2 py-1 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{title}</p>
          <ul>
            {LEAD_FAMILY.apps.map((a) => {
              const here = a.code === HERE_APP
              const body = (
                <>
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center text-xs font-extrabold text-white" style={{ background: a.color }}>
                    {a.mark}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{a.name}</span>
                    <span className="block text-xs text-muted-foreground">{a.do[l]}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs font-semibold">{here ? LEAD_FAMILY.here[l] : `${LEAD_FAMILY.open[l]} →`}</span>
                </>
              )
              const row = 'flex min-h-12 items-center gap-3 px-2 py-2'
              return (
                <li key={a.code}>
                  {here ? (
                    <div data-lead-app={a.code} aria-current="page" className={row} style={{ background: `${a.color}1a` }}>{body}</div>
                  ) : (
                    <a data-lead-app={a.code} href={a.entry} onClick={choose} className={clsx(row, 'hover:bg-muted')}>{body}</a>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
