import { simpleParser } from 'mailparser'
import { anon } from '../../db.js'
import * as google from './google.js'
import * as imap from './imap.js'
import * as microsoft from './microsoft.js'
import { mailboxSecretConfigured, open, seal } from './secret.js'
import { readable, type FoundMessage, type Outgoing, type SendOutcome, type SyncContext } from './types.js'

/**
 * Les boîtes mail connectées, côté ProjectLead. Les trois fournisseurs (Gmail, Microsoft 365,
 * IMAP/SMTP) sont repris tels quels de CRMlead ; seul ce fichier décide de ce qu'on garde.
 *
 * - Un email échangé avec un client connu (adresse d'un client ou d'un de ses contacts) est
 *   enregistré en entier et rattaché au projet en cours de ce client.
 * - Un email d'un expéditeur inconnu, écrit par une personne (pas une lettre d'information),
 *   arrive dans la boîte de réception « À trier » : il peut ouvrir un nouveau projet.
 */

export type MailboxProvider = 'google' | 'microsoft' | 'imap'

export type MailboxRow = {
  id: string; account_id: string; user_id: string; provider: MailboxProvider
  email: string; secret_enc: string; sync_state: any
}

const ACTIONABLE = new Set(['reconnect_required', 'imap_auth_failed', 'smtp_auth_failed',
  'imap_unreachable', 'smtp_unreachable', 'host_not_allowed', 'port_not_allowed', 'rate_limited'])

function errorCode(e: any): string {
  const msg = String(e?.message ?? e)
  if (ACTIONABLE.has(msg)) return msg
  if (e?.authenticationFailed) return 'imap_auth_failed'
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|timeout/i.test(msg)) return 'unreachable'
  return msg.slice(0, 300)
}

/** Toutes les adresses de clients actifs du compte. */
const CONTACTS_SQL = `
  select distinct lower(e) as a from (
    select c.email as e from clients c where c.account_id = $1 and c.archived_at is null and c.email is not null
    union all
    select cc.email from client_contacts cc join clients c on c.id = cc.client_id
     where cc.account_id = $1 and c.archived_at is null and cc.email is not null) x
   where e <> ''`

export function context(row: MailboxRow): SyncContext {
  return {
    email: row.email,
    triageKnown: async (ids) => new Set(await anon(async (db) => (await db.query(
      'select provider_id from email_messages where account_id = $1 and mailbox_id = $2 and provider_id = any($3)',
      [row.account_id, row.id, ids])).rows.map((r) => r.provider_id))),
    offer: async (m) => anon(async (db) => {
      const r = await db.query(
        `insert into email_messages (account_id, mailbox_id, message_id, provider_id, direction, from_email, from_name,
                                     to_emails, subject, received_at, status)
         values ($1,$2,$3,$4,'in',$5,$6,array[$7],$8,$9,'new') on conflict (account_id, message_id) do nothing`,
        [row.account_id, row.id, `triage:${row.id}:${m.messageId}`, m.messageId, m.from.toLowerCase(), m.name,
         row.email, m.subject.slice(0, 500), m.date.toISOString()])
      return (r.rowCount ?? 0) > 0
    }),
    contacts: async () => anon(async (db) => (await db.query(CONTACTS_SQL, [row.account_id])).rows.map((r) => r.a)),
    known: async (list) => {
      const all = new Set(await anon(async (db) => (await db.query(CONTACTS_SQL, [row.account_id])).rows.map((r) => r.a)))
      return new Set(list.filter((a) => all.has(a.toLowerCase())))
    },
    seen: async (ids) => new Set(await anon(async (db) => (await db.query(
      'select message_id from email_messages where account_id = $1 and message_id = any($2)',
      [row.account_id, ids])).rows.map((r) => r.message_id))),
    ingest: async (m: FoundMessage) => ingest(row, m),
  }
}

/** Enregistre un message échangé avec un client connu, et le rattache à son projet en cours. */
export async function ingest(row: { id: string | null; account_id: string; email: string }, m: FoundMessage) {
  const out = m.from.toLowerCase() === row.email.toLowerCase()
  const counterpart = out ? m.to.filter((a) => a.toLowerCase() !== row.email.toLowerCase()) : [m.from.toLowerCase()]
  return anon(async (db) => {
    const client = (await db.query(
      `select c.id from clients c left join client_contacts cc on cc.client_id = c.id
        where c.account_id = $1 and c.archived_at is null
          and (lower(c.email) = any($2) or lower(cc.email) = any($2))
        limit 1`, [row.account_id, counterpart])).rows[0]
    const project = client ? (await db.query(
      `select id from projects where account_id = $1 and client_id = $2 and archived_at is null and not is_template
          and status in ('lead','planned','active','on_hold')
        order by (status = 'active') desc, updated_at desc limit 1`, [row.account_id, client.id])).rows[0] : null
    const r = await db.query(
      `insert into email_messages (account_id, mailbox_id, message_id, provider_id, direction, from_email, to_emails,
                                   subject, body, received_at, status, project_id, client_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (account_id, message_id) do nothing`,
      [row.account_id, row.id, m.messageId || `noid:${Date.now()}:${Math.random()}`, m.providerId, out ? 'out' : 'in',
       m.from.toLowerCase(), m.to, m.subject.slice(0, 500), m.body.slice(0, 200_000), m.date.toISOString(),
       project ? 'linked' : 'new', project?.id ?? null, client?.id ?? null])
    if (!r.rowCount) return 'dup'
    if (project) {
      await db.query(
        `insert into activities (account_id, project_id, kind, data) values ($1,$2,$3,$4)`,
        [row.account_id, project.id, out ? 'email_out' : 'email_in', JSON.stringify({ subject: m.subject, from: m.from })])
    }
    return out ? 'out' : 'in'
  })
}

