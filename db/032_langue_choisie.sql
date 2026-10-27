-- La langue choisie dans ProjectLead (sélecteur, POST /api/me/locale) l'emporte sur celle du Compte Lead (27.10.2026).
-- Tant que la personne n'a rien choisi ici, sa langue suit celle de son profil ERPlead à chaque connexion.
-- Écrite par le serveur en propriétaire (anon) seulement : aucune grant à projectlead_app.
alter table users add column if not exists locale_chosen boolean not null default false;
