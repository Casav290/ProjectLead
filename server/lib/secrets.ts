import { anon } from '../db.js'
import { mailboxSecretConfigured, open, seal } from './mailbox/secret.js'

/**
 * Les secrets du serveur gardés en base (db/007_server_secrets.sql), recopiés dans `process.env` au démarrage
 * et à chaque passage des tâches de fond. Le code les lit donc comme des variables ordinaires
 * (`process.env.GLM_API_KEY`, comme dans CRMlead). Une vraie variable d'environnement l'emporte toujours.
 */
export const SERVER_SECRETS = ['GLM_API_KEY'] as const
export type ServerSecret = typeof SERVER_SECRETS[number]

const fromEnv = new Set(SERVER_SECRETS.filter((n) => Boolean(process.env[n])))

export async function hydrateServerSecrets() {
  if (!mailboxSecretConfigured()) return 0
  const rows = await anon(async (db) => (await db.query('select name, value_enc from server_secrets')).rows).catch(() => [])
  let n = 0
  for (const r of rows) {
    if (fromEnv.has(r.name)) continue
    try { process.env[r.name] = open<string>(r.value_enc); n++ } catch { /* chiffré avec un autre APP_SECRET : ignoré */ }
  }
  return n
}

export async function setServerSecret(name: ServerSecret, value: string | null) {
  if (value === null) {
    await anon((db) => db.query('delete from server_secrets where name = $1', [name]))
    if (!fromEnv.has(name)) delete process.env[name]
    return
  }
  await anon((db) => db.query(
    `insert into server_secrets (name, value_enc) values ($1,$2)
     on conflict (name) do update set value_enc = excluded.value_enc, updated_at = now()`, [name, seal(value)]))
  if (!fromEnv.has(name)) process.env[name] = value
}
