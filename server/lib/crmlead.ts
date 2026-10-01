import type { Db } from '../db.js'
import { HttpError } from './http.js'
import { open } from './mailbox/secret.js'
import { outboundUrlProblem } from './netguard.js'

/**
 * CRMlead, le carnet d'adresses de la famille. ProjectLead ne garde pas sa propre saisie des
 * clients quand CRMlead est branché : il y cherche l'entreprise et ses contacts (API REST v1,
 * clé `crm_…` créée dans CRMlead → Intégrations) et les reprend, liés par `crmlead:<id>`.
 */

export type CrmLead = {
  id: string; title: string; company: string | null; company_address: string | null; company_country: string | null
  status: string; amount: number | null; currency: string | null; description: string | null
  contacts?: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
               job_title: string | null; is_primary: boolean }[]
}

export async function crmleadConfig(db: Db) {
  const s = (await db.query('select crmlead_url, crmlead_key_enc from account_settings where account_id = app_account()')).rows[0]
  if (!s?.crmlead_url || !s?.crmlead_key_enc) return null
  return { url: String(s.crmlead_url).replace(/\/+$/, ''), key: open<string>(s.crmlead_key_enc) }
}

export async function crmFetch(cfg: { url: string; key: string }, path: string) {
  if (outboundUrlProblem(cfg.url)) throw new HttpError(400, 'crmlead_url_invalid')
  let r: Response
  try {
    r = await fetch(`${cfg.url}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new HttpError(502, 'crmlead_unreachable')
  }
  if (r.status === 401) throw new HttpError(502, 'crmlead_key_invalid')
  if (r.status === 404) throw new HttpError(404, 'not_found')
  if (!r.ok) throw new HttpError(502, 'crmlead_error', { status: r.status })
  return r.json()
}

export async function searchLeads(cfg: { url: string; key: string }, q: string) {
  const out = await crmFetch(cfg, `/leads?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  return (out.data ?? []) as CrmLead[]
}

export const getLead = (cfg: { url: string; key: string }, id: string) =>
  crmFetch(cfg, `/leads/${encodeURIComponent(id)}`) as Promise<CrmLead>

/**
 * « Rue de Bourg 12, 1003 Lausanne » → rue, numéro, NPA, localité. L'adresse de CRMlead est
 * une ligne libre (registre du commerce) : on découpe ce qui se découpe, le reste va en rue.
 */
export function splitAddress(raw: string | null | undefined) {
  const out = { street: null as string | null, building_number: null as string | null,
                postal_code: null as string | null, town: null as string | null }
  if (!raw) return out
  const parts = raw.split(/,|\n/).map((s) => s.trim()).filter(Boolean)
  const cityIdx = parts.findIndex((p) => /^(?:[A-Z]{1,2}-)?\d{4,5}\s+\S/.test(p))
  if (cityIdx >= 0) {
    const m = parts[cityIdx].match(/^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/)!
    out.postal_code = m[1]; out.town = m[2]
    parts.splice(cityIdx, 1)
  }
  const street = parts[0] ?? null
  if (street) {
    const m = street.match(/^(.*\D)\s+(\d+[a-zA-Z]?)$/)
    if (m) { out.street = m[1].trim(); out.building_number = m[2] } else out.street = street
  }
  return out
}

/** Reprend (ou met à jour) un client depuis un lead CRMlead. Rend l'identifiant du client. */
export async function upsertClientFromLead(db: Db, accountId: string, lead: CrmLead) {
  const primary = (lead.contacts ?? []).find((x) => x.is_primary) ?? lead.contacts?.[0]
  const person = primary ? [primary.first_name, primary.last_name].filter(Boolean).join(' ') : null
  const addr = splitAddress(lead.company_address)
  const name = lead.company || person || lead.title
  const ref = `crmlead:${lead.id}`
  const country = /^[A-Z]{2}$/.test(lead.company_country ?? '') ? lead.company_country : null
  const row = (await db.query(
    `insert into clients (account_id, kind, name, contact_person, email, phone, street, building_number, postal_code, town,
                          country, external_ref)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'CH'),$12)
     on conflict (account_id, external_ref) where external_ref is not null do update set
       name = excluded.name, contact_person = coalesce(excluded.contact_person, clients.contact_person),
       email = coalesce(excluded.email, clients.email), phone = coalesce(excluded.phone, clients.phone),
       street = coalesce(excluded.street, clients.street), building_number = coalesce(excluded.building_number, clients.building_number),
       postal_code = coalesce(excluded.postal_code, clients.postal_code), town = coalesce(excluded.town, clients.town),
       archived_at = null
     returning id`,
    [accountId, lead.company ? 'company' : 'person', name.slice(0, 200), person, primary?.email ?? null, primary?.phone ?? null,
     addr.street, addr.building_number, addr.postal_code, addr.town, country, ref])).rows[0]
  for (const ct of lead.contacts ?? []) {
    if (!ct.email && !ct.phone) continue
    const nm = [ct.first_name, ct.last_name].filter(Boolean).join(' ')
    const exists = (await db.query('select id from client_contacts where client_id = $1 and (lower(email) = lower($2) or (email is null and name = $3))',
      [row.id, ct.email ?? '', nm])).rows[0]
    if (exists) {
      await db.query('update client_contacts set name = $2, phone = coalesce($3, phone), job_title = coalesce($4, job_title) where id = $1',
        [exists.id, nm, ct.phone, ct.job_title])
    } else {
      await db.query('insert into client_contacts (account_id, client_id, name, email, phone, job_title) values ($1,$2,$3,$4,$5,$6)',
        [accountId, row.id, nm, ct.email, ct.phone, ct.job_title])
    }
  }
  return row.id as string
}
