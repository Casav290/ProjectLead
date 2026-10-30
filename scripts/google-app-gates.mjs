#!/usr/bin/env node
// Portes du chantier « Continuer avec Google dans les apps mobiles », partie ProjectLead (30.10.2026). Ledger
// ~/projets/.unlazy/google-app/gates/leaf-projectlead.md, cahier ~/projets/.unlazy/google-app/CAHIER.md, contrat d'ERPlead
// ~/projets/erplead-google-app/docs/GOOGLE-APP.md. À lancer à la racine du worktree (~/projets/projectlead-google-app) :
//
//   node scripts/google-app-gates.mjs G1      code web de l'app : scripts/google-app-check.ts (faux pont Capacitor), chaque
//                                             contrôle exigé par son titre ; contre-épreuves (le code faussé dans une COPIE,
//                                             l'essai gardien doit échouer) ; contrôles complets de l'app (langues, types,
//                                             smoke, assistant, suites, build, paquet) ; périmètre (fichiers touchés, aucune
//                                             migration)
//   node scripts/google-app-gates.mjs G2      dépôt mobile ~/projets/projectlead-mobile (branche google-app) : schéma iOS et
//                                             Android lus dans les fichiers, plugins, agent LeadAppAuth/1, versions,
//                                             `cap sync` sans écart, AAB signé construit ici et lu par bundletool, rien poussé
//                                             ni soumis
//   node scripts/google-app-gates.mjs APERCU  aperçu Vercel de ProjectLead (jamais --prod) depuis HEAD, relié à l'aperçu
//                                             d'ERPlead (variables passées au déploiement seulement), noté dans
//                                             captures/projectlead/apercu.json
//   node scripts/google-app-gates.mjs G3      aperçus, Chromium sans tête qui imite la vue web de l'app 1.0.2 (agent
//                                             LeadAppAuth/1, faux pont Capacitor) : connexion de ProjectLead → écran d'ERPlead
//                                             avec Google → page relais → Browser.open → navigateur du téléphone →
//                                             accounts.google.com ; code préparé dans la base d'APERÇU d'ERPlead → page
//                                             « Revenez dans ProjectLead » → lien de retour donné à l'app → Browser.close,
//                                             rachat dans la vue web → retour OpenID de ProjectLead → échange du code comme le
//                                             serveur de ProjectLead → la personne TEST ; une seule fois ; liens étrangers
//                                             ignorés ; web et ancienne version inchangés ; base d'aperçu remise comme avant
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
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync,
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
const VERCEL_TEAM = 'team_mRhlABdvm1jvEPoDzuDDgpon'
const PL_PROJECT = 'prj_RZassmsoXK1Q7DuHZQAEsOh06kif'
const ERP_PROJECT = 'prj_ZIWBlmDtMeoPupyeG103XenXAXdV'
const PL_PROD_DB = /ep-billowing-moon/ // base de production de ProjectLead : jamais utilisée ici
const ERP_APERCU_DB_HOST = 'ep-summer-pine-b95lk4iy' // projet Neon royal-firefly-84980603 (aperçu d'ERPlead, données TEST)
const ERP_PROD_DB_HOST = 'ep-noisy-rain-b1beeeks'
const BRANCH = 'google-app'
/** La production d'où part la branche (dpl_FATFMB9coBL2P7ZrWpHdgUsUYZNy, vérifiée par l'API Vercel le 30.10.2026). */
const PROD_BASE = 'c077f19ea4f87d3087cc7fd80ea1ab358f440f0c'
/** Le dépôt mobile : la version publiée (Play 1.0.1, versionCode 2 ; TestFlight 1.0.1 (2)) et la branche des constructions iOS. */
const MOBILE_BASE = '310966e'
const PUBLISHED_VERSION_CODE = 2
/** Les fichiers servis par un déploiement : le code d'un aperçu doit être celui de HEAD. */
const APP_PATHS = ['src', 'server', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'vercel.json',
  'scripts/vercel-build.mjs', 'tailwind.config.js', 'postcss.config.js', 'db', 'trait-net']
/** Ce que le chantier a le droit de toucher depuis la production (tout autre fichier = débordement). */
const ALLOWED = [/^src\/lib\/leadAppAuth\.ts$/, /^src\/pages\/LeadAuthGoogle\.tsx$/, /^src\/App\.tsx$/, /^src\/main\.tsx$/, /^server\/routes\/auth\.ts$/,
  /^src\/i18n\/locales\/(fr|de|en|it|es)\/shell\.json$/, /^scripts\/(smoke\.ts|google-app-check\.ts|google-app-gates\.mjs)$/, /^docs\/(GOOGLE-APP|PASSATION)\.md$/]
/** L'entreprise TEST du banc lead-e2e (lt06) dont une personne sert au rachat de G3 (l'aperçu d'ERPlead utilise lt05). */
const ORG_INDEX = 5

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
const LOCALES = ['fr', 'de', 'en', 'it', 'es']

/** La base locale des essais (TEST_DATABASE_URL), créée pour ce chantier (hors dépôt, 600) : localhost seulement. */
function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL ?? readFileSync(`${COMMON}/projectlead-testdb.url`, 'utf8').trim()
  if (!/@localhost(:\d+)?\/projectlead_test_google_app$/.test(url)) throw new Error('la base de test doit être locale (localhost/projectlead_test_google_app)')
  return url
}

// ------------------------------------------------------------------ G1 : code web de l'app

