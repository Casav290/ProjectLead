#!/usr/bin/env node
/**
 * Portes du chantier « tout ce que l'assistant propose s'applique » (27.10.2026) pour ProjectLead.
 * Ledger : ~/projets/.unlazy/assistant-actions/gates/leaf-projectlead.md. Cahier : ~/projets/.unlazy/assistant-actions/CAHIER.md.
 *
 *   node scripts/assistant-actions-gates.mjs G1|G2|G3|G4|G5|G6 [--list-routes]
 *
 * Chaque porte vérifie vraiment (lance les contrôles, relit la base, joue le scénario) et n'imprime son jeton
 * ASSISTANT_ACTIONS_Gn_OK qu'à la fin, après toutes ses assertions. Aucun secret n'est affiché : les adresses de base et
 * les jetons sont lus dans des fichiers hors dépôt (600) et ne passent qu'en variables d'environnement des sous-processus.
 *
 * G1  inventaire docs/ASSISTANT-ACTIONS.md : chaque écriture de l'API est classée ; chaque ligne permise nomme des outils
 *     propose_* réellement enregistrés, et la liste fermée (token.ts) l'accepte ; chaque ligne interdite est refusée par
 *     cette liste ; chaque outil propose_* enregistré figure dans l'inventaire.
 * G2  scripts/assistant-actions-check.ts (lot, plan, chaque outil nouveau : proposition sans écriture, confirmation
 *     exacte, rejeu 403, autre personne / autre entreprise 403, échec au milieu d'un lot = rien) + assistant-check.ts.
 * G3  contrôles complets : cinq langues (i18n-check), types, npm test (smoke), contrôles de l'assistant, suites, build, aucune clé dans le paquet du
 *     navigateur (témoin positif), aucune clé ni fichier d'environnement dans le dépôt.
 * G4  essai réel sur l'APERÇU Vercel (vrai modèle, compte TEST) : scripts/e2e-assistant-actions.mjs --scenario plan.
 * G5  essai réel sur l'aperçu : demandes interdites (supprimer, envoyer) refusées : e2e … --scenario interdit.
 * G6  production (après le feu vert seulement) : e2e … --prod + PROD-projectlead.md (sauvegarde, déploiement, retour).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = homedir()
const CHANTIER = join(HOME, 'projets/.unlazy/assistant-actions')
const gate = process.argv[2]
let failures = 0
const ok = (name) => console.log(`  ✓ ${name}`)
const ko = (name, detail) => { failures++; console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${String(detail).slice(0, 600)}`}`) }
const expect = (name, cond, detail) => (cond ? ok(name) : ko(name, detail))
const finish = (token) => {
  if (failures) { console.log(`\n${failures} assertion(s) en échec : pas de jeton.`); process.exit(1) }
  console.log(`\n${token}`)
}

/** La base locale de test (TEST_DATABASE_URL), dérivée du fichier du 24.10 (hors dépôt, 600) : même rôle, autre base. */
function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  const f = join(HOME, 'projets/.unlazy/assistant-ia/projectlead-testdb.url')
  if (!existsSync(f)) throw new Error(`base de test introuvable (${f})`)
  const url = readFileSync(f, 'utf8').trim().replace(/\/[^/]+$/, '/projectlead_test_actions')
  if (!/@localhost(:\d+)?\/projectlead_test_actions$/.test(url)) throw new Error('la base de test doit être locale (localhost)')
  return url
}
/** Lance une commande dans le dépôt ; rend { code, out (sortie standard), err } (gardées en mémoire, jamais de secret). */
function run(cmd, args, env = {}, timeout = 900_000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }
}
const lastLine = (s) => s.trim().split('\n').filter(Boolean).pop() ?? ''

// ------------------------------------------------------------------ G1 : l'inventaire

