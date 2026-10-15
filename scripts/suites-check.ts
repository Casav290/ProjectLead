/**
 * Suites de l'abonnement par application (15.10.2026 ; spécification ~/projets/.unlazy/lead-vercel/
 * billing-followups-design.md, sections 1, 2, 4 et 6a ; porte L4 de GATES-billing-followups.md) : les contrôles sans
 * serveur ni base.
 *
 *   npx tsx scripts/suites-check.ts   → PROJECTLEAD_SUITES_UNIT_OK (code 0), sinon PROJECTLEAD_SUITES_UNIT_KO (code 1)
 *
 * 1. Offres : la règle du serveur (`isAbove`, Checkout refusé pour une formule non supérieure à la formule acquise) et
 *    la page Formule rendue (`PlanStatus`, `PlanTiers`) : formule propre Pro+ ou Pro lue au Compte Lead, héritage,
 *    abonnement ProjectLead, Gratuit, vue d'une membre. Aucune offre égale ou inférieure à la formule acquise ; contrat
 *    data-plan-current / data-plan-acquired / data-plan-offer ; origine et date d'une formule venue du Compte Lead.
 * 2. Places : la liste rendue (`SeatList`) : contrat data-seat-list (data-seats-used = nombre de lignes,
 *    data-seats-max), une ligne data-seat-holder par place (invitations en attente comprises), data-last-seen dans
 *    chaque ligne, « Retirer » (data-seat-remove) pour l'administrateur sauf sur sa propre ligne, aucun pour une membre
 *    ni pour un responsable ; personnes retirées à part (data-seat-removed, « Rétablir ») ; migration de la dernière
 *    venue additive et rejouable.
 * 3. Refus « places » : l'adresse du refus porte la formule (`refusalLocation`) ; l'écran rendu (`RefusedScreen`) pour
 *    Gratuit, Pro, Pro+ et sans formule : « Changer de compte » (data-switch-account → /auth/lead/start?switch=1),
 *    lien vers https://erplead.io/account, conseil juste (Pro+ plein : libérer une place, aucune offre ; Gratuit ou
 *    Pro : Pro+ et 5 places, « Voir les formules »), plus de « Réessayer » qui ramène au même refus ; le départ
 *    switch=1 demande prompt=login à ERPlead (route appelée sans réseau).
 * 4. Tarifs publics (/formules) : les mêmes prix que le serveur (server/lib/stripe.ts), aucune offre d'achat.
 * 5. Les parcours avec base (Checkout refusé 409 sans aucun appel au faux Stripe, héritage accepté, « Retirer »
 *    réservé à l'administrateur et gardé à la reconnexion, dernière venue écrite à l'arrivée et à l'activité, refus
 *    avec la formule dans l'adresse) sont dans scripts/smoke.ts (npm test, section « Suites de l'abonnement ») :
 *    vérifié ici qu'ils y sont.
 */
import fs from 'node:fs'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'

process.env.DATABASE_URL ||= 'postgres://suites-check@localhost/aucune-base'
process.env.NO_LISTEN = '1'
process.env.JOBS_DISABLED = '1'
process.env.LEAD_ID_ISSUER = 'https://erplead.suites.test'
process.env.LEAD_ID_CLIENT_ID = 'projectlead'
process.env.LEAD_ID_CLIENT_SECRET = 'secret-suites-check'
process.env.LEAD_ID_REDIRECT_URI = 'https://projectlead.suites.test/auth/lead/callback'

let ok = 0
let ko = 0
const check = (name: string, pass: unknown, detail: unknown = '') => {
  if (pass) { ok++; console.log(`  ok   ${name}`) } else {
    ko++
    console.log(`  NON  ${name}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 500)}`)
  }
}
/** Un bloc de contrôles : une exception (export absent, rendu cassé) le compte rouge au lieu d'arrêter le reste. */
async function block(title: string, fn: () => Promise<void> | void) {
  console.log(title)
  try { await fn() } catch (e) { check(`${title} : exécuté sans erreur`, false, String((e as Error)?.stack ?? e).slice(0, 400)) }
}
const render = (el: ReactElement) => renderToStaticMarkup(createElement(StaticRouter, { location: '/' }, el))
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&nbsp;| | /g, ' ').replace(/\s+/g, ' ').trim()
const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1])
type Tier = 'free' | 'pro' | 'pro_plus'

