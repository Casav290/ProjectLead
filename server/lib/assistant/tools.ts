import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import * as z from 'zod/v4'
import type { Ctx } from '../../db.js'
import { callApi } from './internal.js'
import { opAllowed, signConfirm, type WriteOp } from './token.js'

/**
 * Les outils de l'assistant de ProjectLead. Chacun appelle une route existante (`callApi`, avec la session de la
 * personne) : mêmes droits que l'écran. Lecture : résultats réduits aux champs utiles, 50 lignes au plus.
 * Écriture : l'outil NE FAIT RIEN ; il prépare l'opération exacte, la signe (`signConfirm`) et la renvoie au navigateur
 * en carte « À confirmer ». Seul le clic « Confirmer » l'exécute (POST /api/assistant/confirm).
 * Aucun outil ne supprime, ne gère l'équipe, les membres d'un projet, l'abonnement ou les clés d'API, ni n'envoie
 * quoi que ce soit à l'extérieur.
 */

export type ConfirmAction = { type: 'confirm'; token: string; summary: { title: string; lines: string[] } }
export type NavigateAction = { type: 'navigate'; path: string }
export type AssistantAction = ConfirmAction | NavigateAction

export type ToolScope = { cookie: string; ctx: Ctx; actions: AssistantAction[]; used: string[] }

const MAX_ROWS = 50
const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-JJ')
const PRIORITY = z.enum(['low', 'normal', 'high', 'urgent'])
const PRIORITY_FR: Record<string, string> = { low: 'basse', normal: 'normale', high: 'haute', urgent: 'urgente' }
const STATUS_FR: Record<string, string> = { lead: 'à qualifier', planned: 'planifié', active: 'en cours', on_hold: 'en pause', done: 'terminé', cancelled: 'annulé' }
const HEALTH_FR: Record<string, string> = { on_track: 'dans les temps', at_risk: 'à risque', off_track: 'en retard' }

