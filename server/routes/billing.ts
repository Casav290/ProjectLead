import { waitUntil } from '@vercel/functions'
import { Hono } from 'hono'
import { z } from 'zod'
import { publicUrl } from '../lib/env.js'
import { body, HttpError, router, tx, type Env } from '../lib/http.js'
import { planOf } from '../lib/plans.js'
import type { Db } from '../db.js'
import { APP, PRICES, StripeError, portalConfiguration, priceIds, stripe, stripeConfigured, verifyStripeSignature,
         webhookConfigured, type Interval, type PaidPlan } from '../lib/stripe.js'
import { customerOf, GRANTING, processEvent, syncErplead } from '../lib/subscription.js'

/**
 * L'abonnement ProjectLead, pris dans ProjectLead (décision d'Ève du 13.10.2026 : chaque application Lead vend sa
 * propre formule, valable chez elle seule). Modèle : CRMlead (server/routes/billing.ts).
 *
 * - `GET  /api/billing`          : la formule, l'abonnement et les prix (tout membre ; seul l'administrateur agit).
 * - `POST /api/billing/checkout` : une session Stripe Checkout (administrateur).
 * - `POST /api/billing/portal`   : le portail client Stripe propre à ProjectLead (administrateur).
 * - `POST /api/stripe/webhook`   : les événements Stripe, signés (sans session : `webhook`, monté avant la garde).
 */
const app = router()

const RETURN = (state?: 'ok' | 'annule') => `${publicUrl()}/reglages/entreprise${state ? `?paiement=${state}` : ''}`

const failure = (e: unknown): never => {
  if (e instanceof StripeError) {
    console.error('[stripe]', e.status, e.code, e.message)
    throw new HttpError(e.code === 'billing_not_configured' ? 503 : 502, e.code === 'billing_not_configured' ? e.code : 'stripe_error')
  }
  throw e
}

const requireAdmin = (c: any) => { if (c.get('ctx').role !== 'admin') throw new HttpError(403, 'forbidden') }

/**
 * Un abonnement qui empêche d'en prendre un second : en cours (actif, en essai, en retard de paiement) ou impayé
 * (Stripe peut encore l'encaisser) : il se règle ou se change dans le portail.
 */
const BLOCKING = [...GRANTING, 'unpaid']

/** L'abonnement ProjectLead le plus parlant de l'entreprise : celui qui ouvre la formule, sinon le dernier. */
const currentSubscription = async (db: Db) => (await db.query(
  `select stripe_subscription_id, plan, interval, status, current_period_end, cancel_at_period_end, cancel_at
     from billing_subscriptions where account_id = app_account()
    order by (status = any($1)) desc, (status = any($2)) desc, (plan = 'pro_plus') desc, updated_at desc limit 1`,
  [GRANTING, BLOCKING])).rows[0] ?? null

app.get('/billing', async (c) => {
  const ctx = c.get('ctx')
  const { plan, hasCustomer, s } = await tx(c, async (db) => ({
    plan: await planOf(db, ctx.accountId),
    hasCustomer: Boolean((await db.query('select stripe_customer_id from accounts where id = app_account()')).rows[0]?.stripe_customer_id),
    s: await currentSubscription(db),
  }))
  return c.json({
    configured: stripeConfigured(),
    portal: stripeConfigured() && Boolean(portalConfiguration()),
    canManage: ctx.role === 'admin',
    plan,
    subscription: s ? {
      plan: s.plan, interval: s.interval, status: s.status, currentPeriodEnd: s.current_period_end,
      // Fin annoncée (résiliée au portail) : à la fin de la période, ou à la date posée par Stripe (cancel_at).
      endsAt: s.cancel_at ?? (s.cancel_at_period_end ? s.current_period_end : null),
      active: GRANTING.includes(s.status),
      blocking: BLOCKING.includes(s.status),
    } : null,
    hasCustomer,
    prices: PRICES,
    currency: 'EUR',
  })
})

