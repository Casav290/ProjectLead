import type Anthropic from '@anthropic-ai/sdk'

/**
 * L'historique que le navigateur renvoie à chaque tour (le serveur ne garde pas les conversations) : il ne peut pas gonfler
 * le coût d'un tour (cahier ia-limites, L10, révision du 30.10.2026). Le navigateur ne fait que garder ce que le serveur
 * lui a rendu ; rien n'y donne un droit, et rien d'autre que ce qu'un tour de ProjectLead produit n'y passe :
 *
 * - par message de la personne : du texte, et les résultats des outils (`tool_result`) dont le contenu n'est QUE du texte ;
 * - par message du modèle : du texte, des appels d'outil (`tool_use`), des blocs de réflexion (`thinking`,
 *   `redacted_thinking`) et le marqueur `fallback` du modèle de repli (retiré : il n'est jamais renvoyé au service) ;
 * - RIEN d'autre, à aucun niveau : une image, un document (PDF, texte, contenu imbriqué), un résultat de recherche, un
 *   fichier, un bloc d'outil serveur… dans un message OU dans le contenu d'un `tool_result` → le fil est refusé AVANT la
 *   réservation et avant tout appel au modèle (400 `assistant_history` : la bulle propose « Nouvelle conversation », B3) ;
 *   un texte qui porte des citations (elles renvoient à des documents) aussi ;
 * - chaque bloc gardé est RECONSTRUIT avec ses seuls champs connus : `cache_control` (marqueurs de cache du navigateur),
 *   champs inconnus et objets glissés à côté du texte ne partent pas au service ;
 * - tailles bornées : 120 messages, 200 blocs par message (schéma de la route), 400 000 octets UTF-8 en tout (413
 *   `assistant_history`) ; ces octets sont aussi ce que réserve un tour en cours (`openTurnTokens`, budget.ts).
 */
export type Message = Anthropic.Beta.BetaMessageParam

export const MAX_HISTORY_MESSAGES = 120
export const MAX_HISTORY_BYTES = 400_000

const USER_BLOCKS = new Set(['text', 'tool_result'])
const ASSISTANT_BLOCKS = new Set(['text', 'tool_use', 'thinking', 'redacted_thinking', 'fallback'])

const isText = (v: unknown): v is string => typeof v === 'string'
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
/** Un texte sans citation (les citations renvoient à des documents, qu'un fil de ProjectLead n'a jamais). */
const plainText = (b: Record<string, unknown>) => isText(b.text) && (b.citations === undefined || b.citations === null)

/** Le bloc reconstruit avec ses seuls champs connus ; `null` : bloc refusé ; `'drop'` : marqueur retiré. */
function block(role: Message['role'], b: unknown): Record<string, unknown> | null | 'drop' {
  if (!isObject(b) || !isText(b.type)) return null
  if (!(role === 'user' ? USER_BLOCKS : ASSISTANT_BLOCKS).has(b.type)) return null
  switch (b.type) {
    case 'text': return plainText(b) ? { type: 'text', text: b.text } : null
    case 'thinking': return isText(b.thinking) && isText(b.signature) ? { type: 'thinking', thinking: b.thinking, signature: b.signature } : null
    case 'redacted_thinking': return isText(b.data) ? { type: 'redacted_thinking', data: b.data } : null
    case 'tool_use': return isText(b.id) && isText(b.name) && isObject(b.input) ? { type: 'tool_use', id: b.id, name: b.name, input: b.input } : null
    case 'tool_result': {
      if (!isText(b.tool_use_id)) return null
      // Le contenu d'un résultat d'outil : un texte, ou des blocs de texte seulement (jamais une image ni un document).
      let content: string | { type: 'text'; text: string }[] | undefined
      if (b.content === undefined || isText(b.content)) content = b.content
      else if (Array.isArray(b.content) && b.content.every((x) => isObject(x) && x.type === 'text' && plainText(x))) {
        content = (b.content as { text: string }[]).map((x) => ({ type: 'text' as const, text: x.text }))
      } else return null
      return { type: 'tool_result', tool_use_id: b.tool_use_id, ...(content === undefined ? {} : { content }),
        ...(typeof b.is_error === 'boolean' ? { is_error: b.is_error } : {}) }
    }
    case 'fallback': return 'drop'
    default: return null
  }
}

/** Les octets UTF-8 d'un historique (un jeton couvre au moins un octet : une borne haute de ses jetons d'entrée). */
export const historyBytes = (messages: unknown) => Buffer.byteLength(JSON.stringify(messages), 'utf8')

export type Cleaned = { ok: true; messages: Message[]; bytes: number } | { ok: false; status: 400 | 413; reason: string }

/** L'historique nettoyé (blocs reconstruits) et sa taille, ou le refus (400 bloc refusé, 413 trop gros). */
export function cleanHistory(raw: readonly { role: string; content: unknown }[]): Cleaned {
  if (!raw.length || raw.length > MAX_HISTORY_MESSAGES) return { ok: false, status: 400, reason: 'messages' }
  const messages: Message[] = []
  for (const [i, m] of raw.entries()) {
    if (m.role !== 'user' && m.role !== 'assistant') return { ok: false, status: 400, reason: `${i}.role` }
    if (isText(m.content)) { messages.push({ role: m.role, content: m.content }); continue }
    if (!Array.isArray(m.content)) return { ok: false, status: 400, reason: `${i}.content` }
    const content: Record<string, unknown>[] = []
    for (const [j, b] of m.content.entries()) {
      const kept = block(m.role, b)
      if (kept === null) return { ok: false, status: 400, reason: `${i}.${j}:${isObject(b) && isText(b.type) ? b.type.slice(0, 40) : 'bloc'}` }
      if (kept !== 'drop') content.push(kept)
    }
    messages.push({ role: m.role, content } as unknown as Message)
  }
  const bytes = historyBytes(messages)
  if (bytes > MAX_HISTORY_BYTES) return { ok: false, status: 413, reason: 'bytes' }
  return { ok: true, messages, bytes }
}
