import { Hono } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie'
import { z } from 'zod'
import { hashPassword, hashToken, newToken, SESSION_COOKIE, SESSION_DAYS, verifyPassword } from '../auth.js'
import { anon, anonTx, type Db } from '../db.js'
import { isProduction, leadIdOn } from '../lib/env.js'
import { body, email, HttpError, type Env } from '../lib/http.js'
import { finishLogin, logoutUrl, startLogin, verifyLeadJwt, type LeadClaims } from '../lib/leadId.js'
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
export const leadIdConfigured = leadIdOn

/**
 * `sid` du jeton d'identité d'ERPlead : l'identifiant de la session ERPlead de CE navigateur. Gardé avec la session
 * ProjectLead, il permet à une déconnexion de ne fermer que les sessions de ce navigateur (db/010_session_lead_sid.sql).
 */
export const leadSid = (v: unknown): string | null => (typeof v === 'string' && v.length >= 1 && v.length <= 255 ? v : null)

export async function openSession(c: any, userId: string, accountId: string, idToken?: string | null, sid?: string | null) {
  const token = newToken()
  await anon((db) => db.query(
    `insert into sessions (token_hash, user_id, account_id, expires_at, user_agent, lead_id_token, lead_sid)
     values ($1,$2,$3, now() + make_interval(days => $4), $5, $6, $7)`,
    [hashToken(token), userId, accountId, SESSION_DAYS, (c.req.header('user-agent') ?? '').slice(0, 300), idToken ?? null, leadSid(sid)]))
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
  })
  // Un seul cookie par réponse : Neon Functions ne garde que le dernier (db/006_session_lead_token.sql).
  return token
}

/** Crée l'entreprise, son premier administrateur et les réglages de départ. */
async function createAccount(db: Db, a: { company: string; leadOrg?: string | null; plan?: string }, userId: string) {
  // Une entreprise naît en Gratuit : la formule payante se prend dans ProjectLead (Réglages → Entreprise).
  const acc = (await db.query('insert into accounts (name, lead_org, plan) values ($1,$2,coalesce($3, \'free\')) returning id',
    [a.company, a.leadOrg ?? null, a.plan ?? null])).rows[0]
  await db.query(`insert into account_users (account_id, user_id, role) values ($1,$2,'admin')`, [acc.id, userId])
  await seedAccount(db, acc.id, userId)
  return acc.id as string
}

app.post('/api/auth/signup', async (c) => {
  // Avec le Compte Lead, on s'inscrit là-bas : tout le monde y entre, la formule ProjectLead fixe les limites (lib/plans.ts).
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
    `select i.email, i.role, a.name as account,
            (select 1 from users u where lower(u.email) = lower(i.email)) as has_user,
            (select 1 from users u where lower(u.email) = lower(i.email) and u.password_hash is not null) as has_password
       from invitations i join accounts a on a.id = i.account_id
      where i.token_hash = $1 and i.accepted_at is null and i.expires_at > now()`, [hashToken(c.req.param('token'))])).rows[0])
  if (!inv) throw new HttpError(404, 'invitation_invalid')
  // `leadId` : l'invitation s'accepte avec le Compte Lead ; le mot de passe ProjectLead ne reste qu'aux accès d'avant.
  return c.json({ email: inv.email, role: inv.role, account: inv.account, hasUser: Boolean(inv.has_user),
    hasPassword: Boolean(inv.has_password), leadId: leadIdConfigured() })
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
    // Avec le Compte Lead, une invitation s'accepte par lui (/auth/lead/start?next=/invitation/<jeton>) : pas de
    // nouveau mot de passe ProjectLead, et une personne du Compte Lead (sans mot de passe ici) n'en a pas à donner.
    if (leadIdConfigured() && !user?.password_hash) throw new HttpError(403, 'invitation_via_lead')
    if (user) {
      // Une personne qui a déjà un compte prouve qu'elle est elle par son mot de passe.
      if (!user.password_hash || !verifyPassword(b.password, user.password_hash)) throw new HttpError(401, 'invalid_credentials')
    } else {
      user = (await db.query('insert into users (email, name, password_hash) values ($1,$2,$3) returning id',
        [inv.email, b.name ?? '', hashPassword(b.password)])).rows[0]
    }
    await db.query(
      `insert into account_users (account_id, user_id, role) values ($1,$2,$3)
       on conflict (account_id, user_id) do update set active = true, lead_disabled = false, role = excluded.role`,
      [inv.account_id, user.id, inv.role])
    await db.query('update invitations set accepted_at = now() where id = $1', [inv.id])
    return { userId: user.id as string, accountId: inv.account_id as string }
  })
  await openSession(c, out.userId, out.accountId)
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ Compte Lead

