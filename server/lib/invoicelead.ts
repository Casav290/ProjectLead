import type { Db } from '../db.js'
import { appUrl, send, readExchange } from './leadId.js'
import { exchangeFailure, type Reader } from './crmlead.js'

/**
 * InvoiceLead, la facturation de la famille. ProjectLead y crée des **brouillons** : la personne les relit et les émet
 * dans InvoiceLead, qui calcule la TVA, la QR-facture et passe les écritures. Rien n'est émis d'ici.
 *
 * Sans clé, dans toutes les formules (26.10.2026) : l'enveloppe `invoice` part dans la boîte d'échange d'InvoiceLead
 * (synchrone, avec résultat) avec un jeton d'ERPlead lié à l'entreprise, et à la personne qui lance la facturation
 * quand il y en a une (la tâche mensuelle : sans personne, InvoiceLead attribue le brouillon à son premier
 * administrateur qui a le droit de facturer). Deux envois identiques = un seul brouillon (source.id = run:<projet>:<mois>).
 */

const IL_COUNTRIES = new Set(['CH', 'LI', 'DE', 'FR', 'IT', 'AT'])
const IL_LANGUAGES = new Set(['de', 'fr', 'it', 'en'])

const invoicelead = () => ({ app: 'invoicelead', url: appUrl('invoicelead') })

/** Le lien d'une facture InvoiceLead, construit ici par son identifiant (jamais une URL reçue). */
export const invoiceUrl = (id: string, language: string) =>
  `${appUrl('invoicelead')}/${language === 'de' ? 'de' : 'fr'}/app/invoices/${encodeURIComponent(id)}`

/** Les clients du carnet d'InvoiceLead (pas les fournisseurs), recherche facultative, avec les droits de la personne. */
export async function searchContacts(who: Reader, q: string) {
  let out: any
  try { out = await readExchange(invoicelead(), { type: 'contact', q: q.slice(0, 100) || undefined, limit: 20 }, who) }
  catch (e) { return exchangeFailure(e, 'invoicelead') }
  return ((out.data ?? []) as any[]).filter((x) => x.isCustomer !== false)
}

/**
 * Reprend (ou met à jour) un client depuis un contact InvoiceLead. Le client déjà relié à ce contact
 * est mis à jour, sinon celui qui porte le même email, sinon un nouveau est créé. Rend son identifiant.
 */
export async function upsertClientFromContact(db: Db, accountId: string, ct: any) {
  const id = String(ct.id)
  const email = ct.email ? String(ct.email).slice(0, 200) : null
  const existing = (await db.query(
    `select id from clients where invoicelead_contact_id = $1
        or ($2::text is not null and invoicelead_contact_id is null and lower(email) = lower($2))
      order by (invoicelead_contact_id = $1) desc nulls last limit 1`, [id, email])).rows[0]
  const v = [ct.kind === 'person' ? 'person' : 'company', String(ct.name ?? '').slice(0, 200) || email || id,
    ct.contactPerson ?? null, email, ct.phone ?? null, ct.street ?? null, ct.buildingNumber ?? null,
    ct.postalCode ?? null, ct.town ?? null, /^[A-Z]{2}$/.test(ct.country ?? '') ? ct.country : null,
    IL_LANGUAGES.has(ct.language) ? ct.language : null, ct.uid ?? null, id]
  if (existing) {
    await db.query(
      `update clients set kind = $2, name = $3, contact_person = coalesce($4, contact_person), email = coalesce($5, email),
         phone = coalesce($6, phone), street = coalesce($7, street), building_number = coalesce($8, building_number),
         postal_code = coalesce($9, postal_code), town = coalesce($10, town), country = coalesce($11, country),
         language = coalesce($12, language), vat_number = coalesce($13, vat_number), invoicelead_contact_id = $14,
         archived_at = null
       where id = $1`, [existing.id, ...v])
    return existing.id as string
  }
  return (await db.query(
    `insert into clients (account_id, kind, name, contact_person, email, phone, street, building_number, postal_code, town,
                          country, language, vat_number, invoicelead_contact_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'CH'),coalesce($12,'fr'),$13,$14) returning id`,
    [accountId, ...v])).rows[0].id as string
}

export type InvoiceLine = { description: string; quantity: number; unit: 'hour' | 'day' | 'piece' | 'flat' | 'month'; unitPriceCents: number }

export type SentDraft = { id: string; status: 'created' | 'updated'; totalCents: number; contactId: string | null; url: string }

/**
 * Envoie (ou remplace) le brouillon du mois d'un projet dans InvoiceLead. Rend sa réponse, dont le contact retenu par
 * InvoiceLead (à garder sur le client, `clients.invoicelead_contact_id` : indice pour le prochain envoi). Aucun accès à
 * la base ici : l'appelant n'est jamais dans une transaction pendant l'envoi. Les refus (404 pas encore utilisée,
 * 409 contact_limit / already_issued, 403 person_proof…) remontent en ExchangeError.
 */
export async function sendInvoiceDraft(x: {
  org: string; sub?: string | null; personProof?: string | null; projectId: string; period: string; language: string
  client: any; title: string; intro?: string; serviceDate: string; currency: string; vatCode: string; lines: InvoiceLine[]
}): Promise<SentDraft> {
  const c = x.client
  const out: any = await send(invoicelead(), {
    type: 'invoice', org: x.org, ...(x.sub ? { sub: x.sub } : {}),
    source: { id: `run:${x.projectId}:${x.period}` },
    data: {
      client: {
        source_id: String(c.id), ...(c.invoicelead_contact_id ? { invoicelead_contact_id: String(c.invoicelead_contact_id) } : {}),
        kind: c.kind === 'person' ? 'person' : 'company', name: String(c.name).slice(0, 200),
        contact_person: c.contact_person ?? null, email: c.email ?? null, phone: c.phone ?? null, street: c.street ?? null,
        building_number: c.building_number ?? null, postal_code: c.postal_code ?? null, town: c.town ?? null,
        country: IL_COUNTRIES.has(c.country) ? c.country : 'CH',
        language: IL_LANGUAGES.has(c.language) ? c.language : x.language, vat_number: c.vat_number ?? null,
      },
      title: x.title.slice(0, 200), intro: x.intro ?? null, service_date: x.serviceDate, currency: x.currency,
      vat_code: x.vatCode, language: x.language,
      lines: x.lines.map((l) => ({ description: l.description.slice(0, 500), quantity: l.quantity, unit: l.unit,
                                   unit_price_cents: Math.round(l.unitPriceCents) })),
    },
  }, { personProof: x.personProof })
  const id = String(out.id)
  const contactId = out.contact_id ? String(out.contact_id) : null
  return { id, status: out.status === 'updated' ? 'updated' : 'created', totalCents: Number(out.total_cents ?? 0), contactId,
           url: invoiceUrl(id, x.language) }
}
