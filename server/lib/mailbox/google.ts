import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { simpleParser } from 'mailparser'
import { api, freshTokens, type Tokens } from './oauth.js'
import { addresses, attachmentsOf, displayName, HISTORY_PER_ADDRESS, looksAutomated, readable, TRIAGE_PER_SYNC,
         worthFetching, type BackfillResult,
         type FoundMessage, type Outgoing, type SendOutcome, type SyncContext, type SyncResult } from './types.js'

/**
 * Gmail, par l'API Gmail et non par IMAP : l'IMAP de Google exige lui aussi OAuth,
 * pour un protocole plus lent et plus fragile.
 */

const BASE = () => (process.env.GMAIL_API_URL || 'https://gmail.googleapis.com/gmail/v1').replace(/\/$/, '')

// Au plus deux cents emails examinés par passage. Le premier branchement remonte
// trente jours ; une boîte chargée les rattrape en plusieurs passages plutôt que
// d'épuiser d'un coup le quota d'appels Google du projet.
const PER_SYNC = 200

export async function profileEmail(t: Tokens): Promise<string> {
  const p = await api(`${BASE()}/users/me/profile`, t.access_token)
  return String(p.emailAddress ?? '').toLowerCase()
}

type Head = { id: string; messageId: string; from: string; to: string[]; date: Date }

async function heads(t: Tokens, ids: string[]): Promise<Head[]> {
  const out: Head[] = []
  for (const id of ids) {
    const m = await api(`${BASE()}/users/me/messages/${id}?format=metadata` +
      ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'Date'].map((h) => `&metadataHeaders=${h}`).join(''),
      t.access_token)
    await pause()
    const h = (name: string) =>
      (m.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === name.toLowerCase())?.value ?? ''
    out.push({
      id, messageId: h('Message-ID').trim(), from: addresses(h('From'))[0] ?? '',
      to: addresses([h('To'), h('Cc')]), date: new Date(Number(m.internalDate ?? Date.now())),
    })
  }
  return out
}

/** Télécharge et enregistre ceux qui concernent un contact connu et qu'on n'a pas encore. */
async function importHeads(t: Tokens, batch: Head[], ctx: SyncContext): Promise<number> {
  let imported = 0
  for (const head of await worthFetching(ctx, batch)) {
    const raw = await api(`${BASE()}/users/me/messages/${head.id}?format=raw`, t.access_token)
    await pause()
    const parsed = await simpleParser(Buffer.from(String(raw.raw), 'base64url'))
    const found: FoundMessage = {
      messageId: head.messageId, providerId: head.id, from: head.from, to: head.to,
      subject: parsed.subject ?? '', body: readable(parsed.text, parsed.html || null), date: head.date,
      attachments: attachmentsOf(parsed).map((a) => a.info),
    }
    if (['in', 'out'].includes(await ctx.ingest(found))) imported++
  }
  return imported
}

/** Gmail compte ses appels par seconde et par personne : on ne les enchaîne pas en rafale. */
const pause = () => new Promise((r) => setTimeout(r, Number(process.env.GMAIL_PAUSE_MS ?? 60)))

/** Une recherche Gmail qui ne rend que les échanges avec ces adresses. */
const withAny = (list: string[]) => `{${list.map((a) => `from:${a} to:${a} cc:${a}`).join(' ')}}`

export async function sync(tokens: Tokens, state: any, ctx: SyncContext): Promise<SyncResult> {
  const { tokens: t, changed } = await freshTokens('google', tokens)
  const started = Date.now()
  const since = new Date(state?.since ?? Date.now() - 30 * 86400e3)
  const done = { state: { since: new Date(started - 10 * 60_000).toISOString() }, secret: changed ? t : undefined }

  // On ne lit pas la boîte entière : Gmail sait chercher par correspondant, et seuls
  // les échanges avec un contact nous intéressent. Une boîte chargée coûtait sinon
  // des centaines d'appels par passage, et Google finissait par refuser.
  const contacts = (await ctx.contacts()).filter((a) => a !== ctx.email)
  if (!contacts.length) return { ...done, imported: 0 }

  const ids: string[] = []
  for (let i = 0; i < contacts.length; i += 15) {
    const q = `after:${Math.floor(since.getTime() / 1000)} ${withAny(contacts.slice(i, i + 15))} -in:chats -in:spam -in:trash`
    let pageToken = ''
    for (let page = 0; page < 5; page++) {
      const r = await api(`${BASE()}/users/me/messages?${new URLSearchParams({
        q, maxResults: '500', ...(pageToken ? { pageToken } : {}) })}`, t.access_token)
      for (const m of r.messages ?? []) if (!ids.includes(m.id)) ids.push(m.id)
      pageToken = r.nextPageToken ?? ''
      await pause()
      if (!pageToken) break
    }
  }
  const seen = await heads(t, ids.slice(0, PER_SYNC))
  seen.sort((x, y) => x.date.getTime() - y.date.getTime())
  const imported = await importHeads(t, seen, ctx)

  // Trop pour un passage : on garde le repère, le dédoublonnage absorbera ce qui a
  // déjà été lu. Sinon on repart d'un peu avant ce passage.
  return ids.length > PER_SYNC
    ? { state: { since: since.toISOString() }, secret: done.secret, imported }
    : { ...done, imported }
}

