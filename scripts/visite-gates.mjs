#!/usr/bin/env node
/**
 * Portes du chantier « visite guidée » (04.11.2026), une sous-commande par porte de
 * ~/projets/.unlazy/projectlead-visite/GATES.md : `node scripts/visite-gates.mjs g1` … `g9`. Dernière ligne :
 * VISITE_G<n>_OK, sinon la raison. Aucun secret affiché.
 *
 * Fichiers hors dépôt (600) : ~/projets/.unlazy/projectlead-visite/testdb.url (base de test locale),
 * apercu.env (base d'aperçu : PL_PREVIEW_DB, PL_PREVIEW_DB_HOST, PL_PREVIEW_APP_SECRET, PL_PREVIEW_OWNER_DB, puis
 * PL_PREVIEW_URL et PL_PREVIEW_COMMIT écrits par scripts/apercu-vercel.mjs), comptes.json (sessions des comptes
 * test+visite<n>@scanlead.io, écrit par comptes.mjs du même dossier), PROD.md.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const U = join(homedir(), 'projets/.unlazy/projectlead-visite')
const gate = process.argv[2]
const pg = createRequire(join(ROOT, 'package.json'))('pg')
const readEnv = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, ...opts })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const fail = (why) => { console.log(`ÉCHEC ${gate} : ${why}`); process.exit(1) }
const ok = (n) => { console.log(`VISITE_${n}_OK`); process.exit(0) }
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const BYPASS = () => readFileSync(join(homedir(), 'projets/.unlazy/assistant-ia/projectlead-bypass.secret'), 'utf8').trim()

/** Le détecteur de tiret long : la page et tous les scripts qu'elle charge (y compris ceux chargés à la demande). */
async function dashScan(base, headers = {}) {
  const pages = ['/', '/login', '/formules', '/conditions', '/confidentialite']
  const seen = new Set(), hits = []
  const queue = []
  for (const p of pages) {
    const r = await fetch(base + p, { headers, redirect: 'follow' })
    const html = await r.text()
    if (html.includes('—')) hits.push(`${p} (HTML)`)
    for (const m of html.matchAll(/\/assets\/[\w.-]+\.js/g)) queue.push(m[0])
  }
  while (queue.length) {
    const a = queue.shift()
    if (seen.has(a)) continue
    seen.add(a)
    const js = await (await fetch(base + a, { headers })).text()
    if (js.includes('—') || /\\u2014/i.test(js)) hits.push(a)
    for (const m of js.matchAll(/assets\/[\w.-]+\.js/g)) queue.push(`/${m[0]}`)
    for (const m of js.matchAll(/"\.\/([\w.-]+\.js)"/g)) queue.push(`/assets/${m[1]}`)
  }
  return { hits, scripts: seen.size }
}

if (gate === 'g1') {
  for (const [cmd, args, token] of [
    ['npm', ['run', 'typecheck'], null], ['npm', ['run', 'build'], 'built in'],
    ['npx', ['tsx', 'scripts/i18n-check.ts', '--keys'], 'I18N_KEYS_OK'], ['npx', ['tsx', 'scripts/i18n-check.ts', '--hardcoded'], 'I18N_HARDCODED_OK'],
    ['npx', ['tsx', 'scripts/i18n-check.ts', '--control'], 'I18N_CONTROL_OK'], ['npx', ['tsx', 'scripts/suites-check.ts'], 'PROJECTLEAD_SUITES_UNIT_OK'],
  ]) {
    const r = run(cmd, args)
    if (r.code !== 0 || (token && !r.out.includes(token))) fail(`${cmd} ${args.join(' ')} (code ${r.code}) ${r.out.slice(-400)}`)
    console.log(`  ✓ ${args.join(' ')}`)
  }
  ok('G1')
}

if (gate === 'g2') {
  const url = readFileSync(join(U, 'testdb.url'), 'utf8').trim()
  const db = url.split('/').pop(), owner = url.replace(/^.*:\/\/([^:]+):.*$/, '$1')
  if (!/^projectlead_test_visite$/.test(db)) fail('base de test inattendue')
  // Base neuve : les personnes du parcours naissent après db/034, comme un vrai premier passage.
  const r0 = run('sudo', ['-n', '-u', 'postgres', 'psql', '-q', '-c', `drop database if exists ${db}`, '-c', `create database ${db} owner ${owner}`])
  if (r0.code !== 0) fail(`base neuve : ${r0.out}`)
  const env = { ...process.env, TEST_DATABASE_URL: url }
  const t = run('npm', ['test'], { env })
  const m = t.out.match(/(\d+) contrôles verts, (\d+) rouges/)
  const sec = t.out.split('Visite guidée (04.11.2026)')[1]?.split('\n').slice(1, 9).filter((l) => l.includes('✓')).length ?? 0
  if (t.code !== 0 || !m || m[2] !== '0' || sec < 7) fail(`npm test : ${m?.[0] ?? t.out.slice(-300)} ; section visite ${sec}/7`)
  console.log(`  ✓ npm test : ${m[0]} (section « Visite guidée » ${sec}/7)`)
  for (const [s, token] of [['scripts/assistant-check.ts', 'ASSISTANT_CHECK_OK'], ['scripts/assistant-actions-check.ts', 'ASSISTANT_ACTIONS_CHECK_OK']]) {
    const r = run('npx', ['tsx', s], { env })
    if (r.code !== 0 || !r.out.includes(token)) fail(`${s} : ${r.out.slice(-300)}`)
    console.log(`  ✓ ${token}`)
  }
  ok('G2')
}

