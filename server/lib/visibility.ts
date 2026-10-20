import type { Db } from '../db.js'
import { HttpError, notFound } from './http.js'

/**
 * Projets réservés aux intervenants : seule la RLS de `projects` dit qui voit un projet. Les tables rattachées à un
 * projet (tâches, fichiers, points, temps, commentaires, listes de contrôle, rendez-vous…) ne filtrent, elles, que par
 * entreprise. Toute route qui prend l'identifiant d'un projet, ou d'un objet rattaché à un projet, passe donc d'abord
 * par ici : un projet que la personne ne voit pas répond 404, en lecture comme en écriture.
 */
export async function assertProjectVisible(db: Db, projectId: string | null | undefined) {
  if (!projectId || !(await db.query('select 1 from projects where id = $1', [projectId])).rowCount) throw notFound()
}

/**
 * Les objets qu'une requête rattache à un projet (tâche, colonne, étape, tâche parente) doivent appartenir à CE projet :
 * sinon l'identifiant d'un objet d'un projet réservé ferait lire son nom (jointures) ou écrire chez lui.
 */
export async function assertInProject(db: Db, projectId: string,
  refs: { task_id?: string | null; column_id?: string | null; stage_id?: string | null; parent_id?: string | null }) {
  const checks: [string | null | undefined, string][] = [
    [refs.task_id, 'tasks'], [refs.parent_id, 'tasks'], [refs.column_id, 'board_columns'], [refs.stage_id, 'stages']]
  for (const [id, table] of checks) {
    if (!id) continue
    if (!(await db.query(`select 1 from ${table} where id = $1 and project_id = $2`, [id, projectId])).rowCount)
      throw new HttpError(400, 'other_project')
  }
}
