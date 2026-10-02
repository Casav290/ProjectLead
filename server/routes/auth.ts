import { Hono } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie'
import { z } from 'zod'
import { hashPassword, hashToken, newToken, SESSION_COOKIE, SESSION_DAYS, verifyPassword } from '../auth.js'
import { anon, anonTx, type Db } from '../db.js'
import { isProduction } from '../lib/env.js'
import { body, email, HttpError, type Env } from '../lib/http.js'
import { finishLogin, logoutUrl, startLogin, type LeadClaims } from '../lib/leadId.js'
import { assertSeatFree, savePlan } from '../lib/plans.js'
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
    `insert into sessions (token_hash, user_id, account_id, expires_at, user_agent, lead_id_token)
     values ($1,$2,$3, now() + make_interval(days => $4), $5, $6)`,
    [hashToken(token), userId, accountId, SESSION_DAYS, (c.req.header('user-agent') ?? '').slice(0, 300), idToken ?? null]))
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
  })
  // Un seul cookie par réponse : Neon Functions ne garde que le dernier (db/006_session_lead_token.sql).
  return token
}

/** Crée l'entreprise, son premier administrateur et les réglages de départ. */
async function createAccount(db: Db, a: { company: string; leadOrg?: string | null; plan?: string }, userId: string) {
  const acc = (await db.query('insert into accounts (name, lead_org, plan) values ($1,$2,coalesce($3, \'pro\')) returning id',
    [a.company, a.leadOrg ?? null, a.plan ?? null])).rows[0]
  await db.query(`insert into account_users (account_id, user_id, role) values ($1,$2,'admin')`, [acc.id, userId])
  await seedAccount(db, acc.id, userId)
  return acc.id as string
}

