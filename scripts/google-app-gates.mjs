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
//                                             web inchangés ; base d'aperçu remise comme avant
//
// Chaque porte vérifie vraiment et n'imprime son jeton GOOGLE_APP_Gx_OK qu'à la toute fin, si aucun contrôle n'a échoué.
// Aucun secret affiché (adresses de base, jetons, codes, cookies masqués). Fichiers lus (hors dépôt, 600) :
// ~/.projectlead-actions-apercu.env (base de l'aperçu ProjectLead), ~/projets/.unlazy/assistant-ia/projectlead-bypass.secret,
// ~/.erplead-apercu.env (base d'APERÇU d'ERPlead : écriture pour G3 seulement, autour d'une personne TEST du banc ; secret
// du client projectlead de l'aperçu), ~/.erplead-bypass, ~/.android-signing/projectlead-upload.env, ~/projets/lead-e2e/state.json.
// Jamais une base de production, jamais un déploiement de production, jamais un envoi aux stores.
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
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
const PROD_BASE = '38053b3f266ae98438fd3b586beaaa23a63f4846'
/** Le dépôt mobile : la version publiée (Play 1.0.1, versionCode 2 ; TestFlight 1.0.1 (2)) et la branche des constructions iOS. */
const MOBILE_BASE = '310966e'
const PUBLISHED_VERSION_CODE = 2
/** Les fichiers servis par un déploiement : le code d'un aperçu doit être celui de HEAD. */
const APP_PATHS = ['src', 'server', 'public', 'index.html', 'lead-auth-return.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json',
  'vercel.json', 'scripts/vercel-build.mjs', 'tailwind.config.js', 'postcss.config.js', 'db', 'trait-net']
