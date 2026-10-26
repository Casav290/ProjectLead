# ProjectLead, les liens avec CRMlead et InvoiceLead

**Sans clé depuis le 26.10.2026** (Ève : « simplifier toutes les interconnexions dans la même suite de logiciels ») :
entre deux applications Lead, rien à copier ni à coller. Même entreprise dans le Compte Lead (organisation ERPlead,
`accounts.lead_org`) = reliées. La personne connectée agit avec SES droits dans l'autre application, et relier ne
coûte rien : aucune formule exigée, ni ici, ni chez CRMlead, ni chez InvoiceLead. Les clés d'API restent seulement
pour les outils extérieurs (Zapier, Make, Claude, scripts : Réglages → API).

Contrat commun des six applications : `~/projets/.unlazy/lead-vercel/integrations-design.json` (protocol, per_link,
per_app_plan), ERPlead `/oauth/token` (jetons d'échange liés à l'org).

## L'écran « Applications Lead » (Réglages)

« Entreprise du Compte Lead : {nom} ({e-mail}). Les applications ouvertes avec cette entreprise se relient toutes
seules : rien à copier ni à coller. » Puis une ligne par application qui échange vraiment des données :
- **CRMlead** : « Reliée » ou « Pas encore utilisée » ;
- **InvoiceLead** : « Reliée » ou « Pas encore utilisée », la langue des factures et les brouillons automatiques
  le N du mois (administrateurs, et seulement si reliée).

« Reliée » = ERPlead dit que l'entreprise a déjà ouvert cette application avec le Compte Lead
(`entitlements.apps[code].used`). Copie dans `accounts.lead_apps_used` (db/012), relue au plus toutes les 10 min,
à la connexion et chaque jour (`refreshLeadPlans`). Elle sert à l'affichage ; elle ne décide jamais de jeter un
envoi : c'est l'autre application qui répond (404 = pas encore utilisée).

Code : `server/lib/links.ts`, `server/routes/integrations.ts` (`GET /api/integrations` : `links`, `company`,
`last_deal_at`, `last_client_update_at`, `last_invoice_at`, réglages de facturation ; aucun champ de clé).
Les anciennes routes `PUT /api/integrations/crmlead|invoicelead` et `DELETE /api/integrations/:app` répondent
**410 `keys_retired`** (30 jours) ; la mise à jour groupée `POST /crmlead/refresh-clients` n'existe plus.

## La preuve de la personne

