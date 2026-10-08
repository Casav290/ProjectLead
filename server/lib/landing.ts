import { hashToken, SESSION_COOKIE } from '../auth.js'
import { anon } from '../db.js'

/**
 * « / » montre la page d'accueil (accueil.html) à qui n'a pas de session valide, et l'application à qui en a une.
 * Sans cookie, aucune requête à la base : le visiteur reçoit la page tout de suite.
 */
export function sessionToken(cookie: string | null | undefined): string | null {
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookie ?? '')
  return m && m[1].length >= 16 ? m[1] : null
}

/** Vrai si le cookie porte une session en cours d'une personne active. Une base injoignable laisse passer vers l'application. */
export async function hasSession(cookie: string | null | undefined): Promise<boolean> {
  const token = sessionToken(cookie)
  if (!token) return false
  try {
    return Boolean(await anon(async (db) => (await db.query(
      `select 1 from sessions s join account_users au on au.user_id = s.user_id and au.account_id = s.account_id and au.active
        where s.token_hash = $1 and s.expires_at > now() limit 1`, [hashToken(token)])).rowCount))
  } catch {
    return true
  }
}

/** La même adresse rend deux pages selon le cookie : aucun cache partagé, revalidation à chaque visite. */
export const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Cookie' } as const
