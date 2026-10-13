import { anon, anonTx, type Db } from '../db.js'
import { leadIdOn } from './env.js'
import { reportSubscription } from './leadId.js'
import { savePlan } from './plans.js'
import { APP, StripeError, idOf, invoiceSubscription, own, periodEnd, planOfSubscription, stripe, stripeConfigured } from './stripe.js'

/**
 * L'abonnement ProjectLead côté base : le client Stripe de l'entreprise, l'état des abonnements tel que Stripe le
 * dit, et sa déclaration à ERPlead (qui en tire la formule ProjectLead de l'organisation, pour toutes les apps qui
 * la lisent). Les routes HTTP sont dans server/routes/billing.ts.
 */

/** Les statuts qui ouvrent la formule (les mêmes chez ERPlead, identity.ts : active, trialing, past_due). */
export const GRANTING = ['active', 'trialing', 'past_due']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Les statuts définitifs : un abonnement ainsi terminé ne change plus chez Stripe. */
const ENDED = ['canceled', 'incomplete_expired']

/** Une promesse bornée dans le temps : ERPlead qui ne répond pas ne bloque ni le webhook ni la tâche. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })])
    .finally(() => clearTimeout(timer))
}

// ------------------------------------------------------------------ le client Stripe

/**
 * Rattache un client Stripe à l'entreprise, une fois pour toutes. Rend le client retenu. Toujours dans une
 * transaction : un rattachement simultané du même client (contrainte d'unicité) n'annule que son point de reprise.
 */
async function linkCustomer(db: Db, accountId: string, customer: string): Promise<string | null> {
  await db.query('savepoint link_customer')
  try {
    await db.query(
      `update accounts set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null
          and not exists (select 1 from accounts o where o.stripe_customer_id = $2)`, [accountId, customer])
    await db.query('release savepoint link_customer')
  } catch (e: any) {
    if (e?.code !== '23505') throw e
    await db.query('rollback to savepoint link_customer')   // un autre passage l'a rattaché au même instant
  }
  return (await db.query('select stripe_customer_id from accounts where id = $1', [accountId])).rows[0]?.stripe_customer_id ?? null
}

/**
 * Le client Stripe ProjectLead de l'entreprise : créé une fois, marqué app + account_id, jamais retrouvé par
 * e-mail ni partagé avec une autre application (le portail ne montre que ses abonnements). La clé d'idempotence
 * fait que deux clics simultanés reçoivent le même client.
 */
export async function customerOf(accountId: string, email: string): Promise<string> {
  const row = await anon(async (db) => (await db.query('select name, stripe_customer_id from accounts where id = $1', [accountId])).rows[0])
  if (row?.stripe_customer_id) return row.stripe_customer_id
  const cus = await stripe<{ id: string }>('POST', '/v1/customers', {
    name: row?.name ?? undefined, email, metadata: { app: APP, account_id: accountId },
  }, `${APP}-customer-${accountId}`)
  return (await anonTx((db) => linkCustomer(db, accountId, cus.id))) ?? cus.id
}

/** L'entreprise d'un objet Stripe : d'abord par le client (qui fait foi), sinon par nos métadonnées. */
async function accountFor(db: Db, customer: string | null, fallback: unknown): Promise<string | null> {
  if (customer) {
    const a = (await db.query('select id from accounts where stripe_customer_id = $1', [customer])).rows[0]?.id
    if (a) return a
  }
  if (typeof fallback !== 'string' || !UUID.test(fallback)) return null
  const a = (await db.query('select id, stripe_customer_id from accounts where id = $1', [fallback])).rows[0]
  if (!a) return null
  if (customer && !a.stripe_customer_id) await linkCustomer(db, a.id, customer)
  return a.id
}

// ------------------------------------------------------------------ l'état d'un abonnement

export type Outcome = { result: string; accountId?: string | null }

/**
 * Écrit l'état d'un abonnement ProjectLead tel que Stripe le dit (`stateAt` : quand il a été lu). Un état plus
 * ancien que celui déjà écrit est ignoré ; un abonnement ne change jamais d'entreprise. La déclaration à ERPlead
 * est remise à faire quand la formule, le statut ou la fin de période changent.
 */
