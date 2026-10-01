import nodemailer from 'nodemailer'
import { anon } from '../db.js'
import { newMessageId } from './mailbox/types.js'
import { sendVia } from './mailbox/index.js'

/**
 * Tout ce qui part par email : suivi client, invitations, confirmations de rendez-vous,
 * réponses depuis un projet.
 *
 * Ordre de préférence : la boîte de la personne qui envoie (le client reçoit un email de son
 * interlocuteur, pas d'un robot), puis la boîte par défaut de l'entreprise, puis le SMTP
 * système (`SMTP_URL`). Sans rien de tout cela, le message est seulement journalisé : rien ne
 * se perd, et les contrôles le relisent dans `sent_emails`.
 */

export type Mail = {
  accountId: string | null
  to: string[]
  subject: string
  text: string
  html?: string
  replyTo?: string
  /** La personne au nom de qui le message part : sa boîte d'abord. */
  fromUserId?: string | null
  fromName?: string | null
  attachments?: { filename: string; content: Buffer; contentType?: string }[]
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null
const systemTransport = () => {
  if (!process.env.SMTP_URL) return null
  transport ??= nodemailer.createTransport(process.env.SMTP_URL)
  return transport
}

const systemFrom = () => process.env.EMAIL_FROM || 'ProjectLead <suivi@projectlead.io>'

async function log(m: Mail, via: string, error: string | null) {
  await anon((db) => db.query(
    'insert into sent_emails (account_id, to_emails, subject, body, via, error) values ($1,$2,$3,$4,$5,$6)',
    [m.accountId, m.to, m.subject, m.text, via, error])).catch((e) => console.error('[email] journal', e.message))
}

/** Rend le moyen d'envoi utilisé, ou lève si tout a échoué. */
export async function sendMail(m: Mail): Promise<{ via: string }> {
  if (!m.to.length) throw new Error('no_recipient')
  // 1. Une boîte branchée : celle de la personne, sinon celle par défaut de l'entreprise.
  if (m.accountId) {
    const mb = await anon(async (db) => (await db.query(
      `select id, provider, email, display_name, secret_enc from mailboxes
        where account_id = $1 and sync_error is distinct from 'reconnect_required'
          and (user_id = $2 or is_default)
        order by (user_id = $2) desc nulls last, is_default desc limit 1`,
      [m.accountId, m.fromUserId ?? null])).rows[0])
    if (mb) {
      const r = await sendVia(mb, {
        from: mb.email, fromName: m.fromName ?? mb.display_name, to: m.to, subject: m.subject, body: m.text,
        messageId: newMessageId(mb.email), attachments: m.attachments,
      })
      if (r.sealed) await anon((db) => db.query('update mailboxes set secret_enc = $1 where id = $2', [r.sealed, mb.id]))
      if (r.ok) { await log(m, `mailbox:${mb.email}`, null); return { via: `mailbox:${mb.email}` } }
      console.error('[email] boîte', mb.email, r.error)
    }
  }
  // 2. Le SMTP système.
  const t = systemTransport()
  if (t) {
    try {
      await t.sendMail({
        from: m.fromName ? `${m.fromName} via ProjectLead <${systemFrom().match(/<(.+)>/)?.[1] ?? systemFrom()}>` : systemFrom(),
        to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo, attachments: m.attachments,
      })
      await log(m, 'smtp', null)
      return { via: 'smtp' }
    } catch (e: any) {
      await log(m, 'smtp', String(e?.message ?? e))
      throw new Error('send_failed')
    }
  }
  // 3. Rien de branché : journalisé seulement.
  await log(m, 'log', null)
  if (process.env.NODE_ENV !== 'production') console.log(`[email] (journal) à ${m.to.join(', ')} : ${m.subject}`)
  return { via: 'log' }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))

/** Gabarit HTML sobre, au visuel Trait net : angles vifs, Archivo, une couleur d'action. */
export function layout(title: string, bodyHtml: string, action?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#eceae7;font-family:Archivo,Arial,sans-serif;color:#1b1a19">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #cfcac4">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e7e4e0"><span style="display:inline-block;background:#8e2a6b;color:#fff;font-weight:800;padding:4px 7px">PL</span>
<span style="font-weight:800;margin-left:8px">ProjectLead</span></td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 16px;font-weight:800;letter-spacing:-.02em">${esc(title)}</h1>${bodyHtml}
${action ? `<p style="margin:24px 0 0"><a href="${esc(action.url)}" style="background:#8e2a6b;color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;display:inline-block">${esc(action.label)}</a></p>` : ''}
</td></tr></table></td></tr></table></body></html>`
}

export const htmlParagraphs = (text: string) =>
  text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')

export { esc }

