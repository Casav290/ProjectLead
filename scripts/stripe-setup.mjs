#!/usr/bin/env node
/**
 * Met en place l'abonnement d'une application Lead dans Stripe : 2 produits, 4 prix, sa configuration de portail
 * et, sur demande, son endpoint webhook. Idempotent : relancé, il retrouve ce qui existe (produits à identifiant
 * fixe, prix par lookup_key, portail par metadata.app, endpoint par adresse) et ne crée que ce qui manque.
 * Repris de crmlead-vercel/scripts/stripe-setup.mjs, généralisé (`--app`, `--portal`) comme le prévoit le kit.
 *
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs --portal http://127.0.0.1:3002/reglages/entreprise
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup.mjs --live --portal https://projectlead.io/reglages/entreprise \
 *       --webhook https://projectlead.io/api/stripe/webhook --secret-file ~/.projectlead-stripe-whsec   (accord d'Ève)
 *
 * - `--app <code>` : projectlead (seule application décrite ici ; les autres ajoutent leur entrée à APPS).
 * - Une clé live (sk_live_, rk_live_) est refusée sans `--live` explicite.
 * - `--webhook <url>` déclare l'endpoint UNE FOIS, limité aux 5 événements de l'abonnement ; s'il existe déjà, il
 *   n'est ni modifié ni recréé (son secret reste valable). Le secret whsec_… n'existe qu'à la création : il est
 *   écrit dans `--secret-file` (droits 600), JAMAIS affiché.
 * - `--portal <url de retour>` crée ou remet à jour la configuration de portail propre à l'application : factures,
 *   moyen de paiement, adresse et numéro de TVA, résiliation à la fin de la période, changement limité à ses 4 prix
 *   avec prorata, sans quantité.
 * - `STRIPE_API_BASE` (facultatif) : un faux Stripe.
 * Rien n'est jamais supprimé. N'affiche que des identifiants (prix, portail, endpoint), qui ne sont pas secrets.
 */
import { chmodSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null }
const live = args.includes('--live')
const app = opt('--app') ?? 'projectlead'
const webhookUrl = opt('--webhook')
const secretFile = opt('--secret-file')
const portalReturn = opt('--portal')
const key = process.env.STRIPE_SECRET_KEY ?? ''
const base = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '')