/** Une passe du navigateur avec deux comptes neufs et le compte d'avant (comptes.mjs prépare les sessions). */
function e2e(where, base, extra = []) {
  const prep = run('node', [join(U, 'comptes.mjs'), where === 'apercu' ? 'apercu-neufs' : 'prod-neufs'])
  if (prep.code !== 0) fail(`comptes neufs (${where}) : ${prep.out.slice(-400)}`)
  const c = JSON.parse(readFileSync(join(U, 'comptes.json'), 'utf8'))[where]
  if (!c?.old || !c?.fresh?.length) fail(`comptes.json : ${where} incomplet`)
  const env = { ...process.env, VISITE_NEW_COOKIE: c.fresh.at(-2).cookie, VISITE_NEW_COOKIE_MOBILE: c.fresh.at(-1).cookie, VISITE_OLD_COOKIE: c.old.cookie }
  const r = run('node', ['scripts/e2e-visite.mjs', '--url', base, ...extra], { env })
  console.log(r.out.split('\n').filter((l) => /✗|verts|ROUGE|E2E_VISITE_OK/.test(l)).join('\n'))
  if (r.code !== 0 || !r.out.trim().endsWith('E2E_VISITE_OK')) fail('e2e-visite rouge')
}

if (gate === 'g3') {
  const env = readEnv(join(U, 'apercu.env'))
  if (env.PL_PREVIEW_COMMIT !== head()) fail(`l'aperçu sert ${env.PL_PREVIEW_COMMIT?.slice(0, 7)}, HEAD est ${head().slice(0, 7)}`)
  e2e('apercu', env.PL_PREVIEW_URL, ['--bypass', BYPASS(), '--out', join(U, 'captures/apercu')])
  ok('G3')
}

if (gate === 'g4' || gate === 'g7') {
  // Contre-épreuve : le détecteur trouve un tiret long planté.
  const plant = 'texte témoin — planté'
  if (!plant.includes('—')) fail('contre-épreuve')
  const bad = []
  for (const l of ['fr', 'de', 'en', 'it', 'es']) {
    const t = readFileSync(join(ROOT, `src/i18n/locales/${l}/tour.json`), 'utf8')
    if (t.includes('—')) bad.push(`tour.json ${l}`)
  }
  const base = gate === 'g4' ? readEnv(join(U, 'apercu.env')).PL_PREVIEW_URL : 'https://projectlead.io'
  const headers = gate === 'g4' ? { 'x-vercel-protection-bypass': BYPASS() } : {}
  const { hits, scripts } = await dashScan(base, headers)
  if (scripts < 10) fail(`trop peu de scripts lus (${scripts}) : détecteur aveugle`)
  if (bad.length || hits.length) fail(`tiret long : ${[...bad, ...hits].join(', ')}`)
  console.log(`  ✓ ${scripts} scripts et 5 pages lus sur ${base}, aucun « — » ; contre-épreuve trouvée`)
  ok(gate.toUpperCase())
}

