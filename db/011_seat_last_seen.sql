-- Suites de l'abonnement par application (15.10.2026), point 2 : la liste des places (Réglages → Équipe) dit la
-- dernière venue de chaque personne dans CETTE entreprise, gardée même quand ses sessions ont pris fin (départ,
-- « Retirer », expiration). Écrite à chaque arrivée (ouverture d'une session : Compte Lead, invitation, mot de passe,
-- server/routes/auth.ts) et pendant l'activité, au plus une fois par heure (garde de session, server/index.ts).
-- Rejouable ; rien n'est retiré.
alter table account_users add column if not exists last_seen_at timestamptz;

-- Les venues d'avant la colonne : la plus récente des sessions encore connues (une session close ne laisse pas de
-- trace ; sans session connue, la dernière venue reste inconnue : « Jamais venue » à l'écran).
update account_users au set last_seen_at = s.seen
  from (select user_id, account_id, max(created_at) as seen from sessions group by user_id, account_id) s
 where au.user_id = s.user_id and au.account_id = s.account_id and au.last_seen_at is null;
