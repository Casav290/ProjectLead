# ProjectLead, les fonctions et d'où elles viennent

ProjectLead reprend ce que font bien les logiciels de gestion de projet du marché (la liste du
comparatif Outmind : Asana, Monday.com, ClickUp, Trello, Notion, Wrike, Jira, Basecamp, Teamwork,
Smartsheet, Microsoft Project et Planner, Zoho Projects, Sinnaps, Gantter…) et y ajoute ce qui fait
la famille Lead : les emails et les agendas branchés, l'équipe, la prise de rendez-vous de CRMlead,
le suivi envoyé au client, la facturation mensuelle par InvoiceLead et les adresses tenues dans
CRMlead.

## Le tour des leaders

| Outil | Ce qui le distingue | Repris dans ProjectLead |
|---|---|---|
| **Asana** | Points d'avancement (« status updates ») avec météo du projet, portefeuille, Mes tâches, dépendances, modèles, règles | Points d'avancement (dans les temps / à surveiller / en retard), portefeuille, Mes tâches, dépendances, modèles, automatisations |
| **Monday.com** | Tableaux personnalisables, automatisations « quand… alors… », formulaires, charge de travail | Automatisations « quand … alors … », formulaires de demande publics, charge de travail par personne et par semaine |
| **ClickUp** | Toutes les vues sur les mêmes tâches (liste, tableau, Gantt, calendrier), sous-tâches, listes de contrôle, suivi du temps intégré | Liste, tableau, Gantt, calendrier sur les mêmes tâches, sous-tâches, listes de contrôle, chronomètre et feuille de temps |
| **Trello** | Kanban simple au glisser-déposer | Tableau kanban par projet, colonnes libres, limite d'en-cours |
| **Notion** | Pages riches, base de connaissance | Description de projet et de tâche, fichiers par projet (pas d'éditeur de wiki : voir « Pas repris ») |
| **Wrike** | Gestion des ressources, rapports, portail invités | Charge de travail, rapports de temps et de rentabilité, page de suivi publique pour le client |
| **Jira** | Numérotation des tâches, priorités, flux par colonnes | Numéro de tâche par projet, quatre priorités, colonnes « terminé » qui closent la tâche |
| **Basecamp** | Fil de discussion par projet, client invité, rapports automatiques | Fil d'activité et commentaires avec @mentions, message du client depuis sa page de suivi, suivi client automatique |
| **Teamwork** | Pensé pour les agences : temps facturable, budgets, facturation | Temps facturable, taux par personne et par projet, budget en heures et en montant, facturation mensuelle |
| **Smartsheet** | Gantt avec dépendances, jalons | Gantt maison : étapes, tâches, jalons, dépendances, glisser pour replanifier |
| **MS Project / Planner** | Planification par phases, jalons, capacité | Étapes (phases) datées, jalons, capacité hebdomadaire par personne |
| **Zoho Projects** | Feuilles de temps, tâches récurrentes, rapports | Feuille de temps de la semaine, tâches récurrentes (jour, semaine, mois), export CSV |

## Repris de CRMlead

- **Comptes email** : Gmail, Microsoft 365 et toute messagerie IMAP/SMTP (Infomaniak, OVH, Hostpoint, iCloud…),
  avec la détection automatique des serveurs et le chiffrement des secrets, code repris tel quel.
- **Chaque nouvel email peut ouvrir un projet** : un email d'un client connu rejoint tout seul son projet
  en cours ; un email d'un expéditeur inconnu arrive dans « Emails → À trier », d'où un clic ouvre un projet
  (client créé depuis l'expéditeur, description reprise, première tâche « Répondre à … »), le rattache à
  un projet existant ou en fait une tâche. Une adresse de capture reçoit aussi les emails transférés.
- **Agendas** : flux iCalendar personnel (voir ProjectLead dans Google Agenda, Outlook, Apple), agendas
  extérieurs lus par leur adresse iCal secrète (leurs créneaux occupés bloquent la prise de rendez-vous),
  invitations envoyées avec un fichier .ics.
- **Team** : rôles (administrateur, responsable, membre), équipes, invitations, taux et capacités.
- **Prise de rendez-vous** : pages publiques par type de rendez-vous, disponibilités par jour, préavis,
  battement, plusieurs hôtes à tour de rôle, confirmation et annulation par le client ; un rendez-vous
  peut ouvrir un projet.
- **Compte Lead** : connexion unique de la famille (OpenID Connect hébergé par CRMlead), visuel « Trait net ».

## Propres à ProjectLead

- **Plusieurs intervenants par projet**, chacun avec son rôle (chef de projet, intervenant, observateur)
  et son taux sur ce projet. Un projet peut être réservé à ses intervenants.
- **Suivi de projet envoyé au client** : l'état de chaque étape visible, l'avancement, le dernier point
  partagé, envoyé à la demande, à chaque changement d'étape, ou automatiquement chaque semaine, quinzaine
  ou mois ; plus une page de suivi publique (lien secret) avec fichiers partagés et un formulaire pour
  écrire à l'équipe.
- **Facturation mensuelle par InvoiceLead** : à l'heure (temps du mois, ligne par tâche et par taux),
  forfait mensuel, par étape livrée ou forfait global à la fin ; un brouillon par projet et par mois,
  jamais deux, temps et étapes marqués facturés. Manuellement ou automatiquement le jour choisi.
- **Adresses tenues dans CRMlead** : recherche et reprise d'une entreprise de CRMlead (adresse découpée
  en rue, numéro, NPA, localité, et ses contacts), mise à jour d'un clic ; une affaire gagnée dans
  CRMlead arrive toute seule en projet (échange du Compte Lead, type `deal`).

## Pas repris (pour l'instant)

- Éditeur de documents et wiki façon Notion ; tableaux blancs.
- Champs personnalisés configurables à l'écran (la colonne `custom` existe sur les tâches, sans écran).
- Synchronisation bidirectionnelle des agendas Google et Microsoft par leur API (lecture iCal seulement,
  comme CRMlead).
- Traduction de l'interface (français seulement ; InvoiceLead vise aussi l'allemand).
- Application mobile native.
- Assistant IA (brouillons, résumés) : CRMlead en a un, à brancher plus tard.
