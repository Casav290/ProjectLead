-- Visite guidée de l'application (04.11.2026) : elle s'ouvre seule au PREMIER passage d'une personne, une seule fois.
--
-- `users.tour_pending` : vrai tant que la visite ne s'est jamais ouverte pour cette personne. Les personnes déjà là au
-- passage de cette migration reçoivent FAUX (la colonne naît avec le défaut faux) : elles ne la voient pas d'elles-mêmes
-- et la lancent par « Revoir la visite » (menu du profil). Ensuite le défaut devient VRAI : toute personne créée après
-- (Compte Lead, invitation, accès d'avant) la verra à son premier passage.
-- `users.tour_seen_at` : la première ouverture (ou « Passer »), posée par POST /api/me/tour.
-- Additive seulement, rejouable. Lue et écrite par le serveur en propriétaire (anon) : aucune grant à projectlead_app.
alter table users add column if not exists tour_pending boolean not null default false;
alter table users alter column tour_pending set default true;
alter table users add column if not exists tour_seen_at timestamptz;