export async function applySubscription(db: Db, sub: any, stateAt: Date, forcedStatus?: string): Promise<Outcome> {
  if (sub?.metadata?.app !== APP) return { result: 'other_app' }
  const plan = planOfSubscription(sub)
  if (!plan) return { result: 'other_app' }
  if (typeof sub.id !== 'string' || !sub.id.startsWith('sub_')) return { result: 'invalid_subscription' }
  const customer = idOf(sub.customer)
  const accountId = await accountFor(db, customer, sub.metadata?.account_id)
  if (!accountId) { console.warn('[abonnement] abonnement sans entreprise ProjectLead :', sub.id); return { result: 'unknown_account' } }
  const status = forcedStatus ?? String(sub.status ?? 'incomplete')
  // `updated_at` ne bouge (et la déclaration à ERPlead n'est remise à faire) que si quelque chose change vraiment :
  // une relecture identique ne fait pas tourner la tâche du jour en rond.
  const r = await db.query(
    `insert into billing_subscriptions (stripe_subscription_id, account_id, stripe_customer_id, plan, interval, status,
                                        current_period_end, cancel_at_period_end, cancel_at, stripe_state_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (stripe_subscription_id) do update set
       stripe_customer_id = excluded.stripe_customer_id, plan = excluded.plan, interval = excluded.interval,
       status = excluded.status, current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, cancel_at = excluded.cancel_at,
       stripe_state_at = excluded.stripe_state_at,
       updated_at = case
         when (billing_subscriptions.stripe_customer_id, billing_subscriptions.plan, billing_subscriptions.interval,
               billing_subscriptions.status, billing_subscriptions.current_period_end,
               billing_subscriptions.cancel_at_period_end, billing_subscriptions.cancel_at)
              is not distinct from (excluded.stripe_customer_id, excluded.plan, excluded.interval, excluded.status,
                                    excluded.current_period_end, excluded.cancel_at_period_end, excluded.cancel_at)
         then billing_subscriptions.updated_at else now() end,
       erplead_synced_at = case
         when (billing_subscriptions.plan, billing_subscriptions.status, billing_subscriptions.current_period_end)
              is not distinct from (excluded.plan, excluded.status, excluded.current_period_end)
         then billing_subscriptions.erplead_synced_at end
     where billing_subscriptions.stripe_state_at <= excluded.stripe_state_at
       and billing_subscriptions.account_id = excluded.account_id
     returning (xmax = 0) as inserted`,
    [sub.id, accountId, customer, plan.plan, plan.interval, status, periodEnd(sub), Boolean(sub.cancel_at_period_end),
     typeof sub.cancel_at === 'number' ? new Date(sub.cancel_at * 1000) : null, stateAt])
  if (r.rowCount) {
    if (r.rows[0].inserted && GRANTING.includes(status)) await notifyIfTwoSubscriptions(db, accountId, sub.id)
    return { result: 'applied', accountId }
  }
  const kept = (await db.query('select account_id from billing_subscriptions where stripe_subscription_id = $1', [sub.id])).rows[0]
  if (kept && kept.account_id !== accountId) {
    console.error('[abonnement] abonnement déjà rattaché à une autre entreprise, ignoré :', sub.id)
    return { result: 'account_mismatch' }
  }
  return { result: 'stale', accountId }
}

/**
 * Deux abonnements ProjectLead en cours pour une même entreprise (deux paiements dans deux onglets, par exemple) :
 * ProjectLead ne résilie rien lui-même, il prévient les administrateurs, qui en résilient un dans le portail.
 */
async function notifyIfTwoSubscriptions(db: Db, accountId: string, subscriptionId: string) {
  const others = (await db.query(
    `select count(*)::int as n from billing_subscriptions where account_id = $1 and stripe_subscription_id <> $2 and status = any($3)`,
    [accountId, subscriptionId, GRANTING])).rows[0].n
  if (!others) return
  console.warn('[abonnement] deux abonnements ProjectLead en cours pour une entreprise :', accountId)
  await db.query(
    `insert into notifications (account_id, user_id, kind, title, link)
     select $1, au.user_id, 'plan', $2, '/reglages/entreprise' from account_users au
      where au.account_id = $1 and au.role = 'admin' and au.active`,
    [accountId, 'Votre entreprise a deux abonnements ProjectLead en cours : résiliez celui en trop dans Réglages → Entreprise → Gérer l\'abonnement.'])
}

/** Prévient les administrateurs d'un paiement échoué (notification dans ProjectLead, aucun e-mail). */
async function notifyPaymentFailed(db: Db, accountId: string) {
  await db.query(
    `insert into notifications (account_id, user_id, kind, title, link)
     select $1, au.user_id, 'plan', $2, '/reglages/entreprise' from account_users au
      where au.account_id = $1 and au.role = 'admin' and au.active`,
    [accountId, 'Le paiement de l\'abonnement ProjectLead a échoué : mettez à jour le moyen de paiement (Réglages → Entreprise → Gérer l\'abonnement).'])
}