type Saved = { state: string; nonce: string; verifier: string; next?: string }
/**
 * La page où revenir après la connexion : un chemin de ProjectLead seulement. Ni « //autre.site », ni « /\autre.site »
 * (un navigateur lit la barre oblique inverse comme « / » : la redirection relative mènerait sur un autre site).
 */
export const safeNext = (v: unknown): string | undefined =>
  typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(v) && v.length <= 2048 ? v : undefined

// `/auth/lead/login` : même départ, sous le nom que les contrôles de la famille essaient (comme `/auth/lead/start`).
const startLeadLogin = async (c: any) => {
  if (!leadIdConfigured()) return c.redirect('/login?erreur=lead_non_configure')
  // Départ depuis www : ERPlead ne revient que sur l'adresse enregistrée (LEAD_ID_REDIRECT_URI, sans www), où le
  // cookie de départ posé sur www n'arriverait pas (retour en « erreur=session »). On repart donc de cette adresse.
  const home = callbackOrigin()
  const here = new URL(c.req.url)
  if (home && here.hostname === `www.${home.hostname}`) return c.redirect(`${home.origin}${here.pathname}${here.search}`)
  const s = startLogin({ locale: 'fr' })
  // « Créer un compte » : le Compte Lead ouvre directement son inscription (OIDC prompt=create).
  const url = c.req.query('signup') === '1' ? `${s.url}&prompt=create` : s.url
  const next = c.req.query('next')
  await setSignedCookie(c, 'pl_lead_login', JSON.stringify({ state: s.state, nonce: s.nonce, verifier: s.verifier,
    next: safeNext(next) } satisfies Saved), cookieSecret(),
    { httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/', maxAge: 600 })
  return c.redirect(url)
}
function callbackOrigin(): URL | null {
  try { return new URL(process.env.LEAD_ID_REDIRECT_URI ?? '') } catch { return null }
}
app.get('/auth/lead/start', startLeadLogin)
app.get('/auth/lead/login', startLeadLogin)

/**
 * Arrivée refusée sans autre issue (passage entre applications, 13.10.2026) : l'espace de l'entreprise n'a plus de
 * place (`places`), ou un administrateur ProjectLead a désactivé la personne (`desactive`). Jamais d'espace à part.
 */
export class ArrivalRefused extends Error {
  constructor(readonly reason: 'places' | 'desactive') { super(`arrival_${reason}`) }
}

/** Le jeton d'une invitation ProjectLead quand la page demandée est `/invitation/<jeton>`. */
export const invitationToken = (next?: string | null) => /^\/invitation\/([A-Za-z0-9_-]{16,200})$/.exec(next ?? '')?.[1]

/**
 * Rattacher la personne du Compte Lead à un utilisateur local (crmlead/docs/LEAD-ID.md,
 * étape 5) : par `sub` d'abord, par l'email **vérifié** ensuite, sinon création. Jamais par
 * un email non vérifié.
 *
 * L'espace (règle du passage entre applications, Ève, 13.10.2026) : TOUJOURS celui de l'organisation ERPlead de la
 * personne (`claims.org`), rejoint s'il existe, sinon créé à son nom en formule Gratuite. Ni choix d'espace, ni espace
 * personnel, ni celui d'une autre entreprise. Seule exception : une invitation ProjectLead acceptée avec le Compte Lead
 * (`opts.invitation`, même adresse vérifiée) ouvre l'entreprise qui a invité.
 */
export async function attachLeadPerson(claims: LeadClaims, opts: { invitation?: string } = {}) {
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
    const userId = user.id as string

    /** Une place dans cette entreprise : déjà active, reprise après un départ annoncé par ERPlead, ou prise maintenant s'il en reste. */
    const placeIn = async (accountId: string, roleIfNew: string, inv?: { id: string; role: string } | null) => {
      const already = (await db.query('select active, lead_disabled from account_users where account_id = $1 and user_id = $2',
        [accountId, userId])).rows[0]
      if (already?.active) {
        if (inv) await db.query('update invitations set accepted_at = now() where id = $1', [inv.id])
        return
      }
      // Désactivée par un administrateur de l'espace : elle reste dehors tant qu'il ne la réactive pas (ou ne la réinvite pas).
      if (already && !already.lead_disabled && !inv) throw new ArrivalRefused('desactive')
      // Avec une invitation, sa place est déjà comptée : on vérifie seulement que la formule n'a pas baissé depuis.
      try { await assertSeatFree(db, accountId, !inv) } catch (e) {
        if (e instanceof HttpError && e.code === 'plan_limit_seats') throw new ArrivalRefused('places')
        throw e
      }
      if (inv) await db.query('update invitations set accepted_at = now() where id = $1', [inv.id])
      await db.query(
        `insert into account_users (account_id, user_id, role) values ($1,$2,$3)
         on conflict (account_id, user_id) do update set active = true, lead_disabled = false
                                                   ${inv ? ', role = excluded.role' : ''}`,
        [accountId, userId, inv?.role ?? roleIfNew])
    }

    // Une invitation ProjectLead acceptée avec le Compte Lead : pour la personne connectée, à la même adresse vérifiée.
    let invitation: 'accepted' | 'autre_adresse' | 'invalide' | undefined
    if (opts.invitation) {
      const inv = (await db.query(
        `select id, account_id, email, role from invitations
          where token_hash = $1 and accepted_at is null and expires_at > now() for update`, [hashToken(opts.invitation)])).rows[0]
      if (!inv) invitation = 'invalide'
      else if (!claims.email_verified || inv.email.toLowerCase() !== String(claims.email).toLowerCase()) invitation = 'autre_adresse'
      else {
        await placeIn(inv.account_id, inv.role, inv)
        return { userId, accountId: inv.account_id as string, invitation: 'accepted' as const }
      }
    }

    // L'espace de l'organisation ERPlead. Une entreprise d'avant le Compte Lead ne le devient que si la personne en
    // est l'administratrice et l'est aussi chez ERPlead. Deux collègues arrivés au même instant n'en créent qu'un :
    // le second attend la fin de la transaction du premier, puis le trouve.
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`projectlead-lead-org:${claims.org}`])
    let acc: { id: string } | null = (await db.query('select id from accounts where lead_org = $1', [claims.org])).rows[0] ?? null
    if (!acc && claims.org_role === 'admin') {
      acc = (await db.query(
        `update accounts set lead_org = $1
          where id = (select a.id from accounts a join account_users au on au.account_id = a.id
                       where au.user_id = $2 and au.active and au.role = 'admin' and a.lead_org is null
                       order by au.joined_at limit 1)
            and lead_org is null
          returning id`, [claims.org, userId])).rows[0] ?? null
    }
    let created = false
    if (!acc) {
      acc = { id: await createAccount(db, { company: claims.org_name || claims.name || claims.email, leadOrg: claims.org, plan: 'free' }, userId) }
      created = true
    }
    // La formule ProjectLead du jeton, calculée par ERPlead pour cette application et cette organisation.
    await savePlan(db, acc.id, claims.lead)
    const role = claims.org_role === 'admin' ? 'admin' : claims.org_role === 'manager' ? 'manager' : 'member'
    if (!created) {
      const inv = (await db.query(
        `select id, role from invitations where account_id = $1 and lower(email) = lower($2) and accepted_at is null and expires_at > now()
          order by created_at desc limit 1`, [acc.id, claims.email])).rows[0] ?? null
      await placeIn(acc.id, role, inv)
    }
    return { userId, accountId: acc.id, invitation }
  })
}

