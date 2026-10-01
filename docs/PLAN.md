# ProjectLead, plan et état

Version 1, 01.10.2026.

## Décisions

| Sujet | Choix |
|---|---|
| Produit | Gestion de projet de la famille Lead, après la signature : étapes, tâches, temps, suivi client, facturation |
| Code | GitHub `Casav290/ProjectLead` |
| Pile | Hono + React/Vite + PostgreSQL (`pg`), comme CRMlead ; visuel Trait net, couleur ocre `#9a6a00` |
| Base | Neon, projet `gentle-frog-61717092` (« ProjectLead »), branche `production`, `aws-us-east-2`, à côté d'InvoiceLead |
| Hébergement | Neon Functions, fonction `projectlead` sur la branche `production` (un seul paquet : serveur, interface, migrations) |
| Domaine | `projectlead.io` (Porkbun) |
| Emails sortants | Resend, domaine `projectlead.io`, comme InvoiceLead |
| Connexion | Compte Lead (CRMlead), bouton unique comme InvoiceLead ; email et mot de passe en secours |
| Facturation | Brouillons mensuels dans InvoiceLead par son API (clé `il_live_…`, Pro+) |
| Adresses | CRMlead par son API (clé `crm_…`) ; affaires gagnées reçues par l'échange du Compte Lead |

## Étapes

| Étape | Contenu | Preuve | État |
|---|---|---|---|
| 0. Application | Projets, tâches (tableau, liste, Gantt, calendrier), temps, emails → projets, agenda, rendez-vous, suivi client, facturation, CRMlead, équipe | 126 contrôles de bout en bout ; parcours navigateur (12 étapes) ; PR #1 | fait |
| 1. En ligne | Neon Functions, base migrée au démarrage, contrôle automatique quotidien | Contrôle GitHub « Vérifier le site en ligne » vert (connexion, inscription, accueil, modèles) | fait, adresse provisoire `br-broad-dream-b4d44vqe-projectlead.compute.c-6.us-east-2.aws.neon.tech` |
| 2. Domaine | `projectlead.io` vers la fonction (domaine personnalisé Neon + DNS Porkbun) | `https://projectlead.io/api/health` répond | en cours : accès Porkbun à obtenir |
| 3. Emails | Resend : domaine vérifié (DKIM, SPF, DMARC chez Porkbun), `RESEND_API_KEY` dans la fonction | Code et contrôle faits (faux Resend) ; reste un premier envoi réel | en cours : accès Resend à obtenir |
| 4. Compte Lead | ProjectLead déclaré dans CRMlead (secret, adresse de retour `https://projectlead.io/auth/lead/callback`), variables `LEAD_ID_*` | Connexion réelle avec le compte d'Ève | à faire : accès administrateur crmlead.io |
| 5. Liens famille | Clés CRMlead et InvoiceLead posées dans l'entreprise d'Ève ; `projectlead` en `live` dans `lead_apps` de CRMlead | Une adresse reprise de CRMlead, un brouillon dans InvoiceLead | à faire après l'étape 4 |

## Ce qui bloque

Les étapes 2 à 4 demandent les comptes Porkbun, Resend et l'administration de crmlead.io. Mon
conteneur n'y a pas accès (réseau filtré). La session InvoiceLead a fait les mêmes gestes pour
invoicelead.io : je lui ai demandé comment, pour refaire pareil.

## Publier une nouvelle version

`node scripts/neon-build.mjs`, pousser, mettre le commit et l'empreinte du paquet dans
`deploy/neon/boot.mjs`, redéployer la fonction (`deploy_function`). Détails dans `README.md`.
