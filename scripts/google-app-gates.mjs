#!/usr/bin/env node
// Portes du chantier « Continuer avec Google dans les apps mobiles », partie ProjectLead (30.10.2026, révisé : liens
// vérifiés). Ledger ~/projets/.unlazy/google-app/gates/leaf-projectlead.md, cahier ~/projets/.unlazy/google-app/CAHIER.md,
// contrat d'ERPlead ~/projets/erplead-google-app/docs/GOOGLE-APP.md. À lancer à la racine du worktree
// (~/projets/projectlead-google-app) :
//
//   node scripts/google-app-gates.mjs G1      code web de l'app : scripts/google-app-check.ts (faux pont Capacitor : lien
//                                             vérifié https://projectlead.io/lead-auth/return, session iOS, Safari, Custom
//                                             Tab), chaque contrôle exigé par son titre ; contre-épreuves (le code faussé
//                                             dans une COPIE, l'essai gardien doit échouer) ; contrôles complets de l'app
//                                             (langues, types, smoke, assistant, suites, construction Vercel locale : routes
//                                             et page de retour, paquet) ; périmètre (fichiers touchés, aucune migration)
//   node scripts/google-app-gates.mjs G2      dépôt mobile ~/projets/projectlead-mobile (branche google-app) : droits iOS
//                                             (Associated Domains), module LeadAuthSession, App Link Android autoVerify,
//                                             plus de schéma propre, agent LeadAppAuth/2, versions, `cap sync` sans écart,
//                                             AAB signé construit ici et lu par bundletool, rien poussé ni soumis
//   node scripts/google-app-gates.mjs APERCU  aperçu Vercel de ProjectLead (jamais --prod) depuis HEAD, relié à l'aperçu
//                                             d'ERPlead (variables passées au déploiement seulement), noté dans
//                                             captures/projectlead/apercu.json
//   node scripts/google-app-gates.mjs G3      aperçus, Chromium sans tête qui imite la vue web de l'app 1.0.2 (agent
//                                             LeadAppAuth/2, faux pont Capacitor iOS ou Android) : connexion de ProjectLead →
//                                             écran d'ERPlead avec Google → page relais → session iOS / Safari / Custom Tab
//                                             (départ m=auto ou m=tap) → accounts.google.com ; vrai retour « annulé » de
//                                             Google (routage réel d'ERPlead selon m) ; code préparé dans la base d'APERÇU
//                                             d'ERPlead → lien vérifié rendu à l'app → rachat dans la vue web → retour OpenID
//                                             de ProjectLead → échange du code comme le serveur de ProjectLead → la personne
//                                             TEST ; une seule fois ; liens étrangers et schéma propre ignorés ; page
//                                             /lead-auth/return et fichiers .well-known de l'aperçu ; anciennes versions et
//                                             web inchangés ; app relancée par son lien sur l'accueil (aucun départ seul
//                                             pendant le rachat) ; page relais rechargée (Safari jamais rouvert) ; base
//                                             d'aperçu remise comme avant
//   node scripts/google-app-gates.mjs G4      le VRAI binaire Android 1.0.2 (AAB de G2, re-signé avec une clé d'essai) sur
//                                             un émulateur (AVD pixel36, port 5588, lecture seule) : vrai Custom Tab de
//                                             Chrome, vraie WebView, relais local vers les aperçus ; compte touché, page de
//                                             Google qui avance seule, vrai retour « annulé » d'ERPlead (303 → App Link),
//                                             app tuée pendant le Custom Tab (5 s et 35 s après le bouton), contre-épreuve
//                                             sans App Link (page de repli) ; base d'aperçu remise comme avant
//
// Chaque porte vérifie vraiment et n'imprime son jeton GOOGLE_APP_Gx_OK qu'à la toute fin, si aucun contrôle n'a échoué.
// Aucun secret affiché (adresses de base, jetons, codes, cookies masqués). Fichiers lus (hors dépôt, 600) :
// ~/.projectlead-actions-apercu.env (base de l'aperçu ProjectLead), ~/projets/.unlazy/assistant-ia/projectlead-bypass.secret,
// ~/.erplead-apercu.env (base d'APERÇU d'ERPlead : écriture pour G3 seulement, autour d'une personne TEST du banc ; secret
// du client projectlead de l'aperçu), ~/.erplead-bypass, ~/.android-signing/projectlead-upload.env, ~/projets/lead-e2e/state.json.
// Jamais une base de production, jamais un déploiement de production, jamais un envoi aux stores.
import { createRequire } from 'node:module'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, createPublicKey, randomBytes, verify as verifySig } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync,
  symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = homedir()
const COMMON = `${HOME}/projets/.unlazy/google-app`
const CAPTURES = `${COMMON}/captures/projectlead`
const MOBILE = `${HOME}/projets/projectlead-mobile`
const PUBLICATIONS = `${HOME}/projets/publications/projectlead/android`
const CONTRACT = `${HOME}/projets/erplead-google-app/docs/GOOGLE-APP.md`
const VERCEL_TEAM = 'team_mRhlABdvm1jvEPoDzuDDgpon'
const PL_PROJECT = 'prj_RZassmsoXK1Q7DuHZQAEsOh06kif'
const ERP_PROJECT = 'prj_ZIWBlmDtMeoPupyeG103XenXAXdV'
const PL_PROD_DB = /ep-billowing-moon/ // base de production de ProjectLead : jamais utilisée ici
const ERP_APERCU_DB_HOST = 'ep-summer-pine-b95lk4iy' // projet Neon royal-firefly-84980603 (aperçu d'ERPlead, données TEST)
const ERP_PROD_DB_HOST = 'ep-noisy-rain-b1beeeks'
const BRANCH = 'google-app'
/**
 * La production de ProjectLead fusionnée dans la branche (dpl_Agowv1opRumzob4QZiiiyNZqYsNa, branche vercel, = tête de
 * ~/projets/projectlead-ia-limites ; lue par l'API Vercel le 30.10.2026). Avant : c077f19 (dpl_FATFMB9coBL2P7ZrWpHdgUsUYZNy).
 */
// Production au 03.11.2026 : 560519e (branche vercel, icônes ; contient 38053b3 = ia-limites).
const PROD_BASE = '560519e022851d710b99c62428704f75a819a89d'
/** Le dépôt mobile : la version publiée (Play 1.0.1, versionCode 2 ; TestFlight 1.0.1 (2)) et la branche des constructions iOS. */
const MOBILE_BASE = '310966e'
const PUBLISHED_VERSION_CODE = 2
/** Les fichiers servis par un déploiement : le code d'un aperçu doit être celui de HEAD. */
const APP_PATHS = ['src', 'server', 'public', 'index.html', 'lead-auth-return.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json',
  'vercel.json', 'scripts/vercel-build.mjs', 'tailwind.config.js', 'postcss.config.js', 'db', 'trait-net']
/** Ce que le chantier a le droit de toucher depuis la production (tout autre fichier = débordement). */
const ALLOWED = [/^src\/lib\/leadAppAuth\.ts$/, /^src\/pages\/LeadAuthGoogle\.tsx$/, /^src\/App\.tsx$/, /^src\/main\.tsx$/, /^src\/leadAuthReturn\.ts$/,
  // Relecture du 30.10.2026 (2e) : l'écran de connexion ne part plus seul pendant un retour de Google dans l'app.
  /^src\/pages\/Login\.tsx$/, /^src\/lib\/arrival\.ts$/,
  /^lead-auth-return\.html$/, /^vite\.config\.ts$/, /^server\/routes\/(auth|appLinks)\.ts$/, /^server\/index\.ts$/,
  /^src\/i18n\/locales\/(fr|de|en|it|es)\/(shell|leadauth)\.json$/, /^scripts\/(smoke\.ts|google-app-check\.ts|google-app-gates\.mjs|vercel-build\.mjs)$/,
  /^docs\/(GOOGLE-APP|PASSATION)\.md$/]
/** L'entreprise TEST du banc lead-e2e (lt06) dont une personne sert au rachat de G3 (l'aperçu d'ERPlead utilise lt05). */
const ORG_INDEX = 5
/** Le lien vérifié de l'app (production, écrit dans le code) et ce que l'app déclare. */
const RETURN = 'https://projectlead.io/lead-auth/return'
const AGENT = 'ProjectLeadApp/1.0.2 LeadAppAuth/2'
const IOS_APP_ID = 'X6K5247J6G.io.projectlead.app'

// ------------------------------------------------------------------ sortie