/** Ce que G1 exige de voir vert dans scripts/google-app-check.ts (début du titre). */
const G1_REQUIRED = [
  ['lien de retour exact → Browser.close puis rachat avec le code, une navigation', 'lien de retour exact (schéma io.projectlead.app, hôte lead-auth, code de 43 caractères) : Browser.close, puis la vue web au rachat d’ERPlead avec le code, une seule navigation'],
  ['une seule fois (appUrlOpen ×2 + getLaunchUrl)', 'le même lien par appUrlOpen (deux fois) et par getLaunchUrl : une seule navigation, une seule fermeture'],
  ['une seule fois (page rechargée)', 'page rechargée (nouvelle instance, même localStorage) : le lien de lancement déjà traité est ignoré'],
  ['empreintes seulement', 'le stockage ne garde que des empreintes (jamais le code)'],
  ['lien étranger ignoré', 'liens étrangers ignorés ('],
  ['lien mal formé : jamais de rachat', 'lien mal formé ('],
  ['demande échue → back', 'demande échue (error=expired) : l’écran de connexion de l’app gardé par la page relais (back)'],
  ['demande échue sans back → /login', 'error=expired sans back gardé (app relancée par le lien) : la connexion normale de l’app (/login)'],
  ['back hors émetteur refusé', 'back gardé mais hors de l’émetteur (stockage modifié) : /login, jamais ce back'],
  ['Browser.close en erreur ignoré', 'Browser.close en erreur (Android, rien à fermer) ou plugin absent : le rachat a lieu quand même'],
  ['émetteur du serveur', 'émetteur donné par le serveur (aperçu) : le rachat va chez lui'],
  ['page relais : Browser.open une fois', 'dans l’app : back gardé (sessionStorage), Browser.open({ url: start }) une fois, aucune navigation, écoute de browserFinished'],
  ['page relais : double rendu', 'relais demandé deux fois dans la même page (double rendu de React) : un seul Browser.open'],
  ['navigateur refermé sans retour → back', '… puis la vue web revient à l’écran de connexion de l’app (back)'],
  ['navigateur refermé après le retour → rachat seul', 'navigateur refermé APRÈS le lien de retour (Browser.close) : seulement le rachat, jamais back'],
  ['hors de l’app → back', 'hors de l’app (site, navigateur) : back, Browser.open jamais appelé, rien gardé'],
  ['préfixes de l’émetteur', 'start ou back hors des préfixes exacts de l’émetteur ('],
  ['Browser.open en erreur → back', 'Browser.open en erreur : back'],
  ['site web : aucun pont reconnu', 'site web (aucun pont, pont web, isNativePlatform faux ou cassé) : aucun pont natif reconnu'],
  ['site web : aucun écouteur', 'site web : listen() ne pose aucun écouteur, aucun lien traité'],
  ['toutes les pages, au démarrage', 'src/main.tsx : l’écoute du lien de retour démarre avant le premier rendu, sur toutes les pages'],
  ['route publique', 'la page relais est une route publique (sans session) : /lead-auth/google, et seulement elle'],
  ['servie par l’application sur Vercel', 'Vercel : /lead-auth/google est servie par l’application (pas par la fonction)'],
  ['/api/auth/options → leadIssuer', '/api/auth/options → leadIssuer : LEAD_ID_ISSUER (production, aperçu, local), crmlead.io → erplead.io'],
  ['cinq langues', 'page relais rendue dans les cinq langues'],
]

/** Contre-épreuves : chaque faute est posée dans une COPIE ; le contrôle nommé doit alors échouer. Texte remplacé présent une fois. */
const MUTATIONS = [
  { name: 'aucune mémoire des liens traités', file: 'src/lib/leadAppAuth.ts',
    from: "    if (seen.has(f) || doneList().some((x) => x.f === f)) return 'duplicate'\n", to: '',
    breaks: 'le même lien par appUrlOpen (deux fois) et par getLaunchUrl : une seule navigation, une seule fermeture' },
  { name: 'mémoire de la page seulement (rien dans localStorage)', file: 'src/lib/leadAppAuth.ts',
    from: ' || doneList().some((x) => x.f === f)', to: '',
    breaks: 'page rechargée (nouvelle instance, même localStorage) : le lien de lancement déjà traité est ignoré' },
  { name: 'préfixe du lien de retour approché', file: 'src/lib/leadAppAuth.ts',
    from: '!url.startsWith(RETURN_PREFIX)', to: "!url.includes('lead-auth?')",
    breaks: 'liens étrangers ignorés (' },
  { name: 'navigateur du téléphone jamais refermé', file: 'src/lib/leadAppAuth.ts',
    from: 'void Promise.resolve(env.bridge?.Plugins?.Browser?.close?.()).catch(() => {})', to: 'void 0',
    breaks: 'lien de retour exact (schéma io.projectlead.app, hôte lead-auth, code de 43 caractères) : Browser.close, puis la vue web au rachat d’ERPlead avec le code, une seule navigation' },
  { name: 'forme du code non vérifiée', file: 'src/lib/leadAppAuth.ts',
    from: 'codes.length === 1 && CODE_RE.test(codes[0])', to: 'codes.length >= 1',
    breaks: 'lien mal formé (' },
  { name: 'start et back de la page relais non vérifiés', file: 'src/lib/leadAppAuth.ts',
    from: "  if (!start.startsWith(`${issuer}/auth/google/app/start?`) || !isBack(back, issuer)) return null\n", to: '',
    breaks: 'start ou back hors des préfixes exacts de l’émetteur (' },
  { name: 'tout objet Capacitor pris pour l’app', file: 'src/lib/leadAppAuth.ts',
    from: "typeof b.isNativePlatform === 'function' && b.isNativePlatform() === true ? b : null", to: 'b ? b : null',
    breaks: 'site web (aucun pont, pont web, isNativePlatform faux ou cassé) : aucun pont natif reconnu' },
  { name: 'navigateur refermé : back même après le retour', file: 'src/lib/leadAppAuth.ts',
    from: 'env.setTimeout(() => { if (!returned) env.replace(t.back) }, FINISH_GRACE_MS)', to: 'env.setTimeout(() => { env.replace(t.back) }, FINISH_GRACE_MS)',
    breaks: 'navigateur refermé APRÈS le lien de retour (Browser.close) : seulement le rachat, jamais back' },
  { name: 'émetteur du serveur ignoré', file: 'server/routes/auth.ts',
    from: 'leadIssuer: leadIssuer() }', to: "leadIssuer: 'https://erplead.io' }",
    breaks: '/api/auth/options → leadIssuer : LEAD_ID_ISSUER (production, aperçu, local), crmlead.io → erplead.io' },
  { name: 'écoute absente au démarrage', file: 'src/main.tsx',
    from: '\nleadAppAuth().listen()\n', to: '\n',
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
  check('contre-épreuves faites dans une copie : le worktree n’a pas bougé', sha256(run('git', ['status', '--porcelain']).stdout + run('git', ['diff']).stdout) === before)
}

function gateG1() {
  console.log('G1 — code web de l’app (lien de retour, page relais, rien hors de l’app), contre-épreuves, contrôles complets')
  const w = webCheck()
  check(`scripts/google-app-check.ts : ${w.bilan ? `${w.bilan[1]} verts, ${w.bilan[2]} rouges` : 'pas de bilan'}`,
    w.status === 0 && w.bilan && w.bilan[2] === '0' && Number(w.bilan[1]) >= 32 && lastLine(w.out) === 'GOOGLE_APP_WEB_CHECK_OK', w.nons.join(' | ') || lastLine(w.err))
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
  check(`npm test (scripts/smoke.ts, base locale) : ${sm ? `${sm[1]} verts, ${sm[2]} rouges` : 'pas de bilan'}`, smoke.status === 0 && sm && sm[2] === '0' && Number(sm[1]) >= 570,
    (smoke.stdout ?? '').split('\n').filter((l) => l.includes('✗')).join(' | ').slice(0, 500) || lastLine(smoke.stdout))
  for (const must of ['options : émetteur du Compte Lead (leadIssuer = LEAD_ID_ISSUER)', 'app mobile, nouvelle version (LeadAppAuth/1) : départ avec platform=app',
    'app mobile : départ vers le Compte Lead avec platform=app', 'navigateur : départ sans platform'])
    check(`smoke : vu vert « ${must} »`, (smoke.stdout ?? '').includes(`✓ ${must}`))
  for (const [script, token, timeout] of [['scripts/assistant-check.ts', 'ASSISTANT_CHECK_OK', 900_000], ['scripts/assistant-actions-check.ts', 'ASSISTANT_ACTIONS_CHECK_OK', 900_000],
    ['scripts/assistant-pool-check.ts', 'ASSISTANT_POOL_CHECK_OK', 300_000]]) {
    const r = run('npx', ['tsx', script], { env, timeout })
    check(script, r.status === 0 && lastLine(r.stdout) === token, lastLine(r.stdout) || lastLine(r.stderr))
  }
  const su = run('npx', ['tsx', 'scripts/suites-check.ts'])
  check('scripts/suites-check.ts', su.status === 0 && (su.stdout ?? '').includes('PROJECTLEAD_SUITES_UNIT_OK'), lastLine(su.stdout))
  check('pas de linter dans package.json (rien à lancer)', !/"lint"/.test(readFileSync(join(ROOT, 'package.json'), 'utf8')))
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true })
  const build = run('npm', ['run', '-s', 'build'], { timeout: 900_000 })
  check('npm run build', build.status === 0 && existsSync(join(ROOT, 'dist/index.html')), (build.stdout + build.stderr).slice(-400))
  const files = []
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  if (existsSync(join(ROOT, 'dist'))) walk(join(ROOT, 'dist'))
  const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8'))
  check('paquet du navigateur : le lien de retour io.projectlead.app://lead-auth et la page relais /lead-auth/google y sont', js.some((s) => s.includes('io.projectlead.app')) &&
    js.some((s) => s.includes('lead-auth')) && js.some((s) => s.includes('/auth/google/app/redeem?code=')))
  const BAD = /sk-ant|anthropic|opus-5/i
  check(`paquet du navigateur (${files.length} fichiers) : aucune clé ni nom du fournisseur de l’assistant`, files.length > 3 && !files.some((f) => BAD.test(readFileSync(f, 'utf8'))))
  const grep = spawnSync('git', ['grep', '-nE', 'sk-ant-[A-Za-z0-9_-]{8,}|(^|[^A-Za-z0-9])lid_[A-Za-z0-9_-]{32,}', 'HEAD', '--', '.'], { cwd: ROOT, encoding: 'utf8' })
  check('dépôt (HEAD) : aucune clé', grep.status === 1, (grep.stdout ?? '').slice(0, 300))

  // Le périmètre : seulement les fichiers du chantier, aucune migration, partie de la production.
  check(`branche ${BRANCH} partie de la production (${PROD_BASE.slice(0, 7)})`, run('git', ['merge-base', '--is-ancestor', PROD_BASE, 'HEAD']).status === 0 &&
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() === BRANCH)
  const changed = run('git', ['diff', '--name-only', PROD_BASE]).stdout.split('\n').filter(Boolean)
    .concat(run('git', ['ls-files', '-o', '--exclude-standard']).stdout.split('\n').filter((f) => f && !f.startsWith('captures/')))
  const outside = changed.filter((f) => !ALLOWED.some((re) => re.test(f)))
  check(`fichiers touchés depuis la production : seulement ceux du chantier (${changed.length})`, outside.length === 0, outside)
  check('aucune migration : db/ identique à la production', run('git', ['diff', '--quiet', PROD_BASE, '--', 'db']).status === 0)
  finish('G1')
}

