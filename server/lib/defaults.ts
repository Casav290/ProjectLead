import type { Db } from '../db.js'
import { tr, type Locale } from './i18n.js'
import { accountLocale } from './locales.js'

/** Les colonnes du tableau d'un nouveau projet (clés de server/i18n, écrites dans la langue de l'entreprise). */
export const DEFAULT_COLUMNS: { key: string; is_done: boolean }[] = [
  { key: 'defaults.column.todo', is_done: false },
  { key: 'defaults.column.doing', is_done: false },
  { key: 'defaults.column.review', is_done: false },
  { key: 'defaults.column.done', is_done: true },
]
// tr(l, 'defaults.column.todo') tr(l, 'defaults.column.doing') tr(l, 'defaults.column.review') tr(l, 'defaults.column.done')

export async function createDefaultColumns(db: Db, accountId: string, projectId: string, locale?: Locale) {
  const l = locale ?? await accountLocale(db, accountId)
  for (const [i, c] of DEFAULT_COLUMNS.entries()) {
    await db.query('insert into board_columns (account_id, project_id, name, position, is_done) values ($1,$2,$3,$4,$5)',
      [accountId, projectId, tr(l, c.key), i, c.is_done])
  }
}

/** Le modèle de départ : quatre étapes, leur description et leurs tâches (clés de server/i18n). */
const STAGES: [string, number][] = [['scoping', 3], ['design', 2], ['build', 2], ['delivery', 3]]
// tr(l, 'defaults.template.name') tr(l, 'defaults.template.description')
// tr(l, 'defaults.stage.scoping.name') tr(l, 'defaults.stage.scoping.description') tr(l, 'defaults.stage.scoping.task1')
// tr(l, 'defaults.stage.scoping.task2') tr(l, 'defaults.stage.scoping.task3')
// tr(l, 'defaults.stage.design.name') tr(l, 'defaults.stage.design.description') tr(l, 'defaults.stage.design.task1')
// tr(l, 'defaults.stage.design.task2')
// tr(l, 'defaults.stage.build.name') tr(l, 'defaults.stage.build.description') tr(l, 'defaults.stage.build.task1')
// tr(l, 'defaults.stage.build.task2')
// tr(l, 'defaults.stage.delivery.name') tr(l, 'defaults.stage.delivery.description') tr(l, 'defaults.stage.delivery.task1')
// tr(l, 'defaults.stage.delivery.task2') tr(l, 'defaults.stage.delivery.task3')

/**
 * Ce qu'une entreprise trouve en arrivant : ses réglages (langue des factures = la sienne), et un modèle de projet prêt
 * à servir, écrit dans la langue de l'entreprise (`accounts.locale`, celle de la personne qui l'a créée).
 */
export async function seedAccount(db: Db, accountId: string, userId: string) {
  const l = await accountLocale(db, accountId)
  await db.query('insert into account_settings (account_id, invoice_language) values ($1, $2) on conflict do nothing', [accountId, l])
  const tpl = (await db.query(
    `insert into projects (account_id, name, description, owner_id, is_template, status, source, created_by, currency)
     values ($1, $2, $3, $4, true, 'planned', 'template', $4, (select currency from accounts where id = $1)) returning id`,
    [accountId, tr(l, 'defaults.template.name'), tr(l, 'defaults.template.description'), userId])).rows[0]
  await createDefaultColumns(db, accountId, tpl.id, l)
  for (const [i, [key, n]] of STAGES.entries()) {
    const s = (await db.query(
      `insert into stages (account_id, project_id, name, description, position, start_date, due_date)
       values ($1,$2,$3,$4,$5, current_date + $6::int, current_date + $7::int) returning id`,
      [accountId, tpl.id, tr(l, `defaults.stage.${key}.name`), tr(l, `defaults.stage.${key}.description`), i, i * 14, i * 14 + 13])).rows[0]
    for (let j = 0; j < n; j++) {
      await db.query(
        `insert into tasks (account_id, project_id, stage_id, column_id, number, title, position, due_date, created_by)
         values ($1,$2,$3,(select id from board_columns where project_id = $2 order by position limit 1),
                 (select coalesce(max(number),0)+1 from tasks where project_id = $2), $4, $5, current_date + $6::int, $7)`,
        [accountId, tpl.id, s.id, tr(l, `defaults.stage.${key}.task${j + 1}`), i * 10 + j, i * 14 + (j + 1) * 4, userId])
    }
  }
}
