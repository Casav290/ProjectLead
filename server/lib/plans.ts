import type { Db } from '../db.js'
import { HttpError } from './http.js'

/**
 * Formules de la famille Lead (Ève, 02.10.2026 : « si on a un compte, même gratuit, on doit pouvoir
 * accéder à toutes les apps, en mode free »). Comme InvoiceLead et CRMlead : l'accès est ouvert à tous,
 * ce qui est payant ce sont les quantités. Les limites portent sur les actions, jamais sur les données
 * déjà créées : un projet de trop n'est ni caché ni bloqué, on ne peut simplement pas en ouvrir un autre.
 *
 * - Gratuit : 3 projets en cours à la fois, 1 personne.
 * - Pro : projets sans limite, 1 personne.
 * - Pro+ : projets sans limite, 5 personnes.
 * Les demandes « à qualifier », les projets terminés ou abandonnés, archivés et les modèles ne comptent pas
 * (même liste de statuts dans db/005_plan_usage.sql).
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

/** Où passer à une formule supérieure : la facturation de la famille, chez CRMlead. */
export const DEFAULT_UPGRADE_URL = 'https://erplead.io/account'

/** Les statuts d'un projet « en cours » : c'est ce que la formule compte. */
export const OPEN_STATUSES = ['planned', 'active', 'on_hold'] as const
/** Un projet créé sans statut naît « en cours » (`active`, valeur par défaut de la base). */
export const isOpenStatus = (s: string | null | undefined) => (OPEN_STATUSES as readonly string[]).includes(s ?? 'active')

export const tierOf = (plan: string | null | undefined): Tier => plan === 'pro_plus' ? 'pro_plus' : plan === 'pro' ? 'pro' : 'free'

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
  const tier = tierOf(u.plan)
  const seats = linked ? u.plan_seats ?? LIMITS[tier].seats : Number.POSITIVE_INFINITY
  const limit = linked ? LIMITS[tier].openProjects : Number.POSITIVE_INFINITY
  const upgradeUrl = typeof u.plan_upgrade_url === 'string' && u.plan_upgrade_url.startsWith('https://') ? u.plan_upgrade_url : DEFAULT_UPGRADE_URL
  return {
    linked, tier, name: TIER_NAME[tier], upgradeUrl,
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

/** La formule lue au Compte Lead (connexion, relecture quotidienne) : code, places, lien de mise à niveau. */
export async function savePlan(db: Db, accountId: string, lead: { plan?: { code?: string; seats?: number | null } | null; apps?: Record<string, any> } | null | undefined) {
  if (!lead?.plan?.code) return
  const seats = Number.isInteger(lead.plan.seats) && (lead.plan.seats as number) > 0 ? lead.plan.seats : null
  const up = lead.apps?.projectlead?.upgrade_url
  await db.query('update accounts set plan = $2, plan_seats = $3, plan_upgrade_url = $4 where id = $1',
    [accountId, lead.plan.code, seats, typeof up === 'string' && up.startsWith('https://') ? up : null])
}