const clip = (v: unknown, n = 300) => {
  if (typeof v !== 'string') return v
  return v.length > n ? v.slice(0, n) + '…' : v
}
const hours = (m: number | null | undefined) => (m == null ? null : Math.round((m / 60) * 100) / 100)
const pick = <T extends Record<string, any>>(o: T, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

/** Le texte rendu au modèle : JSON compact, au plus ~14 000 caractères. */
const out = (v: unknown) => {
  const s = JSON.stringify(v)
  return s.length > 14_000 ? s.slice(0, 14_000) + '…(tronqué)' : s
}
const rows = (list: any[], map: (r: any) => unknown) => ({
  total: list.length, shown: Math.min(list.length, MAX_ROWS), rows: list.slice(0, MAX_ROWS).map(map),
})

/** Un refus de route, dit au modèle sans détail technique. */
const refusal = (status: number, body: any) => out({ error: body?.error ?? `http_${status}`, status,
  hint: status === 404 ? 'introuvable ou pas accessible à cette personne' : status === 403 ? 'le rôle de la personne ne le permet pas' : undefined })

/** Les pages de l'application vers lesquelles l'assistant peut ouvrir (open_page). */
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PAGES = [
  /^\/$/, /^\/taches$/, /^\/projets$/, /^\/modeles$/, /^\/emails$/, /^\/agenda$/, /^\/temps$/, /^\/charge$/, /^\/rapports$/,
  /^\/clients$/, /^\/facturation$/, /^\/recherche(\?q=[^#]{0,200})?$/,
  new RegExp(`^/projets/${ID}(/(tableau|liste|gantt|calendrier|etapes|temps|fichiers|activite|emails|suivi|reglages))?(\\?tache=${ID})?$`),
  new RegExp(`^/clients/${ID}$`),
  /^\/reglages(\/(profil|entreprise|equipe|emails|agendas|rendez-vous|formulaires|automatisations|integrations|api))?$/,
]
export const pageAllowed = (p: string) => PAGES.some((re) => re.test(p))

export function buildTools(s: ToolScope) {
  const get = (path: string) => callApi(s.cookie, 'GET', path)
  const mark = (name: string) => { s.used.push(name) }

  let teamCache: any[] | null = null
  const team = async () => {
    if (!teamCache) { const r = await get('/api/team'); teamCache = r.status === 200 ? r.body.members : [] }
    return teamCache!
  }
  const peopleNames = async (ids: string[] | undefined) => {
    if (!ids?.length) return ''
    const t = await team()
    return ids.map((id) => t.find((m) => m.id === id)?.name ?? 'personne inconnue').join(', ')
  }

  /** Prépare une écriture : rien n'est exécuté ici. */
  const propose = (tool: string, op: WriteOp, title: string, lines: (string | null | false | undefined)[]) => {
    if (!opAllowed(op)) return out({ error: 'operation_not_allowed' })
    const summary = { title, lines: lines.filter((l): l is string => Boolean(l)) }
    const token = signConfirm({ u: s.ctx.userId, a: s.ctx.accountId, op, summary })
    s.actions.push({ type: 'confirm', token, summary })
    return out({ proposed: true, status: 'waiting_for_user_confirmation',
      note: "Carte « À confirmer » affichée à la personne. RIEN n'est encore fait : ne dis pas que c'est fait ; dis-lui de vérifier puis de cliquer « Confirmer » (ou « Annuler »)." })
  }

  const project = async (id: string) => {
    const r = await get(`/api/projects/${id}`)
    return r.status === 200 ? r.body : null
  }

  const tools = [
    // ------------------------------------------------------------------ lecture
    betaZodTool({
      name: 'search',
      description: 'Recherche plein texte dans les projets, tâches et clients visibles par la personne (au moins 2 caractères).',
      inputSchema: z.object({ q: z.string().min(2).max(100) }),
      run: async ({ q }) => {
        mark('search')
        const r = await get(`/api/search?q=${encodeURIComponent(q)}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out({
          projects: r.body.projects.map((p: any) => pick(p, ['id', 'name', 'code', 'status'])),
          tasks: r.body.tasks.map((t: any) => ({ id: t.id, title: t.title, project_id: t.project_id, project: t.project_name, done: Boolean(t.completed_at) })),
          clients: r.body.clients.map((c: any) => pick(c, ['id', 'name', 'town'])),
        })
      },
    }),
    betaZodTool({
      name: 'dashboard',
      description: "L'accueil de la personne : compteurs de l'entreprise (projets en cours, à risque, en retard, demandes), ses tâches ouvertes, ses projets suivis, ses rendez-vous des 7 prochains jours, ses heures de la semaine.",
      inputSchema: z.object({}),
      run: async () => {
        mark('dashboard')
        const r = await get('/api/dashboard')
        if (r.status !== 200) return refusal(r.status, r.body)
        const d = r.body
        return out({
          counts: d.counts,
          my_open_tasks: rows(d.myTasks, (t: any) => ({ id: t.id, title: t.title, due_date: t.due_date, priority: t.priority, project_id: t.project_id, project: t.project_name })),
          projects: rows(d.projects, (p: any) => ({ id: p.id, name: p.name, code: p.code, status: p.status, health: p.health, due_date: p.due_date,
            client: p.client_name, tasks: `${p.tasks_done}/${p.tasks_total}`, tasks_late: p.tasks_late, hours_spent: hours(p.minutes_spent), budget_hours: hours(p.budget_minutes) })),
          events_next_7_days: d.events.map((e: any) => pick(e, ['title', 'starts_at', 'ends_at', 'location', 'project_name'])),
          my_hours_this_week: hours(d.week.reduce((a: number, w: any) => a + w.minutes, 0)),
        })
      },
    }),
    betaZodTool({
      name: 'list_projects',
      description: 'Liste les projets visibles (hors modèles et archives), avec avancement, retard, temps passé, budget et étape en cours. Filtres facultatifs.',
      inputSchema: z.object({
        status: z.enum(['lead', 'planned', 'active', 'on_hold', 'done', 'cancelled']).optional(),
        q: z.string().max(100).optional().describe('texte dans le nom, le code ou le client'),
        mine: z.boolean().optional().describe('seulement ceux où la personne intervient'),
        client_id: UUID.optional(),
      }),
      run: async (a) => {
        mark('list_projects')
        const qs = new URLSearchParams()
        if (a.status) qs.set('status', a.status)
        if (a.q) qs.set('q', a.q)
        if (a.mine) qs.set('mine', '1')
        if (a.client_id) qs.set('client', a.client_id)
        const r = await get(`/api/projects?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (p: any) => ({
          id: p.id, code: p.code, name: p.name, status: p.status, health: p.health, priority: p.priority, client: p.client_name, owner: p.owner_name,
          start_date: p.start_date, due_date: p.due_date, tasks_done: p.tasks_done, tasks_total: p.tasks_total, tasks_late: p.tasks_late,
          hours_spent: hours(p.minutes_spent), budget_hours: hours(p.budget_minutes), current_stage: p.current_stage?.name ?? null,
        })))
      },
    }),
    betaZodTool({
      name: 'get_project',
      description: "La fiche d'un projet : description, client, intervenants (avec leur rôle et leurs heures), étapes, colonnes du tableau, dernier point d'avancement.",
      inputSchema: z.object({ project_id: UUID }),
      run: async ({ project_id }) => {
        mark('get_project')
        const r = await get(`/api/projects/${project_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const p = r.body
        return out({
          ...pick(p, ['id', 'code', 'name', 'status', 'health', 'priority', 'visibility', 'start_date', 'due_date', 'billing_mode', 'currency']),
          description: clip(p.description, 1500), client: p.client ? { id: p.client.id, name: p.client.name } : null,
          owner: p.owner_name, budget_hours: hours(p.budget_minutes), hours_spent: hours(p.minutes_spent),
          tasks_done: p.tasks_done, tasks_total: p.tasks_total, tasks_late: p.tasks_late,
          members: p.members_detail.map((m: any) => ({ id: m.id, name: m.name, role: m.role, hours: hours(m.minutes) })),
          stages: p.stages.map((st: any) => ({ id: st.id, name: st.name, status: st.status, due_date: st.due_date, tasks: `${st.tasks_done}/${st.tasks_total}` })),
          columns: p.columns.map((c: any) => ({ id: c.id, name: c.name, is_done: c.is_done })),
          last_update: p.last_update ? { health: p.last_update.health, body: clip(p.last_update.body, 600), author: p.last_update.author_name, at: p.last_update.created_at } : null,
        })
      },
    }),
    betaZodTool({
      name: 'list_tasks',
      description: "Liste des tâches visibles (hors projets archivés et modèles). Filtres : projet, personne assignée ('me' = la personne connectée, ou l'id d'un membre), ouvertes/terminées, échéance (en retard, aujourd'hui, cette semaine), période, texte.",
      inputSchema: z.object({
        project_id: UUID.optional(),
        assignee: z.string().max(40).optional().describe("'me' ou l'id d'un membre"),
        status: z.enum(['open', 'done']).optional(),
        due: z.enum(['overdue', 'today', 'week']).optional(),
        from: DATE.optional(), to: DATE.optional(),
        q: z.string().max(100).optional(),
      }),
      run: async (a) => {
        mark('list_tasks')
        const qs = new URLSearchParams()
        if (a.project_id) qs.set('project', a.project_id)
        if (a.assignee) qs.set('assignee', a.assignee)
        if (a.status) qs.set('status', a.status)
        if (a.due) qs.set('due', a.due)
        if (a.from) qs.set('from', a.from)
        if (a.to) qs.set('to', a.to)
        if (a.q) qs.set('q', a.q)
        const r = await get(`/api/tasks?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (t: any) => ({
          id: t.id, number: t.number, title: t.title, project_id: t.project_id, project: t.project_name, due_date: t.due_date, start_date: t.start_date,
          priority: t.priority, done: Boolean(t.completed_at), column: t.column_name, stage: t.stage_name, blocked: t.blocked,
          assignees: t.assignees.map((p: any) => p.name), estimate_hours: hours(t.estimate_minutes), hours_spent: hours(t.minutes_spent),
        })))
      },
    }),
    betaZodTool({
      name: 'get_task',
      description: "Le détail d'une tâche : description, liste de contrôle, sous-tâches, dépendances, derniers commentaires, temps saisi.",
      inputSchema: z.object({ task_id: UUID }),
      run: async ({ task_id }) => {
        mark('get_task')
        const r = await get(`/api/tasks/${task_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const t = r.body
        return out({
          id: t.id, number: t.number, title: t.title, project_id: t.project_id, project: t.project_name, description: clip(t.description, 1500),
          priority: t.priority, start_date: t.start_date, due_date: t.due_date, done: Boolean(t.completed_at), column: t.column_name, stage: t.stage_name,
          assignees: t.assignees.map((p: any) => ({ id: p.id, name: p.name })), blocked: t.blocked, estimate_hours: hours(t.estimate_minutes),
          checklist: t.checklist.slice(0, MAX_ROWS).map((i: any) => ({ label: i.label, done: i.done })),
          subtasks: t.subtasks.slice(0, MAX_ROWS).map((x: any) => ({ id: x.id, title: x.title, done: Boolean(x.completed_at) })),
          depends_on: t.dependencies.map((x: any) => ({ id: x.id, title: x.title, done: Boolean(x.completed_at) })),
          comments: t.comment_list.slice(-10).map((cm: any) => ({ author: cm.author_name, at: cm.created_at, body: clip(cm.body, 400) })),
          time: t.time.slice(0, 20).map((e: any) => ({ date: e.entry_date, hours: hours(e.minutes), person: e.user_name, note: clip(e.note, 120) })),
        })
      },
    }),
    betaZodTool({
      name: 'list_team',
      description: "Les membres de l'entreprise (lecture seule) : id, nom, rôle, actif, équipes. Sert à trouver l'id d'une personne pour l'assigner.",
      inputSchema: z.object({}),
      run: async () => {
        mark('list_team')
        const r = await get('/api/team')
        if (r.status !== 200) return refusal(r.status, r.body)
        const teams = new Map<string, string>(r.body.teams.map((t: any) => [t.id, t.name]))
        teamCache = r.body.members
        return out(rows(r.body.members, (m: any) => ({ id: m.id, name: m.name, role: m.role, active: m.active,
          teams: (m.team_ids ?? []).map((id: string) => teams.get(id)).filter(Boolean) })))
      },
    }),
    betaZodTool({
      name: 'list_clients',
      description: "Les clients de l'entreprise (nom, localité, nombre de projets), avec une recherche facultative.",
      inputSchema: z.object({ q: z.string().max(100).optional() }),
      run: async ({ q }) => {
        mark('list_clients')
        const r = await get(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (c: any) => ({ id: c.id, name: c.name, kind: c.kind, town: c.town, country: c.country, projects: c.projects, active_projects: c.active_projects })))
      },
    }),
    betaZodTool({
      name: 'list_time_entries',
      description: "Les saisies de temps (heures) : par défaut celles de la personne connectée. user = 'me', 'all' (toute l'entreprise, selon les droits) ou l'id d'un membre. Totaux en heures.",
      inputSchema: z.object({ from: DATE.optional(), to: DATE.optional(), user: z.string().max(40).optional(), project_id: UUID.optional() }),
      run: async (a) => {
        mark('list_time_entries')
        const qs = new URLSearchParams()
        if (a.from) qs.set('from', a.from)
        if (a.to) qs.set('to', a.to)
        if (a.user) qs.set('user', a.user)
        if (a.project_id) qs.set('project', a.project_id)
        const r = await get(`/api/time/entries?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const done = r.body.filter((e: any) => e.minutes != null)
        return out({
          total_hours: hours(done.reduce((s: number, e: any) => s + e.minutes, 0)),
          billable_hours: hours(done.filter((e: any) => e.billable).reduce((s: number, e: any) => s + e.minutes, 0)),
          ...rows(r.body, (e: any) => ({ date: e.entry_date, hours: hours(e.minutes), running: e.minutes == null, person: e.user_name,
            project: e.project_name, task: e.task_title, client: e.client_name, billable: e.billable, invoiced: Boolean(e.invoiced_at), note: clip(e.note, 120) })),
        })
      },
    }),
    betaZodTool({
      name: 'time_report',
      description: 'Rapport du temps regroupé (par projet, personne, client, mois ou tâche) : heures, heures facturables, montant facturable et coût (centimes), heures facturées.',
      inputSchema: z.object({
        group: z.enum(['project', 'user', 'client', 'month', 'task']).default('project'),
        from: DATE.optional(), to: DATE.optional(), project_id: UUID.optional(), user_id: UUID.optional(),
      }),
      run: async (a) => {
        mark('time_report')
        const qs = new URLSearchParams({ group: a.group })
        if (a.from) qs.set('from', a.from)
        if (a.to) qs.set('to', a.to)
        if (a.project_id) qs.set('project', a.project_id)
        if (a.user_id) qs.set('user', a.user_id)
        const r = await get(`/api/time/report?${qs}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return out(rows(r.body, (x: any) => ({ label: x.label, hours: hours(x.minutes), billable_hours: hours(x.billable_minutes),
          billable_cents: x.billable_cents, cost_cents: x.cost_cents, invoiced_hours: hours(x.invoiced_minutes) })))
      },
    }),
    betaZodTool({
      name: 'workload',
      description: "Charge de travail par personne et par semaine à partir d'un lundi : heures estimées des tâches ouvertes face à la capacité, tâches en retard, heures saisies.",
      inputSchema: z.object({ from: DATE.describe('un lundi'), weeks: z.number().int().min(1).max(12).default(4) }),
      run: async (a) => {
        mark('workload')
        const r = await get(`/api/time/workload?from=${a.from}&weeks=${a.weeks}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const d = r.body
        return out(rows(d.people, (p: any) => ({
          id: p.id, name: p.name, capacity_hours_per_week: hours(p.capacity_minutes),
          planned_hours_by_week: Array.from({ length: d.weeks }, (_, w) => hours(d.load.find((l: any) => l.user_id === p.id && l.week === w)?.minutes ?? 0)),
          logged_hours_by_week: Array.from({ length: d.weeks }, (_, w) => hours(d.logged.find((l: any) => l.user_id === p.id && l.week === w)?.minutes ?? 0)),
          overdue_tasks: d.overdue.find((o: any) => o.user_id === p.id)?.tasks ?? 0,
        })))
      },
    }),
    betaZodTool({
      name: 'list_events',
      description: "Les rendez-vous de l'agenda entre deux dates (ceux de la personne, ou toute l'entreprise si scope='all').",
      inputSchema: z.object({ from: DATE, to: DATE, scope: z.enum(['mine', 'all']).default('mine') }),
      run: async (a) => {
        mark('list_events')
        const r = await get(`/api/calendar/events?from=${a.from}&to=${a.to}${a.scope === 'all' ? '&scope=all' : ''}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const list = Array.isArray(r.body) ? r.body : (r.body.events ?? [])
        return out(rows(list, (e: any) => ({ title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, location: e.location,
          project: e.project_name, client: e.client_name, organizer: e.organizer_name })))
      },
    }),
    betaZodTool({
      name: 'open_page',
      description: "Ouvre une page de ProjectLead dans le navigateur de la personne. Chemins : / (accueil), /taches, /projets, /projets/<id>[/tableau|liste|gantt|calendrier|etapes|temps|fichiers|activite|emails|suivi|reglages][?tache=<id>], /modeles, /emails, /agenda, /temps, /charge, /rapports, /clients, /clients/<id>, /facturation, /recherche?q=…, /reglages[/profil|entreprise|equipe|emails|agendas|rendez-vous|formulaires|automatisations|integrations|api].",
      inputSchema: z.object({ path: z.string().max(300) }),
      run: async ({ path }) => {
        mark('open_page')
        if (!pageAllowed(path)) return out({ error: 'unknown_page' })
        if (!s.actions.some((x) => x.type === 'navigate')) s.actions.push({ type: 'navigate', path })
        return out({ opened: path })
      },
    }),

    // ------------------------------------------------------------------ écriture, en deux temps
    betaZodTool({
      name: 'propose_create_task',
      description: 'Prépare la création d’une tâche dans un projet (carte « À confirmer » ; rien n’est créé avant le clic de la personne).',
      inputSchema: z.object({
        project_id: UUID, title: z.string().trim().min(1).max(500), description: z.string().max(5000).optional(),
        due_date: DATE.optional(), start_date: DATE.optional(), priority: PRIORITY.optional(),
        assignee_ids: z.array(UUID).max(10).optional(), stage_id: UUID.optional(), estimate_minutes: z.number().int().min(0).max(100_000).optional(),
        is_milestone: z.boolean().optional(),
      }),
      run: async (a) => {
        mark('propose_create_task')
        const p = await project(a.project_id)
        if (!p) return out({ error: 'project_not_found' })
        const stage = a.stage_id ? p.stages.find((x: any) => x.id === a.stage_id) : null
        if (a.stage_id && !stage) return out({ error: 'stage_not_in_project' })
        return propose('propose_create_task', { method: 'POST', path: '/api/tasks', body: { ...a } }, 'Créer une tâche', [
          `Tâche : « ${a.title} »`, `Projet : ${p.name}`,
          a.description && `Description : ${clip(a.description, 200)}`,
          a.start_date && `Début : ${a.start_date}`, a.due_date && `Échéance : ${a.due_date}`,
          a.priority && `Priorité : ${PRIORITY_FR[a.priority]}`, stage && `Étape : ${stage.name}`,
          a.assignee_ids?.length && `Assignée à : ${await peopleNames(a.assignee_ids)}`,
          a.estimate_minutes != null && `Estimation : ${hours(a.estimate_minutes)} h`, a.is_milestone && 'Jalon',
        ])
      },
    }),
    betaZodTool({
      name: 'propose_update_task',
      description: 'Prépare la modification d’une tâche : titre, description, dates, priorité, personnes assignées (liste complète qui remplace l’actuelle), terminée ou rouverte.',
      inputSchema: z.object({
        task_id: UUID, title: z.string().trim().min(1).max(500).optional(), description: z.string().max(5000).optional(),
        due_date: DATE.nullable().optional(), start_date: DATE.nullable().optional(), priority: PRIORITY.optional(),
        assignee_ids: z.array(UUID).max(10).optional(), completed: z.boolean().optional(),
        estimate_minutes: z.number().int().min(0).max(100_000).nullable().optional(),
      }),
      run: async ({ task_id, ...patch }) => {
        mark('propose_update_task')
        const r = await get(`/api/tasks/${task_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        const t = r.body
        if (!Object.keys(patch).length) return out({ error: 'nothing_to_change' })
        return propose('propose_update_task', { method: 'PATCH', path: `/api/tasks/${task_id}`, body: patch }, 'Modifier une tâche', [
          `Tâche : « ${t.title} » (${t.project_name})`,
          patch.title && `Nouveau titre : « ${patch.title} »`, patch.description !== undefined && `Description : ${clip(patch.description, 200) || '(vide)'}`,
          patch.start_date !== undefined && `Début : ${patch.start_date ?? 'aucun'} (avant : ${t.start_date ?? 'aucun'})`,
          patch.due_date !== undefined && `Échéance : ${patch.due_date ?? 'aucune'} (avant : ${t.due_date ?? 'aucune'})`,
          patch.priority && `Priorité : ${PRIORITY_FR[patch.priority]} (avant : ${PRIORITY_FR[t.priority] ?? t.priority})`,
          patch.assignee_ids && `Assignée à : ${(await peopleNames(patch.assignee_ids)) || 'personne'} (avant : ${t.assignees.map((x: any) => x.name).join(', ') || 'personne'})`,
          patch.completed !== undefined && (patch.completed ? 'Marquer comme terminée' : 'Rouvrir la tâche'),
          patch.estimate_minutes !== undefined && `Estimation : ${patch.estimate_minutes == null ? 'aucune' : hours(patch.estimate_minutes) + ' h'}`,
        ])
      },
    }),
    betaZodTool({
      name: 'propose_add_task_comment',
      description: 'Prépare un commentaire sur une tâche (les @Prénom Nom cités sont notifiés dans ProjectLead).',
      inputSchema: z.object({ task_id: UUID, body: z.string().trim().min(1).max(5000) }),
      run: async ({ task_id, body }) => {
        mark('propose_add_task_comment')
        const r = await get(`/api/tasks/${task_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return propose('propose_add_task_comment', { method: 'POST', path: `/api/tasks/${task_id}/comments`, body: { body } }, 'Commenter une tâche',
          [`Tâche : « ${r.body.title} » (${r.body.project_name})`, `Commentaire : ${clip(body, 400)}`])
      },
    }),
    betaZodTool({
      name: 'propose_add_checklist_item',
      description: 'Prépare l’ajout d’un point à la liste de contrôle d’une tâche.',
      inputSchema: z.object({ task_id: UUID, label: z.string().trim().min(1).max(300) }),
      run: async ({ task_id, label }) => {
        mark('propose_add_checklist_item')
        const r = await get(`/api/tasks/${task_id}`)
        if (r.status !== 200) return refusal(r.status, r.body)
        return propose('propose_add_checklist_item', { method: 'POST', path: `/api/tasks/${task_id}/checklist`, body: { label } }, 'Ajouter un point de contrôle',
          [`Tâche : « ${r.body.title} » (${r.body.project_name})`, `Point : ${label}`])
      },
    }),
    betaZodTool({
      name: 'propose_create_project',
      description: 'Prépare la création d’un projet (éventuellement depuis un modèle : template_id). La personne connectée en est la responsable.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), client_id: UUID.optional(),
        status: z.enum(['lead', 'planned', 'active', 'on_hold']).optional(), priority: PRIORITY.optional(),
        start_date: DATE.optional(), due_date: DATE.optional(), budget_minutes: z.number().int().min(0).max(10_000_000).optional(),
        template_id: UUID.optional(),
      }),
      run: async (a) => {
        mark('propose_create_project')
        let client: string | null = null
        if (a.client_id) {
          const r = await get(`/api/clients/${a.client_id}`)
          if (r.status !== 200) return out({ error: 'client_not_found' })
          client = r.body.name
        }
        let template: string | null = null
        if (a.template_id) {
          const t = await project(a.template_id)
          if (!t || !t.is_template) return out({ error: 'template_not_found' })
          template = t.name
        }
        return propose('propose_create_project', { method: 'POST', path: '/api/projects', body: { ...a } }, 'Créer un projet', [
          `Projet : « ${a.name} »`, client && `Client : ${client}`, template && `Depuis le modèle : ${template}`,
          `Statut : ${STATUS_FR[a.status ?? 'planned'] ?? a.status}`, a.priority && `Priorité : ${PRIORITY_FR[a.priority]}`,
          a.start_date && `Début : ${a.start_date}`, a.due_date && `Échéance : ${a.due_date}`,
          a.budget_minutes != null && `Budget : ${hours(a.budget_minutes)} h`, a.description && `Description : ${clip(a.description, 200)}`,
        ])
      },
    }),
    betaZodTool({
      name: 'propose_update_project',
      description: 'Prépare la modification d’un projet : nom, description, statut, santé, priorité, dates, budget en heures. (Ni visibilité, ni facturation, ni suivi client, ni intervenants : ces réglages se font dans l’écran du projet.)',
      inputSchema: z.object({
        project_id: UUID, name: z.string().trim().min(1).max(200).optional(), description: z.string().max(5000).optional(),
        status: z.enum(['lead', 'planned', 'active', 'on_hold', 'done', 'cancelled']).optional(),
        health: z.enum(['on_track', 'at_risk', 'off_track']).optional(), priority: PRIORITY.optional(),
        start_date: DATE.nullable().optional(), due_date: DATE.nullable().optional(),
        budget_minutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
      }),
      run: async ({ project_id, ...patch }) => {
        mark('propose_update_project')
        const p = await project(project_id)
        if (!p) return out({ error: 'project_not_found' })
        if (!Object.keys(patch).length) return out({ error: 'nothing_to_change' })
        return propose('propose_update_project', { method: 'PATCH', path: `/api/projects/${project_id}`, body: patch }, 'Modifier un projet', [
          `Projet : ${p.name}`, patch.name && `Nouveau nom : « ${patch.name} »`,
          patch.status && `Statut : ${STATUS_FR[patch.status]} (avant : ${STATUS_FR[p.status] ?? p.status})`,
          patch.health && `Santé : ${HEALTH_FR[patch.health]} (avant : ${HEALTH_FR[p.health] ?? p.health})`,
          patch.priority && `Priorité : ${PRIORITY_FR[patch.priority]}`,
          patch.start_date !== undefined && `Début : ${patch.start_date ?? 'aucun'} (avant : ${p.start_date ?? 'aucun'})`,
          patch.due_date !== undefined && `Échéance : ${patch.due_date ?? 'aucune'} (avant : ${p.due_date ?? 'aucune'})`,
          patch.budget_minutes !== undefined && `Budget : ${patch.budget_minutes == null ? 'aucun' : hours(patch.budget_minutes) + ' h'}`,
          patch.description !== undefined && `Description : ${clip(patch.description, 200) || '(vide)'}`,
        ])
      },
    }),
    betaZodTool({
      name: 'propose_project_update',
      description: "Prépare un point d'avancement interne sur un projet (santé + texte). Il n'est PAS partagé avec le client.",
      inputSchema: z.object({ project_id: UUID, health: z.enum(['on_track', 'at_risk', 'off_track']), body: z.string().trim().max(5000).default('') }),
      run: async (a) => {
        mark('propose_project_update')
        const p = await project(a.project_id)
        if (!p) return out({ error: 'project_not_found' })
        return propose('propose_project_update', { method: 'POST', path: `/api/projects/${a.project_id}/updates`,
          body: { health: a.health, body: a.body, share_with_client: false } }, "Publier un point d'avancement", [
          `Projet : ${p.name}`, `Santé : ${HEALTH_FR[a.health]}`, a.body && `Texte : ${clip(a.body, 400)}`, 'Interne : non partagé avec le client',
        ])
      },
    }),
    betaZodTool({
      name: 'propose_log_time',
      description: 'Prépare une saisie de temps pour la personne connectée (minutes entières, 1 à 1440) sur un projet, et éventuellement une tâche de ce projet.',
      inputSchema: z.object({
        project_id: UUID, task_id: UUID.optional(), entry_date: DATE, minutes: z.number().int().min(1).max(1440),
        note: z.string().max(2000).optional(), billable: z.boolean().optional(),
      }),
      run: async (a) => {
        mark('propose_log_time')
        const p = await project(a.project_id)
        if (!p) return out({ error: 'project_not_found' })
        let task: string | null = null
        if (a.task_id) {
          const r = await get(`/api/tasks/${a.task_id}`)
          if (r.status !== 200 || r.body.project_id !== a.project_id) return out({ error: 'task_not_in_project' })
          task = r.body.title
        }
        const body = { project_id: a.project_id, task_id: a.task_id ?? null, entry_date: a.entry_date, minutes: a.minutes,
          note: a.note ?? '', billable: a.billable ?? true }
        return propose('propose_log_time', { method: 'POST', path: '/api/time/entries', body }, 'Saisir du temps', [
          `Projet : ${p.name}`, task && `Tâche : « ${task} »`, `Date : ${a.entry_date}`,
          `Durée : ${Math.floor(a.minutes / 60)} h ${String(a.minutes % 60).padStart(2, '0')}`,
          a.note && `Note : ${clip(a.note, 200)}`, p.billing_mode === 'none' ? 'Non facturable (projet non facturable)' : `Facturable : ${body.billable ? 'oui' : 'non'}`,
        ])
      },
    }),
    betaZodTool({
      name: 'propose_timer',
      description: 'Prépare le démarrage du chronomètre de la personne sur un projet (et une tâche), ou son arrêt (action stop).',
      inputSchema: z.object({ action: z.enum(['start', 'stop']), project_id: UUID.optional(), task_id: UUID.optional(), note: z.string().max(2000).optional() }),
      run: async (a) => {
        mark('propose_timer')
        if (a.action === 'stop') return propose('propose_timer', { method: 'POST', path: '/api/time/timer/stop', body: {} }, 'Arrêter le chronomètre', ['Le temps écoulé est enregistré.'])
        if (!a.project_id) return out({ error: 'project_id_required' })
        const p = await project(a.project_id)
        if (!p) return out({ error: 'project_not_found' })
        let task: string | null = null
        if (a.task_id) {
          const r = await get(`/api/tasks/${a.task_id}`)
          if (r.status !== 200 || r.body.project_id !== a.project_id) return out({ error: 'task_not_in_project' })
          task = r.body.title
        }
        return propose('propose_timer', { method: 'POST', path: '/api/time/timer/start',
          body: { project_id: a.project_id, task_id: a.task_id ?? null, note: a.note ?? '' } }, 'Démarrer le chronomètre',
          [`Projet : ${p.name}`, task && `Tâche : « ${task} »`, 'Un chronomètre déjà lancé est arrêté et enregistré.'])
      },
    }),
    betaZodTool({
      name: 'propose_create_client',
      description: 'Prépare la création d’une fiche client (entreprise ou personne).',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200), kind: z.enum(['company', 'person']).default('company'),
        contact_person: z.string().trim().max(200).optional(), email: z.string().trim().email().max(254).optional(),
        phone: z.string().trim().max(50).optional(), street: z.string().trim().max(70).optional(), building_number: z.string().trim().max(16).optional(),
        postal_code: z.string().trim().max(16).optional(), town: z.string().trim().max(35).optional(),
        country: z.string().regex(/^[A-Z]{2}$/).default('CH'), language: z.enum(['fr', 'de', 'it', 'en', 'es']).default('fr'),
      }),
      run: async (a) => {
        mark('propose_create_client')
        return propose('propose_create_client', { method: 'POST', path: '/api/clients', body: { ...a } }, 'Créer un client', [
          `Client : ${a.name} (${a.kind === 'person' ? 'personne' : 'entreprise'})`, a.contact_person && `Contact : ${a.contact_person}`,
          a.email && `Email : ${a.email}`, a.phone && `Téléphone : ${a.phone}`,
          (a.street || a.town) && `Adresse : ${[a.street && `${a.street} ${a.building_number ?? ''}`.trim(), [a.postal_code, a.town].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`,
          `Pays : ${a.country}`,
        ])
      },
    }),
  ]
  return tools
}

export const TOOL_NAMES = ['search', 'dashboard', 'list_projects', 'get_project', 'list_tasks', 'get_task', 'list_team', 'list_clients',
  'list_time_entries', 'time_report', 'workload', 'list_events', 'open_page', 'propose_create_task', 'propose_update_task',
  'propose_add_task_comment', 'propose_add_checklist_item', 'propose_create_project', 'propose_update_project', 'propose_project_update',
  'propose_log_time', 'propose_timer', 'propose_create_client'] as const