/** Toutes les routes d'écriture de l'API (POST, PATCH, PUT, DELETE), chemins complets, paramètres notés « :id ». */
function writeRoutes() {
  const index = readFileSync(join(ROOT, 'server/index.ts'), 'utf8')
  const prefixOf = new Map()   // nom local dans index.ts → préfixe
  const localOf = new Map()    // « fichier:nom exporté » (ou « fichier:default ») → nom local dans index.ts
  for (const m of index.matchAll(/import\s+(\w+)(?:\s*,\s*\{([^}]*)\})?\s+from\s+'\.\/routes\/(\w+)\.js'/g)) {
    localOf.set(`${m[3]}:default`, m[1])
    for (const named of (m[2] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      const [exported, local] = named.split(/\s+as\s+/)
      localOf.set(`${m[3]}:${exported}`, local ?? exported)
    }
  }
  for (const m of index.matchAll(/app\.route\('([^']*)',\s*(\w+)\)/g)) prefixOf.set(m[2], m[1])
  const norm = (p) => p.replace(/:[A-Za-z_]+(\{[^}]*\})?/g, ':id').replace(/\/+$/, '') || '/'
  const routes = new Map()
  const add = (method, path, where) => routes.set(`${method} ${norm(path)}`, where)
  // Les routes posées dans server/index.ts même.
  for (const m of index.matchAll(/^app\.(post|patch|put|delete)\('([^']+)'/gm)) add(m[1].toUpperCase(), m[2], 'server/index.ts')
  for (const file of readdirSync(join(ROOT, 'server/routes')).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(ROOT, 'server/routes', file), 'utf8')
    const base = file.replace(/\.ts$/, '')
    for (const m of src.matchAll(/^(\w+)\.(post|patch|put|delete)\(\s*'([^']+)'/gm)) {
      const [, router, method, path] = m
      // Le routeur par défaut du fichier (« app ») ou un routeur nommé et exporté (pages publiques, webhook).
      const local = localOf.get(`${base}:${router === 'app' ? 'default' : router}`)
      const prefix = local ? prefixOf.get(local) : undefined
      if (prefix === undefined) throw new Error(`routeur sans préfixe connu : ${file} ${router}`)
      add(method.toUpperCase(), `${prefix === '/' ? '' : prefix}${path === '/' ? '' : path}`, `server/routes/${file}`)
    }
  }
  return routes
}

const CATEGORIES = ['supprimer', 'payer', 'formule', 'membres-droits', 'cles-api', 'identifiants', 'integrations', 'envoyer-exterieur', 'fichier', 'connexion', 'hors-interface']

