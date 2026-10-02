import type { Plan } from '../lib/types'
import { Card } from './ui'

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/**
 * La formule de la famille Lead : tout le monde entre, la formule fixe seulement les quantités
 * (server/lib/plans.ts). Rien pour une entreprise sans Compte Lead : elle n'a pas de formule.
 */
export function PlanCard({ plan }: { plan: Plan }) {
  if (!plan.linked) return null
  const seats = plan.seats === null ? 'sans limite' : plural(plan.seats, 'personne', 'personnes')
  const seatsFull = plan.seats !== null && plan.members + plan.invited >= plan.seats
  return (
    <Card title="Formule">
      <div className="space-y-3 p-4 text-sm">
        <p><span className="font-bold">{plan.name}</span>
          {plan.tier === 'free' && <span className="text-muted-foreground"> : toutes les fonctions de ProjectLead, en plus petite quantité.</span>}</p>
        <ul className="space-y-1">
          <li>Projets en cours : <span className="font-semibold tabular-nums">{plan.openProjects}</span>
            {plan.projectLimit !== null ? <> sur {plan.projectLimit}</> : <span className="text-muted-foreground"> (sans limite)</span>}</li>
          <li>Personnes : <span className="font-semibold tabular-nums">{plan.members + plan.invited}</span> sur {seats}
            {plan.invited > 0 && <span className="text-muted-foreground"> (dont {plural(plan.invited, 'invitation en attente', 'invitations en attente')})</span>}
            {seatsFull && plan.tier !== 'pro_plus' && <> · <a href={plan.upgradeUrl} className="font-semibold text-accent-dark hover:underline">Pro+ pour inviter jusqu'à 5 personnes</a></>}</li>
        </ul>
        <p className="text-xs text-muted-foreground">Les demandes à qualifier, les projets terminés, archivés et les modèles ne comptent pas.
          La formule est celle de votre Compte Lead : elle se prend une fois, dans n'importe quelle application Lead. Les brouillons de
          facture dans InvoiceLead demandent sa clé d'API, comprise dans la formule Pro+.</p>
        {plan.tier !== 'pro_plus' && (
          <a href={plan.upgradeUrl} className="inline-flex h-9 items-center bg-primary px-3 text-[13px] font-bold text-primary-foreground hover:bg-accent-dark">
            {plan.tier === 'free' ? 'Passer à Pro' : 'Passer à Pro+'}</a>
        )}
      </div>
    </Card>
  )
}

/** Une ligne sous le titre des projets, en formule gratuite seulement. */
export function PlanLine({ plan }: { plan: Plan }) {
  if (!plan.linked || plan.projectLimit === null) return null
  const full = plan.openProjects >= plan.projectLimit
  return (
    <p className={full ? 'text-sm text-late' : 'text-sm text-muted-foreground'}>
      Formule gratuite : {plan.openProjects} projet{plan.openProjects > 1 ? 's' : ''} en cours sur {plan.projectLimit}.{' '}
      <a href={plan.upgradeUrl} className="font-semibold text-accent-dark hover:underline">Passer à Pro</a>
    </p>
  )
}