// ------------------------------------------------------------------ G2 : dépôt mobile

function gateG2() {
  console.log(`G2 — dépôt mobile ${MOBILE} (branche ${BRANCH})`)
  const git = (...a) => run('git', a, { cwd: MOBILE })
  const head = git('rev-parse', 'HEAD').stdout.trim()
  check(`branche ${BRANCH} (${head.slice(0, 7)}), partie de la version publiée ${MOBILE_BASE}`, git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() === BRANCH &&
    git('merge-base', '--is-ancestor', MOBILE_BASE, 'HEAD').status === 0)
  check('fichiers suivis : tout est enregistré (aucune modification en attente)', git('status', '--porcelain', '--untracked-files=no').stdout.trim() === '',
    git('status', '--porcelain', '--untracked-files=no').stdout)
  const untracked = git('status', '--porcelain').stdout.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3))
  check('non suivi : seulement assets-avant-20261022/ (laissé tel quel)', untracked.every((f) => f === 'assets-avant-20261022/'), untracked)

  // --- configuration Capacitor
  const cfg = readFileSync(`${MOBILE}/capacitor.config.ts`, 'utf8')
  const ua = cfg.match(/appendUserAgent:\s*'([^']+)'/)?.[1] ?? ''
  check(`agent : « ${ua} » = l'agent de l'app + « LeadAppAuth/1 » séparé par une espace`, ua === 'ProjectLeadApp/1.0.2 LeadAppAuth/1' && /(^|\s)LeadAppAuth\/1$/.test(ua) && /ProjectLeadApp/.test(ua))
  check('appId io.projectlead.app, server.url https://projectlead.io', /appId:\s*'io\.projectlead\.app'/.test(cfg) && /url:\s*'https:\/\/projectlead\.io'/.test(cfg))
  const nav = (cfg.match(/allowNavigation:\s*\[([^\]]*)\]/)?.[1] ?? '').match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? []
  check(`allowNavigation garde erplead.io et Apple (${nav.join(', ')})`, ['erplead.io', 'appleid.apple.com', 'idmsa.apple.com'].every((h) => nav.includes(h)) && !nav.includes('accounts.google.com'))

  // --- iOS
  const plist = JSON.parse(execFileSync('python3', ['-c', 'import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', `${MOBILE}/ios/App/App/Info.plist`], { encoding: 'utf8' }))
  const schemes = (plist.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? [])
  check(`iOS Info.plist (lu par plistlib) : CFBundleURLTypes → CFBundleURLSchemes = io.projectlead.app (${schemes.join(', ')})`, JSON.stringify(schemes) === '["io.projectlead.app"]')
  check('iOS Info.plist : version et build lus du projet ($(MARKETING_VERSION), $(CURRENT_PROJECT_VERSION))',
    plist.CFBundleShortVersionString === '$(MARKETING_VERSION)' && plist.CFBundleVersion === '$(CURRENT_PROJECT_VERSION)')
  const pbx = readFileSync(`${MOBILE}/ios/App/App.xcodeproj/project.pbxproj`, 'utf8')
  const mv = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]), cpv = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1])
  check(`iOS : MARKETING_VERSION 1.0.2 et CURRENT_PROJECT_VERSION 3 (Debug et Release) — TestFlight a 1.0.1 (2)`,
    JSON.stringify(mv) === '["1.0.2","1.0.2"]' && JSON.stringify(cpv) === '["3","3"]', { mv, cpv })
  const cm = readFileSync(`${MOBILE}/codemagic.yaml`, 'utf8')
  check('codemagic.yaml : MARKETING_VERSION 1.0.2, toujours sans envoi en test (submit_to_testflight: false)', /MARKETING_VERSION: 1\.0\.2\b/.test(cm) && /submit_to_testflight: false/.test(cm))
  const spm = readFileSync(`${MOBILE}/ios/App/CapApp-SPM/Package.swift`, 'utf8')
  check('iOS Package.swift : CapacitorApp et CapacitorBrowser', /\.package\(name: "CapacitorBrowser", path: "\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/browser"\)/.test(spm) &&
    /\.product\(name: "CapacitorBrowser", package: "CapacitorBrowser"\)/.test(spm) && /\.product\(name: "CapacitorApp", package: "CapacitorApp"\)/.test(spm))
  const scene = readFileSync(`${MOBILE}/ios/App/App/SceneDelegate.swift`, 'utf8')
  check('iOS : les liens ouverts passent au pont (SceneDelegate → SceneDelegateProxy, openURLContexts et lancement)',
    /SceneDelegateProxy\.shared\.scene\(scene, openURLContexts: URLContexts\)/.test(scene) && /SceneDelegateProxy\.shared\.scene\(scene, willConnectTo: session, options: connectionOptions\)/.test(scene))

  // --- Android
  const manifest = readFileSync(`${MOBILE}/android/app/src/main/AndroidManifest.xml`, 'utf8')
  const activity = manifest.match(/<activity[\s\S]*?<\/activity>/)?.[0] ?? ''
  const filters = activity.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? []
  const back = filters.find((f) => /android:scheme="io\.projectlead\.app"/.test(f))
  check('Android AndroidManifest.xml : MainActivity singleTask, intent-filter VIEW + DEFAULT + BROWSABLE, data scheme io.projectlead.app host lead-auth',
    /android:name="\.MainActivity"/.test(activity) && /android:launchMode="singleTask"/.test(activity) && !!back &&
    /android\.intent\.action\.VIEW/.test(back) && /android\.intent\.category\.DEFAULT/.test(back) && /android\.intent\.category\.BROWSABLE/.test(back) &&
    /<data android:scheme="io\.projectlead\.app" android:host="lead-auth" \/>/.test(back) && filters.length === 2, back ?? activity.slice(0, 300))
  const gradle = readFileSync(`${MOBILE}/android/app/build.gradle`, 'utf8')
  const vc = Number(gradle.match(/versionCode (\d+)/)?.[1]), vn = gradle.match(/versionName "([^"]+)"/)?.[1]
  const published = readdirSync(PUBLICATIONS).map((f) => Number(f.match(/^projectlead-[\d.]+-(\d+)\.aab$/)?.[1] ?? 0))
  check(`Android : versionCode ${vc} (publiée : ${PUBLISHED_VERSION_CODE}, dossiers : ${published.filter(Boolean).join(', ')}), versionName ${vn}`,
    vc === 3 && vc > PUBLISHED_VERSION_CODE && vn === '1.0.2' && published.every((n) => n < vc || n === vc))
  const pkg = JSON.parse(readFileSync(`${MOBILE}/package.json`, 'utf8'))
  const installed = (p) => { try { return JSON.parse(readFileSync(`${MOBILE}/node_modules/${p}/package.json`, 'utf8')).version } catch { return null } }
  const v = Object.fromEntries(['@capacitor/app', '@capacitor/browser', '@capacitor/core', '@capacitor/android', '@capacitor/ios', '@capacitor/cli'].map((p) => [p, installed(p)]))
  check(`plugins : @capacitor/app ${v['@capacitor/app']} et @capacitor/browser ${v['@capacitor/browser']} dans package.json et installés, Capacitor 8 partout (version ${pkg.version})`,
    pkg.version === '1.0.2' && pkg.dependencies?.['@capacitor/app'] && pkg.dependencies?.['@capacitor/browser'] && Object.values(v).every((x) => x?.startsWith('8.')), v)
  const lock = JSON.parse(readFileSync(`${MOBILE}/package-lock.json`, 'utf8'))
  check('package-lock.json : @capacitor/browser verrouillé à la version installée', lock.packages?.['node_modules/@capacitor/browser']?.version === v['@capacitor/browser'])

  // --- synchronisation : `cap sync` (Node 22, comme le README) ne change aucun fichier suivi, et les fichiers générés portent tout
  const sync = run('npx', ['-y', 'node@22', 'node_modules/@capacitor/cli/bin/capacitor', 'sync'], { cwd: MOBILE, timeout: 600_000 })
  check('npx cap sync (android et ios) : réussi', sync.status === 0 && /Sync finished/.test(sync.stdout + sync.stderr), lastLine(sync.stderr) || lastLine(sync.stdout))
  check('après cap sync : aucun fichier suivi modifié (le dépôt était déjà synchronisé)', git('status', '--porcelain', '--untracked-files=no').stdout.trim() === '',
    git('status', '--porcelain', '--untracked-files=no').stdout)
  const settings = readFileSync(`${MOBILE}/android/capacitor.settings.gradle`, 'utf8'), appBuild = readFileSync(`${MOBILE}/android/app/capacitor.build.gradle`, 'utf8')
  const plugins = JSON.parse(readFileSync(`${MOBILE}/android/app/src/main/assets/capacitor.plugins.json`, 'utf8')).map((p) => p.classpath)
  const androidCfg = JSON.parse(readFileSync(`${MOBILE}/android/app/src/main/assets/capacitor.config.json`, 'utf8'))
  const iosCfg = JSON.parse(readFileSync(`${MOBILE}/ios/App/App/capacitor.config.json`, 'utf8'))
  check('Android synchronisé : capacitor-browser et capacitor-app dans settings et build, BrowserPlugin et AppPlugin enregistrés',
    /include ':capacitor-browser'/.test(settings) && /implementation project\(':capacitor-browser'\)/.test(appBuild) && /implementation project\(':capacitor-app'\)/.test(appBuild) &&
    plugins.includes('com.capacitorjs.plugins.browser.BrowserPlugin') && plugins.includes('com.capacitorjs.plugins.app.AppPlugin'), plugins)
  check('configurations générées (iOS et Android) : agent avec LeadAppAuth/1, allowNavigation gardée ; iOS enregistre CAPBrowserPlugin et AppPlugin',
    androidCfg.appendUserAgent === ua && iosCfg.appendUserAgent === ua && JSON.stringify(androidCfg.server?.allowNavigation) === JSON.stringify(nav) &&
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
    const filter = (xml.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? []).find((f) => /io\.projectlead\.app/.test(f)) ?? ''
    check('AAB (bundletool dump manifest) : package io.projectlead.app, versionCode 3, versionName 1.0.2, intent-filter VIEW/DEFAULT/BROWSABLE io.projectlead.app://lead-auth',
      /package="io\.projectlead\.app"/.test(xml) && /android:versionCode="3"/.test(xml) && /android:versionName="1\.0\.2"/.test(xml) &&
      /android\.intent\.action\.VIEW/.test(filter) && /android\.intent\.category\.BROWSABLE/.test(filter) && /android\.intent\.category\.DEFAULT/.test(filter) &&
      /android:scheme="io\.projectlead\.app"/.test(filter) && /android:host="lead-auth"/.test(filter), filter || xml.slice(0, 400))
    const unzip = (entry) => execFileSync('unzip', ['-p', aab, entry], { maxBuffer: 256 * 1024 * 1024 })
    const entries = execFileSync('unzip', ['-Z1', aab], { encoding: 'utf8' }).split('\n')
    const dex = entries.filter((e) => /^base\/dex\/classes\d*\.dex$/.test(e)).map((e) => unzip(e).toString('latin1')).join('')
    const aCfg = JSON.parse(unzip('base/assets/capacitor.config.json').toString('utf8'))
    check('AAB : le plugin Browser (com/capacitorjs/plugins/browser) et le plugin App sont dans le code, l’agent LeadAppAuth/1 dans la configuration embarquée',
      dex.includes('com/capacitorjs/plugins/browser/BrowserPlugin') && dex.includes('com/capacitorjs/plugins/app/AppPlugin') && aCfg.appendUserAgent === ua &&
      JSON.parse(unzip('base/assets/capacitor.plugins.json').toString('utf8')).some((p) => p.pkg === '@capacitor/browser'))
    const certOf = (f) => (execFileSync('keytool', ['-printcert', '-jarfile', f], { encoding: 'utf8' }).match(/SHA256: ([0-9A-F:]+)/) ?? [])[1]
    const now = certOf(aab), before = certOf(`${PUBLICATIONS}/projectlead-1.0.1-2.aab`)
    check(`AAB signé par la même clé d’envoi que la 1.0.1 publiée (SHA-256 ${String(now).slice(0, 8)}…${String(now).slice(-5)})`, !!now && now === before)
    const out = `${PUBLICATIONS}/projectlead-1.0.2-3.aab`
    mkdirSync(CAPTURES, { recursive: true })
    copyFileSync(aab, out)
    writeFileSync(`${CAPTURES}/android-1.0.2-3.json`, JSON.stringify({ aab: out, sha256: sha256(readFileSync(out)), mobileCommit: head, builtAt: new Date().toISOString(),
      note: 'AAB signé (clé d’envoi ProjectLead) construit par scripts/google-app-gates.mjs G2 ; NON envoyé à Google Play.' }, null, 2) + '\n')
    note(`AAB copié : ${out} (${Math.round(statSync(out).size / 1024)} Ko)`)
  }
  // --- iOS : pas de construction locale (Linux, sans Xcode) ; la construction passe par Codemagic, qui envoie le build à App
  // Store Connect : jamais déclenchée par cette porte.
  note('iOS : aucune construction locale possible (pas de macOS/Xcode sur ce serveur) ; procédure : Codemagic, workflow ios-testflight, branche store-projectlead — non déclenchée (elle enverrait le build à App Store Connect)')
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
 * variable du projet changée), comme scripts/apercu-vercel.mjs. Le Compte Lead de l'aperçu est l'aperçu d'ERPlead (google-app) :
 * LEAD_ID_ISSUER = son adresse, client projectlead, retour déclaré https://projectlead.io/auth/lead/callback (jamais suivi par
 * la porte), secret factice (l'aperçu n'échange aucun code). Tâches de fond coupées.
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
  check(`aperçu d’ERPlead ${erp.url} (branche google-app) : prêt, cible aperçu, ni la production ; c’est le Compte Lead de l’aperçu ProjectLead`,
    erp.url === info.erplead && ed.readyState === 'READY' && !ed.target && ed.meta?.gitCommitRef === BRANCH && erpProd.targets?.production?.id !== erp.deployment)
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
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const APP_UA = `${IPHONE} ProjectLeadApp/1.0.2 LeadAppAuth/1`
const OLD_UA = `${IPHONE} ProjectLeadApp/1.0.1`
const PROD_HOSTS = /^https?:\/\/(www\.)?(projectlead|erplead)\.io(\/|$)/
/** Le pont que la coque native injecte (plugins App et Browser), imité : chaque appel est noté par la porte. */
const FAKE_BRIDGE = `(() => {
  const L = {}
  const on = (plugin) => (ev, cb) => { (L[ev] = L[ev] || []).push(cb); window.__capRecord('listen', plugin + ':' + ev); return { remove: async () => {} } }
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {
    App: { addListener: on('App'), getLaunchUrl: () => window.__capLaunch().then((url) => (url ? { url } : {})) },
    Browser: { addListener: on('Browser'),
      open: (o) => { window.__capRecord('open', o && o.url); return Promise.resolve() },
      close: () => { window.__capRecord('close', ''); return Promise.resolve() } } } }
  window.__capFire = (ev, data) => (L[ev] || []).forEach((cb) => cb(data))
})()`

