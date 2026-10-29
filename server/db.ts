import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'

// bigint (les montants en centimes) revient en nombre, pas en chaîne.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)))
// Une date reste une chaîne AAAA-MM-JJ : pas de fuseau pour une date sans heure.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant')

const POOL_MAX = Number(process.env.PG_POOL_MAX ?? 10)
// Même contrainte de portabilité que CRMlead : la base n'est joignable que par DATABASE_URL.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) || process.env.PGSSL === 'off'
    ? false : { rejectUnauthorized: false },
  max: POOL_MAX,
  // Jamais d'attente sans fin d'une connexion (pool plein) : une erreur après ce délai, pas une requête qui pend.
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 30_000),
})

// Une connexion inactive qui meurt ne doit pas faire tomber le processus (leçon de CRMlead, 12.09.2026).
pool.on('error', (err) => console.error('[base] connexion inactive perdue :', err.message))

export type Role = 'admin' | 'manager' | 'member'
export type Ctx = { accountId: string; userId: string; role: Role }
export type Db = pg.PoolClient

/**
 * Une transaction partagée par plusieurs appels de routes (Assistant IA : une carte « Confirmer » qui porte plusieurs
 * écritures). Les routes appelées pendant `sharedTransaction` ne changent pas : leur `withTenant` reprend la connexion de
 * la transaction commune, dans un point de sauvegarde (SAVEPOINT), au lieu d'ouvrir la sienne. Tout est validé à la fin,
 * ou tout est annulé. `dryRun` : la même chose, toujours annulée (essai d'une proposition avant de l'afficher).
 */
type Shared = { client: pg.PoolClient; ctx: Ctx; n: number }
const shared = new AsyncLocalStorage<Shared>()

/** Vrai pendant une transaction partagée (les tâches de fond n'y démarrent pas). */
export const inSharedTransaction = () => shared.getStore() !== undefined

/**
 * Une écriture de l'Assistant IA (essai d'une proposition ou « Confirmer », lib/assistant/run.ts) : RIEN ne sort vers
 * l'extérieur, même indirectement (l'email d'une automatisation de l'entreprise qui « écrit au client »). `sendMail`
 * le refuse et le note ici ; l'exécution de la carte voit la tentative et refuse la carte entière (tout est annulé).
 */
type Guard = { attempts: number }
const guard = new AsyncLocalStorage<Guard>()
export const withoutOutbound = <T>(fn: () => Promise<T>): Promise<T> => guard.run({ attempts: 0 }, fn)
/** Vrai pendant une écriture de l'assistant (les tâches de fond n'y démarrent pas : elles écrivent aux clients). */
export const inAssistantWrite = () => guard.getStore() !== undefined
/** Pendant une écriture de l'assistant : note la tentative d'envoi et rend vrai (l'appelant n'envoie RIEN). */
export function refuseOutbound(): boolean {
  const g = guard.getStore()
  if (!g) return false
  g.attempts++
  return true
}
/** Le nombre d'envois refusés depuis le début de l'écriture de l'assistant en cours. */
export const outboundAttempts = () => guard.getStore()?.attempts ?? 0

/**
 * Au plus SHARED_MAX transactions partagées à la fois dans ce processus. Chacune garde une connexion pendant tout le lot
 * (ou l'essai), et chaque route qu'elle appelle en demande une seconde, brève (garde de session, `anon`). Sans plafond,
 * des essais simultanés (le modèle appelle plusieurs outils d'un coup) prendraient toutes les connexions du pool et
 * attendraient chacun une de plus : blocage sans fin. La moitié du pool au plus ; l'autre moitié sert aux connexions
 * brèves des lots et aux requêtes ordinaires. Le suivant attend ici, SANS tenir de connexion.
 */
const SHARED_MAX = Math.max(1, Math.floor(POOL_MAX / 2))
let sharedRunning = 0
const sharedWaiting: (() => void)[] = []
const sharedSlot = () => (sharedRunning < SHARED_MAX ? (sharedRunning++, Promise.resolve())
  : new Promise<void>((resolve) => sharedWaiting.push(resolve)))
const sharedRelease = () => {
  const next = sharedWaiting.shift()
  if (next) next()   // la place passe directement au suivant
  else sharedRunning--
}

const begin = async (client: pg.PoolClient, ctx: Ctx) => {
  await client.query('begin')
  await client.query('set local role projectlead_app')
  await client.query(
    `select set_config('app.account_id', $1, true), set_config('app.user_id', $2, true),
            set_config('app.role', $3, true), set_config('search_path', 'public', true)`,
    [ctx.accountId, ctx.userId, ctx.role],
  )
}

/**
 * Toute requête métier passe par ici : une transaction, le rôle applicatif endossé (la RLS
 * s'applique donc toujours), et le contexte du compte posé LOCAL à la transaction.
 */
export async function withTenant<T>(ctx: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  const s = shared.getStore()
  if (s) {
    // Dans une transaction partagée : la même personne de la même entreprise, sinon refus (rien ne sort du lot).
    if (s.ctx.accountId !== ctx.accountId || s.ctx.userId !== ctx.userId || s.ctx.role !== ctx.role) throw new Error('shared_transaction_other_tenant')
    const sp = `pl_lot_${++s.n}`
    await s.client.query(`savepoint ${sp}`)
    try {
      const out = await fn(s.client)
      await s.client.query(`release savepoint ${sp}`)
      return out
    } catch (e) {
      await s.client.query(`rollback to savepoint ${sp}`).catch(() => {})
      throw e
    }
  }
  const client = await pool.connect()
  try {
    await begin(client, ctx)
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Plusieurs écritures (routes de l'application appelées par `fn`) en une seule transaction : tout ou rien. */
export async function sharedTransaction<T>(ctx: Ctx, fn: (db: Db) => Promise<T>, opts: { dryRun?: boolean } = {}): Promise<T> {
  if (shared.getStore()) throw new Error('shared_transaction_nested')
  await sharedSlot()
  try {
    const client = await pool.connect()
    const store: Shared = { client, ctx, n: 0 }
    try {
      await begin(client, ctx)
      const out = await shared.run(store, () => fn(client))
      await client.query(opts.dryRun ? 'rollback' : 'commit')
      return out
    } catch (e) {
      await client.query('rollback').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  } finally {
    sharedRelease()
  }
}

/**
 * Hors compte : connexion, inscription, pages publiques (suivi client, prise de rendez-vous),
 * tâches de fond. Tourne avec le rôle propriétaire, sans RLS : chaque requête écrite ici porte
 * elle-même son filtre de compte. À n'utiliser que là où aucun compte n'est encore connu.
 */
export async function anon<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

/** Une transaction hors compte (création d'une entreprise et de son premier utilisateur). */
export async function anonTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export const one = async <T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> =>
  ((await db.query(sql, params)).rows[0] as T) ?? null

export const many = async <T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[]
