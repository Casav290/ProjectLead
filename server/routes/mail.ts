import { Hono } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { simpleParser } from 'mailparser'
import { z } from 'zod'
import { anon } from '../db.js'
import { logActivity } from '../lib/activity.js'
import { sendMail } from '../lib/email.js'
import { isProduction } from '../lib/env.js'
import { body, email, HttpError, notFound, router, tx, uuid } from '../lib/http.js'
import * as google from '../lib/mailbox/google.js'
import * as imap from '../lib/mailbox/imap.js'
import { fetchBody, ingest, mailboxesOnce } from '../lib/mailbox/index.js'
import * as microsoft from '../lib/mailbox/microsoft.js'
import { beginAuthorization, exchangeCode, mailboxOAuthEnabled, type OAuthProvider } from '../lib/mailbox/oauth.js'
import { detect, userFor } from '../lib/mailbox/presets.js'
import { mailboxSecretConfigured, seal } from '../lib/mailbox/secret.js'
import { addresses, displayName, newMessageId, readable } from '../lib/mailbox/types.js'
import { createProject } from './projects.js'

/**
 * Emails : les boîtes branchées (Gmail, Microsoft 365, IMAP — repris de CRMlead) et la boîte
 * de réception des projets. Chaque email reçu peut ouvrir un nouveau projet, rejoindre un
 * projet existant, ou devenir une tâche.
 */
const app = router()
const cookieSecret = () => process.env.APP_SECRET || 'dev-only-secret-change-me-0123456789'

// ------------------------------------------------------------------ boîtes

app.get('/mailboxes', async (c) => tx(c, async (db) => c.json({
  configured: mailboxSecretConfigured(),
  oauth: { google: mailboxOAuthEnabled('google'), microsoft: mailboxOAuthEnabled('microsoft') },
  mailboxes: (await db.query(
    `select m.id, m.provider, m.email, m.display_name, m.is_default, m.shared, m.last_synced_at, m.sync_error, m.user_id,
            u.name as user_name, (m.user_id = app_user()) as mine,
            (select count(*)::int from email_messages e where e.mailbox_id = m.id) as messages
       from mailboxes m join users u on u.id = m.user_id
      where m.user_id = app_user() or m.shared or app_role() = 'admin' order by m.email`)).rows,
})))

app.get('/mailboxes/detect', async (c) => {
  const e = c.req.query('email') ?? ''
  if (!e.includes('@')) throw new HttpError(400, 'email_required')
  const d = await detect(e)
  return c.json(d ?? { key: 'unknown', servers: null, oauth: null, appPassword: false })
})

app.post('/mailboxes/imap', async (c) => {
  if (!mailboxSecretConfigured()) throw new HttpError(503, 'app_secret_missing')
  const b = await body(c, z.object({
    email, password: z.string().min(1).max(300), display_name: z.string().trim().max(120).optional(),
    imap_host: z.string().max(200).optional(), imap_port: z.number().int().optional(), imap_secure: z.boolean().optional(),
    smtp_host: z.string().max(200).optional(), smtp_port: z.number().int().optional(), smtp_secure: z.boolean().optional(),
    username: z.string().max(200).optional(), shared: z.boolean().default(false),
  }))
  const d = b.imap_host ? null : await detect(b.email)
  const sv = d?.servers
  if (!b.imap_host && !sv) throw new HttpError(400, 'servers_unknown')
  const secret: imap.ImapSecret = {
    imap: { host: b.imap_host ?? sv!.imapHost, port: b.imap_port ?? sv!.imapPort, secure: b.imap_secure ?? sv!.imapSecure },
    smtp: { host: b.smtp_host ?? sv!.smtpHost, port: b.smtp_port ?? sv!.smtpPort, secure: b.smtp_secure ?? sv!.smtpSecure },
    user: b.username ?? (sv ? userFor(b.email, sv.imapUser) : b.email), pass: b.password,
  }
  try {
    await imap.verify(secret)
  } catch (e: any) {
    throw new HttpError(400, String(e?.message ?? 'imap_unreachable'))
  }
  const id = await tx(c, async (db, ctx) => (await db.query(
    `insert into mailboxes (account_id, user_id, provider, email, display_name, secret_enc, shared, is_default)
     values ($1,$2,'imap',$3,$4,$5,$6, not exists (select 1 from mailboxes where account_id = $1))
     on conflict (account_id, email) do update set secret_enc = excluded.secret_enc, sync_error = null, user_id = excluded.user_id
     returning id`, [ctx.accountId, ctx.userId, b.email, b.display_name ?? c.get('name'), seal(secret), b.shared])).rows[0].id)
  mailboxesOnce(1, id).catch(() => {})
  return c.json({ id }, 201)
})

