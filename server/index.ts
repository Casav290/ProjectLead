import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { hashToken, SESSION_COOKIE } from './auth.js'
import { anon } from './db.js'
import { HttpError, type Env } from './lib/http.js'
import { runJobsIfDue, runJobs } from './lib/jobs.js'
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
app.use('*', async (c, next) => { runJobsIfDue(); await next() })

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

/** Tâches planifiées appelables de l'extérieur (cron du déploiement). */
app.post('/api/tasks/run', async (c) => {
  if (!process.env.TASKS_SECRET || c.req.header('authorization') !== `Bearer ${process.env.TASKS_SECRET}`)
    return c.json({ error: 'unauthenticated' }, 401)
  return c.json(await runJobs(true))
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

const dist = join(import.meta.dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use('/assets/*', serveStatic({ root: './dist' }))
  app.use('*', serveStatic({ root: './dist' }))
  const index = readFileSync(join(dist, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(index))
}

const port = Number(process.env.PORT ?? 3002)
if (!process.env.NO_LISTEN) {
  serve({ fetch: app.fetch, port }, () => console.log(`[projectlead] API sur http://localhost:${port}`))
}

export default app