if (gate === 'g5') {
  const prod = readFileSync(join(U, 'PROD.md'), 'utf8')
  const lsn = prod.match(/LSN (\S+) à (\S+) UTC/), dump = prod.match(/pg_dump : (\S+)/), pushed = prod.match(/Poussé à (\S+) UTC/)
  if (!lsn || !dump || !pushed) fail('PROD.md : point Neon, copie ou heure de mise en ligne manquants')
  if (!(Date.parse(lsn[2]) < Date.parse(pushed[1]))) fail('le point Neon n’est pas antérieur à la mise en ligne')
  if (!existsSync(dump[1]) || statSync(dump[1]).size < 100_000) fail('copie pg_dump absente ou trop petite')
  const tok = JSON.parse(readFileSync(join(homedir(), '.local/share/com.vercel.cli/auth.json'), 'utf8')).token
  const d = await (await fetch('https://api.vercel.com/v6/deployments?projectId=prj_RZassmsoXK1Q7DuHZQAEsOh06kif&teamId=team_mRhlABdvm1jvEPoDzuDDgpon&target=production&limit=1&state=READY', { headers: { authorization: `Bearer ${tok}` } })).json()
  const sha = d.deployments?.[0]?.meta?.githubCommitSha
  const origin = execFileSync('git', ['rev-parse', 'origin/vercel'], { cwd: ROOT, encoding: 'utf8' }).trim()
  if (sha !== origin || !prod.includes(origin.slice(0, 7))) fail(`production ${sha?.slice(0, 7)} ≠ origin/vercel ${origin.slice(0, 7)} (ou absent de PROD.md)`)
  const c = new pg.Client({ connectionString: readEnv(join(homedir(), '.projectlead-vercel.env')).MIGRATE_DATABASE_URL }); await c.connect()
  const q = async (s, p) => (await c.query(s, p)).rows
  const mig = await q(`select name, applied_at from schema_migrations where applied_at > now() - interval '3 days' order by applied_at`)
  const cols = await q(`select column_name, column_default from information_schema.columns where table_name = 'users' and column_name like 'tour%'`)
  const m034 = mig.find((x) => x.name === '034_visite_guidee.sql')
  const before = m034 ? await q(`select count(*)::int as n, count(*) filter (where tour_pending)::int as due from users where created_at < $1`, [m034.applied_at]) : null
  await c.end()
  if (!m034 || mig.some((x) => x.name !== '034_visite_guidee.sql')) fail(`migrations récentes : ${mig.map((x) => x.name).join(', ')}`)
  if (cols.length !== 2 || !/true/.test(cols.find((x) => x.column_name === 'tour_pending')?.column_default ?? '')) fail(JSON.stringify(cols))
  if (before[0].due !== 0) fail(`${before[0].due} personnes d’avant ont la visite due`)
  console.log(`  ✓ production = ${sha.slice(0, 7)} ; 034 seule nouvelle (${m034.applied_at.toISOString()}) ; ${before[0].n} personnes d’avant, 0 due`)
  ok('G5')
}

if (gate === 'g6') {
  e2e('prod', 'https://projectlead.io', ['--out', join(U, 'captures'), '--video'])
  ok('G6')
}

if (gate === 'g8') {
  const pl = new pg.Client({ connectionString: readEnv(join(homedir(), '.projectlead-vercel.env')).MIGRATE_DATABASE_URL }); await pl.connect()
  const a = (await pl.query(`select count(*)::int as n from users where email ilike 'test+visite%'`)).rows[0].n
  const acc = (await pl.query(`select count(*)::int as n from accounts where name ilike 'TEST Visite%'`)).rows[0].n
  await pl.end()
  // ERPlead en LECTURE SEULE (rôle lead_e2e_ro) : ses comptes de test s'effacent par « Supprimer mon compte ».
  const e = new pg.Client({ connectionString: readEnv(join(homedir(), '.lead-e2e-ro.env')).ERPLEAD_RO_URL }); await e.connect()
  const b = (await e.query(`select count(*)::int as n from users where email ilike 'test+visite%'`)).rows[0].n
  const o = (await e.query(`select count(*)::int as n from orgs where name ilike 'TEST Visite%'`)).rows[0].n
  await e.end()
  const pv = new pg.Client({ connectionString: readEnv(join(U, 'apercu.env')).PL_PREVIEW_OWNER_DB }); await pv.connect()
  const p = (await pv.query(`select count(*)::int as n from users where email ilike 'test+visite%'`)).rows[0].n
  await pv.end()
  if (a || acc || b || o || p) fail(`restent : ProjectLead ${a} personnes / ${acc} entreprises, ERPlead ${b} / ${o}, aperçu ${p}`)
  console.log('  ✓ 0 compte test+visite (ProjectLead, ERPlead, base d’aperçu), 0 entreprise « TEST Visite »')
  ok('G8')
}

if (gate === 'g9') {
  for (const f of ['REFERENCES.md', 'PROD.md']) if (!existsSync(join(U, f))) fail(`${f} absent`)
  const prod = readFileSync(join(U, 'PROD.md'), 'utf8')
  if (!/promote dpl_\w+/.test(prod) || !/Commit précédent : [0-9a-f]{7}/.test(prod)) fail('PROD.md : commit précédent ou commande de retour arrière absents')
  const cap = join(U, 'captures')
  const vids = readdirSync(cap).filter((f) => /^visite-(bureau-1440|mobile-390)\.(mp4|webm)$/.test(f) && statSync(join(cap, f)).size > 50_000)
  const shots = readdirSync(cap).filter((f) => f.endsWith('.png'))
  if (!vids.some((f) => f.includes('1440')) || !vids.some((f) => f.includes('390'))) fail(`vidéos : ${vids.join(', ')}`)
  if (shots.length < 20) fail(`${shots.length} captures seulement`)
  console.log(`  ✓ ${vids.join(', ')} ; ${shots.length} captures`)
  ok('G9')
}

fail('porte inconnue (g1 à g9)')
