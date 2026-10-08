/**
 * Paquet Neon Functions : un seul fichier `deploy/neon/index.mjs` (serveur, interface et migrations).
 * Il est publié sur GitHub ; la fonction Neon est un petit amorçage (`deploy/neon/boot.mjs`) qui le
 * télécharge à un commit fixé et le charge.
 *
 * Les images et le film de la page d'accueil (`media/`) restent HORS du paquet : seul leur manifeste y entre
 * (dernier commit qui a touché `media/`, déjà poussé sur GitHub, et empreinte SHA-256 de chaque fichier).
 * L'application les télécharge à la première demande depuis ce commit (server/lib/media.ts).
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { build } from 'esbuild'

const REPO = 'Casav290/ProjectLead'
const MEDIA_TYPES = { '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8' }
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
function mediaManifest() {
  if (!existsSync('media')) return { base: '', files: {} }
  if (sh('git status --porcelain -- media')) throw new Error('media/ a des changements non commités : commit et push d\'abord.')
  const commit = sh('git log -1 --format=%H -- media')
  if (!commit) throw new Error('media/ n\'est dans aucun commit.')
  // Le commit doit être sur GitHub : l'application y lira les fichiers.
  if (!sh(`git branch -r --contains ${commit}`)) throw new Error(`le commit ${commit} (media/) n'est pas encore poussé sur GitHub.`)
  const walkMedia = (d) => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walkMedia(join(d, f)) : [join(d, f)])
  const files = Object.fromEntries(walkMedia('media').filter((f) => MEDIA_TYPES[extname(f).toLowerCase()]).map((f) => {
    const body = readFileSync(f)
    return ['/' + relative('.', f).replace(/\\/g, '/'), { sha256: createHash('sha256').update(body).digest('hex'), size: body.length, type: MEDIA_TYPES[extname(f).toLowerCase()] }]
  }))
  console.log(`médias : ${Object.keys(files).length} fichiers au commit ${commit.slice(0, 7)}`)
  return { base: `https://raw.githubusercontent.com/${REPO}/${commit}/media/`, files }
}
const media = mediaManifest()

execSync('npx vite build', { stdio: 'inherit' })

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', ...MEDIA_TYPES }
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
        contents: `export default ${JSON.stringify(a.path === 'virtual:assets' ? assets : a.path === 'virtual:media' ? media : migrations)}`, loader: 'js' }))
    },
  }],
  logLevel: 'info',
})
