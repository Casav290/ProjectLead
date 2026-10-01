import { getRequestListener } from '@hono/node-server'

// Sans PUBLIC_URL, l'adresse de production que Vercel donne au projet (liens de suivi, invitations, iCal).
if (!process.env.PUBLIC_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL)
  process.env.PUBLIC_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`

const { default: app } = await import('./index.js')

/** Point d'entrée de la fonction Vercel : la même application Hono, en écouteur Node. */
export default getRequestListener(app.fetch)
