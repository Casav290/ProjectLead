/**
 * Les dates d'un plan de projet proposé par l'Assistant IA (outil `propose_project_plan`). Le modèle donne des durées en
 * jours ouvrés et des dépendances ; les dates se calculent ici, toujours de la même façon, pour que la carte montre
 * exactement ce qui sera créé :
 * - jours ouvrés = lundi à vendredi (ProjectLead ne connaît pas les jours fériés) ;
 * - les étapes se suivent : la première commence le jour du début (ou le jour ouvré suivant), chacune commence le jour
 *   ouvré qui suit la fin de la précédente ;
 * - une tâche commence au début de son étape, ou le jour ouvré qui suit la fin de sa dernière tâche préalable ;
 * - une tâche de N jours finit N-1 jours ouvrés après son début ; un jalon (0 jour) tombe le jour où finit sa dernière
 *   tâche préalable (ou au début de son étape) ;
 * - une étape finit avec sa dernière tâche (sans tâche : après sa propre durée, 5 jours ouvrés par défaut).
 */

const day = (s: string) => new Date(`${s}T12:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

export const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000))
export const isWorkday = (s: string) => { const w = day(s).getUTCDay(); return w !== 0 && w !== 6 }
/** Le jour même s'il est ouvré, sinon le lundi suivant. */
export const workdayFrom = (s: string) => { let x = s; while (!isWorkday(x)) x = addDays(x, 1); return x }
/** Le jour ouvré qui suit. */
export const nextWorkday = (s: string) => workdayFrom(addDays(s, 1))
/** n jours ouvrés après `s` (s ramené d'abord à un jour ouvré). */
export const addWorkdays = (s: string, n: number) => { let x = workdayFrom(s); for (let i = 0; i < n; i++) x = nextWorkday(x); return x }
/** Nombre de jours ouvrés de `a` à `b` compris. */
export const workdaysBetween = (a: string, b: string) => {
  let n = 0
  for (let x = a; x <= b; x = addDays(x, 1)) if (isWorkday(x)) n++
  return n
}

export type PlanStage = { key: string; duration_days?: number }
export type PlanTask = { key: string; stage?: string; duration_days: number; milestone?: boolean; after?: string[] }
export type Dated = { start: string; due: string }
export type Schedule = {
  start: string; end: string
  stages: Map<string, Dated>
  tasks: Map<string, Dated & { milestone: boolean }>
}
export type ScheduleError = { error: string; detail?: string }

const DEFAULT_STAGE_DAYS = 5

export function schedulePlan(startDate: string, stages: PlanStage[], tasks: PlanTask[]): Schedule | ScheduleError {
  const start = workdayFrom(startDate)
  const stageIndex = new Map<string, number>()
  for (const [i, s] of stages.entries()) {
    if (stageIndex.has(s.key)) return { error: 'duplicate_stage_key', detail: s.key }
    stageIndex.set(s.key, i)
  }
  const byKey = new Map<string, PlanTask>()
  for (const t of tasks) {
    if (byKey.has(t.key)) return { error: 'duplicate_task_key', detail: t.key }
    byKey.set(t.key, t)
  }
  // Avec des étapes, chaque tâche en a une ; une tâche ne dépend que de tâches de son étape ou d'étapes antérieures.
  const stageOf = (t: PlanTask) => (t.stage === undefined ? -1 : stageIndex.get(t.stage) ?? -2)
  for (const t of tasks) {
    if (stages.length && t.stage === undefined) return { error: 'task_stage_required', detail: t.key }
    if (!stages.length && t.stage !== undefined) return { error: 'unknown_stage', detail: `${t.key} → ${t.stage}` }
    if (stageOf(t) === -2) return { error: 'unknown_stage', detail: `${t.key} → ${t.stage}` }
    for (const p of t.after ?? []) {
      const pred = byKey.get(p)
      if (!pred) return { error: 'unknown_dependency', detail: `${t.key} → ${p}` }
      if (p === t.key) return { error: 'self_dependency', detail: t.key }
      if (stageOf(pred) > stageOf(t)) return { error: 'dependency_on_later_stage', detail: `${t.key} → ${p}` }
    }
  }

  const out: Schedule = { start, end: start, stages: new Map(), tasks: new Map() }
  /** Place les tâches d'un groupe (une étape, ou tout le plan sans étape) à partir de `from` ; rend la dernière date. */
  const place = (group: PlanTask[], from: string): string | ScheduleError => {
    const pending = new Set(group.map((t) => t.key))
    let last: string | null = null
    while (pending.size) {
      // Une tâche dont toutes les préalables sont placées (ordre de la liste gardé à égalité).
      const t = group.find((x) => pending.has(x.key) && (x.after ?? []).every((p) => out.tasks.has(p)))
      if (!t) return { error: 'dependency_cycle', detail: [...pending].join(', ') }
      const milestone = Boolean(t.milestone) || t.duration_days === 0
      const preds = (t.after ?? []).map((p) => out.tasks.get(p)!)
      let s = from
      for (const p of preds) {
        const after = milestone ? p.due : nextWorkday(p.due)
        if (after > s) s = after
      }
      s = workdayFrom(s)
      const due = milestone ? s : addWorkdays(s, Math.max(1, t.duration_days) - 1)
      out.tasks.set(t.key, { start: s, due, milestone })
      pending.delete(t.key)
      if (!last || due > last) last = due
    }
    return last ?? from
  }

  if (!stages.length) {
    const end = place(tasks, start)
    if (typeof end !== 'string') return end
    out.end = end
    return out
  }
  let from = start
  for (const st of stages) {
    const group = tasks.filter((t) => t.stage === st.key)
    let end: string
    if (group.length) {
      const e = place(group, from)
      if (typeof e !== 'string') return e
      end = e
    } else {
      end = addWorkdays(from, Math.max(1, st.duration_days ?? DEFAULT_STAGE_DAYS) - 1)
    }
    out.stages.set(st.key, { start: from, due: end })
    out.end = end
    from = nextWorkday(end)
  }
  return out
}
