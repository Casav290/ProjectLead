#!/usr/bin/env node
/**
 * Déploiement d'APERÇU Vercel de ProjectLead depuis le commit courant (jamais la production), comme le 24.10.2026 :
 * copie sans `.git` (`git archive HEAD` : un déploiement CLI depuis le dépôt est refusé par Vercel à cause de l'auteur
 * du commit), variables passées au déploiement seulement (`--env`), lues dans un fichier hors dépôt (600) :
 *
 *   ~/.projectlead-actions-apercu.env : PL_PREVIEW_DB (branche Neon de l'aperçu, rôle propre à la branche),
 *                                       PL_PREVIEW_DB_HOST (garde), PL_PREVIEW_APP_SECRET
 *
 * Tâches de fond coupées (JOBS_DISABLED=1 : rien ne part vers un client depuis la copie de la base). Le verrou
 * ~/projets/.unlazy/audit-suite-20261021/projectlead-deploy.lock est pris pendant le déploiement. L'adresse obtenue est
 * écrite dans le même fichier (PL_PREVIEW_URL) et le commit dans les métadonnées du déploiement (meta.commit).
 *
 *   node scripts/apercu-vercel.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = join(homedir(), '.projectlead-actions-apercu.env')
const LOCK = join(homedir(), 'projets/.unlazy/audit-suite-20261021/projectlead-deploy.lock')
const TEAM = 'team_mRhlABdvm1jvEPoDzuDDgpon', PROJECT = 'prj_RZassmsoXK1Q7DuHZQAEsOh06kif'

const env = Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
for (const k of ['PL_PREVIEW_DB', 'PL_PREVIEW_DB_HOST', 'PL_PREVIEW_APP_SECRET']) if (!env[k]) throw new Error(`${k} manquant dans ${ENV_FILE}`)
if (!env.PL_PREVIEW_DB.includes(env.PL_PREVIEW_DB_HOST)) throw new Error('refus : la base n’est pas celle de l’aperçu')
if (/ep-billowing-moon/.test(env.PL_PREVIEW_DB)) throw new Error('refus : adresse de la base de PRODUCTION')

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
if (git('status', '--porcelain')) throw new Error('copie de travail modifiée : enregistrer (commit) avant de déployer')
const commit = git('rev-parse', 'HEAD'), branch = git('rev-parse', '--abbrev-ref', 'HEAD')

// Le verrou des déploiements de ProjectLead (création exclusive).
mkdirSync(dirname(LOCK), { recursive: true })
let fd
try { fd = openSync(LOCK, 'wx') } catch { throw new Error(`verrou pris : ${LOCK} (${readFileSync(LOCK, 'utf8').trim()})`) }
writeFileSync(fd, `aperçu assistant-actions ${commit.slice(0, 7)} ${new Date().toISOString()} pid ${process.pid}\n`)
closeSync(fd)

const dir = mkdtempSync(join(tmpdir(), 'pl-apercu-'))
try {
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive HEAD | tar -x -C "${dir}"`])
  mkdirSync(join(dir, '.vercel'))
  writeFileSync(join(dir, '.vercel/project.json'), JSON.stringify({ orgId: TEAM, projectId: PROJECT }))
  const args = ['--yes', 'vercel@65.2.0', 'deploy', '--yes', '--environment', 'preview', '--scope', 'scanleads-projects',
    '--env', `DATABASE_URL=${env.PL_PREVIEW_DB}`, '--env', `APP_SECRET=${env.PL_PREVIEW_APP_SECRET}`, '--env', 'JOBS_DISABLED=1',
    '--meta', `commit=${commit}`, '--meta', `branch=${branch}`]
  const r = spawnSync('npx', args, { cwd: dir, encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024 })
  // La sortie de la CLI ne contient pas les valeurs passées ; on n'en garde que l'adresse.
  const url = `${r.stdout}\n${r.stderr}`.match(/https:\/\/projectlead-[a-z0-9]+-scanleads-projects\.vercel\.app/)?.[0]
  if (r.status !== 0 || !url) throw new Error(`déploiement en échec (code ${r.status}) : ${`${r.stderr}`.split('\n').filter((l) => /error|Error/.test(l)).slice(0, 3).join(' / ')}`)
  const kept = readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => l && !l.startsWith('PL_PREVIEW_URL=') && !l.startsWith('PL_PREVIEW_COMMIT='))
  writeFileSync(ENV_FILE, `${[...kept, `PL_PREVIEW_URL=${url}`, `PL_PREVIEW_COMMIT=${commit}`].join('\n')}\n`, { mode: 0o600 })
  console.log(`aperçu ${url} (commit ${commit.slice(0, 7)}, branche ${branch})`)
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(LOCK, { force: true })
}