// ------------------------------------------------------------------ 1. offres
await block('1. Offres : jamais une formule égale ou inférieure à la formule acquise', async () => {
  const { isAbove } = await import('../server/lib/plans.ts')
  const tiers: Tier[] = ['free', 'pro', 'pro_plus']
  const table = tiers.flatMap((acquired) => (['pro', 'pro_plus'] as Tier[]).map((plan) => [acquired, plan, isAbove(plan, acquired)] as const))
  check('règle du serveur : Checkout seulement au-dessus de la formule acquise (Gratuit → Pro, Pro+ ; Pro → Pro+ ; Pro+ → rien)',
    JSON.stringify(table.filter(([, , yes]) => yes).map(([a, p]) => `${a}>${p}`)) === JSON.stringify(['free>pro', 'free>pro_plus', 'pro>pro_plus']), table)

  const { PlanStatus, PlanTiers } = await import('../src/components/PlanCard.tsx')
  const { PRICES } = await import('../server/lib/stripe.ts')
  type B = Parameters<typeof PlanTiers>[0]['b']
  const plan = (o: Partial<B['plan']>): B['plan'] => ({ linked: true, tier: 'free', name: 'Gratuit', upgradeUrl: '/reglages/entreprise', seats: 1,
    source: 'free', paidTier: 'free', inherited: null, lead: null, openProjects: 0, projectLimit: 3, members: 1, invited: 0, ...o })
  const billing = (p: B['plan'], o: Partial<B> = {}): B => ({ configured: true, portal: true, canManage: true, plan: p, hasCustomer: false,
    subscription: null, prices: PRICES, currency: 'EUR', ...o })
  const page = (b: B) => {
    const html = render(createElement('div', null, createElement(PlanStatus, { b }),
      createElement(PlanTiers, { b, annual: false, busy: null, onCheckout: () => {}, onPortal: () => {} })))
    return { html, text: text(html), current: attrs(html, 'data-plan-current'), acquired: attrs(html, 'data-plan-acquired'),
      offers: attrs(html, 'data-plan-offer'), passer: (text(html).match(/Passer à Pro\+?/g) ?? []) }
  }
  const until = '2026-11-15T12:00:00.000Z'
  // TEST 08 en production : Pro+ propre lu au Compte Lead, aucun abonnement ProjectLead.
  const own = page(billing(plan({ tier: 'pro_plus', name: 'Pro+', source: 'own', paidTier: 'pro_plus', seats: 5, projectLimit: null,
    lead: { tier: 'pro_plus', until } })))
  check('Pro+ propre du Compte Lead : data-plan-current="pro_plus", data-plan-acquired="pro_plus" (un seul élément)',
    JSON.stringify(own.current) === '["pro_plus"]' && JSON.stringify(own.acquired) === '["pro_plus"]', { current: own.current, acquired: own.acquired })
  check('Pro+ propre du Compte Lead : aucune offre (ni data-plan-offer, ni « Passer à »)', !own.offers.length && !own.passer.length, own.offers)
  check('Pro+ propre du Compte Lead : origine et date dites (« Pro+ par votre compte ERPlead, jusqu\'au 15.11.2026 », lien vers ERPlead)',
    /Pro\+ par votre compte ERPlead, jusqu'au 15\.11\.2026\. Cette formule se gère dans ERPlead/.test(own.text)
    && own.html.includes('href="https://erplead.io/account"'), own.text.slice(0, 300))
  const ownNoDate = page(billing(plan({ tier: 'pro_plus', name: 'Pro+', source: 'own', paidTier: 'pro_plus', seats: 5, lead: { tier: 'pro_plus', until: null } })))
  check('… sans date de fin : la même ligne, sans date', /Pro\+ par votre compte ERPlead\. Cette formule se gère dans ERPlead/.test(ownNoDate.text), ownNoDate.text.slice(0, 200))
  const pro = page(billing(plan({ tier: 'pro', name: 'Pro', source: 'own', paidTier: 'pro', projectLimit: null, lead: { tier: 'pro', until } })))
  check('Pro propre du Compte Lead : seule l\'offre Pro+ (data-plan-offer="pro_plus")', JSON.stringify(pro.offers) === '["pro_plus"]'
    && JSON.stringify(pro.acquired) === '["pro"]', { offers: pro.offers, passer: pro.passer })
  const fam = page(billing(plan({ tier: 'pro_plus', name: 'Pro+', source: 'family', paidTier: 'free', seats: 5, projectLimit: null,
    inherited: { tier: 'pro_plus', app: 'crmlead', until } })))
  check('héritage Pro+ (source family, jusqu\'au 15.11.2026) : formule acquise Gratuit, offres Pro et Pro+ gardées, pas de ligne « par votre compte ERPlead »',
    JSON.stringify(fam.current) === '["pro_plus"]' && JSON.stringify(fam.acquired) === '["free"]' && JSON.stringify(fam.offers) === '["pro","pro_plus"]'
    && !/par votre compte ERPlead/.test(fam.text) && /grâce à votre abonnement CRMlead/.test(fam.text), { offers: fam.offers, text: fam.text.slice(0, 200) })
  const free = page(billing(plan({})))
  check('Gratuit : offres Pro et Pro+', JSON.stringify(free.offers) === '["pro","pro_plus"]' && JSON.stringify(free.acquired) === '["free"]', free.offers)
  const subscribed = page(billing(plan({ tier: 'pro', name: 'Pro', source: 'own', paidTier: 'pro', projectLimit: null }), { hasCustomer: true,
    subscription: { plan: 'pro', interval: 'month', status: 'active', currentPeriodEnd: until, endsAt: null, active: true, blocking: true } }))
  check('abonnement ProjectLead Pro en cours : aucun achat (changement de formule au portail), aucune ligne « par votre compte ERPlead »',
    !subscribed.offers.length && !subscribed.passer.length && /Changer de formule/.test(subscribed.text) && !/par votre compte ERPlead/.test(subscribed.text), subscribed.offers)
  const member = page(billing(plan({}), { canManage: false }))
  check('vue d\'une membre (Gratuit) : aucune offre d\'achat', !member.offers.length && !member.passer.length, member.offers)
})

