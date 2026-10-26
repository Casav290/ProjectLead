import type { Db } from '../db.js'
import { anon } from '../db.js'
import { leadIdOn } from './env.js'
import { HttpError } from './http.js'
import { entitlementsOf, type LeadEntitlements } from './leadId.js'

/**
 * Les liens avec les autres applications Lead, sans clé (Ève, 26.10.2026 : « simplifier toutes les interconnexions ») :
 * même entreprise dans le Compte Lead (organisation ERPlead, `accounts.lead_org`) = reliées. Rien à copier ni à coller,
 * et relier ne coûte rien (aucune formule, ni ici ni chez l'autre application).
 *
 * « Reliée » / « Pas encore utilisée » se lit chez ERPlead : `apps[code].used` = l'entreprise a déjà ouvert cette
 * application avec le Compte Lead. Copie gardée dans `accounts.lead_apps_used` (db/012_liens_sans_cle.sql), relue au
 * plus toutes les 10 minutes, à la connexion et chaque jour (jobs.ts). Elle sert à l'AFFICHAGE et à décider quand
 * relancer ; jamais à jeter un envoi : c'est l'application d'en face qui répond (404 = pas encore utilisée).
 */

export const LINKED_APPS = ['crmlead', 'invoicelead'] as const
export type LinkedApp = typeof LINKED_APPS[number]
export type LinkStatus = 'linked' | 'not_used'
export type LinkState = { company: string; email?: string; lead: boolean; crmlead: LinkStatus; invoicelead: LinkStatus }

const REFRESH_MS = 10 * 60_000

const usedMap = (lead: Pick<LeadEntitlements, 'apps'> | null | undefined) =>
  Object.fromEntries(Object.entries(lead?.apps ?? {}).map(([code, a]) => [code, (a as any)?.used === true]))

/** Écrit ce qu'ERPlead dit des applications utilisées, pour l'entreprise de CETTE organisation seulement. */
export async function saveAppsUsed(accountId: string, lead: Pick<LeadEntitlements, 'apps'> | null | undefined, org?: string | null) {
  if (!lead?.apps) return
  await anon((db) => db.query(
    `update accounts set lead_apps_used = $2, lead_apps_checked_at = now()
      where id = $1 and lead_org is not null and ($3::text is null or lead_org = $3)`,
    [accountId, JSON.stringify(usedMap(lead)), org ?? null]))
}

/** Relit chez ERPlead (jeton billing) les applications utilisées par l'organisation ; 3 s au plus. */
async function refreshUsed(accountId: string, org: string) {
  try {
    const rights = await Promise.race([
      entitlementsOf({ org }),
      new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), 3000)),
    ])
    await saveAppsUsed(accountId, rights, org)
    return usedMap(rights)
  } catch {
    // ERPlead injoignable : on garde la copie ; nouvel essai dans 30 s si une application attend, sinon dans 10 min
    // (jamais à chaque requête).
    await anon((db) => db.query(`update accounts set lead_apps_checked_at = now() where id = $1`, [accountId]))
    return null
  }
}

/** L'état des liens de l'entreprise. `db` : une transaction de l'entreprise (ou anon), `email` : la personne connectée. */
export async function linkState(db: Db, accountId: string, o: { email?: string; fresh?: boolean; screen?: boolean } = {}): Promise<LinkState> {
  const a = (await db.query(
    `select name, lead_org, lead_apps_used,
            (lead_apps_checked_at is null or lead_apps_checked_at < now() - make_interval(secs => $2)) as stale,
            (lead_apps_checked_at is null or lead_apps_checked_at < now() - make_interval(secs => $3)) as stale_waiting
       from accounts where id = $1`, [accountId, (o.fresh ? 0 : REFRESH_MS) / 1000, o.screen ? 5 : 30])).rows[0]
  if (!a) throw new HttpError(404, 'not_found')
  const lead = Boolean(a.lead_org) && leadIdOn()
  let used: Record<string, boolean> = a.lead_apps_used ?? {}
  // Une application « pas encore utilisée » se relit plus vite (30 s ; 5 s quand l'écran Applications Lead s'ouvre) : la personne vient souvent de l'ouvrir dans
  // un autre onglet et revient ici (parcours local du 26.10.2026 : InvoiceLead ouvert après ProjectLead restait
  // « Pas encore utilisée » pendant 10 minutes).
  const waiting = LINKED_APPS.some((x) => used[x] !== true)
  if (lead && (a.stale || (waiting && a.stale_waiting))) used = (await refreshUsed(accountId, a.lead_org)) ?? used
  const st = (app: LinkedApp): LinkStatus => (lead && used[app] === true ? 'linked' : 'not_used')
  return { company: a.name, ...(o.email ? { email: o.email } : {}), lead, crmlead: st('crmlead'), invoicelead: st('invoicelead') }
}

/** L'organisation ERPlead de l'entreprise, ou 400 `lead_required` (pas de Compte Lead : pas de lien). */
export async function leadOrgOf(db: Db, accountId: string): Promise<string> {
  const org = (await db.query('select lead_org from accounts where id = $1', [accountId])).rows[0]?.lead_org
  if (!org || !leadIdOn()) throw new HttpError(400, 'lead_required')
  return org as string
}
