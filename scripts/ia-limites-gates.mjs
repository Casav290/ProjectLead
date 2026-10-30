#!/usr/bin/env node
/**
 * Portes du chantier « périmètre du logiciel et limite de la formule gratuite de l'assistant » (29.10.2026) pour
 * ProjectLead. Ledger : ~/projets/.unlazy/ia-limites/gates/leaf-projectlead.md. Cahier : ~/projets/.unlazy/ia-limites/CAHIER.md.
 *
 *   node scripts/ia-limites-gates.mjs G1|G2|G3|G4
 *
 * Chaque porte vérifie vraiment (lance les tests, relit le code et la base, joue l'essai réel) et n'imprime son jeton
 * IA_LIMITES_Gn_OK qu'à la fin, après TOUTES ses assertions. Aucun secret n'est affiché : adresses de base et jetons
 * sont lus dans des fichiers hors dépôt (600) et ne passent qu'en variables d'environnement des sous-processus.
 *
 * G1  tests du périmètre et de la limite (scripts/assistant-limites-check.ts) relancés et verts ; tableau
 *     « Périmètre et limite gratuite (29.10.2026) » de docs/ASSISTANT-ACTIONS.md : P1–P3 et L1–L8, chaque `fichier:ligne`
 *     « extrait » existe et porte l'extrait, chaque test nommé est passé ; quelques preuves lues dans le code (refus
 *     avant le modèle, décision « gratuit » par planOf, une seule source des constantes) ; CONTRE-ÉPREUVES RÉELLES : six
 *     copies du commit volontairement fautives (refus retiré, Pro limité, mois jamais remis à zéro, calcul SQL faux, tours
 *     en cours non comptés, consigne sans périmètre) font échouer les tests attendus ; le contrôle du tableau voit une ligne
 *     décalée et un test inconnu.
 * G2  contrôles complets de l'application : les anciennes portes locales (scripts/assistant-actions-gates.mjs G1, G2, G3,
 *     G7 : inventaire, tests de l'assistant, cinq langues, types, npm test, suites, build, paquet, alignement B1–B14) ;
 *     aucune migration ni changement de db/ depuis la production (db/etape-5b intacte) ; commit au-dessus de la production.
 * G3  essai réel sur l'APERÇU (vrai modèle, compte TEST) : scripts/e2e-ia-limites.mjs --scenario perimetre ; l'aperçu
 *     est bien celui du commit courant (API Vercel : meta.commit = HEAD, pas la production) ; le contrôle du refus voit
 *     ses contre-exemples (blague, poème, script, réponse qui citent ProjectLead) ; le projet TEST de l'essai est retiré.
 * G4  essai réel sur l'APERÇU : scripts/e2e-ia-limites.mjs --scenario limite (consommation posée sur la base d'aperçu,
 *     refus sans appel au modèle, demande refusée rendue au champ, personne non administratrice sans lien, entreprise
 *     payante non limitée, formules dans les cinq langues, base remise).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = homedir()
const CHANTIER = join(HOME, 'projets/.unlazy/ia-limites')
const PROD_COMMIT = 'c077f19'   // le commit en production le 29.10.2026 (vérifié par l'API Vercel), base de la branche
const gate = process.argv[2]
let failures = 0
const ok = (name) => console.log(`  ✓ ${name}`)
const ko = (name, detail) => { failures++; console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${String(detail).slice(0, 600)}`}`) }
const expect = (name, cond, detail) => (cond ? ok(name) : ko(name, detail))
const finish = (token) => {
  if (failures) { console.log(`\n${failures} assertion(s) en échec : pas de jeton.`); process.exit(1) }
  console.log(`\n${token}`)
}
/** La base locale de test (la même que les portes de l'assistant), dérivée du fichier du 24.10 (hors dépôt, 600). */
function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  const f = join(HOME, 'projets/.unlazy/assistant-ia/projectlead-testdb.url')
  if (!existsSync(f)) throw new Error(`base de test introuvable (${f})`)
  const url = readFileSync(f, 'utf8').trim().replace(/\/[^/]+$/, '/projectlead_test_actions')
  if (!/@localhost(:\d+)?\/projectlead_test_actions$/.test(url)) throw new Error('la base de test doit être locale (localhost)')
  return url
}
function run(cmd, args, env = {}, timeout = 1_500_000, cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }
}
const lastLine = (s) => s.trim().split('\n').filter(Boolean).pop() ?? ''
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
const CHECK = 'scripts/assistant-limites-check.ts'
const CHECK_TOKEN = 'ASSISTANT_LIMITES_CHECK_OK'
const bilan = (out) => out.match(/^(\d+) contrôles verts, (\d+) rouges$/m)

