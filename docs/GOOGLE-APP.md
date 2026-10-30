# « Continuer avec Google » dans l'app mobile ProjectLead (30.10.2026)

Contrat d'ERPlead (Compte Lead) : `docs/GOOGLE-APP.md` du dépôt ERPlead. Cahier du chantier :
`~/projets/.unlazy/google-app/CAHIER.md` ; portes : `~/projets/.unlazy/google-app/gates/leaf-projectlead.md`.

## Pourquoi

Google refuse sa connexion dans une vue web (« disallowed_useragent »). L'app Android / iOS (coque Capacitor,
`~/projets/projectlead-mobile`) ouvre https://projectlead.io dans une vue web, et la connexion au Compte Lead se fait
dans cette vue web. Jusqu'à la 1.0.1, ERPlead masquait donc Google dans l'app : une personne qui a créé son compte avec
Google sur ordinateur n'avait pas de mot de passe.

Depuis l'app 1.0.2 : la connexion Google s'ouvre dans le **navigateur du téléphone**, puis l'app revient toute seule et
termine la connexion dans sa vue web.

## Ce que fait le site (code web, `src/lib/leadAppAuth.ts`), seulement dans l'app

| Où | Quoi |
|---|---|
| `/lead-auth/google?start=…&back=…` (`src/pages/LeadAuthGoogle.tsx`, page publique) | ERPlead y envoie la vue web après le bouton. `start` doit commencer par `<émetteur>/auth/google/app/start?` et `back` par `<émetteur>/login?`, sinon `/login`. Dans l'app : `back` gardé (sessionStorage), `Browser.open({ url: start })`, écran « Connexion avec Google… » avec « Retour ». Navigateur refermé sans retour (`browserFinished`, 1,5 s de grâce) : `back`. Hors de l'app : `back`. |
| toutes les pages, au démarrage (`src/main.tsx`) | `App.addListener('appUrlOpen')` et `App.getLaunchUrl()`. Seul `io.projectlead.app://lead-auth?…` compte, chaque lien une seule fois (empreintes dans localStorage, les 20 dernières, **sans échéance** : `getLaunchUrl` redonne le même lien à chaque chargement de page tant que l'app vit — iOS : le dernier lien ouvert, jamais effacé par Capacitor). Un lien n'est traité que pendant une **connexion Google en cours** : posée par la page relais (localStorage `pl.leadAuth.pending`, après lecture du lien de lancement), valable 15 min, effacée par le premier lien traité. Sans elle (lien venu d'un courriel, d'une page, d'un code QR, d'une autre app ; ancien lien redonné par `getLaunchUrl`) : rien, et le lien est gardé comme vu. Sinon `Browser.close()` (erreur ignorée), puis un code `^[A-Za-z0-9_-]{43}$` → `location.replace(<émetteur>/auth/google/app/redeem?code=…)` ; sinon (`error=expired`, lien abîmé) → `back` gardé, sinon `/login`. |
| `/api/auth/options` | `leadIssuer` : l'émetteur (LEAD_ID_ISSUER, crmlead.io → erplead.io, sinon https://erplead.io). Un aperçu relié à un aperçu d'ERPlead le voit sans autre réglage. |

Pourquoi la connexion en cours (relecture du 30.10.2026) : avec une mémoire de 24 h, le lien déjà racheté revenait par
`getLaunchUrl` au premier chargement complet de page du lendemain (reconnexion silencieuse, relance de la vue web) et
menait la vue web au rachat d'un code consommé, puis sur « Mon compte » d'ERPlead ; et n'importe quel lien
`io.projectlead.app://lead-auth?…` (courriel, page web) sortait la personne de sa page. Limite connue : un lien forgé qui
arrive PENDANT une connexion en cours (navigateur du téléphone ouvert, moins de 15 min) la fait échouer (« La demande a
expiré ») ; il n'ouvre aucun autre compte.

Sans le pont Capacitor natif (`window.Capacitor.isNativePlatform()`), rien n'est posé : le site web ne change pas. Aucun
paquet Capacitor n'est ajouté au site : les plugins App et Browser du pont injecté par la coque suffisent. Le site ne lit
ni ne garde jamais le verifier (cookie HttpOnly d'erplead.io) et ne parle à aucune API d'ERPlead.

## Ce que déclare l'app (dépôt `~/projets/projectlead-mobile`, 1.0.2, versionCode 3, build iOS 3)

- `appendUserAgent: 'ProjectLeadApp/1.0.2 LeadAppAuth/1'` : `LeadAppAuth/1` fait apparaître le bouton Google chez ERPlead.
  Les versions publiées (1.0.0, 1.0.1) ne l'ont pas : pas de bouton, mais la phrase « Compte créé avec Google ? Touchez
  « Mot de passe oublié ? »… ».
- Schéma `io.projectlead.app` : iOS `CFBundleURLTypes`, Android `intent-filter` VIEW / DEFAULT / BROWSABLE, hôte `lead-auth`.
- Plugins `@capacitor/app` et `@capacitor/browser` ; `allowNavigation` garde erplead.io et Apple.

## Contrôles

- `npx tsx scripts/google-app-check.ts` (faux pont, sans base) → `GOOGLE_APP_WEB_CHECK_OK`.
- `node scripts/google-app-gates.mjs G1` (code web, contre-épreuves, contrôles complets), `G2` (dépôt mobile, AAB signé),
  `APERCU` (aperçu Vercel relié à l'aperçu d'ERPlead), `G3` (Chromium sans tête qui imite la vue web de l'app).
