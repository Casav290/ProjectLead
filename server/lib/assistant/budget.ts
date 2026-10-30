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
 *   tourne, il est réservé (`openTurnTokens`, `OPEN_TURN_MS`) : des demandes lancées en même temps ne passent pas toutes.
 * - L5 : la bulle dit « il vous reste environ N demandes », N = arrondi inférieur de (budget − consommation) / 20 000 ;
 *   moins d'une demande entière : « moins d'une demande », le champ reste ouvert.
 * - L9 (révision du 30.10.2026) : un tour en cours n'est PAS de la consommation. Il ne fait jamais dire « budget
 *   atteint » (`exhausted` ne regarde que les tours finis) ; une demande refusée seulement parce que des tours en cours
 *   occupent le reste du budget reçoit « free_wait » (réessayer dans un instant), pas la fin du mois.
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
 * `ok` encore vide). Tant qu'il peut tourner, il est RÉSERVÉ : des demandes lancées en même temps (plusieurs onglets, un
 * script dans la console du navigateur) ne voient pas toutes le même reste. Au-delà de la durée maximale de la fonction
 * (MAX_DURATION_MS de server/routes/assistant.ts, 300 s : égalité vérifiée par scripts/assistant-limites-check.ts), une
 * ligne restée ouverte (fonction arrêtée, journal jamais complété) ne compte plus.
 */
export const OPEN_TURN_MS = 5 * 60_000

/**
 * Ce que réserve un tour en cours (L10, révision du 30.10.2026) : une demande-type, ou plus si l'historique envoyé par le
 * navigateur est long. Un jeton couvre au moins un octet : les octets (UTF-8) de l'historique bornent ses jetons d'entrée,
 * écrits en cache au prix de l'écriture. La ligne réservée porte ces octets dans `input_tokens` jusqu'à la fin du tour
 * (`completeUsage` y écrit alors les vrais jetons) : aucune migration. Un long fil fabriqué ne passe donc pas plusieurs
 * fois en même temps sous le budget.
 */
export const openTurnTokens = (historyBytes: number) => Math.max(REQUEST_TOKENS, Math.ceil(historyBytes * WEIGHTS.cacheWrite))
/** Le même calcul en SQL, sur la ligne réservée d'un tour en cours (`input_tokens` = octets de l'historique). */
export const OPEN_TURN_SQL = `greatest(${REQUEST_TOKENS}, ceil(input_tokens * ${WEIGHTS.cacheWrite}))`

/** La consommation du mois (tours finis, pondérée) et ce que réservent les tours encore en cours. */
export type MonthUsage = { used: number; pending: number }

/**
 * Les jetons pondérés consommés par l'entreprise pendant le mois civil (UTC) de `now` (tours FINIS : `ok` écrit), et ce
 * que réservent ses tours encore en cours (`OPEN_TURN_MS`, `openTurnTokens`), dans la transaction de l'appelant (RLS de
 * l'entreprise). Les tours seulement (`kind = 'message'`) : une confirmation n'appelle pas le modèle.
 */
export async function monthlyUsage(db: Db, accountId: string, now = new Date()): Promise<MonthUsage> {
  const r = await db.query(
    `select coalesce(sum(${WEIGHTED_SQL}) filter (where ok is not null), 0)::float8 as used,
            coalesce(sum(${OPEN_TURN_SQL}) filter (where ok is null and created_at > now() - interval '${OPEN_TURN_MS / 1000} seconds'), 0)::float8 as pending
       from assistant_usage
      where account_id = $1 and kind = 'message' and created_at >= $2 and created_at < $3`,
    [accountId, monthStart(now), nextMonthStart(now)])
  return { used: Number(r.rows[0]?.used ?? 0), pending: Number(r.rows[0]?.pending ?? 0) }
}

/**
 * Ce que la bulle montre (L5) et ce que dit un refus (L4). `limited: false` : la formule n'a pas de limite.
 * `used` : la consommation du mois (tours finis) ; `pending` : ce que réservent les tours en cours (pas de la
 * consommation : L9) ; `remaining` et `requests` : environ combien de demandes restent ce mois-ci (arrondi inférieur),
 * sur la consommation seule ; `exhausted` : le budget est atteint par la consommation, le tour suivant est refusé sans
 * appel au modèle ; `resets_on` : le 1er du mois suivant (AAAA-MM-JJ, UTC).
 */
export type Allowance =
  | { limited: false }
  | { limited: true; budget: number; used: number; pending: number; remaining: number; requests: number; total: number; exhausted: boolean; resets_on: string }

export function allowanceOf(budget: number | null, used: number, now = new Date(), pending = 0): Allowance {
  if (budget === null) return { limited: false }
  const remaining = Math.max(0, budget - used)
  return {
    limited: true, budget, used: Math.round(used), pending: Math.round(pending), remaining: Math.round(remaining),
    requests: Math.floor(remaining / REQUEST_TOKENS), total: FREE_REQUESTS,
    exhausted: used >= budget, resets_on: nextMonthStart(now).toISOString().slice(0, 10),
  }
}

/**
 * La décision avant un tour (L4, L9) : `free_limit` quand la consommation du mois atteint le budget (la fin du mois,
 * annoncée) ; `free_wait` quand seuls des tours EN COURS occupent le reste (réessayer dans un instant, rien d'annoncé sur
 * le mois) ; sinon le tour passe.
 */
export function budgetDecision(budget: number, m: MonthUsage): 'ok' | 'free_limit' | 'free_wait' {
  if (m.used >= budget) return 'free_limit'
  if (m.used + m.pending >= budget) return 'free_wait'
  return 'ok'
}