// ------------------------------------------------------------------ le tableau de la doc

const DOC = 'docs/ASSISTANT-ACTIONS.md'
const TITLE = '## Périmètre et limite gratuite (29.10.2026)'
const POINTS = ['P1', 'P2', 'P3', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']
const E2E = 'scripts/e2e-ia-limites.mjs'

/** Les lignes du tableau : code `fichier:ligne` « extrait », tests `scripts/… › libellé`, assertions `G3 › …` / `G4 › …`. */
function parseTable(doc) {
  const start = doc.indexOf(TITLE)
  if (start < 0) return null
  const rest = doc.slice(start + TITLE.length)
  const end = rest.search(/\n## /)
  const section = end < 0 ? rest : rest.slice(0, end)
  return section.split('\n').filter((l) => /^\|\s*[PL]\d+\s*\|/.test(l)).map((line) => ({
    id: line.match(/^\|\s*([PL]\d+)\s*\|/)[1],
    code: [...line.matchAll(/`([\w./[\]-]+):(\d+)` «\s*([^»]+?)\s*»/g)].map((x) => ({ file: x[1], line: Number(x[2]), excerpt: x[3] })),
    tests: [...line.matchAll(/`(scripts\/[\w.-]+\.(?:ts|mjs)) › ([^`]+)`/g)].map((x) => ({ file: x[1], title: x[2] })),
    real: [...line.matchAll(/`(G[34]) › ([^`]+)`/g)].map((x) => ({ gate: x[1], title: x[2] })),
  }))
}
/** Une assertion de l'essai réel citée existe dans son code (libellé fixe, ou libellé d'une demande hors périmètre). */
const realExists = (src, title) => src.includes(`check('${title}'`) || src.includes(`check(\`${title.replace(/^hors périmètre \((\w+)\)/, 'hors périmètre (${slug})')}\``)
function tableProblems(doc, passed) {
  const rows = parseTable(doc)
  if (!rows) return [`section « ${TITLE.slice(3)} » absente de ${DOC}`]
  const problems = []
  const ids = rows.map((r) => r.id)
  if (JSON.stringify(ids) !== JSON.stringify(POINTS)) problems.push(`points du tableau : ${ids.join(' ')} (attendu : ${POINTS.join(' ')}, dans l’ordre)`)
  const e2eSrc = readFileSync(join(ROOT, E2E), 'utf8')
  for (const r of rows) {
    if (!r.code.length) problems.push(`${r.id} : aucune référence fichier:ligne « extrait »`)
    if (!r.tests.length) problems.push(`${r.id} : aucun test automatique nommé`)
    for (const c of r.code) {
      const path = join(ROOT, c.file)
      const lines = path.startsWith(`${ROOT}/`) && existsSync(path) ? readFileSync(path, 'utf8').split('\n') : null
      if (!lines) problems.push(`${r.id} : fichier introuvable ${c.file}`)
      else if (c.line < 1 || c.line > lines.length) problems.push(`${r.id} : ${c.file}:${c.line} hors du fichier`)
      else if (!lines[c.line - 1].includes(c.excerpt)) problems.push(`${r.id} : ${c.file}:${c.line} ne contient pas « ${c.excerpt} » (ligne : ${lines[c.line - 1].trim().slice(0, 120)})`)
    }
    for (const x of r.tests) {
      if (x.file !== CHECK) problems.push(`${r.id} : ${x.file} n’est pas le script de tests du chantier`)
      else if (!passed.has(x.title)) problems.push(`${r.id} : test non passé (ou inconnu) : « ${x.title} »`)
    }
    for (const x of r.real) if (!realExists(e2eSrc, x.title)) problems.push(`${r.id} : assertion ${x.gate} introuvable dans ${E2E} : « ${x.title} »`)
  }
  return problems
}

// ------------------------------------------------------------------ G1

/** Une copie du commit (git archive HEAD), modules liés, avec un fichier volontairement fautif. */
function mutant(file, from, to) {
  const dir = mkdtempSync(join(tmpdir(), 'pl-ia-limites-mutant-'))
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive HEAD | tar -x -C "${dir}"`])
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'))
  const p = join(dir, file)
  const src = readFileSync(p, 'utf8')
  if (!src.includes(from)) { rmSync(dir, { recursive: true, force: true }); return null }
  writeFileSync(p, src.split(from).join(to))
  return dir
}
const MUTANTS = [
  { what: 'refus retiré (le budget atteint ne bloque plus)', file: 'server/lib/assistant/quota.ts',
    from: 'if (allowance.limited && allowance.exhausted)', to: 'if (false)',
    fails: ['L4 budget atteint : 402 free_limit, AUCUN appel au modèle, rien de réservé (ne compte pas dans les 40 par heure)'] },
  { what: 'une organisation payante limitée par erreur (Pro avec le budget gratuit)', file: 'server/lib/plans.ts',
    from: 'pro: { openProjects: Number.POSITIVE_INFINITY, seats: 1, assistantTokens: Number.POSITIVE_INFINITY }',
    to: 'pro: { openProjects: Number.POSITIVE_INFINITY, seats: 1, assistantTokens: FREE_MONTHLY_TOKENS }',
    fails: ['L3 abonnement Pro actif : pas de limite même à 1 000 000 consommés (servi, modèle appelé)', 'L3 formules : Gratuit a le budget, Pro et Pro+ n’en ont pas (LIMITS de server/lib/plans.ts)'] },
  { what: 'mois jamais remis à zéro (toute la consommation depuis toujours)', file: 'server/lib/assistant/budget.ts',
    from: 'export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))',
    to: 'export const monthStart = (now = new Date()) => new Date(0 * now.getTime())',
    fails: ['L2 remise à zéro : 1 000 000 consommés le mois précédent (1 s avant le 1er, UTC) ne comptent plus ce mois-ci'] },
  { what: 'calcul SQL faux (sortie non pondérée)', file: 'server/lib/assistant/budget.ts',
    from: '+ ` + cache_read_tokens * ${WEIGHTS.cacheRead} + output_tokens * ${WEIGHTS.output})`', to: '+ ` + cache_read_tokens * ${WEIGHTS.cacheRead} + output_tokens * 1)`',
    fails: ['L1 calcul pondéré : la somme du mois en SQL (journal assistant_usage) = le calcul JS, mêmes champs'] },
  { what: 'tours en cours non comptés (des demandes lancées ensemble passent toutes sous le budget)', file: 'server/lib/assistant/budget.ts',
    from: 'then ${REQUEST_TOKENS} else ${WEIGHTED_SQL} end', to: 'then 0 else ${WEIGHTED_SQL} end',
    fails: ['L4 demandes simultanées : 12 lancées ensemble à 0 consommé → 10 servies (un tour en cours compte pour une demande-type), 2 refusées (402 free_limit) sans appel au modèle',
      'L4 un tour en cours compte pour une demande-type (20 000) tant que ses jetons ne sont pas connus ; une ligne restée ouverte plus longtemps qu’un tour ne compte plus'] },
  { what: 'consigne sans périmètre', file: 'server/lib/assistant/prompt.ts',
    from: '# Périmètre : ProjectLead seulement', to: '# Remarques',
    fails: ['P1 consigne : section « Périmètre : ProjectLead seulement » dans le bloc stable, avant le reste',
      'P3 requête au modèle : le périmètre est dans le bloc système STABLE mis en cache, pas dans le bloc variable'] },
]

function g1() {
  console.log('G1 — périmètre et limite gratuite : tests relancés, tableau de la doc, preuves dans le code, contre-épreuves')
  const env = { TEST_DATABASE_URL: testDatabaseUrl() }
  expect('copie de travail propre (les tests et les copies fautives jugent le même commit)', git('status', '--porcelain') === '')
  const r = run('npx', ['tsx', CHECK], env)
  const v = bilan(r.out)
  const reds = r.out.split('\n').filter((l) => l.startsWith('  ✗ ')).join(' / ')
  expect(`${CHECK} : ${v ? `${v[1]} verts, ${v[2]} rouges` : 'pas de bilan'}, dernière ligne ${lastLine(r.out)}`,
    r.code === 0 && v && v[2] === '0' && Number(v[1]) >= 55 && lastLine(r.out) === CHECK_TOKEN, reds || r.err.slice(-300))
  const passed = new Set(r.out.split('\n').filter((l) => l.startsWith('  ✓ ')).map((l) => l.slice(4)))

  // Le tableau P1–P3, L1–L8 de la doc ↔ code ↔ tests passés.
  const doc = readFileSync(join(ROOT, DOC), 'utf8')
  const rows = parseTable(doc) ?? []
  expect(`section « ${TITLE.slice(3)} » de ${DOC} : ${rows.length} lignes (${rows.map((x) => x.id).join(' ')})`, rows.length === POINTS.length)
  const problems = tableProblems(doc, passed)
  for (const row of rows) {
    const mine = problems.filter((p) => p.startsWith(`${row.id} :`))
    expect(`${row.id} : ${row.code.length} référence(s) de code sur leur ligne, ${row.tests.length} test(s) passé(s)${row.real.length ? `, ${row.real.length} assertion(s) de l’aperçu` : ''}`,
      !mine.length && row.code.length > 0 && row.tests.length > 0, mine.join(' | '))
  }
  for (const p of problems.filter((x) => !/^[PL]\d+ :/.test(x))) expect(p, false)
  const cited = new Set(rows.flatMap((x) => x.tests.map((t) => t.title)))
  expect(`chaque test du script est cité au moins une fois dans le tableau ou est une mise en place (${cited.size} cités)`,
    [...passed].every((t) => cited.has(t) || /^(mise en place|application construite|bulle et formules : aucune erreur)/.test(t)),
    [...passed].filter((t) => !cited.has(t) && !/^(mise en place|application construite|bulle et formules : aucune erreur)/.test(t)).join(' / '))

  // Quelques preuves lues dans le code, indépendantes du tableau.
  const route = readFileSync(join(ROOT, 'server/routes/assistant.ts'), 'utf8')
  const quota = readFileSync(join(ROOT, 'server/lib/assistant/quota.ts'), 'utf8')
  const iRefuse = route.indexOf("throw new HttpError(402, 'free_limit'"), iModel = route.indexOf('new Anthropic(')
  expect('L4 : dans la route, le refus free_limit vient AVANT la création du client du modèle', iRefuse > 0 && iModel > iRefuse)
  expect('L4 : dans le quota, le budget est vu AVANT la réservation (rien réservé quand il est atteint)',
    quota.indexOf("scope: 'free_limit'") > 0 && quota.indexOf("scope: 'free_limit'") < quota.indexOf('insert into assistant_usage'))
  const decision = ['server/lib/assistant/quota.ts', 'server/lib/assistant/budget.ts', 'server/routes/assistant.ts', 'src/components/Assistant.tsx']
    .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')
  expect('L3 : la décision « gratuit » vient de planOf (server/lib/plans.ts), aucune copie (« tier === \'free\' », « plan === \'free\' », trialing…) dans l’assistant',
    /import \{ planOf \} from '\.\.\/plans\.js'/.test(quota) && !/(tier|plan|paidTier|status)\s*[!=]==?\s*'(free|pro|pro_plus|trialing|active)'/.test(decision))
  expect('B1 inchangé : un seul AbortSignal.timeout dans la route', (route.match(/AbortSignal\.timeout\(/g) ?? []).length === 1)

  // Contre-épreuves réelles : une copie fautive du commit fait échouer exactement les tests attendus.
  for (const m of MUTANTS) {
    const dir = mutant(m.file, m.from, m.to)
    if (!dir) { expect(`contre-épreuve (${m.what}) : le code à fausser est introuvable dans ${m.file}`, false); continue }
    try {
      const x = run('npx', ['tsx', CHECK, '--sans-navigateur'], env, 900_000, dir)
      const red = x.out.split('\n').filter((l) => l.startsWith('  ✗ ')).map((l) => l.slice(4).replace(/ \{.*$| \[.*$| ".*$| -?\d+$/, '').trim())
      const seen = m.fails.filter((f) => x.out.includes(`  ✗ ${f}`))
      expect(`contre-épreuve (${m.what}, ${m.file}) : le test échoue — ${seen.length}/${m.fails.length} attendus en rouge, dernière ligne ${lastLine(x.out)}`,
        seen.length === m.fails.length && lastLine(x.out) === 'ASSISTANT_LIMITES_CHECK_FAILED', red.join(' / ') || x.err.slice(-300))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  // Contre-épreuves du contrôle du tableau : une ligne décalée et un test inconnu sont vus.
  const ref = rows.find((x) => x.id === 'L4')?.code[0]
  const shifted = ref ? doc.replace(`\`${ref.file}:${ref.line}\``, `\`${ref.file}:${ref.line + 1}\``) : doc
  expect('contre-épreuve : une référence décalée d’une ligne est vue', shifted !== doc && tableProblems(shifted, passed).some((p) => p.startsWith('L4 :')))
  const unknown = doc.replace(/`scripts\/assistant-limites-check\.ts › L6 ([^`]+)`/, '`scripts/assistant-limites-check.ts › L6 test qui n’existe pas`')
  expect('contre-épreuve : un test inconnu est vu', unknown !== doc && tableProblems(unknown, passed).some((p) => p.startsWith('L6 :')))
  finish('IA_LIMITES_G1_OK')
}

// ------------------------------------------------------------------ G2

function g2() {
  console.log('G2 — contrôles complets de l’application et anciennes portes locales')
  // Le commit est au-dessus de la production, sans migration ni changement de db/ (db/etape-5b intacte : jamais avant le 02.11).
  expect(`le commit descend de la production (${PROD_COMMIT})`, spawnSync('git', ['merge-base', '--is-ancestor', PROD_COMMIT, 'HEAD'], { cwd: ROOT }).status === 0)
  expect('copie de travail propre (les portes jugent le commit)', git('status', '--porcelain') === '')
  const db = git('diff', '--name-only', PROD_COMMIT, 'HEAD', '--', 'db')
  expect('aucune migration ni changement dans db/ depuis la production (db/etape-5b intacte)', db === '', db)
  const lint = /"lint"\s*:/.test(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  expect('pas de linter dans package.json (rien à lancer ; types, i18n et build sont les contrôles de l’app)', !lint)
  // Les anciennes portes, en local : chacune relance ses contrôles et n'imprime son jeton qu'après toutes ses assertions.
  for (const [g, min] of [['G1', 0], ['G2', 0], ['G3', 0], ['G7', 0]]) {
    const r = run('node', ['scripts/assistant-actions-gates.mjs', g], {}, 3_000_000)
    const reds = r.out.split('\n').filter((l) => l.startsWith('  ✗ ')).join(' / ')
    const greens = r.out.split('\n').filter((l) => l.startsWith('  ✓ ')).length
    expect(`ancienne porte assistant-actions ${g} : ${greens} assertions vertes, jeton ${lastLine(r.out)}`, r.code === 0 && greens > min
      && lastLine(r.out) === `ASSISTANT_ACTIONS_${g}_OK`, reds || r.err.slice(-300))
    if (g === 'G3') for (const must of ['i18n-check --keys', 'i18n-check --hardcoded', 'i18n-check --control', 'npm run typecheck', 'npm run build'])
      expect(`  dont « ${must} » vert`, r.out.includes(`  ✓ ${must}`))
    if (g === 'G3') expect('  dont npm test (smoke) vert', /✓ npm test \(scripts\/smoke\.ts\) : \d+ verts, 0 rouges/.test(r.out))
  }
  // Le nouveau script de tests : aussi dans les contrôles listés par le README.
  expect('README : le contrôle du chantier est listé (scripts/assistant-limites-check.ts)', readFileSync(join(ROOT, 'README.md'), 'utf8').includes('scripts/assistant-limites-check.ts'))
  finish('IA_LIMITES_G2_OK')
}

// ------------------------------------------------------------------ G3 / G4 : essais réels sur l'aperçu

const ENV_FILE = join(HOME, '.projectlead-ia-limites-apercu.env')
const readEnv = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))

/** L'aperçu est celui du commit courant : fichier d'aperçu ET API Vercel (meta.commit, cible non production). */
async function previewIsHead() {
  const head = git('rev-parse', 'HEAD')
  expect('copie de travail propre (l’aperçu est construit depuis le commit)', git('status', '--porcelain') === '')
  const env = existsSync(ENV_FILE) ? readEnv(ENV_FILE) : {}
  const url = env.PL_PREVIEW_URL ?? ''
  expect(`aperçu noté pour ce commit (${head.slice(0, 7)})`, env.PL_PREVIEW_COMMIT === head && /^https:\/\/projectlead-[a-z0-9]+-scanleads-projects\.vercel\.app$/.test(url), env.PL_PREVIEW_COMMIT?.slice(0, 7))
  let d = null
  try {
    const token = JSON.parse(readFileSync(join(HOME, '.local/share/com.vercel.cli/auth.json'), 'utf8')).token
    const res = await fetch(`https://api.vercel.com/v13/deployments/${new URL(url).host}?teamId=team_mRhlABdvm1jvEPoDzuDDgpon`, { headers: { Authorization: `Bearer ${token}` } })
    d = res.ok ? await res.json() : { status: res.status }
  } catch (e) { d = { error: String(e?.message ?? e).slice(0, 100) } }
  expect(`API Vercel : déploiement d’aperçu prêt, commit ${String(d?.meta?.commit ?? '').slice(0, 7)}, cible ${d?.target ?? 'preview'}`,
    d?.readyState === 'READY' && d.meta?.commit === head && d.target !== 'production' && d.projectId === 'prj_RZassmsoXK1Q7DuHZQAEsOh06kif', { readyState: d?.readyState, target: d?.target, status: d?.status, error: d?.error })
}
function e2e(scenario, token, min) {
  const r = run('node', [E2E, '--scenario', scenario], {}, 1_500_000)
  process.stdout.write(r.out.split('\n').filter((l) => /^\s*[✓✗]|^Aperçu|^\s+«|^\s+(lecture|carte|vrai tour|payante)/.test(l)).map((l) => `${l}\n`).join(''))
  const v = bilan(r.out)
  expect(`essai réel : ${v ? `${v[1]} verts, ${v[2]} rouges` : 'pas de bilan'} (au moins ${min} contrôles)`, r.code === 0 && v && v[2] === '0' && Number(v[1]) >= min, lastLine(r.out) || r.err.slice(-300))
  expect('dernière ligne de l’essai', lastLine(r.out) === token, lastLine(r.out))
  return r.out
}
/** Chaque assertion de l'aperçu citée dans le tableau de la doc pour cette porte a été vue « ✓ » pendant cet essai. */
function citedSeen(out, g) {
  const cited = (parseTable(readFileSync(join(ROOT, DOC), 'utf8')) ?? []).flatMap((r) => r.real).filter((x) => x.gate === g).map((x) => x.title)
  const unseen = cited.filter((t) => !out.includes(`  ✓ ${t}`))
  expect(`les ${cited.length} assertions ${g} citées dans la doc vues « ✓ » pendant cet essai`, cited.length >= 3 && !unseen.length, unseen.join(' / '))
}
function freshShots(started, names) {
  const dir = join(CHANTIER, 'captures/projectlead')
  const stale = names.filter((n) => { const p = join(dir, `${n}.png`); return !existsSync(p) || statSync(p).size <= 10_000 || statSync(p).mtimeMs < started })
  expect(`captures écrites pendant cette porte dans ${dir.replace(HOME, '~')} (${names.length})`, !stale.length, stale.join(', '))
}

