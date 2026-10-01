# Passation ProjectLead (01.10.2026)

À lire en premier par la session qui reprend. Ensuite : `CLAUDE.md`, `docs/PLAN.md`, `README.md`.

## Avec Ève

Ève ne veut ni jargon ni bla-bla : des phrases courtes et simples. Tout ce qu'on peut faire soi-même,
on le fait. On ne lui renvoie que le geste vraiment impossible (connexion à un de ses comptes, code
2FA, clé à créer), en une ligne claire. On ne s'arrête pas en cours de route, et on ne dit « fait »
que contrôles verts et vérifiés en ligne.

Les fenêtres d'autorisation l'exaspèrent. Chaque action Neon (et toute action MCP) en ouvre une dans
cette application ; le mode « bypass » n'y est pas proposé, et `.claude/settings.json` n'a pas suffi
dans la session précédente (fichier créé en cours de session). Grouper les actions Neon en une seule,
et ne jamais promettre qu'il n'y aura plus de fenêtre. GitHub passe sans fenêtre par `curl` et
`$GH_TOKEN` (API REST), y compris pour ouvrir une PR ou relancer un contrôle.

Les gestes sur Porkbun, Resend et crmlead.io passent par Cowork (Claude Desktop), sur l'ordinateur
d'Ève. Lui donner un prompt complet à copier, comme dans `docs/DESKTOP.md`.

## Où en est le produit

- Code : `Casav290/ProjectLead`. PR #1 fusionnée. PR #2 (brouillon) ouverte sur la branche
  `claude/gracious-goldberg-in79y0` : Resend, import des contacts InvoiceLead, connexion à entrée
  unique, contrôle en ligne. À faire passer au vert et fusionner.
- Contrôles locaux : `npm run typecheck`, `npm test` (130 verts, sur `TEST_DATABASE_URL`), `npm run build`.
- Contrôle en ligne : `.github/workflows/verifier-en-ligne.yml` (à chaque envoi, chaque matin, et à
  la demande). Il parcourt le site réel dans un navigateur et écrit ce qu'il voit en annotations,
  lisibles par l'API GitHub (`check-runs/<id>/annotations`). Dernier correctif (écran de connexion à
  entrée unique) poussé le 01.10 : vérifier qu'il repasse au vert.

## Hébergement

- Neon, projet `gentle-frog-61717092`, branche `br-broad-dream-b4d44vqe` (production), base
  `projectlead`, région `aws-us-east-2`.
- Fonction Neon `projectlead` (déploiement 6 au 01.10). Adresse provisoire :
  https://br-broad-dream-b4d44vqe-projectlead.compute.c-6.us-east-2.aws.neon.tech
- La fonction est un amorçage (`deploy/neon/boot.mjs`) qui charge `deploy/neon/index.mjs` depuis
  GitHub à un commit fixé et vérifie son empreinte. Publier :
  1. `node scripts/neon-build.mjs`, commit, push ;
  2. mettre ce commit et `sha256sum deploy/neon/index.mjs` dans `boot.mjs`, commit, push ;
  3. zipper `boot.mjs` sous le nom `index.mjs`, puis `deploy_function` avec **le zip seul** :
     sans `environment`, la fonction garde ses variables.
- Variables de la fonction (valeurs dans Neon, jamais dans le dépôt) : `PL_DATABASE_URL`,
  `APP_SECRET`, `TASKS_SECRET`, `PUBLIC_URL` (`https://projectlead.io`), `EMAIL_FROM`
  (`ProjectLead <suivi@invoicelead.io>`), `RESEND_API_KEY`, `LEAD_ID_ISSUER` (`https://crmlead.io`),
  `LEAD_ID_CLIENT_ID` et `LEAD_ID_APP` (`projectlead`), `LEAD_ID_CLIENT_SECRET`,
  `LEAD_ID_REDIRECT_URI` (`https://projectlead.io/auth/lead/callback`).
  Attention : `deploy_function` avec `environment` remplace **tout** l'environnement, et Neon ne rend
  que les noms des variables, pas leurs valeurs. Ne passer `environment` que si l'on a toutes les
  valeurs ; sinon demander à Ève de redonner les clés.
- Le conteneur des sessions cloud n'atteint pas `*.neon.tech`, Porkbun ni Resend : vérifier le site
  par le contrôle GitHub, pas par `curl`.

## Ce qui reste, dans l'ordre

1. **Domaine** : Cowork branche projectlead.io (domaine personnalisé Neon + ALIAS et CNAME `www` chez
   Porkbun, `docs/DESKTOP.md`). Vérifier `https://projectlead.io/api/health`, puis mettre l'adresse
   du contrôle en ligne et du README sur projectlead.io.
2. **Connexion Compte Lead** : essai réel de bout en bout une fois le domaine branché. N'importe quel
   Compte Lead entre ; l'entreprise Lead devient l'espace ProjectLead. L'accès suit la formule de la
   famille (CRMlead `lead_plans`) : Pro ou Pro+ (payé dans n'importe quelle application, Scanlead
   compris) ouvre ProjectLead ; la formule gratuite le ferme.
3. **Emails** : un premier envoi réel (suivi client) et vérifier qu'il arrive. Quand projectlead.io
   est vérifié chez Resend, proposer de passer `EMAIL_FROM` sur `suivi@projectlead.io`.
4. **CRMlead** : `lead_apps` porte encore `projectlead` en `soon`, sans `url` ni `exchange_url`. Il faut
   une migration dans `Casav290/crmlead` : `status = 'live'`, `url = 'https://projectlead.io'`,
   `exchange_url = 'https://projectlead.io/api/lead-exchange/v1/inbox'`, `accepts = '{deal}'`. Sans
   elle, les affaires gagnées n'arrivent pas et ProjectLead n'apparaît pas dans le sélecteur
   d'applications.
5. **Clés d'Ève** dans ProjectLead, Réglages → Intégrations : clé InvoiceLead (`il_live_…`, créée
   dans InvoiceLead → Réglages → API) et clé CRMlead (`crm_…`). Ensuite, essai : un client repris de
   CRMlead, un contact repris d'InvoiceLead, un brouillon de facture du mois dans InvoiceLead.

## Prompt pour la nouvelle session

> Reprends ProjectLead (`Casav290/ProjectLead`). Lis d'abord `docs/PASSATION.md`, puis `CLAUDE.md`
> et `docs/PLAN.md`. Fais passer la PR #2 au vert et termine la liste « Ce qui reste » dans l'ordre.
> Fais tout toi-même ; ne me demande que les gestes impossibles pour toi, en une ligne simple.