app.get('/oauth/:provider/start', async (c) => {
  const p = c.req.param('provider') as OAuthProvider
  if (!['google', 'microsoft'].includes(p) || !mailboxOAuthEnabled(p) || !mailboxSecretConfigured()) return c.redirect('/reglages/emails?boite=indisponible')
  const a = beginAuthorization(p)
  await setSignedCookie(c, 'pl_mb_oauth', JSON.stringify({ state: a.state, verifier: a.verifier, p }), cookieSecret(),
    { httpOnly: true, secure: isProduction(), sameSite: 'Lax', path: '/', maxAge: 600 })
  return c.redirect(a.url)
})

app.get('/oauth/:provider/callback', async (c) => {
  const p = c.req.param('provider') as OAuthProvider
  const raw = await getSignedCookie(c, cookieSecret(), 'pl_mb_oauth')
  deleteCookie(c, 'pl_mb_oauth', { path: '/' })
  try {
    const saved = raw ? JSON.parse(raw) : null
    if (!saved || saved.p !== p || saved.state !== c.req.query('state') || !c.req.query('code')) throw new Error('state')
    const tokens = await exchangeCode(p, c.req.query('code')!, saved.verifier)
    const addr = p === 'google' ? await google.profileEmail(tokens) : await microsoft.profileEmail(tokens)
    const id = await tx(c, async (db, ctx) => (await db.query(
      `insert into mailboxes (account_id, user_id, provider, email, display_name, secret_enc, is_default)
       values ($1,$2,$3,$4,$5,$6, not exists (select 1 from mailboxes where account_id = $1))
       on conflict (account_id, email) do update set secret_enc = excluded.secret_enc, sync_error = null, provider = excluded.provider
       returning id`, [ctx.accountId, ctx.userId, p, addr, c.get('name'), seal(tokens)])).rows[0].id)
    mailboxesOnce(1, id).catch(() => {})
    return c.redirect('/reglages/emails?boite=ok')
  } catch (e) {
    console.error('[boîtes mail] oauth', (e as Error).message)
    return c.redirect('/reglages/emails?boite=erreur')
  }
})

app.patch('/mailboxes/:id', async (c) => {
  const b = await body(c, z.object({ is_default: z.boolean().optional(), shared: z.boolean().optional(), display_name: z.string().trim().max(120).optional() }))
  await tx(c, async (db) => {
    const m = (await db.query(`select id from mailboxes where id = $1 and (user_id = app_user() or app_role() = 'admin')`, [c.req.param('id')])).rows[0]
    if (!m) throw notFound()
    if (b.is_default) await db.query('update mailboxes set is_default = false where account_id = app_account()')
    await db.query(`update mailboxes set is_default = coalesce($2, is_default), shared = coalesce($3, shared),
                    display_name = coalesce($4, display_name) where id = $1`, [m.id, b.is_default ?? null, b.shared ?? null, b.display_name ?? null])
  })
  return c.json({ ok: true })
})

app.delete('/mailboxes/:id', async (c) => {
  await tx(c, (db) => db.query(`delete from mailboxes where id = $1 and (user_id = app_user() or app_role() = 'admin')`, [c.req.param('id')]))
  return c.json({ ok: true })
})

app.post('/mailboxes/:id/sync', async (c) => {
  const ok = await tx(c, async (db) => (await db.query(
    `select 1 from mailboxes where id = $1 and (user_id = app_user() or shared or app_role() = 'admin')`, [c.req.param('id')])).rowCount)
  if (!ok) throw notFound()
  const r = await mailboxesOnce(1, c.req.param('id'))
  return c.json(r[0] ?? { imported: 0, error: null })
})

