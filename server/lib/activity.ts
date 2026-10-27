import type { Ctx, Db } from '../db.js'
import type { Locale } from './i18n.js'
import { userLocales } from './locales.js'

/** Une ligne du fil d'activité d'un projet. */
export async function logActivity(db: Db, ctx: Ctx, projectId: string | null, kind: string,
                                  data: Record<string, unknown> = {}, taskId: string | null = null) {
  await db.query(
    'insert into activities (account_id, project_id, task_id, actor_id, kind, data) values ($1,$2,$3,$4,$5,$6)',
    [ctx.accountId, projectId, taskId, ctx.userId, kind, JSON.stringify(data)])
}

/** Un texte de notification : tel quel, ou écrit dans la langue de chaque destinataire (`tr(l, …)`). */
export type Localized = string | ((l: Locale) => string)

/** Prévient des personnes, sauf celle qui agit : on ne se notifie pas soi-même. Chacune dans sa langue (users.locale). */
export async function notify(db: Db, ctx: Ctx, userIds: (string | null | undefined)[], n: {
  kind: string; title: Localized; body?: string; link?: string | null
}) {
  const to = [...new Set(userIds.filter((u): u is string => Boolean(u) && u !== ctx.userId))]
  const langs = typeof n.title === 'function' ? await userLocales(db, to) : new Map<string, Locale>()
  for (const u of to) {
    const title = typeof n.title === 'function' ? n.title(langs.get(u) ?? 'fr') : n.title
    await db.query(
      'insert into notifications (account_id, user_id, kind, title, body, link) values ($1,$2,$3,$4,$5,$6)',
      [ctx.accountId, u, n.kind, title.slice(0, 300), (n.body ?? '').slice(0, 2000), n.link ?? null])
  }
}

/** Les identifiants des personnes citées par « @Prénom Nom » ou « @email » dans un texte. */
export async function mentionedUsers(db: Db, text: string): Promise<string[]> {
  if (!text.includes('@')) return []
  const people = (await db.query(
    // i18n-ok
    `select u.id, u.name, u.email from users u join account_users au on au.user_id = u.id
      where au.account_id = app_account() and au.active`)).rows as { id: string; name: string; email: string }[]
  const lower = text.toLowerCase()
  return people.filter((p) => (p.name && lower.includes('@' + p.name.toLowerCase())) || lower.includes('@' + p.email.toLowerCase()))
    .map((p) => p.id)
}
