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
d'échéance, facturation du mois), `INBOUND_DOMAIN` (domaine affiché de l'adresse de capture).

## Recevoir des emails sans boîte branchée

Chaque entreprise a une adresse de capture : `POST /api/inbound/<jeton>`, en JSON
(`{ from, to, subject, text, html, message_id }`) ou en message brut (`message/rfc822`). Un relais
d'email entrant (Cloudflare Email Workers, Resend, Postmark…) la nourrit, comme dans CRMlead
(`crmlead/docs/EMAIL-ENTRANT.md`).
