# ProjectLead

Gestion de projet de la famille Lead (ERPlead, Scanlead, CRMlead, ProjectLead, InvoiceLead, Greetlead). Propriétaire : Ève.
Langue de travail : français. Commits en français, courts.

## Où est quoi

- `README.md` : pile, démarrage, variables, contrôles.
- `docs/FONCTIONNALITES.md` : les fonctions et ce qui vient de chaque leader du marché et de CRMlead.
- `docs/PASSATION.md` : à lire en premier en reprenant le projet (état, hébergement, ce qui reste).
- `docs/PLAN.md` : décisions, étapes, état, ce qui bloque. À tenir à jour.
- `docs/INTEGRATIONS.md` : CRMlead (adresses, affaires gagnées) et InvoiceLead (facturation mensuelle), reliés
  SANS CLÉ par le Compte Lead depuis le 26.10.2026.
- Dépôts sœurs : `Casav290/crmlead` (`docs/LEAD-ID.md`), `Casav290/InvoiceLead` (`docs/API.md`), ERPlead (émetteur du
  Compte Lead et des jetons d'échange).

## Pile

Même pile que CRMlead : Hono + TypeScript (`server/`), React + Vite (`src/`), PostgreSQL par `pg` seul.
RLS par `app.account_id` : toute requête métier passe par `withTenant` (`server/db.ts`), qui endosse le
rôle `projectlead_app`. `anon` (rôle propriétaire, sans RLS) est réservé à la connexion, aux pages
publiques et aux tâches de fond : chaque requête y porte elle-même son filtre de compte.
Migrations `db/NNN_*.sql`, idempotentes ; `000_roles.sql` et `002_rls.sql` rejoués à chaque passage :
une nouvelle table lue par l'application doit être ajoutée à la boucle de `002_rls.sql` (une table née dans une
migration plus récente, ou en lecture seule pour l'application, y a son bloc conditionnel, comme `billing_subscriptions`).

Code repris de CRMlead, à garder aligné : `server/lib/mailbox/*` (Gmail, Microsoft 365, IMAP ; seul
`index.ts` est propre à ProjectLead), `server/lib/icsparse.ts`, `server/lib/time.ts`,
`server/lib/netguard.ts`, `server/lib/leadId.ts` (kit du Compte Lead), `server/lib/stripe.ts` (modèle de
l'abonnement de CRMlead, filtre `own` commun aux applications Lead), `trait-net/`.

## Commandes

- `npm run dev` (API 3002, Vite 5174), `npm run db:migrate`, `npm run db:seed`.
- Contrôles : `npx tsx scripts/i18n-check.ts --keys` et `--hardcoded`, `npm run typecheck`, `npm test` (`scripts/smoke.ts`, sur `TEST_DATABASE_URL`), `npm run build`.
  Tout doit être vert avant de dire « fait ».

## Règles

- Montants en centimes entiers, durées en minutes entières, dates `AAAA-MM-JJ`.
- Rien n'est émis dans InvoiceLead : ProjectLead n'y crée que des brouillons, un par projet et par mois.
- Le temps facturé ne se modifie plus.
- Tout compte du Compte Lead entre, même en formule gratuite : la formule ne fixe que des quantités
  (`server/lib/plans.ts`), et une limite bloque une action, jamais des données déjà créées.
- Passer d'une application Lead à l'autre (Ève, 13.10.2026) : une personne entre TOUJOURS dans l'espace de son
  organisation ERPlead (`attachLeadPerson`), rejoint ou créé en Gratuit ; jamais un espace personnel ni celui d'une
  autre entreprise. Places prises → écran « Toutes les places ProjectLead de votre entreprise sont prises ». Le lanceur
  (`src/components/AppSwitcher.tsx`) lit `src/lib/leadFamily.ts`, copie telle quelle de `lead-family.json` : ne pas la
  modifier ici seule.
- Se déconnecter ferme le Compte Lead et les sessions des applications DANS CE NAVIGATEUR seulement (Ève,
  13.10.2026) : `sessions.lead_sid` garde le `sid` d'ERPlead, le back-channel « logout » ne ferme que ces sessions (et
  celles d'avant le `sid`) ; un départ (« disabled ») ferme toutes les sessions de la personne. Pas de boucle de
  connexion, même cookies refusés. Détails : `docs/PASSATION.md`, « Arrivée et déconnexion ».
- La formule ProjectLead se prend dans ProjectLead et ne vaut qu'ici (Ève, 13.10.2026) : Stripe Checkout et
  portail (`server/routes/billing.ts`). Le compte Stripe est partagé par toutes les applications Lead : ne créer,
  lire, modifier ou annuler QUE des objets `metadata.app = projectlead` ; jamais `client_reference_id`. Un
  événement d'une autre application reçoit 200 sans aucune écriture (`own`, `server/lib/stripe.ts`).
- Liaison sans clé (Ève, 26.10.2026) : entre deux applications Lead, AUCUNE clé ni adresse à coller ; même
  organisation ERPlead = reliées ; la personne agit avec SES droits (preuve scellée, `server/lib/personProof.ts`) ;
  relier ne coûte rien (jamais de formule exigée, jamais de 402). Aucun texte ne doit dire qu'une clé ou Pro+ relie
  deux apps Lead. Les clés d'API ne servent qu'aux outils extérieurs.
- Les pages publiques (`/suivi`, `/rdv`, `/demande`) ne rendent que ce qui est destiné au client : ni compte,
  ni jeton, ni email interne, ni ce qui n'est pas coché « visible par le client ».
- Suites de l'abonnement (15.10.2026, `docs/PASSATION.md`) : jamais une offre égale ou inférieure à la formule acquise
  (`paidTier`, formule propre du Compte Lead comprise ; le serveur refuse en 409 `plan_not_above` avant Stripe) ;
  « Retirer » (administrateur, jamais soi-même) = désactivation gardée, dernière venue dans `account_users.last_seen_at` ;
  la place ne se règle que par « Retirer » et « Rétablir » (PATCH /members/:id refuse un changement de `active`) ; tout
  ce qui peut retirer un administrateur prend d'abord `lockAdmins` (`server/lib/admins.ts`) ;
  refus « places » à `/login?erreur=places&formule=…` avec « Changer de compte » (`switch=1` → prompt=login), jamais un
  « Réessayer » qui ramène au même refus. Contrats `data-plan-*` et `data-seat-*` lus par le banc : ne pas les retirer.
- Assistant IA (Ève, 29.10.2026) : il ne sert que ProjectLead (consigne du bloc stable) ; en formule gratuite,
  200 000 jetons pondérés par mois civil et par entreprise, l'équivalent de 10 demandes. Constantes : seulement
  `server/lib/assistant/budget.ts` ; qui est limité : `planOf` (jamais une copie de la règle). Détail et preuves :
  `docs/ASSISTANT-ACTIONS.md`, « Périmètre et limite gratuite (29.10.2026) ».
- Cinq langues partout (Ève, 27.10.2026) : fr, de, en, it, es. AUCUN texte en dur dans `src/` : tout passe par `t()`
  (`src/i18n/index.tsx`, textes dans `src/i18n/locales/<langue>/<partie>.json`, mêmes clés dans les cinq) ; les textes
  envoyés par le serveur (e-mails, notifications, CSV, brouillons de facture) par `tr(langue, clé)` (`server/lib/i18n.ts`,
  `server/i18n/<langue>.ts`). Sélecteur `LanguageSelect` sur chaque page ; langue gardée (localStorage `pl.lang`, cookie
  `pl_lang`, `users.locale`). Langue des documents client : `projects.doc_locale`, sinon `accounts.locale`. Devise de
  l'entreprise à sa création selon le pays (`currencyForCountry`). Contrôle : `npx tsx scripts/i18n-check.ts --keys`,
  `--hardcoded`, `--control` ; navigateur : `scripts/e2e-langues.mjs`.