let failures = 0
const mask = (s) => String(s ?? '')
  .replace(/postgres(ql)?:\/\/[^\s'"]+/g, '<adresse>').replace(/lid_[\w-]+/g, '<secret>')
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jeton>').replace(/x-vercel-protection-bypass=[\w-]+/g, 'x-vercel-protection-bypass=<…>')
  .replace(/([?&](?:code|d|state|nonce|code_challenge)=)[\w.%-]{12,}/g, '$1<…>').replace(/test\+[\w-]+@scanlead\.io/g, 'test+…@scanlead.io')
function check(label, cond, detail) {
  if (cond) console.log(`ok  ${label}`)
  else { failures++; console.log(`NON ${label}${detail === undefined ? '' : ` — ${mask(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}`}`) }
  return !!cond
}
function finish(gate) {
  if (failures) { console.log(`${gate} : ${failures} contrôle(s) en échec`); process.exit(1) }
  console.log(`GOOGLE_APP_${gate}_OK`)
}
const note = (s) => console.log(`    ${mask(s)}`)

// ------------------------------------------------------------------ petits outils

const readEnv = (file) => Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...opts,
  env: { ...process.env, ...(opts.env ?? {}) } })
const lastLine = (s) => String(s ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
const tmp = mkdtempSync(join(tmpdir(), 'pl-google-app-'))
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch {} })
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 20_000, step = 150) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await sleep(step) }
  return !!(await fn())
}
const shellTexts = (l) => JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${l}/shell.json`), 'utf8'))
const returnTexts = (l) => JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${l}/leadauth.json`), 'utf8'))
const LOCALES = ['fr', 'de', 'en', 'it', 'es']
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Les fichiers d'association attendus, tirés du contrat d'ERPlead (§ 1 : App ID ; § 3d : exemple AASA et empreintes). */
function contractAssociation() {
  const contract = readFileSync(CONTRACT, 'utf8')
  const example = contract.match(/AASA \(exemple CRMlead[^\n]*\n```json\n([\s\S]+?)\n```/)?.[1]
  const appId = contract.match(/\| ProjectLead \| `projectlead` \| `https:\/\/projectlead\.io\/lead-auth\/return` \| `([^`]+)` \| `io\.projectlead\.app` \|/)?.[1]
  const fp = contract.match(/\| projectlead\.io \| io\.projectlead\.app \| `([0-9A-F:]{95})` \| `([0-9A-F:]{95})` \|/)
  if (!example || !appId || !fp) return null
  return {
    appId, playSigning: fp[1], upload: fp[2],
    aasa: JSON.parse(example.split('X6K5247J6G.io.crmlead.app').join(appId)),
    links: [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'io.projectlead.app',
      sha256_cert_fingerprints: [fp[1], fp[2]] } }],
  }
}

/** La base locale des essais (TEST_DATABASE_URL), créée pour ce chantier (hors dépôt, 600) : localhost seulement. */
function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL ?? readFileSync(`${COMMON}/projectlead-testdb.url`, 'utf8').trim()
  if (!/@localhost(:\d+)?\/projectlead_test_google_app$/.test(url)) throw new Error('la base de test doit être locale (localhost/projectlead_test_google_app)')
  return url
}

// ------------------------------------------------------------------ G1 : code web de l'app

/** Ce que G1 exige de voir vert dans scripts/google-app-check.ts (début du titre). */
const G1_REQUIRED = [
  ['lien de production écrit dans le code', 'le lien de retour attendu est celui de la production, écrit dans le code : https://projectlead.io/lead-auth/return?'],
  ['lien vérifié exact → Browser.close (Android) puis rachat, une navigation', 'lien vérifié exact (https://projectlead.io/lead-auth/return, code de 43 caractères, langue) sous Android : Browser.close, puis la vue web au rachat'],
  ['iOS : rachat sans Browser.close', 'le même lien sous iOS (Universal Link, après Safari) : rachat, aucun Browser.close'],
  ['une seule fois (appUrlOpen ×2 + getLaunchUrl)', 'le même lien par appUrlOpen (deux fois) et par getLaunchUrl : une seule navigation, une seule fermeture'],
  ['une seule fois (page rechargée)', 'page rechargée (nouvelle instance, même localStorage) : le lien de lancement déjà traité est ignoré'],
  ['une connexion par page relais', 'une seule connexion par page relais : après le retour, un autre lien (autre code, sans nouvelle page relais) est ignoré'],
  ['nouvelle page relais → nouveau lien traité', 'nouvelle connexion Google (nouvelle page relais) : son lien est traité, une fois'],
  ['jamais rejoué 24 h ou 7 jours plus tard', '24 h et 7 jours plus tard (app restée en mémoire, getLaunchUrl redonne le lien de lundi) : jamais rejoué'],
  ['le lendemain : ancien lien ignoré, nouveau racheté', 'le lendemain, nouvelle connexion Google (page relais) : le lien de lundi que getLaunchUrl redonne pendant la connexion en cours'],
  ['page relais : connexion notée effacée avant le lien de lancement', 'page relais : une connexion notée avant est effacée AVANT de lire le lien de lancement'],
  ['sans connexion en cours : lien venu d’ailleurs ignoré', 'aucune connexion Google en cours (aucune page relais) : un lien de retour venu d’ailleurs'],
  ['lien ignoré jamais repris ensuite', '… et une connexion Google suivante ne le reprend pas'],
  ['lien d’erreur jamais gardé comme vu', 'lien d’erreur (error=expired) jamais gardé comme vu'],
  ['lien de lancement lu avant l’attente', 'page relais : le lien que la coque redonne au chargement (lent à venir) est lu avant de poser l’attente'],
  ['connexion en cours échue après 15 min', 'connexion en cours échue (page relais il y a 16 min'],
  ['empreintes seulement', 'le stockage ne garde que des empreintes (jamais le code)'],
  ['liens étrangers et schéma propre ignorés', 'liens étrangers ignorés (26 : schéma propre io.projectlead.app'],
  ['lien mal formé : jamais de rachat', 'lien mal formé ('],
  ['demande échue → back', 'demande échue (error=expired) : l’écran de connexion de l’app gardé par la page relais (back)'],
  ['demande échue sans back → /login', 'error=expired sans back gardé (app relancée par le lien) : la connexion normale de l’app (/login)'],
  ['back hors émetteur refusé', 'back gardé mais hors de l’émetteur (stockage modifié) : /login, jamais ce back'],
  ['Browser.close en erreur ignoré', 'Browser.close en erreur (Android, rien à fermer) ou plugin absent : le rachat a lieu quand même'],
  ['émetteur du serveur', 'émetteur donné par le serveur (aperçu) : le rachat va chez lui'],
  ['Android : Custom Tab m=auto', 'Android : back gardé (sessionStorage), Browser.open({ url: start&m=auto }) une fois (Custom Tab)'],
  ['page relais : double rendu', 'relais demandé deux fois dans la même page (double rendu de React) : un seul Browser.open'],
  ['Android : navigateur refermé sans retour → back, connexion effacée', '… puis la vue web revient à l’écran de connexion de l’app (back), et la connexion en cours est effacée'],
  ['page de retour : Android, Chrome par défaut (Samsung Internet…)', 'page de retour : sous Android, Chrome comme navigateur par défaut si ce n’est pas lui'],
  ['navigateur refermé après le retour → rachat seul', 'navigateur refermé APRÈS le lien de retour (Browser.close) : seulement le rachat, jamais back'],
  ['iOS 17.4+ : session m=auto', 'iOS 17.4+ : LeadAuthSession.start({ url: start&m=auto }) une fois'],
  ['iOS 17.4+ : adresse rendue → rachat une fois', 'iOS 17.4+ : adresse rendue par la session → rachat avec le code, une seule navigation'],
  ['iOS 17.4+ : lien d’erreur rendu → back', 'iOS 17.4+ : session revenue avec le lien d’erreur (départ échu) → back'],
  ['iOS 17.4+ : annulée → back, jamais Safari', 'iOS 17.4+ : session annulée (canceled) → back, jamais Safari'],
  ['iOS 17.4+ : Universal Link pendant la session → un seul rachat', 'iOS 17.4+ : lien reçu par appUrlOpen pendant la session'],
  ['iOS 17.4+ : autre refus → Safari m=tap', 'iOS 17.4+ : autre refus de la session (failed : domaine pas encore associé'],
  ['iOS 17.4+ : autre adresse rendue → back', 'iOS 17.4+ : session revenue sur une autre adresse'],
  ['iOS 15 à 17.3 : Safari m=tap', 'iOS 15 à 17.3 (isAvailable → https: false, ou en erreur) : Safari (openExternal({ url: start&m=tap })) une fois'],
  ['iOS : Safari pas ouvert → back', 'iOS : Safari ne s’ouvre pas (openExternal en erreur ou opened: false) → back'],
  ['coque sans module → back', 'coque sans le module attendu (iOS sans LeadAuthSession, Android sans Browser)'],
  ['hors de l’app → back', 'hors de l’app (site, navigateur) : back, rien d’ouvert, rien gardé'],
  ['préfixes de l’émetteur', 'start ou back hors des préfixes exacts de l’émetteur ('],
  ['Browser.open en erreur → back, aucune attente laissée', 'Browser.open en erreur : back, et aucune connexion laissée en cours'],
  ['page de retour dans l’app : même traitement', 'page de retour chargée DANS l’app : même traitement que le lien'],
  ['page de retour : code effacé de l’adresse avant tout', 'lead-auth-return.html : le premier script efface le code de l’adresse et de l’historique'],
  ['page de retour : aucune ressource tierce, aucun lien', 'lead-auth-return.html : aucune ressource tierce (polices, mesure d’audience), aucun lien ni bouton'],
  ['page de retour : module minimal', 'src/leadAuthReturn.ts : n’importe que src/lib/leadAppAuth et les textes de la page'],
  ['deux pages construites', 'vite.config.ts : deux pages construites'],
  ['page de retour : cinq langues (iPhone et iPad compris)', 'page de retour : cinq textes dans les cinq langues'],
  ['page de retour : Android ou iPhone/iPad, jamais les deux', 'page de retour : sous Android « Ouvrir par défaut », sur iPhone et iPad'],
  ['site web : aucun pont reconnu', 'site web (aucun pont, pont web, isNativePlatform faux ou cassé) : aucun pont natif reconnu'],
  ['site web : aucun écouteur', 'site web : listen() ne pose aucun écouteur, aucun lien traité'],
  ['toutes les pages, au démarrage', 'src/main.tsx : l’écoute du lien de retour démarre avant le premier rendu, sur toutes les pages'],
  ['route publique', 'la page relais est une route publique (sans session) : /lead-auth/google, et seulement elle'],
  ['routes Vercel (fonction, application)', 'Vercel : /lead-auth/google et /lead-auth/return servies sans la fonction'],
  ['route Vercel de la page de retour (en-têtes)', 'Vercel : /lead-auth/return → lead-auth-return.html (réécriture, pas de redirection)'],
  ['fichiers d’association exacts (contrat)', 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json) : 200, application/json, aucune redirection, contenu EXACT du contrat'],
  ['/api/auth/options → leadIssuer', '/api/auth/options → leadIssuer : LEAD_ID_ISSUER (production, aperçu, local), crmlead.io → erplead.io'],
  ['page relais : cinq langues, « votre navigateur » (jamais « Safari »)', 'page relais rendue dans les cinq langues (titre, texte ; « Retour » prêt) ; texte « votre navigateur » (jamais « Safari »)'],
  ['page relais : texte du navigateur affiché', 'page relais : sous iOS 15 à 17.3 (mode safari : navigateur par défaut)'],
  ['page relais : no-store, no-referrer (Vercel)', 'Vercel : page relais /lead-auth/google (l’application) avec Cache-Control: no-store et Referrer-Policy: no-referrer'],
  ['page relais : aucun script tiers', 'index.html (page relais comprise) : aucun script tiers ni mesure d’audience'],
  // Relecture du 30.10.2026 (2e) : départ seul de l'écran de connexion pendant le rachat ; page relais rechargée.
  ['app relancée par son lien (accueil) : rachat seul, aucun départ seul', 'app relancée par son lien de retour (Android, ou iOS après Safari), accueil sans session'],
  ['… écran décidé avant le lien de lancement : il attend sa lecture', '… même quand l’écran de connexion décide AVANT que la coque ait rendu le lien de lancement'],
  ['… sous iOS', '… sous iOS (Universal Link, app relancée) : idem'],
  ['sans lien pris : départ seul comme avant (site web compris)', 'sans lien pris, l’écran de connexion part seul comme avant, une fois'],
  ['departsAlone : jamais pendant un retour', 'departsAlone : jamais pendant un retour de Google (returning)'],
  ['Login : départ par departWhenFree', 'src/pages/Login.tsx : départ seul par departWhenFree(leadAppAuth(), …)'],
  ['page relais rechargée (Safari), lien au lancement : racheté, Safari jamais rouvert', 'iOS 16 (Safari) : page relais RECHARGÉE par la coque pendant sa connexion'],
  ['page relais rechargée avant le lien : attente redite, lien racheté', '… page rechargée AVANT le lien : rien de rouvert'],
  ['page relais rechargée : session iOS perdue → back ; Custom Tab jamais rouvert', 'page relais rechargée pendant sa connexion, iOS 17.4+ (session : résultat perdu avec la page) → back'],
  ['lien de lancement d’avant jamais pris (lien d’erreur, coque en retard)', 'lien de lancement d’avant (lien d’erreur d’une connexion précédente, ou rendu en retard par la coque)'],
  ['reprise seulement pour la même page relais en cours', 'reprise seulement pour la même page relais encore en cours'],
]

/** Contre-épreuves : chaque faute est posée dans une COPIE ; le contrôle nommé doit alors échouer. Texte remplacé présent une fois. */
const LIB = 'src/lib/leadAppAuth.ts'
const NEXT_DAY = 'le lendemain, nouvelle connexion Google (page relais) : le lien de lundi'
const MUTATIONS = [
  { name: 'aucune mémoire des liens traités', file: LIB, from: "      if (seen.has(f) || doneList().some((x) => x.f === f)) return 'duplicate'\n", to: '', breaks: NEXT_DAY },
  { name: 'mémoire de la page seulement (rien dans localStorage)', file: LIB, from: ' || doneList().some((x) => x.f === f)', to: '', breaks: NEXT_DAY },
  { name: 'empreintes oubliées après 24 h (l’ancienne échéance)', file: LIB, from: "v.filter((x) => x && typeof x.f === 'string')",
    to: "v.filter((x) => x && typeof x.f === 'string' && typeof x.t === 'number' && now() - x.t < 24 * 3600 * 1000)", breaks: NEXT_DAY },
  { name: 'lien traité sans connexion en cours', file: LIB, from: "    if (!takePending()) return 'unexpected'\n", to: '',
    breaks: 'aucune connexion Google en cours (aucune page relais) : un lien de retour venu d’ailleurs' },
  { name: 'connexion en cours jamais effacée', file: LIB, from: '    write(env.local, PENDING_KEY, null)\n    pendingHere = null\n', to: '',
    breaks: 'une seule connexion par page relais : après le retour, un autre lien (autre code, sans nouvelle page relais) est ignoré' },
  { name: 'connexion en cours sans échéance', file: LIB, from: 'now() - t >= 0 && now() - t < PENDING_TTL_MS', to: 'true',
    breaks: 'connexion en cours échue (page relais il y a 16 min' },
  { name: 'attente posée sans lire d’abord le lien de lancement', file: LIB,
    from: '    await launchSettled()\n    if (returned) return', to: '    if (returned) return',
    breaks: 'iOS 16 (Safari) : page relais RECHARGÉE par la coque pendant sa connexion' },
  { name: 'page relais : connexion notée avant non effacée', file: LIB, from: '        relayFirst = true\n        setPending(false)\n', to: '        relayFirst = true\n',
    breaks: 'page relais : une connexion notée avant est effacée AVANT de lire le lien de lancement' },
  { name: 'attente laissée après un abandon (Browser.open en erreur, session annulée)', file: LIB,
    from: 'const giveUp = (back: string) => { setPending(false); if (!returned) env.replace(back) }', to: 'const giveUp = (back: string) => { if (!returned) env.replace(back) }',
    breaks: 'Browser.open en erreur : back, et aucune connexion laissée en cours' },
  { name: 'session finie après le lien : Safari ou back quand même', file: LIB, from: "      if (returned) return { outcome: 'session', back: t.back }\n", to: '',
    breaks: 'iOS 17.4+ : lien reçu par appUrlOpen pendant la session' },
  { name: 'navigateur refermé : back même après le retour (Android)', file: LIB, from: 'env.setTimeout(() => { if (!returned) giveUp(back) }, FINISH_GRACE_MS)',
    to: 'env.setTimeout(() => { setPending(false); env.replace(back) }, FINISH_GRACE_MS)',
    breaks: 'navigateur refermé APRÈS le lien de retour (Browser.close) : seulement le rachat, jamais back' },
  { name: 'page de retour : remède Android sans Chrome par défaut (de)', file: 'src/i18n/locales/de/leadauth.json',
    from: ' Wenn Ihr Standardbrowser nicht Chrome ist, wählen Sie Chrome als Standardbrowser (Einstellungen > Apps > Standard-Apps > Browser) und tippen Sie dann erneut auf „Weiter mit Google“.', to: '',
    breaks: 'page de retour : sous Android, Chrome comme navigateur par défaut si ce n’est pas lui' },
  { name: 'préfixe du lien de retour approché', file: LIB, from: '!url.startsWith(RETURN_PREFIX)', to: "!url.includes('/lead-auth/return?')",
    breaks: 'liens étrangers ignorés (' },
  { name: 'schéma propre io.projectlead.app encore accepté', file: LIB, from: '!url.startsWith(RETURN_PREFIX)',
    to: "!(url.startsWith(RETURN_PREFIX) || url.startsWith('io.projectlead.app://lead-auth?'))", breaks: 'liens étrangers ignorés (' },
  { name: 'lien de retour lu de l’adresse du site (aperçu) au lieu de la production', file: LIB, from: "export const SITE = 'https://projectlead.io'",
    to: "export const SITE = typeof location === 'object' ? location.origin : 'https://projectlead-abc-scanleads-projects.vercel.app'",
    breaks: 'le lien de retour attendu est celui de la production, écrit dans le code' },
  { name: 'Custom Tab jamais refermé (Android)', file: LIB, from: 'void Promise.resolve(env.bridge?.Plugins?.Browser?.close?.()).catch(() => {})', to: 'void 0',
    breaks: 'lien vérifié exact (https://projectlead.io/lead-auth/return, code de 43 caractères, langue) sous Android' },
  { name: 'Browser.close aussi sous iOS', file: LIB, from: '    if (!ios()) {\n', to: '    if (true) {\n',
    breaks: 'le même lien sous iOS (Universal Link, après Safari) : rachat, aucun Browser.close' },
  { name: 'forme du code non vérifiée', file: LIB, from: 'codes.length === 1 && CODE_RE.test(codes[0])', to: 'codes.length >= 1', breaks: 'lien mal formé (' },
  { name: 'lien d’erreur gardé comme vu', file: LIB, from: '    if (!isErrorLink(url)) {\n', to: '    if (true) {\n',
    breaks: 'lien d’erreur (error=expired) jamais gardé comme vu' },
  { name: 'start et back de la page relais non vérifiés', file: LIB,
    from: "  if (!start.startsWith(prefix) || new URLSearchParams(start.slice(prefix.length)).has('m') || !isBack(back, issuer)) return null\n", to: '',
    breaks: 'start ou back hors des préfixes exacts de l’émetteur (' },
  { name: 'm déjà posé dans start accepté', file: LIB, from: " || new URLSearchParams(start.slice(prefix.length)).has('m')", to: '',
    breaks: 'start ou back hors des préfixes exacts de l’émetteur (' },
  { name: 'tout objet Capacitor pris pour l’app', file: LIB, from: "typeof b.isNativePlatform === 'function' && b.isNativePlatform() === true ? b : null", to: 'b ? b : null',
    breaks: 'site web (aucun pont, pont web, isNativePlatform faux ou cassé) : aucun pont natif reconnu' },
  { name: 'Android : départ sans m=auto (ERPlead montrerait la page à bouton dans le Custom Tab)', file: LIB,
    from: 'await browser!.open!({ url: `${t.start}&m=auto` })', to: 'await browser!.open!({ url: t.start })',
    breaks: 'Android : back gardé (sessionStorage), Browser.open({ url: start&m=auto })' },
  { name: 'iOS : session ouverte en m=tap (la session ne verrait jamais le lien)', file: LIB,
    from: 'url = (await s.start!({ url: `${t.start}&m=auto` }))?.url', to: 'url = (await s.start!({ url: `${t.start}&m=tap` }))?.url',
    breaks: 'iOS 17.4+ : LeadAuthSession.start({ url: start&m=auto }) une fois' },
  { name: 'iOS : Safari ouvert en m=auto (Safari charge la redirection comme une page)', file: LIB,
    from: 'await s.openExternal!({ url: `${t.start}&m=tap` })', to: 'await s.openExternal!({ url: `${t.start}&m=auto` })',
    breaks: 'iOS 15 à 17.3 (isAvailable → https: false, ou en erreur) : Safari' },
  { name: 'iOS : session tentée avant 17.4', file: LIB, from: 'https = (await s.isAvailable?.())?.https === true', to: 'https = true',
    breaks: 'iOS 15 à 17.3 (isAvailable → https: false, ou en erreur) : Safari' },
  { name: 'iOS : session annulée → Safari quand même', file: LIB,
    from: "      if (refused === 'canceled') { giveUp(t.back); return { outcome: 'canceled', back: t.back } }\n", to: '',
    breaks: 'iOS 17.4+ : session annulée (canceled) → back, jamais Safari' },
  { name: 'iOS : adresse rendue par la session ignorée', file: LIB, from: '        const out = await handleReturnLink(url)\n',
    to: "        const out = 'ignored' as string\n", breaks: 'iOS 17.4+ : adresse rendue par la session → rachat avec le code' },
  { name: 'page de retour dans l’app : rien quand le lien est ignoré', file: LIB,
    from: "    if (out === 'ignored' || out === 'duplicate' || out === 'unexpected') env.replace('/')\n", to: '',
    breaks: 'page de retour chargée DANS l’app : même traitement que le lien' },
  { name: 'page de retour : le code reste dans l’adresse', file: 'lead-auth-return.html',
    from: "if (!app) history.replaceState(null, '', '/lead-auth/return')", to: "if (false) history.replaceState(null, '', '/lead-auth/return')",
    breaks: 'lead-auth-return.html : le premier script efface le code de l’adresse et de l’historique' },
  { name: 'page de retour : police de Google (ressource tierce)', file: 'lead-auth-return.html',
    from: '    <link rel="icon" type="image/svg+xml" href="/icon.svg" />\n',
    to: '    <link rel="icon" type="image/svg+xml" href="/icon.svg" />\n    <link href="https://fonts.googleapis.com/css2?family=Archivo" rel="stylesheet" />\n',
    breaks: 'lead-auth-return.html : aucune ressource tierce' },
  { name: 'page de retour gardée en cache (Vercel)', file: 'scripts/vercel-build.mjs', from: "headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag'", to: "headers: { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag'",
    breaks: 'Vercel : /lead-auth/return → lead-auth-return.html' },
  // Contrat révisé (42c0f0e, d4cc736) : page relais sans cache ni Referer ni script tiers ; « votre navigateur » ; remède iPhone.
  { name: 'page relais gardée en cache, avec Referer (Vercel)', file: 'scripts/vercel-build.mjs',
    from: "    { src: '^/lead-auth/google$', headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, continue: true },\n", to: '',
    breaks: 'Vercel : page relais /lead-auth/google (l’application) avec Cache-Control: no-store et Referrer-Policy: no-referrer' },
  { name: 'mesure d’audience sur toutes les pages (page relais comprise)', file: 'index.html',
    from: '    <script type="module" src="/src/main.tsx"></script>\n',
    to: '    <script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>\n    <script type="module" src="/src/main.tsx"></script>\n',
    breaks: 'index.html (page relais comprise) : aucun script tiers ni mesure d’audience' },
  { name: 'page relais : « Safari » au lieu du navigateur par défaut', file: 'src/i18n/locales/fr/shell.json',
    from: 'Terminez la connexion dans votre navigateur, puis', to: 'Terminez la connexion dans Safari, puis',
    breaks: 'page relais rendue dans les cinq langues (titre, texte ; « Retour » prêt) ; texte « votre navigateur »' },
  { name: 'page de retour : remède iPhone jamais montré', file: 'src/leadAuthReturn.ts',
    from: "  else if (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) reveal('[data-ios]', 'leadauth.return.ios')\n", to: '',
    breaks: 'page de retour : sous Android « Ouvrir par défaut », sur iPhone et iPad' },
  { name: 'page de retour : iPad en mode ordinateur (Macintosh) oublié', file: 'src/leadAuthReturn.ts',
    from: '/iPhone|iPad|iPod|Macintosh/', to: '/iPhone|iPad|iPod/',
    breaks: 'page de retour : sous Android « Ouvrir par défaut », sur iPhone et iPad' },
  { name: 'page de retour : remède iPhone sans Safari par défaut (es)', file: 'src/i18n/locales/es/leadauth.json',
    from: ' Si su navegador no es Safari, elija Safari como navegador predeterminado en Ajustes y luego toque de nuevo «Continuar con Google».', to: '',
    breaks: 'page de retour : cinq textes dans les cinq langues' },
  { name: 'assetlinks.json sans la clé d’envoi', file: 'server/routes/appLinks.ts',
    from: "  'E1:42:CC:0C:43:67:1C:EC:CA:C6:3D:32:31:C3:4D:57:E4:5A:3E:AD:F0:27:D1:3B:27:64:B5:C8:43:4A:5E:2A',\n", to: '',
    breaks: 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json)' },
  { name: 'apple-app-site-association sans webcredentials (la session iOS refuserait le retour https)', file: 'server/routes/appLinks.ts',
    from: '  webcredentials: { apps: [IOS_APP_ID] },\n', to: '', breaks: 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json)' },
  { name: 'fichiers d’association en text/plain', file: 'server/routes/appLinks.ts', from: "'Content-Type': 'application/json'", to: "'Content-Type': 'text/plain'",
    breaks: 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json)' },
  { name: 'émetteur du serveur ignoré', file: 'server/routes/auth.ts', from: 'leadIssuer: leadIssuer() }', to: "leadIssuer: 'https://erplead.io' }",
    breaks: '/api/auth/options → leadIssuer : LEAD_ID_ISSUER (production, aperçu, local), crmlead.io → erplead.io' },
  { name: 'écoute absente au démarrage', file: 'src/main.tsx',
    from: '\nleadAppAuth().listen({ relayPage: window.location.pathname === RELAY_PATH, search: window.location.search })\n', to: '\n',
    breaks: 'src/main.tsx : l’écoute du lien de retour démarre avant le premier rendu, sur toutes les pages' },
  // Relecture du 30.10.2026 (2e).
  { name: 'écran de connexion : départ seul pendant le rachat (ancienne règle)', file: 'src/lib/arrival.ts',
    from: '  if (!auth.returning() && !leavingNow) go()\n', to: '  if (!leavingNow) go()\n',
    breaks: '… même quand l’écran de connexion décide AVANT que la coque ait rendu le lien de lancement' },
  { name: 'écran de connexion : départ sans attendre la lecture du lien de lancement', file: 'src/lib/arrival.ts',
    from: '  await auth.launchSettled()\n', to: '',
    breaks: '… même quand l’écran de connexion décide AVANT que la coque ait rendu le lien de lancement' },
  { name: 'retour jamais signalé (returning toujours faux)', file: LIB, from: 'returning: () => returned,', to: 'returning: () => false,',
    breaks: 'app relancée par son lien de retour (Android, ou iOS après Safari), accueil sans session' },
  { name: 'departsAlone sans returning', file: 'src/lib/arrival.ts', from: ' && !leavingNow && !o.returning\n', to: ' && !leavingNow\n',
    breaks: 'departsAlone : jamais pendant un retour de Google (returning)' },
  { name: 'Login : départ direct (sans departWhenFree)', file: 'src/pages/Login.tsx',
    from: 'void departWhenFree(auth, () => { if (live) window.location.replace(leadStart(next)) })', to: 'window.location.replace(leadStart(next))',
    breaks: 'src/pages/Login.tsx : départ seul par departWhenFree(leadAppAuth(), …)' },
  { name: 'page relais rechargée : connexion effacée (ancienne règle du contrat § 3a)', file: LIB,
    from: "      if (mine && (p!.m === 'safari' || p!.m === 'browser')) resumed = { mode: p!.m }\n", to: "      if (false) resumed = { mode: 'safari' }\n",
    breaks: 'iOS 16 (Safari) : page relais RECHARGÉE par la coque pendant sa connexion' },
  { name: 'page relais rechargée : départ rouvert quand même', file: LIB, from: '    if (resumed) {\n', to: '    if (false) {\n',
    breaks: '… page rechargée AVANT le lien : rien de rouvert' },
  { name: 'toute page relais prise pour une reprise (autre départ)', file: LIB,
    from: '      const mine = !!p && fresh(p.t) && s !== null && p.s === s\n', to: '      const mine = !!p && fresh(p.t)\n',
    breaks: 'reprise seulement pour la même page relais encore en cours' },
  { name: 'reprise sans échéance', file: LIB,
    from: '      const mine = !!p && fresh(p.t) && s !== null && p.s === s\n', to: '      const mine = !!p && s !== null && p.s === s\n',
    breaks: 'reprise seulement pour la même page relais encore en cours' },
  { name: 'Android : navigateur refermé après une reprise sans retour → rien', file: LIB, from: '      if (!ios()) watchFinished(browser!, t.back)\n', to: '',
    breaks: 'page relais rechargée pendant sa connexion, iOS 17.4+ (session : résultat perdu avec la page) → back' },
  { name: 'page relais rechargée pendant la session iOS : attente au lieu de back', file: LIB,
    from: "    if (lost) { env.replace(t.back); return { outcome: 'lost', back: t.back } }\n", to: '',
    breaks: 'page relais rechargée pendant sa connexion, iOS 17.4+ (session : résultat perdu avec la page) → back' },
  { name: 'page relais : lien de lancement suivi s’il arrive en retard', file: LIB, from: '        if (relayFirst) { noteOld(u); return undefined }\n', to: '',
    breaks: 'lien de lancement d’avant (lien d’erreur d’une connexion précédente, ou rendu en retard par la coque)' },
  { name: 'lien de lancement noté par la page relais suivi quand même', file: LIB, from: '        if (pendingRecord()?.l === launchPrint) return undefined\n', to: '',
    breaks: 'lien de lancement d’avant (lien d’erreur d’une connexion précédente, ou rendu en retard par la coque)' },
]

function webCheck(cwd = ROOT) {
  const r = run('npx', ['tsx', 'scripts/google-app-check.ts'], { cwd, timeout: 300_000 })
  const lines = (r.stdout ?? '').split('\n')
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', oks: lines.filter((l) => l.startsWith('  ok   ')).map((l) => l.slice(7)),
    nons: lines.filter((l) => l.startsWith('  NON  ')).map((l) => l.slice(7)), bilan: (r.stdout ?? '').match(/^(\d+) contrôles verts, (\d+) rouges$/m) }
}

function counterProofs() {
  const files = run('git', ['ls-files', '-co', '--exclude-standard']).stdout.split('\n').filter((f) => f && !f.startsWith('captures/'))
  const before = sha256(run('git', ['status', '--porcelain']).stdout + run('git', ['diff']).stdout)
  const copy = join(tmp, 'copie')
  for (const f of files) { mkdirSync(dirname(join(copy, f)), { recursive: true }); if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(copy, f)) }
  symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'))
  const clean = webCheck(copy)
  check('contre-épreuves : la copie non faussée est verte', clean.status === 0 && clean.nons.length === 0, clean.nons.join(' | ') || lastLine(clean.err))
  for (const m of MUTATIONS) {
    const file = join(copy, m.file)
    const original = readFileSync(file, 'utf8')
    const n = original.split(m.from).length - 1
    if (!check(`contre-épreuve « ${m.name} » : le texte à fausser se trouve une fois dans ${m.file}`, n === 1, `${n} fois`)) continue
    writeFileSync(file, original.replace(m.from, m.to))
    try {
      const r = webCheck(copy)
      check(`contre-épreuve « ${m.name} » : « ${m.breaks.slice(0, 80)}… » échoue`, r.status !== 0 && r.nons.some((t) => t.startsWith(m.breaks)),
        `échecs : ${r.nons.join(' | ').slice(0, 400) || 'aucun'} ${lastLine(r.err)}`)
    } finally { writeFileSync(file, original) }
  }
  check(`contre-épreuves faites dans une copie (${MUTATIONS.length}) : le worktree n’a pas bougé`, sha256(run('git', ['status', '--porcelain']).stdout + run('git', ['diff']).stdout) === before)
}

function gateG1() {
  console.log('G1 — code web de l’app (lien vérifié, page relais iOS/Android, page de retour, fichiers d’association, rien hors de l’app), contre-épreuves, contrôles complets')
  const w = webCheck()
  check(`scripts/google-app-check.ts : ${w.bilan ? `${w.bilan[1]} verts, ${w.bilan[2]} rouges` : 'pas de bilan'}`,
    w.status === 0 && w.bilan && w.bilan[2] === '0' && Number(w.bilan[1]) >= 60 && lastLine(w.out) === 'GOOGLE_APP_WEB_CHECK_OK', w.nons.join(' | ') || lastLine(w.err))
  for (const [what, prefix] of G1_REQUIRED) check(`vu vert : ${what}`, w.oks.some((t) => t.startsWith(prefix)), prefix)
  // Ordre de mise en ligne du contrat (étape 0 : ERPlead à liens vérifiés en production, porte PROD d'ERPlead) et navigateur
  // par défaut d'Android, dits dans le doc de l'app.
  const doc = readFileSync(join(ROOT, 'docs/GOOGLE-APP.md'), 'utf8')
  const contract = readFileSync(CONTRACT, 'utf8')
  const docMust = ['0. **ERPlead à liens vérifiés en production d\'abord**', '`node scripts/google-app-gates.mjs PROD` → `GOOGLE_APP_PROD_OK`',
    'jamais « Redeploy » de d2d72aa', '3. Ensuite seulement, la 1.0.2 aux stores', '**Android, navigateur par défaut autre que Chrome**', 'Samsung Internet']
  const missing = docMust.filter((x) => !doc.includes(x))
  check('docs/GOOGLE-APP.md : ordre 0. ERPlead à liens vérifiés (porte PROD d’ERPlead) → 1. site → 2. Apple et Google → 3. 1.0.2 → 4. interrupteur (nouveau déploiement, jamais « Redeploy » de d2d72aa) ; navigateur par défaut d’Android (Samsung Internet)',
    missing.length === 0 && doc.indexOf('0. **ERPlead') < doc.indexOf('1. Le site de ProjectLead') && doc.indexOf('1. Le site de ProjectLead') < doc.indexOf('3. Ensuite seulement'), missing)
  check('contrat d’ERPlead : étape 0 de l’ordre de mise en ligne (ERPlead à liens vérifiés en production, porte PROD) présente',
    contract.includes('0. **ERPlead à liens vérifiés en production d\'abord**') && contract.includes('node scripts/google-app-gates.mjs PROD'))
  counterProofs()

  const env = { TEST_DATABASE_URL: testDatabaseUrl() }
  for (const [mode, token] of [['--keys', 'I18N_KEYS_OK'], ['--hardcoded', 'I18N_HARDCODED_OK'], ['--control', 'I18N_CONTROL_OK']]) {
    const i = run('npx', ['tsx', 'scripts/i18n-check.ts', mode])
    check(`i18n-check ${mode}`, i.status === 0 && lastLine(i.stdout) === token, lastLine(i.stdout) || lastLine(i.stderr))
  }
  const tsc = run('npm', ['run', '-s', 'typecheck'])
  check('npm run typecheck', tsc.status === 0, (tsc.stdout + tsc.stderr).slice(-400))
  const smoke = run('npm', ['test'], { env, timeout: 1_800_000 })
  const sm = (smoke.stdout ?? '').match(/^(\d+) contrôles verts, (\d+) rouges$/m)
  check(`npm test (scripts/smoke.ts, base locale) : ${sm ? `${sm[1]} verts, ${sm[2]} rouges` : 'pas de bilan'}`, smoke.status === 0 && sm && sm[2] === '0' && Number(sm[1]) >= 577,
    (smoke.stdout ?? '').split('\n').filter((l) => l.includes('✗')).join(' | ').slice(0, 500) || lastLine(smoke.stdout))
  for (const must of ['options : émetteur du Compte Lead (leadIssuer = LEAD_ID_ISSUER)', 'app mobile, nouvelle version (LeadAppAuth/2) : départ avec platform=app',
    'app mobile : départ vers le Compte Lead avec platform=app', 'navigateur : départ sans platform',
    "liens d'app : /.well-known/apple-app-site-association (localhost, AASA-Bot) → 200 application/json, contenu exact, aucune redirection",
    "liens d'app : /.well-known/assetlinks.json (www.localhost, Mozilla) → 200 application/json, contenu exact, aucune redirection"])
    check(`smoke : vu vert « ${must} »`, (smoke.stdout ?? '').includes(`✓ ${must}`))
  for (const [script, token, timeout] of [['scripts/assistant-check.ts', 'ASSISTANT_CHECK_OK', 900_000], ['scripts/assistant-actions-check.ts', 'ASSISTANT_ACTIONS_CHECK_OK', 900_000],
    ['scripts/assistant-pool-check.ts', 'ASSISTANT_POOL_CHECK_OK', 300_000]]) {
    const r = run('npx', ['tsx', script], { env, timeout })
    check(script, r.status === 0 && lastLine(r.stdout) === token, lastLine(r.stdout) || lastLine(r.stderr))
  }
  const su = run('npx', ['tsx', 'scripts/suites-check.ts'])
  check('scripts/suites-check.ts', su.status === 0 && (su.stdout ?? '').includes('PROJECTLEAD_SUITES_UNIT_OK'), lastLine(su.stdout))
  check('pas de linter dans package.json (rien à lancer)', !/"lint"/.test(readFileSync(join(ROOT, 'package.json'), 'utf8')))
  // La construction de Vercel, ici (sans migration : VERCEL_ENV absent) : types, interface (deux pages), fonction, routes.
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true })
  rmSync(join(ROOT, '.vercel/output'), { recursive: true, force: true })
  const vb = run('node', ['scripts/vercel-build.mjs'], { timeout: 900_000, env: { VERCEL_ENV: '', ALLOW_PREVIEW_MIGRATIONS: '' } })
  const out = join(ROOT, '.vercel/output')
  check('construction Vercel locale (node scripts/vercel-build.mjs, sans migration) : interface et fonction prêtes', vb.status === 0 && existsSync(join(out, 'config.json')) &&
    existsSync(join(out, 'static/index.html')) && existsSync(join(out, 'static/lead-auth-return.html')) && existsSync(join(out, 'functions/api.func/index.mjs')) &&
    /prévisualisation : pas de migration/.test(vb.stdout ?? ''), (vb.stdout + vb.stderr).slice(-400))
  if (existsSync(join(out, 'config.json'))) {
    const routes = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8')).routes ?? []
    const ri = routes.findIndex((r) => r.dest === '/lead-auth-return.html'), fi = routes.findIndex((r) => r.handle === 'filesystem')
    const r = routes[ri] ?? {}
    const re = new RegExp(r.src ?? '^$')
    const fn = routes.find((x) => x.dest === '/api')
    check('config.json produit : /lead-auth/return → lead-auth-return.html avant les fichiers et l’application, en-têtes no-store / no-referrer / noindex, aucune redirection ; /.well-known → fonction',
      ri >= 0 && ri < fi && re.test('/lead-auth/return') && !re.test('/lead-auth/return/x') && same(r.headers, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }) &&
      !routes.some((x) => x.status && x.status >= 300 && x.status < 400) && new RegExp(fn?.src ?? '^$').test('/.well-known/apple-app-site-association') &&
      new RegExp(fn?.src ?? '^$').test('/.well-known/assetlinks.json'), routes)
    const gi = routes.findIndex((x) => x.src === '^/lead-auth/google$')
    const g = routes[gi] ?? {}
    const built = readFileSync(join(out, 'static/index.html'), 'utf8')
    const scripts = [...built.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])
    check(`config.json produit : page relais /lead-auth/google → l’application avec Cache-Control: no-store et Referrer-Policy: no-referrer (continue, avant les fichiers) ; index.html construit : scripts du site seulement (${scripts.length})`,
      gi >= 0 && gi < fi && g.continue === true && !g.dest && same(g.headers, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }) &&
      new RegExp(g.src).test('/lead-auth/google') && !new RegExp(g.src).test('/lead-auth/google/x') &&
      scripts.length >= 1 && scripts.every((x) => /\ssrc="\/assets\/[^"]+\.js"/.test(x)) && !/gtag|googletagmanager|google-analytics/i.test(built), { g, scripts })
    const page = readFileSync(join(out, 'static/lead-auth-return.html'), 'utf8')
    const assets = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    const sizes = assets.filter((a) => a.startsWith('/assets/')).map((a) => statSync(join(out, 'static', a)).size)
    check(`page de retour construite : script d’effacement en tête, ressources du site seulement (${assets.join(', ')}), petite (${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024)} Ko de script)`,
      page.indexOf("history.replaceState(null, '', '/lead-auth/return')") < page.indexOf('<script type="module"') && assets.every((a) => a.startsWith('/')) &&
      sizes.length >= 1 && sizes.reduce((a, b) => a + b, 0) < 40 * 1024, assets)
  }
  const files = []
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  if (existsSync(join(ROOT, 'dist'))) walk(join(ROOT, 'dist'))
  const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8'))
  check('paquet du navigateur : le lien vérifié https://projectlead.io + /lead-auth/return, le rachat et LeadAuthSession y sont ; plus aucun schéma io.projectlead.app://',
    js.some((s) => s.includes('https://projectlead.io')) && js.some((s) => s.includes('/lead-auth/return')) && js.some((s) => s.includes('/auth/google/app/redeem?code=')) &&
    js.some((s) => s.includes('LeadAuthSession')) && !js.some((s) => s.includes('io.projectlead.app://')))
  const BAD = /sk-ant|anthropic|opus-5/i
  check(`paquet du navigateur (${files.length} fichiers) : aucune clé ni nom du fournisseur de l’assistant`, files.length > 3 && !files.some((f) => BAD.test(readFileSync(f, 'utf8'))))
  const grep = spawnSync('git', ['grep', '-nE', 'sk-ant-[A-Za-z0-9_-]{8,}|(^|[^A-Za-z0-9])lid_[A-Za-z0-9_-]{32,}', 'HEAD', '--', '.'], { cwd: ROOT, encoding: 'utf8' })
  check('dépôt (HEAD) : aucune clé', grep.status === 1, (grep.stdout ?? '').slice(0, 300))

  // Le périmètre : seulement les fichiers du chantier, aucune migration, la production fusionnée.
  run('git', ['fetch', '-q', 'origin', 'vercel'])
  check(`branche ${BRANCH} : la production (${PROD_BASE.slice(0, 7)}, origin/vercel) y est fusionnée`,
    run('git', ['merge-base', '--is-ancestor', PROD_BASE, 'HEAD']).status === 0 && run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() === BRANCH &&
    [PROD_BASE, run('git', ['rev-parse', 'HEAD']).stdout.trim()].includes(run('git', ['rev-parse', 'origin/vercel']).stdout.trim()))
  const changed = run('git', ['diff', '--name-only', PROD_BASE]).stdout.split('\n').filter(Boolean)
    .concat(run('git', ['ls-files', '-o', '--exclude-standard']).stdout.split('\n').filter((f) => f && !f.startsWith('captures/')))
  const outside = changed.filter((f) => !ALLOWED.some((re) => re.test(f)))
  check(`fichiers touchés depuis la production : seulement ceux du chantier (${changed.length})`, outside.length === 0, outside)
  check('aucune migration : db/ identique à la production', run('git', ['diff', '--quiet', PROD_BASE, '--', 'db']).status === 0)
  finish('G1')
}

// ------------------------------------------------------------------ G2 : dépôt mobile

function gateG2() {
  console.log(`G2 — dépôt mobile ${MOBILE} (branche ${BRANCH}) : liens vérifiés`)
  const git = (...a) => run('git', a, { cwd: MOBILE })
  const head = git('rev-parse', 'HEAD').stdout.trim()
  check(`branche ${BRANCH} (${head.slice(0, 7)}), partie de la version publiée ${MOBILE_BASE}`, git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() === BRANCH &&
    git('merge-base', '--is-ancestor', MOBILE_BASE, 'HEAD').status === 0)
  check('fichiers suivis : tout est enregistré (aucune modification en attente)', git('status', '--porcelain', '--untracked-files=no').stdout.trim() === '',
    git('status', '--porcelain', '--untracked-files=no').stdout)
  const untracked = git('status', '--porcelain').stdout.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3))
  check('non suivi : seulement assets-avant-20261022/ (laissé tel quel)', untracked.every((f) => f === 'assets-avant-20261022/'), untracked)
  const assoc = contractAssociation()
  check('contrat d’ERPlead lu (App ID iOS, empreintes Android de projectlead.io)', assoc?.appId === IOS_APP_ID)

  // --- configuration Capacitor
  const cfg = readFileSync(`${MOBILE}/capacitor.config.ts`, 'utf8')
  const ua = cfg.match(/appendUserAgent:\s*'([^']+)'/)?.[1] ?? ''
  check(`agent : « ${ua} » = l'agent de l'app + « LeadAppAuth/2 » (revient par le lien vérifié) séparé par une espace`, ua === AGENT && /(^|\s)LeadAppAuth\/2$/.test(ua))
  check('appId io.projectlead.app, server.url https://projectlead.io', /appId:\s*'io\.projectlead\.app'/.test(cfg) && /url:\s*'https:\/\/projectlead\.io'/.test(cfg))
  const nav = (cfg.match(/allowNavigation:\s*\[([^\]]*)\]/)?.[1] ?? '').match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? []
  check(`allowNavigation garde erplead.io et Apple, jamais Google (${nav.join(', ')})`, same(nav, ['erplead.io', 'appleid.apple.com', 'idmsa.apple.com']))

  // --- iOS : droits, plus de schéma propre, module LeadAuthSession, versions
  const plistJson = (f) => JSON.parse(execFileSync('python3', ['-c', 'import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', f], { encoding: 'utf8' }))
  const plist = plistJson(`${MOBILE}/ios/App/App/Info.plist`)
  check('iOS Info.plist (lu par plistlib) : plus aucun CFBundleURLTypes (schéma io.projectlead.app retiré)', !('CFBundleURLTypes' in plist), plist.CFBundleURLTypes)
  check('iOS Info.plist : version et build lus du projet ($(MARKETING_VERSION), $(CURRENT_PROJECT_VERSION))',
    plist.CFBundleShortVersionString === '$(MARKETING_VERSION)' && plist.CFBundleVersion === '$(CURRENT_PROJECT_VERSION)')
  const ent = existsSync(`${MOBILE}/ios/App/App/App.entitlements`) ? plistJson(`${MOBILE}/ios/App/App/App.entitlements`) : {}
  check('iOS App.entitlements (lu par plistlib) : com.apple.developer.associated-domains = applinks:projectlead.io, webcredentials:projectlead.io (domaine nu, sans ?mode=developer), rien d’autre',
    same(ent, { 'com.apple.developer.associated-domains': ['applinks:projectlead.io', 'webcredentials:projectlead.io'] }), ent)
  const pbx = readFileSync(`${MOBILE}/ios/App/App.xcodeproj/project.pbxproj`, 'utf8')
  const target = (name) => pbx.match(new RegExp(`504EC31[78]1FED79650016851F /\\* ${name} \\*/ = \\{[\\s\\S]*?name = ${name};`))?.[0] ?? ''
  check('iOS projet : CODE_SIGN_ENTITLEMENTS = App/App.entitlements dans Debug et Release de la cible App',
    ['Debug', 'Release'].every((n) => /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/.test(target(n))) && (pbx.match(/CODE_SIGN_ENTITLEMENTS/g) ?? []).length === 2)
  const sources = pbx.match(/\/\* Begin PBXSourcesBuildPhase section \*\/[\s\S]*?\/\* End PBXSourcesBuildPhase section \*\//)?.[0] ?? ''
  const fileRef = pbx.match(/(\w{24}) \/\* LeadAuthSession\.swift \*\/ = \{isa = PBXFileReference; lastKnownFileType = sourcecode\.swift; path = LeadAuthSession\.swift; sourceTree = "<group>"; \};/)
  const buildFile = fileRef ? pbx.match(new RegExp(`(\\w{24}) /\\* LeadAuthSession\\.swift in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ${fileRef[1]} `)) : null
  const ids = [...pbx.matchAll(/^\t\t(\w{24}) \/\*/gm)].map((m) => m[1])
  check('iOS projet : LeadAuthSession.swift référencé, dans le groupe App et compilé (phase Sources) ; App.entitlements référencé ; identifiants uniques',
    !!fileRef && !!buildFile && sources.includes(`${buildFile[1]} /* LeadAuthSession.swift in Sources */`) && pbx.includes(`${fileRef[1]} /* LeadAuthSession.swift */,`) &&
    /\w{24} \/\* App\.entitlements \*\/ = \{isa = PBXFileReference; lastKnownFileType = text\.plist\.entitlements; path = App\.entitlements;/.test(pbx) &&
    new Set(ids).size === ids.length && (pbx.match(/\{/g) ?? []).length === (pbx.match(/\}/g) ?? []).length)
  const mv = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]), cpv = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1])
  check('iOS : MARKETING_VERSION 1.0.2 et CURRENT_PROJECT_VERSION 3 (Debug et Release) — TestFlight a 1.0.1 (2), la 1.0.2 n’a jamais été envoyée',
    same(mv, ['1.0.2', '1.0.2']) && same(cpv, ['3', '3']), { mv, cpv })
  const swift = existsSync(`${MOBILE}/ios/App/App/LeadAuthSession.swift`) ? readFileSync(`${MOBILE}/ios/App/App/LeadAuthSession.swift`, 'utf8') : ''
  const code = swift.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  check('module LeadAuthSession (Swift) : @objc(LeadAuthSessionPlugin), CAPPlugin + CAPBridgedPlugin + ASWebAuthenticationPresentationContextProviding, jsName « LeadAuthSession », méthodes isAvailable / start / openExternal (promesses)',
    /@objc\(LeadAuthSessionPlugin\)\npublic class LeadAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding \{/.test(code) &&
    /public let jsName = "LeadAuthSession"/.test(code) && ['isAvailable', 'start', 'openExternal'].every((m) =>
      code.includes(`CAPPluginMethod(name: "${m}", returnType: CAPPluginReturnPromise)`) && code.includes(`@objc func ${m}(_ call: CAPPluginCall)`)))
  check('module : retour .https(host: "projectlead.io", path: "/lead-auth/return") écrit dans le Swift (jamais reçu du JS), iOS 17.4+ (#available, @available), session non éphémère, une à la fois, ancrée à la fenêtre de la vue Capacitor',
    /static let callbackHost = "projectlead\.io"/.test(code) && /static let callbackPath = "\/lead-auth\/return"/.test(code) &&
    /ASWebAuthenticationSession\.Callback\.https\(host: Self\.callbackHost, path: Self\.callbackPath\)/.test(code) &&
    /ASWebAuthenticationSession\(url: url, callback: callback\)/.test(code) && /if #available\(iOS 17\.4, \*\) \{\n\s+call\.resolve\(\["https": true\]\)/.test(code) &&
    /@available\(iOS 17\.4, \*\)\n\s+private func begin/.test(code) && /prefersEphemeralWebBrowserSession = false/.test(code) && /if session != nil \{[\s\S]{0,80}"busy"/.test(code) &&
    /presentationContextProvider = self/.test(code) && /bridge\?\.viewController\?\.view\.window/.test(code) &&
    !/call\.getString\("(host|path|callback)/.test(code) && (code.match(/call\.getString\(/g) ?? []).length === 2)
  check('module : départ vérifié (https, chemin /auth/google/app/start, requête, sans identifiant ni fragment) avant start et openExternal ; refus canceled / unavailable / busy / bad_url / failed ; Safari par UIApplication.open → { opened }',
    /parts\.scheme == "https"/.test(code) && /parts\.path == startPath/.test(code) && /static let startPath = "\/auth\/google\/app\/start"/.test(code) &&
    /parts\.user == nil, parts\.password == nil/.test(code) && /parts\.fragment == nil/.test(code) && (code.match(/Self\.startURL\(call\.getString\("url"\)\)/g) ?? []).length === 2 &&
    ['canceled', 'unavailable', 'busy', 'bad_url', 'failed'].every((c) => code.includes(`"${c}"`)) && /failure\.code == \.canceledLogin/.test(code) &&
    /UIApplication\.shared\.open\(url, options: \[:\]\) \{ opened in\n\s+call\.resolve\(\["opened": opened\]\)/.test(code))
  check('module : accolades, parenthèses et crochets équilibrés (aucun compilateur Swift ici : relu, construit par Codemagic)',
    (code.match(/\{/g) ?? []).length === (code.match(/\}/g) ?? []).length && (code.match(/\(/g) ?? []).length === (code.match(/\)/g) ?? []).length &&
    (code.match(/\[/g) ?? []).length === (code.match(/\]/g) ?? []).length)
  const scene = readFileSync(`${MOBILE}/ios/App/App/SceneDelegate.swift`, 'utf8')
  const story = readFileSync(`${MOBILE}/ios/App/App/Base.lproj/Main.storyboard`, 'utf8')
  check('enregistrement : LeadBridgeViewController (CAPBridgeViewController, capacitorDidLoad → registerPluginInstance(LeadAuthSessionPlugin())) vue racine de SceneDelegate et du storyboard',
    /class LeadBridgeViewController: CAPBridgeViewController \{\n\s+override open func capacitorDidLoad\(\) \{\n\s+bridge\?\.registerPluginInstance\(LeadAuthSessionPlugin\(\)\)/.test(code) &&
    /window\?\.rootViewController = LeadBridgeViewController\(\)/.test(scene) && !/CAPBridgeViewController\(\)/.test(scene) &&
    /customClass="LeadBridgeViewController" customModule="App" customModuleProvider="target"/.test(story))
  check('iOS : les liens ouverts et les Universal Links passent au pont (SceneDelegateProxy : openURLContexts, continue userActivity, lancement)',
    /SceneDelegateProxy\.shared\.scene\(scene, openURLContexts: URLContexts\)/.test(scene) && /SceneDelegateProxy\.shared\.scene\(scene, continue: userActivity\)/.test(scene) &&
    /SceneDelegateProxy\.shared\.scene\(scene, willConnectTo: session, options: connectionOptions\)/.test(scene))
  const iosTree = run('git', ['grep', '-n', 'io.projectlead.app://', 'HEAD', '--', 'ios', 'android', 'capacitor.config.ts'], { cwd: MOBILE })
  check('plus aucun schéma propre io.projectlead.app:// dans le projet iOS, Android ni la configuration', iosTree.status === 1, iosTree.stdout)
  const cm = readFileSync(`${MOBILE}/codemagic.yaml`, 'utf8')
  check('codemagic.yaml : MARKETING_VERSION 1.0.2, vérification des droits et de LeadAppAuth/2 avant la construction, toujours sans envoi en test (submit_to_testflight: false)',
    /MARKETING_VERSION: 1\.0\.2\b/.test(cm) && /submit_to_testflight: false/.test(cm) && cm.indexOf("['applinks:projectlead.io','webcredentials:projectlead.io']") > cm.indexOf('npx cap sync ios') &&
    cm.indexOf("LeadAppAuth/2") < cm.indexOf('xcode-project build-ipa'))
  const spm = readFileSync(`${MOBILE}/ios/App/CapApp-SPM/Package.swift`, 'utf8')
  check('iOS Package.swift : CapacitorApp et CapacitorBrowser ; cible iOS 15 (la session https se décide à l’exécution)', /\.package\(name: "CapacitorBrowser", path: "\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/browser"\)/.test(spm) &&
    /\.product\(name: "CapacitorBrowser", package: "CapacitorBrowser"\)/.test(spm) && /\.product\(name: "CapacitorApp", package: "CapacitorApp"\)/.test(spm) &&
    /platforms: \[\.iOS\(\.v15\)\]/.test(spm) && /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/.test(pbx))

  // --- Android : App Link vérifié, plus de schéma propre
  const manifest = readFileSync(`${MOBILE}/android/app/src/main/AndroidManifest.xml`, 'utf8')
  const activity = manifest.match(/<activity[\s\S]*?<\/activity>/)?.[0] ?? ''
  const filters = activity.match(/<intent-filter[^>]*>[\s\S]*?<\/intent-filter>/g) ?? []
  const link = filters.find((f) => /android:autoVerify="true"/.test(f))
  check('Android AndroidManifest.xml : MainActivity singleTask, intent-filter android:autoVerify="true" VIEW + DEFAULT + BROWSABLE, data https projectlead.io /lead-auth/return',
    /android:name="\.MainActivity"/.test(activity) && /android:launchMode="singleTask"/.test(activity) && !!link && /^<intent-filter android:autoVerify="true">/.test(link) &&
    /android\.intent\.action\.VIEW/.test(link) && /android\.intent\.category\.DEFAULT/.test(link) && /android\.intent\.category\.BROWSABLE/.test(link) &&
    /<data android:scheme="https" android:host="projectlead\.io" android:path="\/lead-auth\/return" \/>/.test(link) && filters.length === 2, link ?? activity.slice(0, 300))
  const mainJava = readFileSync(`${MOBILE}/android/app/src/main/java/io/projectlead/app/MainActivity.java`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  check('Android MainActivity : cookies de la WebView écrits au passage au second plan (onPause → CookieManager.flush() : le verifier d’erplead.io survit si Android tue l’app pendant le Custom Tab, porte G4)',
    /public class MainActivity extends BridgeActivity \{\s*@Override\s*public void onPause\(\) \{\s*super\.onPause\(\);\s*CookieManager\.getInstance\(\)\.flush\(\);\s*\}\s*\}/.test(mainJava) &&
    /import android\.webkit\.CookieManager;/.test(mainJava))
  const datas = manifest.replace(/<!--[\s\S]*?-->/g, '').match(/<data [^>]*>/g) ?? []
  check('Android : un seul hôte http(s) dans le manifeste (Android ≤ 11 : tous doivent être vérifiés), plus de schéma io.projectlead.app', datas.length === 1 && !/io\.projectlead\.app"/.test(datas.join(' ')), datas)
  const gradle = readFileSync(`${MOBILE}/android/app/build.gradle`, 'utf8')
  const vc = Number(gradle.match(/versionCode (\d+)/)?.[1]), vn = gradle.match(/versionName "([^"]+)"/)?.[1]
  check(`Android : versionCode ${vc} (publiée : ${PUBLISHED_VERSION_CODE}), versionName ${vn}`, vc === 3 && vc > PUBLISHED_VERSION_CODE && vn === '1.0.2')
  const pkg = JSON.parse(readFileSync(`${MOBILE}/package.json`, 'utf8'))
  const installed = (p) => { try { return JSON.parse(readFileSync(`${MOBILE}/node_modules/${p}/package.json`, 'utf8')).version } catch { return null } }
  const v = Object.fromEntries(['@capacitor/app', '@capacitor/browser', '@capacitor/core', '@capacitor/android', '@capacitor/ios', '@capacitor/cli'].map((p) => [p, installed(p)]))
  check(`plugins : @capacitor/app ${v['@capacitor/app']} et @capacitor/browser ${v['@capacitor/browser']} dans package.json et installés, Capacitor 8 partout (version ${pkg.version})`,
    pkg.version === '1.0.2' && pkg.dependencies?.['@capacitor/app'] && pkg.dependencies?.['@capacitor/browser'] && Object.values(v).every((x) => x?.startsWith('8.')), v)

  // --- synchronisation : `cap sync` (Node 22, comme le README) ne change aucun fichier suivi, et les fichiers générés portent tout
  const sync = run('npx', ['-y', 'node@22', 'node_modules/@capacitor/cli/bin/capacitor', 'sync'], { cwd: MOBILE, timeout: 600_000 })
  check('npx cap sync (android et ios) : réussi', sync.status === 0 && /Sync finished/.test(sync.stdout + sync.stderr), lastLine(sync.stderr) || lastLine(sync.stdout))
  check('après cap sync : aucun fichier suivi modifié (le dépôt était déjà synchronisé)', git('status', '--porcelain', '--untracked-files=no').stdout.trim() === '',
    git('status', '--porcelain', '--untracked-files=no').stdout)
  const plugins = JSON.parse(readFileSync(`${MOBILE}/android/app/src/main/assets/capacitor.plugins.json`, 'utf8')).map((p) => p.classpath)
  const androidCfg = JSON.parse(readFileSync(`${MOBILE}/android/app/src/main/assets/capacitor.config.json`, 'utf8'))
  const iosCfg = JSON.parse(readFileSync(`${MOBILE}/ios/App/App/capacitor.config.json`, 'utf8'))
  check('configurations générées (iOS et Android) : agent avec LeadAppAuth/2, allowNavigation gardée ; BrowserPlugin et AppPlugin enregistrés (Android, iOS)',
    androidCfg.appendUserAgent === ua && iosCfg.appendUserAgent === ua && same(androidCfg.server?.allowNavigation, nav) &&
    plugins.includes('com.capacitorjs.plugins.browser.BrowserPlugin') && plugins.includes('com.capacitorjs.plugins.app.AppPlugin') &&
    iosCfg.packageClassList?.includes('CAPBrowserPlugin') && iosCfg.packageClassList?.includes('AppPlugin'), { a: androidCfg.appendUserAgent, i: iosCfg.appendUserAgent })

  // --- icônes (choix d'Ève du 03.11.2026) : iOS AppIcon et Android (ic_launcher, adaptative) tirés des icônes de la suite
  const ICONS = `${HOME}/projets/.unlazy/icones-suite/icones/projectlead`
  const icon = run('python3', ['-I', '-c', `
import sys
from PIL import Image, ImageChops, ImageStat
src = Image.open(sys.argv[1] + '/icon-1024.png').convert('RGB')
tr = Image.open(sys.argv[1] + '/icon-1024-transparent.png').convert('RGBA')
m = sys.argv[2]
def diff(a, b): return max(x[1] for x in ImageChops.difference(a.convert('RGB'), b.convert('RGB').resize(a.size, Image.LANCZOS)).getextrema())
def mean(a, b): return max(ImageStat.Stat(ImageChops.difference(a.convert('RGB'), b.convert('RGB').resize(a.size, Image.LANCZOS))).mean)
ios = Image.open(m + '/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
only = Image.open(m + '/assets/icon-only.png')
r = m + '/android/app/src/main/res/mipmap-xxxhdpi/'
fg = Image.open(m + '/assets/icon-foreground.png').convert('RGBA'); bg = Image.open(r + 'ic_launcher_background.png').convert('RGB')
leg = Image.open(r + 'ic_launcher.png').convert('RGBA')
ok = [ios.size == (1024, 1024) and ios.mode == 'RGB' and diff(ios, src) <= 8, diff(only, src) == 0,
  fg.getpixel((0, 0))[3] == 0 and fg.getpixel((512, 512))[:3] == tr.getpixel((512, 512))[:3] and fg.split()[-1].getbbox()[0] >= 170,
  bg.getextrema() == ((255, 255), (255, 255), (255, 255)), mean(leg.crop(leg.split()[-1].getbbox()), src) <= 2]
print('ICONES', ok)
sys.exit(0 if all(ok) else 1)
`, ICONS, MOBILE])
  check('icônes du 03.11.2026 : AppIcon iOS = icon-1024.png (fond blanc), assets/icon-only.png identique, avant-plan adaptatif transparent (forme dans la zone sûre), arrière-plan blanc, ic_launcher Android',
    icon.status === 0 && /ICONES \[True, True, True, True, True\]/.test(icon.stdout), (icon.stdout + icon.stderr).slice(0, 300))
  const xmlIcon = readFileSync(`${MOBILE}/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, 'utf8')
  check('Android : icône adaptative (mipmap-anydpi-v26) = arrière-plan @mipmap/ic_launcher_background (blanc) + avant-plan @mipmap/ic_launcher_foreground',
    /<background>[\s\S]*@mipmap\/ic_launcher_background[\s\S]*<\/background>/.test(xmlIcon) && /<foreground>[\s\S]*@mipmap\/ic_launcher_foreground[\s\S]*<\/foreground>/.test(xmlIcon))

  // --- construction Android : AAB signé par la clé d'envoi de ProjectLead (valeurs jamais affichées)
  const sign = readEnv(`${HOME}/.android-signing/projectlead-upload.env`)
  const aab = `${MOBILE}/android/app/build/outputs/bundle/release/app-release.aab`
  const t0 = Date.now()
  const gw = run('./gradlew', ['--no-daemon', '-q', 'clean', 'bundleRelease'], { cwd: `${MOBILE}/android`, timeout: 1_800_000, env: {
    CM_KEYSTORE_PATH: `${HOME}/.android-signing/projectlead-upload.jks`, CM_KEYSTORE_PASSWORD: sign.PROJECTLEAD_UPLOAD_STORE_PASSWORD,
    CM_KEY_ALIAS: sign.PROJECTLEAD_UPLOAD_KEY_ALIAS, CM_KEY_PASSWORD: sign.PROJECTLEAD_UPLOAD_KEY_PASSWORD } })
  const leak = [sign.PROJECTLEAD_UPLOAD_STORE_PASSWORD, sign.PROJECTLEAD_UPLOAD_KEY_PASSWORD].some((s) => s && (gw.stdout + gw.stderr).includes(s))
  check(`Android : ./gradlew clean bundleRelease réussi en ${Math.round((Date.now() - t0) / 1000)} s, AAB neuf`, gw.status === 0 && existsSync(aab) && statSync(aab).mtimeMs >= t0 && !leak,
    leak ? 'sortie à ne pas afficher' : (gw.stdout + gw.stderr).split('\n').filter((l) => /error|FAIL/i.test(l)).slice(0, 5).join(' / '))
  if (existsSync(aab) && statSync(aab).mtimeMs >= t0) {
    const bt = (...a) => run('java', ['-jar', `${HOME}/outils/bundletool-all-1.18.1.jar`, ...a], { cwd: MOBILE, timeout: 120_000 })
    const xml = bt('dump', 'manifest', '--bundle', aab).stdout ?? ''
    const filter = (xml.match(/<intent-filter[^>]*>[\s\S]*?<\/intent-filter>/g) ?? []).find((f) => /autoVerify/.test(f)) ?? ''
    const allData = xml.match(/<data [^>]*>/g) ?? []
    check('AAB (bundletool dump manifest, manifeste fusionné) : package io.projectlead.app, versionCode 3, versionName 1.0.2, intent-filter autoVerify https projectlead.io /lead-auth/return, seul hôte, aucun schéma propre',
      /package="io\.projectlead\.app"/.test(xml) && /android:versionCode="3"/.test(xml) && /android:versionName="1\.0\.2"/.test(xml) &&
      /^<intent-filter android:autoVerify="true">/.test(filter) && /android\.intent\.action\.VIEW/.test(filter) && /android\.intent\.category\.BROWSABLE/.test(filter) &&
      /android\.intent\.category\.DEFAULT/.test(filter) && /android:scheme="https"/.test(filter) && /android:host="projectlead\.io"/.test(filter) &&
      /android:path="\/lead-auth\/return"/.test(filter) && allData.length === 1 && !/io\.projectlead\.app"/.test(allData.join(' ')), filter || xml.slice(0, 400))
    const unzip = (entry) => execFileSync('unzip', ['-p', aab, entry], { maxBuffer: 256 * 1024 * 1024 })
    const entries = execFileSync('unzip', ['-Z1', aab], { encoding: 'utf8' }).split('\n')
    const dex = entries.filter((e) => /^base\/dex\/classes\d*\.dex$/.test(e)).map((e) => unzip(e).toString('latin1')).join('')
    const aCfg = JSON.parse(unzip('base/assets/capacitor.config.json').toString('utf8'))
    check('AAB : le plugin Browser (Custom Tab) et le plugin App sont dans le code, l’agent LeadAppAuth/2 dans la configuration embarquée',
      dex.includes('com/capacitorjs/plugins/browser/BrowserPlugin') && dex.includes('com/capacitorjs/plugins/app/AppPlugin') && aCfg.appendUserAgent === ua &&
      JSON.parse(unzip('base/assets/capacitor.plugins.json').toString('utf8')).some((p) => p.pkg === '@capacitor/browser'))
    const certOf = (f) => (execFileSync('keytool', ['-printcert', '-jarfile', f], { encoding: 'utf8' }).match(/SHA256: ([0-9A-F:]+)/) ?? [])[1]
    const now = certOf(aab), before = certOf(`${PUBLICATIONS}/projectlead-1.0.1-2.aab`)
    const site = readFileSync(join(ROOT, 'server/routes/appLinks.ts'), 'utf8')
    check(`AAB signé par la même clé d’envoi que la 1.0.1 publiée (SHA-256 ${String(now).slice(0, 8)}…${String(now).slice(-5)}) ; cette empreinte est dans assetlinks.json du site et dans le contrat (clé d’envoi), à côté de Play App Signing (${assoc?.playSigning?.slice(0, 8)}…)`,
      !!now && now === before && now === assoc?.upload && site.includes(`'${now}'`) && site.includes(`'${assoc?.playSigning}'`))
    const out = `${PUBLICATIONS}/projectlead-1.0.2-3.aab`
    mkdirSync(CAPTURES, { recursive: true })
    copyFileSync(aab, out)
    writeFileSync(`${CAPTURES}/android-1.0.2-3.json`, JSON.stringify({ aab: out, sha256: sha256(readFileSync(out)), mobileCommit: head, builtAt: new Date().toISOString(),
      note: 'AAB signé (clé d’envoi ProjectLead) construit par scripts/google-app-gates.mjs G2 : liens vérifiés (App Link autoVerify https://projectlead.io/lead-auth/return, LeadAppAuth/2), remplace l’AAB 1.0.2 (3) du schéma propre (jamais envoyé). NON envoyé à Google Play.' }, null, 2) + '\n')
    note(`AAB copié : ${out} (${Math.round(statSync(out).size / 1024)} Ko)`)
  }
  // --- iOS : pas de construction locale (Linux, sans Xcode ni compilateur Swift) ; la construction passe par Codemagic, qui
  // envoie le build à App Store Connect : jamais déclenchée par cette porte. Elle exige d'abord la capacité Associated
  // Domains sur io.projectlead.app et un profil App Store régénéré (comptes Apple et Codemagic : liste du ledger).
  note('iOS : aucune construction locale possible (pas de macOS/Xcode/swiftc sur ce serveur) ; procédure : Codemagic, workflow ios-testflight, branche store-projectlead — non déclenchée (elle enverrait le build à App Store Connect ; le profil actuel n’a pas Associated Domains)')
  // --- rien poussé, rien soumis
  const remote = git('ls-remote', 'origin', 'refs/heads/store-projectlead', `refs/heads/${BRANCH}`)
  const lines = (remote.stdout ?? '').trim().split('\n').filter(Boolean)
  check('rien poussé : store-projectlead (branche des constructions Codemagic) est toujours la 1.0.1 publiée, aucune branche google-app chez GitHub',
    remote.status === 0 && lines.length === 1 && lines[0].startsWith(git('rev-parse', MOBILE_BASE).stdout.trim()) && lines[0].endsWith('refs/heads/store-projectlead'), lines)
  finish('G2')
}

// ------------------------------------------------------------------ aperçus : Vercel

async function vercel(path) {
  const token = JSON.parse(readFileSync(`${HOME}/.local/share/com.vercel.cli/auth.json`, 'utf8')).token
  const r = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${VERCEL_TEAM}`, { headers: { Authorization: `Bearer ${token}` } })
  return r.json()
}
const sameAppCode = (sha) => run('git', ['diff', '--quiet', sha, 'HEAD', '--', ...APP_PATHS]).status === 0
const erpPreview = () => JSON.parse(readFileSync(`${COMMON}/captures/erplead/apercu.json`, 'utf8'))

/**
 * APERÇU : `vercel deploy` (cible preview, jamais --prod) d'une copie de HEAD (`git archive` : un déploiement depuis le dépôt
 * est refusé par Vercel à cause de l'auteur du commit), base de l'aperçu et réglages passés au déploiement seulement (aucune
 * variable du projet changée), comme scripts/apercu-vercel.mjs. Le Compte Lead de l'aperçu est l'aperçu d'ERPlead (google-app,
 * interrupteur GOOGLE_APP_ENABLED ouvert sur lui seulement) : LEAD_ID_ISSUER = son adresse, client projectlead, retour
 * déclaré https://projectlead.io/auth/lead/callback (jamais suivi par la porte), secret factice. Tâches de fond coupées.
 */
async function deployPreview() {
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim()
  check(`branche ${BRANCH}, arbre propre`, run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() === BRANCH && run('git', ['status', '--porcelain']).stdout.trim() === '')
  const env = readEnv(`${HOME}/.projectlead-actions-apercu.env`)
  check('base de l’aperçu ProjectLead (branche Neon de l’aperçu, jamais la production)', env.PL_PREVIEW_DB?.includes(env.PL_PREVIEW_DB_HOST) && !PL_PROD_DB.test(env.PL_PREVIEW_DB) && !!env.PL_PREVIEW_APP_SECRET)
  const erp = erpPreview()
  const ed = await vercel(`/v13/deployments/${erp.deployment}`)
  check(`aperçu d’ERPlead ${erp.url} : prêt, cible aperçu, branche google-app`, /^https:\/\/erplead-[a-z0-9]+-scanleads-projects\.vercel\.app$/.test(erp.url) &&
    ed.readyState === 'READY' && !ed.target && ed.meta?.gitCommitRef === BRANCH, { state: ed.readyState, target: ed.target })
  if (failures) finish('APERCU')
  const lock = `${HOME}/projets/.unlazy/audit-suite-20261021/projectlead-deploy.lock`
  mkdirSync(dirname(lock), { recursive: true })
  let fd
  try { fd = openSync(lock, 'wx') } catch { check(`verrou des déploiements de ProjectLead libre (${lock})`, false, readFileSync(lock, 'utf8').trim()); finish('APERCU') }
  writeFileSync(fd, `aperçu google-app ${head.slice(0, 7)} ${new Date().toISOString()} pid ${process.pid}\n`)
  closeSync(fd)
  const dir = mkdtempSync(join(tmpdir(), 'pl-google-apercu-'))
  let url
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive HEAD | tar -x -C "${dir}"`])
    mkdirSync(join(dir, '.vercel'))
    writeFileSync(join(dir, '.vercel/project.json'), JSON.stringify({ orgId: VERCEL_TEAM, projectId: PL_PROJECT }))
    const args = ['--yes', 'vercel@65.2.0', 'deploy', '--yes', '--environment', 'preview', '--scope', 'scanleads-projects',
      '--env', `DATABASE_URL=${env.PL_PREVIEW_DB}`, '--env', `APP_SECRET=${env.PL_PREVIEW_APP_SECRET}`, '--env', 'JOBS_DISABLED=1',
      '--env', `LEAD_ID_ISSUER=${erp.url}`, '--env', 'LEAD_ID_CLIENT_ID=projectlead', '--env', 'LEAD_ID_CLIENT_SECRET=apercu-factice-aucun-echange',
      '--env', 'LEAD_ID_REDIRECT_URI=https://projectlead.io/auth/lead/callback', '--env', 'LEAD_ID_APP=projectlead',
      '--meta', `commit=${head}`, '--meta', `branch=${BRANCH}`]
    if (args.includes('--prod') || args.includes('production')) throw new Error('jamais la production')
    const r = spawnSync('npx', args, { cwd: dir, encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024 })
    url = `${r.stdout}\n${r.stderr}`.match(/https:\/\/projectlead-[a-z0-9]+-scanleads-projects\.vercel\.app/)?.[0]
    check('déploiement d’aperçu terminé', r.status === 0 && !!url, `${r.stderr}`.split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' / '))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(lock, { force: true })
  }
  if (failures) finish('APERCU')
  const d = await vercel(`/v13/deployments/${new URL(url).host}`)
  check(`aperçu ${d.id} : prêt, cible aperçu (pas la production)`, d.readyState === 'READY' && !d.target, { state: d.readyState, target: d.target })
  mkdirSync(CAPTURES, { recursive: true })
  writeFileSync(`${CAPTURES}/apercu.json`, JSON.stringify({ url, deployment: d.id, commit: head, erplead: erp.url, erpleadDeployment: erp.deployment,
    note: `Aperçu Vercel de ProjectLead (cible preview, protégé), déployé le ${new Date().toISOString()} par la CLI depuis une copie de HEAD (branche google-app), sans --prod. ` +
      'Base : branche Neon de l’aperçu (~/.projectlead-actions-apercu.env), JOBS_DISABLED=1, Compte Lead = l’aperçu d’ERPlead (secret factice). Lu par scripts/google-app-gates.mjs G3.' }, null, 2) + '\n')
  note(`aperçu ${url} (${d.id}), commit ${head.slice(0, 7)}, Compte Lead ${erp.url}`)
  finish('APERCU')
}

