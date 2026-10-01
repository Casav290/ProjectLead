import { Hono } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie'
import { z } from 'zod'
import { hashPassword, hashToken, newToken, SESSION_COOKIE, SESSION_DAYS, verifyPassword } from '../auth.js'
import { anon, anonTx, type Db } from '../db.js'
import { isProduction } from '../lib/env.js'
import { body, email, HttpError, type Env } from '../lib/http.js'
import { finishLogin, logoutUrl, startLogin, type LeadClaims } from '../lib/leadId.js'
import { seedAccount } from '../lib/defaults.js'

/**
 * Connexion. Deux portes, comme le veut la famille Lead :
 * - le **Compte Lead** (OpenID Connect hébergé par CRMlead), bouton principal dès que
 *   `LEAD_ID_CLIENT_SECRET` est posé ;
 * - l'email et le mot de passe locaux, pour démarrer sans CRMlead et pour les contrôles.
 */

const app = new Hono<Env>()

const cookieSecret = () => process.env.APP_SECRET || 'dev-only-secret-change-me-0123456789'
export const leadIdConfigured = () => Boolean(process.env.LEAD_ID_CLIENT_SECRET && process.env.LEAD_ID_ISSUER)

export async function openSession(c: any, userId: string, accountId: string, idToken?: string | null) {
  const token = newToken()
  await anon((db) => db.query(
    `insert into sessions (token_hash, user_id, account_id, expires_at, user_agent)
     values ($1,$2,$3, now() + make_interval(days => $4), $5)`,
    [hashToken(token), userId, accountId, SESSION_DAYS, (c.req.header('user-agent') ?? '').slice(0, 300)]))
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
  })
  if (idToken) setCookie(c, 'pl_lead_idt', idToken, { httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/' })
  return token
}

/** Crée l'entreprise, son premier administrateur et les réglages de départ. */
async function createAccount(db: Db, a: { company: string; leadOrg?: string | null }, userId: string) {
  const acc = (await db.query('insert into accounts (name, lead_org) values ($1,$2) returning id', [a.company, a.leadOrg ?? null])).rows[0]
  await db.query(`insert into account_users (account_id, user_id, role) values ($1,$2,'admin')`, [acc.id, userId])
  await seedAccount(db, acc.id, userId)
  return acc.id as string
}

app.post('/api/auth/signup', async (c) => {
  const b = await body(c, z.object({
    name: z.string().trim().min(1).max(120), email, password: z.string().min(10).max(200),
    company: z.string().trim().min(1).max(200),
  }))
  const out = await anonTx(async (db) => {
    const exists = (await db.query('select 1 from users where lower(email) = $1', [b.email])).rowCount
    if (exists) throw new HttpError(409, 'email_taken')
    const u = (await db.query('insert into users (email, name, password_hash) values ($1,$2,$3) returning id',
      [b.email, b.name, hashPassword(b.password)])).rows[0]
    const accountId = await createAccount(db, { company: b.company }, u.id)
    return { userId: u.id as string, accountId }
  })
  await openSession(c, out.userId, out.accountId)
  return c.json({ ok: true }, 201)
})

app.post('/api/auth/login', async (c) => {
  const b = await body(c, z.object({ email, password: z.string().min(1).max(200) }))
  const u = await anon(async (db) => (await db.query(
    `select u.id, u.password_hash, au.account_id from users u
       join account_users au on au.user_id = u.id and au.active
      where lower(u.email) = $1 order by au.joined_at limit 1`, [b.email])).rows[0])
  if (!u?.password_hash || !verifyPassword(b.password, u.password_hash)) throw new HttpError(401, 'invalid_credentials')
  await openSession(c, u.id, u.account_id)
  return c.json({ ok: true })
})

app.post('/api/auth/logout', async (c) => {
  const t = getCookie(c, SESSION_COOKIE)
  if (t) await anon((db) => db.query('delete from sessions where token_hash = $1', [hashToken(t)]))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  const idt = getCookie(c, 'pl_lead_idt')
  deleteCookie(c, 'pl_lead_idt', { path: '/' })
  const back = `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/login`
  return c.json({ ok: true, redirect: idt && leadIdConfigured() ? logoutUrl(idt, back) : null })
})

app.get('/api/auth/options', (c) => c.json({ leadId: leadIdConfigured() }))

// ------------------------------------------------------------------ invitations

app.get('/api/auth/invitation/:token', async (c) => {
  const inv = await anon(async (db) => (await db.query(
    `select i.email, i.role, a.name as account, (select 1 from users u where lower(u.email) = lower(i.email)) as has_user
       from invitations i join accounts a on a.id = i.account_id
      where i.token_hash = $1 and i.accepted_at is null and i.expires_at > now()`, [hashToken(c.req.param('token'))])).rows[0])
  if (!inv) throw new HttpError(404, 'invitation_invalid')
  return c.json({ email: inv.email, role: inv.role, account: inv.account, hasUser: Boolean(inv.has_user) })
})

app.post('/api/auth/invitation/:token/accept', async (c) => {
  const b = await body(c, z.object({ name: z.string().trim().max(120).optional(), password: z.string().min(10).max(200) }))
  const out = await anonTx(async (db) => {
    const inv = (await db.query(
      `select id, account_id, email, role from invitations
        where token_hash = $1 and accepted_at is null and expires_at > now() for update`, [hashToken(c.req.param('token'))])).rows[0]
    if (!inv) throw new HttpError(404, 'invitation_invalid')
    let user = (await db.query('select id, password_hash from users where lower(email) = lower($1)', [inv.email])).rows[0]
    if (user) {
      // Une personne qui a déjà un compte prouve qu'elle est elle par son mot de passe.
      if (!user.password_hash || !verifyPassword(b.password, user.password_hash)) throw new HttpError(401, 'invalid_credentials')
    } else {
      user = (await db.query('insert into users (email, name, password_hash) values ($1,$2,$3) returning id',
        [inv.email, b.name ?? '', hashPassword(b.password)])).rows[0]
    }
    await db.query(
      `insert into account_users (account_id, user_id, role) values ($1,$2,$3)
       on conflict (account_id, user_id) do update set active = true, role = excluded.role`, [inv.account_id, user.id, inv.role])
    await db.query('update invitations set accepted_at = now() where id = $1', [inv.id])
    return { userId: user.id as string, accountId: inv.account_id as string }
  })
  await openSession(c, out.userId, out.accountId)
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ Compte Lead

type Saved = { state: string; nonce: string; verifier: string; next?: string }

app.get('/auth/lead/start', async (c) => {
  if (!leadIdConfigured()) return c.redirect('/login?erreur=lead_non_configure')
  const s = startLogin({ locale: 'fr' })
  const next = c.req.query('next')
  await setSignedCookie(c, 'pl_lead_login', JSON.stringify({ state: s.state, nonce: s.nonce, verifier: s.verifier,
    next: next?.startsWith('/') && !next.startsWith('//') ? next : undefined } satisfies Saved), cookieSecret(),
    { httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/', maxAge: 600 })
  return c.redirect(s.url)
})

/**
 * Rattacher la personne du Compte Lead à un utilisateur local (crmlead/docs/LEAD-ID.md,
 * étape 5) : par `sub` d'abord, par l'email **vérifié** ensuite, sinon création. Jamais par
 * un email non vérifié.
 */
export async function attachLeadPerson(claims: LeadClaims) {
  return anonTx(async (db) => {
    let user = (await db.query('select id from users where lead_sub = $1', [claims.sub])).rows[0]
    if (!user && claims.email_verified) {
      user = (await db.query('select id from users where lower(email) = lower($1) and lead_sub is null', [claims.email])).rows[0]
      if (user) await db.query('update users set lead_sub = $1 where id = $2', [claims.sub, user.id])
    }
    if (!user) {
      if (!claims.email_verified) throw new Error('email_not_verified')
      user = (await db.query('insert into users (email, name, lead_sub, locale) values ($1,$2,$3,$4) returning id',
        [claims.email, claims.name ?? '', claims.sub, (claims.locale ?? 'fr').slice(0, 2)])).rows[0]
    } else {
      await db.query('update users set email = $1, name = coalesce(nullif($2, \'\'), name) where id = $3',
        [claims.email, claims.name ?? '', user.id])
    }
    // L'entreprise : celle de l'organisation Lead, sinon celle de la personne, sinon une nouvelle.
    let acc = claims.org ? (await db.query('select id from accounts where lead_org = $1', [claims.org])).rows[0] : null
    if (!acc) {
      acc = (await db.query(
        `select a.id from accounts a join account_users au on au.account_id = a.id
          where au.user_id = $1 and au.active order by au.joined_at limit 1`, [user.id])).rows[0]
      if (acc && claims.org) await db.query('update accounts set lead_org = $1 where id = $2 and lead_org is null', [claims.org, acc.id])
    }
    if (!acc) {
      const id = await createAccount(db, { company: claims.org_name || claims.name || claims.email, leadOrg: claims.org }, user.id)
      acc = { id }
    }
    const role = claims.org_role === 'admin' ? 'admin' : claims.org_role === 'manager' ? 'manager' : 'member'
    await db.query(
      `insert into account_users (account_id, user_id, role) values ($1,$2,$3) on conflict (account_id, user_id) do nothing`,
      [acc.id, user.id, role])
    // La formule vient du Compte Lead : elle ouvre ou ferme ProjectLead.
    if (claims.lead?.plan?.code) await db.query('update accounts set plan = $1 where id = $2', [claims.lead.plan.code, acc.id])
    const access = claims.lead?.apps?.projectlead?.access
    return { userId: user.id as string, accountId: acc.id as string, access: access !== false }
  })
}

app.get('/auth/lead/callback', async (c) => {
  const raw = await getSignedCookie(c, cookieSecret(), 'pl_lead_login')
  deleteCookie(c, 'pl_lead_login', { path: '/' })
  if (!raw) return c.redirect('/login?erreur=session')
  try {
    const saved = JSON.parse(raw) as Saved
    const { claims, tokens } = await finishLogin(c.req.query(), saved)
    const who = await attachLeadPerson(claims)
    if (!who.access) {
      const up = claims.lead?.apps?.projectlead?.upgrade_url
      return c.redirect(`/login?erreur=formule${up ? `&upgrade=${encodeURIComponent(up)}` : ''}`)
    }
    await openSession(c, who.userId, who.accountId, tokens.id_token)
    return c.redirect(saved.next ?? '/')
  } catch (e) {
    console.error('[compte lead]', (e as Error).message)
    return c.redirect('/login?erreur=lead')
  }
})

export default app
