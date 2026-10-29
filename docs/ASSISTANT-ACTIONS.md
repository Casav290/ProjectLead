# Assistant IA : tout ce qu'il propose s'applique (inventaire, 27.10.2026)

Demande d'Ève (27.10.2026, capture de la bulle dans un projet) : « Fais en sorte que tout ce qui vient de l'intelligence
artificielle puisse s'appliquer en réalité sur le site. » Cahier commun : `~/projets/.unlazy/assistant-actions/CAHIER.md`.

**La règle.** Toute écriture qu'une personne peut faire elle-même dans ProjectLead a son outil `propose_*` dans
l'Assistant IA, ou un interdit nommé. L'outil prépare une carte « À confirmer » ; seul le clic « Confirmer » écrit.

## Comment une carte s'applique

- **Les mêmes routes que l'écran.** Chaque outil prépare les requêtes exactes que l'écran envoie (`/api/...`, colonne
  « Route » ci-dessous) ; à la confirmation, ces routes sont appelées avec la session de la personne
  (`server/lib/assistant/run.ts`) : session, rôle, RLS de l'entreprise, projets réservés, limites de la formule sont
  revérifiés à ce moment-là, comme à l'écran. Aucun chemin ne contourne un contrôle.
- **Essai avant la carte.** L'outil joue d'abord ces requêtes dans une transaction toujours annulée (`dryRun`) : une
  proposition qui échouerait (droits, valeur refusée, projet introuvable, formule) n'est jamais montrée. Pendant l'essai
  rien ne sort (`sendMail` ne fait rien, aucune tâche de fond).
- **Plusieurs changements = une carte.** `propose_batch` (jusqu'à 150 écritures simples) et `propose_project_plan`
  (étapes, tâches, jalons, dépendances, dates, références locales « @clé ») : un jeton, un clic, UNE transaction
  partagée (`sharedTransaction`, `server/db.ts`) : les routes appelées reprennent la même connexion dans un SAVEPOINT ;
  la première refusée annule tout, jeton compris.
- **Jeton.** HMAC (APP_SECRET), personne + entreprise, 10 minutes, usage unique (`assistant_confirmations`), liste
  fermée des routes et refus par champ (`server/lib/assistant/token.ts`, `RULES`), revérifiés à la confirmation sur
  le chemin réel.
- **Ce qui sort attend la validation** (28.10). Un email qu'une écriture déclenche pendant « Confirmer » (automatisation
  « écrire au client » de l'entreprise, qui joue comme à l'écran) part APRÈS la validation de toute la carte
  (`afterSharedCommit`, `server/db.ts`, appelé par `sendMail`) : si une écriture suivante est refusée, tout est annulé et
  rien ne part. Pendant l'essai, rien ne part du tout.
- **Seules sur leur carte** (mode `route`) : les écritures qui appellent une autre application ou un fournisseur
  (CRMlead, InvoiceLead, boîte mail) ; pas d'essai, pas de transaction ouverte pendant l'appel. Ces routes répondent 200
  même quand rien n'a abouti (facturation : un résultat par projet ; synchronisation : `ok: false`) : la carte ne dit
  « fait » que si quelque chose a été fait, et dit quoi (« 2 brouillons créés ; 1 sans rien à facturer », « 3 rendez-vous
  lus ») ; sinon elle passe en « Non enregistré » avec la raison (`routeOutcome`, `server/lib/assistant/run.ts`, 502).
- **Après « Confirmer ».** La page ouverte se recharge, la vue qui montre le résultat s'ouvre (plan : Gantt, avec les
  liens Étapes, Liste, Gantt) et la carte dit en une ligne ce qui a été créé.

## Catégories d'interdits (inchangées)

