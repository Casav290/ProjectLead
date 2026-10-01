import type { Db } from '../db.js'

/** Les colonnes du tableau d'un nouveau projet. */
export const DEFAULT_COLUMNS: { name: string; is_done: boolean }[] = [
  { name: 'À faire', is_done: false },
  { name: 'En cours', is_done: false },
  { name: 'En revue', is_done: false },
  { name: 'Terminé', is_done: true },
]

export async function createDefaultColumns(db: Db, accountId: string, projectId: string) {
  for (const [i, c] of DEFAULT_COLUMNS.entries()) {
    await db.query('insert into board_columns (account_id, project_id, name, position, is_done) values ($1,$2,$3,$4,$5)',
      [accountId, projectId, c.name, i, c.is_done])
  }
}

/** Ce qu'une entreprise trouve en arrivant : ses réglages, et un modèle de projet prêt à servir. */
export async function seedAccount(db: Db, accountId: string, userId: string) {
  await db.query('insert into account_settings (account_id) values ($1) on conflict do nothing', [accountId])
  const tpl = (await db.query(
    `insert into projects (account_id, name, description, owner_id, is_template, status, source, created_by)
     values ($1, 'Projet client (modèle)', 'Modèle de départ : cadrage, conception, réalisation, livraison. À adapter dans Modèles.',
             $2, true, 'planned', 'template', $2) returning id`, [accountId, userId])).rows[0]
  await createDefaultColumns(db, accountId, tpl.id)
  const stages = [
    ['Cadrage', 'Besoins, périmètre, planning validé', ['Réunion de lancement', 'Rédiger le cahier des charges', 'Valider le planning avec le client']],
    ['Conception', 'Maquettes et solutions proposées', ['Proposer les maquettes', 'Intégrer les retours du client']],
    ['Réalisation', 'Production et points réguliers', ['Produire', 'Point d\'avancement hebdomadaire']],
    ['Livraison', 'Recette, mise en service, bilan', ['Recette avec le client', 'Mise en service', 'Bilan de projet']],
  ] as const
  for (const [i, [name, desc, tasks]] of stages.entries()) {
    const s = (await db.query(
      `insert into stages (account_id, project_id, name, description, position, start_date, due_date)
       values ($1,$2,$3,$4,$5, current_date + $6::int, current_date + $7::int) returning id`,
      [accountId, tpl.id, name, desc, i, i * 14, i * 14 + 13])).rows[0]
    for (const [j, t] of tasks.entries()) {
      await db.query(
        `insert into tasks (account_id, project_id, stage_id, column_id, number, title, position, due_date, created_by)
         values ($1,$2,$3,(select id from board_columns where project_id = $2 order by position limit 1),
                 (select coalesce(max(number),0)+1 from tasks where project_id = $2), $4, $5, current_date + $6::int, $7)`,
        [accountId, tpl.id, s.id, t, i * 10 + j, i * 14 + (j + 1) * 4, userId])
    }
  }
}