app.post('/api/auth/signup', async (c) => {
  // Avec le Compte Lead, on s'inscrit là-bas : tout le monde y entre, la formule de la famille fixe les limites (lib/plans.ts).
  // Une inscription locale passerait à côté (espace ouvert sans formule).
  if (leadIdConfigured()) throw new HttpError(403, 'signup_via_lead')
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
  // Le jeton d'identité du Compte Lead est gardé avec la session (un seul cookie par réponse).
  const gone = t ? await anon(async (db) => (await db.query('delete from sessions where token_hash = $1 returning lead_id_token', [hashToken(t)])).rows[0]) : null
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  const idt = gone?.lead_id_token ?? null
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
    // Une invitation tenait une place ; si la formule a baissé depuis, il n'y en a peut-être plus.
    const member = user ? (await db.query('select 1 from account_users where account_id = $1 and user_id = $2 and active', [inv.account_id, user.id])).rowCount : 0
    if (!member) await assertSeatFree(db, inv.account_id, false)
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
  // « Créer un compte » : le Compte Lead ouvre directement son inscription (OIDC prompt=create).
  const url = c.req.query('signup') === '1' ? `${s.url}&prompt=create` : s.url
  const next = c.req.query('next')
  await setSignedCookie(c, 'pl_lead_login', JSON.stringify({ state: s.state, nonce: s.nonce, verifier: s.verifier,
    next: next?.startsWith('/') && !next.startsWith('//') ? next : undefined } satisfies Saved), cookieSecret(),
    { httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/', maxAge: 600 })
  return c.redirect(url)
})

/**
 * Rattacher la personne du Compte Lead à un utilisateur local (crmlead/docs/LEAD-ID.md,
 * étape 5) : par `sub` d'abord, par l'email **vérifié** ensuite, sinon création. Jamais par
 * un email non vérifié.
 */
export async function attachLeadPerson(claims: LeadClaims) {
  // Sans organisation ni formule (portée « lead » retirée de l'adresse d'autorisation), on ne saurait pas
  // à quelle entreprise ni à quelle formule rattacher la personne : on refuse plutôt que d'ouvrir sans limite.
  if (!claims.org || !claims.lead?.plan?.code) throw new Error('lead_scope_missing')
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
    // L'entreprise : celle de l'organisation Lead, sinon celle de la personne, sinon une nouvelle. La formule
    // du jeton n'est posée que sur l'entreprise de SON organisation (jamais celle d'un membre venu d'ailleurs).
    let acc: { id: string } | null = (await db.query('select id from accounts where lead_org = $1', [claims.org])).rows[0] ?? null
    let ownOrg = Boolean(acc), created = false
    if (!acc) {
      const mine = (await db.query(
        `select a.id, a.lead_org, au.role from accounts a join account_users au on au.account_id = a.id
          where au.user_id = $1 and au.active order by au.joined_at limit 1`, [user.id])).rows[0]
      if (mine) {
        acc = { id: mine.id }
        // Une entreprise d'avant le Compte Lead ne se lie qu'à l'organisation de son administrateur, s'il l'est aussi chez Lead.
        if (!mine.lead_org && mine.role === 'admin' && claims.org_role === 'admin') {
          await db.query('update accounts set lead_org = $1 where id = $2 and lead_org is null', [claims.org, mine.id])
          ownOrg = true
        }
      }
    }
    if (!acc) {
      acc = { id: await createAccount(db, { company: claims.org_name || claims.name || claims.email, leadOrg: claims.org, plan: 'free' }, user.id) }
      ownOrg = created = true
    }
    if (ownOrg) await savePlan(db, acc.id, claims.lead)
    const role = claims.org_role === 'admin' ? 'admin' : claims.org_role === 'manager' ? 'manager' : 'member'
    /** Une place dans cette entreprise : déjà active, ou prise maintenant s'il en reste (invitation en attente comprise). */
    const placeIn = async (accountId: string) => {
      const already = (await db.query('select active from account_users where account_id = $1 and user_id = $2', [accountId, user.id])).rows[0]
      if (already) return Boolean(already.active)
      const inv = (await db.query(
        `select id, role from invitations where account_id = $1 and lower(email) = lower($2) and accepted_at is null and expires_at > now()
          order by created_at desc limit 1`, [accountId, claims.email])).rows[0]
      // Avec une invitation, sa place est déjà comptée : on vérifie seulement que la formule n'a pas baissé depuis.
      try { await assertSeatFree(db, accountId, !inv) } catch (e) {
        if (e instanceof HttpError && e.code === 'plan_limit_seats') return false
        throw e
      }
      if (inv) await db.query('update invitations set accepted_at = now() where id = $1', [inv.id])
      await db.query(`insert into account_users (account_id, user_id, role) values ($1,$2,$3) on conflict (account_id, user_id) do nothing`,
        [accountId, user.id, inv?.role ?? role])
      return true
    }
    // Toute personne entre (Ève, 02.10.2026). Si l'entreprise de son organisation est complète ou qu'elle y a été
    // désactivée : une autre entreprise où elle est active, sinon son propre espace en formule gratuite.
    let accountId = acc.id
    if (!created && !(await placeIn(acc.id))) {
      const other = (await db.query(
        `select au.account_id from account_users au where au.user_id = $1 and au.active and au.account_id <> $2
          order by au.joined_at limit 1`, [user.id, acc.id])).rows[0]
      if (other) accountId = other.account_id
      else {
        accountId = await createAccount(db, { company: claims.name || claims.email, plan: 'free' }, user.id)
        await db.query(`insert into notifications (account_id, user_id, kind, title, link) values ($1,$2,'plan',$3,'/reglages/entreprise')`,
          [accountId, user.id, `L'espace de ${claims.org_name || 'votre organisation'} n'a plus de place pour vous : voici votre propre espace, en formule gratuite.`])
      }
    }
    return { userId: user.id as string, accountId }
  })
}

app.get('/auth/lead/callback', async (c) => {
  const raw = await getSignedCookie(c, cookieSecret(), 'pl_lead_login')
  // Pas de suppression du cookie de départ ici : la réponse pose déjà le cookie de session, et Neon Functions
  // ne garde que le dernier Set-Cookie. Il expire seul en 10 minutes ; son `state` ne sert qu'une fois.
  if (!raw) return c.redirect('/login?erreur=session')
  try {
    const saved = JSON.parse(raw) as Saved
    const { claims, tokens } = await finishLogin(c.req.query(), saved)
    // Toute personne du Compte Lead entre, quelle que soit sa formule (Ève, 02.10.2026).
    const who = await attachLeadPerson(claims)
    await openSession(c, who.userId, who.accountId, tokens.id_token)
    return c.redirect(saved.next ?? '/')
  } catch (e) {
    // Des refus qui durent : un message précis, et pas de nouveau départ automatique (qui tournerait en boucle).
    if ((e as Error).message === 'email_not_verified') return c.redirect('/login?erreur=email')
    if ((e as Error).message === 'lead_scope_missing') return c.redirect('/login?erreur=portee')
    console.error('[compte lead]', (e as Error).message)
    return c.redirect('/login?erreur=lead')
  }
})

export default app
