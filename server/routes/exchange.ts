import { Hono } from 'hono'
import { anonTx } from '../db.js'
import { createDefaultColumns } from '../lib/defaults.js'
import { appUrl, checkEnvelope, incomingExchange, orgSenders, parseEnvelope, sameOrigin, type IncomingExchange } from '../lib/leadId.js'
import { planOf } from '../lib/plans.js'
import { receiveClient } from './exchangeClient.js'
import { tr } from '../lib/i18n.js'
import { userLocale } from '../lib/locales.js'

/**
 * L'échange de la famille Lead (crmlead/docs/LEAD-ID.md, étape 9 ; liaison sans clé du 26.10.2026). ProjectLead reçoit,
 * de CRMlead seulement :
 * - `deal` : un lead gagné dans CRMlead, qui devient un projet (et son client) ;
 * - `client` : l'adresse et les contacts à jour d'un client déjà repris de CRMlead (routes/exchangeClient.ts).
 * Un même objet source donne toujours le même projet : un renvoi met à jour, sans doublon.
 * Jeton d'échange d'ERPlead seulement (lib/leadId.ts incomingExchange), lié à l'organisation de l'enveloppe ; un ancien
 * jeton sans org reste accepté tant que l'expéditeur n'est pas dans EXCHANGE_ORG_SENDERS (défaut : aucun).
 */
