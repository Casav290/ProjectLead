# Passation ProjectLead (02.10.2026, hébergement mis à jour le 13.10.2026)

À lire en premier par la session qui reprend. Ensuite : `CLAUDE.md`, `docs/PLAN.md`, `README.md`.

## Avec Ève

Ève ne veut ni jargon ni bla-bla : des phrases courtes et simples, en français, sans emoji. Tout ce
qu'on peut faire soi-même, on le fait. On ne lui renvoie que le geste vraiment impossible (connexion à
un de ses comptes, code 2FA, clé à créer), en une ligne claire. On ne s'arrête pas en cours de route,
et on ne dit « fait » que contrôles verts et vérifiés en ligne. Elle travaille en mode « bypass » :
ne jamais lui demander d'autorisation.

## Où en est le produit

- Code : `Casav290/ProjectLead`. PR #2 fusionnée le 02.10 par Ève (commit `ae16a58`) : tout le travail
  du 01.10 est dans `main` (connexion comme InvoiceLead, pages légales, accessibilité, chargement
  découpé, jetons de tâches, formule relue chaque jour).
- Contrôles locaux : `npm run typecheck`, `npm test` (144 verts, sur `TEST_DATABASE_URL`), `npm run build`.
- Contrôle en ligne : `.github/workflows/verifier-en-ligne.yml`, sur https://projectlead.io, à chaque
  envoi et chaque matin. `scripts/e2e-prod.mjs` ne crée plus rien en production (13 points :
  santé, carte de visite, inscription fermée, départ vers le Compte Lead, écran d'erreur en ocre,
  pages légales, lien de suivi inconnu, aucune erreur JavaScript). À la main :
  `URL=https://projectlead.io node scripts/e2e-prod.mjs`.

## Connexion

