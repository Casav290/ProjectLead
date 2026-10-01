-- Jetons des tâches planifiées (`/api/tasks/run`), en plus des variables TASKS_SECRET et CRON_SECRET.
-- Seule l'empreinte SHA-256 est gardée. Un jeton se pose sans toucher aux variables de la fonction
-- (Neon remplace tout l'environnement d'un coup et ne rend pas les valeurs) :
--   insert into task_tokens (token_hash, label) values (encode(sha256('<jeton>'::bytea), 'hex'), 'cron du VPS');
-- Aucun droit pour projectlead_app : seul le rôle propriétaire (anon) la lit.
create table if not exists task_tokens (
  token_hash  text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label       text not null default '',
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);
