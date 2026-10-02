# ProjectLead, plan et état

Version 2, 01.10.2026 (soir).

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
| 0. Application | Projets, tâches (tableau, liste, Gantt, calendrier), temps, emails → projets, agenda, rendez-vous, suivi client, facturation, CRMlead, équipe | 144 contrôles de bout en bout ; parcours navigateur sur 22 écrans (bureau et téléphone) ; accessibilité WCAG AA sans défaut (axe-core, 20 écrans) | fait ; pages légales, chargement découpé (68 Ko au premier affichage) |
| 1. En ligne | Neon Functions, base migrée au démarrage, contrôle automatique quotidien, tâches de fond par cron | Contrôle GitHub « Vérifier le site en ligne » vert sur projectlead.io (13 points, rien créé en production) | fait (déploiement 7) ; tâches de fond par cron prêtes, à publier (accord d'Ève) |
| 2. Domaine | `projectlead.io` vers la fonction (domaine personnalisé Neon + DNS Porkbun) | `https://projectlead.io/api/health` répond | fait (01.10), avec et sans www |
| 3. Emails | Resend, `RESEND_API_KEY` dans la fonction | Premier envoi réel reçu | fait (01.10) : suivi client reçu dans la boîte de réception Gmail d'Ève, depuis `suivi@invoicelead.io` ; passer sur `suivi@projectlead.io` quand le domaine sera vérifié chez Resend |
| 4. Compte Lead | Connexion comme InvoiceLead : tout droit vers le Compte Lead, inscription locale fermée, écran d'erreur ocre | Connexion réelle avec le compte d'Ève | aller-retour réel crmlead.io ↔ projectlead.io fait (01.10), formule gratuite refusée (revérifié le 02.10 par Claude Desktop) ; reste l'essai avec une formule Pro |
| 5. Liens famille | Clés CRMlead et InvoiceLead posées dans l'entreprise d'Ève ; `projectlead` en `live` dans `lead_apps` de CRMlead | Une adresse reprise de CRMlead, un brouillon dans InvoiceLead | migration CRMlead `114_projectlead_live.sql` prête (session CRMlead), publication à confirmer ; clés à poser par Ève |

## Ce qui bloque

Rien de technique. Restent des décisions et gestes d'Ève : accord écrit pour publier la version de
`main` ; une formule Pro ou Pro+ pour son Compte Lead (eve.gemmet@gmail.com est en Free, ProjectLead
la refuse) ; puis ses clés CRMlead et InvoiceLead, qu'elle colle elle-même. Détail dans
`docs/PASSATION.md`.

## Publier une nouvelle version

`node scripts/neon-build.mjs`, pousser, mettre le commit et l'empreinte du paquet dans
`deploy/neon/boot.mjs`, redéployer la fonction (`deploy_function`). Détails dans `README.md`.
