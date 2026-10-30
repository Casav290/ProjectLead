import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3002', changeOrigin: true },
      '/auth': { target: 'http://localhost:3002', changeOrigin: true },
      '/.well-known': { target: 'http://localhost:3002', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // Deux pages : l'application, et la page de retour de « Continuer avec Google » (https://projectlead.io/lead-auth/return,
    // src/leadAuthReturn.ts), petite, sans l'application ni ressource tierce. Servie par scripts/vercel-build.mjs.
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), leadAuthReturn: path.resolve(__dirname, 'lead-auth-return.html') } },
  },
})
