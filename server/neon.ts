/**
 * Point d'entrée Neon Functions : la même application, servie depuis la branche Neon de la base.
 * L'interface (dist/) et les migrations (db/) sont embarquées dans le paquet par
 * scripts/neon-build.mjs ; la base est migrée au démarrage de chaque instance.
 * Les images et le film de la page d'accueil (media/) n'y sont PAS : seul leur manifeste l'est (commit GitHub
 * fixé et empreintes), et chaque fichier est téléchargé à la première demande puis gardé en mémoire.
 */
import assets from 'virtual:assets'
import mediaManifest from 'virtual:media'
import migrations from 'virtual:migrations'

process.env.NO_LISTEN = '1'
// L'adresse injectée par Neon Functions ne porte pas de mot de passe : la nôtre passe avant.
if (process.env.PL_DATABASE_URL) process.env.DATABASE_URL = process.env.PL_DATABASE_URL
process.env.NODE_ENV ||= 'production'

const { migrate } = await import('./migrate.js')
await migrate(console.log, migrations)
const { default: app } = await import('./index.js')
const { hydrateServerSecrets } = await import('./lib/secrets.js')
const { hasSession, PAGE_HEADERS } = await import('./lib/landing.js')
const { mediaResponse, remoteMedia } = await import('./lib/media.js')
await hydrateServerSecrets()

const SERVER = /^\/(api|auth|\.well-known)(\/|$)/
const media = remoteMedia(mediaManifest)

function asset(path: string) {
  const a = assets[path]
  if (!a) return null
  return new Response(Buffer.from(a.body, 'base64'), { headers: {
    'Content-Type': a.type,
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  } })
}

/** « / » : la page d'accueil pour un visiteur, l'application pour une session valide. */
async function home(request: Request) {
  const page = assets['/accueil.html'] && !(await hasSession(request.headers.get('cookie'))) ? '/accueil.html' : '/index.html'
  return new Response(request.method === 'HEAD' ? null : Buffer.from(assets[page].body, 'base64'), { headers: PAGE_HEADERS })
}

async function mediaFile(request: Request, pathname: string) {
  try {
    const file = await media(pathname)
    return file ? mediaResponse(request, file) : new Response('Introuvable', { status: 404 })
  } catch (e) {
    console.error('[media]', (e as Error).message)
    return new Response('Indisponible', { status: 502, headers: { 'Retry-After': '5' } })
  }
}

export default {
  async fetch(request: Request, env?: unknown, ctx?: unknown) {
    const { pathname } = new URL(request.url)
    const read = request.method === 'GET' || request.method === 'HEAD'
    if (read && pathname.startsWith('/media/')) return mediaFile(request, pathname)
    if (read && pathname === '/') return home(request)
    if (SERVER.test(pathname) || request.method !== 'GET') return app.fetch(request, env as any, ctx as any)
    // Fichier de l'interface, sinon l'application (routes du navigateur : /projets/…, /suivi/…).
    return asset(pathname) ?? asset('/index.html')!
  },
}
