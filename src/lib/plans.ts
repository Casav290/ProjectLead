import { intlLocale, labels, t } from '../i18n'
import type { Plan } from './types'

/**
 * Les formules ProjectLead telles que l'écran les montre (carte Formule de Réglages → Entreprise, page publique
 * /formules). Les quantités sont celles du serveur (server/lib/plans.ts, LIMITS) ; les prix, ceux de
 * server/lib/stripe.ts (PRICES, en euros hors taxes) : scripts/suites-check.ts vérifie qu'ils restent égaux.
 */
export type Tier = Plan['tier']

export const PLAN_RANK: Record<Tier, number> = { free: 0, pro: 1, pro_plus: 2 }
// Les noms et les lignes des formules suivent la langue : lus à chaque accès (clés shell.plan.*).
export const PLAN_NAME: Record<Tier, string> = labels('shell.plan.name', ['free', 'pro', 'pro_plus'])
const FEATURE_KEYS: Record<Tier, string[]> = {
  free: ['projects3', 'person1', 'allFeatures'],
  pro: ['projectsUnlimited', 'person1', 'allFeatures'],
  pro_plus: ['projectsUnlimited', 'persons5', 'allFeatures'],
}
export const PLAN_FEATURES = {} as Record<Tier, string[]>
for (const k of Object.keys(FEATURE_KEYS) as Tier[])
  Object.defineProperty(PLAN_FEATURES, k, { enumerable: true, get: () => FEATURE_KEYS[k].map((f) => t(`shell.plan.feature.${f}`)) })
export const PLAN_PRICES: Record<'pro' | 'pro_plus', Record<'month' | 'year', number>> = {
  pro: { month: 19, year: 190 },
  pro_plus: { month: 39, year: 390 },
}

/** Un prix en euros, sans décimales quand il est rond (19 €, 15,83 €). */
export const euros = (n: number) => new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'EUR',
  minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n)
