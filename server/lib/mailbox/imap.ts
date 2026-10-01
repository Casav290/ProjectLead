import { lookup } from 'node:dns/promises'
import { privateIp } from '../netguard.js'
import { isIP } from 'node:net'
import { isProduction } from '../env.js'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { addresses, attachmentsOf, HISTORY_PER_ADDRESS, looksAutomated, readable, TRIAGE_PER_SYNC, worthFetching, type BackfillResult,
         type Outgoing, type SendOutcome, type SyncContext, type SyncResult } from './types.js'

/**
 * Toute autre messagerie : Infomaniak, OVH, Hostpoint, iCloud, Gmail avec un mot de
 * passe d'application… IMAP pour lire, SMTP pour envoyer.
 *
 * Microsoft n'en fait pas partie : son IMAP refuse les mots de passe depuis 2024.
 */

export type ImapSecret = {
  imap: { host: string; port: number; secure: boolean }
  smtp: { host: string; port: number; secure: boolean }
  user: string
  /** Quand l'envoi attend un autre identifiant que la réception (iCloud). */
  smtpUser?: string
  pass: string
}

const PORTS = new Set([993, 143, 465, 587, 25, 2525])

/**
 * Le serveur est saisi par l'utilisateur : sans garde, CRMlead irait frapper où on
 * lui dit, y compris sur son propre réseau interne. On n'accepte que les ports de
 * messagerie, et des adresses publiques.
 */
export async function assertPublicHost(host: string, port: number) {
  // Réservé aux contrôles de non-régression, qui parlent à des serveurs locaux sur
  // des ports de test. Jamais en production.
  if (process.env.MAILBOX_ALLOW_PRIVATE_HOSTS === '1' && !isProduction()) return
  if (!PORTS.has(port)) throw new Error('port_not_allowed')
  const bare = host.replace(/^\[|\]$/g, '')
  const ips = isIP(bare) ? [bare] : (await lookup(bare, { all: true })).map((a) => a.address)
  // La règle commune, qui voit aussi une IPv4 cachée dans une IPv6 (bêta-test E4-2).
  if (!ips.length || ips.some(privateIp)) throw new Error('host_not_allowed')
}

const client = (s: ImapSecret) => {
  const c = new ImapFlow({
    host: s.imap.host, port: s.imap.port, secure: s.imap.secure,
    auth: { user: s.user, pass: s.pass }, logger: false,
    connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  })
  // ImapFlow émet aussi ses échecs en événement « error » : sans écouteur, Node arrête tout le serveur
  // (25.09.2026 : une boîte coupée pendant le LOGIN a fait tomber le processus). L'échec remonte déjà par
  // la promesse de l'appel en cours (connect, fetch…), qui le traite : l'événement n'a rien à ajouter.
  c.on('error', () => {})
  return c
}

const transport = (s: ImapSecret) => nodemailer.createTransport({
  host: s.smtp.host, port: s.smtp.port, secure: s.smtp.secure,
  auth: { user: s.smtpUser ?? s.user, pass: s.pass },
  connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000,
})

/** Les deux connexions essayées avant d'enregistrer quoi que ce soit. */
export async function verify(s: ImapSecret) {
  await assertPublicHost(s.imap.host, s.imap.port)
  await assertPublicHost(s.smtp.host, s.smtp.port)
  const c = client(s)
  try {
    await c.connect()
  } catch (e: any) {
    throw new Error(e?.authenticationFailed ? 'imap_auth_failed' : 'imap_unreachable')
  } finally {
    await c.logout().catch(() => {})
  }
  try {
    await transport(s).verify()
  } catch (e: any) {
    throw new Error(e?.code === 'EAUTH' ? 'smtp_auth_failed' : 'smtp_unreachable')
  }
}

async function folders(c: ImapFlow) {
  const list = await c.list()
  const sent = list.find((f) => f.specialUse === '\\Sent') ??
    list.find((f) => /^(sent|sent items|sent messages|envoy[ée]s|éléments envoyés|gesendet|\[gmail\]\/sent mail)$/i.test(f.path))
  return ['INBOX', ...(sent ? [sent.path] : [])]
}

const PER_FOLDER = 300

/**
 * L'identifiant d'un message chez un serveur IMAP : son dossier, la « validité » des
 * numéros de ce dossier, et son numéro. Si le serveur renumérote le dossier, l'ancien
 * identifiant ne désigne plus rien, et on le sait au lieu de rendre un autre message.
 */
