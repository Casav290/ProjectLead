import type { Db } from '../db.js'
import { forbidden } from './http.js'

/**
 * Jamais d'entreprise sans administrateur actif. Les changements qui peuvent en retirer un (« Retirer », changement de
 * rôle par PATCH /api/team/members/:id, départ annoncé par ERPlead) passent un par un pour une même entreprise : ce
 * verrou est tenu jusqu'à la fin de la transaction. Sans lui, deux administrateurs qui se retirent l'un l'autre au même
 * instant voient chacun l'autre encore actif et passent tous les deux le contrôle « last_admin » (relecture du 15.10.2026).
 */
export async function lockAdmins(db: Db, accountId: string) {
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 7351))', [`admins:${accountId}`])
}

/**
 * L'appelant est encore administrateur actif, relu dans la transaction après `lockAdmins` : sa session a été lue avant
 * un retrait ou une rétrogradation qui vient de passer. Sinon 403.
 */
export async function assertStillAdmin(db: Db) {
  const r = await db.query(`select 1 from account_users where account_id = app_account() and user_id = app_user() and role = 'admin' and active`)
  if (!r.rowCount) throw forbidden()
}