/** Les lignes du tableau de l'inventaire : | écran | action | route | outil(s) ou « interdit : catégorie » |. */
function inventoryRows() {
  const doc = readFileSync(join(ROOT, 'docs/ASSISTANT-ACTIONS.md'), 'utf8')
  const rows = []
  for (const line of doc.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 4 || !/^`?(GET|POST|PATCH|PUT|DELETE) \//.test(cells[2])) continue
    const m = cells[2].replace(/`/g, '').match(/^(GET|POST|PATCH|PUT|DELETE) (\S+)(?: \{([^}]*)\})?$/)
    if (!m) { rows.push({ bad: line }); continue }
    const body = {}
    for (const f of (m[3] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      const [k, v] = f.split('=')
      // « a.b=v » : champ imbriqué (le corps de la sélection multiple : { ids, patch: { … } }).
      const keys = k.split('.')
      let at = body
      for (const key of keys.slice(0, -1)) at = at[key] ??= {}
      at[keys.at(-1)] = v === undefined ? 'x' : v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v
    }
    const verdict = cells[3].replace(/`/g, '')
    const forbidden = verdict.match(/^interdit\s*:\s*([a-z-]+)/)
    rows.push({ screen: cells[0], action: cells[1], method: m[1], path: m[2], body, fields: Boolean(m[3]),
      category: forbidden?.[1] ?? null, tools: forbidden ? [] : verdict.split(/[,;]\s*/).map((t) => t.trim()).filter(Boolean), line })
  }
  return rows
}

function g1() {
  const routes = writeRoutes()
  if (process.argv.includes('--list-routes')) { for (const [r, w] of [...routes].sort()) console.log(`${r}\t${w}`); return }
  console.log(`G1 — inventaire (${routes.size} routes d'écriture dans l'API)`)
  const rows = inventoryRows()
  expect('le tableau de l’inventaire se lit (aucune ligne mal formée)', rows.every((r) => !r.bad), rows.filter((r) => r.bad).map((r) => r.bad).join(' / '))
  // Les outils réellement enregistrés et la liste fermée, lus dans le code (tsx), pas recopiés ici.
  const probe = join(mkdtempSync(join(tmpdir(), 'pl-g1-')), 'probe.mts')
  writeFileSync(probe, `process.env.DATABASE_URL ||= 'postgres://inutile@localhost/x'
const { buildTools } = await import(${JSON.stringify(join(ROOT, 'server/lib/assistant/tools.ts'))})
const { opAllowed } = await import(${JSON.stringify(join(ROOT, 'server/lib/assistant/token.ts'))})
const tools = buildTools({ cookie: '', ctx: { accountId: '', userId: '', role: 'member' }, actions: [], used: [], today: '2026-10-27' })
const rows = JSON.parse(process.argv[2])
const U = '00000000-0000-4000-8000-000000000000'
const verdicts = rows.map((r) => { const op = { method: r.method, path: r.path.replace(/:id/g, U), body: r.body }
  return { tx: opAllowed(op, 'tx'), route: opAllowed(op, 'route') } })
console.log(JSON.stringify({ names: tools.map((t) => t.name), verdicts }))
process.exit(0)`)
  const rowsIn = rows.filter((r) => !r.bad).map((r) => ({ method: r.method, path: r.path, body: r.body }))
  const out = execFileSync('npx', ['tsx', probe, JSON.stringify(rowsIn)], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
  rmSync(dirname(probe), { recursive: true, force: true })
  const { names, verdicts } = JSON.parse(out.trim().split('\n').pop())
  const registered = new Set(names)
  const writeTools = names.filter((n) => n.startsWith('propose_'))
  expect(`outils enregistrés lus dans le code : ${names.length} dont ${writeTools.length} outils d’écriture propose_*`, writeTools.length >= 30)
  const good = rows.filter((r) => !r.bad)
  // 1. Chaque route d'écriture de l'API est classée dans l'inventaire (au moins une ligne).
  const listed = new Set(good.map((r) => `${r.method} ${r.path}`))
  const missing = [...routes.keys()].filter((k) => !listed.has(k))
  expect(`chaque route d’écriture de l’API figure dans l’inventaire (${routes.size - missing.length}/${routes.size})`, !missing.length, missing.join(', '))
  const unknown = good.filter((r) => r.method !== 'GET' && !routes.has(`${r.method} ${r.path}`))
  expect('aucune ligne ne cite une route qui n’existe pas', !unknown.length, unknown.map((r) => `${r.method} ${r.path}`).join(', '))
  // 2. Chaque ligne : une catégorie d'interdit connue, ou des outils propose_* enregistrés.
  const badCat = good.filter((r) => r.category && !CATEGORIES.includes(r.category))
  expect('chaque interdit a une catégorie connue', !badCat.length, badCat.map((r) => r.line).join(' / '))
  const badTools = good.filter((r) => !r.category && (!r.tools.length || r.tools.some((t) => !t.startsWith('propose_') || !registered.has(t))))
  expect('chaque ligne permise nomme des outils propose_* réellement enregistrés', !badTools.length, badTools.map((r) => `${r.line}`).join(' / '))
  // 3. La liste fermée (token.ts) dit la même chose que l'inventaire.
  const incoherent = good.map((r, i) => ({ r, v: verdicts[i] })).filter(({ r, v }) =>
    r.method === 'GET' ? false : r.category ? (v.tx || v.route) : !(v.tx || v.route))
  expect('liste fermée = inventaire : chaque ligne permise est acceptée, chaque ligne interdite refusée',
    !incoherent.length, incoherent.map(({ r, v }) => `${r.method} ${r.path} ${JSON.stringify(r.body)} → ${JSON.stringify(v)}`).join(' / '))
  // 4. Témoins : le comparateur distingue vraiment (une ligne permise acceptée, la même route avec un champ interdit
  //    refusée, une suppression refusée), et l'énumération des routes n'en perd aucune (comptage large du source).
  const idx = (pred) => good.findIndex(pred)
  const iStage = idx((r) => !r.category && r.method === 'POST' && r.path === '/api/projects/:id/stages')
  const iNotify = idx((r) => r.category && r.path === '/api/projects/stages/:id' && 'notify_client' in r.body)
  const iDelete = idx((r) => r.category === 'supprimer' && r.method === 'DELETE' && r.path === '/api/tasks/:id')
  expect('témoin positif : « créer une étape » est accepté par la liste fermée', iStage >= 0 && (verdicts[iStage].tx || verdicts[iStage].route))
  expect('témoin négatif : la même famille de route avec « prévenir le client » est refusée', iNotify >= 0 && !verdicts[iNotify].tx && !verdicts[iNotify].route)
  expect('témoin négatif : supprimer une tâche est refusé', iDelete >= 0 && !verdicts[iDelete].tx && !verdicts[iDelete].route)
  const sources = ['server/index.ts', ...readdirSync(join(ROOT, 'server/routes')).filter((f) => f.endsWith('.ts')).map((f) => `server/routes/${f}`)]
  const loose = sources.reduce((n, f) => n + (readFileSync(join(ROOT, f), 'utf8').match(/\b\w+\.(post|patch|put|delete)\(\s*['"`]/g) ?? []).length, 0)
  const exact = sources.reduce((n, f) => n + (readFileSync(join(ROOT, f), 'utf8').match(/^\w+\.(post|patch|put|delete)\(\s*'/gm) ?? []).length, 0)
  expect(`énumération complète : ${exact} déclarations lues = ${loose} trouvées par une recherche large`, exact === loose && exact >= routes.size)
  // 5. Chaque outil d'écriture enregistré figure dans l'inventaire.
  const documented = new Set(good.flatMap((r) => r.tools))
  const undocumented = writeTools.filter((t) => !documented.has(t))
  expect('chaque outil propose_* enregistré figure dans l’inventaire', !undocumented.length, undocumented.join(', '))
  // 6. Le scénario d'Ève : planifier les étapes d'un projet a sa ligne et son outil métier.
  expect('le plan de projet (étapes + tâches + jalons + dépendances + dates) pointe vers propose_project_plan',
    good.some((r) => r.path === '/api/projects/:id/stages' && r.tools.includes('propose_project_plan'))
    && good.some((r) => r.path === '/api/tasks/:id/dependencies' && r.tools.includes('propose_project_plan')))
  finish('ASSISTANT_ACTIONS_G1_OK')
}

// ------------------------------------------------------------------ G2 : tests du lot et des nouveaux outils

function g2() {
  console.log('G2 — lot, plan et outils nouveaux (faux service de modèle, base locale)')
  const env = { TEST_DATABASE_URL: testDatabaseUrl() }
  const a = run('npx', ['tsx', 'scripts/assistant-actions-check.ts'], env)
  const verts = a.out.match(/^(\d+) contrôles verts, (\d+) rouges$/m)
  expect(`assistant-actions-check : ${verts ? `${verts[1]} verts, ${verts[2]} rouges` : 'pas de bilan'}`, a.code === 0 && verts && verts[2] === '0'
    && Number(verts[1]) >= 300 && lastLine(a.out) === 'ASSISTANT_ACTIONS_CHECK_OK', lastLine(a.out))
  for (const must of ['proposition : RIEN d’écrit (essai annulé), aucun email, jeton non consommé', 'rejeu du même jeton → 403 token_used, rien de plus',
    'jeton d’Ann présenté par Bob → 403', 'jeton présenté depuis une autre entreprise → 403',
    'lot dont la 4e écriture est refusée → 400, message clair, NI étape NI tâche écrites', 'en base : les 10 tâches, étape, début, échéance, estimation, jalon exacts',
    'lot : autre entreprise → 403', 'deux « Confirmer » simultanés : un 200, un 403, une seule tâche',
    // Tout ou rien, email compris (28.10) : l'email d'une automatisation attend la validation de toute la carte.
    'lot refusé à la 4e écriture après une tâche qui déclenche le suivi client : AUCUN email parti, aucun suivi, aucune tâche',
    'lot validé : l’email du suivi part APRÈS la validation (une fois, au contact qui reçoit le suivi)',
    // La carte ne dit « fait » que si quelque chose a été fait (outils seuls sur leur carte, 28.10).
    'propose_monthly_billing confirmée, projet sans client : la route note l’erreur, la carte ne dit pas « fait » (502, « Aucun brouillon créé »)',
    'propose_sync_now, agenda en panne : 502, message clair dans la langue (de), aucun rendez-vous perdu'])
    expect(`vu vert : « ${must} »`, a.out.includes(`✓ ${must}`))
  // A8 pour CHAQUE outil d'écriture enregistré (registre lu dans le code) : proposition sans écriture, autre personne et
  // autre entreprise 403, confirmation, rejeu 403 — chacun vu vert dans le bilan. Le plan et le lot ont leurs lignes ci-dessus.
  const registry = readFileSync(join(ROOT, 'server/lib/assistant/tools.ts'), 'utf8').match(/export const TOOL_NAMES = \[([\s\S]*?)\] as const/)
  const tools = [...(registry?.[1] ?? '').matchAll(/'(propose_[a-z_]+)'/g)].map((m) => m[1]).filter((t) => !['propose_batch', 'propose_project_plan'].includes(t))
  const greens = a.out.split('\n').filter((l) => l.startsWith('  ✓ ')).map((l) => l.slice(4))
  const PROOFS = { proposition: /proposition sans écriture|rien d’écrit/, 'autre personne et autre entreprise 403': /autre personne 403, autre entreprise 403/,
    confirmation: /confirmation exacte|confirmée|la confirmation appelle la route/, rejeu: /rejeu 403/ }
  const incomplete = tools.map((t) => ({ t, miss: Object.entries(PROOFS).filter(([, re]) =>
    !greens.some((l) => (l.startsWith(`${t} `) || l.startsWith(`${t} (`)) && re.test(l))).map(([k]) => k) })).filter((x) => x.miss.length)
  expect(`A8 pour chacun des ${tools.length} outils d’écriture (hors plan et lot) : proposition, autre personne / entreprise 403, confirmation, rejeu`,
    tools.length >= 38 && !incomplete.length, incomplete.map((x) => `${x.t} : ${x.miss.join(', ')}`).join(' / '))
  const b = run('npx', ['tsx', 'scripts/assistant-check.ts'], env)
  expect('assistant-check (bulle du 24.10, jetons, quotas, droits) toujours vert', b.code === 0 && lastLine(b.out) === 'ASSISTANT_CHECK_OK', lastLine(b.out))
  finish('ASSISTANT_ACTIONS_G2_OK')
}

// ------------------------------------------------------------------ G3 : contrôles complets de l'application

function g3() {
  console.log('G3 — contrôles complets (types, smoke, assistant, suites, build, paquet, dépôt)')
  const env = { TEST_DATABASE_URL: testDatabaseUrl() }
  // Les cinq langues (CLAUDE.md, 27.10.2026) : mêmes clés partout, aucun texte en dur, et le détecteur trouve un témoin.
  for (const [mode, token] of [['--keys', 'I18N_KEYS_OK'], ['--hardcoded', 'I18N_HARDCODED_OK'], ['--control', 'I18N_CONTROL_OK']]) {
    const i = run('npx', ['tsx', 'scripts/i18n-check.ts', mode])
    expect(`i18n-check ${mode}`, i.code === 0 && lastLine(i.out) === token, lastLine(i.out) || i.err.slice(-200))
  }
  const tsc = run('npm', ['run', '-s', 'typecheck'])
  expect('npm run typecheck', tsc.code === 0, (tsc.out + tsc.err).slice(-400))
  const smoke = run('npm', ['test'], env)
  const sm = smoke.out.match(/^(\d+) contrôles verts, (\d+) rouges$/m)
  expect(`npm test (scripts/smoke.ts) : ${sm ? `${sm[1]} verts, ${sm[2]} rouges` : 'pas de bilan'}`, smoke.code === 0 && sm && sm[2] === '0' && Number(sm[1]) >= 526, lastLine(smoke.out))
  const ac = run('npx', ['tsx', 'scripts/assistant-check.ts'], env)
  expect('scripts/assistant-check.ts', ac.code === 0 && lastLine(ac.out) === 'ASSISTANT_CHECK_OK', lastLine(ac.out))
  const aa = run('npx', ['tsx', 'scripts/assistant-actions-check.ts'], env)
  expect('scripts/assistant-actions-check.ts', aa.code === 0 && lastLine(aa.out) === 'ASSISTANT_ACTIONS_CHECK_OK', lastLine(aa.out))
  const su = run('npx', ['tsx', 'scripts/suites-check.ts'])
  expect('scripts/suites-check.ts', su.code === 0 && su.out.includes('PROJECTLEAD_SUITES_UNIT_OK'), lastLine(su.out))
  expect('pas de linter dans package.json (rien à lancer)', !/"lint"/.test(readFileSync(join(ROOT, 'package.json'), 'utf8')))
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true })
  const build = run('npm', ['run', '-s', 'build'])
  expect('npm run build', build.code === 0 && existsSync(join(ROOT, 'dist/index.html')), (build.out + build.err).slice(-400))
  // Le paquet du navigateur : ni clé, ni nom du fournisseur ou du modèle. Témoin positif : la même recherche trouve un témoin.
  const files = []
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  if (existsSync(join(ROOT, 'dist'))) walk(join(ROOT, 'dist'))
  // Seule mention permise : Claude cité parmi les outils extérieurs d'une clé d'API (Réglages → API, en production
  // depuis le 26.10.2026, hors de l'assistant ; même liste dans les cinq langues, clé settings.integrations.apiText).
  // L'assistant, lui, ne nomme ni fournisseur ni modèle.
  const ALLOWED = 'Zapier, Make, Claude, ChatGPT'
  const BAD = /sk-ant|anthropic|claude|opus-5/i
  const scan = (text) => BAD.test(text.split(ALLOWED).join(''))
  const temoin = join(mkdtempSync(join(tmpdir(), 'pl-g3-')), 'temoin.js')
  writeFileSync(temoin, `const k = "sk-ant-temoin"; const t = "Pour ${ALLOWED} ou vos scripts."`)
  expect('témoin : la recherche trouve « sk-ant » dans un fichier témoin (et ignore la phrase permise)', scan(readFileSync(temoin, 'utf8'))
    && !scan(ALLOWED))
  rmSync(dirname(temoin), { recursive: true, force: true })
  const leaks = files.filter((f) => scan(readFileSync(f, 'utf8')))
  expect(`paquet du navigateur (${files.length} fichiers) : aucune clé, ni « anthropic », ni nom du modèle, « Claude » seulement dans la phrase des outils de l’API`,
    files.length > 3 && !leaks.length, leaks.join(', '))
  const bubble = readFileSync(join(ROOT, 'src/components/Assistant.tsx'), 'utf8')
  expect('la bulle (src/components/Assistant.tsx) ne nomme ni Claude, ni Anthropic, ni le modèle', !/claude|anthropic|opus/i.test(bubble))
  // Le dépôt : aucune clé, aucun fichier d'environnement suivi.
  const grep = spawnSync('git', ['grep', '-nE', 'sk-ant-[A-Za-z0-9_-]{8,}', 'HEAD', '--', '.'], { cwd: ROOT, encoding: 'utf8' })
  expect('dépôt (HEAD) : aucune clé « sk-ant-… »', grep.status === 1, grep.stdout.slice(0, 300))
  const wt = spawnSync('git', ['grep', '-nE', 'sk-ant-[A-Za-z0-9_-]{8,}', '--', '.'], { cwd: ROOT, encoding: 'utf8' })
  expect('copie de travail : aucune clé « sk-ant-… »', wt.status === 1, wt.stdout.slice(0, 300))
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
  expect('aucun fichier .env suivi par git', !tracked.some((f) => /(^|\/)\.env(\.local)?$/.test(f)))
  finish('ASSISTANT_ACTIONS_G3_OK')
}

// ------------------------------------------------------------------ G4 / G5 / G6 : essais réels (navigateur sans tête)

function e2e(args, token, label) {
  console.log(label)
  const r = run('node', ['scripts/e2e-assistant-actions.mjs', ...args], {}, 1_200_000)
  process.stdout.write(r.out.split('\n').filter((l) => /^\s*[✓✗]|^Aperçu|^Production|^Durée|^—/.test(l)).map((l) => `${l}\n`).join(''))
  const verts = r.out.match(/^(\d+) contrôles verts, (\d+) rouges$/m)
  expect(`essai réel : ${verts ? `${verts[1]} verts, ${verts[2]} rouges` : 'pas de bilan'}`, r.code === 0 && verts && verts[2] === '0' && Number(verts[1]) >= 10, lastLine(r.out))
  expect('dernière ligne de l’essai', lastLine(r.out) === token.replace('ASSISTANT_ACTIONS_', 'E2E_ACTIONS_'), lastLine(r.out))
  return r.out
}

function g4() {
  e2e(['--scenario', 'plan'], 'ASSISTANT_ACTIONS_G4_OK', 'G4 — aperçu Vercel : le scénario d’Ève, vrai modèle, compte TEST')
  const shots = join(CHANTIER, 'captures/projectlead')
  const big = (k) => existsSync(shots) && readdirSync(shots).some((f) => f.includes(k) && f.endsWith('.png') && statSync(join(shots, f)).size > 20_000)
  expect('captures bureau et mobile présentes (> 20 ko)', big('bureau') && big('mobile'))
  finish('ASSISTANT_ACTIONS_G4_OK')
}
function g5() {
  e2e(['--scenario', 'interdit'], 'ASSISTANT_ACTIONS_G5_OK', 'G5 — aperçu Vercel : demandes interdites refusées')
  finish('ASSISTANT_ACTIONS_G5_OK')
}
function g6() {
  const prod = join(CHANTIER, 'PROD-projectlead.md')
  expect('PROD-projectlead.md présent (sauvegarde, déploiement, retour arrière)', existsSync(prod))
  if (existsSync(prod)) {
    const t = readFileSync(prod, 'utf8')
    expect('PROD-projectlead.md : sauvegarde Neon, déploiement dpl_, retour arrière notés', /br-[a-z0-9-]+|LSN/.test(t) && /dpl_[A-Za-z0-9]+/.test(t) && /retour arrière/i.test(t))
  }
  e2e(['--prod'], 'ASSISTANT_ACTIONS_G6_OK', 'G6 — production : le scénario d’Ève avec le compte TEST')
  finish('ASSISTANT_ACTIONS_G6_OK')
}

const GATES = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5, G6: g6 }
if (!GATES[gate]) { console.log('usage : node scripts/assistant-actions-gates.mjs G1|G2|G3|G4|G5|G6'); process.exit(2) }
try { GATES[gate]() } catch (e) { console.log(`  ✗ ${gate} interrompue : ${String(e?.message ?? e).slice(0, 300)}`); process.exit(1) }
