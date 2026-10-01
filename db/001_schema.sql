-- ProjectLead, schéma de départ.
--
-- Une entreprise (`accounts`) porte tout. Chaque table métier a son `account_id` et la RLS
-- (002) l'impose : une requête qui oublierait son filtre ne voit quand même que son compte.
-- Montants en centimes entiers, durées en minutes entières, comme dans CRMlead et InvoiceLead.

-- ------------------------------------------------------------------ comptes et personnes

create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 200),
  lead_org      text unique,                          -- organisation du Compte Lead
  plan          text not null default 'pro',
  locale        text not null default 'fr',
  timezone      text not null default 'Europe/Zurich',
  currency      text not null default 'CHF',
  -- Adresse de capture : un email transféré à <jeton>@… (ou posté sur /api/inbound/<jeton>)
  -- arrive dans la boîte de réception des projets.
  inbound_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  week_hours    numeric(4,1) not null default 40,
  created_at    timestamptz not null default now()
);

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null default '',
  password_hash text,
  lead_sub      text unique,                          -- personne du Compte Lead
  locale        text not null default 'fr',
  color         text not null default '#0f6e70',
  created_at    timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists account_users (
  account_id    uuid not null references accounts(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  role          text not null default 'member' check (role in ('admin','manager','member')),
  active        boolean not null default true,
  -- Taux de vente par défaut (facturation) et coût interne (rentabilité), en centimes de l'heure.
  hourly_rate_cents integer not null default 0 check (hourly_rate_cents >= 0),
  cost_rate_cents   integer not null default 0 check (cost_rate_cents >= 0),
  capacity_minutes  integer not null default 2400 check (capacity_minutes between 0 and 10080),
  -- Flux iCalendar personnel : l'agenda ProjectLead dans Google, Outlook ou Apple.
  ical_token    text not null unique default encode(gen_random_bytes(18), 'hex'),
  joined_at     timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table if not exists sessions (
  token_hash    text primary key,
  user_id       uuid not null references users(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  user_agent    text
);

create table if not exists invitations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  email         text not null,
  role          text not null default 'member' check (role in ('admin','manager','member')),
  token_hash    text not null unique,
  invited_by    uuid references users(id) on delete set null,
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists teams (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  name          text not null check (length(name) between 1 and 100),
  color         text not null default '#0f6e70',
  created_at    timestamptz not null default now()
);

create table if not exists team_members (
  team_id       uuid not null references teams(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  primary key (team_id, user_id)
);

-- ------------------------------------------------------------------ clients

create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  kind          text not null default 'company' check (kind in ('company','person')),
  name          text not null check (length(name) between 1 and 200),
  contact_person text,
  email         text,
  phone         text,
  street        text,
  building_number text,
  postal_code   text,
  town          text,
  country       text not null default 'CH',
  language      text not null default 'fr',
  vat_number    text,
  notes         text,
  -- `crmlead:<id du lead ou du contact>` quand l'adresse vient de CRMlead.
  external_ref  text,
  -- Le contact correspondant dans InvoiceLead, retenu au premier envoi de facture.
  invoicelead_contact_id text,
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create unique index if not exists clients_external_ref on clients (account_id, external_ref) where external_ref is not null;

create table if not exists client_contacts (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null default '',
  email         text,
  phone         text,
  job_title     text,
  -- Reçoit le suivi de projet envoyé au client.
  receives_updates boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------ projets

create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  code          text,
  name          text not null check (length(name) between 1 and 200),
  description   text not null default '',
  client_id     uuid references clients(id) on delete set null,
  owner_id      uuid references users(id) on delete set null,
  team_id       uuid references teams(id) on delete set null,
  status        text not null default 'active'
                check (status in ('lead','planned','active','on_hold','done','cancelled')),
  health        text not null default 'on_track' check (health in ('on_track','at_risk','off_track')),
  priority      text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  visibility    text not null default 'account' check (visibility in ('account','members')),
  color         text not null default '#0f6e70',
  start_date    date,
  due_date      date,
  budget_minutes integer check (budget_minutes >= 0),
  budget_cents  bigint check (budget_cents >= 0),
  -- Facturation : à l'heure (temps passé du mois), forfait mensuel, forfait global,
  -- par étape (jalon livré), ou non facturable.
  billing_mode  text not null default 'hourly'
                check (billing_mode in ('none','hourly','retainer','fixed','milestone')),
  hourly_rate_cents integer check (hourly_rate_cents >= 0),
  retainer_cents bigint check (retainer_cents >= 0),
  fixed_cents   bigint check (fixed_cents >= 0),
  currency      text not null default 'CHF',
  vat_code      text not null default 'normal',
  is_template   boolean not null default false,
  source        text not null default 'manual'
                check (source in ('manual','email','crmlead','booking','form','template','api')),
  source_ref    text,
  -- Suivi client : page publique en lecture, et envoi par email de l'état des étapes.
  portal_token  text not null unique default encode(gen_random_bytes(18), 'hex'),
  portal_enabled boolean not null default false,
  portal_show_tasks boolean not null default false,
  portal_show_time  boolean not null default false,
  update_frequency text not null default 'none' check (update_frequency in ('none','weekly','biweekly','monthly')),
  last_update_sent_at timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  archived_at   timestamptz
);
create index if not exists projects_account on projects (account_id, status);
create unique index if not exists projects_source on projects (account_id, source, source_ref) where source_ref is not null;

-- Les intervenants d'un projet, et leur rôle sur ce projet.
create table if not exists project_members (
  project_id    uuid not null references projects(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  role          text not null default 'member' check (role in ('lead','member','observer')),
  hourly_rate_cents integer check (hourly_rate_cents >= 0),
  added_at      timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Colonnes du tableau (kanban), propres à chaque projet.
create table if not exists board_columns (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null check (length(name) between 1 and 60),
  position      integer not null default 0,
  is_done       boolean not null default false,
  wip_limit     integer check (wip_limit > 0)
);

-- Étapes (phases, jalons) : ce que voit le client dans son suivi.
create table if not exists stages (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null check (length(name) between 1 and 200),
  description   text not null default '',
  client_note   text not null default '',
  position      integer not null default 0,
  status        text not null default 'todo' check (status in ('todo','in_progress','done','blocked')),
  start_date    date,
  due_date      date,
  visible_to_client boolean not null default true,
  -- Facturation par étape : montant facturé quand l'étape est terminée.
  billing_cents bigint check (billing_cents >= 0),
  invoiced_at   timestamptz,
  invoice_ref   text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  stage_id      uuid references stages(id) on delete set null,
  column_id     uuid references board_columns(id) on delete set null,
  parent_id     uuid references tasks(id) on delete cascade,
  number        integer not null default 0,
  title         text not null check (length(title) between 1 and 500),
  description   text not null default '',
  priority      text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  start_date    date,
  due_date      date,
  estimate_minutes integer check (estimate_minutes >= 0),
  position      double precision not null default 0,
  is_milestone  boolean not null default false,
  visible_to_client boolean not null default false,
  recurrence    text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  tags          text[] not null default '{}',
  custom        jsonb not null default '{}',
  source_email_id uuid,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  constraint tasks_dates check (start_date is null or due_date is null or start_date <= due_date)
);
create index if not exists tasks_project on tasks (project_id, position);
create index if not exists tasks_due on tasks (account_id, due_date) where completed_at is null;

create table if not exists task_assignees (
  task_id       uuid not null references tasks(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  primary key (task_id, user_id)
);

-- Dépendances « fin → début » : la tâche attend que `depends_on_id` soit terminée.
create table if not exists task_dependencies (
  task_id       uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

create table if not exists checklist_items (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  task_id       uuid not null references tasks(id) on delete cascade,
  label         text not null check (length(label) between 1 and 300),
  done          boolean not null default false,
  position      integer not null default 0
);

create table if not exists comments (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  task_id       uuid references tasks(id) on delete cascade,
  author_id     uuid references users(id) on delete set null,
  body          text not null check (length(body) between 1 and 20000),
  mentions      uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);

-- Fil d'activité, en ajout seul.
create table if not exists activities (
  id            bigserial primary key,
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  task_id       uuid references tasks(id) on delete set null,
  actor_id      uuid references users(id) on delete set null,
  kind          text not null,
  data          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists activities_project on activities (project_id, created_at desc);

create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  task_id       uuid references tasks(id) on delete cascade,
  filename      text not null,
  mime          text not null default 'application/octet-stream',
  size          integer not null check (size between 0 and 15728640),
  content       bytea not null,
  visible_to_client boolean not null default false,
  uploaded_by   uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------ temps

create table if not exists time_entries (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  task_id       uuid references tasks(id) on delete set null,
  entry_date    date not null default current_date,
  minutes       integer check (minutes between 0 and 1440),
  -- Chronomètre en cours : `minutes` est nul et `started_at` posé.
  started_at    timestamptz,
  billable      boolean not null default true,
  note          text not null default '',
  rate_cents    integer,
  invoiced_at   timestamptz,
  invoice_ref   text,
  created_at    timestamptz not null default now(),
  check (minutes is not null or started_at is not null)
);
create index if not exists time_entries_project on time_entries (project_id, entry_date);
create unique index if not exists time_entries_one_running on time_entries (user_id) where minutes is null;

-- ------------------------------------------------------------------ suivi

-- Point d'avancement interne (météo du projet), comme les « status updates » d'Asana.
create table if not exists project_updates (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  author_id     uuid references users(id) on delete set null,
  health        text not null check (health in ('on_track','at_risk','off_track')),
  body          text not null default '',
  share_with_client boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Les suivis envoyés au client : ce qui est parti, à qui, quand.
create table if not exists client_reports (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  sent_by       uuid references users(id) on delete set null,
  recipients    text[] not null,
  subject       text not null,
  body          text not null,
  automatic     boolean not null default false,
  sent_at       timestamptz not null default now()
);

create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  kind          text not null,
  title         text not null,
  body          text not null default '',
  link          text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_user on notifications (user_id, created_at desc);

-- Tout email parti du serveur (suivi client, invitation, confirmation de rendez-vous) :
-- un journal pour l'entreprise, et la preuve pour les contrôles.
create table if not exists sent_emails (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references accounts(id) on delete cascade,
  to_emails     text[] not null,
  subject       text not null,
  body          text not null,
  via           text not null,
  error         text,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------ boîtes mail

create table if not exists mailboxes (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  provider      text not null check (provider in ('imap','google','microsoft')),
  email         text not null,
  display_name  text,
  secret_enc    text not null,
  sync_state    jsonb not null default '{}',
  is_default    boolean not null default false,
  -- Partagée : toute l'équipe voit les emails de cette boîte (adresse générique info@…).
  shared        boolean not null default false,
  last_synced_at timestamptz,
  sync_error    text,
  sync_requested_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (account_id, email)
);

create table if not exists email_messages (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  mailbox_id    uuid references mailboxes(id) on delete set null,
  message_id    text not null,
  provider_id   text,
  direction     text not null default 'in' check (direction in ('in','out')),
  from_email    text not null default '',
  from_name     text,
  to_emails     text[] not null default '{}',
  subject       text not null default '',
  body          text,
  received_at   timestamptz not null default now(),
  -- Boîte de réception des projets : à trier, rattaché à un projet, ou écarté.
  status        text not null default 'new' check (status in ('new','linked','ignored')),
  project_id    uuid references projects(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (account_id, message_id)
);
create index if not exists email_messages_inbox on email_messages (account_id, status, received_at desc);

-- ------------------------------------------------------------------ agendas et rendez-vous

create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid references projects(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  organizer_id  uuid references users(id) on delete set null,
  title         text not null check (length(title) between 1 and 300),
  description   text not null default '',
  location      text not null default '',
  kind          text not null default 'meeting' check (kind in ('meeting','call','workshop','deadline','other')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  all_day       boolean not null default false,
  booking_id    uuid,
  created_at    timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index if not exists events_time on events (account_id, starts_at);

create table if not exists event_attendees (
  event_id      uuid not null references events(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  user_id       uuid references users(id) on delete cascade,
  email         text,
  name          text,
  unique (event_id, user_id),
  check (user_id is not null or email is not null)
);

-- Agendas extérieurs (Google, Outlook, iCloud) lus par leur adresse iCalendar secrète :
-- leurs créneaux occupés bloquent la prise de rendez-vous et s'affichent dans l'agenda.
create table if not exists calendar_feeds (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,
  url           text not null,
  color         text not null default '#57534e',
  last_synced_at timestamptz,
  sync_error    text,
  created_at    timestamptz not null default now()
);

create table if not exists external_events (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  feed_id       uuid not null references calendar_feeds(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  uid           text not null,
  title         text not null default '',
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  all_day       boolean not null default false,
  unique (feed_id, uid, starts_at)
);

-- Prise de rendez-vous : une page publique par type de rendez-vous.
create table if not exists booking_types (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  name          text not null,
  description   text not null default '',
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 240),
  min_notice_hours integer not null default 12 check (min_notice_hours between 0 and 720),
  max_days_ahead integer not null default 30 check (max_days_ahead between 1 and 365),
  location      text not null default '',
  -- Créneaux ouverts par jour de la semaine (1 = lundi … 7 = dimanche) : [["09:00","12:00"], …].
  availability  jsonb not null default '{"1":[["09:00","12:00"],["14:00","17:00"]],"2":[["09:00","12:00"],["14:00","17:00"]],"3":[["09:00","12:00"],["14:00","17:00"]],"4":[["09:00","12:00"],["14:00","17:00"]],"5":[["09:00","12:00"],["14:00","16:00"]]}',
  -- Plusieurs hôtes : le rendez-vous va au premier libre, à tour de rôle.
  host_ids      uuid[] not null default '{}',
  -- Un rendez-vous pris ouvre un projet (ou le rattache au projet donné).
  create_project boolean not null default false,
  project_id    uuid references projects(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  booking_type_id uuid not null references booking_types(id) on delete cascade,
  event_id      uuid references events(id) on delete set null,
  host_id       uuid references users(id) on delete set null,
  name          text not null,
  email         text not null,
  phone         text,
  company       text,
  message       text not null default '',
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  manage_token  text not null unique default encode(gen_random_bytes(18), 'hex'),
  project_id    uuid references projects(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------ intégrations

-- Une ligne par entreprise : où trouver CRMlead et InvoiceLead, et avec quelle clé.
-- Les clés sont chiffrées (server/lib/mailbox/secret.ts).
create table if not exists account_settings (
  account_id    uuid primary key references accounts(id) on delete cascade,
  crmlead_url   text,
  crmlead_key_enc text,
  invoicelead_url text,
  invoicelead_key_enc text,
  -- Facturation mensuelle automatique : brouillons créés le jour dit pour le mois précédent.
  monthly_billing_auto boolean not null default false,
  monthly_billing_day integer not null default 1 check (monthly_billing_day between 1 and 28),
  invoice_language text not null default 'fr',
  client_update_signature text not null default '',
  updated_at    timestamptz not null default now()
);

-- Une ligne par projet et par mois facturé : jamais deux factures pour le même mois.
create table if not exists invoice_runs (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-\d{2}$'),
  status        text not null check (status in ('pending','created','error','empty')),
  invoice_id    text,
  invoice_url   text,
  amount_cents  bigint not null default 0,
  lines         jsonb not null default '[]',
  error         text,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (account_id, project_id, period)
);

-- Ce qui est arrivé d'une autre application de la famille (un lead gagné de CRMlead…) :
-- un même objet source donne toujours le même projet.
create table if not exists exchange_links (
  account_id    uuid not null references accounts(id) on delete cascade,
  app           text not null,
  type          text not null,
  source_id     text not null,
  project_id    uuid references projects(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (account_id, app, type, source_id)
);

-- Automatisations « quand … alors … ».
create table if not exists automations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  name          text not null,
  trigger       text not null check (trigger in ('task_completed','task_moved','stage_completed','task_created','project_completed')),
  conditions    jsonb not null default '{}',
  action        text not null check (action in ('notify','assign','set_priority','move_column','complete_stage','send_client_update','create_task')),
  params        jsonb not null default '{}',
  active        boolean not null default true,
  runs          integer not null default 0,
  created_at    timestamptz not null default now()
);

-- Formulaire public de demande : une demande reçue ouvre un projet.
create table if not exists intake_forms (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  name          text not null,
  intro         text not null default '',
  template_id   uuid references projects(id) on delete set null,
  owner_id      uuid references users(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists api_keys (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,
  prefix        text not null,
  key_hash      text not null unique,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- Tâches de fond : la date du dernier passage de chacune.
create table if not exists job_runs (
  name          text primary key,
  last_run_at   timestamptz not null
);
