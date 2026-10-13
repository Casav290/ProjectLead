# Passation ProjectLead (02.10.2026, hébergement et abonnement mis à jour le 13.10.2026)

À lire en premier par la session qui reprend. Ensuite : `CLAUDE.md`, `docs/PLAN.md`, `README.md`.

## Avec Ève

Ève ne veut ni jargon ni bla-bla : des phrases courtes et simples, en français, sans emoji. Tout ce
qu'on peut faire soi-même, on le fait. On ne lui renvoie que le geste vraiment impossible (connexion à
un de ses comptes, code 2FA, clé à créer), en une ligne claire. On ne s'arrête pas en cours de route,
et on ne dit « fait » que contrôles verts et vérifiés en ligne. Elle travaille en mode « bypass » :
ne jamais lui demander d'autorisation.

## Où en est le produit

- Code : `Casav290/ProjectLead`. PR #2 fusionnée le 02.10 par Ève (commit `ae16a58`) : tout le travail
  du 01.10 est dans `main` (connexion comme InvoiceLead, pages légales, accessibilité, chargement
  découpé, jetons de tâches, formule relue chaque jour).
- Contrôles locaux : `npm run typecheck`, `npm test` (tout vert, sur `TEST_DATABASE_URL`), `npm run build` ;
  abonnement en mode test Stripe : `scripts/e2e-abonnement.mjs`.
- Contrôle en ligne : `.github/workflows/verifier-en-ligne.yml`, sur https://projectlead.io, à chaque
  envoi et chaque matin. `scripts/e2e-prod.mjs` ne crée plus rien en production (13 points :
  santé, carte de visite, inscription fermée, départ vers le Compte Lead, écran d'erreur en ocre,
  pages légales, lien de suivi inconnu, aucune erreur JavaScript). À la main :
  `URL=https://projectlead.io node scripts/e2e-prod.mjs`.

## Connexion

Comme InvoiceLead : `/login` et `/signup` partent tout droit vers le Compte Lead (crmlead.io),
`/signup` avec `prompt=create`. L'écran ProjectLead ne reste que pour une erreur (gabarit commun
Trait net, ocre). L'inscription locale est fermée quand le Compte Lead est branché (`403
signup_via_lead`).

**Règle d'Ève (02.10.2026) : tout compte, même gratuit, entre dans toutes les applications, en
formule gratuite.** ProjectLead ne refuse donc personne : la formule fixe seulement les quantités
(`server/lib/plans.ts`) : Gratuit 3 projets en cours à la fois et 1 personne, Pro projets sans limite
(1 personne), Pro+ 5 personnes. Les demandes à qualifier, projets terminés, archivés et modèles ne
comptent pas. Une limite bloque une action (402 `plan_limit_projects` ou `plan_limit_seats`, avec le lien
vers Réglages → Entreprise), jamais les données déjà créées. Une affaire gagnée reçue quand la formule est
pleine arrive « à qualifier ». Les entreprises sans Compte Lead (anciens accès locaux) n'ont pas de limite.
L'e-mail et le mot de passe restent en secours sur `/login?acces=email` pour les accès créés avant le Compte Lead.

**Passer d'une application à l'autre (demande d'Ève du 13.10.2026, branche `passage-apps`).** Connectée une fois à
ERPlead, une personne entre dans ProjectLead sans aucun écran, par le lanceur d'une autre application, une adresse
tapée ou un lien profond (`/login` et toute page sans session partent vers `/auth/lead/start?next=…`).
- **L'espace** (`attachLeadPerson`, `server/routes/auth.ts`) : toujours celui de son organisation ERPlead
  (`accounts.lead_org = claims.org`), rejoint (administratrice chez ERPlead : administratrice, sinon membre) ou créé
  à son nom en Gratuit. Une entreprise d'avant le Compte Lead n'est reprise que si la personne en est
  l'administratrice et l'est aussi chez ERPlead. Plus jamais d'espace personnel ni d'autre entreprise : places
  prises → `/login?erreur=places` (« Toutes les places ProjectLead de votre entreprise sont prises ») ; désactivée
  par un administrateur ProjectLead → `/login?erreur=desactive`. Rien n'est créé dans ces deux cas.
- **Départ annoncé par ERPlead** (back-channel, `lead_status: disabled`) : `account_users.lead_disabled` (009). Si
  ERPlead la laisse revenir dans la même organisation, elle reprend sa place à la connexion suivante, s'il en reste.
  Un choix de l'administrateur (Réglages → Équipe) remet ce drapeau à faux.
- **Invitation ProjectLead** (`/invitation/<jeton>`) : bouton « Accepter avec mon Compte Lead » →
  `/auth/lead/start?next=/invitation/<jeton>` ; au retour, l'invitation est prise pour la personne connectée si
  l'adresse vérifiée est la même (sinon `?erreur=adresse`), et l'entreprise qui invite s'ouvre. Plus de nouveau mot
  de passe ProjectLead avec le Compte Lead branché (403 `invitation_via_lead`) ; celui d'un accès d'avant reste accepté.
- **Lanceur à 9 points** (`src/components/AppSwitcher.tsx`) : les six applications de `src/lib/leadFamily.ts`
  (copie telle quelle de `~/projets/lead-e2e/lead-family.json`), dans l'ordre ERPlead, Scanlead, CRMlead, ProjectLead,
  InvoiceLead, Greetlead, chacune vers son adresse d'entrée (`https://<app>/login`, ERPlead `/account`), jamais sa
  page publique ; ProjectLead « Vous êtes ici » sans lien ; panneau fixe sous 480 px. Points d'accroche des contrôles :
  `data-lead-launcher`, `data-lead-app`, et `data-lead-org` (organisation ERPlead) sur la racine de l'espace.
