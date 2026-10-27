import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { intlLocale, useT } from '../i18n'
import { api, errorText } from '../lib/api'
import { leadEntry } from '../lib/leadFamily'
import { isNativeApp } from '../lib/native'
import { useApp } from '../lib/store'
import { euros, PLAN_FEATURES as FEATURES, PLAN_NAME as NAME, PLAN_RANK as RANK } from '../lib/plans'
import type { Billing, Plan } from '../lib/types'
import { Button, Card, Spinner } from './ui'

const day = (d: string) => new Date(d).toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
const appName = (code: string | null) => ({ crmlead: 'CRMlead', scanlead: 'ScanLead', invoicelead: 'InvoiceLead', greetlead: 'Greetlead' } as Record<string, string>)[code ?? ''] ?? code ?? 'Lead'

/**
 * La carte Formule (Réglages → Entreprise) : ProjectLead encaisse lui-même son abonnement, valable dans ProjectLead
 * seulement (Ève, 13.10.2026). Tout le monde y lit la formule et ce qu'il en utilise ; seul l'administrateur paie
 * (Stripe Checkout), change de formule ou résilie (portail Stripe propre à ProjectLead). Sans Compte Lead, pas de
 * formule : rien n'est affiché. Sans configuration Stripe, les boutons de paiement sont masqués.
 */
