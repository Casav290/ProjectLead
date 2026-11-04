/**
 * Build Vercel (Build Output API v3), comme CRMlead et InvoiceLead sur Vercel + Neon :
 * 1. migrations, en production seulement (une prévisualisation ne migre que si ALLOW_PREVIEW_MIGRATIONS=1),
 *    avec MIGRATE_DATABASE_URL (propriétaire de la base, connexion directe) ;
 * 2. le contrôle des types et l'interface (vite build) → fichiers statiques ;
 * 3. le serveur Hono (server/vercel.ts), empaqueté par esbuild en une seule fonction Node ;
 * 4. les routes : API, Compte Lead, carte de visite et fichiers d'association des liens d'app (/.well-known) → fonction ;
 *    /lead-auth/return → sa page (lead-auth-return.html, en-têtes posés ici) ; /lead-auth/google (page relais) : en-têtes
 *    no-store et no-referrer ; un fichier de dist/ s'il existe ; sinon l'application.
 *
 * Les crons sont déclarés dans vercel.json seulement (24, un par heure : formule gratuite de Vercel, un passage par
 * jour et par cron). Vercel les ajoute lui-même à cette sortie : les répéter dans config.json fait échouer le
 * déploiement (duplicated_cron_job, constaté le 13.10.2026).
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import { render as renderSite } from '../site/build.mjs'
import { staticRoutes } from '../site/pages.mjs'

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
// Le site public (accueils et pages mots-clés en HTML, robots.txt, sitemap.xml, llms.txt, 404) : site/build.mjs.
await renderSite('dist')

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

// Les robots (et aperçus de liens) lisent la page publique, jamais l'essai chez ERPlead (même liste que CRMlead).
const BOTS = '([Bb]ot|[Cc]rawler|[Ss]pider|[Ss]lurp|facebookexternalhit|[Ee]mbedly|WhatsApp|SkypeUriPreview|Lighthouse)'
// Les premiers segments servis par l'application (src/App.tsx) : tout autre chemin inconnu répond 404.
const APP_ROUTES = 'login|signup|taches|projets|modeles|emails|agenda|temps|charge|rapports|clients|facturation|reglages|recherche|suivi|rdv|demande|invitation|confidentialite|conditions|formules|lead-auth|index\\.html'

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    // Les fichiers de Vite portent leur empreinte dans le nom : gardés un an.
    { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(api|auth|\\.well-known)(/.*)?$', dest: '/api' },
    // Le lien de retour de « Continuer avec Google » (réservé à l'app : Universal Link, App Link vérifié ; contrat d'ERPlead
    // docs/GOOGLE-APP.md § 3c) : quand l'app ne s'ouvre pas, sa page de repli, servie telle quelle (200, aucune redirection),
    // jamais gardée en cache, sans Referer, hors des moteurs de recherche.
    { src: '^/lead-auth(/return|-return\\.html)$', dest: '/lead-auth-return.html',
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' } },
    // La page relais de « Continuer avec Google » (contrat d'ERPlead § 3a) : l'application (index.html, aucun script tiers),
    // mais son adresse porte le départ à usage unique d'ERPlead et la demande d'autorisation : jamais en cache, sans Referer.
    { src: '^/lead-auth/google$', headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, continue: true },
    // Site public (référencement, 04.11.2026). Ses fichiers ne se servent jamais par leur chemin de fichier.
    { src: '^/_site(/.*)?$', dest: '/_site/404.html', status: 404 },
    { src: '^/site-assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/media/(.*)$', headers: { 'Cache-Control': 'public, max-age=604800' }, continue: true },
    // « / » : l'application pour une session ProjectLead ou l'app mobile (agent ProjectLeadApp) ; la page d'accueil
    // publique pour un robot, un retour d'essai silencieux (lead_probe) ou un navigateur sans en-têtes de navigation.
    // Une vraie navigation sans session essaie d'abord, une fois et sans écran, la session ERPlead (prompt=none) :
    // connue, la personne entre dans son espace comme avant ; inconnue, retour sur /?lead_probe=1 (page publique).
    { src: '^/$', has: [{ type: 'cookie', key: 'projectlead_session' }], dest: '/index.html', headers: { 'Cache-Control': 'no-store' } },
    { src: '^/$', has: [{ type: 'header', key: 'user-agent', value: '.*ProjectLeadApp.*' }], dest: '/index.html', headers: { 'Cache-Control': 'no-store' } },
    { src: '^/$', has: [{ type: 'header', key: 'user-agent', value: `.*${BOTS}.*` }], dest: '/_site/fr.html' },
    { src: '^/$', has: [{ type: 'cookie', key: 'lead_probe' }], dest: '/_site/fr.html', headers: { 'Cache-Control': 'no-store' } },
    { src: '^/$', has: [{ type: 'query', key: 'lead_probe' }], dest: '/_site/fr.html', headers: { 'Cache-Control': 'no-store' } },
    { src: '^/$', methods: ['GET'], has: [{ type: 'header', key: 'sec-fetch-mode', value: 'navigate' }, { type: 'header', key: 'sec-fetch-dest', value: 'document' }],
      missing: [{ type: 'header', key: 'sec-purpose' }, { type: 'header', key: 'purpose' }],
      status: 302, headers: { Location: '/auth/lead/start?prompt=none&probe=1', 'Cache-Control': 'no-store' } },
    { src: '^/$', dest: '/_site/fr.html', headers: { 'Cache-Control': 'no-store' } },
    // Une adresse, une seule forme : /fr → /, /en/ → /en, /fr/page/ → /fr/page.
    { src: '^/fr/?$', status: 301, headers: { Location: '/' } },
    { src: '^/((?:en|de)(?:/[a-z0-9-]+)?|fr/[a-z0-9-]+)/$', status: 301, headers: { Location: '/$1' } },
    ...staticRoutes().filter(([p]) => p !== '/').map(([p, f]) => ({ src: `^${p}$`, dest: `/_site/${f}` })),
    { handle: 'filesystem' },
    // Les routes du navigateur (/projets/…, /suivi/…) : l'application.
    { src: `^/(${APP_ROUTES})(/.*)?$`, dest: '/index.html' },
    // Tout le reste : une vraie 404.
    { src: '^/(.*)$', dest: '/_site/404.html', status: 404, headers: { 'Cache-Control': 'no-store' } },
  ],
}, null, 2))

console.log('[build] .vercel/output prêt')
