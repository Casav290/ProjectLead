# ProjectLead, les liens avec CRMlead et InvoiceLead

## CRMlead : les adresses

ProjectLead ne tient pas son propre carnet d'adresses quand CRMlead est branché : il y cherche
l'entreprise et la reprend.

1. Dans **CRMlead → Intégrations**, créer une clé d'API (`crm_…`, portée lecture suffit).
2. Dans **ProjectLead → Réglages → Intégrations → CRMlead**, poser l'adresse de CRMlead
   (`https://crmlead.io`) et la clé. L'enregistrement essaie la clé : une clé fausse est refusée sur place.
3. **Clients → Importer depuis CRMlead** : la recherche porte sur les leads de CRMlead. « Reprendre »
   crée le client (nom de la société, adresse découpée en rue, numéro, NPA et localité, pays, contacts),
   lié par `crmlead:<id du lead>`. Reprendre à nouveau met à jour le même client, sans doublon.
4. **Réglages → Intégrations → Mettre à jour toutes les adresses** relit dans CRMlead tous les clients
   qui en viennent.

Code : `server/lib/crmlead.ts`, routes `server/routes/clients.ts` (`/crmlead/*`).

### Les affaires gagnées arrivent en projets

CRMlead envoie déjà tout seul un `deal` aux applications de la famille quand un lead passe à « gagné »
(voir `crmlead/docs/LEAD-ID.md`, étape 9). ProjectLead le reçoit sur
`POST /api/lead-exchange/v1/inbox` et le transforme en projet « planifié », avec son client et ses
contacts ; un renvoi met à jour le même projet. La carte de visite est
`GET /.well-known/lead-app.json` (`accepts: ["deal", "contact"]`).

Il reste un geste **côté CRMlead** pour l'allumer : une migration qui passe `projectlead` en
`status = 'live'` dans `lead_apps`, avec son `exchange_url` (l'adresse de ProjectLead) et
`accepts = '{deal}'`, puis déclarer l'application (adresses de retour, secret) dans
**Réglages → Mon compte Lead → Applications reliées**. Côté ProjectLead : les variables `LEAD_ID_*`
(`.env.example`) et la colonne `accounts.lead_org`, posée à la première connexion par le Compte Lead.

## InvoiceLead : la facturation mensuelle

1. Dans **InvoiceLead → Réglages → API** (formule Pro+), créer une clé `il_live_…`.
2. Dans **ProjectLead → Réglages → Intégrations → InvoiceLead**, poser l'adresse
   (`https://invoicelead.io`), la clé et la langue des factures.
3. Sur chaque projet, choisir le mode de facturation : à l'heure (taux du projet, sinon de la
   personne), forfait mensuel, par étape (montant posé sur chaque étape) ou forfait global.
4. **Facturation** : choisir le mois, relire l'aperçu, « Créer les brouillons dans InvoiceLead ».
   Ou cocher la facturation automatique, le jour du mois voulu : les brouillons du mois écoulé se
   créent seuls.

Ce que fait ProjectLead pour chaque projet facturable :
- retrouve le contact du client dans InvoiceLead (email, puis nom) ou le crée, et le retient ;
- crée **un brouillon** (`POST /api/v1/invoices`) : lignes en heures, en mois ou au forfait, prix
  hors TVA, code de TVA du projet ; InvoiceLead calcule la TVA et la QR-facture ;
- marque le temps et les étapes facturés (ils ne se modifient plus) et note le brouillon dans
  `invoice_runs`, unique par projet et par mois : relancer le même mois ne refacture rien.

Rien n'est émis depuis ProjectLead : les brouillons se relisent et s'émettent dans InvoiceLead.

Code : `server/lib/invoicelead.ts`, `server/lib/billing.ts`, routes `server/routes/integrations.ts`.

## Contrôles

`npm test` joue ces deux intégrations contre un faux CRMlead, un faux InvoiceLead et un faux
Compte Lead (clés JWKS) lancés en local (`scripts/smoke.ts`).
