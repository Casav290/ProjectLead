import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { waitUntil } from '@vercel/functions'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { hashToken, SESSION_COOKIE } from './auth.js'
import { anon } from './db.js'
import { HttpError, type Env } from './lib/http.js'
import { runJobsIfDue, runJobs } from './lib/jobs.js'
import { hydrateServerSecrets, SERVER_SECRETS, setServerSecret, type ServerSecret } from './lib/secrets.js'
import { mailboxSecretConfigured } from './lib/mailbox/secret.js'
import { hasSession, PAGE_HEADERS } from './lib/landing.js'
import { localMedia, mediaResponse } from './lib/media.js'
import authRoutes from './routes/auth.js'
import meRoutes from './routes/me.js'
import teamRoutes from './routes/team.js'
import clientRoutes from './routes/clients.js'
import projectRoutes from './routes/projects.js'
import taskRoutes from './routes/tasks.js'
import timeRoutes from './routes/time.js'
import calendarRoutes, { publicCalendar } from './routes/calendar.js'
import bookingRoutes, { publicBooking } from './routes/booking.js'
import mailRoutes, { publicMail } from './routes/mail.js'
import portalRoutes, { publicPortal } from './routes/portal.js'
import integrationRoutes from './routes/integrations.js'
import exchangeRoutes from './routes/exchange.js'
import workRoutes, { publicForms } from './routes/work.js'
import v1Routes from './routes/v1.js'

const app = new Hono<Env>()

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, ...err.extra }, err.status as any)
  if (err instanceof SyntaxError && /JSON/i.test(err.message)) return c.json({ error: 'invalid_json' }, 400)
  const e = err as any
  const msg = String(e?.message ?? err)
  // Les refus de la base disent une règle, pas une panne.
  if (e?.code === '42501') return c.json({ error: 'not_found' }, 404)               // hors RLS
  if (e?.code === '23503') return c.json({ error: 'unknown_reference' }, 400)
  if (e?.code === '23505') return c.json({ error: 'conflict' }, 409)
  if (e?.code === '23514') return c.json({ error: 'invalid_input', constraint: e?.constraint }, 400)
  if (e?.code === '22P02' && /uuid/i.test(msg)) return c.json({ error: 'not_found' }, 404)
  if (['22007', '22008', '22P02', '22003', '22001'].includes(e?.code)) return c.json({ error: 'invalid_input' }, 400)
  console.error('[api]', err)
  return c.json({ error: 'server_error' }, 500)
})

// Les tâches de fond profitent du trafic (relances, boîtes mail, facturation du mois…).
// Sur Vercel, `waitUntil` laisse la fonction finir le passage après la réponse.
app.use('*', async (c, next) => {
  const jobs = runJobsIfDue()
  if (jobs && process.env.VERCEL) waitUntil(jobs)
  await next()
})

// ------------------------------------------------------------------ routes ouvertes

app.route('/', authRoutes)
app.route('/', exchangeRoutes)
app.route('/api/public/portal', publicPortal)
app.route('/api/public/booking', publicBooking)
app.route('/api/public/forms', publicForms)
app.route('/api/public/calendar', publicCalendar)
app.route('/api/inbound', publicMail)
app.route('/api/v1', v1Routes)

app.get('/api/health', (c) => c.json({ ok: true }))

/**
 * Tâches planifiées appelables de l'extérieur : cron Vercel (GET, `CRON_SECRET`), autre (`TASKS_SECRET`),
 * ou jeton enregistré en base (`task_tokens`, empreinte seule : cron du VPS).
 */
/** Le jeton d'exploitation : variable TASKS_SECRET ou CRON_SECRET, ou jeton enregistré en base (empreinte seule). */
async function operator(c: any) {
  const auth = c.req.header('authorization') ?? ''
  if ([process.env.TASKS_SECRET, process.env.CRON_SECRET].some((s) => s && auth === `Bearer ${s}`)) return true
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (bearer.length < 32) return false
  return Boolean(await anon(async (db) => (await db.query(
    'update task_tokens set last_used_at = now() where token_hash = $1 returning 1', [hashToken(bearer)])).rowCount))
}