/**
 * OpenID Connect Back-Channel Logout : ERPlead poste ici un `logout_token` signé.
 * - Départ (`lead_status: "disabled"`, 12.10.2026) : TOUTES les sessions de la personne tombent, dans toutes les
 *   entreprises, et elle devient inactive dans l'entreprise de l'organisation annoncée (place libérée), sauf si elle
 *   en est le dernier administrateur actif.
 * - Déconnexion (`lead_status: "logout"`, décision d'Ève du 13.10.2026) : seulement les sessions de CE navigateur,
 *   celles dont le `sid` (session ERPlead, gardé à la connexion) est celui du jeton, et les sessions ouvertes avant
 *   qu'on garde le `sid` (fermées par personne, comme avant). Ses autres appareils restent connectés. Un jeton sans
 *   `sid` ferme toutes ses sessions, comme avant.
 * Le jeton est vérifié comme un jeton d'identité (signature, émetteur, audience, expiration), doit porter l'événement
 * de déconnexion, un `sub`, pas de `nonce`, et dater de moins de cinq minutes. Pas de cookie, pas de redirection :
 * 200 ou 400.
 */
const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout'
app.post('/auth/lead/backchannel-logout', async (c) => {
  c.header('Cache-Control', 'no-store')
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
  const token = String(form.logout_token ?? '')
  const claims = token ? await verifyLeadJwt(token, process.env.LEAD_ID_CLIENT_ID ?? 'projectlead') : null
  const fresh = typeof claims?.iat === 'number' && claims.iat * 1000 > Date.now() - 5 * 60_000
  if (!claims || !fresh || typeof claims.sub !== 'string' || claims.nonce !== undefined || !claims.events?.[BACKCHANNEL_EVENT])
    return c.json({ error: 'invalid_request' }, 400)
  await anonTx(async (db) => {
    const user = (await db.query('select id from users where lead_sub = $1', [claims.sub])).rows[0]
    if (!user) return
    const account = typeof claims.org === 'string'
      ? (await db.query('select id from accounts where lead_org = $1', [claims.org])).rows[0] : null
    const sid = leadSid(claims.sid)
    if (claims.lead_status !== 'disabled' && sid)
      await db.query('delete from sessions where user_id = $1 and (lead_sid = $2 or lead_sid is null)', [user.id, sid])
    else await db.query('delete from sessions where user_id = $1', [user.id])
    if (claims.lead_status === 'disabled' && account)
      await db.query(
        `update account_users set active = false, lead_disabled = true
          where account_id = $1 and user_id = $2 and active
            and (role <> 'admin' or exists (select 1 from account_users o where o.account_id = $1 and o.user_id <> $2
                                             and o.role = 'admin' and o.active))`, [account.id, user.id])
  })
  return c.body(null, 200)
})

