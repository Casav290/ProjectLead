import type { Db } from '../db.js'
import { asLocale, type Locale } from './i18n.js'

/**
 * Les langues des personnes et des documents (chantier « cinq langues », 27.10.2026).
 * - Une personne : `users.locale` (choisie au sélecteur, POST /api/me/locale).
 * - Un document du client d'un projet (suivi, page de suivi, brouillon de facture) : `projects.doc_locale`, sinon la
 *   langue de l'entreprise (`accounts.locale`).
 */

/** La langue de chacune de ces personnes (français pour une personne inconnue). */
export async function userLocales(db: Db, ids: string[]): Promise<Map<string, Locale>> {
  const out = new Map<string, Locale>()
  if (!ids.length) return out
  for (const r of (await db.query('select id, locale from users where id = any($1::uuid[])', [ids])).rows) out.set(r.id, asLocale(r.locale))
  return out
}

export async function userLocale(db: Db, id: string | null | undefined): Promise<Locale> {
  if (!id) return 'fr'
  return (await userLocales(db, [id])).get(id) ?? 'fr'
}

/** La langue d'une entreprise (langue par défaut de ses documents). */
export async function accountLocale(db: Db, accountId: string): Promise<Locale> {
  return asLocale((await db.query('select locale from accounts where id = $1', [accountId])).rows[0]?.locale)
}

/** La langue des documents du client d'un projet : celle du projet, sinon celle de l'entreprise. */
export async function docLocale(db: Db, projectId: string): Promise<Locale> {
  const r = (await db.query(
    'select p.doc_locale, a.locale from projects p join accounts a on a.id = p.account_id where p.id = $1', [projectId])).rows[0]
  return asLocale(r?.doc_locale ?? r?.locale)
}