const idOf = (path: string, uidValidity: any, uid: number) => `${String(uidValidity)}:${uid}:${path}`

/** Lit les en-têtes de ces UID, puis télécharge et enregistre ceux qui concernent un contact. */
async function importUids(c: ImapFlow, path: string, uids: number[], ctx: SyncContext): Promise<number> {
  if (!uids.length) return 0
  const box = c.mailbox as any
  const heads: { uid: number; messageId: string; from: string; to: string[]; date: Date }[] = []
  for await (const m of c.fetch(uids, { envelope: true, internalDate: true }, { uid: true })) {
    const env = m.envelope as any
    heads.push({
      uid: m.uid,
      messageId: String(env?.messageId ?? '').trim(),
      from: addresses((env?.from ?? []).map((a: any) => a.address ?? ''))[0] ?? '',
      to: addresses([...(env?.to ?? []), ...(env?.cc ?? [])].map((a: any) => a.address ?? '')),
      date: new Date((m.internalDate as any) ?? env?.date ?? Date.now()),
    })
  }
  let imported = 0
  for (const h of await worthFetching(ctx, heads)) {
    const full = await c.fetchOne(String(h.uid), { source: true }, { uid: true })
    if (!full || !full.source) continue
    const p = await simpleParser(full.source)
    const r = await ctx.ingest({
      messageId: h.messageId, providerId: idOf(path, box.uidValidity, h.uid), from: h.from, to: h.to,
      subject: p.subject ?? '', body: readable(p.text, p.html || null), date: h.date,
      attachments: attachmentsOf(p).map((a) => a.info),
    })
    if (r === 'in' || r === 'out') imported++
  }
  return imported
}

export async function sync(s: ImapSecret, state: any, ctx: SyncContext): Promise<SyncResult> {
  await assertPublicHost(s.imap.host, s.imap.port)
  const since = new Date(state?.since ?? Date.now() - 30 * 86400e3)
  const next: any = { since: state?.since ?? since.toISOString(), folders: { ...(state?.folders ?? {}) } }
  const c = client(s)
  let imported = 0
  await c.connect()
  try {
    for (const path of await folders(c)) {
      const lock = await c.getMailboxLock(path)
      try {
        const box = c.mailbox as any
        const mem = next.folders[path]
        // UIDVALIDITY changé : le serveur a renuméroté le dossier, les UID gardés ne
        // veulent plus rien dire. On repart de la date, le dédoublonnage fait le reste.
        const fresh = !mem || String(mem.uidValidity) !== String(box.uidValidity)
        const found = fresh
          ? await c.search({ since }, { uid: true })
          : await c.search({ uid: `${Number(mem.lastUid) + 1}:*` }, { uid: true })
        const uids = (found || []).filter((u) => fresh || u > Number(mem.lastUid)).sort((a, b) => a - b)
        const slice = uids.slice(0, PER_FOLDER)
        imported += await importUids(c, path, slice, ctx)

        // Le repère avance jusqu'au dernier UID examiné. Un dossier sans rien de récent
        // prend le plus haut UID existant : sinon le passage suivant, parti de 1,
        // parcourrait tout l'historique du dossier au lieu des trente derniers jours.
        const lastUid = slice.length
          ? slice[slice.length - 1]
          : fresh ? Math.max(0, Number(box.uidNext ?? 1) - 1) : Number(mem.lastUid)
        next.folders[path] = { uidValidity: String(box.uidValidity), lastUid }
      } finally {
        lock.release()
      }
    }
  } finally {
    await c.logout().catch(() => {})
  }
  return { state: next, imported }
}

