/**
 * Paquet Neon Functions : un seul fichier `deploy/neon/index.mjs` (serveur, interface et migrations).
 * Il est publié sur GitHub ; la fonction Neon est un petit amorçage (`deploy/neon/boot.mjs`) qui le
 * télécharge à un commit fixé et le charge.
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, mkdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { build } from 'esbuild'

execSync('npx vite build', { stdio: 'inherit' })

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }
const walk = (d) => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])
const assets = Object.fromEntries(walk('dist').map((f) => ['/' + relative('dist', f).replace(/\\/g, '/'),
  { type: TYPES[extname(f)] ?? 'application/octet-stream', body: readFileSync(f).toString('base64') }]))
const migrations = readdirSync('db').filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
  .map((name) => ({ name, sql: readFileSync(join('db', name), 'utf8') }))

mkdirSync('deploy/neon', { recursive: true })
await build({
  entryPoints: ['server/neon.ts'],
  outfile: 'deploy/neon/index.mjs',
  bundle: true, minify: true, platform: 'node', target: 'node22', format: 'esm',
  external: ['pg-native'],
  banner: { js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __fu } from 'url'; import { dirname as __dn } from 'path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
  plugins: [{
    name: 'virtual',
    setup(b) {
      b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virtual' }))
      b.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => ({
        contents: `export default ${JSON.stringify(a.path === 'virtual:assets' ? assets : migrations)}`, loader: 'js' }))
    },
  }],
  logLevel: 'info',
})
