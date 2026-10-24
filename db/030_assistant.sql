-- Assistant IA (bulle, 24.10.2026, cahier commun des applications Lead).
--
-- Rien de la conversation n'est gardé en base : seulement qui, quand, combien de jetons, quels outils, quelle erreur.
-- `assistant_usage` sert aussi au quota : 40 messages par heure et par personne, 400 par jour et par entreprise
-- (server/lib/assistant/quota.ts). Une ligne `kind = 'message'` est réservée AVANT l'appel au modèle, puis complétée.
-- `assistant_confirmations` : un jeton « Confirmer » ne sert qu'une fois (son numéro unique y est noté à l'usage).
--
-- Noms distincts des lots IA de la fusion (claude/suite-0210 : `ai_usage`, migrations 008 à 015 de cette branche) :
-- les deux peuvent cohabiter. Rejouable.

create table if not exists assistant_usage (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id) on delete cascade,
  user_id            uuid references users(id) on delete set null,
  kind               text not null default 'message' check (kind in ('message', 'confirm')),
  created_at         timestamptz not null default now(),
  ok                 boolean,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  tools              text[] not null default '{}',
  error              text,
  duration_ms        integer
);
create index if not exists assistant_usage_account_time on assistant_usage (account_id, created_at desc);
create index if not exists assistant_usage_user_time on assistant_usage (user_id, created_at desc);

create table if not exists assistant_confirmations (
  nonce      text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  user_id    uuid references users(id) on delete set null,
  used_at    timestamptz not null default now()
);

-- Les droits sont aussi reposés par 002_rls.sql à chaque passage (bloc conditionnel) ; posés ici pour le premier.
alter table assistant_usage enable row level security;
drop policy if exists tenant on assistant_usage;
create policy tenant on assistant_usage using (account_id = app_account()) with check (account_id = app_account());
revoke all on assistant_usage from projectlead_app;
grant select, insert, update on assistant_usage to projectlead_app;

alter table assistant_confirmations enable row level security;
drop policy if exists tenant on assistant_confirmations;
create policy tenant on assistant_confirmations using (account_id = app_account()) with check (account_id = app_account());
revoke all on assistant_confirmations from projectlead_app;
grant select, insert on assistant_confirmations to projectlead_app;