Les lectures (CRMlead, InvoiceLead) et les brouillons de factures portent un jeton d'échange d'ERPlead lié à
l'organisation ET à la personne : ProjectLead présente à ERPlead le jeton d'identité que le Compte Lead lui a émis à
la connexion (`subject_token`). Il est gardé avec la session (`sessions.lead_id_token`), **scellé** au repos
(AES-256-GCM, clé `LEAD_PROOF_KEY` ; sans elle, clé dérivée d'`APP_SECRET`). ERPlead l'accepte 12 h ; à 11 h,
ProjectLead répond **401 `lead_reauth`** et l'écran repart sans rien afficher par
`/auth/lead/start?prompt=none&next=<page avec l'état du dialogue>` (reconnexion silencieuse ; si le Compte Lead
n'a plus de session, le départ suivant montre son formulaire, une seule fois). Code : `server/lib/personProof.ts`.

## CRMlead : les adresses

**Clients → Importer depuis CRMlead** : la recherche lit les leads de CRMlead
(`GET {crmlead}/api/lead-exchange/v1/read?type=lead&q=…`, jeton `exchange_read` avec la personne) : un vendeur ne
voit que ce qu'il voit dans CRMlead. « Reprendre » relit le lead par son id avec `link=1` et crée le client (nom de
la société, adresse découpée en rue, numéro, NPA et localité, pays, contacts), lié par `crmlead:<id du lead>` ;
reprendre à nouveau met à jour le même client. Avec `link=1`, CRMlead suit ce client et envoie ensuite ses
changements d'adresse et de contacts (enveloppe `client`, ci-dessous). Sur la fiche, « Mettre à jour depuis
CRMlead » relit ce lead (par id, avec la personne).

Refus dits à l'écran : `crmlead_not_used` (l'entreprise n'a pas de compte CRMlead), `person_not_member`
(`not_opened` : ouvrez CRMlead une fois ; `no_seat` : pas de place dans la formule de CRMlead), `person_proof`
(le Compte Lead de la personne est dans une autre entreprise), `lead_reauth` (silencieux).

Code : `server/lib/crmlead.ts`, routes `server/routes/clients.ts` (`/crmlead/*`).

### Ce que CRMlead envoie (boîte d'échange)

`POST /api/lead-exchange/v1/inbox`, carte `GET /.well-known/lead-app.json` (`accepts: ["deal", "client"]`).
Jeton d'ERPlead seulement (`incomingExchange` du kit), puis `checkEnvelope` : type inconnu → 422 ; `source.app` ≠
expéditeur → 403 `source_mismatch` ; deal et client seulement de crmlead → 403 `sender_not_allowed` ; org du jeton
≠ org de l'enveloppe → 403 `org_mismatch` ; ancien jeton sans org d'un expéditeur listé dans
`EXCHANGE_ORG_SENDERS` (défaut vide ; la mise en ligne posera `crmlead`) → 401 `org_required`. Enveloppe hors
limites (chaînes > 2000, contacts > 50, lignes > 200) → 400 `invalid_envelope` ; org inconnue ici → 404 `unknown_org`.
- `deal` : un lead gagné devient un projet « planifié », avec son client et ses contacts ; un renvoi met à jour le
  même projet. L'URL de l'activité n'est gardée que si elle est chez CRMlead (même origine que `CRMLEAD_URL`,
  https://crmlead.io en production).
- `client` : met à jour SEULEMENT le client `crmlead:<id du lead>` (adresse découpée, pays, contacts manquants
  ajoutés) ; jamais de création : client absent → 404 `not_linked` (`server/routes/exchangeClient.ts`).

## InvoiceLead : la facturation mensuelle

1. Sur chaque projet, choisir le mode de facturation : à l'heure (taux du projet, sinon de la personne), forfait
   mensuel, par étape (montant posé sur chaque étape) ou forfait global.
2. **Facturation** : choisir le mois, relire l'aperçu, « Créer les brouillons dans InvoiceLead ». Ou cocher les
   brouillons automatiques, le jour du mois voulu : ceux du mois écoulé se créent seuls.

Pour chaque projet facturable, une **courte transaction** calcule le brouillon, l'enveloppe `invoice` part HORS
transaction (`POST {invoicelead}/api/lead-exchange/v1/inbox`, synchrone, `source.id = run:<projet>:<AAAA-MM>`,
client en entier dans l'enveloppe, prix en centimes), puis une seconde courte transaction note le résultat
(`invoice_runs`), marque le temps et les étapes envoyés et garde le contact rendu (`clients.invoicelead_contact_id`).
Le lien de la facture est construit ici : `https://invoicelead.io/<langue>/app/invoices/<id>` (`INVOICELEAD_URL`
en local). Deux envois identiques = un seul brouillon chez InvoiceLead (il le remplace tant qu'il est brouillon).

Réponses d'InvoiceLead : 404 → `invoicelead_not_used` (rien d'autre n'est tenté) ; 409 `contact_limit` (formule
d'InvoiceLead pleine, jamais 402) → run en erreur `contact_limit`, que la tâche horaire ne relance pas (il faut un
geste dans InvoiceLead, puis « relancer » à la main) ; 409 `already_issued` → run « créé » avec l'id rendu ;
403 `person_proof` → nouvel essai avec un jeton sans personne (InvoiceLead attribue le brouillon à son premier
administrateur qui facture) ; 403 `person_not_allowed` → « demandez à {admin} ».

Tâche mensuelle (`server/lib/jobs.ts` `monthlyBilling`) : entreprises avec `monthly_billing_auto` et `lead_org`,
jeton sans personne, `sub` = premier administrateur actif.

Rien n'est émis depuis ProjectLead : les brouillons se relisent et s'émettent dans InvoiceLead.

Code : `server/lib/invoicelead.ts`, `server/lib/billing.ts`, routes `server/routes/integrations.ts`.

## Contacts InvoiceLead repris comme clients

Clients, « Importer depuis InvoiceLead » : la liste des contacts clients d'InvoiceLead
(`GET {invoicelead}/api/lead-exchange/v1/read?type=contact&q=…`, 20 au plus, fournisseurs exclus, avec les droits
de la personne), à reprendre un par un ou tous ceux affichés. Le client garde le lien (`invoicelead_contact_id`) :
un contact déjà repris est mis à jour, jamais dupliqué, et la facturation du mois l'envoie comme indice.

## Variables

`LEAD_PROOF_KEY` (nouvelle, 32 signes au moins : scelle la preuve de la personne ; sans elle, repli sur une clé
dérivée d'`APP_SECRET`), `EXCHANGE_ORG_SENDERS` (défaut vide), `CRMLEAD_URL` / `INVOICELEAD_URL` (local seulement ;
en production, les adresses constantes du kit).

## Étape 5b (plus tard)

Les colonnes des clés d'avant (`account_settings.crmlead_url`, `crmlead_key_enc`, `invoicelead_url`,
`invoicelead_key_enc`) restent en base, plus lues par aucun code. Leur suppression est prête dans
`db/etape-5b/013_drop_link_keys.sql`, hors de `db/` (jamais appliquée automatiquement) : après 7 jours verts et un
instantané Neon, la déplacer dans `db/`.

## Contrôles

`npm test` (`scripts/smoke.ts`) joue ces liens contre un faux ERPlead (JWKS, `/oauth/token` qui émet des jetons
d'échange liés à l'org et à la personne), un faux CRMlead et un faux InvoiceLead d'échange qui vérifient ces jetons :
sections « Applications Lead », « CRMlead : reprendre un client avec la preuve de la personne », « InvoiceLead :
facturation mensuelle, sans clé ni formule », « Échange … ».
