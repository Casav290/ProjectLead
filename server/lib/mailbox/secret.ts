import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Le chiffrement des secrets de boîte mail : jetons OAuth, mots de passe IMAP.
 *
 * AES-256-GCM, clé dérivée de `APP_SECRET` (ou `MAILBOX_SECRET`, nom repris de CRMlead). La base ne voit que le chiffré :
 * une copie de la base — une sauvegarde qui traîne, un export — ne suffit pas à lire
 * la boîte de quelqu'un. Il faut aussi le secret du serveur.
 *
 * ⚠️ Changer `MAILBOX_SECRET` rend illisibles toutes les boîtes branchées : chaque
 * vendeur devra rebrancher la sienne. C'est le prix d'un secret qui protège
 * vraiment ; il n'y a pas de porte dérobée.
 */

const raw = () => process.env.APP_SECRET || process.env.MAILBOX_SECRET || ''
export const mailboxSecretConfigured = () => raw().length >= 32

function key(): Buffer {
  if (raw().length < 32) throw new Error('mailbox_secret_missing')
  return createHash('sha256').update(raw()).digest()
}

/** `v1.<iv>.<tag>.<chiffré>`, en base64url. Le préfixe permettra une rotation. */
export function seal(value: unknown): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()])
  return ['v1', iv, c.getAuthTag(), data].map((x) => typeof x === 'string' ? x : x.toString('base64url')).join('.')
}

export function open<T = any>(sealed: string): T {
  const [v, iv, tag, data] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('mailbox_secret_format')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  const out = Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()])
  return JSON.parse(out.toString('utf8'))
}
