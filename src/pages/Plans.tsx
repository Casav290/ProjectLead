import { Link, Navigate } from 'react-router-dom'
import { isNativeApp } from '../lib/native'
import { euros, PLAN_FEATURES, PLAN_NAME, PLAN_PRICES, type Tier } from '../lib/plans'

/**
 * Les formules ProjectLead, page publique (`/formules`, ouverte avec ou sans session) : « Voir les formules » d'un
 * écran de refus « places » y mène (suites de l'abonnement, 15.10.2026, point 6a). Rien ne s'y achète : la formule se
 * prend dans ProjectLead, par un administrateur (Réglages → Entreprise), et ne vaut que pour ProjectLead.
 */
export default function Plans() {
  // Dans l'app mobile, pas de page de prix (règle 3.1.1 d'Apple) : retour à l'espace.
  if (isNativeApp) return <Navigate to="/" replace />
  const card = (p: Tier) => (
    <article key={p} className="flex flex-col border border-input bg-card p-5">
      <h2 className="text-lg font-extrabold">{PLAN_NAME[p]}</h2>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-2xl font-extrabold leading-none tracking-[-.02em]">{euros(p === 'free' ? 0 : PLAN_PRICES[p].month)}</span>
        <span className="text-xs text-muted-foreground">{p === 'free' ? 'sans limite de durée' : '/ mois HT'}</span>
      </p>
      <p className="mt-1 h-4 text-xs text-muted-foreground">{p === 'free' ? '' : `ou ${euros(PLAN_PRICES[p].year)} / an HT (2 mois offerts)`}</p>
      <ul className="mt-4 flex-1 space-y-1.5 text-sm">
        {PLAN_FEATURES[p].map((f) => <li key={f} className="flex gap-2"><span aria-hidden className="text-accent">—</span>{f}</li>)}
      </ul>
    </article>
  )
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <main className="mx-auto w-full max-w-[960px]">
        <p className="inline-flex items-center gap-3 text-[28px] font-extrabold leading-none tracking-[-.025em]">
          <span aria-hidden="true" className="grid h-10 w-10 place-items-center bg-brand text-base text-white">PL</span>
          ProjectLead
        </p>
        <h1 className="mt-8 text-[28px] font-extrabold leading-tight tracking-[-.025em]">Les formules ProjectLead</h1>
        <p className="mt-2 max-w-[640px] text-[15px] text-muted-foreground">
          Toutes les fonctions de ProjectLead dans chaque formule : ce qui change, ce sont les quantités. Pro+ donne jusqu'à
          5 places à votre entreprise ; Gratuit et Pro, 1 place.</p>
        <div className="mt-6 grid gap-3 md:grid-cols-3">{card('free')}{card('pro')}{card('pro_plus')}</div>
        <p className="mt-6 max-w-[640px] text-sm text-muted-foreground">
          La formule ProjectLead se prend dans ProjectLead, par un administrateur de votre entreprise (Réglages → Entreprise),
          et ne vaut que pour ProjectLead. Prix hors taxes, en euros ; paiement sécurisé par Stripe, résiliable à tout moment.</p>
        <p className="mt-6 text-sm"><Link to="/login" className="font-semibold text-accent hover:text-accent-dark hover:underline">Ouvrir ProjectLead</Link></p>
        <p className="mt-10 text-[13px] text-muted-foreground">
          <Link to="/confidentialite" className="hover:underline">Confidentialité</Link>
          {' · '}
          <Link to="/conditions" className="hover:underline">Conditions d'utilisation</Link>
        </p>
      </main>
    </div>
  )
}
