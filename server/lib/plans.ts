import type { Db } from '../db.js'
import { HttpError } from './http.js'

/**
 * La formule ProjectLead d'une entreprise. Tout Compte Lead entre, même en gratuit (Ève, 02.10.2026) : ce qui est
 * payant, ce sont les quantités. Les limites portent sur les actions, jamais sur les données déjà créées : un
 * projet de trop n'est ni caché ni bloqué, on ne peut simplement pas en ouvrir un autre.
 *
 * - Gratuit : 3 projets en cours à la fois, 1 personne.
 * - Pro : projets sans limite, 1 personne (19 € par mois ou 190 € par an).
 * - Pro+ : projets sans limite, 5 personnes (39 € par mois ou 390 € par an).
 * Les demandes « à qualifier », les projets terminés ou abandonnés, archivés et les modèles ne comptent pas
 * (même liste de statuts dans db/005_plan_usage.sql et db/008_billing.sql).
 *
 * Chaque application Lead vend sa propre formule, valable chez elle seule (Ève, 13.10.2026) : la formule
 * ProjectLead se prend dans ProjectLead (Réglages → Entreprise, server/routes/billing.ts) et un abonnement pris
 * dans une autre application n'ouvre rien ici. Elle est la meilleure de deux sources :
 * - celle qu'ERPlead calcule pour ProjectLead (abonnement ProjectLead déclaré, ou, pendant la transition, un
 *   abonnement payé ailleurs avant la bascule, jusqu'à la fin de sa période figée), recopiée par `savePlan` et
 *   ignorée dès que sa date de validité est passée ;
 * - l'abonnement ProjectLead tenu ici (`billing_subscriptions`), effectif dès le webhook Stripe.
 *
 * Une entreprise est soumise à sa formule quand le serveur a le Compte Lead (toute entreprise y naît) ou
 * qu'elle est liée à une organisation Lead. Sans Compte Lead (développement, essais), aucune limite.
 */
export type Tier = 'free' | 'pro' | 'pro_plus'

export const LIMITS: Record<Tier, { openProjects: number; seats: number }> = {
  free: { openProjects: 3, seats: 1 },
  pro: { openProjects: Number.POSITIVE_INFINITY, seats: 1 },
  pro_plus: { openProjects: Number.POSITIVE_INFINITY, seats: 5 },
}

export const TIER_NAME: Record<Tier, string> = { free: 'Gratuit', pro: 'Pro', pro_plus: 'Pro+' }

/** Où passer à une formule supérieure : la page Formule de ProjectLead, qui encaisse elle-même. */
export const DEFAULT_UPGRADE_URL = '/reglages/entreprise'

/** Les statuts d'un projet « en cours » : c'est ce que la formule compte. */
export const OPEN_STATUSES = ['planned', 'active', 'on_hold'] as const
/** Un projet créé sans statut naît « en cours » (`active`, valeur par défaut de la base). */
export const isOpenStatus = (s: string | null | undefined) => (OPEN_STATUSES as readonly string[]).includes(s ?? 'active')

export const tierOf = (plan: string | null | undefined): Tier => plan === 'pro_plus' ? 'pro_plus' : plan === 'pro' ? 'pro' : 'free'
const RANK: Record<Tier, number> = { free: 0, pro: 1, pro_plus: 2 }
const best = (a: Tier, b: Tier): Tier => (RANK[a] >= RANK[b] ? a : b)

/** Le code de ProjectLead chez ERPlead (claim `app` des droits). */
const APP_CODE = () => process.env.LEAD_ID_APP || 'projectlead'

const leadIdOn = () => Boolean(process.env.LEAD_ID_CLIENT_SECRET && process.env.LEAD_ID_ISSUER)

export type Plan = Awaited<ReturnType<typeof planOf>>

/**
 * La formule d'une entreprise et ce qu'elle en utilise, lues dans la transaction de l'appelant
 * (`app_plan_usage`, qui compte aussi les projets réservés). Avec `lock`, verrouille d'abord les créations
 * de cette entreprise jusqu'à la fin de la transaction : deux ouvertures simultanées ne dépassent pas la limite.
 */
