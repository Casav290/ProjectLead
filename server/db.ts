import pg from 'pg'

// bigint (les montants en centimes) revient en nombre, pas en chaîne.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)))
// Une date reste une chaîne AAAA-MM-JJ : pas de fuseau pour une date sans heure.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant')

// Même contrainte de portabilité que CRMlead : la base n'est joignable que par DATABASE_URL.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) || process.env.PGSSL === 'off'
    ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX ?? 10),
})

// Une connexion inactive qui meurt ne doit pas faire tomber le processus (leçon de CRMlead, 12.09.2026).
pool.on('error', (err) => console.error('[base] connexion inactive perdue :', err.message))

export type Role = 'admin' | 'manager' | 'member'
export type Ctx = { accountId: string; userId: string; role: Role }
export type Db = pg.PoolClient

/**
 * Toute requête métier passe par ici : une transaction, le rôle applicatif endossé (la RLS
 * s'applique donc toujours), et le contexte du compte posé LOCAL à la transaction.
 */
export async function withTenant<T>(ctx: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role projectlead_app')
    await client.query(
      `select set_config('app.account_id', $1, true), set_config('app.user_id', $2, true),
              set_config('app.role', $3, true), set_config('search_path', 'public', true)`,
      [ctx.accountId, ctx.userId, ctx.role],
    )
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
