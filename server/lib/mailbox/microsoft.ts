import { api, freshTokens, type Tokens } from './oauth.js'
import { simpleParser } from 'mailparser'
import { addresses, attachmentsOf, HISTORY_PER_ADDRESS, readable, worthFetching, type AttachmentInfo,
         type BackfillResult, type Outgoing, type SendOutcome, type SyncContext,
         type SyncResult } from './types.js'

/**
 * Microsoft 365 et Outlook.com, par Microsoft Graph. L'IMAP de Microsoft n'accepte
 * plus de mot de passe depuis 2024 : OAuth est la seule porte, et Graph la plus
 * simple des deux qui restent.
 */

const BASE = () => (process.env.GRAPH_API_URL || 'https://graph.microsoft.com/v1.0').replace(/\/$/, '')

const PAGE = 50
const PAGES = 4

export async function profileEmail(t: Tokens): Promise<string> {
  const me = await api(`${BASE()}/me?$select=mail,userPrincipalName`, t.access_token)
  return String(me.mail || me.userPrincipalName || '').toLowerCase()
}

const SELECT = 'id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments'

/** Le MIME d'origine : Graph ne rend les pièces jointes qu'à part, et pas dans le même ordre. */
async function mime(token: string, id: string): Promise<Buffer> {
  const res = await fetch(`${BASE()}/me/messages/${encodeURIComponent(id)}/$value`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000),
  })
  if (res.status === 401) throw new Error('reconnect_required')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Enregistre ceux d'une page de résultats qui concernent un contact connu. */
async function importPage(token: string, value: any[], ctx: SyncContext): Promise<number> {
  const batch = value.map((m: any) => ({
    raw: m,
    messageId: String(m.internetMessageId ?? '').trim(),
    from: addresses(m.from?.emailAddress?.address)[0] ?? '',
    to: addresses([...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])]
      .map((x: any) => x.emailAddress?.address ?? '')),
  }))
  let imported = 0
  for (const m of await worthFetching(ctx, batch)) {
    let attachments: AttachmentInfo[] = []
    if (m.raw.hasAttachments) {
      try { attachments = attachmentsOf(await simpleParser(await mime(token, m.raw.id))).map((a) => a.info) }
      catch { /* l'email compte plus que la liste de ses pièces jointes */ }
    }
    const result = await ctx.ingest({
      messageId: m.messageId, providerId: m.raw.id, from: m.from, to: m.to,
      subject: m.raw.subject ?? '',
      body: m.raw.body?.contentType === 'html' ? readable(null, m.raw.body?.content) : readable(m.raw.body?.content, null),
      date: new Date(m.raw.receivedDateTime), attachments,
    })
    if (result === 'in' || result === 'out') imported++
  }
  return imported
}

export async function sync(tokens: Tokens, state: any, ctx: SyncContext): Promise<SyncResult> {
  const { tokens: t, changed } = await freshTokens('microsoft', tokens)
  const started = Date.now()
  const since = new Date(state?.since ?? Date.now() - 30 * 86400e3).toISOString()

  // Graph exige que la propriété de tri figure en tête du filtre.
  let url: string | null = `${BASE()}/me/messages?` + new URLSearchParams({
    $filter: `receivedDateTime ge ${since} and isDraft eq false`,
    $orderby: 'receivedDateTime asc',
    $top: String(PAGE),
    $select: SELECT,
  })

  let imported = 0
  let last: string | null = null
  let pages = 0
  while (url && pages < PAGES) {
    const r: any = await api(url, t.access_token, { headers: { Prefer: 'outlook.body-content-type="text"' } })
    pages++
    imported += await importPage(t.access_token, r.value ?? [], ctx)
    if ((r.value ?? []).length) last = r.value[r.value.length - 1].receivedDateTime
    url = r['@odata.nextLink'] ?? null
  }

  // Encore des pages : on reprend au dernier vu. Sinon, d'un peu avant ce passage.
  const next = url && last ? last : new Date(started - 10 * 60_000).toISOString()
  return { state: { since: next }, secret: changed ? t : undefined, imported }
}

/** L'historique de quelques contacts : Graph cherche par correspondant dans toute la boîte. */
export async function backfill(tokens: Tokens, list: string[], ctx: SyncContext): Promise<BackfillResult> {
  const { tokens: t, changed } = await freshTokens('microsoft', tokens)
  let imported = 0
  for (const a of list) {
    const r: any = await api(`${BASE()}/me/messages?` + new URLSearchParams({
      $search: `"participants:${a}"`, $top: String(HISTORY_PER_ADDRESS), $select: SELECT,
    }), t.access_token, { headers: { Prefer: 'outlook.body-content-type="text"' } })
    imported += await importPage(t.access_token, (r.value ?? []).filter((m: any) => !m.isDraft), ctx)
  }
  return { imported, secret: changed ? t : undefined }
}

/** Le message entier, pour en relire une pièce jointe. */
export async function fetchRaw(tokens: Tokens, providerId: string): Promise<{ raw: Buffer; secret?: Tokens }> {
  const { tokens: t, changed } = await freshTokens('microsoft', tokens)
  return { raw: await mime(t.access_token, providerId), secret: changed ? t : undefined }
}

/**
 * L'envoi passe par un brouillon créé dans la boîte, puis envoyé : c'est la seule
 * façon d'obtenir l'identifiant du message avant qu'il parte, et donc de ne pas
 * l'enregistrer une seconde fois quand la synchronisation le retrouve dans les
 * éléments envoyés. Quand on répond à un email de la même boîte, le brouillon est
 * une vraie réponse, et le message reste dans le fil du client.
 */
export async function send(tokens: Tokens, out: Outgoing): Promise<SendOutcome> {
  let secret: Tokens | undefined
  try {
    const { tokens: t, changed } = await freshTokens('microsoft', tokens)
    if (changed) secret = t
    const recipients = out.to.map((address) => ({ emailAddress: { address } }))
    const draft = out.inReplyToProviderId
      ? await api(`${BASE()}/me/messages/${encodeURIComponent(out.inReplyToProviderId)}/createReply`,
          t.access_token, { method: 'POST', json: {} })
      : await api(`${BASE()}/me/messages`, t.access_token, {
          method: 'POST',
          json: { subject: out.subject, body: { contentType: 'Text', content: out.body }, toRecipients: recipients },
        })
    if (out.inReplyToProviderId) {
      await api(`${BASE()}/me/messages/${encodeURIComponent(draft.id)}`, t.access_token, {
        method: 'PATCH',
        json: { subject: out.subject, body: { contentType: 'Text', content: out.body }, toRecipients: recipients },
      })
    }
    for (const a of out.attachments ?? []) {
      await api(`${BASE()}/me/messages/${encodeURIComponent(draft.id)}/attachments`, t.access_token, {
        method: 'POST',
        json: { '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename, contentType: a.contentType,
                contentBytes: a.content.toString('base64') },
      })
    }
    await api(`${BASE()}/me/messages/${encodeURIComponent(draft.id)}/send`, t.access_token, { method: 'POST' })
    return { ok: true, providerId: draft.id ?? null, messageId: draft.internetMessageId ?? null, secret }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e), secret }
  }
}