| Catégorie | Contenu |
|---|---|
| `supprimer` | supprimer ou archiver quoi que ce soit (y compris retirer une dépendance, un point de contrôle, un contact) |
| `payer` | payer, ouvrir le portail de paiement |
| `formule` | changer de formule ou d'abonnement |
| `membres-droits` | équipe, invitations, rôles, intervenants et responsable d'un projet, visibilité, accès du client, partage d'une boîte |
| `cles-api` | clés d'API pour les outils extérieurs |
| `identifiants` | mot de passe, brancher une boîte mail ou un agenda extérieur (secrets) |
| `integrations` | anciens réglages de clés des applications Lead (retirés) |
| `envoyer-exterieur` | email, réponse, suivi client, invitation par email, point partagé, page de suivi ouverte, envoi automatique au client |
| `fichier` | téléverser un fichier (le fil de l'assistant ne transporte pas de fichier) |
| `connexion` | inscription, connexion, déconnexion, acceptation d'une invitation |
| `hors-interface` | pas une action d'un membre dans l'application : pages publiques, API à clé, webhooks, tâches planifiées, assistant lui-même |

Pour une demande interdite, l'assistant explique, dit où le faire et ouvre l'écran (`open_page`).

## Inventaire (écran → action → route → outil)

Format de la colonne « Route » : `MÉTHODE /chemin` (paramètres notés `:id`), suivi au besoin des champs du corps qui
décident (`{champ=valeur}`, `{a.b=valeur}` pour un champ imbriqué). Contrôlé par `node scripts/assistant-actions-gates.mjs G1` : chaque route d'écriture de
l'API figure ici ; chaque outil cité est enregistré ; la liste fermée accepte chaque ligne permise et refuse chaque
ligne interdite ; chaque outil `propose_*` figure ici.

### Projet : étapes, tâches, plan

| Écran | Action | Route | Outil ou interdit |
|---|---|---|---|
| Projet → Étapes | Planifier toutes les étapes (étapes + tâches + jalons + dépendances + dates) | `POST /api/projects/:id/stages` | propose_project_plan, propose_create_stage, propose_batch |
| Projet → Étapes | Modifier une étape (nom, description, note client, dates, visible, montant) | `PATCH /api/projects/stages/:id {name}` | propose_update_stage, propose_batch |
| Projet → Étapes | Changer le statut d'une étape, sans prévenir le client | `PATCH /api/projects/stages/:id {status=done}` | propose_update_stage, propose_batch |
| Projet → Étapes | Changer le statut en prévenant le client par email | `PATCH /api/projects/stages/:id {notify_client=true}` | interdit : envoyer-exterieur |
| Projet → Étapes | Monter / descendre une étape | `POST /api/projects/:id/stages/order` | propose_reorder, propose_batch |
| Projet → Étapes | Supprimer une étape | `DELETE /api/projects/stages/:id` | interdit : supprimer |
| Tableau, Liste, Calendrier, Mes tâches, tâche (sous-tâche) | Nouvelle tâche (dates, étape, colonne, personnes, estimation, jalon, récurrence, étiquettes) | `POST /api/tasks` | propose_create_task, propose_project_plan, propose_batch |
| Tâche (panneau), Tableau, Gantt, Liste, Calendrier, Accueil | Modifier une tâche : titre, description, dates, priorité, personnes, terminer / rouvrir, estimation, étape, colonne, jalon, visible par le client | `PATCH /api/tasks/:id` | propose_update_task, propose_batch |
| Liste → sélection multiple | Terminer, priorité, échéance, étape, ajouter une personne | `POST /api/tasks/bulk {patch.completed=true}` | propose_update_tasks, propose_batch |
| Liste → sélection multiple | Supprimer les tâches choisies | `POST /api/tasks/bulk {patch.delete=true}` | interdit : supprimer |
| Tâche (panneau) | Supprimer la tâche | `DELETE /api/tasks/:id` | interdit : supprimer |
| Tâche → Dépendances | « Attend » / « Bloque » une autre tâche | `POST /api/tasks/:id/dependencies` | propose_add_dependency, propose_project_plan, propose_batch |
| Tâche → Dépendances | Retirer une dépendance | `DELETE /api/tasks/:id/dependencies/:id` | interdit : supprimer |
| Tâche → Liste de contrôle | Ajouter un point | `POST /api/tasks/:id/checklist` | propose_add_checklist_item, propose_project_plan, propose_batch |
| Tâche → Liste de contrôle | Cocher, décocher, renommer | `PATCH /api/tasks/checklist/:id` | propose_update_checklist_item, propose_batch |
| Tâche → Liste de contrôle | Retirer un point | `DELETE /api/tasks/checklist/:id` | interdit : supprimer |
| Tâche → Commentaires | Commenter (@mentions) | `POST /api/tasks/:id/comments` | propose_add_task_comment, propose_batch |
| Tâche → Commentaires | Modifier son commentaire | `PATCH /api/tasks/comments/:id` | propose_update_comment, propose_batch |
| Tâche → Commentaires | Supprimer un commentaire | `DELETE /api/tasks/comments/:id` | interdit : supprimer |
| Tâche → Fichiers, Projet → Fichiers | Téléverser un fichier | `POST /api/projects/:id/files` | interdit : fichier |
| Projet → Fichiers | Rendre un fichier visible / caché au client | `PATCH /api/projects/files/:id` | propose_set_file_visibility, propose_batch |
| Projet → Fichiers, Tâche | Supprimer un fichier | `DELETE /api/projects/files/:id` | interdit : supprimer |
| Projet → Réglages → Colonnes | Ajouter une colonne | `POST /api/projects/:id/columns` | propose_board_column, propose_batch |
| Projet → Réglages → Colonnes | Renommer, « terminées », limite de cartes | `PATCH /api/projects/columns/:id` | propose_board_column, propose_batch |
| Projet → Réglages → Colonnes | Réordonner les colonnes | `POST /api/projects/:id/columns/order` | propose_reorder, propose_batch |
| Projet → Réglages → Colonnes | Supprimer une colonne | `DELETE /api/projects/columns/:id` | interdit : supprimer |

### Projets, modèles, suivi client

| Écran | Action | Route | Outil ou interdit |
|---|---|---|---|
| Projets → Nouveau projet, Modèles → Nouveau modèle, Nouveau projet depuis un modèle | Créer un projet, un modèle, ou un projet depuis un modèle | `POST /api/projects` | propose_create_project, propose_project_plan, propose_batch |
| Projets → Nouveau projet | Créer un projet réservé aux intervenants, ou avec ses intervenants | `POST /api/projects {visibility=members}` | interdit : membres-droits |
| Projet (en-tête, vue d'ensemble, réglages) | Renommer, statut, santé, priorité, dates, description, code, couleur, client, budget, facturation (mode, taux, forfaits, devise, TVA), langue des documents du client | `PATCH /api/projects/:id {name}` | propose_update_project, propose_project_plan, propose_batch |
| Projet → Suivi client | Ce que la page de suivi montre (tâches, temps) | `PATCH /api/projects/:id {portal_show_tasks=true}` | propose_update_project, propose_batch |
| Projet → Réglages | Visibilité « réservé aux intervenants » | `PATCH /api/projects/:id {visibility=members}` | interdit : membres-droits |
| Projet → Réglages | Changer le responsable du projet | `PATCH /api/projects/:id {owner_id}` | interdit : membres-droits |
| Projet → Suivi client | Ouvrir la page de suivi au client | `PATCH /api/projects/:id {portal_enabled=true}` | interdit : envoyer-exterieur |
| Projet → Suivi client | Envoi automatique du suivi au client | `PATCH /api/projects/:id {update_frequency=weekly}` | interdit : envoyer-exterieur |
| Projet | Archiver / désarchiver un projet ; supprimer un modèle | `DELETE /api/projects/:id` | interdit : supprimer |
| Projet → Dupliquer / en faire un modèle | Dupliquer (dates recalées) ou enregistrer comme modèle | `POST /api/projects/:id/duplicate` | propose_duplicate_project, propose_batch |
| Projet → Vue d'ensemble → Intervenants | Ajouter un intervenant, changer son rôle | `POST /api/projects/:id/members` | interdit : membres-droits |
| Projet → Vue d'ensemble → Intervenants | Retirer un intervenant | `DELETE /api/projects/:id/members/:id` | interdit : membres-droits |
| Projet → Activité | Commenter le projet | `POST /api/projects/:id/comments` | propose_add_project_comment, propose_batch |
| Projet → Vue d'ensemble → Point d'avancement | Publier un point interne (santé + texte) | `POST /api/projects/:id/updates {share_with_client=false}` | propose_project_update, propose_batch |
| Projet → Vue d'ensemble → Point d'avancement | Partager le point avec le client | `POST /api/projects/:id/updates {share_with_client=true}` | interdit : envoyer-exterieur |
| Projet → Suivi client | Envoyer le suivi maintenant | `POST /api/projects/:id/client-report` | interdit : envoyer-exterieur |
| Projet → Suivi client | Régénérer le lien du client | `POST /api/projects/:id/portal/regenerate` | interdit : membres-droits |
| Projet → Emails | Écrire un email depuis le projet | `POST /api/projects/:id/emails` | interdit : envoyer-exterieur |

### Temps

| Écran | Action | Route | Outil ou interdit |
|---|---|---|---|
| Temps, Projet → Temps, tâche | Saisir du temps (pour soi, ou pour un collègue : responsables) | `POST /api/time/entries` | propose_log_time, propose_batch |
| Temps | Modifier une saisie | `PATCH /api/time/entries/:id` | propose_update_time_entry, propose_batch |
| Temps, Projet → Temps | Supprimer une saisie | `DELETE /api/time/entries/:id` | interdit : supprimer |
| Temps → Feuille de la semaine | Écrire le total d'une case (1 à 1440 minutes) | `PUT /api/time/week/cell {minutes=90}` | propose_set_timesheet_day, propose_batch |
| Temps → Feuille de la semaine | Vider une case (0 : efface les saisies) | `PUT /api/time/week/cell {minutes=0}` | interdit : supprimer |
| En-tête, Temps, projet, tâche | Démarrer le chronomètre | `POST /api/time/timer/start` | propose_timer, propose_batch |
| En-tête, Temps, tâche | Arrêter le chronomètre | `POST /api/time/timer/stop` | propose_timer, propose_batch |

### Clients

| Écran | Action | Route | Outil ou interdit |
|---|---|---|---|
| Clients, Nouveau projet | Créer un client | `POST /api/clients` | propose_create_client, propose_batch |
| Client | Modifier la fiche (coordonnées, adresse, langue, TVA, notes) | `PATCH /api/clients/:id {town}` | propose_update_client, propose_batch |
| Client | Archiver le client | `PATCH /api/clients/:id {archived=true}` | interdit : supprimer |
| Client → Contacts | Ajouter un contact | `POST /api/clients/:id/contacts` | propose_client_contact, propose_batch |
| Client → Contacts | Modifier un contact (dont « reçoit le suivi ») | `PATCH /api/clients/contacts/:id` | propose_client_contact, propose_batch |
| Client → Contacts | Retirer un contact | `DELETE /api/clients/contacts/:id` | interdit : supprimer |
| Clients → Importer depuis CRMlead | Reprendre un lead et son adresse (avec ses droits dans CRMlead) | `POST /api/clients/crmlead/import` | propose_import_client |
| Client | Mettre à jour depuis CRMlead | `POST /api/clients/:id/crmlead/refresh` | propose_import_client |
| Clients → Importer depuis InvoiceLead | Reprendre un contact du carnet d'InvoiceLead | `POST /api/clients/invoicelead/import` | propose_import_client |

### Agenda et emails

| Écran | Action | Route | Outil ou interdit |
|---|---|---|---|
| Agenda | Créer un rendez-vous (l'équipe est prévenue dans ProjectLead) | `POST /api/calendar/events {send_invites=false}` | propose_event, propose_batch |
| Agenda | Créer en envoyant les invitations par email | `POST /api/calendar/events {send_invites=true}` | interdit : envoyer-exterieur |
| Agenda | Modifier un rendez-vous | `PATCH /api/calendar/events/:id {send_invites=false}` | propose_event, propose_batch |
| Agenda | Modifier en renvoyant les invitations | `PATCH /api/calendar/events/:id {send_invites=true}` | interdit : envoyer-exterieur |
| Agenda | Supprimer un rendez-vous (et prévenir) | `DELETE /api/calendar/events/:id` | interdit : supprimer |
| Agenda, Réglages → Agendas | Brancher un agenda extérieur (adresse secrète) | `POST /api/calendar/feeds` | interdit : identifiants |
| Agenda, Réglages → Agendas | Synchroniser un agenda extérieur | `POST /api/calendar/feeds/:id/sync` | propose_sync_now |
| Agenda, Réglages → Agendas | Débrancher un agenda | `DELETE /api/calendar/feeds/:id` | interdit : supprimer |
| Emails | Ouvrir un projet depuis un email (client, projet, première tâche) | `POST /api/mail/messages/:id/project` | propose_email_to_project |
| Emails | Rattacher un email à un projet (et en faire une tâche) | `POST /api/mail/messages/:id/link` | propose_link_email |
| Emails | Ignorer, remettre à trier | `POST /api/mail/messages/:id/status` | propose_set_email_status, propose_batch |
| Emails | Répondre | `POST /api/mail/messages/:id/reply` | interdit : envoyer-exterieur |
| Réglages → Emails | Brancher une boîte IMAP (mot de passe) | `POST /api/mail/mailboxes/imap` | interdit : identifiants |
| Réglages → Emails | Nom affiché, boîte par défaut | `PATCH /api/mail/mailboxes/:id {display_name}` | propose_update_settings, propose_batch |
| Réglages → Emails | Partager la boîte avec l'équipe | `PATCH /api/mail/mailboxes/:id {shared=true}` | interdit : membres-droits |
| Réglages → Emails | Synchroniser une boîte | `POST /api/mail/mailboxes/:id/sync` | propose_sync_now |
| Réglages → Emails | Débrancher une boîte | `DELETE /api/mail/mailboxes/:id` | interdit : supprimer |
| Réglages → Emails | Brancher Gmail ou Microsoft 365 (OAuth) | `GET /api/mail/oauth/:id/callback` | interdit : identifiants |

### Réglages, notifications, facturation

| Écran | Action | Route | Outil ou interdit |
|---|---|---|---|
| Cloche (en-tête) | Marquer les notifications comme lues | `POST /api/notifications/read` | propose_mark_notifications_read, propose_batch |
| Réglages → Profil | Son nom, sa couleur | `PATCH /api/me` | propose_update_settings, propose_batch |
| Sélecteur de langue (chaque page) | Choisir la langue de l'interface (seule sur sa carte : écrite hors transaction) | `POST /api/me/locale` | propose_set_language |
| Réglages → Profil | Changer son mot de passe | `POST /api/me/password` | interdit : identifiants |
| Réglages → Entreprise (administrateurs) | Nom, fuseau, devise, heures par semaine, langue des documents | `PATCH /api/account` | propose_update_settings, propose_batch |
| Réglages → Entreprise, Applications Lead | Facturation mensuelle (automatique, jour, langue, signature du suivi) | `PATCH /api/integrations/settings` | propose_update_settings, propose_batch |
| Réglages → Entreprise → Formule | Passer à une formule payante | `POST /api/billing/checkout` | interdit : payer |
| Réglages → Entreprise → Formule | Gérer l'abonnement (portail de paiement) | `POST /api/billing/portal` | interdit : formule |
| Réglages → Applications Lead | Coller une clé CRMlead (retiré le 26.10, 410) | `PUT /api/integrations/crmlead` | interdit : integrations |
| Réglages → Applications Lead | Coller une clé InvoiceLead (retiré le 26.10, 410) | `PUT /api/integrations/invoicelead` | interdit : integrations |
| Réglages → Applications Lead | Effacer une clé (retiré le 26.10, 410) | `DELETE /api/integrations/:id` | interdit : integrations |
| Facturation | Créer les brouillons du mois dans InvoiceLead (rien n'est émis) | `POST /api/integrations/billing/run` | propose_monthly_billing |
| Réglages → Équipe | Inviter une personne | `POST /api/team/invite` | interdit : membres-droits |
| Réglages → Équipe | Inviter une personne (même route, autre adresse) | `POST /api/team/invitations` | interdit : membres-droits |
| Réglages → Équipe | Annuler une invitation | `DELETE /api/team/invitations/:id` | interdit : membres-droits |
| Réglages → Équipe | Rôle, taux, capacité d'une personne | `PATCH /api/team/members/:id` | interdit : membres-droits |
| Réglages → Équipe | Retirer une personne | `POST /api/team/members/:id/remove` | interdit : membres-droits |
| Réglages → Équipe | Rétablir une personne | `POST /api/team/members/:id/restore` | interdit : membres-droits |
| Réglages → Équipe → Équipes | Créer une équipe | `POST /api/team/teams` | interdit : membres-droits |
| Réglages → Équipe → Équipes | Renommer une équipe, ses membres | `PATCH /api/team/teams/:id` | interdit : membres-droits |
| Réglages → Équipe → Équipes | Supprimer une équipe | `DELETE /api/team/teams/:id` | interdit : supprimer |
| Réglages → Rendez-vous | Créer une page de rendez-vous | `POST /api/booking` | propose_booking_page, propose_batch |
| Réglages → Rendez-vous | Modifier, activer / désactiver | `PATCH /api/booking/:id` | propose_booking_page, propose_batch |
| Réglages → Rendez-vous | Supprimer une page | `DELETE /api/booking/:id` | interdit : supprimer |
| Réglages → Formulaires | Créer un formulaire de demande | `POST /api/forms` | propose_intake_form, propose_batch |
| Réglages → Formulaires | Modifier, activer / désactiver | `PATCH /api/forms/:id` | propose_intake_form, propose_batch |
| Réglages → Formulaires | Supprimer un formulaire | `DELETE /api/forms/:id` | interdit : supprimer |
| Réglages → Automatisations | Créer une automatisation (prévenir, assigner, priorité, colonne, terminer l'étape, créer une tâche) | `POST /api/automations {action=notify}` | propose_automation, propose_batch |
| Réglages → Automatisations | Créer une automatisation qui écrit au client | `POST /api/automations {action=send_client_update}` | interdit : envoyer-exterieur |
| Réglages → Automatisations | Modifier, activer / désactiver | `PATCH /api/automations/:id {active=false}` | propose_automation, propose_batch |
| Réglages → Automatisations | Modifier pour écrire au client | `PATCH /api/automations/:id {action=send_client_update}` | interdit : envoyer-exterieur |
| Réglages → Automatisations | Supprimer une automatisation | `DELETE /api/automations/:id` | interdit : supprimer |
| Réglages → API | Créer une clé d'API | `POST /api/api-keys` | interdit : cles-api |
| Réglages → API | Révoquer une clé d'API | `DELETE /api/api-keys/:id` | interdit : cles-api |

### Connexion, pages publiques et machines (pas des actions d'un membre dans l'écran)

| Écran | Action | Route | Outil ou interdit |
|---|---|---|---|
| Inscription | Créer un compte | `POST /api/auth/signup` | interdit : connexion |
| Connexion | Se connecter | `POST /api/auth/login` | interdit : connexion |
| Menu de la personne | Se déconnecter | `POST /api/auth/logout` | interdit : connexion |
| Invitation | Accepter une invitation | `POST /api/auth/invitation/:id/accept` | interdit : connexion |
| Compte Lead (ERPlead) | Déconnexion envoyée par ERPlead | `POST /auth/lead/backchannel-logout` | interdit : hors-interface |
| Compte Lead (ERPlead) | Envois des applications Lead (affaires, adresses) | `POST /api/lead-exchange/v1/inbox` | interdit : hors-interface |
| Page publique de rendez-vous | Un visiteur réserve un créneau | `POST /api/public/booking/:id` | interdit : hors-interface |
| Page publique de rendez-vous | Un visiteur annule son rendez-vous | `POST /api/public/booking/manage/:id/cancel` | interdit : hors-interface |
| Formulaire public de demande | Un visiteur envoie une demande | `POST /api/public/forms/:id` | interdit : hors-interface |
| Page de suivi du client | Le client écrit à l'équipe | `POST /api/public/portal/:id/message` | interdit : hors-interface |
| Adresse de capture | Un email transféré arrive | `POST /api/inbound/:id` | interdit : hors-interface |
| Stripe | Événements de paiement | `POST /api/stripe/webhook` | interdit : hors-interface |
| API REST (clé d'API) | Créer un projet, une tâche, du temps depuis un outil extérieur | `POST /api/v1/projects` | interdit : hors-interface |
| API REST (clé d'API) | Créer une tâche depuis un outil extérieur | `POST /api/v1/tasks` | interdit : hors-interface |
| API REST (clé d'API) | Saisir du temps depuis un outil extérieur | `POST /api/v1/time` | interdit : hors-interface |
| Cron Vercel | Tâches de fond (boîtes, suivis, rappels, facturation) | `POST /api/tasks/run` | interdit : hors-interface |
| Exploitation | Poser un secret du serveur | `PUT /api/ops/secrets/:id` | interdit : hors-interface |
| Exploitation | Retirer un secret du serveur | `DELETE /api/ops/secrets/:id` | interdit : hors-interface |
| Bulle Assistant IA | Envoyer une demande à l'assistant | `POST /api/assistant` | interdit : hors-interface |
| Bulle Assistant IA | « Confirmer » une carte | `POST /api/assistant/confirm` | interdit : hors-interface |

## Lectures de l'assistant

`search`, `dashboard`, `list_projects` (dont les modèles), `get_project`, `list_tasks` (étape, jalon, dépendances),
`get_task` (points et commentaires avec leur id), `list_team`, `list_clients`, `get_client`, `list_time_entries`,
`time_report`, `workload`, `list_events`, `list_emails`, `list_files`, `list_settings` (pages de rendez-vous,
formulaires, automatisations, boîtes, agendas, notifications, facturation mensuelle), `search_lead_apps` (CRMlead,
InvoiceLead, avec les droits de la personne), `open_page`. Toutes passent par les routes de lecture de l'écran.

## Le scénario d'Ève

Dans un projet : « Est-ce que tu peux planifier toutes les étapes dans un projet automatiquement pour un nouveau site
Internet ? » → une carte `propose_project_plan` : 4 à 8 étapes datées, leurs tâches (durée en jours ouvrés,
estimation), au moins un jalon de validation par le client, des dépendances simples. Les dates sont calculées par
ProjectLead (`server/lib/assistant/schedule.ts`) : jours ouvrés du lundi au vendredi, étapes enchaînées, une tâche après
ses tâches préalables, un jalon le jour où finit sa dernière tâche préalable. « Confirmer » crée tout en une
transaction ; la page Gantt du projet s'ouvre, avec les liens Étapes et Liste. Variante : en partant d'un modèle de
l'entreprise, l'assistant lit ses étapes et tâches et les reprend dans le plan ; un plan réussi s'enregistre comme modèle
avec `propose_duplicate_project` (`as_template`).

## Contrôles

- `TEST_DATABASE_URL=… npx tsx scripts/assistant-actions-check.ts` → `ASSISTANT_ACTIONS_CHECK_OK` (faux service de
  modèle : chaque outil, le lot, le plan, le tout ou rien, les interdits même signés, la taille). Pour CHACUN des outils
  `propose_*` : proposition sans écriture, autre personne et autre entreprise 403, confirmation, rejeu 403 (G2 le vérifie
  outil par outil, registre lu dans le code). Les outils seuls sur leur carte sans autre application à joindre en local :
  la synchronisation d'un agenda lit un faux agenda iCalendar local ; la facturation du mois s'arrête avant l'envoi à
  InvoiceLead (projet sans client, projet sans rien à facturer) ; la reprise d'un lead CRMlead appelle la route de
  l'écran, qui refuse sans Compte Lead exactement comme l'écran. Leur écriture réelle chez CRMlead et InvoiceLead est
  contrôlée par `scripts/smoke.ts` (faux CRMlead, faux InvoiceLead, faux Compte Lead).
- Cartes dans les cinq langues : dates au format de la langue, pays, langues, genre et taux de TVA en toutes lettres,
  automatisations dites avec la phrase de l'écran Réglages → Automatisations, heures des rendez-vous dans le fuseau de
  l'entreprise ; mêmes mots que l'interface (« stage » en anglais, « Etappe » en allemand).
- `node scripts/assistant-actions-gates.mjs G1` … `G6` (en-tête du fichier).