- **Contrôles** : `npm test`, sections « Connexion par le Compte Lead », « Départ d'une personne » et « Lanceur de la
  famille Lead ».

**Règle d'Ève (13.10.2026) : chaque application vend son propre abonnement, valable chez elle seule.** La
formule ProjectLead se prend dans ProjectLead (Réglages → Entreprise, voir « Abonnement ProjectLead »
ci-dessous). Un abonnement CRMlead, Scanlead, InvoiceLead ou Greetlead n'ouvre plus rien ici. Transition : un
abonnement payé ailleurs AVANT la bascule garde Pro ou Pro+ ici jusqu'à la fin de sa période déjà payée, date
figée par ERPlead (`family_until`), sans grâce ; ensuite Gratuit. Seul abonné concerné au 13.10 : Quantum Liquid
(CRMlead Pro), jusqu'au 25.10.2026 à 11:40 UTC ; il n'a pas d'entreprise dans ProjectLead.
Chaque jour, la formule ProjectLead de chaque entreprise liée est relue au Compte Lead (`refreshLeadPlans`,
jeton `billing` de ProjectLead : ERPlead calcule la formule de CETTE application) ; personne n'est mis dehors.

## Accès à GitHub depuis le VPS

Clé de déploiement avec écriture ajoutée par Ève le 02.10 : `~/.ssh/projectlead_deploy`, hôte
`github-projectlead` (`git@github-projectlead:Casav290/ProjectLead.git`, remote `origin` du clone
`~/projets/projectlead`). Le filtre de sécurité refuse encore à un agent, sans accord écrit d'Ève dans la
session : fusionner une PR sans relecture, envoyer le paquet de production, effacer des données de
production.

## Hébergement

Vercel depuis le 13.10.2026 (Ève : « ProjectLead comme les autres », plus rien sur Replit ni sur le VPS). La base
n'a pas bougé : elle reste dans son projet Neon, comme celle d'InvoiceLead.

- **Application** : projet Vercel `projectlead` (équipe scanleads-projects, formule gratuite Hobby), relié à
  `Casav290/ProjectLead`, **branche de production `vercel`**. Fonction en `cle1` (Cleveland), à côté de la base
  (us-east-2), comme InvoiceLead : en `fra1`, chaque aller-retour avec la base coûterait environ 90 ms.
