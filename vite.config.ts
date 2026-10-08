import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * En développement comme en production, « / » montre la page d'accueil (accueil.html) à qui n'a pas de session,
 * et l'application à qui en a une (le serveur vérifie la session, voir server/lib/landing.ts ; ici, la seule
 * présence du cookie suffit). Les images et le film de l'accueil (/media) viennent du serveur, hors paquet.
 */
function accueil(): Plugin {
  return {
    name: 'projectlead-accueil',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, query = ''] = (req.url ?? '').split('?')
        if (req.method === 'GET' && pathname === '/' && !/(?:^|;\s*)projectlead_session=/.test(req.headers.cookie ?? ''))
          req.url = '/accueil.html' + (query ? `?${query}` : '')
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), accueil()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3002', changeOrigin: true },
      '/auth': { target: 'http://localhost:3002', changeOrigin: true },
      '/media': { target: 'http://localhost:3002', changeOrigin: true },
      '/.well-known': { target: 'http://localhost:3002', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), accueil: path.resolve(__dirname, 'accueil.html') } },
  },
})
