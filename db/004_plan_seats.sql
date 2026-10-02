-- Formules de la famille Lead (Ève, 02.10.2026) : toute personne avec un Compte Lead entre dans
-- ProjectLead, même en formule gratuite ; ce qui est payant, ce sont les limites, pas l'accès.
-- `plan` reçoit le code du Compte Lead (free, pro, pro_plus) ; `plan_seats` les places qu'il donne.
alter table accounts add column if not exists plan_seats int check (plan_seats is null or plan_seats > 0);
alter table accounts add column if not exists plan_upgrade_url text;