- **Base** : Neon `gentle-frog-61717092`, branche `production` (`br-broad-dream-b4d44vqe`), base `projectlead`,
  `aws-us-east-2`, rôle `projectlead_owner` (l'application endosse `projectlead_app`, RLS).
- **Domaine** : projectlead.io et www.projectlead.io, DNS Porkbun : `A @ → 76.76.21.21`, `CNAME www →
  cname.vercel-dns.com`. Avant le 13.10 : `ALIAS @` et `CNAME www → fn-custom-domains.us-east-2.aws.neon.tech`
  (copie : `~/tmp/projectlead-vercel/dns-avant.json` du VPS).
- **Publier** : pousser sur `vercel`. Vercel construit (`scripts/vercel-build.mjs`) : migrations (production
  seulement, `MIGRATE_DATABASE_URL`, connexion directe), contrôle des types, `vite build`, une seule fonction
  (`server/vercel.ts`). Une autre branche donne un déploiement de test, sans migration, protégé par Vercel
  (en-tête `x-vercel-protection-bypass`, jeton dans `~/.projectlead-vercel-bypass` du VPS).
- **Variables** (Vercel → Settings → Environment Variables, Production ; valeurs aussi dans
  `~/.projectlead-vercel.env` du VPS, droits 600) : `DATABASE_URL` (pooler), `MIGRATE_DATABASE_URL` (directe),
  `APP_SECRET`, `TASKS_SECRET`, `CRON_SECRET`, `PUBLIC_URL` (`https://projectlead.io`), `EMAIL_FROM`
  (`ProjectLead <suivi@invoicelead.io>`, comme avant), `RESEND_API_KEY` (clé d'envoi du compte Resend qui a
  invoicelead.io, la même que Greetlead), `LEAD_ID_ISSUER` (`https://erplead.io`), `LEAD_ID_CLIENT_ID` et
  `LEAD_ID_APP` (`projectlead`), `LEAD_ID_CLIENT_SECRET`, `LEAD_ID_REDIRECT_URI`. `NODE_ENV` n'est pas posé
  (`server/vercel.ts` le pose à l'exécution).
- **APP_SECRET est nouveau.** L'ancien n'existait que dans la fonction Neon, qui ne rend que les noms. Il chiffre
  les clés CRMlead / InvoiceLead, les boîtes mail, les agendas et `server_secrets`. Le 13.10, seules étaient
  chiffrées en base les clés InvoiceLead des 10 entreprises « TEST … » du banc `lead-e2e` (aucune entreprise réelle,
  aucune boîte, aucun agenda) : elles ont été rechiffrées avec le nouveau secret à partir du texte clair du banc
  (`~/tmp/projectlead-vercel/rechiffrer.mjs`, anciens chiffrés gardés dans `chiffres-neon-sauvegarde.json`). La
  ligne `GLM_API_KEY` de `server_secrets` reste à l'ancien chiffré : ignorée, et la clé IA ne sert à rien dans ce code.
- **Secret client ERPlead** : renouvelé le 13.10 côté ERPlead (`clients.secret_hash` du client `projectlead`,
  format `lid_…` comme les autres applications, trace dans `audit`). Valeur : `~/.erplead-projectlead-client`.
  Les clients crmlead, invoicelead, greetlead et scanlead n'ont pas changé.
- **Tâches de fond, sans VPS** (`server/lib/jobs.ts`, chaque tâche à son rythme dans `job_runs`) :
  1. à chaque requête reçue, au plus une fois par minute et par instance (`runJobsIfDue`, `waitUntil`) ;
  2. 24 crons Vercel `GET /api/tasks/run?h=N`, un par heure (formule gratuite : chaque cron une fois par jour),
     déclarés dans `vercel.json` seulement (les répéter dans la sortie du build fait échouer le déploiement).
  La ligne `*/5 … projectlead-cron.sh` est retirée de la crontab du VPS (copie de la crontab d'avant dans
  `~/tmp/projectlead-vercel/`).
- **Ancienne fonction Neon `projectlead`** : plus aucun DNS n'y mène. Jusqu'au déploiement 15 (paquet `f78241b`),
  son adresse d'appel servait encore l'application entière sur la base de production, avec les anciens secrets, et
  chaque appel lançait les tâches de fond (vu le 13.10 dans `job_runs`). Depuis le **déploiement 16** (13.10, 06:24 UTC),
  elle n'est plus qu'un renvoi 308 vers https://projectlead.io, même chemin (`deploy/neon/renvoi.mjs`) : ni base, ni
  tâche, ni secret lu. Déployée avec le zip seul : ses 11 variables restent dans Neon (état d'avant :
  `~/tmp/projectlead-vercel/neon-fonction-avant.json`). Rien n'est supprimé.
  Retour arrière, dans l'ordre : redéployer l'amorçage d'avant (`~/tmp/projectlead-vercel/neon-boot-retour.zip`, soit
  `deploy/neon/boot.mjs` zippé sous le nom `index.mjs`, `deploy_function` avec le zip seul), puis remettre les deux
  enregistrements DNS d'avant, l'ancien `secret_hash` (`~/tmp/projectlead-vercel/erplead-client-projectlead-avant.txt`)
  et `node ~/tmp/projectlead-vercel/rechiffrer.mjs retour`. Remettre le DNS d'abord ferait tourner projectlead.io en rond.
- **www.projectlead.io** sert l'application (200), comme projectlead.io. La connexion par ERPlead revient toujours sur
  `LEAD_ID_REDIRECT_URI` (sans www) : `/auth/lead/start` appelé sur www renvoie d'abord vers la même adresse sans www,
  pour que le cookie de départ y soit posé (sinon retour en `/login?erreur=session`, défaut corrigé le 13.10).
- **Contrôle connecté** : `node ~/tmp/projectlead-vercel/e2e-connexion.mjs` (navigateur sans tête, compte
  « TEST Boulangerie Favre » du banc, connexion par ERPlead, écran Projets, console sans erreur).

## Abonnement ProjectLead (Stripe), depuis le 13.10.2026

**En production depuis le 13.10.2026** (commit `3669011` poussé sur `vercel` à 10:24 UTC, après ERPlead et le garde
du webhook ScanLead ; variables posées et redéploiement `dpl_9EK9AJGuC8AfN9bJRpxDzwFdhCty` à 10:28 UTC). Objets
Stripe live (compte `acct_1TRVTg…`, aucun secret ici) :

| Objet | Identifiant |
|---|---|
| Produits | `projectlead_pro`, `projectlead_pro_plus` (metadata `app=projectlead`) |
| Pro 19 €/mois, 190 €/an | `price_1UQ2rzEXSpi2MsjnfOrTKFIZ`, `price_1UQ2s0EXSpi2MsjnBlCEq1dK` |
| Pro+ 39 €/mois, 390 €/an | `price_1UQ2s0EXSpi2MsjnCISrtpR8`, `price_1UQ2s1EXSpi2MsjnwBKBVCwj` |
| Portail | `bpc_1UQ2s1EXSpi2Msjn2iEHZxYJ` (retour `https://projectlead.io/reglages/entreprise`) |
| Endpoint | `we_1UQ2vgEXSpi2MsjnZr2OchHs`, `https://projectlead.io/api/stripe/webhook`, 5 événements |

Preuves en production le 13.10.2026 (banc `~/projets/lead-e2e`) : `stripe-live-objects.mjs` → `STRIPE_LIVE_OK`,
`smoke-billing-prod.mjs` → `BILLING_PROD_OK` (webhook configuré : POST non signé → 400), `17-per-app.mjs` (compte
avec un seul abonnement ProjectLead : Pro ici, Gratuit et « Passer à Pro » local dans InvoiceLead, Greetlead et
CRMlead). Aucun achat réel n'a été fait.

- **Modèle** : CRMlead (`crmlead-vercel/server/routes/billing.ts`). Code : `server/lib/stripe.ts` (Stripe sans
  SDK, filtre `own`), `server/lib/subscription.ts` (client, état, déclaration à ERPlead, relecture du jour),
  `server/routes/billing.ts` (routes et webhook), `db/008_billing.sql`, carte `src/components/PlanCard.tsx`.
- **Formule** = la meilleure de (a) celle qu'ERPlead calcule pour ProjectLead (`accounts.plan`, avec
  `plan_source` own/family/free et `plan_valid_until` : passée, elle ne compte plus, même sans relecture) et
  (b) l'abonnement local (`billing_subscriptions`, statuts active/trialing/past_due, 3 jours de grâce).
