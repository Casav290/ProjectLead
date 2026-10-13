import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * L'abonnement ProjectLead par Stripe, sans SDK (décision d'Ève du 13.10.2026 : chaque application Lead vend sa
 * propre formule, valable chez elle seule). Repris de CRMlead (crmlead-vercel/server/lib/stripe.ts et
 * server/routes/billing.ts), modèle du kit commun des applications Lead.
 *
 * LE COMPTE STRIPE EST PARTAGÉ (acct_1TRVTg… « scanlead.io ») par ScanLead, CRMlead, InvoiceLead, Greetlead et
 * ProjectLead. ProjectLead ne crée, ne lit, ne modifie et n'annule QUE des objets marqués `metadata.app =
 * 'projectlead'` :
 * - un client Stripe propre à chaque entreprise (metadata app + account_id), jamais retrouvé par e-mail ;
 * - Checkout : metadata ET subscription_data.metadata {app, account_id, plan, interval}. JAMAIS client_reference_id
 *   ni metadata.workspace_id (clés lues par ScanLead, qui annule ce qu'il ne reconnaît pas), jamais invoice_id ni
 *   organization_id (clés de Stripe Connect chez InvoiceLead) ;
 * - portail : la configuration propre à ProjectLead (STRIPE_PORTAL_CONFIGURATION), passée à chaque session ;
 * - webhook : `own(event)` ; tout le reste reçoit 200 « other_app » sans aucune écriture.
 *
 * Tout vient des variables d'environnement (Production seulement sur Vercel) ; sans elles, les boutons de paiement
 * se masquent et le webhook répond 503. Le serveur ne crée JAMAIS l'endpoint webhook (leçon de ScanLead : recréé à
 * chaque démarrage, son secret tournait) : il se déclare une fois, par scripts/stripe-setup.mjs.
 */

export const APP = 'projectlead'

export type PaidPlan = 'pro' | 'pro_plus'
export type Interval = 'month' | 'year'

/** Les prix affichés (HT, en euros), les mêmes dans toutes les applications Lead. */
export const PRICES: Record<PaidPlan, Record<Interval, number>> = {
  pro: { month: 19, year: 190 },
  pro_plus: { month: 39, year: 390 },
}

/** Les « lookup keys » posées par scripts/stripe-setup.mjs. */
export const LOOKUP_KEYS: Record<string, { plan: PaidPlan; interval: Interval }> = {
  projectlead_pro_monthly: { plan: 'pro', interval: 'month' },
  projectlead_pro_yearly: { plan: 'pro', interval: 'year' },
  projectlead_proplus_monthly: { plan: 'pro_plus', interval: 'month' },
  projectlead_proplus_yearly: { plan: 'pro_plus', interval: 'year' },
}

/**
 * La clé secrète. Une clé live (sk_live_, rk_live_) n'est acceptée qu'en production : une préversion Vercel ou
 * un poste de développement qui l'aurait reçue par erreur ne vend rien et ne lit rien.
 */
export function secretKey(): string {
  const k = process.env.STRIPE_SECRET_KEY ?? ''
  const live = /^(sk|rk)_live_/.test(k)
  const env = process.env.VERCEL_ENV
  if (live && env && env !== 'production') return ''
  return k
}

export function priceIds(): Record<PaidPlan, Record<Interval, string>> {
  const e = process.env
  return {
    pro: { month: e.STRIPE_PRICE_PRO_MONTHLY ?? '', year: e.STRIPE_PRICE_PRO_YEARLY ?? '' },
    pro_plus: { month: e.STRIPE_PRICE_PROPLUS_MONTHLY ?? '', year: e.STRIPE_PRICE_PROPLUS_YEARLY ?? '' },
  }
}

/** Le portail propre à ProjectLead. Jamais la configuration par défaut du compte partagé (celle de ScanLead). */
export const portalConfiguration = () => process.env.STRIPE_PORTAL_CONFIGURATION ?? ''

/** Paiement possible : la clé et les quatre prix. */
export function stripeConfigured() {
  const p = priceIds()
  return Boolean(secretKey()) && [p.pro.month, p.pro.year, p.pro_plus.month, p.pro_plus.year].every(Boolean)
}

/** Webhook en service : paiement possible et secret de signature posé. */
export const webhookConfigured = () => stripeConfigured() && Boolean(process.env.STRIPE_WEBHOOK_SECRET)

/**
 * La formule d'un prix ProjectLead : par son identifiant, sa lookup key ou ses métadonnées (app = projectlead).
 * Un prix d'une autre application rend `null` : jamais par `metadata.plan` seul, que les prix ScanLead portent
 * (solo, team) sans `app`.
 */
export function planOfPrice(price: any): { plan: PaidPlan; interval: Interval } | null {
  if (!price) return null
  const id = typeof price === 'string' ? price : price.id
  const p = priceIds()
  for (const plan of ['pro', 'pro_plus'] as const) {
    for (const interval of ['month', 'year'] as const) if (id && p[plan][interval] === id) return { plan, interval }
  }
  if (typeof price === 'object') {
    if (typeof price.lookup_key === 'string' && LOOKUP_KEYS[price.lookup_key]) return LOOKUP_KEYS[price.lookup_key]
    const m = price.metadata ?? {}
    const plan = m.projectlead_plan
    if (m.app === APP && (plan === 'pro' || plan === 'pro_plus')) {
      return { plan, interval: price.recurring?.interval === 'year' ? 'year' : 'month' }
    }
  }
  return null
}

/** La formule d'un abonnement : chacun de ses éléments doit être un prix ProjectLead (un seul en pratique). */
export function planOfSubscription(sub: any): { plan: PaidPlan; interval: Interval } | null {
  const items: any[] = sub?.items?.data ?? []
  if (!items.length) return null
  const plans = items.map((it) => planOfPrice(it?.price))
  if (plans.some((p) => !p)) return null
  // Le meilleur élément, si jamais il y en avait plusieurs.
  return plans.find((p) => p!.plan === 'pro_plus') ?? plans[0]
}

/** Les métadonnées de l'abonnement d'une facture : à la racine (anciennes versions d'API) ou sous `parent`. */
const invoiceSubscriptionMetadata = (inv: any) =>
  inv?.subscription_details?.metadata ?? inv?.parent?.subscription_details?.metadata ?? null

/**
 * Cet événement est-il à ProjectLead ? Le même filtre dans toutes les applications Lead :
 * - checkout.session.completed : mode subscription ET metadata.app = projectlead ;
 * - customer.subscription.* : metadata.app = projectlead ET prix reconnu ;
 * - invoice.payment_failed : la metadata.app de l'abonnement de la facture vaut projectlead ;
 * - tout autre type : non.
 */
export function own(event: any): boolean {
  const obj = event?.data?.object ?? {}
  switch (event?.type) {
    case 'checkout.session.completed':
      return obj.mode === 'subscription' && obj.metadata?.app === APP
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return obj.metadata?.app === APP && planOfSubscription(obj) !== null
    case 'invoice.payment_failed':
      return invoiceSubscriptionMetadata(obj)?.app === APP
    default:
      return false
  }
}

const base = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '')

/** Aplatit un objet à la manière de Stripe : `a[b][0][c]=…`. */
export function formEncode(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((x, i) => {
      if (x !== null && typeof x === 'object') formEncode(x as Record<string, unknown>, `${key}[${i}]`, out)
      else out.append(`${key}[${i}]`, String(x))
    })
    else if (typeof v === 'object') formEncode(v as Record<string, unknown>, key, out)
    else out.append(key, String(v))
  }
  return out
}

export class StripeError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

/** Un appel à l'API Stripe. `idem` : clé d'idempotence (un double clic ne crée pas deux clients). */
export async function stripe<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, unknown>,
                                      idem?: string): Promise<T> {
  const key = secretKey()
  if (!key) throw new StripeError(503, 'billing_not_configured', 'STRIPE_SECRET_KEY manquant')
  const body = params ? formEncode(params).toString() : undefined
  const url = `${base()}${path}${method !== 'POST' && body ? `?${body}` : ''}`
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` }
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  if (idem) headers['Idempotency-Key'] = idem
  const res = await fetch(url, { method, headers, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(15_000) })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new StripeError(res.status, data?.error?.code ?? data?.error?.type ?? 'stripe_error', data?.error?.message ?? `HTTP ${res.status}`)
  return data as T
}

