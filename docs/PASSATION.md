# Passation ProjectLead (02.10.2026)

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

- Neon, projet `gentle-frog-61717092`, branche `br-broad-dream-b4d44vqe` (production), base
  `projectlead`, région `aws-us-east-2`. Domaine https://projectlead.io (et www) branché.
- Fonction Neon `projectlead` : déploiement 7 (01.10), paquet du commit `ddb277a` (connexion comme
  InvoiceLead, pages légales, accessibilité, chargement découpé). La version suivante (jetons de
  tâches, `server/index.ts` et `db/003_task_tokens.sql`) est sur la branche mais **pas publiée** : le
  filtre de sécurité a refusé qu'un agent envoie le paquet de production. Il faut l'accord écrit d'Ève
  (« je t'autorise à publier ProjectLead en production ») ou qu'elle publie elle-même.
- La fonction est un amorçage (`deploy/neon/boot.mjs`) qui charge `deploy/neon/index.mjs` depuis
  GitHub à un commit fixé et vérifie son empreinte. Publier :
  1. `node scripts/neon-build.mjs`, envoyer `deploy/neon/index.mjs` ;
  2. mettre ce commit et `sha256sum deploy/neon/index.mjs` dans `boot.mjs`, l'envoyer ;
  3. zipper `boot.mjs` sous le nom `index.mjs`, puis `deploy_function` avec **le zip seul** :
     sans `environment`, la fonction garde ses variables.
- Variables de la fonction (valeurs dans Neon, jamais dans le dépôt) : `PL_DATABASE_URL`,
  `APP_SECRET`, `TASKS_SECRET`, `PUBLIC_URL` (`https://projectlead.io`), `EMAIL_FROM`
  (`ProjectLead <suivi@invoicelead.io>`), `RESEND_API_KEY`, `LEAD_ID_ISSUER`, `LEAD_ID_CLIENT_ID`,
  `LEAD_ID_APP`, `LEAD_ID_CLIENT_SECRET`, `LEAD_ID_REDIRECT_URI`. `deploy_function` avec
  `environment` remplace **tout** l'environnement, et Neon ne rend que les noms : ne jamais le passer
  sans toutes les valeurs.
- Tâches de fond : aujourd'hui, elles ne tournent qu'au passage de visiteurs. Prêt pour après la
  publication : jeton dans `~/.projectlead-task-secret`, script `~/bin/projectlead-cron.sh`. Une fois
  publié : poser l'empreinte (`insert into task_tokens (token_hash, label) values
  (encode(sha256('<jeton>'::bytea), 'hex'), 'cron du VPS')`), puis ajouter à la crontab
  `*/5 * * * * /usr/bin/env bash "$HOME/bin/projectlead-cron.sh"`. Chaque tâche garde son rythme ;
  `?force=1` lance tout. Journal des échecs : `~/tmp/projectlead-cron.log`.

## Fait le 01.10

- Domaine projectlead.io : répond (`/api/health`), contrôle en ligne et README dessus.
- Connexion réelle par le Compte Lead : crmlead.io renvoie bien vers projectlead.io ; la formule
  gratuite est refusée (essai avec le compte eve.gemmet@gmail.com, formule gratuite).
- Premier e-mail réel : suivi client envoyé par Resend depuis suivi@invoicelead.io, reçu dans la
  boîte de réception Gmail d'Ève (pas en spam).
- CRMlead : la session CRMlead a préparé l'ocre du carré PL et la migration `114_projectlead_live.sql`
  (projectlead en `live`, `exchange_url` sur projectlead.io, `accepts '{deal}'`) ; publication à
  confirmer sur crmlead.io.

## Ce qui reste, dans l'ordre

1. **Publication** de la version de `main` (jetons de tâches, formule relue chaque jour) : accord écrit
   d'Ève, puis paquet, amorçage, `deploy_function` (zip seul), empreinte du jeton dans `task_tokens` et
   crontab du VPS.
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
   `suivi@projectlead.io` (aujourd'hui `suivi@invoicelead.io`, choix d'Ève).