// ------------------------------------------------------------------ G3 : aperçus, navigateur sans tête

async function targets() {
  const info = JSON.parse(readFileSync(`${CAPTURES}/apercu.json`, 'utf8'))
  check(`aperçu ProjectLead (*.vercel.app, jamais projectlead.io) : ${info.url}`, /^https:\/\/projectlead-[a-z0-9]+-scanleads-projects\.vercel\.app$/.test(info.url))
  const d = await vercel(`/v13/deployments/${info.deployment}`)
  check(`déploiement ${info.deployment} : prêt, cible aperçu, branche ${BRANCH}`, d.readyState === 'READY' && !d.target && `https://${d.url}` === info.url && d.meta?.branch === BRANCH,
    { state: d.readyState, target: d.target, branch: d.meta?.branch })
  check(`le code servi par l’aperçu (${String(d.meta?.commit).slice(0, 7)}) est celui de HEAD`, d.meta?.commit && sameAppCode(d.meta.commit))
  const prod = await vercel(`/v9/projects/${PL_PROJECT}`)
  check('la production de ProjectLead n’est pas cet aperçu', prod.targets?.production?.id && prod.targets.production.id !== info.deployment)
  const erp = erpPreview()
  const ed = await vercel(`/v13/deployments/${erp.deployment}`)
  const erpProd = await vercel(`/v9/projects/${ERP_PROJECT}`)
  check(`aperçu d’ERPlead ${erp.url} (branche google-app, contrat révisé ${String(erp.commit).slice(0, 7)}) : prêt, cible aperçu, ni la production ; c’est le Compte Lead de l’aperçu ProjectLead`,
    erp.url === info.erplead && ed.readyState === 'READY' && !ed.target && ed.meta?.gitCommitRef === BRANCH && erpProd.targets?.production?.id !== erp.deployment &&
    run('git', ['-C', `${HOME}/projets/erplead-google-app`, 'merge-base', '--is-ancestor', 'ef52342', erp.commit]).status === 0)
  const env = readEnv(`${HOME}/.erplead-apercu.env`)
  const roHost = new URL(env.APERCU_RO_URL).hostname, rwHost = new URL(env.APERCU_DATABASE_URL_UNPOOLED).hostname
  check('base d’ERPlead : celle de l’APERÇU (royal-firefly), lecture par lead_e2e_ro, jamais la production',
    roHost.startsWith(ERP_APERCU_DB_HOST) && rwHost.startsWith(ERP_APERCU_DB_HOST) && !roHost.startsWith(ERP_PROD_DB_HOST) && new URL(env.APERCU_RO_URL).username === 'lead_e2e_ro')
  return {
    pl: { url: info.url, bypass: readFileSync(`${HOME}/projets/.unlazy/assistant-ia/projectlead-bypass.secret`, 'utf8').trim() },
    erp: { url: erp.url, bypass: readFileSync(`${HOME}/.erplead-bypass`, 'utf8').trim(), ro: env.APERCU_RO_URL, rw: env.APERCU_DATABASE_URL_UNPOOLED,
      secret: env.APERCU_CLIENT_SECRET_PROJECTLEAD },
  }
}