/**
 * Vérifie l'en-tête `Stripe-Signature` (`t=…,v1=…[,v1=…]`) sur le corps BRUT, tel que reçu. Rejette une
 * signature fausse ou un horodatage hors tolérance (5 minutes) : un événement capturé ne se rejoue pas plus tard.
 */
export function verifyStripeSignature(raw: string, header: string | undefined, secret: string,
                                      toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false
  let t = 0
  const sigs: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim()
    if (k === 't') t = Number(v)
    else if (k === 'v1') sigs.push(v)
  }
  if (!Number.isFinite(t) || t <= 0 || !sigs.length) return false
  if (Math.abs(nowSec - t) > toleranceSec) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex'))
  return sigs.some((s) => {
    const got = Buffer.from(s)
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}

/** Signe un corps comme Stripe (contrôles et rejeu en mode test). */
export function signPayload(raw: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex')}`
}

/** La fin de période : à la racine (anciennes versions d'API) ou sur l'élément (depuis 2025). */
export function periodEnd(sub: any): Date | null {
  const s = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end
  return typeof s === 'number' ? new Date(s * 1000) : null
}

/** L'abonnement d'une facture : à la racine (anciennes versions) ou sous `parent` (depuis 2025). */
export function invoiceSubscription(inv: any): string | null {
  const s = inv?.subscription ?? inv?.parent?.subscription_details?.subscription ?? null
  return typeof s === 'string' ? s : s?.id ?? null
}

export const idOf = (x: any): string | null => (typeof x === 'string' ? x : x?.id ?? null)