async function gateG3() {
  console.log('G3 — aperçus : vue web de l’app 1.0.2 (agent LeadAppAuth/1, faux pont Capacitor), Google par le navigateur du téléphone, retour dans l’app')
  const t = await targets()
  if (failures) finish('G3')
  const who = benchPerson(t)
  const orgAppBefore = sqlRead(t.erp.ro, `select json_build_object('last_at', last_at) from org_apps where org_id = $1 and app = 'projectlead'`, [who.org])
  const opt = await (await fetch(`${t.pl.url}/api/auth/options`, { headers: { 'x-vercel-protection-bypass': t.pl.bypass } })).json().catch(() => null)
  check('aperçu ProjectLead : Compte Lead branché, émetteur = l’aperçu d’ERPlead (/api/auth/options)', opt?.leadId === true && opt?.leadIssuer === t.erp.url, opt)
  const startedAt = new Date()
  mkdirSync(CAPTURES, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const calls = []          // appels au faux pont : { name, arg, at }
  let launchUrl = null      // ce que rend App.getLaunchUrl()
  const prodHits = []       // toute requête vers projectlead.io ou erplead.io (production) : aucune attendue
  const callbacks = []      // retours OpenID vers https://projectlead.io/auth/lead/callback, interceptés dans le navigateur
  const redeems = [], authorizes = [], googleInWebview = []
  const madeStates = [], madeVh = [], madeCodes = []
  const shots = []
  const T = Object.fromEntries(LOCALES.map((l) => [l, shellTexts(l)]))

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

  async function context(ua, kind) {
    const ctx = await browser.newContext({ userAgent: ua, viewport: kind === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 },
      deviceScaleFactor: kind === 'desktop' ? 1 : 2, locale: 'fr-CH' })
    if (kind === 'webview') {
      await ctx.exposeBinding('__capRecord', ({ page }, name, arg) => { calls.push({ name, arg: String(arg ?? ''), at: page?.url() ?? '' }) })
      await ctx.exposeBinding('__capLaunch', () => launchUrl)
      await ctx.addInitScript(FAKE_BRIDGE)
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
  const records = (name) => calls.filter((c) => c.name === name)

  try {
    // --- 1. vue web de l'app 1.0.2 : la connexion de ProjectLead mène à l'écran d'ERPlead, avec Google
    const wv = await context(APP_UA, 'webview')
    const page = wv.page
    await page.goto(`${t.pl.url}/login`)
    await page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 45_000 }).catch(() => {})
    const az = authorizes.map((u) => new URL(u)).find((u) => u.searchParams.get('client_id') === 'projectlead')
    const plState = az?.searchParams.get('state') ?? ''
    check('vue web de l’app 1.0.2 : la connexion de ProjectLead (aperçu) part vers l’autorisation d’ERPlead (aperçu) : client projectlead, platform=app, retour déclaré, PKCE S256, langue fr',
      az && az.searchParams.get('platform') === 'app' && az.searchParams.get('redirect_uri') === 'https://projectlead.io/auth/lead/callback' &&
      az.searchParams.get('code_challenge_method') === 'S256' && az.searchParams.get('ui_locales') === 'fr' && plState.length >= 20, az?.toString() ?? authorizes)
    check('… et arrive sur l’écran de connexion d’ERPlead dans la vue web', page.url().startsWith(`${t.erp.url}/login?next=`), page.url())
    const g = page.locator('a[href^="/auth/google/app?"]')
    check('écran d’ERPlead dans la vue web de la nouvelle version : bouton « Continuer avec Google » (vers /auth/google/app), Apple et mot de passe gardés, aucune phrase « Mot de passe oublié »',
      (await g.count()) === 1 && /Google/.test((await g.textContent()) ?? '') && (await page.locator('a[href^="/auth/apple?"]').count()) === 1 &&
      (await page.locator('input[name="password"]').count()) === 1 && (await page.locator('[data-google-app-hint]').count()) === 0,
      { google: await g.count(), hint: await page.locator('[data-google-app-hint]').count() })
    await shot(page, 'g3-connexion-erplead-fr')

    // --- 2. clic : départ dans la vue web, page relais de ProjectLead, Browser.open
    await g.click()
    await page.waitForURL((u) => u.toString().startsWith(`${t.pl.url}/lead-auth/google?`), { timeout: 30_000 }).catch(() => {})
    await waitFor(() => records('open').length > 0, 20_000)
    const opens = records('open')
    const start = opens[0]?.arg ?? ''
    check('le clic mène la vue web à la page relais de ProjectLead (aperçu, /lead-auth/google)', page.url().startsWith(`${t.pl.url}/lead-auth/google?start=`), page.url())
    check('la page relais ouvre le départ dans le navigateur du téléphone : Browser.open({ url: start }) une fois, start = départ d’ERPlead pour projectlead',
      opens.length === 1 && start.startsWith(`${t.erp.url}/auth/google/app/start?d=projectlead.`) && opens[0].at.startsWith(`${t.pl.url}/lead-auth/google`), opens)
    check('écoutes posées dans la vue web : appUrlOpen (toutes les pages) et browserFinished (page relais)',
      records('listen').some((c) => c.arg === 'App:appUrlOpen') && records('listen').some((c) => c.arg === 'Browser:browserFinished'))
    await page.waitForSelector('[data-lead-auth-back]', { timeout: 10_000 }).catch(() => {})
    const h1 = await page.locator('h1').first().textContent().catch(() => '')
    const backHref = await page.locator('[data-lead-auth-back]').getAttribute('href').catch(() => null)
    const keptBack = await page.evaluate(() => sessionStorage.getItem('pl.leadAuth.back'))
    check(`page relais : « ${T.fr['shell.leadAuth.title']} », lien « ${T.fr['shell.leadAuth.back']} » vers l’écran de connexion de l’app (gardé en sessionStorage)`,
      h1 === T.fr['shell.leadAuth.title'] && backHref?.startsWith(`${t.erp.url}/login?next=`) && keptBack === backHref, { h1, backHref, keptBack })
    await shot(page, 'g3-relais-flux-fr')
    const cookie = (await wv.ctx.cookies(t.erp.url)).find((c) => c.name === '__Host-erp_gapp')
    check('cookie verifier de la vue web (aperçu d’ERPlead) : __Host-erp_gapp HttpOnly, Secure, SameSite=Lax',
      cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax' && cookie.path === '/', cookie && { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite })
    const vh = cookie ? sha256(cookie.value) : ''
    madeVh.push(vh)
    const d = new URL(start || 'https://x.invalid').searchParams.get('d') ?? ''
    const dep = sqlRead(t.erp.ro, `select data from sso_states where state = $1 and expires_at > now()`, [sha256(d)])
    check('départ noté dans la base d’APERÇU d’ERPlead : app projectlead, empreinte du verifier de cette vue web, demande d’autorisation de ProjectLead',
      dep?.provider === 'google-app-start' && dep.app === 'projectlead' && dep.vh === vh && dep.next?.includes('client_id=projectlead') &&
      dep.next?.includes(`state=${encodeURIComponent(plState)}`), dep && { app: dep.app })

    // --- 3. navigateur du téléphone : départ → accounts.google.com
    const sys = await context(SAFARI, 'system')
    const googleReq = []
    sys.page.on('request', (r) => { if (r.url().startsWith('https://accounts.google.com/o/oauth2/v2/auth')) googleReq.push(r.url()) })
    await sys.page.goto(start, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sys.page.waitForLoadState('load').catch(() => {})
    const gu = googleReq[0] ? new URL(googleReq[0]) : null
    const gstate = gu?.searchParams.get('state') ?? ''
    if (gstate) madeStates.push(sha256(gstate))
    check('navigateur du téléphone : le départ mène à accounts.google.com (redirect_uri https://erplead.io/auth/google/callback, state app.projectlead.…, PKCE S256, hl=fr)',
      gu && gu.searchParams.get('redirect_uri') === 'https://erplead.io/auth/google/callback' && gstate.startsWith('app.projectlead.') &&
      gu.searchParams.get('code_challenge_method') === 'S256' && !!gu.searchParams.get('nonce') && gu.searchParams.get('hl') === 'fr', googleReq[0] ?? sys.page.url())
    const gText = await sys.page.content().catch(() => '')
    check('Google accepte la demande (page de connexion Google, ni redirect_uri_mismatch, ni disallowed_useragent)',
      new URL(sys.page.url()).host === 'accounts.google.com' && !/redirect_uri_mismatch|invalid_client|disallowed_useragent|invalid_request|Error 400|Erreur 400/i.test(gText),
      new URL(sys.page.url()).host + new URL(sys.page.url()).pathname)
    await shot(sys.page, 'g3-google-fr')
    const st = sqlRead(t.erp.ro, `select data from sso_states where state = $1 and expires_at > now()`, [sha256(gstate)])
    check('état Google de l’app en base d’APERÇU (même verifier, même demande), départ consommé',
      st?.provider === 'google' && st.app === 'projectlead' && st.vh === vh && st.next === dep?.next && sqlRead(t.erp.ro, `select count(*) from sso_states where state = $1`, [sha256(d)]) === 0)

    // --- 4. retour simulé de Google : le code que le retour de Google aurait fait, pour la personne TEST (base d'APERÇU)
    const code = randomBytes(32).toString('base64url')
    madeCodes.push(sha256(code))
    await previewWrite(t, who.id, async (db) => {
      await db.query(`delete from sso_states where state = $1`, [sha256(gstate)])
      await db.query(`insert into sso_states (state, data, expires_at) values ($1, $2, now() + interval '5 minutes')`, [sha256(code), JSON.stringify({
        provider: 'google-app-code', app: 'projectlead', vh, next: st?.next, locale: st?.locale ?? 'fr', result: { profile: { email: who.email, name: who.name, locale: who.locale } } })])
    })
    const retUrl = `${t.erp.url}/auth/google/app/return?${new URLSearchParams({ app: 'projectlead', code, locale: 'fr' })}`
    const retHtml = await (await sys.ctx.request.get(retUrl)).text()
    const link = unesc(retHtml.match(/<a class="btn" href="([^"]+)" data-app-return>/)?.[1] ?? '')
    check('page « Revenez dans ProjectLead » (navigateur du téléphone) : lien de retour io.projectlead.app://lead-auth?code=…, suivi tout seul et en bouton',
      link === `io.projectlead.app://lead-auth?code=${code}` && retHtml.includes('<meta http-equiv="refresh" content="0;url=io.projectlead.app://lead-auth?code='), link.slice(0, 40))
    const cap = await sys.ctx.newPage()
    await cap.route(retUrl, async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, body: (await res.text()).replace(/<meta http-equiv="refresh"[^>]*>/, '') }) }, { times: 1 })
    await cap.goto(retUrl)
    await shot(cap, 'g3-retour-fr')
    await cap.close()

    // --- 5. le lien de retour arrive dans l'app : Browser.close, rachat dans la vue web, retour OpenID de ProjectLead
    launchUrl = link
    await page.evaluate((u) => window.__capFire('appUrlOpen', { url: u }), link)
    await waitFor(() => callbacks.length >= 1, 45_000)
    await page.waitForLoadState('load').catch(() => {})
    const closes = records('close')
    check('lien de retour reçu : le navigateur du téléphone est refermé (Browser.close, une fois, sur la page relais)',
      closes.length === 1 && closes[0].at.startsWith(`${t.pl.url}/lead-auth/google`), closes)
    check('… et la vue web va au rachat d’ERPlead avec ce code, une seule fois', redeems.length === 1 && redeems[0] === `${t.erp.url}/auth/google/app/redeem?code=${code}`, redeems.length)
    const cb = new URL(callbacks[0] ?? 'https://x.invalid')
    check('rachat dans la vue web → l’autorisation de ProjectLead reprend → retour OpenID https://projectlead.io/auth/lead/callback avec un code, le state de ProjectLead et iss',
      `${cb.origin}${cb.pathname}` === 'https://projectlead.io/auth/lead/callback' && /^[A-Za-z0-9_-]{43}$/.test(cb.searchParams.get('code') ?? '') &&
      cb.searchParams.get('state') === plState && cb.searchParams.get('iss') === 'https://erplead.io', cb.origin + cb.pathname)
    const jar = await wv.ctx.cookies(t.erp.url)
    check('session ERPlead ouverte DANS la vue web (méthode google, agent de l’app 1.0.2), cookie verifier effacé',
      jar.some((c) => c.name === '__Host-erp_sid') && !jar.some((c) => c.name === '__Host-erp_gapp') &&
      sqlRead(t.erp.ro, `select count(*) from sessions where user_id = $1 and method = 'google' and created_at >= $2 and user_agent like '%ProjectLeadApp/1.0.2 LeadAppAuth/1%'`,
        [who.id, startedAt.toISOString()]) >= 1)

    // --- 6. ce que le serveur de ProjectLead fait du retour : son state, son nonce et son verifier (cookie pl_lead_login de
    // l'aperçu ProjectLead), le code échangé au jeton d'ERPlead (aperçu, client projectlead) : la personne TEST.
    const plCookie = (await wv.ctx.cookies(t.pl.url)).find((c) => c.name === 'pl_lead_login')
    const raw = plCookie ? decodeURIComponent(plCookie.value) : ''
    let saved = null
    try { saved = JSON.parse(raw.slice(0, raw.lastIndexOf('.'))) } catch {}
    check('cookie de départ de ProjectLead (pl_lead_login, HttpOnly) : même state que le retour', plCookie?.httpOnly && saved?.state === plState && cb.searchParams.get('state') === saved?.state)
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
    check('ProjectLead reçoit la personne TEST : le code du retour, échangé avec le verifier de ProjectLead, donne un jeton d’identité signé (iss erplead.io, aud projectlead, nonce de ProjectLead, adresse et organisation de la personne TEST)',
      sigOk && claims?.iss === 'https://erplead.io' && claims?.aud === 'projectlead' && claims?.nonce === saved?.nonce &&
      String(claims?.email).toLowerCase() === who.email.toLowerCase() && claims?.email_verified === true && claims?.org === who.org && claims?.exp > Date.now() / 1000,
      claims ? { iss: claims.iss, aud: claims.aud, nonceOk: claims.nonce === saved?.nonce, org: claims.org === who.org } : tok.error ?? 'pas de jeton')
    await page.goto(`${t.erp.url}/account`)
    check('Mon compte (ERPlead) dans la vue web : la personne TEST', (await page.content()).includes(who.email))
    await shot(page, 'g3-compte-fr')

    // --- 7. une seule fois : nouvelle page de l'app, getLaunchUrl rend encore le même lien ; appUrlOpen le redonne
    const closesBefore = records('close').length
    await page.goto(`${t.pl.url}/confidentialite`)
    await waitFor(() => records('listen').filter((c) => c.at.startsWith(`${t.pl.url}/confidentialite`)).length > 0, 10_000)
    await sleep(2500)
    await page.evaluate((u) => window.__capFire('appUrlOpen', { url: u }), link)
    await sleep(2500)
    check('page suivante de l’app (même vue web) : le lien de lancement déjà traité et le même lien redonné sont ignorés (aucun rachat, aucune fermeture, la page reste)',
      redeems.length === 1 && records('close').length === closesBefore && page.url() === `${t.pl.url}/confidentialite`, { redeems: redeems.length, url: page.url() })
    for (const foreign of [`io.crmlead.app://lead-auth?code=${randomBytes(32).toString('base64url')}`, `io.projectlead.app://sso?code=${randomBytes(32).toString('base64url')}`,
      `io.projectlead.appx://lead-auth?code=${randomBytes(32).toString('base64url')}`, 'https://projectlead.io/lead-auth?code=x'])
      await page.evaluate((u) => window.__capFire('appUrlOpen', { url: u }), foreign)
    await sleep(2500)
    check('liens étrangers (autre app, ancien retour sso, schéma voisin, https) : ignorés dans la vue web', redeems.length === 1 && records('close').length === closesBefore &&
      page.url() === `${t.pl.url}/confidentialite`, page.url())
    // Demande échue : la connexion normale de l'app (aucun back gardé : il a servi au retour précédent).
    const navs = []
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()) })
    launchUrl = null
    await page.evaluate(() => window.__capFire('appUrlOpen', { url: 'io.projectlead.app://lead-auth?error=expired' }))
    await waitFor(() => navs.length > 0, 15_000)
    check('lien « demande échue » (error=expired) : jamais de rachat, la connexion normale de l’app (/login de ProjectLead)',
      navs[0] === `${t.pl.url}/login` && redeems.length === 1 && records('close').length === closesBefore + 1, navs.slice(0, 2))
    await sleep(3000)
    await wv.ctx.close(); await sys.ctx.close()

    // --- 8. textes de la page relais dans les cinq langues (vue web de l'app, départ fictif : rien n'est ouvert pour de vrai)
    const lang = await context(APP_UA, 'webview')
    for (const l of LOCALES) {
      await lang.page.goto(`${t.pl.url}/confidentialite`)
      await lang.page.evaluate((x) => localStorage.setItem('pl.lang', x), l)
      const n = records('open').length
      await lang.page.goto(`${t.pl.url}/lead-auth/google?${new URLSearchParams({ start: `${t.erp.url}/auth/google/app/start?d=projectlead.essai-${l}`,
        back: `${t.erp.url}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dprojectlead&locale=${l}` })}`)
      await waitFor(() => records('open').length > n, 10_000)
      await lang.page.waitForSelector('[data-lead-auth-back]', { timeout: 10_000 }).catch(() => {})
      const title = await lang.page.locator('h1').first().textContent().catch(() => '')
      const body = await lang.page.locator('[data-lead-auth-relay]').textContent().catch(() => '')
      check(`page relais (${l}) : « ${T[l]['shell.leadAuth.title']} », texte et « ${T[l]['shell.leadAuth.back']} »`, title === T[l]['shell.leadAuth.title'] &&
        body.includes(T[l]['shell.leadAuth.body']) && body.includes(T[l]['shell.leadAuth.back']) && records('open').length === n + 1)
      await shot(lang.page, `g3-relais-${l}`)
    }
    await lang.ctx.close()

    // --- 9. hors de l'app : le site web inchangé, la page relais renvoie à back sans rien ouvrir
    const web = await context(DESKTOP, 'desktop')
    const before = authorizes.length
    await web.page.goto(`${t.pl.url}/login`)
    await web.page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 45_000 }).catch(() => {})
    const waz = authorizes.slice(before).map((u) => new URL(u)).find((u) => u.searchParams.get('client_id') === 'projectlead')
    const wg = web.page.locator('a[href^="/auth/google"]')
    check('site web (navigateur d’ordinateur) : connexion sans platform=app, « Continuer avec Google » ordinaire (/auth/google?next=…, même navigateur)',
      waz && !waz.searchParams.get('platform') && (await wg.count()) === 1 && ((await wg.getAttribute('href')) ?? '').startsWith('/auth/google?next=') &&
      (await web.page.locator('[data-google-app-hint]').count()) === 0, waz?.toString())
    const backWeb = `${t.erp.url}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dprojectlead&locale=fr`
    await web.page.goto(`${t.pl.url}/lead-auth/google?${new URLSearchParams({ start: `${t.erp.url}/auth/google/app/start?d=projectlead.essai-web`, back: backWeb })}`)
    await web.page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 20_000 }).catch(() => {})
    check('page relais ouverte hors de l’app (aucun pont) : retour à back, rien d’ouvert, aucun écouteur', web.page.url() === backWeb &&
      !calls.some((c) => c.arg.includes('essai-web')), web.page.url())
    await web.ctx.close()

    // --- 10. ancienne version (1.0.1, sans LeadAppAuth/1) : pas de bouton Google cassé, la phrase utile
    const old = await context(OLD_UA, 'webview')
    await old.page.goto(`${t.pl.url}/login`)
    await old.page.waitForURL((u) => u.toString().startsWith(`${t.erp.url}/login?`), { timeout: 45_000 }).catch(() => {})
    check('ancienne version de l’app (1.0.1, sans LeadAppAuth/1) : aucun bouton Google, la phrase « Mot de passe oublié ? », Apple',
      (await old.page.locator('a[href*="/auth/google"]').count()) === 0 && (await old.page.locator('[data-google-app-hint]').count()) === 1 &&
      (await old.page.locator('a[href^="/auth/apple?"]').count()) === 1)
    await shot(old.page, 'g3-ancienne-version-fr')
    await old.ctx.close()

    check('Google ne s’ouvre jamais dans une vue web (aucune requête vers accounts.google.com depuis la vue web)', googleInWebview.length === 0, googleInWebview)
    check('aucune requête vers la production (projectlead.io, erplead.io) : page relais et retour OpenID interceptés dans le navigateur', prodHits.length === 0, prodHits.slice(0, 5))
  } finally {
    await browser.close()
    // --- base d'APERÇU d'ERPlead remise comme avant, autour de la personne TEST : sessions, codes et jetons OpenID, états,
    // journal de la porte ; dernière connexion, langue et dernière venue de l'organisation dans ProjectLead reprises.
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
      note(`remise en état : ${s.rowCount} session(s), ${c.rowCount} code(s) OpenID, ${rt.rowCount} jeton(s) de rafraîchissement, ${st.rowCount} état(s), ${au.rowCount} ligne(s) de journal ; dernière connexion, langue et organisation reprises`)
    })
  }
  const after = sqlRead(t.erp.ro, `select json_build_object('sessions', (select count(*) from sessions where user_id = $1 and created_at >= $2),
      'codes', (select count(*) from codes where user_id = $1 and expires_at >= $2), 'refresh', (select count(*) from refresh_tokens where user_id = $1 and created_at >= $2),
      'states', (select count(*) from sso_states where data->>'vh' = any(string_to_array($3, ',')) or state = any(string_to_array($4, ','))),
      'last_login_at', (select last_login_at from users where id = $1), 'locale', (select locale from users where id = $1),
      'org_app', (select last_at from org_apps where org_id = $5 and app = 'projectlead'))`,
    [who.id, startedAt.toISOString(), madeVh.join(','), [...madeStates, ...madeCodes].join(','), who.org])
  check('base d’APERÇU d’ERPlead remise comme avant (aucune session, aucun code ni jeton, aucun état de la porte ; dernière connexion, langue, organisation d’avant)',
    after.sessions === 0 && after.codes === 0 && after.refresh === 0 && after.states === 0 && after.locale === who.locale && after.last_login_at === who.last_login_at &&
    (orgAppBefore ? after.org_app === orgAppBefore.last_at : after.org_app === null), after)
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