/** Lecture seule sur la base d'aperçu d'ERPlead : la valeur JSON de la première colonne. */
function sqlRead(url, query, params = []) {
  if (!new URL(url).hostname.startsWith(ERP_APERCU_DB_HOST)) throw new Error('lecture refusée : base d’aperçu attendue')
  const sql = params.reduce((s, p, i) => s.split(`$${i + 1}`).join(`'${String(p).replace(/'/g, "''")}'`), query)
  const out = execFileSync('psql', [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    `begin read only; select replace(coalesce((${sql})::text, 'null'), E'\\n', ' '); commit;`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(out.split('\n').find((l) => l && l !== 'BEGIN' && l !== 'COMMIT') ?? 'null')
}
/** Écriture dans la base d'APERÇU d'ERPlead, seulement autour d'une personne d'une entreprise TEST du banc (garde dans la transaction). */
async function previewWrite(t, userId, fn) {
  if (!new URL(t.erp.rw).hostname.startsWith(ERP_APERCU_DB_HOST)) throw new Error('écriture refusée : base d’aperçu attendue')
  const db = new pg.Client({ connectionString: t.erp.rw.replace('sslmode=require', 'sslmode=verify-full') })
  await db.connect()
  try {
    await db.query('begin')
    const who = (await db.query(`select o.is_test, o.name, u.email from users u join orgs o on o.id = u.org_id where u.id = $1`, [userId])).rows[0]
    if (!who?.is_test || !/^TEST /.test(who.name) || !/^test\+[a-z0-9-]+@scanlead\.io$/.test(who.email)) throw new Error('écriture refusée : personne TEST du banc attendue')
    const out = await fn(db)
    await db.query('commit')
    return out
  } catch (e) { await db.query('rollback').catch(() => {}); throw e } finally { await db.end() }
}
/** La personne TEST (dernière membre active, confirmée, sans double authentification de l'entreprise lt06 du banc). */
function benchPerson(t) {
  const state = JSON.parse(readFileSync(`${HOME}/projets/lead-e2e/state.json`, 'utf8'))
  for (const p of [...state.orgs[ORG_INDEX].people].reverse().filter((x) => x.role !== 'admin')) {
    const row = sqlRead(t.erp.ro, `select json_build_object('id', u.id, 'email', u.email, 'name', u.name, 'org', o.id, 'org_name', o.name, 'is_test', o.is_test,
        'status', u.status, 'verified', u.email_verified, 'locale', u.locale, 'last_login_at', u.last_login_at,
        'totp', exists(select 1 from totp x where x.user_id = u.id and x.enabled))
      from users u join orgs o on o.id = u.org_id where lower(u.email) = lower($1)`, [p.email])
    if (row && row.is_test === true && /^TEST /.test(row.org_name) && row.status === 'active' && row.verified && !row.totp) return row
  }
  check(`personne TEST de l'entreprise ${ORG_INDEX + 1} du banc dans la base d'aperçu d'ERPlead`, false, 'absente')
  finish('G3')
}

/** Ce que la base d'APERÇU d'ERPlead avait avant une porte (G3, G4), pour la remettre comme avant. */
function previewBefore(t, who) {
  return {
    orgApp: sqlRead(t.erp.ro, `select json_build_object('last_at', last_at) from org_apps where org_id = $1 and app = 'projectlead'`, [who.org]),
    rates: sqlRead(t.erp.ro, `select coalesce(json_agg(json_build_object('key', key, 'count', count, 'reset_at', reset_at)), '[]'::json) from rate_limits where key like 'gapp|%'`),
  }
}
/**
 * La base d'APERÇU d'ERPlead remise comme avant, autour de la personne TEST : sessions, codes et jetons OpenID, états
 * (départs, états Google, codes de transfert, vues), freins des départs, journal de la porte ; dernière connexion, langue
 * et dernière venue de l'organisation dans ProjectLead reprises.
 */
async function restorePreview(t, who, startedAt, made, orgAppBefore, ratesBefore) {
  await previewWrite(t, who.id, async (db) => {
    const s = await db.query(`delete from sessions where user_id = $1 and created_at >= $2`, [who.id, startedAt])
    const c = await db.query(`delete from codes where user_id = $1 and client_id = 'projectlead' and expires_at >= $2`, [who.id, startedAt])
    const rt = await db.query(`delete from refresh_tokens where user_id = $1 and client_id = 'projectlead' and created_at >= $2`, [who.id, startedAt])
    const st = await db.query(`delete from sso_states where state = any($1) or data->>'vh' = any($2) or state = any($3) or state = any($4)`,
      [made.states, made.vh, made.vh.map((v) => `gapp-view:${v}`), made.codes])
    const au = await db.query(`delete from audit where at >= $1 and (user_id = $2 or (action like 'google_app.%' and data->>'app' = 'projectlead'))`, [startedAt, who.id])
    await db.query(`update users set last_login_at = $2, locale = $3 where id = $1`, [who.id, who.last_login_at, who.locale])
    if (orgAppBefore) await db.query(`update org_apps set last_at = $3 where org_id = $1 and app = $2`, [who.org, 'projectlead', orgAppBefore.last_at])
    else await db.query(`delete from org_apps where org_id = $1 and app = $2 and first_at >= $3`, [who.org, 'projectlead', startedAt])
    const keep = (ratesBefore ?? []).map((r) => r.key)
    const rl = await db.query(`delete from rate_limits where key like 'gapp|%' and not (key = any($1))`, [keep])
    for (const r of ratesBefore ?? []) await db.query(`update rate_limits set count = $2, reset_at = $3 where key = $1`, [r.key, r.count, r.reset_at])
    note(`remise en état : ${s.rowCount} session(s), ${c.rowCount} code(s) OpenID, ${rt.rowCount} jeton(s) de rafraîchissement, ${st.rowCount} état(s), ${rl.rowCount} frein(s) des départs, ${au.rowCount} ligne(s) de journal ; dernière connexion, langue et organisation reprises`)
  })
}
function checkRestored(t, who, startedAt, made, orgAppBefore, ratesBefore) {
  const after = sqlRead(t.erp.ro, `select json_build_object('sessions', (select count(*) from sessions where user_id = $1 and created_at >= $2),
      'codes', (select count(*) from codes where user_id = $1 and expires_at >= $2), 'refresh', (select count(*) from refresh_tokens where user_id = $1 and created_at >= $2),
      'states', (select count(*) from sso_states where data->>'vh' = any(string_to_array($3, ',')) or state = any(string_to_array($4, ','))),
      'last_login_at', (select last_login_at from users where id = $1), 'locale', (select locale from users where id = $1),
      'org_app', (select last_at from org_apps where org_id = $5 and app = 'projectlead'),
      'rates', (select coalesce(json_agg(json_build_object('key', key, 'count', count, 'reset_at', reset_at) order by key), '[]'::json) from rate_limits where key like 'gapp|%'))`,
    [who.id, startedAt.toISOString(), made.vh.join(','), [...made.states, ...made.codes].join(','), who.org])
  const sortRates = (x) => [...(x ?? [])].sort((p, q) => String(p.key).localeCompare(String(q.key)))
  check('base d’APERÇU d’ERPlead remise comme avant (aucune session, aucun code ni jeton, aucun état de la porte, freins des départs d’avant ; dernière connexion, langue, organisation d’avant)',
    after.sessions === 0 && after.codes === 0 && after.refresh === 0 && after.states === 0 && after.locale === who.locale && after.last_login_at === who.last_login_at &&
    (orgAppBefore ? after.org_app === orgAppBefore.last_at : after.org_app === null) && same(sortRates(after.rates), sortRates(ratesBefore)), { ...after, rates: after.rates?.length })
}

const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPHONE_16 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36'
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
/** L'iPad en mode ordinateur (Safari demande la version de bureau) : il se dit « Macintosh ». */
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const IOS_UA = `${IPHONE} ${AGENT}`
const IOS_OLD_UA = `${IPHONE_16} ${AGENT}`
const ANDROID_UA = `${ANDROID_WV} ${AGENT}`
const OLD_UA = `${IPHONE} ProjectLeadApp/1.0.1`
const V1_UA = `${IPHONE} ProjectLeadApp/1.0.2 LeadAppAuth/1`
const PROD_HOSTS = /^https?:\/\/(www\.)?(projectlead|erplead)\.io(\/|$)/
/** La langue que le navigateur du téléphone annonce (les requêtes de la porte hors page l'envoient elles-mêmes). */
const ACCEPT_FR = 'fr-CH,fr;q=0.9,en;q=0.8'
/**
 * Le pont que la coque native injecte, imité (chaque appel est noté par la porte) : App et Browser ; sous iOS, le module
 * LeadAuthSession (isAvailable selon la version d'iOS ; start attend que la porte rende l'adresse de retour ou un refus,
 * comme ASWebAuthenticationSession ; openExternal = Safari).
 */
const fakeBridge = ({ kind, platform, https }) => `(() => {
  const L = {}
  const rec = (name, arg) => window.__capRecord(${JSON.stringify(kind)}, name, arg)
  const on = (plugin) => (ev, cb) => { (L[ev] = L[ev] || []).push(cb); rec('listen', plugin + ':' + ev); return { remove: async () => {} } }
  const Plugins = {
    App: { addListener: on('App'), getLaunchUrl: () => window.__capLaunch().then((url) => (url ? { url } : {})) },
    Browser: { addListener: on('Browser'),
      open: (o) => { rec('open', o && o.url); return Promise.resolve() },
      close: () => { rec('close', ''); return Promise.resolve() } } }
  if (${JSON.stringify(platform)} === 'ios') Plugins.LeadAuthSession = {
    isAvailable: () => Promise.resolve({ https: ${https ? 'true' : 'false'} }),
    start: (o) => new Promise((resolve, reject) => {
      rec('session', o && o.url)
      window.__sessionDone = (r) => (r.url ? resolve({ url: r.url }) : reject(Object.assign(new Error(r.code), { code: r.code })))
    }),
    openExternal: (o) => { rec('external', o && o.url); return Promise.resolve({ opened: true }) } }
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => ${JSON.stringify(platform)}, Plugins }
  window.__capFire = (ev, data) => (L[ev] || []).forEach((cb) => cb(data))
})()`

async function gateG3() {
  console.log('G3 — aperçus : vue web de l’app 1.0.2 (agent LeadAppAuth/2, faux pont Capacitor iOS et Android), Google par le navigateur sûr du téléphone, retour par le lien vérifié')
  const t = await targets()
  if (failures) finish('G3')
  const assoc = contractAssociation()
  const who = benchPerson(t)
  const { orgApp: orgAppBefore, rates: ratesBefore } = previewBefore(t, who)
  const bypassPl = { 'x-vercel-protection-bypass': t.pl.bypass }
  const opt = await (await fetch(`${t.pl.url}/api/auth/options`, { headers: bypassPl })).json().catch(() => null)
  check('aperçu ProjectLead : Compte Lead branché, émetteur = l’aperçu d’ERPlead (/api/auth/options)', opt?.leadId === true && opt?.leadIssuer === t.erp.url, opt)

  // --- 0. fichiers d'association et page de retour de l'aperçu, comme les lisent Apple, Google et un navigateur (sans suivre)
  const wk = {}
  for (const [path, want] of [['/.well-known/apple-app-site-association', assoc?.aasa], ['/.well-known/assetlinks.json', assoc?.links]]) {
    for (const ua of ['AASA-Bot/1.0.0', 'Mozilla/5.0 (compatible; Google-Digital-Asset-Links)', SAFARI]) {
      for (const method of ['GET', 'HEAD']) {
        const r = await fetch(`${t.pl.url}${path}`, { method, redirect: 'manual', headers: { ...bypassPl, 'user-agent': ua } })
        const body = method === 'GET' ? await r.text() : ''
        let parsed = null
        try { parsed = JSON.parse(body) } catch {}
        wk[`${method} ${path} ${ua.slice(0, 14)}`] = r.status === 200 && r.headers.get('content-type') === 'application/json' && !r.headers.get('location') &&
          (method === 'HEAD' || same(parsed, want))
      }
    }
  }
  check(`aperçu : /.well-known/apple-app-site-association et /.well-known/assetlinks.json → 200, Content-Type application/json, aucune redirection, contenu EXACT du contrat (appID ${assoc?.appId}, Play App Signing + clé d’envoi), pour le robot d’Apple, celui de Google et Safari (GET et HEAD)`,
    !!assoc && Object.values(wk).every(Boolean), wk)
  const rr = await fetch(`${t.pl.url}/lead-auth/return?code=${'Z'.repeat(43)}&locale=fr`, { redirect: 'manual', headers: { ...bypassPl, 'user-agent': SAFARI } })
  const rrBody = await rr.text()
  check('aperçu : /lead-auth/return servie telle quelle (200, text/html, aucune redirection), Cache-Control: no-store, Referrer-Policy: no-referrer, X-Robots-Tag: noindex, la page de retour (pas l’application)',
    rr.status === 200 && /^text\/html/.test(rr.headers.get('content-type') ?? '') && !rr.headers.get('location') && rr.headers.get('cache-control') === 'no-store' &&
    rr.headers.get('referrer-policy') === 'no-referrer' && rr.headers.get('x-robots-tag') === 'noindex' && rrBody.includes('data-lead-auth-return') && !rrBody.includes('id="root"'),
    { status: rr.status, cc: rr.headers.get('cache-control'), rp: rr.headers.get('referrer-policy'), xr: rr.headers.get('x-robots-tag') })
  // La page relais (contrat § 3a, 42c0f0e) : son adresse porte le départ à usage unique et la demande d'autorisation.
  const relayUrl = `${t.pl.url}/lead-auth/google?${new URLSearchParams({ start: `${t.erp.url}/auth/google/app/start?d=projectlead.entetes`,
    back: `${t.erp.url}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dprojectlead&locale=fr` })}`
  const rl = await fetch(relayUrl, { redirect: 'manual', headers: { ...bypassPl, 'user-agent': IOS_UA } })
  const rlBody = await rl.text()
  const rlScripts = [...rlBody.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])
  check(`aperçu : page relais /lead-auth/google → 200 sans redirection, Cache-Control: no-store, Referrer-Policy: no-referrer, scripts du site seulement (${rlScripts.length}), aucune mesure d’audience`,
    rl.status === 200 && !rl.headers.get('location') && rl.headers.get('cache-control') === 'no-store' && rl.headers.get('referrer-policy') === 'no-referrer' &&
    rlBody.includes('id="root"') && rlScripts.length >= 1 && rlScripts.every((x) => /\ssrc="\/assets\/[^"]+\.js"/.test(x)) &&
    !/gtag|googletagmanager|google-analytics/i.test(rlBody),
    { status: rl.status, cc: rl.headers.get('cache-control'), rp: rl.headers.get('referrer-policy'), scripts: rlScripts })
  // Le pare-feu de Vercel en production (lecture seule, contrat § 7) : /.well-known répond aux robots d'Apple et de Google.
  const fw = {}
  for (const ua of ['AASA-Bot/1.0.0', 'Mozilla/5.0 (compatible; Google-Digital-Asset-Links)']) {
    const r = await fetch('https://projectlead.io/.well-known/lead-app.json', { redirect: 'manual', headers: { 'user-agent': ua } })
    fw[ua.slice(0, 14)] = `${r.status} ${r.headers.get('content-type')}`
  }
  check('production (lecture seule) : le pare-feu de Vercel laisse passer /.well-known pour le robot d’Apple et celui de Google (https://projectlead.io/.well-known/lead-app.json → 200 JSON, sans défi)',
    Object.values(fw).every((v) => /^200 application\/json/.test(v)), fw)

  const startedAt = new Date()
  mkdirSync(CAPTURES, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const calls = []          // appels au faux pont : { kind, name, arg, at }
  let launchUrl = null      // ce que rend App.getLaunchUrl()
  const prodHits = []       // toute requête des navigateurs vers projectlead.io ou erplead.io (production) : aucune attendue
  const callbacks = []      // retours OpenID vers https://projectlead.io/auth/lead/callback, interceptés dans le navigateur
  const redeems = [], authorizes = [], googleInWebview = []
  const madeStates = [], madeVh = [], madeCodes = []
  const shots = []
  const T = Object.fromEntries(LOCALES.map((l) => [l, shellTexts(l)]))
  const R = Object.fromEntries(LOCALES.map((l) => [l, returnTexts(l)]))

  /**
   * Les navigations qui peuvent finir sur un site d'app (production) sont suivies ici, saut par saut, par les requêtes du
   * contexte (mêmes cookies, même agent) : la page relais est envoyée vers l'aperçu de ProjectLead (origines d'ERPlead
   * remplacées par celle de son aperçu, comme le dit le contrat), le retour OpenID est noté et jamais envoyé. Playwright ne
   * montre pas les redirections suivies par le navigateur à route() : sans ce suivi, elles partiraient en production.
   */
  async function chained(ctx, ua, route) {
    let url = route.request().url()
    for (let hop = 0; hop < 12; hop++) {
      if (PROD_HOSTS.test(url)) {
        const u = new URL(url)
        if (u.host === 'projectlead.io' && u.pathname === '/lead-auth/google') {
          const q = new URLSearchParams()
          for (const [k, v] of new URLSearchParams(u.search)) q.append(k, v.startsWith('https://erplead.io/') ? t.erp.url + v.slice('https://erplead.io'.length) : v)
          return route.fulfill({ status: 302, headers: { location: `${t.pl.url}${u.pathname}?${q}` } })
        }
        if (u.host === 'projectlead.io' && u.pathname === '/auth/lead/callback') {
          callbacks.push(url)
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
            body: '<!doctype html><meta charset="utf-8"><title>Retour OpenID</title><p data-callback>Retour OpenID vers ProjectLead intercepté par la porte (jamais envoyé à projectlead.io).</p>' })
        }
        prodHits.push(url)
        return route.abort()
      }
      if (/^https:\/\/accounts\.google\.com\//.test(url)) { googleInWebview.push(url); return route.abort() }
      if (url.startsWith(`${t.erp.url}/oauth/authorize?`)) authorizes.push(url)
      if (url.startsWith(`${t.erp.url}/auth/google/app/redeem?`)) redeems.push(url)
      const r = await ctx.request.get(url, { maxRedirects: 0, headers: { 'user-agent': ua, ...previewHeaders(url) } })
      const loc = r.headers().location
      if (r.status() >= 300 && r.status() < 400 && loc) { url = new URL(loc, url).toString(); continue }
      // Une page : le navigateur la charge lui-même (même adresse, aucun effet de bord : écran de connexion, compte, page de l'app).
      return route.fulfill({ status: 302, headers: { location: url } })
    }
    prodHits.push(`trop de redirections : ${url}`)
    return route.abort()
  }
  const isPreview = (u) => u.startsWith(`${t.pl.url}/`) || u.startsWith(`${t.erp.url}/`)
  /** Sur un aperçu : sans la barre d'outils de Vercel, et la protection franchie par l'en-tête (au cas où un cookie manquerait). */
  const previewHeaders = (u) => (!isPreview(u) ? {} : { 'x-vercel-skip-toolbar': '1',
    'x-vercel-protection-bypass': u.startsWith(`${t.pl.url}/`) ? t.pl.bypass : t.erp.bypass })
  const CHAINED = new RegExp(`^(${t.erp.url.replace(/[.]/g, '\\.')}/(auth/google/app(/redeem)?\\?|oauth/authorize\\?)|${t.pl.url.replace(/[.]/g, '\\.')}/auth/lead/(start|login)(\\?|$))`)

  /** Un contexte : vue web de l'app (`webview`, avec son pont), navigateur du téléphone (`system`) ou ordinateur (`desktop`). */
  async function context(ua, kind, bridge = null) {
    const mobile = kind !== 'desktop'
    const ctx = await browser.newContext({ userAgent: ua, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      deviceScaleFactor: mobile ? 2 : 1, locale: 'fr-CH' })
    if (bridge) {
      await ctx.exposeBinding('__capRecord', ({ page }, k, name, arg) => { calls.push({ kind: k, name, arg: String(arg ?? ''), at: page?.url() ?? '' }) })
      await ctx.exposeBinding('__capLaunch', () => launchUrl)
      await ctx.addInitScript(fakeBridge(bridge))
    }
    ctx.on('request', (r) => { if (PROD_HOSTS.test(r.url())) prodHits.push(r.url()); if (kind !== 'system' && /^https:\/\/accounts\.google\.com\//.test(r.url())) googleInWebview.push(r.url()) })
    // Les aperçus Vercel ajoutent à leurs pages la barre d'outils de Vercel (script de vercel.live), jamais en production :
    // x-vercel-skip-toolbar la retire, pour voir les pages comme en production. Route posée d'abord : elle passe en dernier.
    await ctx.route((u) => isPreview(u.toString()), (route) => route.continue({ headers: { ...route.request().headers(), ...previewHeaders(route.request().url()) } }))
    await ctx.route(PROD_HOSTS, (route) => { prodHits.push(route.request().url()); return route.abort() })
    if (kind !== 'system') await ctx.route((u) => CHAINED.test(u.toString()), (route) => (route.request().isNavigationRequest() ? chained(ctx, ua, route) : route.fallback()))
    const page = await ctx.newPage()
    await page.goto(`${t.erp.url}/healthz?x-vercel-protection-bypass=${t.erp.bypass}&x-vercel-set-bypass-cookie=true`)
    await page.goto(`${t.pl.url}/api/auth/options?x-vercel-protection-bypass=${t.pl.bypass}&x-vercel-set-bypass-cookie=true`)
    return { ctx, page }
  }
  const shot = async (page, name) => { await page.evaluate(() => document.fonts?.ready).catch(() => {}); await page.screenshot({ path: `${CAPTURES}/${name}.png`, fullPage: true }); shots.push(`${name}.png`) }
  const records = (kind, name) => calls.filter((c) => c.kind === kind && c.name === name)
  const fire = (page, url) => page.evaluate((u) => window.__capFire('appUrlOpen', { url: u }), url)
  const navLog = (page) => { const navs = []; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()) }); return navs }

  /** Connexion de ProjectLead dans la vue web → écran d'ERPlead (bouton Google) → clic → page relais de l'aperçu ProjectLead. */
  async function toRelay(wv) {
    const before = authorizes.length
    await wv.page.goto(`${t.pl.url}/login`)
    await wv.page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 45_000 }).catch(() => {})
    const az = authorizes.slice(before).map((u) => new URL(u)).find((u) => u.searchParams.get('client_id') === 'projectlead')
    const g = wv.page.locator('a[href^="/auth/google/app?"]')
    const ok = (await g.count()) === 1 && /Google/.test((await g.textContent()) ?? '') && (await wv.page.locator('a[href^="/auth/apple?"]').count()) === 1 &&
      (await wv.page.locator('input[name="password"]').count()) === 1 && (await wv.page.locator('[data-google-app-hint]').count()) === 0
    if ((await g.count()) === 1) await g.click()
    await wv.page.waitForURL((u) => u.toString().startsWith(`${t.pl.url}/lead-auth/google?`), { timeout: 30_000 }).catch(() => {})
    const cookie = (await wv.ctx.cookies(t.erp.url)).find((c) => c.name === '__Host-erp_gapp')
    if (cookie) madeVh.push(sha256(cookie.value))
    return { az, plState: az?.searchParams.get('state') ?? '', button: ok, cookie, vh: cookie ? sha256(cookie.value) : '' }
  }
  /** Le navigateur sûr du téléphone ouvre le départ : jusqu'à accounts.google.com ; rend l'état Google. */
  async function openStart(sys, url) {
    const googleReq = []
    const onReq = (r) => { if (r.url().startsWith('https://accounts.google.com/o/oauth2/v2/auth')) googleReq.push(r.url()) }
    sys.page.on('request', onReq)
    await sys.page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sys.page.waitForLoadState('load').catch(() => {})
    sys.page.off('request', onReq)
    const gu = googleReq[0] ? new URL(googleReq[0]) : null
    const gstate = gu?.searchParams.get('state') ?? ''
    if (gstate) madeStates.push(sha256(gstate))
    const text = await sys.page.content().catch(() => '')
    return { gu, gstate, accepted: !!gu && new URL(sys.page.url()).host === 'accounts.google.com' &&
      !/redirect_uri_mismatch|invalid_client|disallowed_useragent|invalid_request|Error 400|Erreur 400/i.test(text) }
  }
  /** Le vrai retour de Google « annulé » (aucun appel à Google) : la réponse d'ERPlead, jamais suivie. */
  async function cancelledReturn(sys, gstate) {
    const r = await sys.ctx.request.get(`${t.erp.url}/auth/google/callback?${new URLSearchParams({ state: gstate, error: 'access_denied' })}`, { maxRedirects: 0 })
    return { status: r.status(), location: r.headers().location ?? '' }
  }
  const codeOf = (u) => { try { return new URL(u, t.erp.url).searchParams.get('code') ?? '' } catch { return '' } }

  try {
    // ================================================================ A. iOS 17.4+ : session avec retour https, connexion réussie
    const ios = await context(IOS_UA, 'webview', { kind: 'ios', platform: 'ios', https: true })
    const a = await toRelay(ios)
    check('A. vue web iOS de l’app 1.0.2 (LeadAppAuth/2) : la connexion de ProjectLead (aperçu) part vers l’autorisation d’ERPlead (aperçu) : client projectlead, platform=app, retour déclaré, PKCE S256, langue fr',
      a.az && a.az.searchParams.get('platform') === 'app' && a.az.searchParams.get('redirect_uri') === 'https://projectlead.io/auth/lead/callback' &&
      a.az.searchParams.get('code_challenge_method') === 'S256' && a.az.searchParams.get('ui_locales') === 'fr' && a.plState.length >= 20, a.az?.toString() ?? authorizes)
    check('A. écran d’ERPlead dans la vue web : bouton « Continuer avec Google » (vers /auth/google/app), Apple et mot de passe gardés, aucune phrase « Mot de passe oublié » ; le clic mène à la page relais de ProjectLead (aperçu)',
      a.button && ios.page.url().startsWith(`${t.pl.url}/lead-auth/google?start=`), ios.page.url())
    await waitFor(() => records('ios', 'session').length > 0, 20_000)
    const sessA = records('ios', 'session')
    const startA = (sessA[0]?.arg ?? '').replace(/&m=auto$/, '')
    check('A. page relais (iOS 17.4+) : LeadAuthSession.start({ url: start&m=auto }) une fois, start = départ d’ERPlead (aperçu) pour projectlead ; ni Browser.open ni Safari',
      sessA.length === 1 && sessA[0].arg.endsWith('&m=auto') && startA.startsWith(`${t.erp.url}/auth/google/app/start?d=projectlead.`) &&
      sessA[0].at.startsWith(`${t.pl.url}/lead-auth/google`) && records('ios', 'open').length === 0 && records('ios', 'external').length === 0, sessA)
    check('A. cookie verifier de la vue web (aperçu d’ERPlead) : __Host-erp_gapp HttpOnly, Secure, SameSite=Lax',
      a.cookie && a.cookie.httpOnly && a.cookie.secure && a.cookie.sameSite === 'Lax' && a.cookie.path === '/')
    const dA = new URL(startA || 'https://x.invalid').searchParams.get('d') ?? ''
    const depA = sqlRead(t.erp.ro, `select data from sso_states where state = $1 and expires_at > now()`, [sha256(dA)])
    check('A. départ noté dans la base d’APERÇU d’ERPlead : app projectlead, empreinte du verifier de cette vue web, demande d’autorisation de ProjectLead',
      depA?.provider === 'google-app-start' && depA.app === 'projectlead' && depA.vh === a.vh && depA.next?.includes('client_id=projectlead') &&
      depA.next?.includes(`state=${encodeURIComponent(a.plState)}`), depA && { app: depA.app })
    await shot(ios.page, 'g3-relais-session-ios-fr')
    // La session (ASWebAuthenticationSession, cookies de Safari) charge le départ m=auto.
    const sysA = await context(SAFARI, 'system')
    const gA = await openStart(sysA, sessA[0]?.arg ?? '')
    check('A. session iOS : le départ m=auto mène à accounts.google.com (redirect_uri https://erplead.io/auth/google/callback, state app.projectlead.…, PKCE S256, hl=fr) ; Google accepte la demande',
      gA.gu && gA.gu.searchParams.get('redirect_uri') === 'https://erplead.io/auth/google/callback' && gA.gstate.startsWith('app.projectlead.') &&
      gA.gu.searchParams.get('code_challenge_method') === 'S256' && !!gA.gu.searchParams.get('nonce') && gA.gu.searchParams.get('hl') === 'fr' && gA.accepted, sysA.page.url())
    await shot(sysA.page, 'g3-google-fr')
    const stA = sqlRead(t.erp.ro, `select data from sso_states where state = $1 and expires_at > now()`, [sha256(gA.gstate)])
    check('A. état Google de l’app en base d’APERÇU : même verifier, même demande, ouverture « auto » notée, départ consommé',
      stA?.provider === 'google' && stA.app === 'projectlead' && stA.vh === a.vh && stA.next === depA?.next && stA.open === 'auto' &&
      sqlRead(t.erp.ro, `select count(*) from sso_states where state = $1`, [sha256(dA)]) === 0, stA && { open: stA.open })
    // Retour de Google simulé : le code que le retour aurait fait (m=auto : 303 vers le lien vérifié), pour la personne TEST.
    const codeA = randomBytes(32).toString('base64url')
    madeCodes.push(sha256(codeA))
    await previewWrite(t, who.id, async (db) => {
      await db.query(`delete from sso_states where state = $1`, [sha256(gA.gstate)])
      await db.query(`insert into sso_states (state, data, expires_at) values ($1, $2, now() + interval '5 minutes')`, [sha256(codeA), JSON.stringify({
        provider: 'google-app-code', app: 'projectlead', vh: a.vh, next: stA?.next, locale: stA?.locale ?? 'fr', result: { profile: { email: who.email, name: who.name, locale: who.locale } } })])
    })
    const linkA = `${RETURN}?${new URLSearchParams({ code: codeA, locale: 'fr' })}`
    launchUrl = linkA
    await ios.page.evaluate((u) => window.__sessionDone({ url: u }), linkA)
    await waitFor(() => callbacks.length >= 1, 45_000)
    await ios.page.waitForLoadState('load').catch(() => {})
    check('A. adresse rendue par la session (https://projectlead.io/lead-auth/return?code=…) : la vue web va au rachat d’ERPlead avec ce code, une seule fois, sans Browser.close (iOS)',
      redeems.length === 1 && redeems[0] === `${t.erp.url}/auth/google/app/redeem?code=${codeA}` && records('ios', 'close').length === 0, redeems.length)
    const cb = new URL(callbacks[0] ?? 'https://x.invalid')
    check('A. rachat dans la vue web → l’autorisation de ProjectLead reprend → retour OpenID https://projectlead.io/auth/lead/callback avec un code, le state de ProjectLead et iss',
      `${cb.origin}${cb.pathname}` === 'https://projectlead.io/auth/lead/callback' && /^[A-Za-z0-9_-]{43}$/.test(cb.searchParams.get('code') ?? '') &&
      cb.searchParams.get('state') === a.plState && cb.searchParams.get('iss') === 'https://erplead.io', cb.origin + cb.pathname)
    const jar = await ios.ctx.cookies(t.erp.url)
    check('A. session ERPlead ouverte DANS la vue web (méthode google, agent de l’app 1.0.2 LeadAppAuth/2), cookie verifier effacé',
      jar.some((c) => c.name === '__Host-erp_sid') && !jar.some((c) => c.name === '__Host-erp_gapp') &&
      sqlRead(t.erp.ro, `select count(*) from sessions where user_id = $1 and method = 'google' and created_at >= $2 and user_agent like '%${AGENT}%'`,
        [who.id, startedAt.toISOString()]) >= 1)
    const plCookie = (await ios.ctx.cookies(t.pl.url)).find((c) => c.name === 'pl_lead_login')
    const raw = plCookie ? decodeURIComponent(plCookie.value) : ''
    let saved = null
    try { saved = JSON.parse(raw.slice(0, raw.lastIndexOf('.'))) } catch {}
    check('A. cookie de départ de ProjectLead (pl_lead_login, HttpOnly) : même state que le retour', plCookie?.httpOnly && saved?.state === a.plState && cb.searchParams.get('state') === saved?.state)
    const tok = await fetch(`${t.erp.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-vercel-protection-bypass': t.erp.bypass,
      authorization: `Basic ${Buffer.from(`projectlead:${encodeURIComponent(t.erp.secret)}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.searchParams.get('code') ?? '', redirect_uri: 'https://projectlead.io/auth/lead/callback',
        code_verifier: saved?.verifier ?? '' }) }).then((r) => r.json()).catch(() => ({}))
    const [h64, p64, s64] = String(tok.id_token ?? '').split('.')
    let claims = null, sigOk = false
    try {
      const head = JSON.parse(Buffer.from(h64, 'base64url').toString())
      claims = JSON.parse(Buffer.from(p64, 'base64url').toString())
      const jwks = await (await fetch(`${t.erp.url}/oauth/jwks`, { headers: { 'x-vercel-protection-bypass': t.erp.bypass } })).json()
      const jwk = jwks.keys.find((k) => k.kid === head.kid)
      sigOk = head.alg === 'RS256' && !!jwk && verifySig('sha256', Buffer.from(`${h64}.${p64}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s64, 'base64url'))
    } catch {}
    check('A. ProjectLead reçoit la personne TEST : le code du retour, échangé avec le verifier de ProjectLead, donne un jeton d’identité signé (iss erplead.io, aud projectlead, nonce de ProjectLead, adresse et organisation de la personne TEST)',
      sigOk && claims?.iss === 'https://erplead.io' && claims?.aud === 'projectlead' && claims?.nonce === saved?.nonce &&
      String(claims?.email).toLowerCase() === who.email.toLowerCase() && claims?.email_verified === true && claims?.org === who.org && claims?.exp > Date.now() / 1000,
      claims ? { iss: claims.iss, aud: claims.aud, nonceOk: claims.nonce === saved?.nonce, org: claims.org === who.org } : tok.error ?? 'pas de jeton')
    await ios.page.goto(`${t.erp.url}/account`)
    check('A. Mon compte (ERPlead) dans la vue web : la personne TEST', (await ios.page.content()).includes(who.email))
    await shot(ios.page, 'g3-compte-fr')

    // --- une seule fois : page suivante (getLaunchUrl rend le même lien), le même lien redonné, liens étrangers, schéma propre
    await ios.page.goto(`${t.pl.url}/confidentialite`)
    await waitFor(() => records('ios', 'listen').filter((c) => c.at.startsWith(`${t.pl.url}/confidentialite`)).length > 0, 10_000)
    await sleep(2500)
    const navsA = navLog(ios.page)
    await fire(ios.page, linkA)
    for (const foreign of [`io.projectlead.app://lead-auth?code=${randomBytes(32).toString('base64url')}`, `https://crmlead.io/lead-auth/return?code=${randomBytes(32).toString('base64url')}`,
      `https://www.projectlead.io/lead-auth/return?code=${randomBytes(32).toString('base64url')}`, `${t.pl.url}/lead-auth/return?code=${randomBytes(32).toString('base64url')}`])
      await fire(ios.page, foreign)
    // Sans connexion en cours : un lien vérifié venu d'ailleurs (courriel, page, code QR), code forgé ou demande échue.
    await fire(ios.page, `${RETURN}?code=${randomBytes(32).toString('base64url')}&locale=fr`)
    await fire(ios.page, `${RETURN}?error=expired&locale=fr`)
    await sleep(3000)
    check('A. page suivante de l’app : le lien de lancement déjà traité, le même lien redonné, les liens étrangers (schéma propre io.projectlead.app, autre app, www, aperçu) et un lien vérifié venu d’ailleurs (code forgé, error=expired) sont ignorés : aucun rachat, aucune navigation',
      redeems.length === 1 && navsA.length === 0 && ios.page.url() === `${t.pl.url}/confidentialite`, { redeems: redeems.length, navs: navsA.slice(0, 2) })
    // 25 h plus tard, l'app restée en mémoire (iOS : getLaunchUrl redonne le dernier lien ouvert) : chargement complet d'une page.
    const later = await ios.ctx.newPage()
    await later.addInitScript(() => { const real = Date.now.bind(Date); Date.now = () => real() + 25 * 3600 * 1000 })
    const listensBefore = records('ios', 'listen').length
    await later.goto(`${t.pl.url}/confidentialite`)
    await waitFor(() => records('ios', 'listen').length > listensBefore, 10_000)
    await sleep(3000)
    check('A. 25 h plus tard (horloge de la page avancée) : le lien de lancement de la veille n’est jamais rejoué', redeems.length === 1 && later.url() === `${t.pl.url}/confidentialite`)
    await later.close()
    launchUrl = null

    // --- la page /lead-auth/return chargée DANS la vue web (aperçu : autre origine que le lien réservé) → l'accueil, sans rachat
    const navsK = navLog(ios.page)
    await ios.page.goto(`${t.pl.url}/lead-auth/return?code=${randomBytes(32).toString('base64url')}&locale=fr`)
    await waitFor(() => navsK.some((u) => u === `${t.pl.url}/`), 15_000)
    check('A. page /lead-auth/return chargée dans la vue web de l’app : même traitement qu’un lien reçu (adresse d’aperçu, aucune connexion en cours) → l’accueil de l’app, jamais de rachat',
      navsK.includes(`${t.pl.url}/`) && redeems.length === 1, navsK.slice(0, 3))

    // ================================================================ D. iOS 17.4+ : session annulée, puis départ rejoué (lien d'erreur)
    // Nouvelle vue web (la précédente a maintenant une session ERPlead : l'autorisation n'y montrerait plus l'écran de connexion).
    await ios.ctx.close()
    const iosD = await context(IOS_UA, 'webview', { kind: 'iosD', platform: 'ios', https: true })
    const d1 = await toRelay(iosD)
    await waitFor(() => records('iosD', 'session').length >= 1, 20_000)
    const navsD1 = navLog(iosD.page)
    await iosD.page.evaluate(() => window.__sessionDone({ code: 'canceled' }))
    await waitFor(() => navsD1.length > 0, 15_000)
    check('D. session annulée (canceled) : la vue web revient à l’écran de connexion de l’app chez ERPlead (back), jamais Safari, jamais de rachat',
      d1.button && records('iosD', 'session').length === 1 && navsD1[0]?.startsWith(`${t.erp.url}/login?next=`) && records('iosD', 'external').length === 0 &&
      redeems.length === 1, navsD1.slice(0, 2))
    // Le départ de A, déjà consommé, rouvert en m=auto : ERPlead renvoie le lien d'erreur vérifié (redirection, jamais suivie).
    const replayAuto = await sysA.ctx.request.get(`${startA}&m=auto`, { maxRedirects: 0, headers: { 'accept-language': ACCEPT_FR } })
    const errAuto = replayAuto.headers().location ?? ''
    check('D. départ rejoué (m=auto) : 303 vers le lien vérifié d’erreur https://projectlead.io/lead-auth/return?error=expired&locale=fr (jamais suivi)',
      replayAuto.status() === 303 && errAuto === `${RETURN}?error=expired&locale=fr`, { status: replayAuto.status(), loc: errAuto })
    const d2 = await toRelay(iosD)
    await waitFor(() => records('iosD', 'session').length >= 2, 20_000)
    const navsD2 = navLog(iosD.page)
    await iosD.page.evaluate((u) => window.__sessionDone({ url: u }), errAuto)
    await waitFor(() => navsD2.length > 0, 15_000)
    check('D. session revenue avec ce lien d’erreur (pendant une connexion en cours) : l’écran de connexion de l’app (back), jamais de rachat',
      d2.button && navsD2[0]?.startsWith(`${t.erp.url}/login?next=`) && !navsD2[0]?.includes('error=') && redeems.length === 1, navsD2.slice(0, 2))
    await iosD.ctx.close(); await sysA.ctx.close()

    // ================================================================ B. Android : Custom Tab, vrai retour « annulé » (m=auto)
    const and = await context(ANDROID_UA, 'webview', { kind: 'android', platform: 'android' })
    const b = await toRelay(and)
    await waitFor(() => records('android', 'open').length > 0, 20_000)
    const opensB = records('android', 'open')
    const startB = (opensB[0]?.arg ?? '').replace(/&m=auto$/, '')
    check('B. vue web Android (LeadAppAuth/2) : bouton Google chez ERPlead, page relais → Browser.open({ url: start&m=auto }) une fois (Custom Tab), écoute de browserFinished, jamais la session iOS',
      b.button && opensB.length === 1 && opensB[0].arg.endsWith('&m=auto') && startB.startsWith(`${t.erp.url}/auth/google/app/start?d=projectlead.`) &&
      records('android', 'listen').some((c) => c.arg === 'Browser:browserFinished') && records('android', 'session').length === 0, opensB)
    await and.page.waitForSelector('[data-lead-auth-back]', { timeout: 10_000 }).catch(() => {})
    const h1B = await and.page.locator('h1').first().textContent().catch(() => '')
    const relayB = await and.page.locator('[data-lead-auth-relay]').textContent().catch(() => '')
    check(`B. page relais (Android) : « ${T.fr['shell.leadAuth.title']} », « ${T.fr['shell.leadAuth.body'].slice(0, 40)}… », lien « ${T.fr['shell.leadAuth.back']} » vers l’écran de connexion de l’app`,
      h1B === T.fr['shell.leadAuth.title'] && relayB.includes(T.fr['shell.leadAuth.body']) &&
      ((await and.page.locator('[data-lead-auth-back]').getAttribute('href').catch(() => null)) ?? '').startsWith(`${t.erp.url}/login?next=`))
    await shot(and.page, 'g3-relais-android-fr')
    const tab = await context(CHROME_ANDROID, 'system')
    const gB = await openStart(tab, opensB[0]?.arg ?? '')
    check('B. Custom Tab : le départ m=auto mène à accounts.google.com, Google accepte la demande', gB.accepted && gB.gstate.startsWith('app.projectlead.'), tab.page.url())
    const cancelB = await cancelledReturn(tab, gB.gstate)
    const codeB = codeOf(cancelB.location)
    check('B. vrai retour de Google « annulé » (error=access_denied, aucun appel à Google) en m=auto : 303 vers le lien vérifié https://projectlead.io/lead-auth/return?code=<43>&locale=fr (redirection serveur, celle que Chrome ouvre en App Link ; jamais suivie)',
      cancelB.status === 303 && cancelB.location === `${RETURN}?code=${codeB}&locale=fr` && /^[A-Za-z0-9_-]{43}$/.test(codeB), { status: cancelB.status, loc: cancelB.location })
    madeCodes.push(sha256(codeB))
    const navsB = navLog(and.page)
    await fire(and.page, cancelB.location)
    await waitFor(() => navsB.some((u) => u.startsWith(`${t.erp.url}/login?`)), 30_000)
    check('B. App Link reçu (appUrlOpen) : Browser.close une fois, rachat dans la vue web, puis l’écran de connexion de l’app chez ERPlead avec l’erreur Google (error=google)',
      records('android', 'close').length === 1 && redeems.length === 2 && redeems[1] === `${t.erp.url}/auth/google/app/redeem?code=${codeB}` &&
      navsB.some((u) => u.startsWith(`${t.erp.url}/login?`) && new URL(u).searchParams.get('error') === 'google'), { navs: navsB.slice(0, 3), redeems: redeems.length })
    await shot(and.page, 'g3-annule-android-fr')
    // Le même départ rouvert en m=auto (rejoué) : le lien d'erreur ; pendant une nouvelle connexion, il ramène à back.
    const b2 = await toRelay(and)
    await waitFor(() => records('android', 'open').length >= 2, 20_000)
    const replayB = await tab.ctx.request.get(`${startB}&m=auto`, { maxRedirects: 0, headers: { 'accept-language': ACCEPT_FR } })
    const navsB2 = navLog(and.page)
    await fire(and.page, replayB.headers().location ?? '')
    await waitFor(() => navsB2.length > 0, 15_000)
    check('B. départ rejoué en m=auto → lien d’erreur vérifié ; reçu pendant une connexion en cours : Browser.close, l’écran de connexion de l’app (back), jamais de rachat',
      b2.button && replayB.status() === 303 && replayB.headers().location === `${RETURN}?error=expired&locale=fr` && navsB2[0]?.startsWith(`${t.erp.url}/login?next=`) &&
      records('android', 'close').length === 2 && redeems.length === 2, { loc: replayB.headers().location, navs: navsB2.slice(0, 2) })
    await and.ctx.close(); await tab.ctx.close()

    // ================================================================ C. iOS 15 à 17.3 : Safari (m=tap), vrai retour « annulé », bouton
    const old = await context(IOS_OLD_UA, 'webview', { kind: 'ios16', platform: 'ios', https: false })
    const c = await toRelay(old)
    await waitFor(() => records('ios16', 'external').length > 0, 20_000)
    const extC = records('ios16', 'external')
    await old.page.waitForSelector('[data-lead-auth-relay][data-mode="safari"] [data-lead-auth-back]', { timeout: 10_000 }).catch(() => {})
    const relayC = await old.page.locator('[data-lead-auth-relay]').textContent().catch(() => '')
    check(`C. vue web iOS 16 (session https indisponible) : page relais → Safari (openExternal({ url: start&m=tap })) une fois, jamais la session ; texte « ${T.fr['shell.leadAuth.safari']} » et « Retour »`,
      c.button && extC.length === 1 && extC[0].arg.endsWith('&m=tap') && extC[0].arg.startsWith(`${t.erp.url}/auth/google/app/start?d=projectlead.`) &&
      records('ios16', 'session').length === 0 && relayC.includes(T.fr['shell.leadAuth.safari']) && relayC.includes(T.fr['shell.leadAuth.back']), { extC, relayC })
    await shot(old.page, 'g3-relais-safari-fr')
    const saf = await context(SAFARI, 'system')
    const gC = await openStart(saf, extC[0]?.arg ?? '')
    check('C. Safari : le départ m=tap mène à accounts.google.com, Google accepte la demande ; ouverture « tap » notée', gC.accepted &&
      sqlRead(t.erp.ro, `select data->'open' from sso_states where state = $1`, [sha256(gC.gstate)]) === 'tap', saf.page.url())
    const cancelC = await cancelledReturn(saf, gC.gstate)
    const codeC = codeOf(cancelC.location)
    madeCodes.push(sha256(codeC))
    check('C. vrai retour « annulé » en m=tap : 303 vers la page d’erplead.io /auth/google/app/return?app=projectlead&code=…&locale=fr (pas de redirection vers l’app : Safari la chargerait comme une page)',
      cancelC.status === 303 && cancelC.location === `/auth/google/app/return?${new URLSearchParams({ app: 'projectlead', code: codeC, locale: 'fr' })}`, { status: cancelC.status, loc: cancelC.location })
    const retResp = await saf.page.goto(`${t.erp.url}${cancelC.location}`)
    const retHtml = await saf.page.content()
    const btn = unesc((await saf.page.locator('a[data-app-return]').getAttribute('href').catch(() => null)) ?? '')
    check('C. page « Revenez dans ProjectLead » (Safari) : bouton « Ouvrir ProjectLead » vers le lien vérifié https://projectlead.io/lead-auth/return?code=…&locale=fr, ni redirection automatique ni script, Referrer-Policy: no-referrer',
      btn === `${RETURN}?code=${codeC}&locale=fr` && !/http-equiv="refresh"/i.test(retHtml) && !/<script\b/i.test(retHtml) && retResp?.headers()['referrer-policy'] === 'no-referrer' &&
      ((await saf.page.locator('a[data-app-return]').textContent()) ?? '').includes('ProjectLead'), btn.slice(0, 60))
    await shot(saf.page, 'g3-retour-bouton-fr')
    const navsC = navLog(old.page)
    await fire(old.page, btn)
    await waitFor(() => navsC.some((u) => u.startsWith(`${t.erp.url}/login?`)), 30_000)
    check('C. le bouton touché (Universal Link → appUrlOpen) : rachat dans la vue web (sans Browser.close), puis l’écran de connexion de l’app avec l’erreur Google',
      redeems.length === 3 && redeems[2] === `${t.erp.url}/auth/google/app/redeem?code=${codeC}` && records('ios16', 'close').length === 0 &&
      navsC.some((u) => u.startsWith(`${t.erp.url}/login?`) && new URL(u).searchParams.get('error') === 'google'), navsC.slice(0, 3))
    await old.ctx.close(); await saf.ctx.close()

    // ================================================================ H. Android : app tuée pendant le Custom Tab, relancée par l'App Link
    // Relecture du 30.10.2026 (2e, point « moyenne ») : Android tue l'app pendant la connexion Google ; l'App Link démarre une
    // activité neuve, la coque charge l'accueil https://projectlead.io/ (server.url) et rend le lien par getLaunchUrl. Sans
    // session, l'accueil est l'écran de connexion, qui partait seul vers le Compte Lead et annulait le rachat en route. Ici :
    // une page NEUVE de la même vue web (mêmes cookies et localStorage), l'accueil de l'aperçu, rachat retenu 4 s (la vraie
    // chaîne : TLS vers erplead.io, rachat en base, 303, 302).
    const andH = await context(ANDROID_UA, 'webview', { kind: 'androidH', platform: 'android' })
    const h = await toRelay(andH)
    await waitFor(() => records('androidH', 'open').length > 0, 20_000)
    const tabH = await context(CHROME_ANDROID, 'system')
    const gH = await openStart(tabH, records('androidH', 'open')[0]?.arg ?? '')
    const cancelH = await cancelledReturn(tabH, gH.gstate)
    const codeH = codeOf(cancelH.location)
    madeCodes.push(sha256(codeH))
    await andH.page.close()
    const home = await andH.ctx.newPage()
    const startsH = [], heldH = []
    home.on('request', (r) => { if (r.isNavigationRequest() && r.url().startsWith(`${t.pl.url}/auth/lead/start`)) startsH.push(r.url()) })
    await home.route(`${t.erp.url}/auth/google/app/redeem?*`, async (route) => {
      heldH.push(Date.now())
      await sleep(4000)
      await route.fallback().catch(() => {})
    })
    const navsH = navLog(home)
    launchUrl = cancelH.location
    await home.goto(`${t.pl.url}/`, { waitUntil: 'commit' })
    await waitFor(() => navsH.some((u) => u.startsWith(`${t.erp.url}/login?`)), 45_000)
    const loginH = navsH.find((u) => u.startsWith(`${t.erp.url}/login?`)) ?? ''
    check('H. Android, app tuée pendant le Custom Tab puis relancée par l’App Link : l’accueil sans session lit le lien de lancement → rachat (retenu 4 s) ; l’écran de connexion ne part PAS seul vers le Compte Lead ; une seule fermeture, l’écran de connexion d’ERPlead avec l’erreur Google (retour « annulé »)',
      h.button && gH.accepted && cancelH.status === 303 && /^[A-Za-z0-9_-]{43}$/.test(codeH) && heldH.length === 1 && startsH.length === 0 &&
      redeems.length === 4 && redeems[3] === `${t.erp.url}/auth/google/app/redeem?code=${codeH}` && records('androidH', 'close').length === 1 &&
      new URL(loginH || 'https://x.invalid').searchParams.get('error') === 'google', { starts: startsH, held: heldH.length, redeems: redeems.length, navs: navsH.slice(0, 4) })
    launchUrl = null
    await andH.ctx.close(); await tabH.ctx.close()

    // ================================================================ I. iOS 16 : page relais rechargée pendant la connexion dans Safari
    // Relecture du 30.10.2026 (2e, point « basse ») : iOS tue le processus WebContent de l'app pendant que la personne est
    // dans Safari ; Capacitor recharge la page relais (bridge.reset(), webView.reload()) ; le Universal Link du bouton
    // « Ouvrir ProjectLead » arrive par getLaunchUrl. La page ne rouvre pas Safari (départ déjà servi) et rachète le code.
    const oldI = await context(IOS_OLD_UA, 'webview', { kind: 'ios16I', platform: 'ios', https: false })
    const ci = await toRelay(oldI)
    await waitFor(() => records('ios16I', 'external').length > 0, 20_000)
    const safI = await context(SAFARI, 'system')
    const gI = await openStart(safI, records('ios16I', 'external')[0]?.arg ?? '')
    const cancelI = await cancelledReturn(safI, gI.gstate)
    const codeI = codeOf(cancelI.location)
    madeCodes.push(sha256(codeI))
    const navsI = navLog(oldI.page)
    launchUrl = `${RETURN}?code=${codeI}&locale=fr`
    const relayUrlI = oldI.page.url()
    await oldI.page.reload({ waitUntil: 'commit' })
    await waitFor(() => navsI.some((u) => u.startsWith(`${t.erp.url}/login?`)), 45_000)
    const loginI = navsI.find((u) => u.startsWith(`${t.erp.url}/login?`)) ?? ''
    check('I. iOS 16, page relais RECHARGÉE pendant la connexion dans Safari (processus WebContent tué), Universal Link relu par getLaunchUrl : Safari jamais rouvert (départ déjà servi), rachat une fois, puis l’écran de connexion d’ERPlead avec l’erreur Google',
      ci.button && relayUrlI.startsWith(`${t.pl.url}/lead-auth/google?start=`) && gI.accepted && cancelI.status === 303 && records('ios16I', 'external').length === 1 &&
      redeems.length === 5 && redeems[4] === `${t.erp.url}/auth/google/app/redeem?code=${codeI}` && records('ios16I', 'close').length === 0 &&
      new URL(loginI || 'https://x.invalid').searchParams.get('error') === 'google', { externals: records('ios16I', 'external').length, redeems: redeems.length, navs: navsI.slice(0, 4) })
    launchUrl = null
    await oldI.ctx.close(); await safI.ctx.close()

    // ================================================================ E. textes de la page relais (cinq langues, Custom Tab et Safari)
    for (const [kind, ua, bridge, mode] of [['android', ANDROID_UA, { kind: 'android-lang', platform: 'android' }, 'browser'],
      ['ios16', IOS_OLD_UA, { kind: 'ios16-lang', platform: 'ios', https: false }, 'safari']]) {
      const lang = await context(ua, 'webview', bridge)
      const ok = {}
      for (const l of LOCALES) {
        await lang.page.goto(`${t.pl.url}/confidentialite`)
        await lang.page.evaluate((x) => localStorage.setItem('pl.lang', x), l)
        await lang.page.goto(`${t.pl.url}/lead-auth/google?${new URLSearchParams({ start: `${t.erp.url}/auth/google/app/start?d=projectlead.essai-${l}`,
          back: `${t.erp.url}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dprojectlead&locale=${l}` })}`)
        await lang.page.waitForSelector(`[data-lead-auth-relay][data-mode="${mode}"] [data-lead-auth-back]`, { timeout: 10_000 }).catch(() => {})
        const title = await lang.page.locator('h1').first().textContent().catch(() => '')
        const body = await lang.page.locator('[data-lead-auth-relay]').textContent().catch(() => '')
        ok[l] = title === T[l]['shell.leadAuth.title'] && body.includes(T[l][mode === 'safari' ? 'shell.leadAuth.safari' : 'shell.leadAuth.body']) && body.includes(T[l]['shell.leadAuth.back']) &&
          !/safari/i.test(body)
        if (l !== 'fr') await shot(lang.page, `g3-relais-${mode}-${l}`)
      }
      check(`E. page relais (${kind}, mode ${mode}) dans les cinq langues : titre, texte ${mode === 'safari' ? '« Terminez la connexion dans votre navigateur… » (jamais « Safari »)' : '« La connexion Google s’ouvre… »'}, « Retour »`,
        Object.values(ok).every(Boolean) && records(bridge.kind, mode === 'safari' ? 'external' : 'open').length === 5, ok)
      await lang.ctx.close()
    }

    // ================================================================ F. page /lead-auth/return dans le navigateur (l'app ne s'est pas ouverte)
    for (const [l, ua, android, device] of [['fr', SAFARI, false, 'Safari iOS'], ['de', CHROME_ANDROID, true, 'Chrome Android'], ['en', SAFARI, false, 'Safari iOS'],
      ['it', CHROME_ANDROID, true, 'Chrome Android'], ['es', SAFARI, false, 'Safari iOS'], ['fr', IPAD_DESKTOP, false, 'iPad en mode ordinateur']]) {
      const br = await context(ua, 'system')
      const reqs = []
      br.page.on('request', (r) => reqs.push({ url: r.url(), referer: r.headers().referer ?? null }))
      const fake = randomBytes(32).toString('base64url')
      const resp = await br.page.goto(`${t.pl.url}/lead-auth/return?code=${fake}&locale=${l}`)
      await br.page.waitForSelector('[data-lead-auth-return]:not([hidden])', { timeout: 10_000 }).catch(() => {})
      const txt = async (sel) => (await br.page.locator(sel).textContent().catch(() => '')) ?? ''
      const androidShown = await br.page.locator('[data-android]').isVisible().catch(() => false)
      const iosShown = await br.page.locator('[data-ios]').isVisible().catch(() => false)
      const href = await br.page.evaluate(() => location.href)
      const page = await br.page.content()
      const pass = resp?.status() === 200 && !resp?.request().redirectedFrom() && resp?.headers()['cache-control'] === 'no-store' &&
        resp?.headers()['referrer-policy'] === 'no-referrer' && resp?.headers()['x-robots-tag'] === 'noindex' &&
        href === `${t.pl.url}/lead-auth/return` && !page.includes(fake) && (await br.page.locator('a, button, form').count()) === 0 &&
        (await txt('h1')) === R[l]['leadauth.return.title'] && (await txt('[data-body]')) === R[l]['leadauth.return.body'] &&
        (await txt('[data-nothing]')) === R[l]['leadauth.return.nothing'] && androidShown === android && (!android || (await txt('[data-android]')) === R[l]['leadauth.return.android']) &&
        iosShown === !android && (android || (await txt('[data-ios]')) === R[l]['leadauth.return.ios']) &&
        (await br.page.title()) === R[l]['leadauth.return.title'] && (await br.page.evaluate(() => document.documentElement.lang)) === l &&
        reqs.slice(1).every((r) => r.url.startsWith(`${t.pl.url}/`) && !r.referer) && reqs.every((r) => !/fonts\.googleapis|gstatic|google-analytics|googletagmanager/.test(r.url))
      check(`F. /lead-auth/return hors de l’app (${device}, ${l}) : 200 sans redirection, no-store / no-referrer / noindex, code effacé de l’adresse et de la page, « ${R[l]['leadauth.return.title']} », que faire${android ? ', « Ouvrir par défaut »' : ', iPhone et iPad : appui long sur « Ouvrir ProjectLead », Safari par défaut'}, « rien demandé », aucun lien ni bouton, aucune ressource tierce ni Referer`,
        pass, { status: resp?.status(), href, android: androidShown, ios: iosShown, reqs: reqs.slice(0, 6).map((r) => `${new URL(r.url).pathname} ${r.referer ? 'referer' : ''}`) })
      await shot(br.page, `g3-page-retour-${android ? 'android' : ua === IPAD_DESKTOP ? 'ipad' : 'ios'}-${l}`)
      await br.ctx.close()
    }

    // ================================================================ G. anciennes versions, site web, page relais hors de l'app
    for (const [name, ua] of [['1.0.1 publiée (sans jeton)', OLD_UA], ['1.0.2 du schéma propre (LeadAppAuth/1, jamais envoyée)', V1_UA]]) {
      const o = await context(ua, 'webview', { kind: 'old', platform: 'ios', https: true })
      await o.page.goto(`${t.pl.url}/login`)
      await o.page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 45_000 }).catch(() => {})
      check(`G. ancienne version de l’app (${name}) : aucun bouton Google, la phrase « Mot de passe oublié ? », Apple`,
        (await o.page.locator('a[href*="/auth/google"]').count()) === 0 && (await o.page.locator('[data-google-app-hint]').count()) === 1 &&
        (await o.page.locator('a[href^="/auth/apple?"]').count()) === 1)
      if (ua === OLD_UA) await shot(o.page, 'g3-ancienne-version-fr')
      await o.ctx.close()
    }
    const web = await context(DESKTOP, 'desktop')
    const before = authorizes.length
    await web.page.goto(`${t.pl.url}/login`)
    await web.page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 45_000 }).catch(() => {})
    const waz = authorizes.slice(before).map((u) => new URL(u)).find((u) => u.searchParams.get('client_id') === 'projectlead')
    const wg = web.page.locator('a[href^="/auth/google"]')
    check('G. site web (navigateur d’ordinateur) : connexion sans platform=app, « Continuer avec Google » ordinaire (/auth/google?next=…, même navigateur)',
      waz && !waz.searchParams.get('platform') && (await wg.count()) === 1 && ((await wg.getAttribute('href')) ?? '').startsWith('/auth/google?next=') &&
      (await web.page.locator('[data-google-app-hint]').count()) === 0, waz?.toString())
    const backWeb = `${t.erp.url}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dprojectlead&locale=fr`
    await web.page.goto(`${t.pl.url}/lead-auth/google?${new URLSearchParams({ start: `${t.erp.url}/auth/google/app/start?d=projectlead.essai-web`, back: backWeb })}`)
    await web.page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 20_000 }).catch(() => {})
    check('G. page relais ouverte hors de l’app (aucun pont) : retour à back, rien d’ouvert', web.page.url() === backWeb && !calls.some((x) => x.arg.includes('essai-web')), web.page.url())
    await web.ctx.close()

    check('Google ne s’ouvre jamais dans une vue web (aucune requête vers accounts.google.com depuis la vue web)', googleInWebview.length === 0, googleInWebview)
    check('aucune requête des navigateurs vers la production (projectlead.io, erplead.io) : page relais et retour OpenID interceptés, liens vérifiés jamais suivis', prodHits.length === 0, prodHits.slice(0, 5))
  } finally {
    await browser.close()
    await restorePreview(t, who, startedAt, { states: madeStates, vh: madeVh, codes: madeCodes }, orgAppBefore, ratesBefore)
  }
  checkRestored(t, who, startedAt, { states: madeStates, vh: madeVh, codes: madeCodes }, orgAppBefore, ratesBefore)
  note(`captures : ${CAPTURES}/ (${shots.length}) ${shots.join(', ')}`)
  finish('G3')
}

