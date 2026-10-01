import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pool } from './db.js'

/**
 * Applique `db/NNN_*.sql` dans l'ordre. Chaque fichier est idempotent ; `000_roles.sql` et
 * `002_rls.sql` sont rejoués à chaque passage (droits et politiques toujours reposés), les
 * autres ne passent qu'une fois, retenus dans `schema_migrations`.
 */
const REPLAYABLE = new Set(['000_roles.sql', '002_rls.sql'])

export type Migration = { name: string; sql: string }

/** Les fichiers de `db/`, lus sur le disque. */
export function migrationFiles(): Migration[] {
  const dir = join(import.meta.dirname, '..', 'db')
  return readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

/** `list` : les migrations embarquées dans un paquet (Neon Functions), sinon celles du disque. */
export async function migrate(log = console.log, list?: Migration[]) {
  const files = (list ?? migrationFiles()).slice().sort((a, b) => a.name.localeCompare(b.name))
  const c = await pool.connect()
  try {
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name))
    for (const { name: f, sql } of files) {
      if (done.has(f) && !REPLAYABLE.has(f)) continue
      await c.query('begin')
      try {
        await c.query(sql)
        await c.query('insert into schema_migrations (name) values ($1) on conflict do nothing', [f])
        await c.query('commit')
        if (!done.has(f)) log(`[migration] ${f}`)
      } catch (e) {
        await c.query('rollback')
        throw new Error(`${f} : ${(e as Error).message}`)
      }
    }
  } finally {
    c.release()
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1) })
}