const runTasks = async (c: any) => {
  if (!(await operator(c))) return c.json({ error: 'unauthenticated' }, 401)
  // Chaque tâche garde son rythme (boîtes : 1 min, suivis : 15 min, facturation : 1 h…) ; `?force=1` lance tout.
  await hydrateServerSecrets()
  return c.json(await runJobs(c.req.query('force') === '1'))
}
app.post('/api/tasks/run', runTasks)
app.get('/api/tasks/run', runTasks)

/**
 * Poser ou retirer un secret du serveur (clé IA…) sans toucher aux variables de la fonction Neon :
 * chiffré en base, jamais relu par l'API. Réservé au jeton d'exploitation.
 */
app.put('/api/ops/secrets/:name', async (c) => {
  if (!(await operator(c))) return c.json({ error: 'unauthenticated' }, 401)
  const name = c.req.param('name') as ServerSecret
  if (!(SERVER_SECRETS as readonly string[]).includes(name)) return c.json({ error: 'unknown_secret' }, 404)
  if (!mailboxSecretConfigured()) return c.json({ error: 'app_secret_missing' }, 503)
  const b = await c.req.json().catch(() => null) as { value?: unknown } | null
  const value = typeof b?.value === 'string' ? b.value.trim() : ''
  if (value.length < 8 || value.length > 500) return c.json({ error: 'invalid_input' }, 400)
  await setServerSecret(name, value)
  return c.json({ ok: true, name })
})
app.delete('/api/ops/secrets/:name', async (c) => {
  if (!(await operator(c))) return c.json({ error: 'unauthenticated' }, 401)
  const name = c.req.param('name') as ServerSecret
  if (!(SERVER_SECRETS as readonly string[]).includes(name)) return c.json({ error: 'unknown_secret' }, 404)
  await setServerSecret(name, null)
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ session

app.use('/api/*', async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ error: 'unauthenticated' }, 401)
  const s = await anon(async (db) => (await db.query(
    `select s.user_id, s.account_id, au.role, u.name, u.email
       from sessions s join account_users au on au.user_id = s.user_id and au.account_id = s.account_id and au.active
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`, [hashToken(token)])).rows[0])
  if (!s) return c.json({ error: 'unauthenticated' }, 401)
  c.set('ctx', { accountId: s.account_id, userId: s.user_id, role: s.role })
  c.set('name', s.name)
  c.set('email', s.email)
  await next()
})

app.route('/api', meRoutes)
app.route('/api/team', teamRoutes)
app.route('/api/clients', clientRoutes)
app.route('/api/projects', projectRoutes)
app.route('/api/tasks', taskRoutes)
app.route('/api/time', timeRoutes)
app.route('/api/calendar', calendarRoutes)
app.route('/api/booking', bookingRoutes)
app.route('/api/mail', mailRoutes)
app.route('/api/portal', portalRoutes)
app.route('/api/integrations', integrationRoutes)
app.route('/api', workRoutes)

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

// ------------------------------------------------------------------ application web

// Images et film de la page d'accueil, hors du paquet (server/lib/media.ts). Sur Neon, server/neon.ts les sert.
const media = localMedia(join(import.meta.dirname, '..', 'media'))
app.on(['GET', 'HEAD'], '/media/*', (c) => {
  const file = media(c.req.path)
  return file ? mediaResponse(c.req.raw, file) : c.text('Introuvable', 404)
})

const dist = join(import.meta.dirname, '..', 'dist')
if (existsSync(dist)) {
  const index = readFileSync(join(dist, 'index.html'), 'utf8')
  // « / » : la page d'accueil pour un visiteur, l'application pour une session valide.
  const accueil = existsSync(join(dist, 'accueil.html')) ? readFileSync(join(dist, 'accueil.html'), 'utf8') : null
  app.get('/', async (c) => new Response(accueil && !(await hasSession(c.req.header('cookie'))) ? accueil : index, { headers: PAGE_HEADERS }))
  app.use('/assets/*', serveStatic({ root: './dist' }))
  app.use('*', serveStatic({ root: './dist' }))
  app.get('*', (c) => c.html(index))
}

const port = Number(process.env.PORT ?? 3002)
if (!process.env.NO_LISTEN && !process.env.VERCEL) {
  await hydrateServerSecrets()
  serve({ fetch: app.fetch, port }, () => console.log(`[projectlead] API sur http://localhost:${port}`))
}

export default app
