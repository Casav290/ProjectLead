#!/usr/bin/env node
/**
 * Rejoue vers un webhook LOCAL les événements Stripe du compte de TEST depuis un instant donné, signés comme Stripe
 * les signe, avec le secret du serveur local. Il n'existe pas d'endpoint de test joignable depuis Stripe : c'est
 * ainsi qu'un parcours de paiement de test (Checkout réel en mode test, portail) se termine en local.
 *
 *   STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_local_… \
 *     node scripts/stripe-replay.mjs --since 1760340000 --to http://127.0.0.1:3412/api/stripe/webhook
 *
 * - Refuse toute clé live (sk_live_, rk_live_) : en production, Stripe livre lui-même.
 * - `--since` : horodatage Unix (secondes) ou date ISO ; `--all` : tous les types, sinon les 5 types de l'endpoint
 *   d'abonnement (comme un endpoint réel limité à ses événements).
 * - Rejoue TOUS les événements du compte de test (celui-ci est partagé par les applications Lead) : ceux des
 *   autres applications doivent revenir « other_app ».
 * - Affiche, par événement : identifiant, type, statut HTTP et résultat. Code de sortie 1 si un envoi échoue.
 */
import { createHmac } from 'node:crypto'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null }
const key = process.env.STRIPE_SECRET_KEY ?? ''
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
const to = opt('--to')
const sinceRaw = opt('--since')
const base = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '')
const TYPES = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
               'customer.subscription.deleted', 'invoice.payment_failed']

if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) { console.error('Clé de TEST exigée (sk_test_…) : le rejeu ne touche jamais au réel.'); process.exit(1) }
if (!secret) { console.error('STRIPE_WEBHOOK_SECRET manquant (le secret du serveur local).'); process.exit(1) }
if (!to || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(to)) { console.error('--to attend l\'adresse d\'un webhook local (http://127.0.0.1:…/api/stripe/webhook)'); process.exit(1) }
const since = sinceRaw && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : Math.floor(Date.parse(sinceRaw ?? '') / 1000)
if (!Number.isFinite(since)) { console.error('--since attend un horodatage Unix ou une date ISO'); process.exit(1) }

async function listEvents({ key, since, all = false, base = 'https://api.stripe.com' }) {
  const out = []
  let after = null
  for (;;) {
    const q = new URLSearchParams({ limit: '100', 'created[gte]': String(since) })
    if (!all) TYPES.forEach((t, i) => q.append(`types[${i}]`, t))
    if (after) q.set('starting_after', after)
    const r = await fetch(`${base}/v1/events?${q}`, { headers: { Authorization: `Bearer ${key}` } })
    const d = await r.json()
    if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`)
    out.push(...d.data)
    if (!d.has_more) break
    after = d.data[d.data.length - 1].id
  }
  return out.reverse()   // du plus ancien au plus récent, comme Stripe les aurait livrés
}

async function deliver(event, { to, secret }) {
  const raw = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const sig = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex')}`
  const r = await fetch(to, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: raw })
  const body = await r.json().catch(() => null)
  return { status: r.status, result: body?.result ?? body?.error ?? null }
}

const events = await listEvents({ key, since, all: args.includes('--all'), base })
let failed = 0
const tally = {}
for (const e of events) {
  const d = await deliver(e, { to, secret })
  if (d.status >= 300) failed++
  tally[d.result] = (tally[d.result] ?? 0) + 1
  const app = e.data?.object?.metadata?.app ?? e.data?.object?.parent?.subscription_details?.metadata?.app ?? '-'
  console.log(`${e.id}  ${e.type.padEnd(31)}  app=${String(app).padEnd(11)}  ${d.status}  ${d.result}`)
}
console.log(`\n${events.length} événements rejoués : ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun'}${failed ? ` ; ${failed} en échec` : ''}`)
process.exit(failed ? 1 : 0)
