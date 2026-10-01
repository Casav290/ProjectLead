/**
 * Build Vercel (Build Output API v3), comme InvoiceLead sur Vercel + Neon :
 * 1. migrations, en production seulement (une prévisualisation ne migre que si ALLOW_PREVIEW_MIGRATIONS=1) ;
 * 2. l'interface (vite build) → fichiers statiques ;
 * 3. le serveur Hono, empaqueté par esbuild en une seule fonction Node ;
 * 4. les routes (API, Compte Lead, carte de visite → fonction ; le reste → l'application) et la tâche quotidienne.
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const out = '.vercel/output'

if (process.env.VERCEL_ENV === 'production' || process.env.ALLOW_PREVIEW_MIGRATIONS === '1') {
  run('npx tsx server/migrate.ts')
} else {
  console.log('[build] prévisualisation : pas de migration')
}

run('npx tsc --noEmit -p tsconfig.json')
run('npx vite build')

rmSync(out, { recursive: true, force: true })
mkdirSync(`${out}/functions/api.func`, { recursive: true })
cpSync('dist', `${out}/static`, { recursive: true })

await build({
  entryPoints: ['server/vercel.ts'],
  outfile: `${out}/functions/api.func/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg-native'],
  // Les paquets CommonJS empaquetés en ESM ont besoin de `require`, `__filename` et `__dirname`.
  banner: { js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __fu } from 'url'; import { dirname as __dn } from 'path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
  logLevel: 'info',
})

writeFileSync(`${out}/functions/api.func/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60,
}, null, 2))

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/(api|auth|\\.well-known)(/.*)?$', dest: '/api' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
  crons: [{ path: '/api/tasks/run', schedule: '7 5 * * *' }],
}, null, 2))

console.log('[build] .vercel/output prêt')
