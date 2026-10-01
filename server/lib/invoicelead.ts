import type { Db } from '../db.js'
import { HttpError } from './http.js'
import { open } from './mailbox/secret.js'
import { outboundUrlProblem } from './netguard.js'

/**
 * InvoiceLead, la facturation de la famille (API REST v1, clé `il_live_…`, formule Pro+).
 * ProjectLead y crée des **brouillons** : la personne les relit et les émet dans InvoiceLead,
 * qui calcule la TVA, la QR-facture et passe les écritures. Rien n'est émis d'ici.
 */

export type IlConfig = { url: string; key: string; language: string }

export async function invoiceleadConfig(db: Db): Promise<IlConfig | null> {
  const s = (await db.query(
    'select invoicelead_url, invoicelead_key_enc, invoice_language from account_settings where account_id = app_account()')).rows[0]
  if (!s?.invoicelead_url || !s?.invoicelead_key_enc) return null
  return { url: String(s.invoicelead_url).replace(/\/+$/, ''), key: open<string>(s.invoicelead_key_enc), language: s.invoice_language }
}

export async function ilFetch(cfg: { url: string; key: string }, path: string, init: { method?: string; json?: unknown } = {}) {
  if (outboundUrlProblem(cfg.url)) throw new HttpError(400, 'invoicelead_url_invalid')
  let r: Response
  try {
    r = await fetch(`${cfg.url}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json',
                 ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new HttpError(502, 'invoicelead_unreachable')
  }
  const data: any = await r.json().catch(() => ({}))
  if (r.status === 401) throw new HttpError(502, 'invoicelead_key_invalid')
  if (r.status === 403) throw new HttpError(502, 'invoicelead_forbidden')
  if (!r.ok) throw new HttpError(502, 'invoicelead_error', { status: r.status, detail: data })
  return data
}

const IL_COUNTRIES = new Set(['CH', 'LI', 'DE', 'FR', 'IT', 'AT'])
const IL_LANGUAGES = new Set(['de', 'fr', 'it', 'en'])

/** Le contact InvoiceLead du client : retenu, sinon retrouvé (email puis nom), sinon créé. */
export async function ensureContact(db: Db, cfg: IlConfig, client: any): Promise<string> {
  if (client.invoicelead_contact_id) return client.invoicelead_contact_id
  const tries = [client.email, client.name].filter(Boolean) as string[]
  let found: any = null
  for (const q of tries) {
    const list = (await ilFetch(cfg, `/contacts?q=${encodeURIComponent(q.slice(0, 100))}`)).data ?? []
    found = list.find((x: any) => (client.email && x.email?.toLowerCase() === client.email.toLowerCase())
      || x.name?.toLowerCase() === client.name.toLowerCase())
    if (found) break
  }
  if (!found) {
    found = (await ilFetch(cfg, '/contacts', { method: 'POST', json: {
      kind: client.kind, name: client.name, contactPerson: client.contact_person ?? undefined,
      email: client.email ?? undefined, phone: client.phone ?? undefined, street: client.street ?? undefined,
      buildingNumber: client.building_number ?? undefined, postalCode: client.postal_code ?? undefined,
      town: client.town ?? undefined, country: IL_COUNTRIES.has(client.country) ? client.country : 'CH',
      language: IL_LANGUAGES.has(client.language) ? client.language : cfg.language, uid: client.vat_number ?? undefined,
    } })).data
  }
  await db.query('update clients set invoicelead_contact_id = $1 where id = $2', [found.id, client.id])
  return found.id
}

export type InvoiceLine = { description: string; quantity: number; unit: 'hour' | 'day' | 'piece' | 'flat' | 'month'; unitPriceCents: number }

export async function createDraftInvoice(cfg: IlConfig, x: {
  contactId: string; title: string; intro?: string; serviceDate: string; currency: string; vatCode: string; lines: InvoiceLine[]
}) {
  const out = await ilFetch(cfg, '/invoices', { method: 'POST', json: {
    contactId: x.contactId, language: cfg.language, title: x.title.slice(0, 200), introText: x.intro,
    serviceDate: x.serviceDate, currency: x.currency,
    lines: x.lines.map((l) => ({
      description: l.description.slice(0, 500), quantity: l.quantity.toFixed(2), unit: l.unit,
      unitPrice: (l.unitPriceCents / 100).toFixed(2), vatCode: x.vatCode,
    })),
  } })
  const inv = out.data
  return { id: String(inv.id), totalCents: Number(inv.totalCents ?? 0),
           url: `${cfg.url}/${cfg.language === 'de' ? 'de' : 'fr'}/app/invoices/${inv.id}` }
}