/** Ce que le chantier a le droit de toucher depuis la production (tout autre fichier = débordement). */
const ALLOWED = [/^src\/lib\/leadAppAuth\.ts$/, /^src\/pages\/LeadAuthGoogle\.tsx$/, /^src\/App\.tsx$/, /^src\/main\.tsx$/, /^src\/leadAuthReturn\.ts$/,
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
  ['page de retour : cinq langues', 'page de retour : quatre textes dans les cinq langues'],
  ['site web : aucun pont reconnu', 'site web (aucun pont, pont web, isNativePlatform faux ou cassé) : aucun pont natif reconnu'],
  ['site web : aucun écouteur', 'site web : listen() ne pose aucun écouteur, aucun lien traité'],
  ['toutes les pages, au démarrage', 'src/main.tsx : l’écoute du lien de retour démarre avant le premier rendu, sur toutes les pages'],
  ['route publique', 'la page relais est une route publique (sans session) : /lead-auth/google, et seulement elle'],
  ['routes Vercel (fonction, application)', 'Vercel : /lead-auth/google et /lead-auth/return servies sans la fonction'],
  ['route Vercel de la page de retour (en-têtes)', 'Vercel : /lead-auth/return → lead-auth-return.html (réécriture, pas de redirection)'],
  ['fichiers d’association exacts (contrat)', 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json) : 200, application/json, aucune redirection, contenu EXACT du contrat'],
  ['/api/auth/options → leadIssuer', '/api/auth/options → leadIssuer : LEAD_ID_ISSUER (production, aperçu, local), crmlead.io → erplead.io'],
  ['page relais : cinq langues, texte Safari', 'page relais rendue dans les cinq langues (titre, texte ; « Retour » prêt) ; texte « Safari »'],
  ['page relais : texte Safari affiché', 'page relais : sous iOS 15 à 17.3 (mode safari)'],
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
    from: '    await Promise.race([launchRead, new Promise((r) => globalThis.setTimeout(r, LAUNCH_WAIT_MS))])\n', to: '',
    breaks: 'page relais : le lien que la coque redonne au chargement (lent à venir) est lu avant de poser l’attente' },
  { name: 'page relais : connexion notée avant non effacée', file: LIB, from: '    if (opts.relayPage) setPending(false)\n', to: '',
    breaks: 'page relais : une connexion notée avant est effacée AVANT de lire le lien de lancement' },
  { name: 'attente laissée après un abandon (Browser.open en erreur, session annulée)', file: LIB,
    from: 'const giveUp = (back: string) => { setPending(false); if (!returned) env.replace(back) }', to: 'const giveUp = (back: string) => { if (!returned) env.replace(back) }',
    breaks: 'Browser.open en erreur : back, et aucune connexion laissée en cours' },
  { name: 'session finie après le lien : Safari ou back quand même', file: LIB, from: "      if (returned) return { outcome: 'session', back: t.back }\n", to: '',
    breaks: 'iOS 17.4+ : lien reçu par appUrlOpen pendant la session' },
  { name: 'navigateur refermé : back même après le retour (Android)', file: LIB, from: 'env.setTimeout(() => { if (!returned) giveUp(t.back) }, FINISH_GRACE_MS)',
    to: 'env.setTimeout(() => { setPending(false); env.replace(t.back) }, FINISH_GRACE_MS)',
    breaks: 'navigateur refermé APRÈS le lien de retour (Browser.close) : seulement le rachat, jamais back' },
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
  { name: 'lien d’erreur gardé comme vu', file: LIB, from: '    if (!errorLink) {\n', to: '    if (true) {\n',
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
  { name: 'page de retour gardée en cache (Vercel)', file: 'scripts/vercel-build.mjs', from: "headers: { 'Cache-Control': 'no-store', ", to: 'headers: { ',
    breaks: 'Vercel : /lead-auth/return → lead-auth-return.html' },
  { name: 'assetlinks.json sans la clé d’envoi', file: 'server/routes/appLinks.ts',
    from: "  'E1:42:CC:0C:43:67:1C:EC:CA:C6:3D:32:31:C3:4D:57:E4:5A:3E:AD:F0:27:D1:3B:27:64:B5:C8:43:4A:5E:2A',\n", to: '',
    breaks: 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json)' },
  { name: 'apple-app-site-association sans webcredentials (la session iOS refuserait le retour https)', file: 'server/routes/appLinks.ts',
    from: '  webcredentials: { apps: [IOS_APP_ID] },\n', to: '', breaks: 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json)' },
  { name: 'fichiers d’association en text/plain', file: 'server/routes/appLinks.ts', from: "'Content-Type': 'application/json'", to: "'Content-Type': 'text/plain'",
    breaks: 'fichiers d’association (/.well-known/apple-app-site-association et assetlinks.json)' },
  { name: 'émetteur du serveur ignoré', file: 'server/routes/auth.ts', from: 'leadIssuer: leadIssuer() }', to: "leadIssuer: 'https://erplead.io' }",
    breaks: '/api/auth/options → leadIssuer : LEAD_ID_ISSUER (production, aperçu, local), crmlead.io → erplead.io' },
  { name: 'écoute absente au démarrage', file: 'src/main.tsx', from: '\nleadAppAuth().listen({ relayPage: window.location.pathname === RELAY_PATH })\n', to: '\n',
    breaks: 'src/main.tsx : l’écoute du lien de retour démarre avant le premier rendu, sur toutes les pages' },
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
  check(`branche ${BRANCH} : la production actuelle (${PROD_BASE.slice(0, 7)}, tête de projectlead-ia-limites) y est fusionnée`,
    run('git', ['merge-base', '--is-ancestor', PROD_BASE, 'HEAD']).status === 0 && run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() === BRANCH &&
    run('git', ['-C', `${HOME}/projets/projectlead-ia-limites`, 'rev-parse', 'HEAD']).stdout.trim() === PROD_BASE)
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

const { chromium } = createRequire('/usr/lib/node_modules/')('playwright')
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPHONE_16 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36'
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
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
  const orgAppBefore = sqlRead(t.erp.ro, `select json_build_object('last_at', last_at) from org_apps where org_id = $1 and app = 'projectlead'`, [who.org])
  const ratesBefore = sqlRead(t.erp.ro, `select coalesce(json_agg(json_build_object('key', key, 'count', count, 'reset_at', reset_at)), '[]'::json) from rate_limits where key like 'gapp|%'`)
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
      const r = await ctx.request.get(url, { maxRedirects: 0, headers: { 'user-agent': ua } })
      const loc = r.headers().location
      if (r.status() >= 300 && r.status() < 400 && loc) { url = new URL(loc, url).toString(); continue }
      // Une page : le navigateur la charge lui-même (même adresse, aucun effet de bord : écran de connexion, compte, page de l'app).
      return route.fulfill({ status: 302, headers: { location: url } })
    }
    prodHits.push(`trop de redirections : ${url}`)
    return route.abort()
  }
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
    await ctx.route(PROD_HOSTS, (route) => { prodHits.push(route.request().url()); return route.abort() })
    if (kind !== 'system') await ctx.route((u) => CHAINED.test(u.toString()), (route) => (route.request().isNavigationRequest() ? chained(ctx, ua, route) : route.continue()))
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
        ok[l] = title === T[l]['shell.leadAuth.title'] && body.includes(T[l][mode === 'safari' ? 'shell.leadAuth.safari' : 'shell.leadAuth.body']) && body.includes(T[l]['shell.leadAuth.back'])
        if (l !== 'fr') await shot(lang.page, `g3-relais-${mode}-${l}`)
      }
      check(`E. page relais (${kind}, mode ${mode}) dans les cinq langues : titre, texte ${mode === 'safari' ? '« Terminez la connexion dans Safari… »' : '« La connexion Google s’ouvre… »'}, « Retour »`,
        Object.values(ok).every(Boolean) && records(bridge.kind, mode === 'safari' ? 'external' : 'open').length === 5, ok)
      await lang.ctx.close()
    }

    // ================================================================ F. page /lead-auth/return dans le navigateur (l'app ne s'est pas ouverte)
    for (const [l, ua, android] of [['fr', SAFARI, false], ['de', CHROME_ANDROID, true], ['en', SAFARI, false], ['it', CHROME_ANDROID, true], ['es', SAFARI, false]]) {
      const br = await context(ua, 'system')
      const reqs = []
      br.page.on('request', (r) => reqs.push({ url: r.url(), referer: r.headers().referer ?? null }))
      const fake = randomBytes(32).toString('base64url')
      const resp = await br.page.goto(`${t.pl.url}/lead-auth/return?code=${fake}&locale=${l}`)
      await br.page.waitForSelector('[data-lead-auth-return]:not([hidden])', { timeout: 10_000 }).catch(() => {})
      const txt = async (sel) => (await br.page.locator(sel).textContent().catch(() => '')) ?? ''
      const androidShown = await br.page.locator('[data-android]').isVisible().catch(() => false)
      const href = await br.page.evaluate(() => location.href)
      const page = await br.page.content()
      const pass = resp?.status() === 200 && !resp?.request().redirectedFrom() && resp?.headers()['cache-control'] === 'no-store' &&
        resp?.headers()['referrer-policy'] === 'no-referrer' && resp?.headers()['x-robots-tag'] === 'noindex' &&
        href === `${t.pl.url}/lead-auth/return` && !page.includes(fake) && (await br.page.locator('a, button, form').count()) === 0 &&
        (await txt('h1')) === R[l]['leadauth.return.title'] && (await txt('[data-body]')) === R[l]['leadauth.return.body'] &&
        (await txt('[data-nothing]')) === R[l]['leadauth.return.nothing'] && androidShown === android && (!android || (await txt('[data-android]')) === R[l]['leadauth.return.android']) &&
        (await br.page.title()) === R[l]['leadauth.return.title'] && (await br.page.evaluate(() => document.documentElement.lang)) === l &&
        reqs.slice(1).every((r) => r.url.startsWith(`${t.pl.url}/`) && !r.referer) && reqs.every((r) => !/fonts\.googleapis|gstatic|google-analytics|googletagmanager/.test(r.url))
      check(`F. /lead-auth/return hors de l’app (${android ? 'Chrome Android' : 'Safari iOS'}, ${l}) : 200 sans redirection, no-store / no-referrer / noindex, code effacé de l’adresse et de la page, « ${R[l]['leadauth.return.title']} », que faire${android ? ', « Ouvrir par défaut »' : ''}, « rien demandé », aucun lien ni bouton, aucune ressource tierce ni Referer`,
        pass, { status: resp?.status(), href, android: androidShown, reqs: reqs.slice(0, 6).map((r) => `${new URL(r.url).pathname} ${r.referer ? 'referer' : ''}`) })
      await shot(br.page, `g3-page-retour-${android ? 'android' : 'ios'}-${l}`)
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
    // --- base d'APERÇU d'ERPlead remise comme avant, autour de la personne TEST : sessions, codes et jetons OpenID, états
    // (départs, états Google, codes de transfert, vues), freins des départs, journal de la porte ; dernière connexion,
    // langue et dernière venue de l'organisation dans ProjectLead reprises.
    await previewWrite(t, who.id, async (db) => {
      const s = await db.query(`delete from sessions where user_id = $1 and created_at >= $2`, [who.id, startedAt])
      const c = await db.query(`delete from codes where user_id = $1 and client_id = 'projectlead' and expires_at >= $2`, [who.id, startedAt])
      const rt = await db.query(`delete from refresh_tokens where user_id = $1 and client_id = 'projectlead' and created_at >= $2`, [who.id, startedAt])
      const st = await db.query(`delete from sso_states where state = any($1) or data->>'vh' = any($2) or state = any($3) or state = any($4)`,
        [madeStates, madeVh, madeVh.map((v) => `gapp-view:${v}`), madeCodes])
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
  const after = sqlRead(t.erp.ro, `select json_build_object('sessions', (select count(*) from sessions where user_id = $1 and created_at >= $2),
      'codes', (select count(*) from codes where user_id = $1 and expires_at >= $2), 'refresh', (select count(*) from refresh_tokens where user_id = $1 and created_at >= $2),
      'states', (select count(*) from sso_states where data->>'vh' = any(string_to_array($3, ',')) or state = any(string_to_array($4, ','))),
      'last_login_at', (select last_login_at from users where id = $1), 'locale', (select locale from users where id = $1),
      'org_app', (select last_at from org_apps where org_id = $5 and app = 'projectlead'),
      'rates', (select coalesce(json_agg(json_build_object('key', key, 'count', count, 'reset_at', reset_at) order by key), '[]'::json) from rate_limits where key like 'gapp|%'))`,
    [who.id, startedAt.toISOString(), madeVh.join(','), [...madeStates, ...madeCodes].join(','), who.org])
  const sortRates = (x) => [...(x ?? [])].sort((p, q) => String(p.key).localeCompare(String(q.key)))
  check('base d’APERÇU d’ERPlead remise comme avant (aucune session, aucun code ni jeton, aucun état de la porte, freins des départs d’avant ; dernière connexion, langue, organisation d’avant)',
    after.sessions === 0 && after.codes === 0 && after.refresh === 0 && after.states === 0 && after.locale === who.locale && after.last_login_at === who.last_login_at &&
    (orgAppBefore ? after.org_app === orgAppBefore.last_at : after.org_app === null) && same(sortRates(after.rates), sortRates(ratesBefore)), { ...after, rates: after.rates?.length })
  note(`captures : ${CAPTURES}/ (${shots.length}) ${shots.join(', ')}`)
  finish('G3')
}

// ------------------------------------------------------------------ entrée

const gate = process.argv[2]
if (gate === 'G1') gateG1()
else if (gate === 'G2') gateG2()
else if (gate === 'APERCU') await deployPreview()
else if (gate === 'G3') await gateG3()
else { console.log('usage : node scripts/google-app-gates.mjs G1|G2|APERCU|G3'); process.exit(2) }
