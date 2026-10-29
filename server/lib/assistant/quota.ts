import { withTenant, type Ctx } from '../../db.js'
import { planOf } from '../plans.js'
import { allowanceOf, monthlyUsage, type Allowance } from './budget.js'

/**
 * Quota de l'assistant (cahier commun) : 40 messages par heure et par personne, 400 par 24 heures et par entreprise.
 * La réservation prend le verrou de l'entreprise : deux messages simultanés ne passent pas tous les deux sous un plafond
 * qui n'en laisse qu'un. Les confirmations (« Confirmer ») ne comptent pas : ce ne sont pas des appels au modèle.
 *
 * En plus, la limite de la formule gratuite (29.10.2026, lib/assistant/budget.ts) : la formule de l'entreprise (`planOf`,
 * la même fonction que les autres limites) donne un budget du mois en jetons pondérés, ou aucun ; budget atteint →
 * `free_limit`, rien n'est réservé et le modèle n'est pas appelé. Ces quotas restent : ils valent pour toutes les formules.
 */
export const USER_PER_HOUR = () => Number(process.env.ASSISTANT_USER_PER_HOUR) || 40
export const ACCOUNT_PER_DAY = () => Number(process.env.ASSISTANT_ACCOUNT_PER_DAY) || 400

/** `budget` : le budget du mois de la formule (jetons pondérés), null sans limite ; `upgradeUrl` : la page Formule. */
export type Reservation = { ok: true; id: string; budget: number | null }
  | { ok: false; scope: 'user' | 'account' }
  | { ok: false; scope: 'free_limit'; allowance: Allowance; upgradeUrl: string }

export async function reserveMessage(ctx: Ctx): Promise<Reservation> {
  return withTenant(ctx, async (db) => {
    await db.query(`select pg_advisory_xact_lock(hashtext('assistant:' || $1))`, [ctx.accountId])
    // La formule gratuite d'abord (L4) : le budget du mois atteint, aucun appel au modèle, rien de réservé.
    const plan = await planOf(db, ctx.accountId)
    const budget = plan.assistantBudget
    if (budget !== null) {
      const allowance = allowanceOf(budget, await monthlyUsage(db, ctx.accountId))
      if (allowance.limited && allowance.exhausted) return { ok: false, scope: 'free_limit', allowance, upgradeUrl: plan.upgradeUrl } as const
    }
    const r = (await db.query(
      `select count(*) filter (where user_id = $1 and created_at > now() - interval '1 hour')::int as user_hour,
              count(*)::int as account_day
         from assistant_usage where kind = 'message' and created_at > now() - interval '1 day'`, [ctx.userId])).rows[0]
    if (r.user_hour >= USER_PER_HOUR()) return { ok: false, scope: 'user' } as const
    if (r.account_day >= ACCOUNT_PER_DAY()) return { ok: false, scope: 'account' } as const
    const id = (await db.query(
      `insert into assistant_usage (account_id, user_id, kind) values ($1, $2, 'message') returning id`,
      [ctx.accountId, ctx.userId])).rows[0].id as string
    return { ok: true, id, budget } as const
  })
}

/** Ce que la bulle montre de la formule gratuite (L5) : relu après chaque tour, et à l'ouverture de la bulle. */
export async function allowanceFor(ctx: Ctx): Promise<Allowance> {
  return withTenant(ctx, async (db) => {
    const budget = (await planOf(db, ctx.accountId)).assistantBudget
    return allowanceOf(budget, budget === null ? 0 : await monthlyUsage(db, ctx.accountId))
  })
}

export type UsageFigures = {
  ok: boolean; input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cache_write_tokens?: number
  tools?: string[]; error?: string | null; duration_ms?: number
}

/** Complète la ligne réservée : jetons, outils appelés, erreur. Jamais le texte de la conversation. */
export async function completeUsage(ctx: Ctx, id: string, u: UsageFigures) {
  await withTenant(ctx, (db) => db.query(
    `update assistant_usage set ok = $2, input_tokens = $3, output_tokens = $4, cache_read_tokens = $5, cache_write_tokens = $6,
            tools = $7, error = $8, duration_ms = $9 where id = $1`,
    [id, u.ok, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_tokens ?? 0, u.cache_write_tokens ?? 0,
     (u.tools ?? []).slice(0, 50), u.error?.slice(0, 200) ?? null, u.duration_ms ?? null])).catch((e) => console.error('[assistant] journal', e?.message))
}

/** Une confirmation exécutée (ou refusée) : journalisée, hors quota. */
export async function logConfirm(ctx: Ctx, tool: string, error: string | null) {
  await withTenant(ctx, (db) => db.query(
    `insert into assistant_usage (account_id, user_id, kind, ok, tools, error) values ($1, $2, 'confirm', $3, $4, $5)`,
    [ctx.accountId, ctx.userId, !error, [tool], error])).catch((e) => console.error('[assistant] journal', e?.message))
}
