# « Continuer avec Google » dans l'app mobile ProjectLead (30.10.2026, révisé : liens vérifiés)

Contrat d'ERPlead (Compte Lead) : `docs/GOOGLE-APP.md` du dépôt ERPlead (révision « Liens vérifiés », choix d'Ève). Cahier
du chantier : `~/projets/.unlazy/google-app/CAHIER.md` ; portes : `~/projets/.unlazy/google-app/gates/leaf-projectlead.md`.

## Pourquoi

Google refuse sa connexion dans une vue web (« disallowed_useragent »). L'app Android / iOS (coque Capacitor,
`~/projets/projectlead-mobile`) ouvre https://projectlead.io dans une vue web, et la connexion au Compte Lead se fait
dans cette vue web. Jusqu'à la 1.0.1, ERPlead masquait donc Google dans l'app : une personne qui a créé son compte avec
Google sur ordinateur n'avait pas de mot de passe.

Depuis l'app 1.0.2 (`LeadAppAuth/2`) : la connexion Google s'ouvre dans le **navigateur sûr du téléphone**, puis l'app
reprend la main par un **lien HTTPS réservé à l'app par Apple et Google**, `https://projectlead.io/lead-auth/return`
(Universal Link, App Link vérifié, retour https d'ASWebAuthenticationSession), et termine la connexion dans sa vue web.
Plus aucun schéma propre `io.projectlead.app://` : une autre app du téléphone pouvait le déclarer (RFC 8252 § 8.6).

## Ce que fait le site, seulement dans l'app (`src/lib/leadAppAuth.ts`)

| Où | Quoi |
|---|---|
| `/lead-auth/google?start=…&back=…` (`src/pages/LeadAuthGoogle.tsx`, page publique) | ERPlead y envoie la vue web après le bouton. `start` doit commencer par `<émetteur>/auth/google/app/start?` (sans `m`) et `back` par `<émetteur>/login?`, sinon `/login`. Une connexion notée avant est effacée, le lien de lancement lu (jamais suivi ici), `back` gardé (sessionStorage), connexion en cours notée (localStorage, 15 min). Puis : **iOS 17.4+** (module natif `LeadAuthSession`, `isAvailable().https`) `start({ url: start&m=auto })` : ASWebAuthenticationSession, l'adresse rendue passe par le traitement du lien ; annulée → `back` ; autre refus → Safari. **iOS 15 à 17.3** : `openExternal({ url: start&m=tap })` (Safari), texte « Terminez la connexion dans Safari, puis touchez « Ouvrir ProjectLead » ». **Android** : `Browser.open({ url: start&m=auto })` (Custom Tab) ; refermé sans retour (`browserFinished`, 1,5 s de grâce) → connexion effacée, `back`. Hors de l'app ou coque sans le module : `back`. |
| toutes les pages, au démarrage (`src/main.tsx`) | `App.addListener('appUrlOpen')` et `App.getLaunchUrl()`. Seul `https://projectlead.io/lead-auth/return?…` compte (origine de production **écrite dans le code**, jamais lue du serveur ; un aperçu ne le reçoit donc jamais). Chaque lien une seule fois (empreintes dans localStorage, les 20 dernières, sans échéance), **seulement pendant une connexion en cours** (posée par la page relais, effacée par le premier lien traité) ; le lien d'erreur (`error=expired`), toujours le même, n'est jamais gardé comme vu. Android : `Browser.close()` (erreur ignorée). Code `^[A-Za-z0-9_-]{43}$` → `location.replace(<émetteur>/auth/google/app/redeem?code=…)` ; sinon `back` gardé, sinon `/login`. |
| `/lead-auth/return` (`lead-auth-return.html`, `src/leadAuthReturn.ts`) | La page de repli quand l'app ne s'est pas ouverte (app pas à jour, domaine pas encore vérifié). Servie telle quelle : 200, aucune redirection, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` (`scripts/vercel-build.mjs` ; `server/index.ts` en local). HTML minimal, aucune ressource tierce (ni police de Google), aucun lien ni bouton. Hors de l'app, le premier script efface le code de l'adresse et de l'historique ; puis « Revenez dans ProjectLead » et quoi faire, dans la langue de `locale` (sinon du navigateur), cinq langues (`src/i18n/locales/<l>/leadauth.json`), « Ouvrir par défaut » sous Android. Chargée dans la vue web de l'app : son adresse passe par le même traitement que les liens ; ignorée → l'accueil. |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` (`server/routes/appLinks.ts`) | Fichiers d'association, contenu exact du contrat (§ 3d) : `applinks` (`X6K5247J6G.io.projectlead.app`, composant `/lead-auth/return` seulement) et `webcredentials` (exigé par la session iOS) ; `assetlinks.json` avec l'empreinte Play App Signing et celle de la clé d'envoi. 200, `Content-Type: application/json`, aucune redirection, pour tout agent (fonction Vercel). |
| `/api/auth/options` | `leadIssuer` : l'émetteur (LEAD_ID_ISSUER, crmlead.io → erplead.io, sinon https://erplead.io). Un aperçu relié à un aperçu d'ERPlead le voit sans autre réglage. |

Pourquoi la connexion en cours et la mémoire des liens (relecture du 30.10.2026) : `getLaunchUrl` redonne le dernier lien
tant que l'app vit (iOS : jamais effacé par Capacitor) ; sans elles, un lien déjà racheté revenait au chargement de page
du lendemain, et un lien venu d'ailleurs (courriel, page web) sortait la personne de sa page. Limite connue : un lien forgé
qui arrive PENDANT une connexion en cours la fait échouer (« La demande a expiré ») ; il n'ouvre aucun autre compte (le
rachat exige le cookie verifier de cette vue web).