app.post('/billing/checkout', async (c) => {
  requireAdmin(c)
  if (!stripeConfigured()) throw new HttpError(503, 'billing_not_configured')
  const b = await body(c, z.object({ plan: z.enum(['pro', 'pro_plus']), interval: z.enum(['month', 'year']) }))
  const { plan, interval } = b as { plan: PaidPlan; interval: Interval }
  const ctx = c.get('ctx')
  // Déjà abonné à ProjectLead : on change de formule dans le portail, jamais par un second abonnement.
  const s = await tx(c, (db) => currentSubscription(db))
  if (s && BLOCKING.includes(s.status)) throw new HttpError(409, 'already_subscribed')
  try {
    const customer = await customerOf(ctx.accountId, c.get('email'))
    const meta = { app: APP, account_id: ctx.accountId, plan, interval }
    const params: Record<string, unknown> = {
      mode: 'subscription',
      customer,
      // PAS de client_reference_id ni de metadata.workspace_id : le compte Stripe est partagé avec ScanLead, dont le
      // webhook prend ces champs pour un espace ScanLead et annule l'abonnement qu'il ne reconnaît pas. Pas non plus
      // d'invoice_id ni d'organization_id (Stripe Connect d'InvoiceLead). L'entreprise voyage dans metadata.account_id.
      line_items: [{ price: priceIds()[plan][interval], quantity: 1 }],
      success_url: RETURN('ok'),
      cancel_url: RETURN('annule'),
      locale: 'fr',
      metadata: meta,
      subscription_data: { metadata: meta },
      // La carte seule : sans cette liste, Stripe proposerait tout ce qui est activé sur le compte partagé.
      payment_method_types: ['card'],
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      // Exigé par Stripe avec un client existant : l'adresse et le nom saisis s'y enregistrent.
      customer_update: { address: 'auto', name: 'auto' },
      ...(process.env.STRIPE_AUTOMATIC_TAX === '1' ? { automatic_tax: { enabled: true } } : {}),
    }
    // Le compte Stripe s'appelle « scanlead.io » : sans ceci, la page de paiement titrerait SCANLEAD.
    const branding = { display_name: 'ProjectLead', button_color: '#0f6e70', border_style: 'rectangular' }
    // Deux clics (ou deux onglets) dans les 10 minutes rendent la même session : un seul abonnement peut naître.
    const idem = `${APP}-checkout-${ctx.accountId}-${plan}-${interval}-${Math.floor(Date.now() / 600_000)}`
    const create = (p: Record<string, unknown>, key: string) => stripe<{ id: string; url: string }>('POST', '/v1/checkout/sessions', p, key)
    const session = await create({ ...params, branding_settings: branding }, idem).catch((e) => {
      // Une version d'API qui ne connaîtrait pas branding_settings : le paiement passe sans, plutôt que pas du tout.
      if (e instanceof StripeError && e.status === 400 && /branding/i.test(e.message)) return create(params, `${idem}-sans-marque`)
      throw e
    })
    return c.json({ url: session.url })
  } catch (e) { return failure(e) }
})

app.post('/billing/portal', async (c) => {
  requireAdmin(c)
  // Le portail propre à ProjectLead, ou rien : la configuration par défaut du compte partagé est celle de ScanLead.
  if (!stripeConfigured() || !portalConfiguration()) throw new HttpError(503, 'billing_not_configured')
  const customer = await tx(c, async (db) => (await db.query('select stripe_customer_id as c from accounts where id = app_account()')).rows[0]?.c)
  if (!customer) throw new HttpError(409, 'no_customer')
  try {
    const s = await stripe<{ url: string }>('POST', '/v1/billing_portal/sessions', {
      customer, return_url: RETURN(), locale: 'fr', configuration: portalConfiguration(),
    })
    return c.json({ url: s.url })
  } catch (e) { return failure(e) }
})

export default app

// ------------------------------------------------------------------ webhook

/**
 * `POST /api/stripe/webhook`, monté AVANT la garde de session : Stripe n'a pas de cookie, il signe.
 *
 * Ordre : configuration, signature sur le corps BRUT (`c.req.text()`, un JSON relu puis réécrit ne la vérifierait
 * plus), filtre `own` (un événement d'une autre application du compte partagé → 200 « other_app », sans aucune
 * écriture), puis l'effet et l'inscription de l'événement dans une même transaction (rejoué → « duplicate »).
 * Enfin la déclaration à ERPlead ; s'il ne répond pas, la tâche billing_sync réessaie toutes les 10 minutes.
 */
export const webhook = new Hono<Env>()
webhook.post('/', async (c) => {
  if (!webhookConfigured()) return c.json({ error: 'billing_not_configured' }, 503)
  const raw = await c.req.text()
  if (!verifyStripeSignature(raw, c.req.header('Stripe-Signature'), process.env.STRIPE_WEBHOOK_SECRET ?? '')) {
    return c.json({ error: 'invalid_signature' }, 400)
  }
  let event: any
  try { event = JSON.parse(raw) } catch { return c.json({ error: 'invalid_json' }, 400) }
  if (typeof event?.id !== 'string' || typeof event?.type !== 'string' || typeof event?.data?.object !== 'object') {
    return c.json({ error: 'invalid_event' }, 400)
  }
  let out
  try { out = await processEvent(event) } catch (e: any) {
    // Rien n'est inscrit : Stripe renverra l'événement.
    console.error('[stripe] webhook', event.id, event.type, e?.code ?? '', e?.message ?? e)
    return c.json({ error: e instanceof StripeError ? 'stripe_unavailable' : 'server_error' }, e instanceof StripeError ? 502 : 500)
  }
  if (out.accountId && ['applied', 'linked', 'payment_failed'].includes(out.result)) {
    // La déclaration à ERPlead ne retarde pas la réponse à Stripe (qui renverrait l'événement) : sur Vercel, elle
    // se termine après la réponse (`waitUntil`) ; ailleurs, avant. En échec, la tâche billing_sync la reprend.
    const sync = syncErplead({ accountId: out.accountId, limit: 5 }).catch(() => {})
    if (process.env.VERCEL) waitUntil(sync); else await sync
  }
  return c.json({ received: true, result: out.result })
})
