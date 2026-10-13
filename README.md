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
CRMlead, InvoiceLead, échange du Compte Lead, isolation des entreprises, API, abonnement ProjectLead et
webhook Stripe) contre de faux CRMlead, InvoiceLead, Compte Lead et Stripe lancés en local.

Abonnement en mode test Stripe réel, navigateur sans tête : `node scripts/stripe-setup.mjs --portal …` (clé
de test), puis `scripts/e2e-abonnement.mjs` (en-tête du fichier) → `E2E_ABONNEMENT_OK`.

## Variables d'environnement

Voir `.env.example`. Indispensables : `DATABASE_URL`, `PUBLIC_URL`, `APP_SECRET` (chiffre les secrets
des boîtes mail et les clés CRMlead / InvoiceLead ; le changer oblige à tout rebrancher).
Facultatives : `SMTP_URL` et `EMAIL_FROM` (envoi système quand aucune boîte n'est branchée ; sans
eux, les emails sont seulement journalisés dans `sent_emails`), `LEAD_ID_*` (Compte Lead),
`GOOGLE_*` et `MICROSOFT_*` (boîtes en un clic, mêmes applications OAuth que CRMlead ;
`GOOGLE_MAILBOX_OAUTH=1` pour rallumer Gmail par OAuth), `TASKS_SECRET` et `CRON_SECRET` (protègent
`/api/tasks/run`, appelé par le Cron de Vercel : boîtes mail, agendas, suivis automatiques, rappels
d'échéance, facturation du mois), `INBOUND_DOMAIN` (domaine de l'adresse de capture : à poser seulement quand son MX mène à un relais qui poste sur
`/api/inbound/<jeton>` ; sans lui, aucune adresse n'est affichée, seul le point d'entrée du relais l'est).
Abonnement ProjectLead (Stripe, Production seulement) : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_PROPLUS_MONTHLY`, `STRIPE_PRICE_PROPLUS_YEARLY`,
`STRIPE_PORTAL_CONFIGURATION` ; sans elles, les boutons de paiement sont masqués et le webhook répond 503
(`docs/PASSATION.md`, « Abonnement ProjectLead »).

## Mise en ligne

En ligne sur **Vercel** depuis le 13.10.2026, comme CRMlead et InvoiceLead : **https://projectlead.io** (et www),
projet Vercel `projectlead` (équipe scanleads-projects), relié à ce dépôt, **branche de production `vercel`**,
fonction en `cle1` à côté de la base. La base reste sur Neon (projet `gentle-frog-61717092`, branche
`production`, base `projectlead`, `aws-us-east-2`).

Publier = pousser sur `vercel`. `scripts/vercel-build.mjs` (Build Output API) : migrations en production
(`MIGRATE_DATABASE_URL`), contrôle des types, `vite build`, une seule fonction (`server/vercel.ts`, la même
application Hono). Tâches de fond : au passage du trafic (`waitUntil`) et par 24 crons Vercel quotidiens sur
`/api/tasks/run` (un par heure, `CRON_SECRET`), déclarés dans `vercel.json`. Rien ne tourne depuis le VPS.
Variables, secrets et retour arrière : `docs/PASSATION.md`, section Hébergement.

L'ancien hébergement Neon Functions (`server/neon.ts`, `scripts/neon-build.mjs`, `deploy/neon/boot.mjs`) reste dans le
dépôt pour un retour arrière ; la fonction Neon `projectlead` n'a plus de domaine et ne fait plus que renvoyer vers
projectlead.io (`deploy/neon/renvoi.mjs`).
Le contrôle `.github/workflows/verifier-en-ligne.yml` vérifie projectlead.io (`scripts/e2e-prod.mjs`).

## Recevoir des emails sans boîte branchée

Chaque entreprise a une adresse de capture : `POST /api/inbound/<jeton>`, en JSON
(`{ from, to, subject, text, html, message_id }`) ou en message brut (`message/rfc822`). Un relais
d'email entrant (Cloudflare Email Workers, Resend, Postmark…) la nourrit, comme dans CRMlead
(`crmlead/docs/EMAIL-ENTRANT.md`).
