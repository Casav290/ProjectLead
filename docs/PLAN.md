# ProjectLead, plan et état

Version 3, 13.10.2026 (hébergement Vercel).

## Décisions

| Sujet | Choix |
|---|---|
| Produit | Gestion de projet de la famille Lead, après la signature : étapes, tâches, temps, suivi client, facturation |
| Code | GitHub `Casav290/ProjectLead` |
| Pile | Hono + React/Vite + PostgreSQL (`pg`), comme CRMlead ; visuel Trait net, couleur ocre `#9a6a00` |
| Base | Neon, projet `gentle-frog-61717092` (« ProjectLead »), branche `production`, `aws-us-east-2`, à côté d'InvoiceLead |
| Hébergement | Vercel depuis le 13.10.2026 (Ève : « comme les autres ») : projet `projectlead`, branche de production `vercel`, fonction en `cle1` à côté de la base ; avant : Neon Functions (fonction `projectlead`, gardée sans domaine) |
| Domaine | `projectlead.io` (Porkbun) : `A @ → 76.76.21.21`, `CNAME www → cname.vercel-dns.com` (Vercel) |
| Emails sortants | Resend, domaine `projectlead.io`, comme InvoiceLead |
| Connexion | Compte Lead (CRMlead), tout droit comme InvoiceLead ; email et mot de passe en secours |
| Formules | Tout compte entre, même gratuit (Ève, 02.10) ; Gratuit 3 projets en cours et 1 personne, Pro sans limite de projets, Pro+ 5 personnes (`server/lib/plans.ts`) |
| Facturation | Brouillons mensuels dans InvoiceLead par son API (clé `il_live_…`, Pro+) |
| Adresses | CRMlead par son API (clé `crm_…`) ; affaires gagnées reçues par l'échange du Compte Lead |

## Étapes

| Étape | Contenu | Preuve | État |
|---|---|---|---|
| 0. Application | Projets, tâches (tableau, liste, Gantt, calendrier), temps, emails → projets, agenda, rendez-vous, suivi client, facturation, CRMlead, équipe | 144 contrôles de bout en bout ; parcours navigateur sur 22 écrans (bureau et téléphone) ; accessibilité WCAG AA sans défaut (axe-core, 20 écrans) | fait ; pages légales, chargement découpé (68 Ko au premier affichage) |
| 1. En ligne | Neon Functions, base migrée au démarrage, contrôle automatique quotidien, tâches de fond par cron | Contrôle GitHub « Vérifier le site en ligne » vert sur projectlead.io (13 points, rien créé en production) | fait (déploiement 7) ; tâches de fond par cron prêtes, à publier (accord d'Ève) |
| 2. Domaine | `projectlead.io` vers la fonction (domaine personnalisé Neon + DNS Porkbun) | `https://projectlead.io/api/health` répond | fait (01.10), avec et sans www |
| 3. Emails | Resend, `RESEND_API_KEY` dans la fonction | Premier envoi réel reçu | fait (01.10) : suivi client reçu dans la boîte de réception Gmail d'Ève, depuis `suivi@invoicelead.io` ; passer sur `suivi@projectlead.io` quand le domaine sera vérifié chez Resend |
| 4. Compte Lead | Connexion comme InvoiceLead : tout droit vers le Compte Lead, inscription locale fermée, écran d'erreur ocre | Connexion réelle avec le compte d'Ève | aller-retour réel crmlead.io ↔ projectlead.io fait (01.10) ; depuis le 02.10 tout compte entre, même gratuit (limites dans `server/lib/plans.ts`) ; reste l'essai réel en gratuit après publication |
| 5. Liens famille | Clés CRMlead et InvoiceLead posées dans l'entreprise d'Ève ; `projectlead` en `live` dans `lead_apps` de CRMlead | Une adresse reprise de CRMlead, un brouillon dans InvoiceLead | migration CRMlead `114_projectlead_live.sql` prête (session CRMlead), publication à confirmer ; clés à poser par Ève |
| 6. Vercel | Hébergement comme les autres applications : projet Vercel, base Neon inchangée, tâches de fond sans VPS | projectlead.io et www servis par Vercel, connexion réelle par ERPlead (navigateur sans tête, compte de test), tâche de fond passée sur Vercel | fait (13.10) |

## Ce qui bloque

Rien de technique. Restent des gestes d'Ève : ses clés CRMlead et InvoiceLead, qu'elle colle
elle-même dans ProjectLead. Détail dans
`docs/PASSATION.md`.

## Publier une nouvelle version

Pousser sur la branche `vercel` : Vercel construit et migre (`scripts/vercel-build.mjs`). Détails, variables et
retour arrière dans `docs/PASSATION.md` (section Hébergement).
