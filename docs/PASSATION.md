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
- **L'espace** (`attachLeadPerson`, `server/routes/auth.ts`) : celui de son organisation ERPlead
  (`accounts.lead_org = claims.org`), rejoint ou créé à son nom en Gratuit, avec son rôle d'ERPlead (administratrice
  chez ERPlead : administratrice, gestionnaire : gestionnaire, sinon membre ; une simple membre qui ouvre ProjectLead
  la première n'en devient donc pas l'administratrice). Une entreprise d'avant le Compte Lead devient celle de
  l'organisation quand son administratrice l'est aussi chez ERPlead. Plus jamais d'espace personnel ni de détour :
  places prises → `/login?erreur=places` (« Toutes les places ProjectLead de votre entreprise sont prises ») ; accès
  désactivé → `/login?erreur=desactive`. Rien n'est créé dans ces deux cas.
- **L'administratrice d'ERPlead** est administratrice dans l'espace de son organisation (promue à l'arrivée, jamais
  rétrogradée automatiquement). Un espace sans administrateur actif (créé par une membre arrivée avant elle) la laisse
  entrer même sans place libre : sinon personne n'y libère une place ni ne change de formule. S'il a déjà un
  administrateur actif, la règle des places vaut pour elle aussi (décision P11 d'Ève).
- **Organisation sans espace ici, personne déjà active dans une entreprise ProjectLead** (invitée par ProjectLead
  depuis une autre organisation, souvent avec un Compte Lead créé pour accepter ; ou membre d'une entreprise d'avant
  le Compte Lead pas encore reliée) : elle entre dans cette entreprise, comme avant le passage, sans la lier, sans y
  poser sa formule et sans créer d'espace vide. Limite connue (comme avant le passage) : pas de sélecteur d'espace ;
  quand son organisation aura un espace, c'est lui qui s'ouvrira.
- **Désactivée avant le passage** : une personne sortie par ERPlead avant la migration 009 n'a pas le drapeau
  `lead_disabled` (rien ne distingue alors une sortie d'ERPlead d'une désactivation par un administrateur, que le
  journal ne trace pas). Par prudence elle reste traitée comme désactivée : l'écran ne dit pas qui l'a fait et donne
  le remède (un administrateur la réactive, Réglages → Équipe). En production le 14.10.2026 : deux lignes inactives
  en tout, deux personnes du banc (« Arrivée » de TEST Imprimerie Délèze), aucune vraie entreprise.
- **Départ annoncé par ERPlead** (back-channel, `lead_status: disabled`) : `account_users.lead_disabled` (009). Si
  ERPlead la laisse revenir dans la même organisation, elle reprend sa place à la connexion suivante, s'il en reste.
  Un choix de l'administrateur (Réglages → Équipe) remet ce drapeau à faux.
- **Invitation ProjectLead** (`/invitation/<jeton>`) : bouton « Accepter avec mon Compte Lead » →
  `/auth/lead/start?next=/invitation/<jeton>` ; au retour, l'invitation est prise pour la personne connectée si
  l'adresse vérifiée est la même (sinon `?erreur=adresse`), et l'entreprise qui invite s'ouvre. Plus de nouveau mot
  de passe ProjectLead avec le Compte Lead branché (403 `invitation_via_lead`) ; celui d'un accès d'avant reste accepté.
- **Lanceur à 9 points** (`src/components/AppSwitcher.tsx`) : les six applications de `src/lib/leadFamily.ts`
  (copie telle quelle de `~/projets/lead-e2e/lead-family.json`), dans l'ordre ERPlead, ScanLead, CRMlead, ProjectLead,
  InvoiceLead, Greetlead, chacune vers son adresse d'entrée (`https://<app>/login`, ERPlead `/account`), jamais sa
  page publique ; ProjectLead « Vous êtes ici » sans lien ; panneau fixe sous 480 px. Points d'accroche des contrôles :
  `data-lead-launcher`, `data-lead-app`, et `data-lead-org` (organisation ERPlead) sur la racine de l'espace.
- **Contrôles** : `npm test`, sections « Connexion par le Compte Lead », « Départ d'une personne », « Déconnexion
  dans un navigateur », « Clés d'ERPlead » et « Lanceur de la famille Lead ».

**Arrivée et déconnexion (règle commune des six applications Lead, Ève, 13.10.2026).**
- **Arrivée** : session ERPlead ouverte → directement dans l'espace de son entreprise (voir plus haut), dans la langue
  du Compte Lead. ProjectLead n'a pas d'essai silencieux (`prompt=none`) : sa racine est déjà l'application et part
  vers `/auth/lead/start`. Cookies refusés : un seul passage chez ERPlead, puis `/login?erreur=session&next=…` (le
  retour sans cookie de départ), et `/login?erreur=…` ne repart jamais seul (pas de boucle) ; contrôle « cookies
  refusés ». Le cookie de départ (`pl_lead_login`) vit une heure, et la page demandée voyage aussi dans le `state`
  (aléa, puis le chemin en base64url, jusqu'à 512 octets) : même un retour qui a perdu le cookie ramène au lien profond.
  Dans les applications qui ont un essai silencieux, il n'a lieu qu'une fois : cookie `lead_probe` ou marqueur
  `lead_probe=1` dans l'adresse de retour. Côté navigateur, la règle tient dans `src/lib/arrival.ts` (page demandée,
  départ, `/login` avec une session, un seul départ automatique), contrôlée par la section « Arrivée » de
  `npm test`. Un retour d'ERPlead en erreur garde la page demandée (`/login?erreur=lead&next=…`).
- **Se déconnecter** ferme le Compte Lead et les sessions des applications DANS CE NAVIGATEUR seulement : ses autres
  appareils restent connectés (se déconnecter sur l'ordinateur ne coupe pas le téléphone en plein salon). Norme
  OpenID Connect : ERPlead met `sid` (sa session de navigateur) dans le jeton d'identité, la session ProjectLead le
  garde (`sessions.lead_sid`, db/010) ; le `logout_token` « logout » porte ce `sid` et seules ces sessions tombent,
  plus celles ouvertes avant le `sid` (fermées par personne, comme avant). Un jeton sans `sid` ferme tout, comme avant.
  Compatibilité : l'ERPlead en ligne avant le passage n'émet pas de `sid` ; ses jetons ferment donc toutes les
  sessions de la personne (repli sûr, jamais de 500, jamais de session laissée ouverte), de même qu'un `sid` illisible.
  « Se déconnecter » dans ProjectLead ne ferme que la session de ce navigateur, puis ERPlead `/oauth/logout`
  (`id_token_hint`). Pendant que la page attend ERPlead (parfois plusieurs secondes), la page elle-même ne la
  renvoie plus vers la connexion (`src/lib/arrival.ts`) : ni la relecture de /me (toutes les minutes) ni un autre 401
  (`startLeaving`, 15.10.2026 : l'écran de connexion repartait vers ERPlead et coupait sa déconnexion), ni un 2e clic sur
  « Se déconnecter » (`leave`, 20.10.2026 : le 2e POST partait sans cookie, recevait `/login`, et cette navigation
  coupait celle vers ERPlead ; dans les deux cas, la personne rentrait sans formulaire). Un seul POST
  `/api/auth/logout` ; un clic pendant la sortie ne fait rien tant que la réponse n'est pas là, puis relance la même
  adresse de sortie, jamais `/login` (reprend aussi une sortie arrêtée par Échap ou Stop) ; le bouton dit
  « Déconnexion… », désactivé jusqu'à la réponse. Reste hors de ce garde-fou : un rechargement de la page pendant
  l'attente, qui est une nouvelle arrivée (elle repart vers ERPlead, encore ouvert). Contrôles : `npm test` (parcours du
  bouton) ; navigateur, `scripts/e2e-deconnexion.mjs` (manches simple, double, double-tot, echap, relecture, retour ;
  double et echap rouges sur c34a3ca, relecture aussi sur 1804451) et
  `~/projets/lead-e2e/slow-logout-local.mjs --apps pl --delays 3000 --attente 58000`.
- **Départ d'une personne** (`lead_status: disabled`) : TOUTES ses sessions tombent, dans toutes les entreprises, et
  sa place se libère dans l'entreprise annoncée.
- **Clés d'ERPlead** (`server/lib/leadId.ts`, comme ScanLead) : le back-channel et la boîte de réception de l'échange
  sont publics ; un jeton à clé (`kid`) inconnue ne fait relire le JWKS de l'émetteur qu'une fois toutes les 30 s au
  plus, une seule lecture à la fois (plus d'appel à ERPlead par jeton forgé). Une vraie rotation de clé est prise en
  compte dans les 30 s ; un jeton arrivé pendant une relecture en cours l'attend au lieu d'être refusé. Clés absentes
  (démarrage à froid) ou de plus d'une heure : relues elles aussi au plus toutes les 30 s, et une lecture ratée garde
  les clés en mémoire (une panne d'ERPlead ne refuse pas les vrais jetons). Contrôle : section « Clés d'ERPlead » de
  `npm test`.
- **Adresse confirmée** : ERPlead l'exige pour toutes les applications (`require_verified_email`) ; une personne non
  confirmée voit son écran « Confirmez votre adresse », avec le bouton pour renvoyer le lien.
- **Lanceur** (audit indépendant CNX-12, CNX-13) : se ferme par Échap (focus rendu au bouton à 9 points), par un clic
  ou un toucher en dehors et par le choix d'une entrée ; pastilles décoratives (`aria-hidden`), blanc sur la couleur
  de chaque application ≥ 4,5:1 (ProjectLead #9a6a00 : 4,73:1).

**Règle d'Ève (13.10.2026) : chaque application vend son propre abonnement, valable chez elle seule.** La
formule ProjectLead se prend dans ProjectLead (Réglages → Entreprise, voir « Abonnement ProjectLead »
ci-dessous). Un abonnement CRMlead, ScanLead, InvoiceLead ou Greetlead n'ouvre plus rien ici. Transition : un
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

## Suites de l'abonnement (15.10.2026, enregistrées, pas encore en ligne)

Spécification : `~/projets/.unlazy/lead-vercel/billing-followups-design.md` (points 1, 2, 4 et 6a pour ProjectLead) ;
portes : `GATES-billing-followups.md` (L4 en local).

- **Offres (point 1)** : rien ne se vend à une formule égale ou inférieure à la formule acquise (`paidTier` :
  abonnement ProjectLead, ou formule propre lue au Compte Lead ; jamais l'héritage, qui prend fin). Le serveur refuse
  `POST /api/billing/checkout` en 409 `plan_not_above` AVANT tout appel à Stripe (`isAbove`, `server/lib/plans.ts`).
  Une formule propre du Compte Lead qu'aucun abonnement ProjectLead ne donne (`plan.lead`) est dite sous « Votre
  formule » : « Pro+ par votre compte ERPlead, jusqu'au … Cette formule se gère dans ERPlead, pas ici. » Contrat de page
  du banc : `data-plan-current`, `data-plan-acquired`, `data-plan-offer` (`PlanStatus`, `PlanTiers`).
- **Places (point 2)** : Réglages → Équipe liste les places prises (personnes actives et invitations en attente), avec
  la dernière venue (`account_users.last_seen_at`, `db/011_seat_last_seen.sql`, écrite à chaque ouverture de session
  et à l'activité au plus une fois par heure). « Retirer » (administrateur, jamais soi-même, deux temps) :
  `POST /api/team/members/:id/remove`, place libérée, sessions de l'entreprise fermées, retrait gardé (« accès
  désactivé » à la reconnexion, même s'il reste une place) ; « Rétablir » : `POST /api/team/members/:id/restore`
  (402 s'il n'y a plus de place). La place ne se règle que par ces deux routes : `PATCH /api/team/members/:id` refuse
  un changement de `active` (400 `use_remove_restore` ; la même valeur, envoyée par un onglet de la version d'avant,
  passe sans effet). « Retirer », le changement de rôle par PATCH et le départ annoncé par ERPlead passent un par un
  pour une entreprise (verrou `admins:<compte>`, `server/lib/admins.ts`), l'appelant relu administrateur actif : jamais
  zéro administrateur actif, même quand deux administrateurs se retirent l'un l'autre au même instant. Personnes parties du Compte Lead (`lead_disabled`, back-channel « disabled ») : à
  part, sans « Rétablir ». Contrat : `data-seat-list`, `data-seat-holder`, `data-last-seen`, `data-seat-remove`,
  `data-seat-removed`. lt07e (retirée au Compte Lead, encore active en production) sera rattrapée par
  `scripts/resync-departures.mjs` d'ERPlead.
- **Refus « places » (points 4 et 6a)** : `/login?erreur=places&formule=<free|pro|proplus>` (la formule de
  l'entreprise, `refusalLocation`), servi sans session (`src/components/RefusedScreen.tsx`) : « Changer de compte »
  (`/auth/lead/start?switch=1` → prompt=login chez ERPlead), « Retour à mon Compte Lead » (erplead.io/account),
  conseil selon la formule (Pro+ plein : libérer une place, aucune offre ; Gratuit ou Pro : Pro+ et 5 places, « Voir
  les formules » vers la page publique `/formules`). Plus de « Réessayer » qui ramenait au même refus.
- **Langue** : français, comme tout ProjectLead (`docs/FONCTIONNALITES.md`).
- **Contrôles** : `npx tsx scripts/suites-check.ts` (sans base) et `npm test` (section « Suites de l'abonnement »).
- **Mise en ligne** : la migration 011 est additive et rejouable ; l'ancien code ignore `last_seen_at` (retour arrière :
  revenir au commit précédent de `vercel`).

## Assistant IA : tout ce qu'il propose s'applique (27.10.2026, branche `assistant-actions`)

Demande d'Ève (capture du 27.10, projet réel) : l'assistant répondait « Je ne peux pas créer d'étapes moi-même » puis
donnait un plan en texte. Cahier : `~/projets/.unlazy/assistant-actions/CAHIER.md` ; inventaire et règles :
`docs/ASSISTANT-ACTIONS.md` (chaque écriture de l'écran → outil `propose_*` ou interdit nommé).

- Une carte peut porter plusieurs écritures (`server/lib/assistant/token.ts`, jeton v2 : `ops`, `mode`, références
  « @clé ») : `propose_project_plan` (étapes datées, tâches, jalons, dépendances, points de contrôle, dates du projet ;
  dates calculées en jours ouvrés par `server/lib/assistant/schedule.ts`) et `propose_batch` (jusqu'à 150 écritures).
- Exécution (`server/lib/assistant/run.ts`) : les routes mêmes de l'écran, avec la session de la personne, dans UNE
  transaction partagée (`sharedTransaction`, `server/db.ts` : les `withTenant` des routes reprennent la connexion dans un
  SAVEPOINT) ; la première refusée annule tout. Les écritures qui appellent CRMlead, InvoiceLead ou une boîte mail restent
  seules sur leur carte (mode `route`).
- Essai avant la carte : les écritures sont jouées dans une transaction annulée (`dryRun`) ; `sendMail` ne fait rien et
  aucune tâche de fond ne part pendant ce temps. Une proposition qui échouerait n'est jamais montrée.
- Consigne (`server/lib/assistant/prompt.ts`) : plus de « je ne peux pas » pour une action permise ; un plan ou une liste
  de changements = la carte applicable dans la même réponse ; interdits inchangés (supprimer, payer, formule, membres et
  droits, clés et identifiants, envoyer à l'extérieur, fichier).
- `max_tokens` 16 000 (un plan complet en un appel d'outil), délai par appel 170 s, tour entier 250 s (fonction 300 s).
- Après « Confirmer » : la page se recharge, la vue qui montre le résultat s'ouvre (plan : Gantt, liens Étapes, Liste,
  Gantt), la carte dit ce qui a été créé.
- Contrôles : `TEST_DATABASE_URL=… npx tsx scripts/assistant-actions-check.ts` → `ASSISTANT_ACTIONS_CHECK_OK` ; portes
  `node scripts/assistant-actions-gates.mjs G1…G6` ; essai réel `node scripts/e2e-assistant-actions.mjs` (en-tête).
- Aucune migration.

## Assistant IA (bulle, 24.10.2026, branche `assistant-ia`, en production le 24.10)

Cahier commun des six applications : `~/projets/.unlazy/assistant-ia/CAHIER.md` ; critères :
`~/projets/.unlazy/assistant-ia/GATES-projectlead.md`.

- Bulle en bas à droite de toutes les pages connectées (`src/components/Assistant.tsx`, montée par `Layout`), jamais sur
  les pages publiques ; masquée si `ANTHROPIC_API_KEY` manque (`features.assistant` de `/api/me`, route en 503).
- `POST /api/assistant` (`server/routes/assistant.ts`) : Tool Runner du SDK `@anthropic-ai/sdk`, modèle
  `claude-opus-5-5`, effort `low`, `max_tokens` 4000 (16 000 depuis le 27.10), 10 tours au plus, repli des refus
  `fallbacks: "default"`, consigne stable en cache (`server/lib/assistant/prompt.ts`).
- Outils (`server/lib/assistant/tools.ts`) : ils n'ont aucun accès propre à la base, ils rappellent les routes `/api`
  avec la session de la personne (`server/lib/assistant/internal.ts`) : mêmes droits que l'écran. Lecture : recherche,
  accueil, projets, fiche projet, tâches, fiche tâche, équipe (lecture), clients, temps, rapport, charge, agenda,
  `open_page`. Écriture en deux temps (`propose_*`) : tâche (créer, modifier, commenter, point de contrôle), projet
  (créer, modifier, point d'avancement interne), temps (saisie, chronomètre), client (créer). L'outil ne fait rien :
  il signe l'opération (`server/lib/assistant/token.ts`, HMAC d'`APP_SECRET`, personne + entreprise, 10 min, usage
  unique dans `assistant_confirmations`) et la carte « À confirmer » l'envoie à `POST /api/assistant/confirm`, qui
  n'exécute qu'une liste fermée d'écritures (jamais une suppression, l'équipe, les membres, l'abonnement, les clés, un
  envoi).
- Quota : 40 messages/h par personne, 400/24 h par entreprise (`assistant_usage`, migration 030 ; réglables par
  `ASSISTANT_USER_PER_HOUR` / `ASSISTANT_ACCOUNT_PER_DAY`). Rien de la conversation en base : le fil vit dans
  `sessionStorage` de l'onglet ; on journalise jetons, outils, erreurs.
- Contrôles : `TEST_DATABASE_URL=… npx tsx scripts/assistant-check.ts` → `ASSISTANT_CHECK_OK` (faux service de modèle
  local). Essai réel sur un aperçu Vercel : `node scripts/e2e-assistant.mjs` → `E2E_ASSISTANT_OK` (en-tête du fichier).
- Aperçu : base = branche Neon `assistant-ia-apercu` (copie de la production du 24.10), variables passées au
  déploiement (`--env DATABASE_URL APP_SECRET JOBS_DISABLED=1`), déployé depuis une copie sans `.git` (un déploiement
  CLI depuis le dépôt est bloqué par Vercel : auteur du commit). La migration 030 s'applique en production au build.
- Fusion IA (lots GLM/Z.ai de `claude/suite-0210`, validés le 21.10, pas encore en production) : aucun fichier commun ;
  tables et migration distinctes (`ai_usage` reste à la fusion).

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
3. **Liaison sans clé (26.10.2026, branche `liens-sans-cle`)** : plus aucune clé à coller. CRMlead et InvoiceLead
   se relient d'eux-mêmes quand l'entreprise les utilise avec le même Compte Lead (Réglages → Applications Lead,
   `docs/INTEGRATIONS.md`). Mise en ligne : après ERPlead (jetons d'échange liés à l'org) ; poser `LEAD_PROOF_KEY`
   (32 signes au moins) sur Vercel avant ; migration `db/012_liens_sans_cle.sql` (efface les jetons d'identité gardés en
   clair : une reconnexion silencieuse suit) ; puis `EXCHANGE_ORG_SENDERS=crmlead` quand CRMlead envoie avec l'org.
   Étape 5b : `db/etape-5b/013_drop_link_keys.sql` (hors des migrations automatiques), après 7 jours verts et un
   instantané Neon.
4. **CRMlead en ligne** : carré PL ocre et ProjectLead dans le sélecteur d'applications (migration
   `114_projectlead_live.sql` prête par la session CRMlead, publication avec l'accord d'Ève).
5. **Comptes de contrôle** : 14 comptes « Contrôle … » (`controle-…@exemple.test`) créés en production
   par l'ancien contrôle en ligne, et le projet « Essai d envoi ProjectLead » de l'un d'eux. À effacer
   avec l'accord d'Ève (`delete from accounts where name like 'Contrôle %'`, puis les `users` sans
   entreprise).
6. **Expéditeur** : quand projectlead.io sera vérifié chez Resend, proposer `EMAIL_FROM` sur
   `suivi@projectlead.io` (aujourd'hui `suivi@invoicelead.io`, choix d'Ève). Le compte Resend de la famille
   (erplead.io, crmlead.io, scanlead.io) est plein : « domain limit of your plan » le 13.10.