const APPS = {
  projectlead: { name: 'ProjectLead', site: 'https://projectlead.io', descriptor: 'PROJECTLEAD.IO',
    pro: 'Projets illimités, 1 personne', pro_plus: "Projets illimités, jusqu'à 5 personnes",
    privacy: '/confidentialite', terms: '/conditions' },
  // Les autres applications ajoutent ici leur entrée (noms, adresses légales) ; le reste du script est commun.
}
const A = APPS[app]
if (!A) { console.error(`--app inconnue : ${app} (${Object.keys(APPS).join(', ')})`); process.exit(1) }
if (!key) { console.error('STRIPE_SECRET_KEY manquant.'); process.exit(1) }
const liveKey = /^(sk|rk)_live_/.test(key)
if (liveKey && !live) { console.error('Clé de production refusée sans --live (accord d\'Ève requis).'); process.exit(1) }
if (live && !liveKey) console.warn('--live demandé, mais la clé n\'est pas une clé de production : mode test.')
if (webhookUrl && !/^https:\/\//.test(webhookUrl)) { console.error('--webhook attend une adresse https'); process.exit(1) }
if (webhookUrl && !secretFile) { console.error('--webhook exige --secret-file <chemin> : le secret n\'est jamais affiché.'); process.exit(1) }
if (portalReturn && !/^https?:\/\//.test(portalReturn)) { console.error('--portal attend une adresse http(s)'); process.exit(1) }
if (portalReturn && liveKey && !portalReturn.startsWith('https://')) { console.error('--portal : https obligatoire en production'); process.exit(1) }

const EVENTS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
                'customer.subscription.deleted', 'invoice.payment_failed']

const PRODUCTS = [
  { id: `${app}_pro`, name: `${A.name} Pro`, description: A.pro, plan: 'pro',
    prices: [{ lookup: `${app}_pro_monthly`, amount: 1900, interval: 'month', env: 'STRIPE_PRICE_PRO_MONTHLY' },
             { lookup: `${app}_pro_yearly`, amount: 19000, interval: 'year', env: 'STRIPE_PRICE_PRO_YEARLY' }] },
  { id: `${app}_pro_plus`, name: `${A.name} Pro+`, description: A.pro_plus, plan: 'pro_plus',
    prices: [{ lookup: `${app}_proplus_monthly`, amount: 3900, interval: 'month', env: 'STRIPE_PRICE_PROPLUS_MONTHLY' },
             { lookup: `${app}_proplus_yearly`, amount: 39000, interval: 'year', env: 'STRIPE_PRICE_PROPLUS_YEARLY' }] },
]

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const kk = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((x, i) => (x !== null && typeof x === 'object' ? form(x, `${kk}[${i}]`, out) : out.append(`${kk}[${i}]`, String(x))))
    else if (typeof v === 'object') form(v, kk, out)
    else out.append(kk, String(v))
  }
  return out
}
async function call(method, path, params) {
  const q = params ? form(params).toString() : ''
  const res = await fetch(`${base}${path}${method === 'GET' && q ? `?${q}` : ''}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? q : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const must = (r, what) => {
  if (r.status >= 300) { console.error(`Échec : ${what} — ${r.data?.error?.message ?? r.status}`); process.exit(1) }
  return r.data
}

console.log(`Stripe ${liveKey ? 'PRODUCTION (réel)' : 'test'} — application ${app}`)
const env = {}
const priceIdsByProduct = {}
for (const p of PRODUCTS) {
  const meta = { app, [`${app}_plan`]: p.plan }
  let prod = await call('GET', `/v1/products/${p.id}`)
  if (prod.status === 404) {
    must(await call('POST', '/v1/products', { id: p.id, name: p.name, description: p.description, metadata: meta,
      statement_descriptor: A.descriptor, tax_code: 'txcd_10103001' }), `création du produit ${p.id}`)
    console.log(`  produit ${p.id} créé`)
  } else {
    prod = must(prod, `lecture du produit ${p.id}`)
    // La marque de l'application, posée si elle manquait (jamais retirée).
    if (prod.metadata?.app !== app || prod.metadata?.[`${app}_plan`] !== p.plan) {
      must(await call('POST', `/v1/products/${p.id}`, { metadata: meta }), `métadonnées du produit ${p.id}`)
      console.log(`  produit ${p.id} déjà là, métadonnées complétées`)
    } else console.log(`  produit ${p.id} déjà là`)
  }
  priceIdsByProduct[p.id] = []
  for (const pr of p.prices) {
    const found = must(await call('GET', '/v1/prices', { lookup_keys: [pr.lookup], active: 'true', limit: 1 }), `recherche du prix ${pr.lookup}`)
    const cur = found.data?.[0]
    const same = cur && cur.unit_amount === pr.amount && cur.currency === 'eur' && cur.recurring?.interval === pr.interval && cur.product === p.id
    if (same) {
      env[pr.env] = cur.id
      priceIdsByProduct[p.id].push(cur.id)
      console.log(`  prix ${pr.lookup} déjà là (${cur.id})`)
      continue
    }
    // Un prix Stripe ne change pas de montant : on en crée un autre, qui reprend la lookup key (l'ancien reste).
    const created = must(await call('POST', '/v1/prices', {
      product: p.id, currency: 'eur', unit_amount: pr.amount, recurring: { interval: pr.interval },
      tax_behavior: 'exclusive', lookup_key: pr.lookup, transfer_lookup_key: 'true',
      metadata: { app, [`${app}_plan`]: p.plan, interval: pr.interval },
    }), `création du prix ${pr.lookup}`)
    env[pr.env] = created.id
    priceIdsByProduct[p.id].push(created.id)
    console.log(`  prix ${pr.lookup} créé (${created.id})${cur ? ` — remplace ${cur.id}` : ''}`)
  }
}

if (portalReturn) {
  const cfg = {
    business_profile: { headline: A.name, privacy_policy_url: `${A.site}${A.privacy}`, terms_of_service_url: `${A.site}${A.terms}` },
    default_return_url: portalReturn,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['address', 'tax_id'] },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: {
        enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations',
        // Sans quantité : Stripe l'active par défaut sur chaque produit (constaté le 13.10.2026), une place = un prix.
        products: PRODUCTS.map((p) => ({ product: p.id, prices: priceIdsByProduct[p.id], adjustable_quantity: { enabled: false } })),
      },
    },
    metadata: { app },
  }
  let mine = null
  for (let after = null; ;) {
    const page = must(await call('GET', '/v1/billing_portal/configurations', { limit: 100, ...(after ? { starting_after: after } : {}) }), 'liste des portails')
    mine = (page.data ?? []).find((c) => c.metadata?.app === app && !c.is_default) ?? null
    if (mine || !page.has_more) break
    after = page.data[page.data.length - 1].id
  }
  if (mine) {
    must(await call('POST', `/v1/billing_portal/configurations/${mine.id}`, { ...cfg, active: 'true' }), 'mise à jour du portail')
    env.STRIPE_PORTAL_CONFIGURATION = mine.id
    console.log(`  portail ${mine.id} déjà là, réglages remis à jour`)
  } else {
    const c = must(await call('POST', '/v1/billing_portal/configurations', cfg), 'création du portail')
    env.STRIPE_PORTAL_CONFIGURATION = c.id
    console.log(`  portail ${c.id} créé`)
  }
}

if (webhookUrl) {
  const list = must(await call('GET', '/v1/webhook_endpoints', { limit: 100 }), 'liste des webhooks')
  const existing = (list.data ?? []).find((w) => w.url === webhookUrl)
  if (existing) {
    console.log(`  webhook ${webhookUrl} déjà déclaré (${existing.id}) : laissé tel quel, son secret reste valable.`)
    const ev = existing.enabled_events ?? []
    const missing = EVENTS.filter((e) => !ev.includes(e) && !ev.includes('*'))
    if (missing.length) console.log(`  ⚠️ événements absents : ${missing.join(', ')}`)
  } else {
    const w = must(await call('POST', '/v1/webhook_endpoints', {
      url: webhookUrl, enabled_events: EVENTS, description: `${A.name} — abonnements (ne pas recréer)`, metadata: { app },
    }), 'déclaration du webhook')
    writeFileSync(secretFile, `STRIPE_WEBHOOK_SECRET=${w.secret}\n`, { mode: 0o600 })
    chmodSync(secretFile, 0o600)
    console.log(`  webhook ${webhookUrl} déclaré (${w.id}) ; secret écrit dans ${secretFile} (droits 600), non affiché`)
  }
}

console.log('\nVariables (identifiants, non secrets) :')
for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`)
