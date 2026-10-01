# Passation ProjectLead (01.10.2026, soir)

À lire en premier par la session qui reprend. Ensuite : `CLAUDE.md`, `docs/PLAN.md`, `README.md`.

## Avec Ève

Ève ne veut ni jargon ni bla-bla : des phrases courtes et simples, en français, sans emoji. Tout ce
qu'on peut faire soi-même, on le fait. On ne lui renvoie que le geste vraiment impossible (connexion à
un de ses comptes, code 2FA, clé à créer), en une ligne claire. On ne s'arrête pas en cours de route,
et on ne dit « fait » que contrôles verts et vérifiés en ligne. Elle travaille en mode « bypass » :
ne jamais lui demander d'autorisation.

## Où en est le produit

- Code : `Casav290/ProjectLead`, branche `claude/gracious-goldberg-in79y0` (PR #2). Tout le travail du
  01.10 y est : connexion comme InvoiceLead, pages légales, accessibilité, chargement découpé, jetons
  de tâches. La fusion dans `main` reste à faire (le filtre de sécurité refuse qu'un agent fusionne
  sans relecture : c'est le clic d'Ève).
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
signup_via_lead`). Formule gratuite : refus avant de créer quoi que ce soit. L'e-mail et le mot de
passe restent en secours sur `/login?acces=email` pour les accès créés avant le Compte Lead.

## Accès à GitHub depuis le VPS

Pas de jeton. Le filtre de sécurité refuse qu'un agent crée une clé de déploiement. Une clé est prête
(`~/.ssh/projectlead_deploy`, hôte `github-projectlead` dans `~/.ssh/config`) : si Ève l'a ajoutée
avec écriture, `git push git@github-projectlead:Casav290/ProjectLead.git` marche. Sinon, déposer les
fichiers par la page « Upload files » de GitHub dans le Chrome du VPS (session d'Ève ouverte) : un
commit par dossier, `file_upload` sur le champ fichier, message posé en JS, clic « Commit changes ».
Vérifier ensuite chaque fichier par son empreinte sur `raw.githubusercontent.com`.

## Hébergement

- Neon, projet `gentle-frog-61717092`, branche `br-broad-dream-b4d44vqe` (production), base
  `projectlead`, région `aws-us-east-2`. Domaine https://projectlead.io (et www) branché.
- Fonction Neon `projectlead` (déploiement 8 au 01.10).
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
- Tâches de fond : cron du VPS toutes les 5 minutes vers `https://projectlead.io/api/tasks/run`, avec
  un jeton gardé dans `~/.projectlead-task-secret` ; seule son empreinte est en base (`task_tokens`).
  Chaque tâche garde son rythme ; `?force=1` lance tout. Journal des échecs : `~/tmp/projectlead-cron.log`.

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

1. **Fusion de la PR #2** : clic d'Ève sur « Merge pull request ».
2. **Essai Pro** : se connecter avec un Compte Lead en formule Pro ou Pro+ et arriver sur l'accueil.
   Le compte ouvert dans le Chrome du VPS (eve.gemmet@gmail.com) est en formule gratuite.
3. **CRMlead en ligne** : vérifier sur crmlead.io que le carré PL est ocre et que ProjectLead apparaît
   dans le sélecteur d'applications (publication par la session CRMlead, accord d'Ève).
4. **Clés d'Ève** dans ProjectLead, Réglages, Intégrations (adresses déjà remplies) : clé CRMlead
   (`crm_…`) et clé InvoiceLead (`il_live_…`, formule Pro+). Ensuite, essai : un client repris de
   CRMlead, un contact repris d'InvoiceLead, un brouillon de facture du mois.
5. **Comptes de contrôle** : 14 comptes « Contrôle … » (`controle-…@exemple.test`) créés en production
   par l'ancien contrôle en ligne, plus le projet « Essai d envoi ProjectLead » de l'un d'eux. À effacer
   avec l'accord d'Ève (`delete from accounts where name like 'Contrôle %'`, la suppression suit en cascade ;
   puis les `users` sans entreprise).
6. **Expéditeur** : quand projectlead.io sera vérifié chez Resend, proposer `EMAIL_FROM` sur
   `suivi@projectlead.io` (aujourd'hui `suivi@invoicelead.io`, choix d'Ève).