app.get('/auth/lead/callback', async (c) => {
  const raw = await getSignedCookie(c, cookieSecret(), 'pl_lead_login')
  // Pas de suppression du cookie de départ ici : la réponse pose déjà le cookie de session, et Neon Functions
  // ne garde que le dernier Set-Cookie. Il expire seul en 10 minutes ; son `state` ne sert qu'une fois.
  if (!raw) return c.redirect('/login?erreur=session')
  let saved: Saved = { state: '', nonce: '', verifier: '' }
  // Un refus garde la page demandée : « Réessayer » (ou « J'ai confirmé mon adresse ») y ramène, invitation comprise.
  const refused = (code: string) => c.redirect(`/login?erreur=${code}${saved.next ? `&next=${encodeURIComponent(saved.next)}` : ''}`)
  try {
    saved = JSON.parse(raw) as Saved
    saved.next = safeNext(saved.next)
    const { claims, tokens } = await finishLogin(c.req.query(), saved)
    // Toute personne du Compte Lead entre, quelle que soit sa formule (Ève, 02.10.2026), dans l'espace de son entreprise.
    const invite = invitationToken(saved.next)
    const who = await attachLeadPerson(claims, { invitation: invite })
    await openSession(c, who.userId, who.accountId, tokens.id_token, leadSid(claims.sid))
    // Invitation acceptée : l'espace qui a invité. Adressée à une autre adresse : la page de l'invitation le dit.
    if (invite) return c.redirect(who.invitation === 'accepted' ? '/' : who.invitation === 'autre_adresse' ? `${saved.next}?erreur=adresse` : saved.next!)
    return c.redirect(saved.next ?? '/')
  } catch (e) {
    // Des refus qui durent : un message précis, et pas de nouveau départ automatique (qui tournerait en boucle).
    if (e instanceof ArrivalRefused) return refused(e.reason)
    if ((e as Error).message === 'email_not_verified') return refused('email')
    if ((e as Error).message === 'lead_scope_missing') return c.redirect('/login?erreur=portee')
    console.error('[compte lead]', (e as Error).message)
    return c.redirect('/login?erreur=lead')
  }
})

export default app