Sans le pont Capacitor natif (`window.Capacitor.isNativePlatform()`), rien n'est posé : le site web ne change pas. Aucun
paquet Capacitor n'est ajouté au site : les plugins App, Browser et le module LeadAuthSession du pont injecté par la coque
suffisent. Le site ne lit ni ne garde jamais le verifier (cookie HttpOnly d'erplead.io) et ne parle à aucune API d'ERPlead.

## Ce que déclare l'app (dépôt `~/projets/projectlead-mobile`, 1.0.2, versionCode 3, build iOS 3)

- `appendUserAgent: 'ProjectLeadApp/1.0.2 LeadAppAuth/2'` : le bouton Google chez ERPlead. Les versions publiées (1.0.0,
  1.0.1) et la 1.0.2 du schéma propre (`LeadAppAuth/1`, jamais envoyée) ont la phrase « Compte créé avec Google ? Touchez
  « Mot de passe oublié ? »… ».
- iOS : `ios/App/App/App.entitlements` (`applinks:projectlead.io`, `webcredentials:projectlead.io`, `CODE_SIGN_ENTITLEMENTS`) ;
  module `LeadAuthSession` (`ios/App/App/LeadAuthSession.swift`, retour `.https(host: "projectlead.io", path:
  "/lead-auth/return")` écrit dans le Swift), enregistré par `LeadBridgeViewController` ; plus de `CFBundleURLTypes`.
- Android : intent-filter `android:autoVerify="true"` VIEW / DEFAULT / BROWSABLE, `https://projectlead.io/lead-auth/return`,
  seul hôte du manifeste ; plus de schéma `io.projectlead.app`.
- Plugins `@capacitor/app` et `@capacitor/browser` ; `allowNavigation` garde erplead.io et Apple.

## À faire hors du code (comptes : par Ève ou sur son accord)

Apple : accepter le Program License Agreement ; capacité Associated Domains sur `io.projectlead.app` ; profil App Store
« ProjectLead App Store » régénéré ; Codemagic : `projectlead_ios_appstore` remplacé. Google : rien (Play App Signing déjà
dans `assetlinks.json`). Après la mise en production du site : vérifier
`https://app-site-association.cdn-apple.com/a/v1/projectlead.io` et
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://projectlead.io&relation=delegate_permission/common.handle_all_urls`.
Le site part en production avant les versions des apps (sinon l'association n'existe pas quand l'app s'installe).

## Contrôles

- `npx tsx scripts/google-app-check.ts` (faux pont iOS et Android, sans base) → `GOOGLE_APP_WEB_CHECK_OK`.
- `node scripts/google-app-gates.mjs G1` (code web, contre-épreuves, contrôles complets, construction Vercel locale), `G2`
  (dépôt mobile, AAB signé), `APERCU` (aperçu Vercel relié à l'aperçu d'ERPlead), `G3` (Chromium sans tête qui imite la vue
  web de l'app iOS 17.4+, iOS 16 et Android ; vrai retour « annulé » de Google ; page de retour et fichiers d'association de
  l'aperçu).
