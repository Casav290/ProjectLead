-- Passer d'une application Lead à l'autre (demande d'Ève du 13.10.2026) : une personne de l'organisation ERPlead entre
-- toujours dans l'espace de SON entreprise, jamais dans un espace à part. Il faut alors savoir POURQUOI une personne est
-- inactive dans l'espace :
-- - désactivée par un administrateur ProjectLead (Réglages → Équipe) : elle reste dehors tant qu'il ne la réactive pas ;
-- - sortie par ERPlead (avis de départ, back-channel logout avec lead_status « disabled ») : si ERPlead la laisse
--   revenir dans la même organisation, elle reprend sa place à la connexion suivante, s'il en reste une.
alter table account_users add column if not exists lead_disabled boolean not null default false;