/**
 * Un événement Stripe, déjà signé et vérifié. Ceux d'une autre application du compte partagé (ou d'un type non
 * traité) rendent « other_app » sans AUCUNE écriture, ni en base ni chez Stripe. Pour les nôtres, l'abonnement est
 * relu chez Stripe (l'état le plus récent fait foi : l'ordre d'arrivée des événements n'importe plus) ; une panne
 * de Stripe lève une erreur et Stripe renverra l'événement, qui n'a pas encore été inscrit.
 */
export async function processEvent(event: any): Promise<Outcome> {
  if (!own(event)) return { result: 'other_app' }
  const obj = event.data.object
  const type: string = event.type
  const isSubEvent = type.startsWith('customer.subscription.')
  const subId = isSubEvent ? idOf(obj) : type === 'checkout.session.completed' ? idOf(obj.subscription) : invoiceSubscription(obj)
  let sub: any = null
  let stateAt = new Date((Number(event.created) || Math.floor(Date.now() / 1000)) * 1000)
  if (subId) {
    try {
      sub = await stripe('GET', `/v1/subscriptions/${encodeURIComponent(subId)}`)
      stateAt = new Date()
    } catch (e) {
      if (!(e instanceof StripeError && e.status === 404)) throw e
      // Introuvable chez Stripe : l'événement d'abonnement porte lui-même l'état.
      sub = isSubEvent ? obj : null
    }
    // Double contrôle sur l'état relu : toujours un abonnement ProjectLead, avec un prix ProjectLead.
    if (sub && (sub.metadata?.app !== APP || !planOfSubscription(sub))) return { result: 'other_app' }
  }

  return anonTx(async (db) => {
    const fresh = (await db.query('insert into stripe_events (id, type) values ($1, $2) on conflict (id) do nothing', [event.id, type])).rowCount
    if (!fresh) return { result: 'duplicate' }
    let out: Outcome = { result: 'ignored' }
    switch (type) {
      case 'checkout.session.completed': {
        const accountId = await accountFor(db, null, obj.metadata?.account_id)
        if (!accountId) { out = { result: 'unknown_account' }; break }
        if (idOf(obj.customer)) await linkCustomer(db, accountId, idOf(obj.customer)!)
        out = sub ? await applySubscription(db, sub, stateAt) : { result: 'linked', accountId }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        out = sub ? await applySubscription(db, sub, stateAt) : { result: 'unknown_subscription' }
        break
      case 'customer.subscription.deleted': {
        // Retour au gratuit : aucune donnée ne part, seules les limites reviennent.
        const ended = ENDED.includes(String(sub?.status)) ? undefined : 'canceled'
        out = sub ? await applySubscription(db, sub, stateAt, ended) : { result: 'unknown_subscription' }
        break
      }
      case 'invoice.payment_failed': {
        const applied = sub ? await applySubscription(db, sub, stateAt) : null
        const accountId = applied?.accountId ?? await accountFor(db, idOf(obj.customer), null)
        if (!accountId) { out = { result: 'unknown_account' }; break }
        await notifyPaymentFailed(db, accountId)
        out = { result: 'payment_failed', accountId }
        break
      }
    }
    await db.query('update stripe_events set result = $2, account_id = $3 where id = $1', [event.id, out.result, out.accountId ?? null])
    return out
  })
}

// ------------------------------------------------------------------ la déclaration à ERPlead

/**
 * Déclare à ERPlead un abonnement dont l'état a changé, puis recopie la formule ProjectLead qu'il rend.
 * Un verrou par abonnement : deux déclarations du même abonnement ne se croisent pas ; l'état est relu sous le
 * verrou, et n'est marqué « déclaré » que s'il n'a pas changé pendant l'appel (sinon la tâche redéclare).
 */
async function syncOne(subscriptionId: string): Promise<'synced' | 'busy' | 'nothing'> {
  return anonTx(async (db) => {
    const got = (await db.query('select pg_try_advisory_xact_lock(hashtextextended($1, 7351)) as ok', [`billing_sync:${subscriptionId}`])).rows[0]?.ok
    if (!got) return 'busy'
    const row = (await db.query(
      `select s.stripe_subscription_id, s.plan, s.status, s.current_period_end, s.updated_at::text as version, a.id as account_id, a.lead_org
         from billing_subscriptions s join accounts a on a.id = s.account_id
        where s.stripe_subscription_id = $1 and s.erplead_synced_at is null and a.lead_org is not null`, [subscriptionId])).rows[0]
    if (!row) return 'nothing'
    // Le verrou (et la transaction) ne durent que le temps de cet appel, borné à 8 secondes. Une réponse plus lente
    // est abandonnée : rien n'est marqué, la tâche redéclare ; la relecture du jour corrige un état arrivé en retard.
    const rights = await withTimeout(reportSubscription({
      org: row.lead_org, external_id: row.stripe_subscription_id, plan: row.plan, status: row.status,
      current_period_end: row.current_period_end,
    }), 8_000)
    // Comparé au texte (microsecondes) : une date JavaScript n'a que des millisecondes.
    await db.query('update billing_subscriptions set erplead_synced_at = now() where stripe_subscription_id = $1 and updated_at = $2::timestamptz',
      [row.stripe_subscription_id, row.version])
    await savePlan(db, row.account_id, rights)
    return 'synced'
  })
}

/** Les abonnements pas encore déclarés à ERPlead (tâche `billing_sync`, toutes les 10 minutes, et après un webhook). */
export async function syncErplead(opts: { accountId?: string | null; limit?: number } = {}) {
  if (!leadIdOn()) return { synced: 0, failed: 0 }
  const rows = await anon(async (db) => (await db.query(
    `select s.stripe_subscription_id from billing_subscriptions s join accounts a on a.id = s.account_id
      where s.erplead_synced_at is null and a.lead_org is not null and ($2::uuid is null or s.account_id = $2)
      order by s.updated_at limit $1`, [opts.limit ?? 50, opts.accountId ?? null])).rows)
  let synced = 0, failed = 0
  for (const r of rows) {
    try { if ((await syncOne(r.stripe_subscription_id)) === 'synced') synced++ } catch (e: any) {
      failed++
      console.error('[abonnement] déclaration à ERPlead :', r.stripe_subscription_id, e?.message ?? e)
    }
  }
  return { synced, failed }
}

/**
 * Une fois par jour : les abonnements qui peuvent encore changer (tous sauf les terminés) relus chez Stripe, les
 * plus anciennement relus d'abord, puis ceux en cours redéclarés à ERPlead. Rattrape un webhook manqué (endpoint en
 * panne plus de 3 jours) et une déclaration arrivée dans le désordre chez ERPlead.
 */
export async function reconcileSubscriptions(limit = 50) {
  if (!stripeConfigured()) return { checked: 0 }
  const rows = await anon(async (db) => (await db.query(
    `select stripe_subscription_id from billing_subscriptions where status <> all($1) order by stripe_state_at limit $2`,
    [ENDED, limit])).rows)
  let checked = 0
  for (const r of rows) {
    let sub
    try { sub = await stripe('GET', `/v1/subscriptions/${encodeURIComponent(r.stripe_subscription_id)}`) } catch (e: any) {
      console.error('[abonnement] relecture Stripe :', r.stripe_subscription_id, e?.code ?? e?.message); continue
    }
    const at = new Date()
    await anonTx(async (db) => {
      const out = await applySubscription(db, sub, at)
      if (out.result === 'applied' && GRANTING.includes(String(sub.status)))
        await db.query('update billing_subscriptions set erplead_synced_at = null where stripe_subscription_id = $1', [r.stripe_subscription_id])
    })
    checked++
  }
  await syncErplead({ limit })
  return { checked }
}

/**
 * Résilier tout de suite les abonnements ProjectLead d'une entreprise (avant d'effacer l'entreprise : la clé
 * étrangère de billing_subscriptions l'impose). Seulement les abonnements de NOTRE table, jamais un autre objet du
 * compte Stripe partagé. Aucune route ne supprime d'entreprise aujourd'hui ; toute future suppression passe ici.
 */
export async function cancelAccountSubscriptions(accountId: string) {
  const subs = await anon(async (db) => (await db.query(
    `select stripe_subscription_id from billing_subscriptions where account_id = $1 and status <> all($2)`,
    [accountId, ENDED])).rows)
  for (const s of subs) {
    const id = String(s.stripe_subscription_id)
    if (!id.startsWith('sub_')) continue
    const path = `/v1/subscriptions/${encodeURIComponent(id)}`
    const gone = (e: unknown) => { if (e instanceof StripeError && e.status === 404) return null; throw e }
    // Relu d'abord : on ne résilie qu'un abonnement qui porte encore la marque de ProjectLead.
    const current = await stripe('GET', path).catch(gone)
    if (!current || current.metadata?.app !== APP) continue
    const sub = await stripe('DELETE', path).catch(gone)
    if (sub) await anonTx((db) => applySubscription(db, sub, new Date(), 'canceled'))
  }
  await syncErplead({ accountId })
  return subs.length
}