Comme InvoiceLead : `/login` et `/signup` partent tout droit vers le Compte Lead (crmlead.io),
`/signup` avec `prompt=create`. L'écran ProjectLead ne reste que pour une erreur (gabarit commun
Trait net, ocre). L'inscription locale est fermée quand le Compte Lead est branché (`403
signup_via_lead`).

**Règle d'Ève (02.10.2026) : tout compte, même gratuit, entre dans toutes les applications, en
formule gratuite.** ProjectLead ne refuse donc personne : la formule du Compte Lead fixe seulement les
quantités (`server/lib/plans.ts`) : Gratuit 3 projets en cours à la fois et 1 personne, Pro projets sans
limite (1 personne), Pro+ 5 personnes. Les demandes à qualifier, projets terminés, archivés et modèles ne
comptent pas. Une limite bloque une action (402 `plan_limit_projects` ou `plan_limit_seats`, avec le lien
de mise à niveau), jamais les données déjà créées. Une affaire gagnée reçue quand la formule est pleine
arrive « à qualifier ». Les entreprises sans Compte Lead (anciens accès locaux) n'ont pas de limite.
Réglages → Entreprise montre la formule et son usage ; la page Projets le rappelle en gratuit. L'e-mail et le mot de
passe restent en secours sur `/login?acces=email` pour les accès créés avant le Compte Lead.
Chaque jour, la formule de chaque entreprise liée est relue au Compte Lead (`refreshLeadPlans`) :
une formule prise ou résiliée ailleurs change les limites le jour même ; personne n'est mis dehors.

## Accès à GitHub depuis le VPS

Clé de déploiement avec écriture ajoutée par Ève le 02.10 : `~/.ssh/projectlead_deploy`, hôte
`github-projectlead` (`git@github-projectlead:Casav290/ProjectLead.git`, remote `origin` du clone
`~/projets/projectlead`). Le filtre de sécurité refuse encore à un agent, sans accord écrit d'Ève dans la
session : fusionner une PR sans relecture, envoyer le paquet de production, effacer des données de
production.

## Hébergement

Vercel depuis le 13.10.2026 (Ève : « ProjectLead comme les autres », plus rien sur Replit ni sur le VPS). La base
n'a pas bougé : elle reste dans son projet Neon, comme celle d'InvoiceLead.

- **Application** : projet Vercel `projectlead` (équipe scanleads-projects, formule gratuite Hobby), relié à
  `Casav290/ProjectLead`, **branche de production `vercel`**. Fonction en `cle1` (Cleveland), à côté de la base
  (us-east-2), comme InvoiceLead : en `fra1`, chaque aller-retour avec la base coûterait environ 90 ms.
- **Base** : Neon `gentle-frog-61717092`, branche `production` (`br-broad-dream-b4d44vqe`), base `projectlead`,
  `aws-us-east-2`, rôle `projectlead_owner` (l'application endosse `projectlead_app`, RLS).
- **Domaine** : projectlead.io et www.projectlead.io, DNS Porkbun : `A @ → 76.76.21.21`, `CNAME www →
  cname.vercel-dns.com`. Avant le 13.10 : `ALIAS @` et `CNAME www → fn-custom-domains.us-east-2.aws.neon.tech`
  (copie : `~/tmp/projectlead-vercel/dns-avant.json` du VPS).
- **Publier** : pousser sur `vercel`. Vercel construit (`scripts/vercel-build.mjs`) : migrations (production
  seulement, `MIGRATE_DATABASE_URL`, connexion directe), contrôle des types, `vite build`, une seule fonction
  (`server/vercel.ts`). Une autre branche donne un déploiement de test, sans migration, protégé par Vercel
  (en-tête `x-vercel-protection-bypass`, jeton dans `~/.projectlead-vercel-bypass` du VPS).
- **Variables** (Vercel → Settings → Environment Variables, Production ; valeurs aussi dans
  `~/.projectlead-vercel.env` du VPS, droits 600) : `DATABASE_URL` (pooler), `MIGRATE_DATABASE_URL` (directe),
  `APP_SECRET`, `TASKS_SECRET`, `CRON_SECRET`, `PUBLIC_URL` (`https://projectlead.io`), `EMAIL_FROM`
  (`ProjectLead <suivi@invoicelead.io>`, comme avant), `RESEND_API_KEY` (clé d'envoi du compte Resend qui a
  invoicelead.io, la même que Greetlead), `LEAD_ID_ISSUER` (`https://erplead.io`), `LEAD_ID_CLIENT_ID` et
  `LEAD_ID_APP` (`projectlead`), `LEAD_ID_CLIENT_SECRET`, `LEAD_ID_REDIRECT_URI`. `NODE_ENV` n'est pas posé
  (`server/vercel.ts` le pose à l'exécution).
- **APP_SECRET est nouveau.** L'ancien n'existait que dans la fonction Neon, qui ne rend que les noms. Il chiffre
  les clés CRMlead / InvoiceLead, les boîtes mail, les agendas et `server_secrets`. Le 13.10, seules étaient
  chiffrées en base les clés InvoiceLead des 10 entreprises « TEST … » du banc `lead-e2e` (aucune entreprise réelle,
  aucune boîte, aucun agenda) : elles ont été rechiffrées avec le nouveau secret à partir du texte clair du banc
  (`~/tmp/projectlead-vercel/rechiffrer.mjs`, anciens chiffrés gardés dans `chiffres-neon-sauvegarde.json`). La
  ligne `GLM_API_KEY` de `server_secrets` reste à l'ancien chiffré : ignorée, et la clé IA ne sert à rien dans ce code.
- **Secret client ERPlead** : renouvelé le 13.10 côté ERPlead (`clients.secret_hash` du client `projectlead`,
  format `lid_…` comme les autres applications, trace dans `audit`). Valeur : `~/.erplead-projectlead-client`.
  Les clients crmlead, invoicelead, greetlead et scanlead n'ont pas changé.
- **Tâches de fond, sans VPS** (`server/lib/jobs.ts`, chaque tâche à son rythme dans `job_runs`) :
  1. à chaque requête reçue, au plus une fois par minute et par instance (`runJobsIfDue`, `waitUntil`) ;
  2. 24 crons Vercel `GET /api/tasks/run?h=N`, un par heure (formule gratuite : chaque cron une fois par jour),
     déclarés dans `vercel.json` seulement (les répéter dans la sortie du build fait échouer le déploiement).
  La ligne `*/5 … projectlead-cron.sh` est retirée de la crontab du VPS (copie de la crontab d'avant dans
  `~/tmp/projectlead-vercel/`).
- **Ancienne fonction Neon `projectlead`** (déploiement 15, paquet `f78241b`) : gardée telle quelle, plus aucun
  DNS n'y mène. Elle ne peut plus connecter personne (ancien secret client) ni lire les 10 clés rechiffrées.
  Retour arrière : remettre les deux enregistrements DNS d'avant, l'ancien `secret_hash`
  (`~/tmp/projectlead-vercel/erplead-client-projectlead-avant.txt`) et `node ~/tmp/projectlead-vercel/rechiffrer.mjs retour`.
- **Contrôle connecté** : `node ~/tmp/projectlead-vercel/e2e-connexion.mjs` (navigateur sans tête, compte
  « TEST Boulangerie Favre » du banc, connexion par ERPlead, écran Projets, console sans erreur).

## Fait le 01.10

- Domaine projectlead.io : répond (`/api/health`), contrôle en ligne et README dessus.
- Connexion réelle par le Compte Lead : crmlead.io renvoie bien vers projectlead.io (essai avec le compte
  eve.gemmet@gmail.com, formule gratuite). Le refus de la formule gratuite qu'on voyait alors est levé le
  02.10 (règle d'Ève : tout compte entre).
- Premier e-mail réel : suivi client envoyé par Resend depuis suivi@invoicelead.io, reçu dans la
  boîte de réception Gmail d'Ève (pas en spam).
- CRMlead : la session CRMlead a préparé l'ocre du carré PL et la migration `114_projectlead_live.sql`
  (projectlead en `live`, `exchange_url` sur projectlead.io, `accepts '{deal}'`) ; publication à
  confirmer sur crmlead.io.

## Ce qui reste, dans l'ordre

1. **Après Vercel (13.10.2026), ce qu'Ève pourra supprimer quand elle voudra** (rien n'a été effacé) : la
   fonction Neon `projectlead` et ses deux domaines personnalisés Neon (projectlead.io, www), le jeton
   « cron du VPS » de `task_tokens`, `~/bin/projectlead-cron.sh` et `~/.projectlead-task-secret` du VPS,
   la ligne `GLM_API_KEY` de `server_secrets` (ancien chiffré illisible).
2. **Essai réel en formule gratuite** : Ève (eve.gemmet@gmail.com, Free) doit entrer dans ProjectLead et
   voir « Gratuit : 3 projets en cours ». Ne pas lui offrir de formule : elle veut vérifier le gratuit.
3. **Clés d'Ève** : Ève crée la clé CRMlead
   (https://crmlead.io/integrations) et la clé InvoiceLead (https://invoicelead.io/fr/app/settings/api,
   Pro+) et les colle elle-même dans https://projectlead.io/reglages/integrations (adresses déjà
   remplies). Ni Claude Desktop ni un agent ne saisissent une clé dans un site.
4. **CRMlead en ligne** : carré PL ocre et ProjectLead dans le sélecteur d'applications (migration
   `114_projectlead_live.sql` prête par la session CRMlead, publication avec l'accord d'Ève).
5. **Comptes de contrôle** : 14 comptes « Contrôle … » (`controle-…@exemple.test`) créés en production
   par l'ancien contrôle en ligne, et le projet « Essai d envoi ProjectLead » de l'un d'eux. À effacer
   avec l'accord d'Ève (`delete from accounts where name like 'Contrôle %'`, puis les `users` sans
   entreprise).
6. **Expéditeur** : quand projectlead.io sera vérifié chez Resend, proposer `EMAIL_FROM` sur
   `suivi@projectlead.io` (aujourd'hui `suivi@invoicelead.io`, choix d'Ève). Le compte Resend de la famille
   (erplead.io, crmlead.io, scanlead.io) est plein : « domain limit of your plan » le 13.10.