/** Synchronise une boîte. Ne lève jamais : l'échec est inscrit sur la boîte. */
export async function syncOne(row: MailboxRow): Promise<{ imported: number; error: string | null }> {
  const done = (state: any, secret: string | null, error: string | null) => anon((db) => db.query(
    `update mailboxes set sync_state = coalesce($2, sync_state), secret_enc = coalesce($3, secret_enc),
            sync_error = $4, last_synced_at = now(), sync_requested_at = null where id = $1`,
    [row.id, state ? JSON.stringify(state) : null, secret, error]))
  let secret: any
  try {
    secret = open(row.secret_enc)
  } catch {
    await done(null, null, 'reconnect_required')
    return { imported: 0, error: 'reconnect_required' }
  }
  try {
    const ctx = context(row)
    const r = row.provider === 'google' ? await google.sync(secret, row.sync_state, ctx)
      : row.provider === 'microsoft' ? await microsoft.sync(secret, row.sync_state, ctx)
      : await imap.sync(secret, row.sync_state, ctx)
    let current = r.secret ?? secret
    let triageSince = row.sync_state?.triage_since
    if (row.provider !== 'microsoft') {
      try {
        const tr = row.provider === 'google' ? await google.triage(current, row.sync_state, ctx)
          : await imap.triage(current, row.sync_state, ctx)
        if ((tr as any).secret) current = (tr as any).secret
        triageSince = tr.since
      } catch (e: any) {
        if (e?.message !== 'rate_limited') console.error('[boîtes mail] à trier', row.provider, e?.message)
      }
    }
    await done({ ...r.state, ...(triageSince ? { triage_since: triageSince } : {}) },
      current !== secret ? seal(current) : null, null)
    return { imported: r.imported, error: null }
  } catch (e: any) {
    const code = errorCode(e)
    await done(null, null, code)
    return { imported: 0, error: code }
  }
}

/** Les boîtes à relire : jamais relues, demandées, ou relues il y a plus de cinq minutes. */
export async function mailboxesOnce(limit = 5, force: string | null = null) {
  if (!mailboxSecretConfigured()) return []
  const due = await anon(async (db) => (await db.query(
    `select id, account_id, user_id, provider, email, secret_enc, sync_state from mailboxes
      where ($2::uuid is null or id = $2)
        and ($2::uuid is not null or last_synced_at is null or sync_requested_at is not null
             or last_synced_at < now() - interval '5 minutes')
        and sync_error is distinct from 'reconnect_required'
      order by sync_requested_at nulls last, last_synced_at nulls first limit $1`, [limit, force])).rows as MailboxRow[])
  const out = []
  for (const row of due) out.push({ id: row.id, ...(await syncOne(row)) })
  return out
}

export async function sendVia(mb: { provider: MailboxProvider; secret_enc: string }, out: Outgoing)
  : Promise<SendOutcome & { sealed?: string }> {
  let secret: any
  try {
    secret = open(mb.secret_enc)
  } catch {
    return { ok: false, error: 'reconnect_required' }
  }
  const r = mb.provider === 'google' ? await google.send(secret, out)
    : mb.provider === 'microsoft' ? await microsoft.send(secret, out)
    : await imap.send(secret, out)
  return r.secret ? { ...r, sealed: seal(r.secret) } : r
}

/** Le texte complet d'un message proposé « À trier » (seuls ses en-têtes étaient gardés). */
export async function fetchBody(mb: { provider: MailboxProvider; secret_enc: string }, providerId: string) {
  const secret = open(mb.secret_enc)
  const r = mb.provider === 'google' ? await google.fetchRaw(secret, providerId)
    : mb.provider === 'microsoft' ? await microsoft.fetchRaw(secret, providerId)
    : await imap.fetchRaw(secret, providerId)
  const parsed = await simpleParser(r.raw)
  return {
    body: readable(parsed.text, parsed.html || null),
    messageId: String(parsed.messageId ?? '').trim() || null,
    sealed: (r as any).secret ? seal((r as any).secret) : undefined,
  }
}
