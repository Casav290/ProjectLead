import type { Db } from '../../db.js'

/**
 * Limite de l'Assistant IA en formule gratuite (Ève, 29.10.2026 : « l'équivalent de 10 requêtes » ; cahier commun
 * ~/projets/.unlazy/ia-limites/CAHIER.md, L1 à L5). SEULE source des constantes : poids, demande-type, budget.
 *
 * - L1 : l'unité est le jeton PONDÉRÉ par le prix : entrée + 1,25 × écriture du cache + 0,1 × lecture du cache
 *   + 5 × sortie, lus dans le journal d'usage existant (`assistant_usage`, db/030_assistant.sql) : aucune migration.
 *   Une demande-type = 20 000 jetons pondérés (mesuré en production le 29.10.2026).
 * - L2 : 200 000 jetons pondérés par MOIS CIVIL (UTC) et par entreprise, « l'équivalent de 10 demandes ».
 * - L3 : QUI est limité ne se décide pas ici : c'est la formule de l'entreprise, par la même fonction que les autres
 *   limites (server/lib/plans.ts, `planOf` → `assistantBudget`, null quand la formule n'a pas de limite).
 * - L4 : avant chaque tour, consommation du mois ≥ budget → aucun appel au modèle (server/lib/assistant/quota.ts). Un tour
 *   déjà commencé n'est pas coupé : il peut dépasser un peu le budget (ses jetons ne sont connus qu'à la fin). Tant qu'il
 *   tourne, il compte pour une demande-type (`OPEN_TURN_MS`) : des demandes lancées en même temps ne passent pas toutes.
 * - L5 : la bulle dit « il vous reste environ N demandes », N = arrondi inférieur de (budget − consommation) / 20 000.
 */
export const WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 } as const
/** Une demande-type, en jetons pondérés. */
export const REQUEST_TOKENS = 20_000
/** Le budget d'un mois en formule gratuite, en jetons pondérés. */
export const FREE_MONTHLY_TOKENS = 200_000
/** « L'équivalent de 10 demandes » : le nombre dit aux personnes (textes de la bulle et des formules). */
export const FREE_REQUESTS = FREE_MONTHLY_TOKENS / REQUEST_TOKENS

export type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_tokens?: number | null; cache_write_tokens?: number | null }

/** Les jetons pondérés d'un tour (mêmes champs que le journal `assistant_usage`). */
export const weightedTokens = (u: Usage) => (u.input_tokens ?? 0) * WEIGHTS.input + (u.cache_write_tokens ?? 0) * WEIGHTS.cacheWrite
  + (u.cache_read_tokens ?? 0) * WEIGHTS.cacheRead + (u.output_tokens ?? 0) * WEIGHTS.output

/** Le même calcul en SQL, sur une ligne de `assistant_usage` (poids repris de WEIGHTS, jamais recopiés). */
export const WEIGHTED_SQL = `(input_tokens * ${WEIGHTS.input} + cache_write_tokens * ${WEIGHTS.cacheWrite}`
  + ` + cache_read_tokens * ${WEIGHTS.cacheRead} + output_tokens * ${WEIGHTS.output})`

/** Le mois civil (UTC) de `now` : [premier instant, premier instant du mois suivant). */
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
export const nextMonthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

/**
 * Un tour en cours : sa ligne est réservée (`reserveMessage`) mais ses jetons ne sont écrits qu'à la fin (`completeUsage`,
 * `ok` encore vide). Il compte pour une demande-type tant qu'il peut tourner : des demandes lancées en même temps (plusieurs
 * onglets, un script dans la console du navigateur) ne voient pas toutes le même reste ; au plus autant de tours en même
 * temps qu'il reste de demandes (arrondi supérieur). Au-delà de la durée maximale de la fonction (MAX_DURATION_MS de
 * server/routes/assistant.ts, 300 s : égalité vérifiée par scripts/assistant-limites-check.ts), une ligne restée ouverte
 * (fonction arrêtée, journal jamais complété) ne compte plus.
 */
export const OPEN_TURN_MS = 5 * 60_000

/**
 * Les jetons pondérés consommés par l'entreprise pendant le mois civil (UTC) de `now`, dans la transaction de l'appelant
 * (RLS de l'entreprise), plus une demande-type par tour en cours (`OPEN_TURN_MS`). Les tours seulement
 * (`kind = 'message'`) : une confirmation n'appelle pas le modèle.
 */
export async function monthlyUsage(db: Db, accountId: string, now = new Date()): Promise<number> {
  const r = await db.query(
    `select coalesce(sum(case when ok is null and created_at > now() - interval '${OPEN_TURN_MS / 1000} seconds'
                         then ${REQUEST_TOKENS} else ${WEIGHTED_SQL} end), 0)::float8 as used from assistant_usage
      where account_id = $1 and kind = 'message' and created_at >= $2 and created_at < $3`,
    [accountId, monthStart(now), nextMonthStart(now)])
  return Number(r.rows[0]?.used ?? 0)
}

/**
 * Ce que la bulle montre (L5) et ce que dit un refus (L4). `limited: false` : la formule n'a pas de limite.
 * `requests` : environ combien de demandes restent ce mois-ci (arrondi inférieur) ; `exhausted` : le budget est atteint,
 * le tour suivant est refusé sans appel au modèle ; `resets_on` : le 1er du mois suivant (AAAA-MM-JJ, UTC).
 */
export type Allowance =
  | { limited: false }
  | { limited: true; budget: number; used: number; remaining: number; requests: number; total: number; exhausted: boolean; resets_on: string }

export function allowanceOf(budget: number | null, used: number, now = new Date()): Allowance {
  if (budget === null) return { limited: false }
  const remaining = Math.max(0, budget - used)
  return {
    limited: true, budget, used: Math.round(used), remaining: Math.round(remaining),
    requests: Math.floor(remaining / REQUEST_TOKENS), total: FREE_REQUESTS,
    exhausted: used >= budget, resets_on: nextMonthStart(now).toISOString().slice(0, 10),
  }
}