/** « À trier » : les en-têtes des messages récents de la boîte de réception, pas davantage. */
export async function triage(s: ImapSecret, state: any, ctx: SyncContext): Promise<{ since: string }> {
  await assertPublicHost(s.imap.host, s.imap.port)
  const started = Date.now()
  const since = new Date(state?.triage_since ?? Date.now() - 3 * 86400e3)
  const c = client(s)
  await c.connect()
  try {
    const lock = await c.getMailboxLock('INBOX')
    try {
      const box = c.mailbox as any
      const found = (await c.search({ since }, { uid: true })) || []
      const uids = found.sort((a, b) => a - b).slice(-TRIAGE_PER_SYNC)
      if (uids.length) {
        const ids = uids.map((u) => idOf('INBOX', box.uidValidity, u))
        const seen = await ctx.triageKnown(ids)
        const todo = uids.filter((u) => !seen.has(idOf('INBOX', box.uidValidity, u)))
        if (todo.length) {
          for await (const m of c.fetch(todo, { envelope: true, internalDate: true,
            headers: ['list-unsubscribe', 'list-id', 'precedence', 'auto-submitted'] }, { uid: true })) {
            const env = m.envelope as any
            const raw = String(m.headers ?? '')
            const h = (name: string) => raw.match(new RegExp(`^${name}:\\s*(.*)$`, 'mi'))?.[1] ?? ''
            const sender = env?.from?.[0]
            const from = String(sender?.address ?? '').toLowerCase()
            if (!from || looksAutomated(from, h)) continue
            await ctx.offer({ messageId: idOf('INBOX', box.uidValidity, m.uid), from, name: sender?.name || null,
                              subject: String(env?.subject ?? ''), date: new Date((m.internalDate as any) ?? Date.now()) })
          }
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await c.logout().catch(() => {})
  }
  return { since: new Date(started - 10 * 60_000).toISOString() }
}

/** L'historique de quelques contacts : une recherche par correspondant, dossier par dossier. */
export async function backfill(s: ImapSecret, list: string[], ctx: SyncContext): Promise<BackfillResult> {
  await assertPublicHost(s.imap.host, s.imap.port)
  const c = client(s)
  let imported = 0
  await c.connect()
  try {
    for (const path of await folders(c)) {
      const lock = await c.getMailboxLock(path)
      try {
        for (const a of list) {
          const found = await c.search({ or: [{ from: a }, { to: a }, { cc: a }] }, { uid: true })
          const uids = (found || []).sort((x, y) => x - y).slice(-HISTORY_PER_ADDRESS)
          imported += await importUids(c, path, uids, ctx)
        }
      } finally {
        lock.release()
      }
    }
  } finally {
    await c.logout().catch(() => {})
  }
  return { imported }
}

/** Le message entier, pour en relire une pièce jointe. */
export async function fetchRaw(s: ImapSecret, providerId: string): Promise<{ raw: Buffer }> {
  const m = providerId.match(/^([^:]*):(\d+):(.*)$/)
  if (!m) throw new Error('not_found')
  await assertPublicHost(s.imap.host, s.imap.port)
  const c = client(s)
  await c.connect()
  try {
    const lock = await c.getMailboxLock(m[3])
    try {
      if (String((c.mailbox as any).uidValidity) !== m[1]) throw new Error('not_found')
      const full = await c.fetchOne(m[2], { source: true }, { uid: true })
      if (!full || !full.source) throw new Error('not_found')
      return { raw: full.source }
    } finally {
      lock.release()
    }
  } finally {
    await c.logout().catch(() => {})
  }
}

/**
 * L'envoi par SMTP, puis une copie dans « Envoyés » : la plupart des serveurs ne la
 * font pas eux-mêmes, et un email envoyé qui n'apparaît pas dans sa boîte est un
 * email dont le vendeur doute. Gmail fait sa copie tout seul ; on ne la double pas.
 */
export async function send(s: ImapSecret, out: Outgoing): Promise<SendOutcome> {
  try {
    await assertPublicHost(s.smtp.host, s.smtp.port)
    const raw = await new MailComposer({
      from: out.fromName ? { name: out.fromName, address: out.from } : out.from,
      to: out.to, subject: out.subject, text: out.body, messageId: out.messageId, date: new Date(),
      ...(out.inReplyTo ? { inReplyTo: out.inReplyTo, references: [out.inReplyTo] } : {}),
      ...(out.attachments?.length ? { attachments: out.attachments } : {}),
    }).compile().build()
    await transport(s).sendMail({ envelope: { from: out.from, to: out.to }, raw })

    if (!/(^|\.)(gmail|googlemail)\.com$/i.test(s.smtp.host)) {
      const c = client(s)
      try {
        await c.connect()
        const all = await folders(c)
        if (all[1]) await c.append(all[1], raw, ['\\Seen'])
      } catch {
        // La copie n'est pas l'envoi : le message est parti, on ne le signale pas
        // comme un échec.
      } finally {
        await c.logout().catch(() => {})
      }
    }
    return { ok: true, providerId: null, messageId: out.messageId }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}
