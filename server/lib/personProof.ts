import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { anon } from '../db.js'
import { leadIdOn } from './env.js'
import { HttpError, type Env } from './http.js'

/**
 * La preuve de la personne (liaison sans clé, 26.10.2026) : le jeton d'identité que le Compte Lead a émis pour
 * ProjectLead à la connexion. ProjectLead le présente à ERPlead (`subject_token`) pour obtenir un jeton d'échange
 * lié à CETTE personne : CRMlead et InvoiceLead répondent alors avec SES droits, jamais ceux d'un administrateur.
 *
 * Gardé avec la session (sessions.lead_id_token), scellé au repos : AES-256-GCM, clé = sha256(LEAD_PROOF_KEY). Sans
 * LEAD_PROOF_KEY, repli sur une clé dérivée d'APP_SECRET (étiquette « lead-proof », jamais la clé des boîtes mail
 * telle quelle) : une copie de la base seule ne suffit toujours pas à se faire passer pour quelqu'un.
 *
 * ERPlead accepte une preuve de 12 h au plus ; à 11 h, on demande une reconnexion silencieuse (401 `lead_reauth`,
 * l'écran repart par /auth/lead/start?prompt=none&next=<la page>), pour ne jamais présenter une preuve refusée.
 */

export const PROOF_MAX_AGE_S = 11 * 3600

function key(): Buffer {
  const k = process.env.LEAD_PROOF_KEY
  if (k && k.length >= 32) return createHash('sha256').update(k).digest()
  const app = process.env.APP_SECRET || process.env.MAILBOX_SECRET || ''
  if (app.length < 32) throw new Error('lead_proof_key_missing')
  return createHash('sha256').update(`lead-proof:${app}`).digest()
}

/** Le jeton d'identité scellé, `p1.<iv>.<tag>.<chiffré>` en base64url ; `null` sans clé (jamais en clair). */
export function sealProof(idToken: string | null | undefined): string | null {
  if (!idToken) return null
  let k: Buffer
  try { k = key() } catch { return null }
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([c.update(idToken, 'utf8'), c.final()])
  return ['p1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

/** Le jeton d'identité, ou `null` (absent, ancien format en clair, autre clé, altéré). */
export function openProof(sealed: string | null | undefined): string | null {
  if (!sealed) return null
  const [v, iv, tag, data] = sealed.split('.')
  if (v !== 'p1' || !iv || !tag || !data) return null
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
  } catch { return null }
}

/** `iat` d'un JWT, sans vérifier la signature (c'est ERPlead qui la vérifie ; on ne fait que mesurer l'âge). */
export function issuedAt(jwt: string): number | null {
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString())
    return typeof p.iat === 'number' ? p.iat : null
  } catch { return null }
}

/**
 * La preuve de la personne connectée, prête à présenter. Pas de preuve (connexion par mot de passe, session d'avant le
 * scellement), preuve illisible ou de plus de 11 h → 401 `lead_reauth` (reconnexion silencieuse par le Compte Lead).
 * Serveur sans Compte Lead → 400 `lead_required`.
 */
export async function personProof(c: Context<Env>): Promise<string> {
  if (!leadIdOn()) throw new HttpError(400, 'lead_required')
  const hash = c.get('sessionHash')
  const row = hash ? await anon(async (db) => (await db.query('select lead_id_token from sessions where token_hash = $1', [hash])).rows[0]) : null
  const proof = openProof(row?.lead_id_token)
  const iat = proof ? issuedAt(proof) : null
  if (!proof || iat === null || Date.now() / 1000 - iat > PROOF_MAX_AGE_S) throw new HttpError(401, 'lead_reauth')
  return proof
}
