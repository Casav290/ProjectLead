/** Les formes que rend l'API (voir server/routes/*). */

export type Me = {
  user: { id: string; email: string; name: string; color: string; role: 'admin' | 'manager' | 'member'; hourly_rate_cents: number
          capacity_minutes: number; lead_linked: boolean }
  account: { id: string; name: string; plan: string; timezone: string; currency: string; week_hours: number; inbound_token: string }
  unread: number; inbox: number
  running: { id: string; started_at: string; project_id: string; project_name: string; task_id: string | null; task_title: string | null } | null
  features: { leadId: boolean; mailboxes: boolean; crmlead: boolean; invoicelead: boolean }
  inboundAddress: string | null; inboundUrl: string; icalUrl: string
}

export type Person = { id: string; name: string; color: string; email?: string; role?: string }

export type Member = Person & { role: 'admin' | 'manager' | 'member'; active: boolean; hourly_rate_cents: number; cost_rate_cents: number
  capacity_minutes: number; team_ids: string[] }

export type Column = { id: string; name: string; position: number; is_done: boolean; wip_limit: number | null }

export type Stage = { id: string; project_id: string; name: string; description: string; client_note: string; position: number
  status: 'todo' | 'in_progress' | 'done' | 'blocked'; start_date: string | null; due_date: string | null; visible_to_client: boolean
  billing_cents: number | null; invoiced_at: string | null; completed_at: string | null; tasks_total: number; tasks_done: number }

export type ProjectSummary = {
  id: string; code: string | null; name: string; description: string; client_id: string | null; client_name: string | null
  owner_id: string | null; owner_name: string | null; team_id: string | null
  status: 'lead' | 'planned' | 'active' | 'on_hold' | 'done' | 'cancelled'; health: 'on_track' | 'at_risk' | 'off_track'
  priority: string; visibility: 'account' | 'members'; color: string; start_date: string | null; due_date: string | null
  budget_minutes: number | null; budget_cents: number | null; billing_mode: 'none' | 'hourly' | 'retainer' | 'fixed' | 'milestone'
  hourly_rate_cents: number | null; retainer_cents: number | null; fixed_cents: number | null; currency: string; vat_code: string
  is_template: boolean; source: string; portal_enabled: boolean; portal_show_tasks: boolean; portal_show_time: boolean
  update_frequency: 'none' | 'weekly' | 'biweekly' | 'monthly'; last_update_sent_at: string | null; archived_at: string | null
  tasks_total: number; tasks_done: number; tasks_late: number; minutes_spent: number; billable_cents: number
  stages_total: number; stages_done: number; current_stage: { id: string; name: string; status: string; due_date: string | null } | null
  members: (Person & { role: string })[]; created_at: string; updated_at: string; portal_token: string
}

export type Client = { id: string; kind: 'company' | 'person'; name: string; contact_person: string | null; email: string | null; phone: string | null
  street: string | null; building_number: string | null; postal_code: string | null; town: string | null; country: string; language: string
  vat_number: string | null; notes: string | null; external_ref: string | null; invoicelead_contact_id: string | null; archived_at: string | null
  projects?: number; active_projects?: number }

export type ClientContact = { id: string; client_id: string; name: string; email: string | null; phone: string | null; job_title: string | null; receives_updates: boolean }

export type ProjectDetail = ProjectSummary & {
  client: Client | null; contacts: ClientContact[]
  members_detail: (Person & { email: string; role: 'lead' | 'member' | 'observer'; hourly_rate_cents: number | null; minutes: number })[]
  columns: Column[]; stages: Stage[]
  last_update: { health: string; body: string; created_at: string; author_name: string } | null
  portal_url: string
}

export type Task = {
  id: string; project_id: string; project_name: string; project_color: string; project_code: string | null
  stage_id: string | null; stage_name: string | null; column_id: string | null; column_name: string | null; column_done: boolean | null
  parent_id: string | null; number: number; title: string; description: string; priority: 'low' | 'normal' | 'high' | 'urgent'
  start_date: string | null; due_date: string | null; estimate_minutes: number | null; position: number; is_milestone: boolean
  visible_to_client: boolean; recurrence: 'none' | 'daily' | 'weekly' | 'monthly'; tags: string[]; custom: Record<string, unknown>
  completed_at: string | null; created_at: string; assignees: Person[]; checklist_total: number; checklist_done: number
  subtasks_total: number; subtasks_done: number; comments: number; depends_on: string[]; blocked: boolean; minutes_spent: number
}

export type TaskDetail = Task & {
  checklist: { id: string; label: string; done: boolean; position: number }[]
  subtasks: Task[]
  dependencies: { id: string; title: string; number: number; completed_at: string | null }[]
  blocking: { id: string; title: string; number: number; completed_at: string | null }[]
  comment_list: { id: string; body: string; author_id: string | null; author_name: string | null; author_color: string | null; created_at: string; edited_at: string | null }[]
  files: { id: string; filename: string; mime: string; size: number; created_at: string }[]
  time: { id: string; entry_date: string; minutes: number; note: string; billable: boolean; user_name: string }[]
  activity: { kind: string; data: any; created_at: string; actor_name: string | null }[]
}

export type TimeEntry = { id: string; user_id: string; user_name: string; project_id: string; project_name: string; project_color: string
  task_id: string | null; task_title: string | null; client_name: string | null; entry_date: string; minutes: number | null
  started_at: string | null; billable: boolean; note: string; invoiced_at: string | null; invoice_ref: string | null }

export type Notification = { id: string; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }
