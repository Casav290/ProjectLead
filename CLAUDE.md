# ProjectLead

Gestion de projet de la famille Lead (ERPlead, Scanlead, CRMlead, ProjectLead, InvoiceLead, Greetlead). Propriétaire : Ève.
Langue de travail : français. Commits en français, courts.

## Où est quoi

- `README.md` : pile, démarrage, variables, contrôles.
- `docs/FONCTIONNALITES.md` : les fonctions et ce qui vient de chaque leader du marché et de CRMlead.
- `docs/PASSATION.md` : à lire en premier en reprenant le projet (état, hébergement, ce qui reste).
- `docs/PLAN.md` : décisions, étapes, état, ce qui bloque. À tenir à jour.
- `docs/INTEGRATIONS.md` : CRMlead (adresses, affaires gagnées) et InvoiceLead (facturation mensuelle).
- Dépôts sœurs : `Casav290/crmlead` (fournisseur du Compte Lead, `docs/LEAD-ID.md`), `Casav290/InvoiceLead`
  (API v1 `il_live_…`, `docs/API.md`).

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
- Contrôles : `npm run typecheck`, `npm test` (`scripts/smoke.ts`, sur `TEST_DATABASE_URL`), `npm run build`.
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
- Les pages publiques (`/suivi`, `/rdv`, `/demande`) ne rendent que ce qui est destiné au client : ni compte,
  ni jeton, ni email interne, ni ce qui n'est pas coché « visible par le client ».
