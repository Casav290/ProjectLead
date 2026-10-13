-- Se déconnecter ferme la session dans CE navigateur seulement (décision d'Ève du 13.10.2026) : se déconnecter sur
-- l'ordinateur ne coupe pas ProjectLead ouvert sur un autre appareil. OpenID Connect, comme le prévoit la norme :
-- ERPlead met `sid` (l'identifiant de SA session de navigateur) dans chaque jeton d'identité ; la session ProjectLead
-- le garde, et un `logout_token` de déconnexion (`lead_status: "logout"`) porte ce `sid` : seules les sessions de ce
-- navigateur tombent. Un départ (`lead_status: "disabled"`) ferme toujours TOUTES les sessions de la personne.
-- Une session ouverte avant cette colonne (lead_sid nul) se ferme à la déconnexion de la personne, comme avant.
alter table sessions add column if not exists lead_sid text;
create index if not exists sessions_user_lead_sid on sessions (user_id, lead_sid);
