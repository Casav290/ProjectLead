-- ProjectLead, isolation des entreprises par la RLS.
--
-- Le contexte est posé par transaction (server/db.ts, `withTenant`) :
--   app.account_id, app.user_id, app.role
-- Toute table métier n'est lisible et modifiable que pour son compte. Les projets « réservés
-- aux intervenants » ne se voient que de leurs membres, des administrateurs et des responsables.

create or replace function app_account() returns uuid
language sql stable as $$ select nullif(current_setting('app.account_id', true), '')::uuid $$;

create or replace function app_user() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app_role() returns text
language sql stable as $$ select coalesce(nullif(current_setting('app.role', true), ''), 'member') $$;

-- Membre d'un projet ? Fonction `security definer` : la politique de `projects` ne doit pas
-- relire `project_members` sous sa propre politique (récursion).
create or replace function app_is_project_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members m where m.project_id = p and m.user_id = app_user())
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'account_users','invitations','teams','team_members','clients','client_contacts',
    'project_members','board_columns','stages','tasks','task_assignees','task_dependencies',
    'checklist_items','comments','activities','attachments','time_entries','project_updates',
    'client_reports','notifications','mailboxes','email_messages','events','event_attendees',
    'calendar_feeds','external_events','booking_types','bookings','account_settings',
    'invoice_runs','exchange_links','automations','intake_forms','api_keys'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant on %I', t);
    execute format('create policy tenant on %I using (account_id = app_account()) with check (account_id = app_account())', t);
    execute format('grant select, insert, update, delete on %I to projectlead_app', t);
  end loop;
end $$;

-- Projets : le compte, et la visibilité choisie.
alter table projects enable row level security;
drop policy if exists tenant on projects;
create policy tenant on projects
  using (account_id = app_account() and (
    visibility = 'account' or app_role() in ('admin','manager')
    or owner_id = app_user() or app_is_project_member(id)))
  with check (account_id = app_account());
grant select, insert, update, delete on projects to projectlead_app;

-- L'entreprise elle-même : lisible, le nom et les réglages modifiables par l'application.
alter table accounts enable row level security;
drop policy if exists tenant on accounts;
create policy tenant on accounts using (id = app_account()) with check (id = app_account());
grant select, update (name, locale, timezone, currency, week_hours) on accounts to projectlead_app;

-- Les personnes : seulement celles de son entreprise. Jamais l'empreinte du mot de passe.
alter table users enable row level security;
drop policy if exists tenant on users;
create policy tenant on users
  using (exists (select 1 from account_users au where au.user_id = users.id and au.account_id = app_account()))
  with check (id = app_user());
revoke all on users from projectlead_app;
grant select (id, email, name, locale, color, lead_sub, created_at) on users to projectlead_app;
grant update (name, locale, color) on users to projectlead_app;

-- Journal des envois : l'application écrit, l'entreprise relit le sien.
alter table sent_emails enable row level security;
drop policy if exists tenant on sent_emails;
create policy tenant on sent_emails using (account_id = app_account()) with check (account_id = app_account());
grant select, insert on sent_emails to projectlead_app;

grant usage, select on all sequences in schema public to projectlead_app;