async function g3() {
  console.log('G3 — aperçu Vercel, vrai modèle, compte TEST : périmètre')
  const started = Date.now()
  await previewIsHead()
  const out = e2e('perimetre', 'E2E_IA_LIMITES_G3_OK', 22)
  for (const slug of ['poeme', 'capitale', 'python', 'blague']) {
    for (const t of ['refus court qui renvoie à ProjectLead, sans la réponse demandée', 'aucun outil appelé (journal), aucune carte, aucune page ouverte', 'sortie < 600 jetons (journal)'])
      expect(`vu vert : hors périmètre (${slug}) : ${t}`, out.includes(`  ✓ hors périmètre (${slug}) : ${t}`))
  }
  for (const must of [/✓ contrôle du refus : les 4 refus réels du 29\.10 passent ; une blague, un poème, un script ou la réponse qui citent ProjectLead sont vus/,
    /✓ base d’aperçu remise : le projet « TEST Périmètre … » de l’essai et ses tâches retirés/])
    expect(`vu vert : ${must.source.replace(/\\/g, '').slice(2, 110)}`, must.test(out))
  citedSeen(out, 'G3')
  freshShots(started, ['perimetre-1-poeme', 'perimetre-2-capitale', 'perimetre-3-python', 'perimetre-4-blague', 'perimetre-5-lecture', 'perimetre-6-carte'])
  finish('IA_LIMITES_G3_OK')
}
async function g4() {
  console.log('G4 — aperçu Vercel : limite de la formule gratuite (TEST gratuite et TEST payante)')
  const started = Date.now()
  await previewIsHead()
  const out = e2e('limite', 'E2E_IA_LIMITES_G4_OK', 16)
  for (const must of [/✓ gratuite : la bulle dit « Formule gratuite : il vous reste (environ \d+ demandes?|moins d’une demande) ce mois-ci\. »/,
    /✓ gratuite : budget atteint → « …Il revient le 1er \S+\. »/, /✓ gratuite, par l’API : 402 free_limit immédiat/, /✓ base d’aperçu remise comme avant/,
    /✓ gratuite : la demande refusée n’est pas partie : elle sort du fil et revient dans le champ/,
    /✓ gratuite, personne non administratrice : « Un administrateur peut changer la formule/, /✓ base d’aperçu : la personne TEST gratuite est de nouveau administratrice/])
    expect(`vu vert : ${must.source.replace(/\\/g, '').slice(2, 90)}`, must.test(out))
  citedSeen(out, 'G4')
  freshShots(started, ['limite-1-compteur', 'limite-2-atteinte', 'limite-3-payante', 'limite-4-formules', 'limite-5-membre'])
  finish('IA_LIMITES_G4_OK')
}

const GATES = { G1: g1, G2: g2, G3: g3, G4: g4 }
if (!GATES[gate]) { console.log('usage : node scripts/ia-limites-gates.mjs G1|G2|G3|G4'); process.exit(2) }
try { await GATES[gate]() } catch (e) { console.log(`  ✗ ${gate} interrompue : ${String(e?.message ?? e).slice(0, 300)}`); process.exit(1) }