// ------------------------------------------------------------------ G4 : le binaire Android 1.0.2 sur un émulateur

/**
 * Relecture du 30.10.2026 (2e, point « basse ») : G3 décide elle-même de l'ordre des événements natifs (faux pont) ; le
 * Custom Tab et l'App Link y sont imités. G4 fait tourner le VRAI binaire 1.0.2 (l'AAB prêt pour Play, en APK universel
 * re-signé avec une clé d'essai jetable pour l'installer) sur un émulateur Android (AVD pixel36, Android 16, Google APIs,
 * Chrome et WebView, démarré en lecture seule), avec un vrai Custom Tab de Chrome : Browser.open, la page de Google (simulée)
 * touchée ou qui avance seule, la REDIRECTION SERVEUR 303 vers https://projectlead.io/lead-auth/return?code=… que Chrome remet
 * à MainActivity (App Link : domaine approuvé hors ligne par pm set-app-links-user-selection, comme une vérification
 * réussie), appUrlOpen ou getLaunchUrl, Browser.close, le rachat dans la vraie WebView ; l'app tuée pendant le Custom Tab
 * (activité neuve, accueil) ; la contre-épreuve sans approbation (page de repli dans Chrome, code jamais racheté).
 * WebView et Chrome résolvent projectlead.io, erplead.io et accounts.google.com vers un relais local
 * (--host-resolver-rules, certificat du relais accepté par son empreinte SPKI : fichiers de ligne de commande de Chrome et
 * de la WebView, appareil « userdebug ») qui transmet aux APERÇUS (ProjectLead et ERPlead) ; Google est simulé (aucun
 * compte) : sa page, et la fin de son retour (la 303 d'ERPlead vers le lien vérifié pour un code préparé dans la base
 * d'APERÇU, comme en G3) ; le retour « annulé » est le VRAI d'ERPlead. Le retour OpenID vers ProjectLead est intercepté par
 * le relais et échangé comme en G3. iOS : aucun Mac ici, rien n'est essayé (le dire dans le rapport).
 */
