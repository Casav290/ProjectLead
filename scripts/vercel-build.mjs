/**
 * Build Vercel (Build Output API v3), comme CRMlead et InvoiceLead sur Vercel + Neon :
 * 1. migrations, en production seulement (une prévisualisation ne migre que si ALLOW_PREVIEW_MIGRATIONS=1),
 *    avec MIGRATE_DATABASE_URL (propriétaire de la base, connexion directe) ;
 * 2. le contrôle des types et l'interface (vite build) → fichiers statiques ;
 * 3. le serveur Hono (server/vercel.ts), empaqueté par esbuild en une seule fonction Node ;
 * 4. les routes : API, Compte Lead, carte de visite → fonction ; un fichier de dist/ s'il existe ; sinon l'application.
 *
 * Les crons sont déclarés dans vercel.json (24, un par heure : formule gratuite de Vercel, un passage par jour
 * et par cron) ; ce script les reprend dans config.json, que Vercel lit pour une sortie Build Output API.
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const run = (cmd, env) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } })
const out = '.vercel/output'
const fn = `${out}/functions/api.func`

if (process.env.VERCEL_ENV === 'production' || process.env.ALLOW_PREVIEW_MIGRATIONS === '1') {
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('[build] MIGRATE_DATABASE_URL manquant : migrations impossibles')
  run('npx tsx server/migrate.ts', { DATABASE_URL: url })
} else {
  console.log('[build] prévisualisation : pas de migration')
}

run('npx tsc --noEmit -p tsconfig.json')
run('npx vite build')

rmSync(out, { recursive: true, force: true })
mkdirSync(fn, { recursive: true })
cpSync('dist', `${out}/static`, { recursive: true })

await build({
  entryPoints: ['server/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg-native'],
  // Les paquets CommonJS empaquetés en ESM ont besoin de `require`, `__filename` et `__dirname`.
  banner: { js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __fu } from 'url'; import { dirname as __dn } from 'path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
  logLevel: 'info',
})

writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 300,
}, null, 2))

const { crons = [] } = JSON.parse(readFileSync('vercel.json', 'utf8'))

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  crons,
  routes: [
    // Les fichiers de Vite portent leur empreinte dans le nom : gardés un an.
    { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(api|auth|\\.well-known)(/.*)?$', dest: '/api' },
    { handle: 'filesystem' },
    // Les routes du navigateur (/projets/…, /suivi/…) : l'application.
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2))

console.log(`[build] .vercel/output prêt (${crons.length} crons)`)
