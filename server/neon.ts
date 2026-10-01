/**
 * Point d'entrée Neon Functions : la même application, servie depuis la branche Neon de la base.
 * L'interface (dist/) et les migrations (db/) sont embarquées dans le paquet par
 * scripts/neon-build.mjs ; la base est migrée au démarrage de chaque instance.
 */
import assets from 'virtual:assets'
import migrations from 'virtual:migrations'

process.env.NO_LISTEN = '1'
process.env.NODE_ENV ||= 'production'

const { migrate } = await import('./migrate.js')
await migrate(console.log, migrations)
const { default: app } = await import('./index.js')

const SERVER = /^\/(api|auth|\.well-known)(\/|$)/

function asset(path: string) {
  const a = assets[path]
  if (!a) return null
  return new Response(Buffer.from(a.body, 'base64'), { headers: {
    'Content-Type': a.type,
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  } })
}

export default {
  fetch(request: Request, env?: unknown, ctx?: unknown) {
    const { pathname } = new URL(request.url)
    if (SERVER.test(pathname) || request.method !== 'GET') return app.fetch(request, env as any, ctx as any)
    // Fichier de l'interface, sinon l'application (routes du navigateur : /projets/…, /suivi/…).
    return asset(pathname) ?? asset('/index.html')!
  },
}
