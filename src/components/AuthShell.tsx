import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Écran de connexion commun aux applications Lead (Trait net, « Écran de connexion commun »,
 * décision d'Ève du 24.09.2026) : marque centrée et accroche, panneau blanc de 420 px bordé de
 * #cfcac4, titre à gauche, liens légaux sous le panneau. Seules la couleur (ocre) et les
 * initiales changent d'une application à l'autre.
 */
export function AuthShell({ title, children, subtitle }: { title?: string; children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="text-center">
          <p className="inline-flex items-center gap-3 text-[28px] font-extrabold leading-none tracking-[-.025em]">
            <span aria-hidden="true" className="grid h-10 w-10 place-items-center bg-brand text-base text-white">PL</span>
            ProjectLead
          </p>
          <p className="mt-2 text-[15px] text-muted-foreground">La gestion de projet après la signature</p>
        </div>
        <div className="mt-8 border border-input bg-card p-6 sm:p-10">
          {title && <h1 className="mb-6 text-left text-[28px] font-extrabold leading-tight tracking-[-.025em] [overflow-wrap:anywhere]">{title}</h1>}
          {subtitle && <div className="-mt-3 mb-6 text-sm text-muted-foreground">{subtitle}</div>}
          {children}
        </div>
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          <Link to="/confidentialite" className="hover:underline">Confidentialité</Link>
          {' · '}
          <Link to="/conditions" className="hover:underline">Conditions d'utilisation</Link>
        </p>
      </div>
    </div>
  )
}

/** Un champ du gabarit : libellé 14 px 600 au-dessus, sans icône dans le champ. */
export function AuthField({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** « Pas encore de compte ? Créer un compte », « Retour à la connexion »… : centré, lien ocre. */
export function AuthSwitch({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-sm text-muted-foreground">{children}</p>
}

export const authLink = 'font-semibold text-accent hover:text-accent-dark hover:underline'