const ANDROID_SDK = `${HOME}/android-sdk`
const BUNDLETOOL = `${HOME}/outils/bundletool-all-1.18.1.jar`
const ADB = `${ANDROID_SDK}/platform-tools/adb`
const EMULATOR = `${ANDROID_SDK}/emulator/emulator`
const AVD = 'pixel36'
/** Un port à part (ScanLead : 5584) : l'AVD en lecture seule peut tourner plusieurs fois. */
const EMU_PORT = 5588
const SERIAL = `emulator-${EMU_PORT}`
const APP_ID = 'io.projectlead.app'
const AAB_PATH = `${PUBLICATIONS}/projectlead-1.0.2-3.aab`
/** Le rachat retenu par le relais en E (la vraie chaîne : TLS vers erplead.io, rachat en base, 303, 302). */
const HOLD_MS = 4000

/** adb sans bloquer le relais (même processus) : sortie texte, ou octets (capture d'écran). */
function adbA(args, { binary = false, timeout = 120_000 } = {}) {
  return new Promise((ok) => {
    const child = spawn(ADB, ['-s', SERIAL, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = [], err = []
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeout)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('close', (status) => {
      clearTimeout(timer)
      const buf = Buffer.concat(out)
      ok({ status, stdout: binary ? buf : buf.toString('utf8'), out: buf.toString('utf8') + Buffer.concat(err).toString('utf8') })
    })
  })
}
async function bootEmulator() {
  if (run(ADB, ['devices']).stdout.includes(`${SERIAL}\tdevice`)) return { started: false, stop: () => {} }
  const proc = spawn(EMULATOR, ['-avd', AVD, '-port', String(EMU_PORT), '-read-only', '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot',
    '-gpu', 'swiftshader_indirect', '-memory', '3072', '-cores', '3'], { stdio: 'ignore', env: { ...process.env, ANDROID_SDK_ROOT: ANDROID_SDK, ANDROID_HOME: ANDROID_SDK } })
  const stop = () => { try { proc.kill('SIGTERM') } catch {} }
  process.on('exit', stop)
  for (let i = 0; i < 100; i++) {
    if ((await adbA(['shell', 'getprop', 'sys.boot_completed'], { timeout: 10_000 })).stdout.trim() === '1') break
    await sleep(3000)
  }
  return { started: true, stop }
}
const unescXml = (v) => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ').replace(/&amp;/g, '&')
/** L'écran (uiautomator) : nœuds avec texte, description, paquet, centre. */
async function uiNodes() {
  for (let i = 0; i < 4; i++) {
    const d = await adbA(['shell', 'uiautomator', 'dump', '/data/local/tmp/g4-ui.xml'], { timeout: 30_000 })
    if (/dumped to/i.test(d.out)) break
    await sleep(700)
  }
  const xml = (await adbA(['shell', 'cat', '/data/local/tmp/g4-ui.xml'])).stdout
  return [...xml.matchAll(/<node\b([^>]*?)\/?>/g)].map((m) => {
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], unescXml(x[2])]))
    const b = (a.bounds ?? '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
    return { text: a.text ?? '', desc: a['content-desc'] ?? '', pkg: a.package ?? '', cls: a.class ?? '', click: a.clickable === 'true',
      x: b ? (Number(b[1]) + Number(b[3])) / 2 : 0, y: b ? (Number(b[2]) + Number(b[4])) / 2 : 0, w: b ? Number(b[3]) - Number(b[1]) : 0, h: b ? Number(b[4]) - Number(b[2]) : 0 }
  })
}
/** Toucher le premier nœud visible qui répond à `match` (attente au plus `ms`). */
async function tapNode(match, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const n = (await uiNodes()).find((x) => x.w > 0 && x.h > 0 && match(x))
    if (n) { await adbA(['shell', 'input', 'tap', String(Math.round(n.x)), String(Math.round(n.y))]); return n }
    await sleep(1000)
  }
  return null
}
const activities = async () => (await adbA(['shell', 'dumpsys', 'activity', 'activities'])).stdout
const topActivity = async () => ((await activities()).match(/topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)/) ?? [])[1] ?? ''
const activityStack = async () => [...(await activities()).matchAll(/ActivityRecord\{\S+ \S+ (\S+) t\d+/g)].map((m) => m[1])
const appPid = async () => (await adbA(['shell', 'pidof', APP_ID])).stdout.trim()

/**
 * Relais HTTPS local pour projectlead.io, erplead.io et accounts.google.com (Chrome et WebView : --host-resolver-rules) :
 * les vraies adresses du protocole restent dans la vue web et dans Chrome (lien vérifié, cookies __Host- d'erplead.io),
 * chaque requête part vers l'APERÇU correspondant (protection passée par l'en-tête de contournement) ; les origines des
 * aperçus sont remises en adresses de production dans les redirections et les réponses texte (l'émetteur que donne
 * /api/auth/options devient https://erplead.io, comme en production). `own` répond à la place des aperçus (Google simulé,
 * fin du retour de Google, retour OpenID intercepté) ; `hold` retient une requête. La production n'est jamais jointe :
 * Chrome et la WebView ne résolvent plus ces trois noms que vers ce relais. Chaque requête est notée.
 */
async function startRelay(t, dir, { own, hold }) {
  const https = await import('node:https')
  const log = []
  const hop = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding', 'content-length', 'te', 'trailer'])
  const toProd = (v) => v.split(t.pl.url).join('https://projectlead.io').split(t.erp.url).join('https://erplead.io')
  async function handle(req, res) {
    const host = String(req.headers.host ?? '').split(':')[0].toLowerCase()
    const entry = { host, method: req.method, path: req.url, at: Date.now(), ua: String(req.headers['user-agent'] ?? '') }
    log.push(entry)
    const mine = own ? await own(host, req, entry) : null
    if (mine) {
      entry.status = mine.status; entry.to = 'relais'
      if (mine.headers?.location) entry.location = mine.headers.location
      res.writeHead(mine.status, mine.headers ?? {})
      return res.end(mine.body ?? '')
    }
    const base = host === 'projectlead.io' ? t.pl.url : host === 'erplead.io' ? t.erp.url : null
    if (!base) { entry.status = 421; res.writeHead(421); return res.end() }
    const wait = hold ? hold(host, req) : 0
    if (wait) { entry.held = wait; await sleep(wait) }
    const chunks = []
    for await (const c of req) chunks.push(c)
    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) if (!hop.has(k) && !k.startsWith('proxy-')) headers[k] = Array.isArray(v) ? v.join(', ') : v
    headers['x-vercel-protection-bypass'] = base === t.pl.url ? t.pl.bypass : t.erp.bypass
    headers['x-vercel-skip-toolbar'] = '1'
    headers['accept-encoding'] = 'identity'
    const r = await fetch(base + req.url, { method: req.method, headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) })
    entry.status = r.status
    const out = {}
    r.headers.forEach((v, k) => { if (!hop.has(k) && !['content-encoding', 'set-cookie'].includes(k)) out[k] = v })
    if (r.headers.get('location')) out.location = entry.location = toProd(r.headers.get('location'))
    const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.replace(/;\s*Domain=[^;]*/i, ''))
    if (cookies.length) out['set-cookie'] = cookies
    let body = Buffer.from(await r.arrayBuffer())
    if (/^(text\/html|application\/json)/.test(r.headers.get('content-type') ?? '')) body = Buffer.from(toProd(body.toString('utf8')))
    res.writeHead(r.status, out)
    res.end(req.method === 'HEAD' ? undefined : body)
  }
  const server = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
    handle(req, res).catch((e) => { log.push({ error: e.message }); try { res.writeHead(502); res.end() } catch {} })
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  return { port: server.address().port, log, close: () => server.close() }
}

