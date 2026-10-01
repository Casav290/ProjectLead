-- ProjectLead, rôle applicatif. Rejoué à chaque migration (voir server/migrate.ts).
--
-- Même principe que CRMlead : les tables appartiennent au rôle qui migre, et l'application
-- travaille sous un rôle sans privilège, `projectlead_app`, sur lequel la RLS s'applique.
-- Le basculement se fait dans chaque transaction métier (`set local role`, server/db.ts) :
-- impossible d'oublier la RLS en oubliant une variable d'environnement.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'projectlead_app') then
    create role projectlead_app nologin;
  end if;
end $$;

-- Le rôle qui migre doit pouvoir endosser le rôle applicatif.
do $$
begin
  execute format('grant projectlead_app to %I', current_user);
exception when others then
  raise notice 'grant projectlead_app : %', sqlerrm;
end $$;

grant usage on schema public to projectlead_app;
create extension if not exists pgcrypto;