/**
 * « À trier » : les nouveaux expéditeurs de la boîte de réception principale. On ne
 * lit que leurs en-têtes, et seulement ceux qu'on n'a pas déjà vus.
 */
export async function triage(tokens: Tokens, state: any, ctx: SyncContext): Promise<{ since: string; secret?: Tokens }> {
  const { tokens: t, changed } = await freshTokens('google', tokens)
  const started = Date.now()
  const since = new Date(state?.triage_since ?? Date.now() - 3 * 86400e3)
  const q = `in:inbox category:primary after:${Math.floor(since.getTime() / 1000)} -from:me`
  const r = await api(`${BASE()}/users/me/messages?${new URLSearchParams({ q, maxResults: String(TRIAGE_PER_SYNC) })}`, t.access_token)
  const ids: string[] = (r.messages ?? []).map((m: any) => String(m.id))
  const seen = await ctx.triageKnown(ids)
  for (const id of ids.filter((x) => !seen.has(x)).reverse()) {
    const m = await api(`${BASE()}/users/me/messages/${id}?format=metadata` +
      ['From', 'Subject', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted'].map((h) => `&metadataHeaders=${h}`).join(''),
      t.access_token)
    await pause()
    const h = (name: string) =>
      (m.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === name.toLowerCase())?.value ?? ''
    const from = addresses(h('From'))[0] ?? ''
    if (!from || looksAutomated(from, h)) continue
    // L'identifiant Gmail sert de repère : c'est lui qu'on retrouve au passage suivant.
    await ctx.offer({ messageId: id, from, name: displayName(h('From')), subject: h('Subject'),
                      date: new Date(Number(m.internalDate ?? Date.now())) })
  }
  return { since: new Date(started - 10 * 60_000).toISOString(), secret: changed ? t : undefined }
}

/**
 * L'historique de quelques contacts, dans toute la boîte : Gmail sait chercher par
 * correspondant, ce qui évite de parcourir des années de courrier pour trois adresses.
 */
export async function backfill(tokens: Tokens, list: string[], ctx: SyncContext): Promise<BackfillResult> {
  const { tokens: t, changed } = await freshTokens('google', tokens)
  let imported = 0
  for (const a of list) {
    const q = `${withAny([a])} -in:chats -in:spam -in:trash`
    const r = await api(`${BASE()}/users/me/messages?${new URLSearchParams({
      q, maxResults: String(HISTORY_PER_ADDRESS) })}`, t.access_token)
    const ids = (r.messages ?? []).map((m: any) => String(m.id)).reverse()
    imported += await importHeads(t, await heads(t, ids), ctx)
  }
  return { imported, secret: changed ? t : undefined }
}

/** Le message entier, pour en relire une pièce jointe. */
export async function fetchRaw(tokens: Tokens, providerId: string): Promise<{ raw: Buffer; secret?: Tokens }> {
  const { tokens: t, changed } = await freshTokens('google', tokens)
  const r = await api(`${BASE()}/users/me/messages/${encodeURIComponent(providerId)}?format=raw`, t.access_token)
  return { raw: Buffer.from(String(r.raw), 'base64url'), secret: changed ? t : undefined }
}

export async function send(tokens: Tokens, out: Outgoing): Promise<SendOutcome> {
  let secret: Tokens | undefined
  try {
    const { tokens: t, changed } = await freshTokens('google', tokens)
    if (changed) secret = t
    const raw = await new MailComposer({
      from: out.fromName ? { name: out.fromName, address: out.from } : out.from,
      to: out.to, subject: out.subject, text: out.body, messageId: out.messageId,
      ...(out.inReplyTo ? { inReplyTo: out.inReplyTo, references: [out.inReplyTo] } : {}),
      ...(out.attachments?.length ? { attachments: out.attachments } : {}),
    }).compile().build()
    // Une réponse doit rester dans le fil du client aussi dans la boîte du vendeur :
    // Gmail ne range un envoi dans un fil que si on lui donne l'identifiant du fil.
    let threadId: string | undefined
    if (out.inReplyToProviderId) {
      try {
        const m = await api(`${BASE()}/users/me/messages/${encodeURIComponent(out.inReplyToProviderId)}?format=minimal`, t.access_token)
        threadId = m.threadId ?? undefined
      } catch { /* sans fil retrouvé, l'envoi part quand même */ }
    }
    const r = await api(`${BASE()}/users/me/messages/send`, t.access_token, {
      method: 'POST', json: { raw: raw.toString('base64url'), ...(threadId ? { threadId } : {}) },
    })
    return { ok: true, providerId: r.id ?? null, messageId: out.messageId, secret }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e), secret }
  }
}

/** Retire l'accès chez Google quand le vendeur débranche sa boîte. Au mieux. */
export async function revoke(tokens: Tokens) {
  const url = process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke'
  await fetch(`${url}?token=${encodeURIComponent(tokens.refresh_token || tokens.access_token)}`,
    { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => {})
}
