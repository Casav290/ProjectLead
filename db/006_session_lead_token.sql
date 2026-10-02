-- Neon Functions ne garde que le dernier en-tête Set-Cookie d'une réponse (constaté le 02.10.2026 : au retour
-- du Compte Lead, le cookie de session se perdait derrière celui du jeton d'identité, et la connexion tournait
-- en boucle). Une réponse ne pose donc qu'un cookie : le jeton d'identité, qui sert à fermer aussi la session du
-- Compte Lead à la déconnexion, est gardé avec la session plutôt que dans un second cookie.
alter table sessions add column if not exists lead_id_token text;
