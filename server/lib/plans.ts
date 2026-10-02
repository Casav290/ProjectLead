import { anon, type Db } from '../db.js'
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
 * Les demandes « à qualifier », les projets terminés ou abandonnés, archivés et les modèles ne comptent pas.
 */
export type Tier = 'free' | 'pro' | 'pro_plus'

export const LIMITS: Record<Tier, { openProjects: number; seats: number }> = {
  free: { openProjects: 3, seats: 1 },
  pro: { openProjects: Number.POSITIVE_INFINITY, seats: 1 },
  pro_plus: { openProjects: Number.POSITIVE_INFINITY, seats: 5 },
}

export const TIER_NAME: Record<Tier, string> = { free: 'Gratuit', pro: 'Pro', pro_plus: 'Pro+' }

/** Où passer à une formule supérieure : la facturation de la famille, chez CRMlead. */
export const DEFAULT_UPGRADE_URL = 'https://crmlead.io/settings#billing'

/** Les statuts d'un projet « en cours » : c'est ce que la formule compte. */
export const OPEN_STATUSES = ['planned', 'active', 'on_hold'] as const
export const isOpenStatus = (s: string | null | undefined) => (OPEN_STATUSES as readonly string[]).includes(s ?? 'active')

export const tierOf = (plan: string | null | undefined): Tier => plan === 'pro_plus' ? 'pro_plus' : plan === 'pro' ? 'pro' : 'free'

/** La formule d'une entreprise et ce qu'elle en utilise. Lu sans RLS : un projet réservé compte aussi. */
export async function planOf(accountId: string) {
  return anon(async (db) => {
    const a = (await db.query('select plan, plan_seats, plan_upgrade_url, lead_org from accounts where id = $1', [accountId])).rows[0]
    // Sans Compte Lead (serveur de développement, anciens accès locaux), pas de formule de la famille : pas de limite.
    const linked = Boolean(a?.lead_org)
    const tier = tierOf(a?.plan)
    const used = (await db.query(
      `select (select count(*)::int from projects where account_id = $1 and not is_template and archived_at is null
                 and status = any($2)) as open_projects,
              (select count(*)::int from account_users where account_id = $1 and active) as members,
              (select count(*)::int from invitations where account_id = $1 and accepted_at is null and expires_at > now()) as invited`,
      [accountId, OPEN_STATUSES])).rows[0]
    const seats = linked ? a?.plan_seats ?? LIMITS[tier].seats : Number.POSITIVE_INFINITY
    const limit = linked ? LIMITS[tier].openProjects : Number.POSITIVE_INFINITY
    const upgradeUrl = typeof a?.plan_upgrade_url === 'string' && a.plan_upgrade_url.startsWith('https://') ? a.plan_upgrade_url : DEFAULT_UPGRADE_URL
    return {
      linked, tier, name: TIER_NAME[tier], upgradeUrl, seats: Number.isFinite(seats) ? seats : null,
      openProjects: used.open_projects as number, projectLimit: Number.isFinite(limit) ? limit : null,
      members: used.members as number, invited: used.invited as number,
    }
  })
}

/** Refuse d'ouvrir `n` projet(s) en cours de plus quand la formule est pleine. */
export async function assertCanOpenProjects(accountId: string, n = 1) {
  const p = await planOf(accountId)
  if (p.projectLimit !== null && p.openProjects + n > p.projectLimit) {
    throw new HttpError(402, 'plan_limit_projects', { limit: p.projectLimit, plan: p.tier, upgrade_url: p.upgradeUrl })
  }
}

/** Refuse une invitation de plus quand toutes les places de la formule sont prises (invitations en attente comprises). */
export async function assertSeatFree(accountId: string) {
  const p = await planOf(accountId)
  if (p.seats !== null && p.members + p.invited >= p.seats) {
    throw new HttpError(402, 'plan_limit_seats', { limit: p.seats, plan: p.tier, upgrade_url: p.upgradeUrl })
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
