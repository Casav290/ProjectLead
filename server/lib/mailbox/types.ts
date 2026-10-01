import { randomUUID } from 'node:crypto'

/** Un email retrouvé dans une boîte, prêt à être rattaché à un lead. */
export type FoundMessage = {
  messageId: string
  providerId: string | null
  from: string
  to: string[]
  subject: string
  body: string
  date: Date
  attachments?: AttachmentInfo[]
}

/** Ce qu'on garde d'une pièce jointe : de quoi l'afficher. Le fichier reste chez le fournisseur. */
export type AttachmentInfo = { name: string; type: string; size: number }

/**
 * Les vraies pièces jointes d'un message analysé, dans un ordre stable. Les images
 * insérées dans le corps (logos de signature) n'en sont pas : personne ne les a
 * « envoyées ». L'ordre sert d'identifiant au téléchargement, et doit donc être le
 * même à l'import et à la relecture.
 */
export function attachmentsOf(parsed: { attachments?: any[] }): { info: AttachmentInfo; content: Buffer }[] {
  return (parsed.attachments ?? [])
    .filter((a) => a && !a.related && (a.contentDisposition === 'attachment' || a.filename))
    .map((a) => ({
      info: { name: String(a.filename || 'piece-jointe'), type: String(a.contentType || 'application/octet-stream'),
              size: Number(a.size ?? a.content?.length ?? 0) },
      content: a.content as Buffer,
    }))
}

/** Au plus tant de messages relus par adresse quand on remonte l'historique d'un contact. */
export const HISTORY_PER_ADDRESS = 100
/** Et au plus tant d'adresses par passage : une boîte ne doit pas monopoliser le serveur. */
export const HISTORY_ADDRESSES_PER_SYNC = 10

export type BackfillResult = { imported: number; secret?: any }

export const TRIAGE_PER_SYNC = 50

/**
 * Un message envoyé par une machine plutôt que par une personne : lettre
 * d'information, notification, accusé automatique. Jamais proposé en lead.
 */
export function looksAutomated(from: string, h: (name: string) => string) {
  if (h('List-Unsubscribe') || h('List-Id')) return true
  if (/^(bulk|list|junk|auto_reply)$/i.test(h('Precedence').trim())) return true
  const auto = h('Auto-Submitted').trim().toLowerCase()
  if (auto && auto !== 'no') return true
  return /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?|newsletter|info-noreply)[+@.-]/i.test(from)
}

/** « Marc Dupont <marc@dupont.ch> » → « Marc Dupont ». */
export const displayName = (raw: string) =>
  (raw.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? '').trim() || null

/** Ce que la synchronisation demande au reste de l'application, sans rien savoir de la base. */
export type SyncContext = {
  email: string
  /** File « À trier » : les identifiants déjà proposés, et proposer un nouvel expéditeur. */
  triageKnown: (messageIds: string[]) => Promise<Set<string>>
  offer: (m: { messageId: string; from: string; name: string | null; subject: string; date: Date }) => Promise<boolean>
  /** Toutes les adresses de contact des leads ouverts du compte. */
  contacts: () => Promise<string[]>
  /** Parmi ces adresses, celles d'un contact d'un lead ouvert. */
  known: (addresses: string[]) => Promise<Set<string>>
  /** Parmi ces identifiants de message, ceux déjà enregistrés. */
  seen: (messageIds: string[]) => Promise<Set<string>>
  ingest: (m: FoundMessage) => Promise<string>
}

export type SyncResult = { state: any; secret?: any; imported: number }

export type Outgoing = {
  from: string
  fromName?: string | null
  to: string[]
  subject: string
  body: string
  messageId: string
  /** Le message auquel on répond, pour rester dans le fil du client. */
  inReplyTo?: string | null
  /** Son identifiant chez le fournisseur, quand il vient de la même boîte. */
  inReplyToProviderId?: string | null
  /** Documents joints (bêta-test B18). */
  attachments?: { filename: string; content: Buffer; contentType?: string }[]
}

export type SendOutcome =
  | { ok: true; providerId: string | null; messageId: string | null; secret?: any }
  | { ok: false; error: string; secret?: any }

/** « Marc Dupont <marc@dupont.ch> » → « marc@dupont.ch ». */
export function addresses(raw: string | string[] | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw.join(',') : String(raw ?? '')
  return (list.match(/[^\s<>,;"'()]+@[^\s<>,;"'()]+/g) ?? []).map((a) => a.toLowerCase())
}

export const newMessageId = (from: string) =>
  `<${randomUUID()}@${(from.split('@')[1] ?? 'projectlead.local').replace(/[^a-z0-9.-]/gi, '')}>`

/** Le corps lisible d'un email : le texte s'il existe, sinon le HTML dépouillé. */
export function readable(text: string | null | undefined, html: string | null | undefined): string {
  if (text && text.trim()) return text.trim()
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Les emails d'une fournée qui méritent d'être téléchargés en entier : ceux qui
 * concernent un contact connu et qu'on n'a pas encore. Deux requêtes pour toute la
 * fournée, pas deux par message.
 */
export async function worthFetching<T extends { messageId: string; from: string; to: string[] }>(
  ctx: SyncContext, batch: T[],
): Promise<T[]> {
  if (!batch.length) return []
  const others = (m: T) =>
    [m.from, ...m.to].map((a) => a.toLowerCase()).filter((a) => a && a !== ctx.email)
  const known = await ctx.known([...new Set(batch.flatMap(others))])
  const seen = await ctx.seen(batch.map((m) => m.messageId).filter(Boolean))
  return batch.filter((m) => m.messageId && !seen.has(m.messageId) && others(m).some((a) => known.has(a)))
}
