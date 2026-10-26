-- ÉTAPE 5b de la liaison sans clé : NE PAS APPLIQUER AVANT 7 jours verts en production ET un instantané Neon.
-- Ce fichier est volontairement hors de db/ (sous-dossier db/etape-5b/) : server/migrate.ts et scripts/neon-build.mjs ne
-- lisent que db/NNN_*.sql, il n'est donc jamais appliqué automatiquement. Le jour venu : le déplacer dans db/ (nom
-- 013_drop_link_keys.sql s'il est encore libre), puis migrer.
--
-- Les clés `crm_…` et `il_live_…` collées avant le 26.10.2026 ne servent plus à rien (plus aucun code ne les lit) :
-- elles sont effacées pour de bon.
alter table account_settings drop column if exists crmlead_url;
alter table account_settings drop column if exists crmlead_key_enc;
alter table account_settings drop column if exists invoicelead_url;
alter table account_settings drop column if exists invoicelead_key_enc;