export async function planOf(db: Db, accountId: string, lock = false) {
  if (lock) await db.query('select pg_advisory_xact_lock(hashtextextended($1, 7351))', [`plan:${accountId}`])
  const u = (await db.query('select * from app_plan_usage($1)', [accountId])).rows[0] ?? {}
  const linked = leadIdOn() || Boolean(u.lead_org)
  // La formule d'ERPlead ne vaut que jusqu'à sa date de validité (fin d'un héritage, fin de période + 3 jours).
  const until = u.plan_valid_until ? new Date(u.plan_valid_until) : null
  const erpValid = !until || until.getTime() > Date.now()
  const erpTier = erpValid ? tierOf(u.plan) : 'free'
  const family = u.plan_source === 'family'
  // Ce qui est payé dans ProjectLead : l'abonnement local, ou un abonnement ProjectLead connu d'ERPlead.
  const paidTier = best(tierOf(u.own_plan), family ? 'free' : erpTier)
  const tier = best(paidTier, erpTier)
  const erpSeats = erpValid && Number.isInteger(u.plan_seats) ? (u.plan_seats as number) : 0
  const seats = linked ? Math.max(LIMITS[tier].seats, erpSeats) : Number.POSITIVE_INFINITY
  const limit = linked ? LIMITS[tier].openProjects : Number.POSITIVE_INFINITY
  // Formule héritée d'un abonnement payé ailleurs avant la bascule : jusqu'à une date figée, puis Gratuit.
  const inherited = family && erpTier !== 'free' && RANK[erpTier] > RANK[paidTier]
    ? { tier: erpTier, app: (u.plan_family_app as string | null) ?? null, until: until ? until.toISOString() : null } : null
  return {
    linked, tier, name: TIER_NAME[tier], upgradeUrl: DEFAULT_UPGRADE_URL,
    source: (tier === 'free' ? 'free' : inherited ? 'family' : 'own') as 'free' | 'family' | 'own',
    paidTier, inherited,
    seats: Number.isFinite(seats) ? seats as number : null,
    openProjects: (u.open_projects ?? 0) as number, projectLimit: Number.isFinite(limit) ? limit : null,
    members: (u.members ?? 0) as number, invited: (u.invited ?? 0) as number,
  }
}

/** Refuse d'ouvrir un projet en cours de plus quand la formule est pleine (dans la transaction de l'appelant). */
export async function assertCanOpenProject(db: Db, accountId: string) {
  const p = await planOf(db, accountId, true)
  if (p.projectLimit !== null && p.openProjects >= p.projectLimit) {
    throw new HttpError(402, 'plan_limit_projects', { limit: p.projectLimit, plan: p.tier, upgrade_url: p.upgradeUrl })
  }
}

/**
 * Refuse une personne de plus quand toutes les places de la formule sont prises. `withInvitations` : une
 * invitation en attente tient déjà une place (à l'envoi d'une invitation, pas à son acceptation).
 */
export async function assertSeatFree(db: Db, accountId: string, withInvitations = true) {
  const p = await planOf(db, accountId, true)
  if (p.seats !== null && p.members + (withInvitations ? p.invited : 0) >= p.seats) {
    throw new HttpError(402, 'plan_limit_seats', {
      limit: p.seats, plan: p.tier, upgrade_url: p.upgradeUrl,
      // Pro garde 1 personne : seule Pro+ en donne davantage.
      needed: p.tier === 'pro_plus' ? null : 'pro_plus',
    })
  }
}

type LeadPlan = {
  app?: string | null
  plan?: { code?: string; seats?: number | null; source?: string; valid_until?: string | null } | null
  subscriptions?: { app?: string; lead_plan?: string | null; inherited?: boolean; family_until?: string | null }[]
} | null | undefined

/**
 * La formule qu'ERPlead calcule POUR ProjectLead (connexion, relecture quotidienne, réponse à une déclaration
 * d'abonnement) : code, places, origine (own, family, free) et date de validité. Une réponse calculée pour une
 * autre application (client mal réglé chez ERPlead) ne fixe rien ici. Le lien de mise à niveau n'est plus lu
 * chez ERPlead : il est toujours local (Réglages → Entreprise).
 */
export async function savePlan(db: Db, accountId: string, lead: LeadPlan) {
  if (!lead?.plan?.code) return
  if (lead.app !== undefined && lead.app !== APP_CODE()) return
  const seats = Number.isInteger(lead.plan.seats) && (lead.plan.seats as number) > 0 ? lead.plan.seats : null
  const source = ['own', 'family', 'free'].includes(String(lead.plan.source)) ? String(lead.plan.source) : null
  const until = lead.plan.valid_until ? new Date(lead.plan.valid_until) : null
  const validUntil = until && !Number.isNaN(until.getTime()) ? until.toISOString() : null
  const lines = (lead.subscriptions ?? []).filter((s) => s?.inherited && typeof s.app === 'string')
  const familyApp = source === 'family'
    ? (lines.find((s) => s.lead_plan === lead.plan!.code) ?? lines[0])?.app ?? null : null
  await db.query(
    `update accounts set plan = $2, plan_seats = $3, plan_source = $4, plan_valid_until = $5, plan_family_app = $6
      where id = $1`,
    [accountId, lead.plan.code, seats, source, validUntil, familyApp])
}
