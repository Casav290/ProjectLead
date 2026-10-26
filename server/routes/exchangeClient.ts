import type { Context } from 'hono'
import { anonTx } from '../db.js'
import { splitAddress } from '../lib/crmlead.js'

/**
 * Enveloppe `client` (CRMlead → ProjectLead, liaison sans clé du 26.10.2026) : l'adresse et les contacts d'un lead que
 * ProjectLead a repris (« Importer depuis CRMlead », lecture avec `link=1`) ont changé dans CRMlead.
 *
 * Met à jour SEULEMENT le client dont external_ref = 'crmlead:<id du lead>' : adresse découpée (splitAddress), pays,
 * contacts manquants ajoutés (jamais un contact existant modifié ni retiré). N'en crée jamais : client absent →
 * 404 { error: 'not_linked' } (CRMlead peut alors cesser de suivre ce lead).
 */
const base = () => (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export async function receiveClient(c: Context, from: string, e: { org: string; source: { id: string }; data: Record<string, any> }) {
  const d = e.data ?? {}
  const out = await anonTx(async (db) => {
    const acc = (await db.query('select id from accounts where lead_org = $1', [e.org])).rows[0]
    if (!acc) return { status: 404 as const, error: 'unknown_org' }
    const cl = (await db.query('select id from clients where account_id = $1 and external_ref = $2',
      [acc.id, `${from}:${e.source.id}`])).rows[0]
    if (!cl) return { status: 404 as const, error: 'not_linked' }

    const address = str(d.company_address, 500)
    if (address) {
      const a = splitAddress(address)
      // Une nouvelle rue sans numéro efface l'ancien numéro (il appartenait à l'ancienne rue).
      await db.query(
        `update clients set street = coalesce($2, street), building_number = case when $2::text is not null then $3 else building_number end,
                postal_code = coalesce($4, postal_code), town = coalesce($5, town)
          where id = $1`,
        [cl.id, a.street?.slice(0, 70) ?? null, a.building_number?.slice(0, 16) ?? null, a.postal_code?.slice(0, 16) ?? null, a.town?.slice(0, 35) ?? null])
    }
    const country = typeof d.company_country === 'string' && /^[A-Z]{2}$/.test(d.company_country) ? d.company_country : null
    if (country) await db.query('update clients set country = $2 where id = $1', [cl.id, country])

    let added = 0
    for (const ct of Array.isArray(d.contacts) ? d.contacts.slice(0, 50) : []) {
      const email = str(ct?.email, 254)?.toLowerCase() ?? null
      const phone = str(ct?.phone, 50)
      if (!email && !phone) continue
      const nm = [str(ct?.first_name, 100), str(ct?.last_name, 100)].filter(Boolean).join(' ')
      const has = (await db.query(
        `select 1 from client_contacts where client_id = $1 and (($2::text is not null and lower(email) = $2) or ($2::text is null and email is null and name = $3))`,
        [cl.id, email, nm])).rowCount
      if (has) continue
      await db.query('insert into client_contacts (account_id, client_id, name, email, phone, job_title) values ($1,$2,$3,$4,$5,$6)',
        [acc.id, cl.id, nm, email, phone, str(ct?.job_title, 120)])
      added++
    }
    await db.query(
      `insert into exchange_links (account_id, app, type, source_id, client_id) values ($1,$2,'client',$3,$4)
       on conflict (account_id, app, type, source_id) do update set client_id = excluded.client_id, updated_at = now()`,
      [acc.id, from, String(e.source.id), cl.id])
    return { status: 200 as const, body: { id: cl.id, url: `${base()}/clients/${cl.id}`, status: 'updated', contacts_added: added } }
  })
  if (out.status === 404) return c.json({ error: out.error }, 404)
  return c.json(out.body, 200)
}