const ALLOWED: Record<string, string[]> = { deal: ['crmlead'], client: ['crmlead'] }
const app = new Hono()
const base = () => (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')

app.get('/.well-known/lead-app.json', (c) => c.json({
  app: 'projectlead', name: 'ProjectLead',
  exchange: { version: 1, inbox: `${base()}/api/lead-exchange/v1/inbox`, accepts: Object.keys(ALLOWED), sends: ['invoice'],
              read: `${base()}/api/lead-exchange/v1/read`, reads: ['known_contacts'] },
}))

/**
 * Contacts connus pour VisitLead (04.11.2026, contrat ~/projets/.unlazy/visitlead/SUITE-protocol.md §2) : les clients
 * qui ont une adresse e-mail et leurs contacts, au niveau de l'entreprise (jeton exchange_read d'ERPlead, VisitLead
 * seulement, organisation obligatoire, personne facultative et ignorée), champs minimaux. Clients archivés exclus.
 * Pas de date de modification ici : ordre (created_at, id) croissant, curseur opaque ; `count=1` : le nombre seul.
 */
const KNOWN_READERS = ['visitlead']
const KNOWN_LIMIT = 500
const knownHits = new Map<string, number[]>()
function knownBudget(org: string, now = Date.now()) {
  const recent = (knownHits.get(org) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= 120) { knownHits.set(org, recent); return false }
  recent.push(now); knownHits.set(org, recent)
  if (knownHits.size > 5000) knownHits.clear()
  return true
}
const EMAIL_SQL = `'^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`
const KNOWN_SQL = `
  select 'client:' || c.id::text as id, 'client' as kind, lower(trim(c.email)) as email,
         case when c.kind = 'company' then nullif(trim(c.contact_person), '') else nullif(trim(c.name), '') end as name,
         case when c.kind = 'company' then nullif(trim(c.name), '') end as company, null::text as title,
         date_trunc('milliseconds', c.created_at) as at
    from clients c
   where c.account_id = $1 and c.archived_at is null and c.email is not null and trim(c.email) ~ ${EMAIL_SQL}
  union all
  select 'contact:' || k.id::text, 'contact', lower(trim(k.email)), nullif(trim(k.name), ''), nullif(trim(c.name), ''),
         nullif(trim(k.job_title), ''), date_trunc('milliseconds', k.created_at)
    from client_contacts k join clients c on c.id = k.client_id and c.archived_at is null
   where k.account_id = $1 and k.email is not null and trim(k.email) ~ ${EMAIL_SQL}`

app.get('/api/lead-exchange/v1/read', async (c) => {
  let tok: IncomingExchange | null = null
  try { tok = await incomingExchange(c.req.header('authorization'), 'exchange_read') } catch { tok = null }
  if (!tok) return c.json({ error: 'invalid_token' }, 401)
  const type = c.req.query('type') ?? ''
  if (type !== 'known_contacts') return c.json({ error: 'unsupported_type', reads: ['known_contacts'] }, 422)
  if (!KNOWN_READERS.includes(tok.app)) return c.json({ error: 'sender_not_allowed' }, 403)
  if (!tok.org) return c.json({ error: 'org_required' }, 401)
  let cursor: { u: string; i: string } | null = null
  const rawCursor = c.req.query('cursor')
  if (rawCursor) {
    try {
      const x = JSON.parse(Buffer.from(rawCursor, 'base64url').toString())
      if (typeof x?.u !== 'string' || Number.isNaN(Date.parse(x.u)) || typeof x?.i !== 'string') throw new Error('cursor')
      cursor = { u: new Date(x.u).toISOString(), i: x.i.slice(0, 200) }
    } catch { return c.json({ error: 'invalid_cursor' }, 400) }
  }
  const org = tok.org
  const out = await anonTx(async (db) => {
    const acc = (await db.query('select id from accounts where lead_org = $1', [org])).rows[0]
    if (!acc) return { status: 404 as const, body: { error: 'unknown_org' } }
    if (!knownBudget(acc.id)) return { status: 429 as const, body: { error: 'too_many_requests' } }
    await db.query(`select set_config('app.account_id', $1, true), set_config('app.role', 'admin', true)`, [acc.id])
    if (c.req.query('count') === '1') {
      const n = (await db.query(`select count(distinct email)::int as n from (${KNOWN_SQL}) x`, [acc.id])).rows[0]?.n ?? 0
      return { status: 200 as const, body: { count: n } }
    }
    const limit = Math.max(1, Math.min(KNOWN_LIMIT, Number(c.req.query('limit')) || KNOWN_LIMIT))
    const rows = (await db.query(
      `select * from (${KNOWN_SQL}) x where ($2::timestamptz is null or (x.at, x.id) > ($2::timestamptz, $3::text))
        order by x.at, x.id limit $4`, [acc.id, cursor?.u ?? null, cursor?.i ?? '', limit + 1])).rows
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return { status: 200 as const, body: {
      data: page.map((r: any) => ({ id: r.id, kind: r.kind, email: r.email, name: r.name ?? null, company: r.company ?? null,
                                    title: r.title ?? null, updated_at: new Date(r.at).toISOString() })),
      next: rows.length > limit && last ? Buffer.from(JSON.stringify({ u: new Date(last.at).toISOString(), i: last.id })).toString('base64url') : null,
    } }
  })
  return c.json(out.body, out.status)
})

app.post('/api/lead-exchange/v1/inbox', async (c) => {
  let tok: IncomingExchange | null = null
  try { tok = await incomingExchange(c.req.header('authorization'), 'exchange') } catch { tok = null }
  if (!tok) return c.json({ error: 'invalid_token' }, 401)
  const raw = await c.req.text().catch(() => '')
  let parsed: unknown = null
  try { parsed = raw.length <= 512_000 ? JSON.parse(raw) : null } catch { parsed = null }
  const e = parseEnvelope(parsed) as any
  if (!e) return c.json({ error: 'invalid_envelope' }, 400)
  const refused = checkEnvelope(tok, e, ALLOWED, orgSenders(''))
  if (refused) return c.json({ error: refused.error, ...(refused.error === 'unsupported_type' ? { accepts: Object.keys(ALLOWED) } : {}) }, refused.status)
  const from = tok.app
  // La personne du jeton (vérifiée par ERPlead, de cette organisation) passe avant celle annoncée dans l'enveloppe.
  if (tok.person) e.sub = tok.person
  // Une URL venue de CRMlead n'est gardée que si elle est chez CRMlead (lien de l'activité « depuis CRMlead »).
  if (e.source.url && !sameOrigin(e.source.url, appUrl(from))) delete e.source.url
  if (e.type === 'client') return receiveClient(c, from, e)
  const d = e.data ?? {}

  const out = await anonTx(async (db) => {
    const acc = (await db.query('select id, currency, locale from accounts where lead_org = $1', [e.org])).rows[0]
    if (!acc) return { status: 404 as const }
    const owner = e.sub ? (await db.query(
      // i18n-ok
      `select u.id from users u join account_users au on au.user_id = u.id and au.account_id = $2 where u.lead_sub = $1`, [e.sub, acc.id])).rows[0]?.id : null
    const fallbackOwner = owner ?? (await db.query(`select user_id from account_users where account_id = $1 and role = 'admin' and active order by joined_at limit 1`, [acc.id])).rows[0]?.user_id
    const link = (await db.query('select project_id, client_id from exchange_links where account_id = $1 and app = $2 and type = $3 and source_id = $4',
      [acc.id, from, e.type, String(e.source.id)])).rows[0]

    // Le client : celui du lien, sinon retrouvé par l'email d'un contact ou le nom, sinon créé.
    const contacts: any[] = Array.isArray(d.contacts) ? d.contacts : d.email ? [d] : []
    const primary = contacts.find((x) => x.is_primary) ?? contacts[0]
    const person = primary ? [primary.first_name, primary.last_name].filter(Boolean).join(' ') : null
    const clientName = String(d.company || person || d.title || tr(acc.locale, 'exchange.client')).slice(0, 200)
    let clientId = link?.client_id ?? null
    if (!clientId && primary?.email) clientId = (await db.query('select id from clients where account_id = $1 and lower(email) = lower($2) limit 1', [acc.id, primary.email])).rows[0]?.id ?? null
    if (!clientId) clientId = (await db.query('select id from clients where account_id = $1 and lower(name) = lower($2) and archived_at is null limit 1', [acc.id, clientName])).rows[0]?.id ?? null
    if (!clientId) {
      clientId = (await db.query(
        `insert into clients (account_id, kind, name, contact_person, email, phone, external_ref) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (account_id, external_ref) where external_ref is not null do update set name = excluded.name returning id`,
        [acc.id, d.company ? 'company' : 'person', clientName, person, primary?.email ?? null, primary?.phone ?? null, `${from}:${e.source.id}`])).rows[0].id
    }
    for (const ct of contacts) {
      if (!ct.email) continue
      const nm = [ct.first_name, ct.last_name].filter(Boolean).join(' ')
      const has = (await db.query('select 1 from client_contacts where client_id = $1 and lower(email) = lower($2)', [clientId, ct.email])).rowCount
      if (!has) await db.query('insert into client_contacts (account_id, client_id, name, email, phone, job_title) values ($1,$2,$3,$4,$5,$6)',
        [acc.id, clientId, nm, ct.email, ct.phone ?? null, ct.job_title ?? null])
    }

    let projectId: string | null = link?.project_id ?? null
    let status: 'created' | 'updated' = link ? 'updated' : 'created'
    if (e.type === 'deal') {
      const amount = Number.isInteger(d.amount) && d.amount >= 0 ? d.amount : null
      const currency = ['CHF', 'EUR', 'USD', 'GBP'].includes(d.currency) ? d.currency : null
      const live = projectId ? (await db.query('select billing_mode from projects where id = $1', [projectId])).rows[0] : null
      if (live) {
        // L'affaire a changé dans CRMlead (devis accepté, montant ou devise corrigés) : budget, forfait et devise
        // suivent (26.10.2026). La devise ne change plus une fois le projet facturé une première fois.
        const billed = (await db.query(`select 1 from invoice_runs where project_id = $1 and status = 'created' limit 1`, [projectId])).rowCount ?? 0
        await db.query(
          `update projects set name = coalesce($2, name), description = case when description = '' then coalesce($3, '') else description end,
                  budget_cents = coalesce($4, budget_cents),
                  fixed_cents = case when billing_mode = 'fixed' then coalesce($4, fixed_cents) else fixed_cents end,
                  currency = case when $6 then currency else coalesce($5, currency) end, updated_at = now() where id = $1`,
          [projectId, d.title ? String(d.title).slice(0, 200) : null, d.description ?? null, amount, currency, billed > 0])
      } else if (link && d.update === true) {
        // Un changement d'une affaire dont le projet a été supprimé ici : on ne le recrée pas.
        status = 'updated'
      } else {
        // Formule pleine (lib/plans.ts) : l'affaire n'est pas perdue, elle arrive « à qualifier », et on le dit.
        const p = await planOf(db, acc.id, true)
        const planFull = p.projectLimit !== null && p.openProjects >= p.projectLimit
        const projectStatus = planFull ? 'lead' : 'planned'
        projectId = (await db.query(
          `insert into projects (account_id, name, description, client_id, owner_id, status, source, source_ref, budget_cents,
                                 fixed_cents, billing_mode, currency, created_by)
           values ($1,$2,$3,$4,$5,$10,'crmlead',$6,$7,$7,$8,$9,$5) returning id`,
          [acc.id, String(d.title || tr(acc.locale, 'exchange.project', { name: clientName })).slice(0, 200), d.description ?? '', clientId, fallbackOwner,
           `${from}:${e.source.id}`, amount, amount ? 'fixed' : 'hourly', currency ?? acc.currency ?? 'CHF', projectStatus])).rows[0].id
        await createDefaultColumns(db, acc.id, projectId!)
        if (fallbackOwner) {
          await db.query(`insert into project_members (project_id, user_id, account_id, role) values ($1,$2,$3,'lead') on conflict do nothing`, [projectId, fallbackOwner, acc.id])
          await db.query(`insert into notifications (account_id, user_id, kind, title, link) values ($1,$2,'deal',$3,$4)`,
            [acc.id, fallbackOwner, await (async () => {
              // Dans la langue du responsable.
              const l = await userLocale(db, fallbackOwner)
              return tr(l, 'notif.dealWon', { title: d.title ?? clientName })
                + (planFull ? tr(l, 'notif.dealWonFull', { plan: p.name, n: p.projectLimit }) : '')
            })(), `/projets/${projectId}`])
        }
        await db.query(`insert into activities (account_id, project_id, kind, data) values ($1,$2,'from_crmlead',$3)`,
          [acc.id, projectId, JSON.stringify({ url: e.source.url ?? null })])
        status = 'created'
      }
    }
    await db.query(
      `insert into exchange_links (account_id, app, type, source_id, project_id, client_id) values ($1,$2,$3,$4,$5,$6)
       on conflict (account_id, app, type, source_id) do update set project_id = excluded.project_id, client_id = excluded.client_id, updated_at = now()`,
      [acc.id, from, e.type, String(e.source.id), projectId, clientId])
    return { status: 200 as const, body: { id: projectId ?? clientId, url: projectId ? `${base()}/projets/${projectId}` : `${base()}/clients/${clientId}`, status } }
  })
  if (out.status === 404) return c.json({ error: 'unknown_org' }, 404)
  return c.json(out.body, out.body.status === 'created' ? 201 : 200)
})

export default app