async function gateG4() {
  console.log('G4 — le binaire Android 1.0.2 sur un émulateur : vrai Custom Tab de Chrome, vraie redirection serveur vers l’App Link, vraie WebView')
  const t = await targets()
  if (failures) finish('G4')
  const who = benchPerson(t)
  const { orgApp: orgAppBefore, rates: ratesBefore } = previewBefore(t, who)
  const startedAt = new Date()
  const made = { states: [], vh: [], codes: [] }
  const dir = mkdtempSync(join(tmp, 'g4-'))
  mkdirSync(CAPTURES, { recursive: true })
  const shots = []
  const shot = async (name) => {
    const png = await adbA(['exec-out', 'screencap', '-p'], { binary: true })
    if (png.status === 0 && png.stdout.length > 1000) { writeFileSync(join(CAPTURES, `${name}.png`), png.stdout); shots.push(`${name}.png`) }
  }
  const screen = async () => (await uiNodes().catch(() => [])).filter((n) => n.text || n.desc).slice(0, 25).map((n) => `[${n.pkg.split('.').pop()}] ${(n.text || n.desc).slice(0, 60)}`)

  // --- 1. Le binaire : l'AAB prêt pour Play (intact), en APK universel re-signé avec une clé d'essai jetable
  const aabSum = createHash('sha256').update(readFileSync(AAB_PATH)).digest('hex')
  const built = JSON.parse(readFileSync(`${CAPTURES}/android-1.0.2-3.json`, 'utf8'))
  check(`AAB 1.0.2 (versionCode 3) prêt pour Play, intact (sha256 ${aabSum.slice(0, 12)}… = celui construit par G2, dépôt mobile ${String(built.mobileCommit).slice(0, 7)})`,
    aabSum === built.sha256 && run('git', ['-C', MOBILE, 'rev-parse', 'HEAD']).stdout.trim() === built.mobileCommit)
  const ks = join(dir, 'essai.jks')
  run('keytool', ['-genkeypair', '-keystore', ks, '-storepass', 'essai-g4', '-keypass', 'essai-g4', '-alias', 'essai', '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '2', '-dname', 'CN=essai emulateur G4'])
  const apks = run('java', ['-jar', BUNDLETOOL, 'build-apks', `--bundle=${AAB_PATH}`, `--output=${join(dir, 'u.apks')}`, '--mode=universal', `--ks=${ks}`,
    '--ks-pass=pass:essai-g4', '--ks-key-alias=essai', '--key-pass=pass:essai-g4', '--overwrite'], { timeout: 600_000 })
  run('unzip', ['-o', '-q', join(dir, 'u.apks'), 'universal.apk', '-d', dir])
  check('APK universel tiré de cet AAB par bundletool (même code ; seule la signature diffère : clé d’essai jetable)', apks.status === 0 && existsSync(join(dir, 'universal.apk')), lastLine(apks.stderr))
  if (failures) finish('G4')

  // --- 2. L'émulateur et l'app
  const emu = await bootEmulator()
  const chromeV = ((await adbA(['shell', 'dumpsys', 'package', 'com.android.chrome'])).stdout.match(/versionName=(\S+)/) ?? [])[1]
  const props = (await adbA(['shell', 'getprop'])).stdout
  check(`émulateur ${SERIAL} (AVD ${AVD}, ${emu.started ? 'démarré par la porte, ' : ''}lecture seule) : Android ${props.match(/\[ro\.build\.version\.release\]: \[([^\]]+)\]/)?.[1]}, « userdebug », Chrome ${chromeV}`,
    /\[sys\.boot_completed\]: \[1\]/.test(props) && /\[ro\.build\.type\]: \[userdebug\]/.test(props) && !!chromeV)
  await adbA(['uninstall', APP_ID])
  const inst = await adbA(['install', join(dir, 'universal.apk')], { timeout: 300_000 })
  const pkg = (await adbA(['shell', 'dumpsys', 'package', APP_ID])).stdout
  check('app installée : io.projectlead.app 1.0.2 (versionCode 3)', /Success/.test(inst.out) && /versionCode=3\b/.test(pkg) && /versionName=1\.0\.2\b/.test(pkg), inst.out.slice(-300))
  if (failures) { emu.stop(); finish('G4') }
  const approve = async (on) => {
    await adbA(['shell', 'pm', 'set-app-links', '--package', APP_ID, '0', 'all'])
    await adbA(['shell', 'pm', 'set-app-links-user-selection', '--user', 'cur', '--package', APP_ID, on ? 'true' : 'false', 'projectlead.io'])
    return (await adbA(['shell', 'pm', 'get-app-links', '--user', 'cur', APP_ID])).stdout
  }
  const links = await approve(true)
  check('App Link : projectlead.io déclaré par l’app ; approuvé hors ligne pour l’essai (« selected », comme une vérification réussie)', /projectlead\.io/.test(links) && /Selection state:[\s\S]*Enabled:[\s\S]*projectlead\.io/.test(links), links.trim().slice(0, 400))

  // --- 3. Relais, Google simulé, retour OpenID intercepté
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=relais-g4', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' })
  const spki = execFileSync('sh', ['-c', `openssl x509 -in '${join(dir, 'c.pem')}' -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`], { encoding: 'utf8' }).trim()
  /** La page de Google : `tap` (la personne touche son compte) ou `auto` (elle avance seule après `delay` ms : validation faite ailleurs). */
  const google = { mode: 'tap', delay: 6000, auth: [], code: null, errors: [], last: null }
  const callbacks = []
  let holdRedeem = 0
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font-family:sans-serif;margin:24px"><h1 style="font-size:22px">${title}</h1>${body}</body></html>`
  const own = async (host, req) => {
    const u = new URL(req.url, `https://${host}`)
    if (host === 'accounts.google.com') {
      if (u.pathname === '/o/oauth2/v2/auth') {
        const state = u.searchParams.get('state') ?? ''
        google.auth.push({ state, redirect: u.searchParams.get('redirect_uri'), ua: String(req.headers['user-agent'] ?? ''), at: Date.now() })
        const go = `/g4/continue?state=${encodeURIComponent(state)}`
        const cancel = `https://erplead.io/auth/google/callback?${new URLSearchParams({ state, error: 'access_denied' })}`
        return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: page('Google (simulé, porte G4)',
          `<p>Choisissez un compte pour continuer vers erplead.io</p><a href="${go}" style="display:block;padding:28px;border:1px solid #888;font-size:24px;text-decoration:none">Personne TEST G4</a>` +
          `<p style="margin-top:40px"><a href="${cancel.replace(/&/g, '&amp;')}" style="display:block;padding:20px;font-size:20px">Annuler G4</a></p>` +
          (google.mode === 'auto' ? `<p>Validation sur l’autre appareil…</p><script>setTimeout(function () { location.replace(${JSON.stringify(go)}) }, ${google.delay})</script>` : '')) }
      }
      if (u.pathname === '/g4/continue') {
        // Ce que le retour de Google aurait fait : identité vérifiée → code de transfert (base d'APERÇU, personne TEST).
        const state = u.searchParams.get('state') ?? ''
        const st = sqlRead(t.erp.ro, `select data from sso_states where state = $1 and expires_at > now()`, [sha256(state)])
        if (st?.provider !== 'google' || st.app !== 'projectlead') { google.errors.push(`état Google inconnu : ${st?.provider}`); return { status: 400, body: 'état inconnu' } }
        made.states.push(sha256(state)); made.vh.push(st.vh)
        const code = randomBytes(32).toString('base64url')
        made.codes.push(sha256(code))
        await previewWrite(t, who.id, async (db) => {
          await db.query(`delete from sso_states where state = $1`, [sha256(state)])
          await db.query(`insert into sso_states (state, data, expires_at) values ($1, $2, now() + interval '5 minutes')`, [sha256(code), JSON.stringify({
            provider: 'google-app-code', app: 'projectlead', vh: st.vh, next: st.next, locale: st.locale, result: { profile: { email: who.email, name: who.name, locale: who.locale } } })])
        })
        google.code = code
        google.last = { open: st.open, locale: st.locale }
        return { status: 302, headers: { location: `https://erplead.io/auth/google/callback?state=${encodeURIComponent(state)}&code=g4-simule` } }
      }
      return { status: 204, headers: {} }
    }
    if (host === 'erplead.io' && u.pathname === '/auth/google/callback' && u.searchParams.get('code') === 'g4-simule' && google.code) {
      // googleAppCallback d'ERPlead après la vérification de l'identité, ouverture « auto » : 303 vers le lien vérifié.
      return { status: 303, headers: { location: `${RETURN}?${new URLSearchParams({ code: google.code, locale: google.last?.locale ?? 'fr' })}` } }
    }
    if (host === 'projectlead.io' && u.pathname === '/auth/lead/callback') {
      const cookie = String(req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith('pl_lead_login='))?.slice('pl_lead_login='.length) ?? ''
      callbacks.push({ query: u.searchParams, cookie, ua: String(req.headers['user-agent'] ?? ''), at: Date.now() })
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: page('ProjectLead (porte G4)', '<p data-callback>Retour OpenID reçu par la porte G4 (jamais envoyé à projectlead.io).</p>') }
    }
    return null
  }
  const hold = (host, req) => (host === 'erplead.io' && req.url.startsWith('/auth/google/app/redeem?') ? holdRedeem : 0)
  const relay = await startRelay(t, dir, { own, hold })
  const since = (i) => relay.log.slice(i)
  const isApp = (e) => e.ua.includes(AGENT) && /; wv\)/.test(e.ua)
  const isChrome = (e) => /Chrome\/\d+/.test(e.ua) && !e.ua.includes('ProjectLeadApp') && !/; wv\)/.test(e.ua)
  const waitLog = async (from, fn, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { const e = since(from).find(fn); if (e) return e; await sleep(250) } return null }
  const kindOf = (e) => (isApp(e) ? 'app' : isChrome(e) ? 'chrome' : 'autre')
  /** Le fil des requêtes depuis `from` (qui, quoi, statut, délai depuis `t0`), codes masqués. */
  const trace = (from, t0, n = 14) => since(from).filter((e) => e.host !== 'accounts.google.com' || e.path.startsWith('/g4')).slice(0, n)
    .map((e) => `${kindOf(e)} ${e.method} ${e.host}${String(e.path).replace(/code=[A-Za-z0-9_-]{20,}/g, 'code=<…>').slice(0, 48)} ${e.status ?? '?'}${e.held ? ' retenu' : ''} +${e.at - t0} ms`)
  const flags = `_ --host-resolver-rules="MAP projectlead.io 10.0.2.2:${relay.port},MAP erplead.io 10.0.2.2:${relay.port},MAP accounts.google.com 10.0.2.2:${relay.port}" ` +
    `--ignore-certificate-errors-spki-list=${spki} --disable-fre --no-default-browser-check --no-first-run`
  writeFileSync(join(dir, 'cmdline'), `${flags}\n`)
  for (const f of ['chrome-command-line', 'webview-command-line']) await adbA(['push', join(dir, 'cmdline'), `/data/local/tmp/${f}`])
  await adbA(['shell', 'chmod', '644', '/data/local/tmp/chrome-command-line', '/data/local/tmp/webview-command-line'])
  await adbA(['shell', 'am', 'force-stop', 'com.android.chrome'])

  /** Le token du retour OpenID, échangé comme le ferait le serveur de ProjectLead : la personne TEST ? */
  async function exchanged(cb) {
    let saved = null
    try { const raw = decodeURIComponent(cb.cookie); saved = JSON.parse(raw.slice(0, raw.lastIndexOf('.'))) } catch {}
    const tok = await fetch(`${t.erp.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-vercel-protection-bypass': t.erp.bypass,
      authorization: `Basic ${Buffer.from(`projectlead:${encodeURIComponent(t.erp.secret)}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.query.get('code') ?? '', redirect_uri: 'https://projectlead.io/auth/lead/callback',
        code_verifier: saved?.verifier ?? '' }) }).then((r) => r.json()).catch(() => ({}))
    const [h64, p64, s64] = String(tok.id_token ?? '').split('.')
    try {
      const head = JSON.parse(Buffer.from(h64, 'base64url').toString())
      const claims = JSON.parse(Buffer.from(p64, 'base64url').toString())
      const jwks = await (await fetch(`${t.erp.url}/oauth/jwks`, { headers: { 'x-vercel-protection-bypass': t.erp.bypass } })).json()
      const jwk = jwks.keys.find((k) => k.kid === head.kid)
      const sig = head.alg === 'RS256' && !!jwk && verifySig('sha256', Buffer.from(`${h64}.${p64}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s64, 'base64url'))
      return sig && claims.iss === 'https://erplead.io' && claims.aud === 'projectlead' && claims.nonce === saved?.nonce && cb.query.get('state') === saved?.state &&
        String(claims.email).toLowerCase() === who.email.toLowerCase() && claims.org === who.org
    } catch { return false }
  }
  /** App neuve (stockages effacés) → l'accueil part seul vers le Compte Lead → écran d'ERPlead → « Continuer avec Google ». */
  async function toGoogle(label) {
    await adbA(['shell', 'am', 'force-stop', APP_ID])
    await adbA(['shell', 'pm', 'clear', APP_ID])
    await approve(true)
    const f0 = relay.log.length
    await adbA(['shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`])
    const home = await waitLog(f0, (e) => e.host === 'projectlead.io' && e.path === '/' && isApp(e), 90_000)
    const login = await waitLog(f0, (e) => e.host === 'erplead.io' && e.path.startsWith('/login?') && isApp(e), 90_000)
    await sleep(2500)
    const gb = await tapNode((n) => n.pkg === APP_ID && /Google/.test(n.text || n.desc) && !/Apple/.test(n.text || n.desc), 60_000)
    const relayHit = await waitLog(f0, (e) => e.host === 'projectlead.io' && e.path.startsWith('/lead-auth/google?') && isApp(e), 60_000)
    const start = await waitLog(f0, (e) => e.host === 'erplead.io' && e.path.startsWith('/auth/google/app/start?') && isChrome(e), 60_000)
    const auth = await waitLog(f0, (e) => e.host === 'accounts.google.com' && e.path.startsWith('/o/oauth2/v2/auth') && isChrome(e), 60_000)
    await sleep(1500)
    const top = await topActivity()
    const ok = !!home && !!login && !!gb && !!relayHit && !!start && /&m=auto$/.test(start.path) && !!auth && /com\.android\.chrome\//.test(top)
    if (!ok) note(`${label} : accueil ${!!home}, ERPlead ${!!login}, bouton ${!!gb}, relais ${!!relayHit}, départ ${start?.path?.slice(-8)}, Google ${!!auth}, premier plan ${top} ; écran : ${(await screen()).join(' | ')}`)
    return { ok, from: f0, start, state: google.auth.at(-1)?.state ?? '' }
  }
  const noteState = (state) => {
    if (!state) return
    made.states.push(sha256(state))
    const vh = sqlRead(t.erp.ro, `select data->'vh' from sso_states where state = $1`, [sha256(state)])
    if (vh) made.vh.push(vh)
  }
  const tapAccount = () => tapNode((n) => n.pkg === 'com.android.chrome' && /Personne TEST G4/.test(n.text || n.desc), 45_000)
  const results = {}

  try {
    // ======== A + B. Connexion Google : compte touché dans le Custom Tab → 303 d'ERPlead vers le lien vérifié → l'app
    google.mode = 'tap'
    const b = await toGoogle('B')
    check('A. binaire 1.0.2 lancé : la WebView charge https://projectlead.io (relais), agent « … ProjectLeadApp/1.0.2 LeadAppAuth/2 » ; sans session, l’accueil part vers le Compte Lead : écran d’ERPlead, bouton Google',
      b.ok, b.start?.path)
    await shot('g4-1-custom-tab-google-simule')
    noteState(b.state)
    const accB = await tapAccount()
    const retB = await waitLog(b.from, (e) => e.host === 'erplead.io' && e.path.startsWith('/auth/google/callback?') && e.status === 303, 45_000)
    const redeemB = await waitLog(b.from, (e) => e.host === 'erplead.io' && e.path.startsWith('/auth/google/app/redeem?') && isApp(e), 30_000)
    const cbB = await waitLog(b.from, (e) => e.host === 'projectlead.io' && e.path.startsWith('/auth/lead/callback') && isApp(e), 60_000)
    await sleep(3000)
    const topB = await topActivity(), stackB = await activityStack()
    const fallbackB = since(b.from).filter((e) => e.host === 'projectlead.io' && e.path.startsWith('/lead-auth/return'))
    note(`B. fil après le compte touché : ${retB ? trace(relay.log.indexOf(retB) - 2, retB.at).join(' | ') : 'aucune 303'}`)
    check(`B. compte touché dans le Custom Tab de Chrome → 303 d’ERPlead (fin du retour de Google, ouverture « ${google.last?.open} ») vers https://projectlead.io/lead-auth/return?code=… → Chrome remet le lien à l’app (App Link) → rachat dans la WebView ${redeemB && retB ? ((redeemB.at - retB.at) / 1000).toFixed(1) : '?'} s après, avec ce code, une fois, jamais par Chrome`,
      !!accB && !!retB && retB.location === `${RETURN}?code=${google.code}&locale=${google.last?.locale}` && google.last?.open === 'auto' &&
      !!redeemB && redeemB.path === `/auth/google/app/redeem?code=${google.code}` && since(b.from).filter((e) => e.path?.startsWith('/auth/google/app/redeem')).length === 1,
      { acc: !!accB, ret: retB?.location?.slice(0, 50), fallback: fallbackB.map((e) => `${kindOf(e)} ${e.status}`), redeem: !!redeemB, errors: google.errors })
    results.fallbackB = fallbackB.map((e) => ({ by: kindOf(e), status: e.status, after: retB ? e.at - retB.at : null }))
    check(`B. Browser.close : le Custom Tab refermé, l’app au premier plan (${topB})`, topB.startsWith(`${APP_ID}/`) && !stackB.some((a) => /CustomTabActivity|BrowserControllerActivity/.test(a)), stackB.slice(0, 6))
    check('B. rachat → autorisation de ProjectLead reprise → retour OpenID https://projectlead.io/auth/lead/callback depuis la WebView → échangé : jeton signé de la personne TEST (aud projectlead, nonce et state de ProjectLead)',
      !!cbB && callbacks.length >= 1 && await exchanged(callbacks.at(-1)), cbB?.path?.slice(0, 40))
    await shot('g4-2-retour-openid-projectlead')
    results.tap = !!redeemB

    // ======== C. La page de Google avance SEULE (validation sur un autre appareil : aucun geste dans le Custom Tab)
    for (const delay of [6000, 20000]) {
      google.mode = 'auto'; google.delay = delay
      const c = await toGoogle(`C ${delay / 1000} s`)
      noteState(c.state)
      const retC = await waitLog(c.from, (e) => e.host === 'erplead.io' && e.path.startsWith('/auth/google/callback?') && e.status === 303, delay + 45_000)
      const redeemC = await waitLog(c.from, (e) => e.host === 'erplead.io' && e.path.startsWith('/auth/google/app/redeem?') && isApp(e), 20_000)
      const fallbackC = since(c.from).filter((e) => e.host === 'projectlead.io' && e.path.startsWith('/lead-auth/return'))
      note(`C ${delay / 1000} s. fil après la 303 : ${retC ? trace(relay.log.indexOf(retC) - 2, retC.at).join(' | ') : 'aucune 303'}`)
      await sleep(2000)
      if (!redeemC) await shot(`g4-3-page-qui-avance-seule-${delay / 1000}s`)
      results[`auto${delay / 1000}`] = { appOpened: !!redeemC, fallback: fallbackC.map((e) => `${kindOf(e)} ${e.status}`), top: await topActivity() }
      check(`C. page de Google qui avance SEULE après ${delay / 1000} s (aucun geste dans le Custom Tab) → 303 vers le lien vérifié : Chrome remet quand même le lien à l’app, rachat dans la WebView ${redeemC && retC ? ((redeemC.at - retC.at) / 1000).toFixed(1) : '?'} s après`,
        c.ok && !!retC && !!redeemC && redeemC.path === `/auth/google/app/redeem?code=${google.code}`, results[`auto${delay / 1000}`])
    }
    google.mode = 'tap'

    // ======== D. Retour « annulé » : la VRAIE 303 d'ERPlead (aperçu) vers le lien vérifié, code d'échec → l'app
    const d = await toGoogle('D')
    noteState(d.state)
    const cancelD = await tapNode((n) => n.pkg === 'com.android.chrome' && /Annuler G4/.test(n.text || n.desc), 45_000)
    const retD = await waitLog(d.from, (e) => e.host === 'erplead.io' && e.path.startsWith('/auth/google/callback?') && /error=access_denied/.test(e.path), 45_000)
    const redeemD = await waitLog(d.from, (e) => e.host === 'erplead.io' && e.path.startsWith('/auth/google/app/redeem?') && isApp(e), 30_000)
    const loginD = await waitLog(d.from, (e) => e.host === 'erplead.io' && e.path.startsWith('/login?') && /error=google/.test(e.path) && isApp(e), 30_000)
    const codeD = new URL(retD?.location ?? 'https://x.invalid').searchParams.get('code') ?? ''
    if (codeD) made.codes.push(sha256(codeD))
    check('D. « Annuler » dans le Custom Tab → VRAIE réponse d’ERPlead (aperçu, error=access_denied) : 303 vers https://projectlead.io/lead-auth/return?code=… → l’app (App Link) → rachat → écran de connexion d’ERPlead avec l’erreur Google, dans la WebView',
      d.ok && !!cancelD && retD?.to !== 'relais' && retD?.status === 303 && (retD?.location ?? '').startsWith(`${RETURN}?code=${codeD}&locale=`) &&
      /^[A-Za-z0-9_-]{43}$/.test(codeD) && redeemD?.path === `/auth/google/app/redeem?code=${codeD}` && !!loginD, { ret: retD && { status: retD.status, to: retD.to, loc: retD.location?.slice(0, 50) }, redeem: !!redeemD, login: !!loginD })
    await shot('g4-4-annule-erreur-google')

    // ======== E. L'app TUÉE pendant le Custom Tab, relancée par l'App Link : activité neuve, accueil, aucun départ seul
    // E1 : tuée 35 s après « Continuer avec Google » (la personne tape son mot de passe) ; E0 : tuée 5 s après (mémoire
    // basse, Custom Tab lourd), avant que la WebView n'ait pu écrire ses cookies sur le disque d'elle-même.
    await adbA(['root'], { timeout: 60_000 })
    await sleep(3000)
    for (const [label, wait] of [['E0', 5000], ['E1', 35_000]]) {
      const e = await toGoogle(label)
      noteState(e.state)
      await sleep(wait)
      const pidBefore = await appPid()
      await adbA(['shell', 'kill', '-9', pidBefore])
      await sleep(2000)
      const pidGone = (await appPid()) === ''
      holdRedeem = HOLD_MS
      const fE = relay.log.length
      const accE = await tapAccount()
      const homeE = await waitLog(fE, (x) => x.host === 'projectlead.io' && x.path === '/' && isApp(x), 60_000)
      const redeemE = await waitLog(fE, (x) => x.host === 'erplead.io' && x.path.startsWith('/auth/google/app/redeem?') && isApp(x), 45_000)
      const cbE = await waitLog(fE, (x) => x.host === 'projectlead.io' && x.path.startsWith('/auth/lead/callback') && isApp(x), 45_000)
      holdRedeem = 0
      const departsE = since(fE).filter((x) => x.host === 'projectlead.io' && x.path.startsWith('/auth/lead/start') && isApp(x))
      const pidAfter = await appPid()
      note(`${label}. fil après le compte touché : ${trace(fE, relay.log[fE]?.at ?? Date.now(), 18).join(' | ')}`)
      results[label] = { killedAfterMs: wait, redeem: redeemE?.status ?? null, redeemTo: redeemE?.location?.replace(/code=[^&]+/, 'code=<…>')?.slice(0, 60) ?? null, callback: !!cbE, departs: departsE.length }
      check(`${label}. app tuée ${wait / 1000} s après « Continuer avec Google », pendant le Custom Tab (processus ${pidBefore} arrêté), compte touché → App Link → activité neuve (processus ${pidAfter || '?'}), la WebView charge l’accueil et lit le lien → rachat (retenu ${HOLD_MS / 1000} s par le relais) ; l’écran de connexion ne part PAS seul vers le Compte Lead ; retour OpenID de la personne TEST`,
        e.ok && !!pidBefore && pidGone && !!accE && !!homeE && !!redeemE && redeemE.held === HOLD_MS && redeemE.path === `/auth/google/app/redeem?code=${google.code}` &&
        departsE.length === 0 && !!pidAfter && pidAfter !== pidBefore && !!cbE && await exchanged(callbacks.at(-1)),
        { pidBefore, pidGone, pidAfter, home: !!homeE, ...results[label] })
      await shot(`g4-5-app-relancee-${label}`)
    }

    // ======== F. Contre-épreuve : domaine NON approuvé → Chrome charge la page de repli, le code n'est jamais racheté
    const f = await toGoogle('F')
    noteState(f.state)
    const linksF = await approve(false)
    const fF = relay.log.length
    await tapAccount()
    const fallbackF = await waitLog(fF, (x) => x.host === 'projectlead.io' && x.path.startsWith('/lead-auth/return?') && isChrome(x), 45_000)
    await sleep(3000)
    const redeemF = since(fF).filter((x) => x.path?.startsWith('/auth/google/app/redeem'))
    const topF = await topActivity()
    await shot('g4-6-sans-app-link-page-de-repli')
    check('F. contre-épreuve, domaine NON approuvé (App Link inactif) : la même 303 → Chrome charge la page de repli https://projectlead.io/lead-auth/return (servie par l’aperçu), le code n’est jamais racheté, Chrome reste au premier plan',
      f.ok && !/Enabled:[\s\S]*projectlead\.io/.test(linksF.split('Selection state:')[1] ?? '') && !!fallbackF && fallbackF.status === 200 && redeemF.length === 0 && /com\.android\.chrome\//.test(topF),
      { fallback: fallbackF && fallbackF.status, redeem: redeemF.length, top: topF })
  } catch (err) {
    check('déroulé de la porte sans exception', false, String(err?.stack ?? err).slice(0, 400))
  } finally {
    check(`production jamais jointe : ${relay.log.length} requêtes de Chrome et de la WebView vers projectlead.io, erplead.io, accounts.google.com, toutes servies par le relais local`,
      relay.log.length > 0 && relay.log.every((x) => !x.error), relay.log.filter((x) => x.error).map((x) => x.error))
    relay.close()
    await adbA(['shell', 'am', 'force-stop', APP_ID])
    await adbA(['shell', 'pm', 'clear', APP_ID])
    await adbA(['uninstall', APP_ID])
    await adbA(['shell', 'rm', '-f', '/data/local/tmp/chrome-command-line', '/data/local/tmp/webview-command-line', '/data/local/tmp/g4-ui.xml'])
    await adbA(['shell', 'am', 'force-stop', 'com.android.chrome'])
    emu.stop()
    await restorePreview(t, who, startedAt, made, orgAppBefore, ratesBefore).catch((err) => check('base d’APERÇU remise comme avant', false, err.message))
  }
  checkRestored(t, who, startedAt, made, orgAppBefore, ratesBefore)
  note(`résultats : ${JSON.stringify(results)}`)
  note(`captures : ${CAPTURES}/ (${shots.length}) ${shots.join(', ')} ; iOS non essayé (aucun Mac ici : IPA par Codemagic, non déclenché)`)
  finish('G4')
}

// ------------------------------------------------------------------ entrée

const gate = process.argv[2]
if (gate === 'G1') gateG1()
else if (gate === 'G2') gateG2()
else if (gate === 'APERCU') await deployPreview()
else if (gate === 'G3') await gateG3()
else if (gate === 'G4') await gateG4()
else { console.log('usage : node scripts/google-app-gates.mjs G1|G2|APERCU|G3|G4'); process.exit(2) }