// ------------------------------------------------------------------ boîte de réception

/** Les emails visibles : ceux de mes boîtes, des boîtes partagées, et de l'adresse de capture. */
const VISIBLE = `(e.mailbox_id is null or exists (select 1 from mailboxes m where m.id = e.mailbox_id and (m.user_id = app_user() or m.shared)))`

app.get('/inbox', async (c) => tx(c, async (db) => {
  const status = c.req.query('status') ?? 'new'
  const rows = (await db.query(
    `select e.id, e.direction, e.from_email, e.from_name, e.to_emails, e.subject, left(coalesce(e.body,''), 300) as snippet,
            e.received_at, e.status, e.project_id, p.name as project_name, e.client_id, cl.name as client_name, m.email as mailbox_email,
            (select json_build_object('id', c2.id, 'name', c2.name) from clients c2 left join client_contacts cc on cc.client_id = c2.id
              where c2.archived_at is null and (lower(c2.email) = e.from_email or lower(cc.email) = e.from_email) limit 1) as known_client
       from email_messages e left join projects p on p.id = e.project_id left join clients cl on cl.id = e.client_id
       left join mailboxes m on m.id = e.mailbox_id
      where ${VISIBLE} and ($1 = 'all' or e.status = $1) and e.direction = 'in'
        and ($2 = '' or e.subject ilike '%' || $2 || '%' or e.from_email ilike '%' || $2 || '%')
      order by e.received_at desc limit 300`, [status, (c.req.query('q') ?? '').trim()])).rows
  return c.json(rows)
}))

/** Le message entier. Un email « à trier » n'a que ses en-têtes : son texte est relu chez le fournisseur. */
async function loadMessage(c: any, id: string) {
  const m = await tx(c, async (db) => (await db.query(
    `select e.*, mb.provider, mb.secret_enc from email_messages e left join mailboxes mb on mb.id = e.mailbox_id
      where e.id = $1 and ${VISIBLE.replace(/\be\./g, 'e.')}`, [id])).rows[0])
  if (!m) throw notFound()
  if (m.body === null && m.provider_id && m.provider) {
    try {
      const f = await fetchBody({ provider: m.provider, secret_enc: m.secret_enc }, m.provider_id)
      await anon(async (db) => {
        await db.query('update email_messages set body = $2 where id = $1', [m.id, f.body.slice(0, 200_000)])
        if (f.sealed) await db.query('update mailboxes set secret_enc = $1 where id = $2', [f.sealed, m.mailbox_id])
      })
      m.body = f.body
    } catch (e: any) {
      console.error('[boîtes mail] relecture', e?.message)
    }
  }
  delete m.secret_enc
  return m
}

app.get('/messages/:id', async (c) => c.json(await loadMessage(c, c.req.param('id'))))

