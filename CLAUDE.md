# ProjectLead

Gestion de projet de la famille Lead (Scanlead, CRMlead, ProjectLead, InvoiceLead). Propriétaire : Ève.
Langue de travail : français. Commits en français, courts.

## Où est quoi

- `README.md` : pile, démarrage, variables, contrôles.
- `docs/FONCTIONNALITES.md` : les fonctions et ce qui vient de chaque leader du marché et de CRMlead.
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
une nouvelle table lue par l'application doit être ajoutée à la boucle de `002_rls.sql`.

Code repris de CRMlead, à garder aligné : `server/lib/mailbox/*` (Gmail, Microsoft 365, IMAP ; seul
`index.ts` est propre à ProjectLead), `server/lib/icsparse.ts`, `server/lib/time.ts`,
`server/lib/netguard.ts`, `server/lib/leadId.ts` (kit du Compte Lead), `trait-net/`.

## Commandes

- `npm run dev` (API 3002, Vite 5174), `npm run db:migrate`, `npm run db:seed`.
- Contrôles : `npm run typecheck`, `npm test` (`scripts/smoke.ts`, sur `TEST_DATABASE_URL`), `npm run build`.
  Tout doit être vert avant de dire « fait ».

## Règles

- Montants en centimes entiers, durées en minutes entières, dates `AAAA-MM-JJ`.
- Rien n'est émis dans InvoiceLead : ProjectLead n'y crée que des brouillons, un par projet et par mois.
- Le temps facturé ne se modifie plus.
- Les pages publiques (`/suivi`, `/rdv`, `/demande`) ne rendent que ce qui est destiné au client : ni compte,
  ni jeton, ni email interne, ni ce qui n'est pas coché « visible par le client ».
