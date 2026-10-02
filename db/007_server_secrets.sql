-- Secrets du serveur posés sans toucher aux variables de la fonction Neon (qui remplace tout l'environnement
-- d'un coup et ne rend pas les valeurs) : chiffrés par l'application (AES-256-GCM, clé tirée d'APP_SECRET),
-- posés par un jeton d'exploitation (POST /api/ops/secrets/<nom>). Une variable d'environnement du même nom
-- l'emporte toujours. Aucun droit pour projectlead_app : seul le rôle propriétaire les lit.
create table if not exists server_secrets (
  name        text primary key check (name in ('GLM_API_KEY')),
  value_enc   text not null,
  updated_at  timestamptz not null default now()
);
