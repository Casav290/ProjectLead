# ProjectLead

La gestion de projet de la famille Lead (Scanlead, CRMlead, ProjectLead, InvoiceLead) : mener le
projet une fois l'affaire signée, avec ses étapes, ses tâches, ses intervenants, son temps, le suivi
envoyé au client et la facturation du mois dans InvoiceLead.

Les fonctions et leur origine (Asana, Monday, ClickUp, Trello, Wrike, Teamwork… et CRMlead) sont
dans [docs/FONCTIONNALITES.md](docs/FONCTIONNALITES.md) ; les liens avec CRMlead et InvoiceLead dans
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## En bref

- **Projets** : portefeuille, modèles, plusieurs intervenants par projet (chef de projet, intervenant,
  observateur), étapes datées, santé, budget en heures et en montant, points d'avancement.
- **Tâches** : tableau kanban, liste, Gantt, calendrier ; sous-tâches, listes de contrôle,
  dépendances, jalons, priorités, récurrence, commentaires avec @mentions, fichiers.
- **Temps** : chronomètre, feuille de temps de la semaine, rapports et rentabilité, charge de travail.
- **Emails** : boîtes Gmail, Microsoft 365 et IMAP (code de CRMlead) ; chaque email peut ouvrir un
  projet, rejoindre un projet ou devenir une tâche.
- **Agendas et rendez-vous** : flux iCal, agendas extérieurs, invitations, pages de prise de rendez-vous.
- **Suivi client** : l'état des étapes envoyé au client (à la demande, au changement d'étape ou
  périodiquement) et une page de suivi publique.
- **Facturation** : brouillons mensuels dans InvoiceLead. **Adresses** : reprises de CRMlead.
- **Équipe** : rôles, équipes, taux, capacités ; automatisations, formulaires de demande, API REST.

## Pile

Comme CRMlead : Hono + TypeScript (`server/`), React + Vite + Tailwind au visuel « Trait net »
(`src/`), PostgreSQL par `pg` seul. Chaque table métier porte `account_id` et la RLS l'impose :
le serveur endosse le rôle `projectlead_app` dans chaque transaction (`server/db.ts`), avec
`app.account_id`, `app.user_id` et `app.role` posés localement. Migrations dans `db/NNN_*.sql`,
appliquées par `server/migrate.ts` (`000_roles.sql` et `002_rls.sql` rejoués à chaque passage).

## Démarrer en local

```bash
npm ci
cp .env.example .env         # DATABASE_URL (rôle propriétaire, CREATEROLE), APP_SECRET (32 caractères)
npm run db:migrate
npm run db:seed              # démonstration : demo@projectlead.test / demo-demo-demo
npm run dev                  # API sur 3002, interface sur http://localhost:5174
```

## Contrôles

```bash
npm run typecheck
npm test                     # scripts/smoke.ts sur TEST_DATABASE_URL : tout doit être vert
npm run build
```

`npm test` déroule les parcours de bout en bout (inscription, invitation, projets depuis un modèle,
tâches et dépendances, temps, suivi client, page publique, rendez-vous, emails → projet, formulaire,
CRMlead, InvoiceLead, échange du Compte Lead, isolation des entreprises, API) contre de faux CRMlead,
InvoiceLead et Compte Lead lancés en local.

## Variables d'environnement