// ------------------------------------------------------------------ 2. places
await block('2. Places : liste dans Réglages → Équipe, dernière venue, « Retirer », personnes retirées', async () => {
  const { SeatList } = await import('../src/components/settings/Team.tsx')
  type P = Parameters<typeof SeatList>[0]
  const m = (who: string, o: Partial<P['members'][number]> = {}): P['members'][number] => ({ id: `id-${who}`, name: `Personne ${who}`, color: '#0f6e70',
    email: `${who}@exemple.test`, role: 'member', active: true, lead_disabled: false, last_seen_at: '2026-10-15T06:00:00.000Z', hourly_rate_cents: 0,
    cost_rate_cents: 0, capacity_minutes: 2400, team_ids: [], ...o })
  const members = [m('lt08a', { role: 'admin' }), m('lt08b'), m('lt08c', { role: 'manager', last_seen_at: null }),
    m('lt08x', { active: false }), m('lt08y', { active: false, lead_disabled: true })]
  const invitations: P['invitations'] = [{ id: 'inv-1', email: 'invitee@exemple.test', role: 'member', expires_at: '2026-10-29T06:00:00.000Z', created_at: '2026-10-15T06:00:00.000Z' }]
  const view = (meId: string, isAdmin: boolean, canManage: boolean) => {
    const html = render(createElement(SeatList, { members, invitations, seatsMax: 5, meId, isAdmin, canManage, currency: 'CHF',
      onEdit: () => {}, onRemove: () => {}, onRevoke: () => {}, onRestore: () => {} }))
    const list = /<section[^>]*data-seat-list[^>]*>/.exec(html)?.[0] ?? ''
    const rows = [...html.matchAll(/<tr[^>]*data-seat-holder="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => ({
      email: x[1], lastSeen: /data-last-seen="([^"]*)"/.exec(x[2])?.[1] ?? null, remove: /data-seat-remove(?!d)/.test(x[2]), text: text(x[2]) }))
    const removed = [...html.matchAll(/<li[^>]*data-seat-removed="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((x) => ({ email: x[1], text: text(x[2]) }))
    return { html, list, used: attrs(list, 'data-seats-used')[0], max: attrs(list, 'data-seats-max')[0], rows, removed }
  }
  const admin = view('id-lt08a', true, true)
  check('contrat : [data-seat-list] avec data-seats-used = nombre de lignes (3 personnes actives + 1 invitation en attente) et data-seats-max = 5',
    admin.list && admin.used === String(admin.rows.length) && admin.rows.length === 4 && admin.max === '5', { used: admin.used, max: admin.max, rows: admin.rows.map((r) => r.email) })
  check('une ligne [data-seat-holder] par place : les personnes actives et l\'invitation, jamais une personne retirée',
    JSON.stringify(admin.rows.map((r) => r.email).sort()) === JSON.stringify(['invitee@exemple.test', 'lt08a@exemple.test', 'lt08b@exemple.test', 'lt08c@exemple.test']), admin.rows.map((r) => r.email))
  check('dernière venue dans chaque ligne : date ISO, « never » pour qui n\'est jamais venu et pour une invitation (« Invitation en attente »)',
    admin.rows.find((r) => r.email === 'lt08b@exemple.test')?.lastSeen === '2026-10-15T06:00:00.000Z' && /15\.10\.2026/.test(admin.rows.find((r) => r.email === 'lt08b@exemple.test')?.text ?? '')
    && admin.rows.find((r) => r.email === 'lt08c@exemple.test')?.lastSeen === 'never'
    && admin.rows.find((r) => r.email === 'invitee@exemple.test')?.lastSeen === 'never' && /Invitation en attente/.test(admin.rows.find((r) => r.email === 'invitee@exemple.test')?.text ?? ''),
    admin.rows.map((r) => [r.email, r.lastSeen]))
  check('administratrice : « Retirer » (data-seat-remove) sur chaque ligne sauf la sienne, invitation comprise',
    admin.rows.every((r) => r.remove === (r.email !== 'lt08a@exemple.test')) && admin.rows.filter((r) => r.remove).every((r) => /Retirer/.test(r.text)),
    admin.rows.map((r) => [r.email, r.remove]))
  check('personnes retirées à part ([data-seat-removed]) : « Rétablir » pour une personne retirée par un administrateur ; partie du Compte Lead : expliqué, sans « Rétablir »',
    JSON.stringify(admin.removed.map((r) => r.email)) === JSON.stringify(['lt08x@exemple.test', 'lt08y@exemple.test'])
    && /Rétablir/.test(admin.removed[0]?.text ?? '') && !/Rétablir/.test(admin.removed[1]?.text ?? '') && /Compte Lead/.test(admin.removed[1]?.text ?? ''),
    admin.removed)
  const member = view('id-lt08b', false, false)
  check('vue d\'une membre : la liste, mais aucun « Retirer » ni « Rétablir », ni la dernière venue des autres (réservée à l\'administrateur)',
    member.rows.length === 4 && !/data-seat-remove(?!d)/.test(member.html) && !/>\s*Retirer\s*</.test(member.html) && !/Rétablir/.test(member.html)
    && !/data-last-seen|Dernière venue/.test(member.html), member.rows.map((r) => [r.email, r.remove, r.lastSeen]))
  const manager = view('id-lt08c', false, true)
  check('vue d\'un responsable : aucun « Retirer » (réservé à l\'administrateur) ; l\'invitation se révoque comme avant',
    !/data-seat-remove(?!d)/.test(manager.html) && !/>\s*Retirer\s*</.test(manager.html) && /Révoquer/.test(manager.rows.find((r) => r.email === 'invitee@exemple.test')?.text ?? ''),
    manager.rows.map((r) => [r.email, r.text.slice(-40)]))
  const unlimited = render(createElement(SeatList, { members: members.slice(0, 2), invitations: [], seatsMax: null, meId: 'id-lt08a', isAdmin: true, canManage: true,
    currency: 'CHF', onEdit: () => {}, onRemove: () => {}, onRevoke: () => {}, onRestore: () => {} }))
  check('sans plafond (sans Compte Lead) : data-seats-max vide', /data-seats-max=""/.test(unlimited), /<section[^>]*data-seat-list[^>]*>/.exec(unlimited)?.[0])

  const files = fs.readdirSync(new URL('../db/', import.meta.url)).filter((f) => /last_seen/.test(f))
  const sql = files.map((f) => fs.readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8')).join('\n')
  check('migration de la dernière venue : account_users.last_seen_at ajoutée « if not exists », rien de retiré (rejouable)',
    files.length === 1 && /alter table account_users add column if not exists last_seen_at timestamptz/.test(sql) && !/\bdrop\b/i.test(sql), files)
})

// ------------------------------------------------------------------ 3. refus « places »
await block('3. Refus « places » : formule dans l\'adresse, Changer de compte, Compte ERPlead, conseil selon la formule', async () => {
  const { refusalLocation } = await import('../server/routes/auth.ts')
  check('adresse du refus : la formule de l\'entreprise (free, pro, proplus) et la page demandée',
    refusalLocation('places', { tier: 'pro_plus', next: '/invitation/abc' }) === `/login?erreur=places&formule=proplus&next=${encodeURIComponent('/invitation/abc')}`
    && refusalLocation('places', { tier: 'free' }) === '/login?erreur=places&formule=free' && refusalLocation('places', { tier: 'pro' }) === '/login?erreur=places&formule=pro'
    && refusalLocation('desactive', {}) === '/login?erreur=desactive', refusalLocation('places', { tier: 'pro_plus', next: '/invitation/abc' }))

  const { RefusedScreen } = await import('../src/components/RefusedScreen.tsx')
  const UPGRADE = /^(Voir les formules|Passer à Pro\+?|Choisir Pro\+?|Prendre Pro\+?)/i
  const screen = (formule: 'free' | 'pro' | 'proplus' | null, next: string | null = null, reason: 'places' | 'desactive' = 'places') => {
    const html = render(createElement(RefusedScreen, { reason, formule, next }))
    const links = [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((x) => ({ href: /href="([^"]*)"/.exec(x[1])?.[1]?.replace(/&amp;/g, '&') ?? '',
      switchAttr: /data-switch-account/.test(x[1]), upgradeAttr: /data-upgrade/.test(x[1]), text: text(x[2]) }))
    return { html, text: text(html), links }
  }
  for (const f of ['free', 'pro', 'proplus', null] as const) {
    const s = screen(f)
    const sw = s.links.filter((l) => l.switchAttr || l.text === 'Changer de compte')
    check(`formule ${f ?? 'inconnue'} : « Changer de compte » (data-switch-account) vers /auth/lead/start?switch=1`,
      sw.length === 1 && sw[0].switchAttr && sw[0].text === 'Changer de compte' && sw[0].href === '/auth/lead/start?switch=1', sw)
    check(`formule ${f ?? 'inconnue'} : lien vers le Compte ERPlead (https://erplead.io/account)`, s.links.some((l) => l.href === 'https://erplead.io/account'), s.links)
    check(`formule ${f ?? 'inconnue'} : plus de « Réessayer » ni de « Se connecter » qui relance la même session`,
      !s.links.some((l) => /^(Réessayer|Se connecter)/.test(l.text) || (/\/auth\/lead\/start/.test(l.href) && !/[?&]switch=1/.test(l.href))) && !/Réessayer/.test(s.text), s.links)
    const up = s.links.filter((l) => l.upgradeAttr || UPGRADE.test(l.text))
    if (f === 'proplus') {
      check('Pro+ plein : conseil « libérer une place », aucune offre ni conseil de passer à une formule plus grande',
        /libér/i.test(s.text) && !up.length && !/(passe[rz]?|prendre) (à |une formule )?(Pro\+|avec plus de places)/i.test(s.text), { text: s.text.slice(0, 400), up })
    } else {
      check(`formule ${f ?? 'inconnue'} : nomme Pro+ (5 places) et offre « Voir les formules » (data-upgrade, page publique /formules)`,
        /Pro\+/.test(s.text) && /5 places/.test(s.text) && up.length === 1 && up[0].upgradeAttr && up[0].href === '/formules' && up[0].text === 'Voir les formules',
        { text: s.text.slice(0, 400), up })
      if (f === 'free') check('Gratuit : dit que l\'entreprise est en Gratuit, avec 1 place', /Gratuit/.test(s.text) && /1 place/.test(s.text), s.text.slice(0, 300))
      if (f === 'pro') check('Pro : dit que l\'entreprise est en Pro, avec 1 place', /formule Pro\b(?!\+)/.test(s.text) && /1 place/.test(s.text), s.text.slice(0, 300))
    }
  }
  const deep = screen('proplus', '/invitation/abcdefghijklmnopqrstuvwxyz')
  check('« Changer de compte » garde la page demandée (invitation)', deep.links.some((l) => l.switchAttr
    && l.href === `/auth/lead/start?switch=1&next=${encodeURIComponent('/invitation/abcdefghijklmnopqrstuvwxyz')}`), deep.links)
  const off = screen(null, null, 'desactive')
  check('accès désactivé : même sortie (Changer de compte, Compte ERPlead), sans « Réessayer »',
    off.links.some((l) => l.switchAttr && l.href === '/auth/lead/start?switch=1') && off.links.some((l) => l.href === 'https://erplead.io/account')
    && !/Réessayer/.test(off.text) && /désactivé/.test(off.text), off.links)

  const { default: auth } = await import('../server/routes/auth.ts')
  const go = async (q: string) => {
    const res = await auth.request(`https://projectlead.suites.test/auth/lead/start${q}`)
    return { status: res.status, to: new URL(res.headers.get('location') ?? 'https://x.invalid/') }
  }
  const sw = await go('?switch=1&next=/projets')
  check('départ « Changer de compte » (switch=1) : autorisation ERPlead avec prompt=login (formulaire, jamais la session reprise), page demandée gardée',
    sw.status === 302 && sw.to.origin === 'https://erplead.suites.test' && sw.to.pathname === '/oauth/authorize' && sw.to.searchParams.get('prompt') === 'login'
    && sw.to.searchParams.get('client_id') === 'projectlead' && Buffer.from(String(sw.to.searchParams.get('state')).split('.')[1] ?? '', 'base64url').toString() === '/projets', sw.to.href)
  const plain = await go('')
  check('départ ordinaire : toujours sans prompt (passage silencieux entre applications)', plain.status === 302 && !plain.to.searchParams.has('prompt'), plain.to.href)
  const signup = await go('?signup=1')
  check('départ « Créer un compte » : toujours prompt=create', signup.to.searchParams.get('prompt') === 'create', signup.to.href)
})

// ------------------------------------------------------------------ 4. tarifs publics
await block('4. Tarifs publics (/formules) : page sans session, mêmes prix que le serveur, aucune offre d\'achat', async () => {
  const { PLAN_PRICES } = await import('../src/lib/plans.ts')
  const { PRICES } = await import('../server/lib/stripe.ts')
  check('prix de la page publique = prix du serveur (server/lib/stripe.ts)', JSON.stringify(PLAN_PRICES) === JSON.stringify(PRICES), { PLAN_PRICES, PRICES })
  const { default: Plans } = await import('../src/pages/Plans.tsx')
  const html = render(createElement(Plans))
  const t = text(html)
  check('/formules : Gratuit (1 personne), Pro (19 € / mois, 1 personne) et Pro+ (39 € / mois, jusqu\'à 5 personnes), sans bouton d\'achat',
    /Gratuit/.test(t) && /Pro\+/.test(t) && /19\s?€/.test(t) && /39\s?€/.test(t) && /Jusqu'à 5 personnes/.test(t) && !/data-plan-offer/.test(html) && !/Passer à/.test(t), t.slice(0, 400))
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  check('/formules est une page publique (ouverte avec ou sans session)', /path: '\/formules'/.test(app) && /formules/.test(/const isPublic = (.*)/.exec(app)?.[1] ?? ''), '')
})

// ------------------------------------------------------------------ 5. parcours avec base
await block('5. Parcours avec base : présents dans scripts/smoke.ts (npm test)', () => {
  const smoke = fs.readFileSync(new URL('./smoke.ts', import.meta.url), 'utf8')
  const need: [string, RegExp][] = [
    ['Checkout refusé 409 plan_not_above, zéro appel au faux Stripe', /plan_not_above[\s\S]{0,600}calls\.length === /],
    ['héritage (source family) accepté', /source: 'family'[\s\S]{0,1500}héritage/],
    ['« Retirer » : 403 pour une membre et un responsable, 400 sur soi, retrait gardé à la reconnexion', /\/remove`[\s\S]{0,300}403[\s\S]*cannot_remove_self[\s\S]*retrait gardé/],
    ['dernière venue écrite à l\'arrivée et à l\'activité (au plus une fois par heure)', /last_seen_at[\s\S]*arrivée[\s\S]*une fois par heure/],
  ]
  for (const [name, re] of need) check(name, re.test(smoke))
  check('refus avec la formule dans l\'adresse (free, pro, proplus)', ['free', 'pro', 'proplus'].every((f) => smoke.includes(`erreur=places&formule=${f}'`)
    || smoke.includes(`erreur=places&formule=${f}&next=`)))
})

console.log(`\n${ok} contrôles verts, ${ko} rouges`)
console.log(ko ? 'PROJECTLEAD_SUITES_UNIT_KO' : 'PROJECTLEAD_SUITES_UNIT_OK')
process.exit(ko ? 1 : 0)
