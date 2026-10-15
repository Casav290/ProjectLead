import type { Plan } from './types'

/**
 * Les formules ProjectLead telles que l'écran les montre (carte Formule de Réglages → Entreprise, page publique
 * /formules). Les quantités sont celles du serveur (server/lib/plans.ts, LIMITS) ; les prix, ceux de
 * server/lib/stripe.ts (PRICES, en euros hors taxes) : scripts/suites-check.ts vérifie qu'ils restent égaux.
 */
export type Tier = Plan['tier']

export const PLAN_RANK: Record<Tier, number> = { free: 0, pro: 1, pro_plus: 2 }
export const PLAN_NAME: Record<Tier, string> = { free: 'Gratuit', pro: 'Pro', pro_plus: 'Pro+' }
export const PLAN_FEATURES: Record<Tier, string[]> = {
  free: ['3 projets en cours à la fois', '1 personne', 'Toutes les fonctions de ProjectLead'],
  pro: ['Projets sans limite', '1 personne', 'Toutes les fonctions de ProjectLead'],
  pro_plus: ['Projets sans limite', "Jusqu'à 5 personnes", 'Toutes les fonctions de ProjectLead'],
}
export const PLAN_PRICES: Record<'pro' | 'pro_plus', Record<'month' | 'year', number>> = {
  pro: { month: 19, year: 190 },
  pro_plus: { month: 39, year: 390 },
}

/** Un prix en euros, sans décimales quand il est rond (19 €, 15,83 €). */
export const euros = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'EUR',
  minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n)