/** Ouvrir un projet à partir d'un email : le client (retrouvé ou créé), le projet, une première tâche. */
app.post('/messages/:id/project', async (c) => {
  const b = await body(c, z.object({
    name: z.string().trim().min(1).max(200).optional(), client_id: uuid.nullish(), template_id: uuid.nullish(),
    client_name: z.string().trim().max(200).optional(), member_ids: z.array(uuid).max(50).optional(),
    first_task: z.boolean().default(true), status: z.enum(['lead', 'planned', 'active']).default('lead'),
  }))
  const m = await loadMessage(c, c.req.param('id'))
  const id = await tx(c, async (db, ctx) => {
    let clientId = b.client_id ?? m.client_id ?? null
    if (!clientId) {
      clientId = (await db.query(
        `select c.id from clients c left join client_contacts cc on cc.client_id = c.id
          where c.archived_at is null and (lower(c.email) = $1 or lower(cc.email) = $1) limit 1`, [m.from_email])).rows[0]?.id ?? null
    }
    if (!clientId && m.from_email) {
      const domain = m.from_email.split('@')[1] ?? ''
      const generic = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|gmx|bluewin|sunrise|orange|free|wanadoo|proton|protonmail)\./i.test(domain)
      const name = b.client_name || (!generic && domain ? domain.split('.')[0].replace(/^\w/, (x: string) => x.toUpperCase()) : m.from_name || m.from_email)
      const cl = (await db.query(
        `insert into clients (account_id, kind, name, contact_person, email) values ($1,$2,$3,$4,$5) returning id`,
        [ctx.accountId, generic ? 'person' : 'company', name, m.from_name, m.from_email])).rows[0]
      if (!generic) await db.query('insert into client_contacts (account_id, client_id, name, email) values ($1,$2,$3,$4)',
        [ctx.accountId, cl.id, m.from_name ?? '', m.from_email])
      clientId = cl.id
    }
    const pid = await createProject(db, ctx, {
      name: (b.name || m.subject || `Demande de ${m.from_name || m.from_email}`).slice(0, 200),
      description: m.body ? `Demande reçue par email le ${new Date(m.received_at).toLocaleDateString('fr-CH')} de ${m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email} :\n\n${m.body.slice(0, 15000)}` : '',
      client_id: clientId, template_id: b.template_id ?? null, member_ids: b.member_ids, status: b.status,
      source: 'email', source_ref: m.message_id,
    })
    await db.query(`update email_messages set status = 'linked', project_id = $2, client_id = $3 where id = $1`, [m.id, pid, clientId])
    if (b.first_task) {
      await db.query(
        `insert into tasks (account_id, project_id, column_id, number, title, description, due_date, created_by, source_email_id, position, priority)
         values ($1,$2,(select id from board_columns where project_id = $2 order by position limit 1),
                 (select coalesce(max(number),0)+1 from tasks where project_id = $2),$3,$4,current_date + 1,$5,$6,0,'high')`,
        [ctx.accountId, pid, `Répondre à ${m.from_name || m.from_email}`, `Objet : ${m.subject}`, ctx.userId, m.id])
      await db.query('insert into task_assignees (task_id, user_id, account_id) select id, $2, $3 from tasks where project_id = $1 and source_email_id = $4',
        [pid, ctx.userId, ctx.accountId, m.id])
    }
    await logActivity(db, ctx, pid, 'email_in', { subject: m.subject, from: m.from_email })
    return pid
  })
  return c.json({ id }, 201)
})

/** Rattacher l'email à un projet existant, éventuellement en tâche. */
app.post('/messages/:id/link', async (c) => {
  const b = await body(c, z.object({ project_id: uuid, as_task: z.boolean().default(false) }))
  const m = await loadMessage(c, c.req.param('id'))
  const taskId = await tx(c, async (db, ctx) => {
    const p = (await db.query('select id, client_id from projects where id = $1', [b.project_id])).rows[0]
    if (!p) throw notFound()
    await db.query(`update email_messages set status = 'linked', project_id = $2, client_id = coalesce(client_id, $3) where id = $1`, [m.id, p.id, p.client_id])
    await logActivity(db, ctx, p.id, 'email_in', { subject: m.subject, from: m.from_email })
    if (!b.as_task) return null
    const t = (await db.query(
      `insert into tasks (account_id, project_id, column_id, number, title, description, created_by, source_email_id, position)
       values ($1,$2,(select id from board_columns where project_id = $2 order by position limit 1),
               (select coalesce(max(number),0)+1 from tasks where project_id = $2),$3,$4,$5,$6,
               (select coalesce(max(position),0)+1 from tasks where project_id = $2)) returning id`,
      [ctx.accountId, p.id, (m.subject || 'Email').slice(0, 500), `De : ${m.from_email}\n\n${(m.body ?? '').slice(0, 20000)}`, ctx.userId, m.id])).rows[0]
    await db.query('insert into task_assignees (task_id, user_id, account_id) values ($1,$2,$3)', [t.id, ctx.userId, ctx.accountId])
    return t.id
  })
  return c.json({ ok: true, task_id: taskId })
})

