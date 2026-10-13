import { getRequestListener } from '@hono/node-server'

/**
 * La fonction Vercel (scripts/vercel-build.mjs) : la même application Hono que `server/index.ts`, en écouteur
 * Node, comme CRMlead et InvoiceLead. Les fichiers de dist/ sont servis par Vercel lui-même.
 *
 * Pas de minuteur ici : une fonction dort entre deux requêtes. Les tâches de fond (server/lib/jobs.ts) passent
 * - à chaque requête reçue, au plus une fois par minute et par instance, chaque tâche à son rythme (`job_runs`) :
 *   `waitUntil` laisse la fonction finir le passage (server/index.ts) ;
 * - par le Cron de Vercel (`/api/tasks/run`, `CRON_SECRET`) : formule gratuite, chaque cron une fois par jour,
 *   d'où 24 crons, un par heure (vercel.json).
 */
process.env.NODE_ENV ??= 'production'

// Sans PUBLIC_URL, l'adresse de production que Vercel donne au projet (liens de suivi, invitations, iCal).
if (!process.env.PUBLIC_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL)
  process.env.PUBLIC_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`

const { default: app } = await import('./index.js')
// Les secrets du serveur gardés en base (clé IA…), comme au démarrage d'une instance Neon. Une vraie variable
// d'environnement l'emporte toujours ; un chiffré illisible est ignoré.
const { hydrateServerSecrets } = await import('./lib/secrets.js')
await hydrateServerSecrets().catch((e) => console.error('[secrets]', e?.message ?? e))

export default getRequestListener(app.fetch)
