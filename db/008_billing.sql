-- ProjectLead encaisse lui-même son abonnement (décision d'Ève du 13.10.2026) : chaque application Lead vend
-- sa propre formule, valable chez elle seule ; ailleurs, la version gratuite. Paiement par Stripe Checkout et
-- portail client, sur le modèle de CRMlead (crmlead-vercel/db/089_stripe_billing.sql). Le compte Stripe est
-- partagé par toutes les applications Lead : ProjectLead ne touche qu'à ses propres objets (metadata.app =
-- 'projectlead'), voir server/lib/stripe.ts.
--
-- La formule d'une entreprise (server/lib/plans.ts) est la meilleure de deux sources :
-- - celle qu'ERPlead calcule POUR ProjectLead (abonnement ProjectLead déclaré, ou héritage d'un abonnement payé
--   ailleurs avant la bascule, jusqu'à une date figée), recopiée dans accounts.plan ;
-- - l'abonnement ProjectLead tenu ici (billing_subscriptions), effectif dès le webhook, même si ERPlead tarde.
--
-- Rejouable. Rien n'est retiré.

-- ------------------------------------------------------------ une entreprise naît en Gratuit

-- 001 posait 'pro' par défaut et la création d'une entreprise faisait coalesce(…, 'pro') : les entreprises
-- jamais liées à une organisation Lead (comptes de contrôle « Contrôle … » et « x » du 01.10) étaient en Pro
-- sans aucun paiement. Elles passent en Gratuit ; aucune n'a d'abonnement ProjectLead (la table naît ici).
alter table accounts alter column plan set default 'free';
update accounts set plan = 'free', plan_seats = null where lead_org is null and plan <> 'free';

-- ------------------------------------------------------------ ce qu'ERPlead dit de la formule ProjectLead

-- Recopié à chaque connexion et relecture (savePlan) : d'où vient la formule et jusqu'à quand elle vaut.
-- `plan_valid_until` passé, la formule d'ERPlead ne compte plus, même avant la relecture suivante (fin exacte
-- d'un héritage, par exemple le 25.10.2026 à 11:40 UTC pour l'abonné CRMlead actuel).
alter table accounts add column if not exists plan_source text;            -- own | family | free (ERPlead)
alter table accounts add column if not exists plan_valid_until timestamptz;
alter table accounts add column if not exists plan_family_app text;        -- l'application de l'abonnement hérité

-- ------------------------------------------------------------ le client Stripe de l'entreprise

-- Un client Stripe propre à ProjectLead (metadata app = projectlead) : jamais retrouvé par e-mail ni partagé
-- avec une autre application, sans quoi le portail ouvert ici montrerait (et laisserait résilier) leurs abonnements.
alter table accounts add column if not exists stripe_customer_id text unique;

-- ------------------------------------------------------------ les abonnements ProjectLead

create table if not exists billing_subscriptions (
  stripe_subscription_id text primary key check (stripe_subscription_id like 'sub\_%'),
  -- Pas de cascade : une entreprise qui a un abonnement ne s'efface pas sans qu'on l'ait d'abord résilié
  -- (server/lib/stripe.ts, cancelAccountSubscriptions).
  account_id           uuid not null references accounts(id) on delete restrict,
  stripe_customer_id   text,
  plan                 text not null check (plan in ('pro', 'pro_plus')),
  interval             text check (interval in ('month', 'year')),
  status               text not null,                -- tel que Stripe le dit (active, trialing, past_due, canceled…)
  current_period_end   timestamptz,
  -- Fin annoncée : résiliation en fin de période (cancel_at_period_end) ou à une date (cancel_at, que le portail pose
  -- depuis les versions d'API 2025-2026, avec cancel_at_period_end resté faux : constaté le 13.10.2026).
  cancel_at_period_end boolean not null default false,
  cancel_at            timestamptz,
  -- Le moment où cet état a été lu chez Stripe : un état plus ancien, traité après coup, n'écrase pas un plus récent.
  stripe_state_at      timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Déclaré à ERPlead (POST /api/lead-id/v1/subscriptions) ? Nul : à déclarer (tâche billing_sync, 10 min).
  erplead_synced_at    timestamptz
);
create index if not exists billing_subscriptions_account on billing_subscriptions (account_id);
create index if not exists billing_subscriptions_unsynced on billing_subscriptions (updated_at) where erplead_synced_at is null;

-- L'application lit l'abonnement de son entreprise (page Formule) ; seul le webhook (rôle propriétaire) écrit.
alter table billing_subscriptions enable row level security;
drop policy if exists tenant on billing_subscriptions;
create policy tenant on billing_subscriptions using (account_id = app_account());
revoke all on billing_subscriptions from projectlead_app;
grant select on billing_subscriptions to projectlead_app;

-- ------------------------------------------------------------ les événements Stripe déjà traités

-- Stripe livre « au moins une fois » : un événement est inscrit dans la même transaction que son effet ; rejoué,
-- il est reconnu et ignoré. Seuls les événements de ProjectLead y entrent : ceux des autres applications du
-- compte partagé reçoivent 200 sans aucune écriture. Personne d'autre que le webhook n'y accède.
create table if not exists stripe_events (
  id          text primary key,
  type        text not null,
  result      text,
  account_id  uuid references accounts(id) on delete set null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
revoke all on stripe_events from projectlead_app;

-- ------------------------------------------------------------ l'usage de la formule (005), avec l'abonnement local

-- `own_plan` : le meilleur abonnement ProjectLead qui ouvre la formule (actif, en essai ou en retard de paiement),
-- avec les mêmes 3 jours de grâce qu'ERPlead après la fin de période.
drop function if exists app_plan_usage(uuid);
create function app_plan_usage(p_account uuid)
returns table (plan text, plan_seats int, plan_source text, plan_valid_until timestamptz, plan_family_app text,
               lead_org text, own_plan text, open_projects int, members int, invited int)
language sql stable security definer set search_path = public as $$
  select a.plan, a.plan_seats, a.plan_source, a.plan_valid_until, a.plan_family_app, a.lead_org,
         (select s.plan from billing_subscriptions s
           where s.account_id = a.id and s.status in ('active', 'trialing', 'past_due')
             and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')
           order by (s.plan = 'pro_plus') desc limit 1),
         (select count(*)::int from projects p where p.account_id = a.id and not p.is_template and p.archived_at is null
             and p.status in ('planned', 'active', 'on_hold')),
         (select count(*)::int from account_users au where au.account_id = a.id and au.active),
         (select count(*)::int from invitations i where i.account_id = a.id and i.accepted_at is null and i.expires_at > now())
    from accounts a
   where a.id = p_account and (app_account() is null or app_account() = p_account)
$$;
revoke all on function app_plan_usage(uuid) from public;
grant execute on function app_plan_usage(uuid) to projectlead_app;