- **Compte Stripe partagé** (acct_1TRVTg… « scanlead.io », avec ScanLead, CRMlead, InvoiceLead, Greetlead) :
  ProjectLead ne touche qu'aux objets `metadata.app = projectlead`. Client Stripe propre à chaque entreprise
  (clé d'idempotence `projectlead-customer-<compte>`), jamais retrouvé par e-mail. Checkout : metadata et
  subscription_data.metadata {app, account_id, plan, interval}, carte seule, adresse et TVA ; jamais
  `client_reference_id` (ScanLead annule ce qu'il ne reconnaît pas). Portail : configuration propre
  (`STRIPE_PORTAL_CONFIGURATION`), jamais celle par défaut (ScanLead).
- **Webhook** `POST /api/stripe/webhook` (avant la garde de session, corps brut) : signature, filtre `own`
  (événement d'une autre application → 200 `other_app`, AUCUNE écriture, aucun appel à Stripe), abonnement relu
  chez Stripe (l'état le plus récent fait foi), effet et inscription dans `stripe_events` dans une transaction
  (rejoué → `duplicate`), puis déclaration à ERPlead (`reportSubscription`) et formule recopiée. Stripe en panne :
  502, rien d'inscrit, Stripe renvoie. ERPlead en panne : Pro effectif quand même, `erplead_synced_at` nul, tâche
  `billing_sync` toutes les 10 minutes. Tâche `billing_reconcile` chaque jour : relecture Stripe et redéclaration.
  Paiement échoué : notification aux administrateurs dans ProjectLead (aucun e-mail).
- **Gratuit par défaut** : `accounts.plan` naît `free` ; 008 repasse en Gratuit les entreprises sans
  organisation Lead restées en Pro (27 comptes de contrôle du 01.10, sans paiement).
- **Effacer une entreprise abonnée** est refusé par la base (clé étrangère) : passer d'abord par
  `cancelAccountSubscriptions` (résilie ses seuls abonnements ProjectLead). Aucune route ne supprime d'entreprise.
- **Variables** (Vercel, **Production seulement**, jamais en Preview) : `STRIPE_SECRET_KEY` (clé du compte, comme
  CRMlead ; une clé live est ignorée hors production), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`,
  `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_PROPLUS_MONTHLY`, `STRIPE_PRICE_PROPLUS_YEARLY`,
  `STRIPE_PORTAL_CONFIGURATION`. Sans elles : boutons de paiement masqués, webhook 503.
- **Objets Stripe** : `STRIPE_SECRET_KEY=… node scripts/stripe-setup.mjs --app projectlead --live --portal
  https://projectlead.io/reglages/entreprise --webhook https://projectlead.io/api/stripe/webhook --secret-file
  <fichier 600>` (idempotent ; le secret whsec n'est jamais affiché, il va dans le fichier puis dans Vercel).
  Mode test : mêmes objets créés le 13.10 sur le compte de test (prix `price_1UQ0dA…`, portail `bpc_1UQ0dD…`).
- **Contrôles** : `npm test` (section « Abonnement ProjectLead » : isolation, signature, idempotence, ordre,
  ERPlead et Stripe en panne, concurrence, règle par application) ; parcours réel en mode test :
  `scripts/e2e-abonnement.mjs` (Checkout 4242 en navigateur sans tête, rejeu signé par `scripts/stripe-replay.mjs`,
  portail, résiliation) → `E2E_ABONNEMENT_OK`.
- **Retour arrière** : retirer les variables `STRIPE_PRICE_*` (boutons masqués, webhook 503 ; Stripe réessaie 3
  jours) ou revenir au commit précédent de `vercel` (`f0e7143`, déploiement `dpl_DZaqUqs1TUJPfyGPDra5xPqGnWot`).
  Objets Stripe jamais supprimés : prix et portail en `active=false`, endpoint désactivé. La migration 008 est additive ; l'ancien code ignore ses
  colonnes (seul le défaut `free` et le passage en Gratuit des 27 comptes de contrôle restent).

## Fait le 01.10

- Domaine projectlead.io : répond (`/api/health`), contrôle en ligne et README dessus.
- Connexion réelle par le Compte Lead : crmlead.io renvoie bien vers projectlead.io (essai avec le compte
  eve.gemmet@gmail.com, formule gratuite). Le refus de la formule gratuite qu'on voyait alors est levé le
  02.10 (règle d'Ève : tout compte entre).
- Premier e-mail réel : suivi client envoyé par Resend depuis suivi@invoicelead.io, reçu dans la
  boîte de réception Gmail d'Ève (pas en spam).
- CRMlead : la session CRMlead a préparé l'ocre du carré PL et la migration `114_projectlead_live.sql`
  (projectlead en `live`, `exchange_url` sur projectlead.io, `accepts '{deal}'`) ; publication à
  confirmer sur crmlead.io.

## Ce qui reste, dans l'ordre

0. **Abonnement ProjectLead en ligne** (ordre du chantier « un abonnement par app ») : garde du webhook ScanLead
   en production, ERPlead par application en production, objets Stripe live et variables Production (voir
   « Abonnement ProjectLead »), puis fusion de `abonnement-par-app` dans `vercel` (fetch, rebase, push).
1. **Après Vercel (13.10.2026), ce qu'Ève pourra supprimer quand elle voudra** (rien n'a été effacé) : la
   fonction Neon `projectlead` (aujourd'hui un simple renvoi) et ses deux domaines personnalisés Neon (projectlead.io, www), le jeton
   « cron du VPS » de `task_tokens`, `~/bin/projectlead-cron.sh` et `~/.projectlead-task-secret` du VPS,
   la ligne `GLM_API_KEY` de `server_secrets` (ancien chiffré illisible).
2. **Essai réel en formule gratuite** : Ève (eve.gemmet@gmail.com, Free) doit entrer dans ProjectLead et
   voir « Gratuit : 3 projets en cours ». Ne pas lui offrir de formule : elle veut vérifier le gratuit.
3. **Clés d'Ève** : Ève crée la clé CRMlead
   (https://crmlead.io/integrations) et la clé InvoiceLead (https://invoicelead.io/fr/app/settings/api,
   Pro+) et les colle elle-même dans https://projectlead.io/reglages/integrations (adresses déjà
   remplies). Ni Claude Desktop ni un agent ne saisissent une clé dans un site.
4. **CRMlead en ligne** : carré PL ocre et ProjectLead dans le sélecteur d'applications (migration
   `114_projectlead_live.sql` prête par la session CRMlead, publication avec l'accord d'Ève).
5. **Comptes de contrôle** : 14 comptes « Contrôle … » (`controle-…@exemple.test`) créés en production
   par l'ancien contrôle en ligne, et le projet « Essai d envoi ProjectLead » de l'un d'eux. À effacer
   avec l'accord d'Ève (`delete from accounts where name like 'Contrôle %'`, puis les `users` sans
   entreprise).
6. **Expéditeur** : quand projectlead.io sera vérifié chez Resend, proposer `EMAIL_FROM` sur
   `suivi@projectlead.io` (aujourd'hui `suivi@invoicelead.io`, choix d'Ève). Le compte Resend de la famille
   (erplead.io, crmlead.io, scanlead.io) est plein : « domain limit of your plan » le 13.10.