app.post('/messages/:id/status', async (c) => {
  const b = await body(c, z.object({ status: z.enum(['new', 'ignored']) }))
  await tx(c, (db) => db.query(`update email_messages e set status = $2, project_id = case when $2 = 'new' then null else project_id end
                                where id = $1 and ${VISIBLE}`, [c.req.param('id'), b.status]))
  return c.json({ ok: true })
})

app.post('/messages/:id/reply', async (c) => {
  const b = await body(c, z.object({ body: z.string().min(1).max(50000), cc: z.array(email).max(10).default([]) }))
  const m = await loadMessage(c, c.req.param('id'))
  const ctx = c.get('ctx')
  const subject = /^re\s*:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`
  const quoted = m.body ? `\n\n---\n${m.from_name ?? m.from_email} a écrit :\n${m.body.slice(0, 5000).split('\n').map((l: string) => '> ' + l).join('\n')}` : ''
  const r = await sendMail({ accountId: ctx.accountId, to: [m.from_email, ...b.cc], subject, text: b.body + quoted, fromUserId: ctx.userId, fromName: c.get('name') })
  await tx(c, (db) => db.query(
    `insert into email_messages (account_id, mailbox_id, message_id, direction, from_email, to_emails, subject, body, status, project_id, client_id)
     values ($1,$2,$3,'out',$4,$5,$6,$7,$8,$9,$10)`,
    [ctx.accountId, m.mailbox_id, newMessageId(c.get('email')), c.get('email'), [m.from_email, ...b.cc], subject, b.body,
     m.project_id ? 'linked' : 'new', m.project_id, m.client_id]))
  return c.json({ ok: true, via: r.via })
})

export default app

// ------------------------------------------------------------------ adresse de capture

/**
 * `POST /api/inbound/<jeton>` : un email transféré (par un relais de messagerie, un script, un
 * fournisseur d'email entrant). JSON déjà analysé `{ from, to, subject, text, html, message_id }`,
 * ou le message brut (`message/rfc822`). Le jeton est l'adresse de capture de l'entreprise.
 */
export const publicMail = new Hono()
publicMail.post('/:token', async (c) => {
  const acc = await anon(async (db) => (await db.query('select id from accounts where inbound_token = $1', [c.req.param('token')])).rows[0])
  if (!acc) return c.json({ error: 'not_found' }, 404)
  let msg: { from: string; fromName: string | null; to: string[]; subject: string; body: string; messageId: string }
  const type = c.req.header('content-type') ?? ''
  if (/message\/rfc822|text\/plain/.test(type)) {
    const raw = Buffer.from(await c.req.arrayBuffer())
    if (raw.length > 10 * 1024 * 1024) return c.json({ error: 'too_large' }, 413)
    const p = await simpleParser(raw)
    const fromText = (p.from as any)?.text ?? ''
    msg = { from: addresses(fromText)[0] ?? '', fromName: displayName(fromText), to: addresses((p.to as any)?.text ?? ''),
            subject: p.subject ?? '', body: readable(p.text, p.html || null), messageId: String(p.messageId ?? '') }
  } else {
    const j = await c.req.json().catch(() => null) as any
    if (!j?.from) return c.json({ error: 'invalid_input' }, 400)
    msg = { from: addresses(j.from)[0] ?? '', fromName: j.from_name ?? displayName(String(j.from)), to: addresses(j.to ?? []),
            subject: String(j.subject ?? ''), body: readable(j.text, j.html), messageId: String(j.message_id ?? '') }
  }
  if (!msg.from) return c.json({ error: 'from_required' }, 400)
  msg.messageId ||= `inbound:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const r = await ingest({ id: null, account_id: acc.id, email: '' }, {
    messageId: msg.messageId, providerId: null,
    from: msg.from, to: msg.to, subject: msg.subject, body: msg.body, date: new Date(),
  })
  if (msg.fromName) await anon((db) => db.query('update email_messages set from_name = $3 where account_id = $1 and message_id = $2 and from_name is null',
    [acc.id, msg.messageId, msg.fromName]))
  return c.json({ ok: true, status: r }, r === 'dup' ? 200 : 201)
})
