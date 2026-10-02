-- L'usage de la formule d'une entreprise (server/lib/plans.ts), lu dans la transaction de l'appelant.
-- `security definer` : un projet réservé aux intervenants compte aussi, même pour qui ne le voit pas.
-- Sous le rôle de l'application, seule l'entreprise de la session se lit ; sans session (rôle
-- propriétaire : connexion, échange, tâches de fond), celle qu'on nomme.
create or replace function app_plan_usage(p_account uuid)
returns table (plan text, plan_seats int, plan_upgrade_url text, lead_org text,
               open_projects int, members int, invited int)
language sql stable security definer set search_path = public as $$
  select a.plan, a.plan_seats, a.plan_upgrade_url, a.lead_org,
         (select count(*)::int from projects p where p.account_id = a.id and not p.is_template and p.archived_at is null
             and p.status in ('planned', 'active', 'on_hold')),
         (select count(*)::int from account_users au where au.account_id = a.id and au.active),
         (select count(*)::int from invitations i where i.account_id = a.id and i.accepted_at is null and i.expires_at > now())
    from accounts a
   where a.id = p_account and (app_account() is null or app_account() = p_account)
$$;
revoke all on function app_plan_usage(uuid) from public;
grant execute on function app_plan_usage(uuid) to projectlead_app;
