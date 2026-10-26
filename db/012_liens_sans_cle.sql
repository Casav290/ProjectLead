-- Liaison sans clé entre les applications Lead (Ève, 26.10.2026 : « simplifier toutes les interconnexions dans la même
-- suite de logiciels »). Même entreprise dans le Compte Lead = reliées : plus de clé `crm_…` ni `il_live_…` à coller.
--
-- 1. Les applications Lead que l'entreprise utilise déjà, d'après ERPlead (entitlements.apps[code].used) : copie pour
--    l'affichage « Reliée » / « Pas encore utilisée » (server/lib/links.ts), relue au plus toutes les 10 minutes.
alter table accounts add column if not exists lead_apps_used jsonb not null default '{}'::jsonb;
alter table accounts add column if not exists lead_apps_checked_at timestamptz;

-- 2. Le jeton d'identité gardé avec la session est désormais SCELLÉ (LEAD_PROOF_KEY, server/lib/personProof.ts) : il sert
--    de preuve de la personne auprès d'ERPlead. Les jetons d'avant, en clair, sont effacés (pas de preuve en clair au
--    repos). Conséquence acceptée : la première lecture de CRMlead ou d'InvoiceLead refait une connexion silencieuse, et
--    la déconnexion de ces sessions-là ne ferme plus la session du Compte Lead (comme une session ouverte par mot de passe).
update sessions set lead_id_token = null where lead_id_token is not null and lead_id_token not like 'p1.%';

-- 3. Une facture que la tâche horaire ne relance pas (contact_limit : la formule d'InvoiceLead est pleine, il faut un
--    geste de la personne) : le code du refus est gardé à part du message.
alter table invoice_runs add column if not exists error_code text;