export function PlanCard() {
  const { me, refresh } = useApp()
  const t = useT()
  const [b, setB] = useState<Billing | null>(null)
  const [annual, setAnnual] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Le retour de Stripe Checkout : `?paiement=ok` ou `?paiement=annule`, lu une fois puis effacé de l'adresse.
  const [back] = useState(() => new URLSearchParams(window.location.search).get('paiement'))
  const load = useCallback(() => api.get<Billing>('/billing').then((x) => { setB(x); return x }), [])
  // L'écran s'ouvre sur la période de l'abonnement en cours (mensuel ou annuel).
  const [intervalSet, setIntervalSet] = useState(false)
  useEffect(() => {
    if (!intervalSet && b?.subscription?.active && b.subscription.interval) { setAnnual(b.subscription.interval === 'year'); setIntervalSet(true) }
  }, [b, intervalSet])

  useEffect(() => {
    if (me && !me.plan.linked) return   // sans Compte Lead, pas de formule : rien à lire
    load().catch((e) => setError(errorText(e)))
    if (back) { try { window.history.replaceState(null, '', window.location.pathname) } catch { /* rien */ } }
    if (back !== 'ok') return
    // Après un paiement, le webhook arrive en quelques secondes : on relit jusqu'à voir la formule payée.
    let n = 0
    const id = window.setInterval(async () => {
      n++
      const x = await load().catch(() => null)
      if ((x && x.plan.paidTier !== 'free') || n >= 15) { window.clearInterval(id); refresh() }
    }, 2000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!me?.plan.linked) return null
  if (!b) return <Card title={t('shell.plan.card.title')}>{error ? <p className="p-4 text-sm text-late">{error}</p> : <Spinner />}</Card>

  const plan = b.plan
  const sub = b.subscription
  const seats = plan.seats === null ? t('shell.plan.unlimited') : t('shell.plan.persons', { n: plan.seats })
  const usage = (
    <ul className="space-y-1">
      <li>{t('shell.plan.usage.projects')} <span className="font-semibold tabular-nums">{plan.openProjects}</span>
        {plan.projectLimit !== null ? <> {t('shell.plan.usage.of', { n: plan.projectLimit })}</>
          : <span className="text-muted-foreground"> {t('shell.plan.usage.unlimited')}</span>}</li>
      <li>{t('shell.plan.usage.people')} <span className="font-semibold tabular-nums">{plan.members + plan.invited}</span> {t('shell.plan.usage.of', { n: seats })}
        {plan.invited > 0 && <span className="text-muted-foreground"> {t('shell.plan.usage.pending', { n: plan.invited })}</span>}</li>
    </ul>
  )
  // Dans l'app mobile : la formule et ce qu'on en utilise, rien à acheter (src/lib/native.ts).
  if (isNativeApp) {
    return (
      <Card title={t('shell.plan.card.titleFull')}>
        <div className="space-y-4 p-4 text-sm" data-plan-app="">
          <PlanStatus b={b} />
          {usage}
        </div>
      </Card>
    )
  }

  async function go(path: string, body?: unknown) {
    setError(null); setBusy(path)
    try {
      const r = await api.post<{ url: string }>(path, body)
      window.location.assign(r.url)
    } catch (e) {
      setBusy(null)
      setError(errorText(e))
    }
  }
  const checkout = (p: 'pro' | 'pro_plus') => go('/billing/checkout', { plan: p, interval: annual ? 'year' : 'month' })
  const portal = () => go('/billing/portal')

  const toggle = (on: boolean, label: ReactNode) => (
    <button type="button" aria-pressed={annual === on} onClick={() => { setIntervalSet(true); setAnnual(on) }}
      className={clsx('flex items-center gap-2 px-3 py-1.5 text-[13px] font-bold',
        annual === on ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}>{label}</button>
  )

  return (
    <Card title={t('shell.plan.card.titleFull')}>
      <div className="space-y-4 p-4 text-sm">
        {back === 'ok' && (
          <p role="status" className="border border-l-[3px] border-won/40 border-l-won bg-won/5 px-3 py-2">
            {plan.paidTier === 'free' ? t('shell.plan.paid.pending') : t('shell.plan.paid.active', { plan: NAME[plan.paidTier] })}</p>
        )}
        {back === 'annule' && (
          <p role="status" className="border border-l-[3px] border-border bg-card px-3 py-2">
            {t('shell.plan.cancelled')}</p>
        )}

        <div className="flex flex-wrap items-start justify-between gap-2">
          <PlanStatus b={b} />
          {b.portal && b.canManage && b.hasCustomer && (
            <Button onClick={portal} disabled={!!busy}>{busy === '/billing/portal' ? t('shell.plan.opening') : t('shell.plan.manage')}</Button>
          )}
        </div>
        {sub && ['past_due', 'unpaid'].includes(sub.status) && (
          <p className="border border-l-[3px] border-soon/40 border-l-soon bg-soon/5 px-3 py-2 text-xs">
            {t('shell.plan.pastDue')}</p>
        )}

        {usage}

        {!b.configured && (
          <p role="status" className="border border-l-[3px] border-border bg-card px-3 py-2 text-xs">
            {t('shell.plan.notConfigured')}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label={t('shell.plan.period')} className="inline-flex border border-input">
            {toggle(false, t('shell.plan.monthly'))}
            {toggle(true, <>{t('shell.plan.annual')} <span className={clsx('px-1.5 py-0.5 text-[11px] font-extrabold', annual ? 'bg-white/20' : 'bg-accent-veil text-accent-dark')}>{t('shell.plan.twoMonthsFree')}</span></>)}
          </div>
          {!b.canManage && <p className="text-xs text-muted-foreground">{t('shell.plan.adminOnly')}</p>}
        </div>
        <PlanTiers b={b} annual={annual} busy={busy} onCheckout={checkout} onPortal={portal} />
        {error && <p className="text-late">{error}</p>}

        <p className="text-xs text-muted-foreground">{t('shell.plan.note')}</p>
        <p className="text-xs text-muted-foreground">{t('shell.plan.terms')}</p>
      </div>
    </Card>
  )
}

/**
 * « Votre formule » : la formule appliquée et ce qui la donne (abonnement ProjectLead, héritage jusqu'à une date, ou
 * formule propre lue au Compte Lead, qui se gère dans ERPlead). Contrat de page des suites de l'abonnement (15.10.2026,
 * § 1.1.4) : `data-plan-current` (formule appliquée) et `data-plan-acquired` (formule acquise : la seule au-dessus de
 * laquelle une formule se vend ; jamais l'héritage).
 */
export function PlanStatus({ b }: { b: Billing }) {
  const t = useT()
  const plan = b.plan
  const sub = b.subscription
  const subscribed = Boolean(sub?.active)
  return (
    <div className="space-y-1">
      <p data-plan-current={plan.tier} data-plan-acquired={plan.paidTier}>{t('shell.plan.status.yours')} <span className="font-bold">{plan.name}</span>
        {plan.tier === 'free' && <span className="text-muted-foreground">{t('shell.plan.status.freeLine')}</span>}</p>
      {sub && subscribed && (
        <p className="text-muted-foreground">{t('shell.plan.status.sub', { plan: NAME[sub.plan] })}
          {sub.interval === 'year' ? t('shell.plan.status.subYear') : sub.interval === 'month' ? t('shell.plan.status.subMonth') : ''}
          {sub.endsAt ? <>{t('shell.plan.status.ends', { date: day(sub.endsAt) })}</>
            : sub.currentPeriodEnd ? <>{t('shell.plan.status.renews', { date: day(sub.currentPeriodEnd) })}</> : null}</p>
      )}
      {plan.lead && (
        <p className="text-muted-foreground">
          {plan.lead.until ? t('shell.plan.status.leadUntil', { plan: NAME[plan.lead.tier], date: day(plan.lead.until) })
            : t('shell.plan.status.lead', { plan: NAME[plan.lead.tier] })}{' '}
          <a href={leadEntry('erplead')} className="font-semibold text-accent-dark hover:underline">{t('shell.plan.status.openErp')}</a></p>
      )}
      {plan.inherited && (
        <p className="text-muted-foreground">
          {plan.inherited.until
            ? t('shell.plan.status.inheritedUntil', { plan: NAME[plan.inherited.tier], date: day(plan.inherited.until), app: appName(plan.inherited.app) })
            : t('shell.plan.status.inherited', { plan: NAME[plan.inherited.tier], app: appName(plan.inherited.app) })}
          {isNativeApp ? '' : t('shell.plan.status.inheritedHere')}.</p>
      )}
    </div>
  )
}

/**
 * Les trois formules et ce que l'administrateur peut en faire : « Formule actuelle », « Passer à … » seulement au-dessus
 * de la formule acquise (`paidTier`, comme le refus du serveur, 409 `plan_not_above`), « Changer de formule » au portail
 * pour un abonné. Chaque bouton d'achat porte `data-plan-offer` (contrat de page des suites de l'abonnement).
 */
export function PlanTiers({ b, annual, busy, onCheckout, onPortal }:
  { b: Billing; annual: boolean; busy: string | null; onCheckout: (p: 'pro' | 'pro_plus') => void; onPortal: () => void }) {
  const sub = b.subscription
  const subscribed = Boolean(sub?.active)
  // Un abonnement en cours ou impayé se règle ou se change au portail, jamais par un second abonnement.
  const locked = Boolean(sub?.blocking)
  const t = useT()
  const current = b.plan.paidTier
  const card = (p: Plan['tier']) => {
    // « Formule actuelle » seulement sur la période prise : l'autre période se change au portail.
    const here = p === current && (p === 'free' || !subscribed || !sub?.interval || sub.interval === (annual ? 'year' : 'month'))
    const price = p === 'free' ? 0 : b.prices[p][annual ? 'year' : 'month']
    let action: ReactNode = null
    if (here) {
      action = <p className="border border-accent px-3 py-2 text-center text-[13px] font-bold text-accent-dark">{t('shell.plan.current')}</p>
    } else if (b.configured && b.canManage && p !== 'free') {
      action = locked
        // Déjà abonné : on change de formule dans le portail, jamais par un second abonnement.
        ? (b.portal ? <Button className="w-full" onClick={onPortal} disabled={!!busy}>{t('shell.plan.change')}</Button> : null)
        : RANK[p] > RANK[current]
          ? <Button variant="primary" className="w-full" data-plan-offer={p} onClick={() => onCheckout(p)} disabled={!!busy}>
              {busy === '/billing/checkout' ? t('shell.plan.openingCheckout') : p === 'pro' ? t('shell.plan.upgradePro') : t('shell.plan.upgradeProPlus')}</Button>
          : null
    }
    return (
      <article key={p} className={clsx('flex flex-col bg-card p-4', here ? 'border-2 border-accent' : 'border border-input')}>
        <h3 className="text-base font-extrabold">{NAME[p]}</h3>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-2xl font-extrabold leading-none tracking-[-.02em]">{euros(price)}</span>
          <span className="text-xs text-muted-foreground">{p === 'free' ? t('shell.plan.noTimeLimit') : annual ? t('shell.plan.perYear') : t('shell.plan.perMonth')}</span>
        </p>
        <p className="mt-1 h-4 text-xs text-muted-foreground">
          {p !== 'free' && annual ? t('shell.plan.monthlyEquivalent', { price: euros(Math.round((price / 12) * 100) / 100) }) : ''}</p>
        <ul className="mt-3 flex-1 space-y-1.5 text-sm">
          {FEATURES[p].map((f) => <li key={f} className="flex gap-2"><span aria-hidden className="text-accent">—</span>{f}</li>)}
        </ul>
        <div className="mt-4 min-h-[36px]">{action}</div>
      </article>
    )
  }
  return <div className="grid gap-3 md:grid-cols-3">{card('free')}{card('pro')}{card('pro_plus')}</div>
}

/** Le lien « Passer à Pro » : vers la page Formule pour un administrateur, une indication pour les autres. */
export function UpgradeLink({ plan, children }: { plan: Plan; children: ReactNode }) {
  const { me } = useApp()
  const t = useT()
  // Dans l'app mobile, aucune invitation à changer de formule (règle 3.1.1 d'Apple).
  if (isNativeApp) return null
  if (me?.user.role !== 'admin') return <span className="text-muted-foreground">{t('shell.plan.adminCanChange')}</span>
  return <Link to={plan.upgradeUrl} className="font-semibold text-accent-dark hover:underline">{children}</Link>
}

/** Une ligne sous le titre des projets, en formule gratuite seulement. */
export function PlanLine({ plan }: { plan: Plan }) {
  const t = useT()
  if (!plan.linked || plan.projectLimit === null) return null
  const full = plan.openProjects >= plan.projectLimit
  return (
    <p className={full ? 'text-sm text-late' : 'text-sm text-muted-foreground'}>
      {t('shell.plan.freeLine', { n: plan.openProjects, limit: plan.projectLimit })}{' '}
      <UpgradeLink plan={plan}>{t('shell.plan.upgradePro')}</UpgradeLink>
    </p>
  )
}