Voir `.env.example`. Indispensables : `DATABASE_URL`, `PUBLIC_URL`, `APP_SECRET` (chiffre les secrets
des boîtes mail et les clés CRMlead / InvoiceLead ; le changer oblige à tout rebrancher).
Facultatives : `SMTP_URL` et `EMAIL_FROM` (envoi système quand aucune boîte n'est branchée ; sans
eux, les emails sont seulement journalisés dans `sent_emails`), `LEAD_ID_*` (Compte Lead),
`GOOGLE_*` et `MICROSOFT_*` (boîtes en un clic, mêmes applications OAuth que CRMlead ;
`GOOGLE_MAILBOX_OAUTH=1` pour rallumer Gmail par OAuth), `TASKS_SECRET` (protège
`POST /api/tasks/run`, à appeler par un cron : boîtes mail, agendas, suivis automatiques, rappels
d'échéance, facturation du mois), `INBOUND_DOMAIN` (domaine de l'adresse de capture : à poser seulement quand son MX mène à un relais qui poste sur
`/api/inbound/<jeton>` ; sans lui, aucune adresse n'est affichée, seul le point d'entrée du relais l'est).

## Page d'accueil

`/` montre la page d'accueil (`accueil.html`, styles et mouvements dans `src/landing/`) à un visiteur sans session
valide, et l'application à une session valide (`server/lib/landing.ts` ; réponse `Vary: Cookie`, jamais en cache
partagé). Les boutons « Créer mon compte » et « Se connecter » mènent à `/login`, qui part sur ERPlead.

Les images et le film de la page sont dans `media/` et restent **hors du paquet JS** : le serveur Node les lit sur le
disque, la fonction Neon les télécharge à la première demande depuis GitHub au commit fixé par `neon-build.mjs`
(empreintes SHA-256 vérifiées), puis les garde en mémoire. Requêtes partielles (Range, 206) et ETag : voir
`server/lib/media.ts`.

Refaire les captures (données fictives de Moraine Bâtiment SA, aucune donnée réelle) :

```bash
createdb pl_landing_demo                      # base neuve
DATABASE_URL=postgres://…/pl_landing_demo APP_SECRET=… npx tsx scripts/landing/demo-seed.ts
npm run build && PORT=3412 PUBLIC_URL=https://projectlead.io DATABASE_URL=… APP_SECRET=… JOBS_DISABLED=1 npx tsx server/index.ts
node scripts/landing/captures.mjs <dossier> http://localhost:3412   # 1440 px densité 2 et téléphone 430 px densité 3
node scripts/landing/images.mjs <dossier>     # AVIF + WebP dans media/accueil/
node scripts/landing/partage.mjs              # image de partage 1200 x 630
```

Le film (Remotion) et ses sources sont rangés dans `partage/Quantum Liquid LLC/projectlead/landing/` ; la version
web est copiée dans `media/film/`.

## Mise en ligne

En ligne sur Neon Functions, à côté de la base (projet Neon `gentle-frog-61717092`, branche `production`,
base `projectlead`, `aws-us-east-2`) : **https://projectlead.io** (domaine personnalisé Neon ; adresse
technique de la fonction : `br-broad-dream-b4d44vqe-projectlead.compute.c-6.us-east-2.aws.neon.tech`).

`node scripts/neon-build.mjs` produit `deploy/neon/index.mjs` (serveur, interface et migrations en un
fichier, la base est migrée au démarrage). Les fichiers de `media/` doivent être commités et poussés AVANT : le
paquet n'en garde que le manifeste (commit et empreintes). La fonction Neon `projectlead` est un petit amorçage
(`deploy/neon/boot.mjs`) qui télécharge ce paquet depuis GitHub à un commit fixé et vérifie son empreinte :
pour publier, construire, pousser, mettre le commit et l'empreinte dans `boot.mjs`, puis redéployer
l'amorçage. Variables de la fonction : `PL_DATABASE_URL`, `APP_SECRET`, `TASKS_SECRET`, `PUBLIC_URL`.
Le contrôle `.github/workflows/verifier-en-ligne.yml` vérifie projectlead.io à chaque envoi et chaque matin, sans
rien créer en production (`scripts/e2e-prod.mjs` : connexion par le Compte Lead, inscription fermée, pages publiques).
Une configuration Vercel (`vercel.json`, `scripts/vercel-build.mjs`) reste prête si l'on y passe un jour.

## Recevoir des emails sans boîte branchée

Chaque entreprise a une adresse de capture : `POST /api/inbound/<jeton>`, en JSON
(`{ from, to, subject, text, html, message_id }`) ou en message brut (`message/rfc822`). Un relais
d'email entrant (Cloudflare Email Workers, Resend, Postmark…) la nourrit, comme dans CRMlead
(`crmlead/docs/EMAIL-ENTRANT.md`).
