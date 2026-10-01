/** Dates, durées et montants, à la suisse romande. */

export const fmtDate = (d?: string | null) => {
  if (!d) return ''
  const s = d.slice(0, 10)
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`
}
export const fmtShortDate = (d?: string | null) => {
  if (!d) return ''
  const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d)
  return new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short' }).format(dt)
}
export const fmtDateTime = (d?: string | null) =>
  d ? new Intl.DateTimeFormat('fr-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) : ''
export const fmtTime = (d?: string | null) =>
  d ? new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : ''
export const fmtRelative = (d?: string | null) => {
  if (!d) return ''
  const diff = (Date.now() - new Date(d).getTime()) / 1000
  if (diff < 60) return "à l'instant"
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`
  if (diff < 7 * 86400) return `il y a ${Math.floor(diff / 86400)} j`
  return fmtDate(d)
}

/** 90 → « 1 h 30 ». */
export const fmtMinutes = (m?: number | null) => {
  if (!m) return '0 h'
  const h = Math.floor(m / 60), r = m % 60
  return h ? (r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`) : `${r} min`
}
/** 90 → « 1,5 ». */
export const hours = (m?: number | null) => ((m ?? 0) / 60).toLocaleString('fr-CH', { maximumFractionDigits: 2 })
/** « 1.5 », « 1:30 », « 1h30 », « 90m » → minutes. */
export const parseDuration = (s: string): number | null => {
  const t = s.trim().toLowerCase().replace(',', '.')
  if (!t) return null
  let m = t.match(/^(\d+):(\d{1,2})$/)
  if (m) return +m[1] * 60 + +m[2]
  m = t.match(/^(\d+)\s*h\s*(\d{1,2})?$/)
  if (m) return +m[1] * 60 + +(m[2] ?? 0)
  m = t.match(/^(\d+)\s*(m|min)$/)
  if (m) return +m[1]
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null
}

export const money = (cents?: number | null, currency = 'CHF') =>
  `${currency} ${((cents ?? 0) / 100).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** « 150 », « 150.50 », « 150,50 » → centimes. */
export const parseMoney = (s: string): number | null => {
  const t = s.trim().replace(/[’'\s]/g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00')
  x.setDate(x.getDate() + n)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
export const mondayOf = (d: string) => {
  const x = new Date(d + 'T12:00:00')
  return addDays(d, -((x.getDay() + 6) % 7))
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400e3)
export const weekdayShort = (d: string) => new Intl.DateTimeFormat('fr-CH', { weekday: 'short' }).format(new Date(d + 'T12:00:00'))

export const STATUS_LABEL: Record<string, string> = {
  lead: 'À qualifier', planned: 'Planifié', active: 'En cours', on_hold: 'En pause', done: 'Terminé', cancelled: 'Abandonné',
}
export const HEALTH_LABEL: Record<string, string> = { on_track: 'Dans les temps', at_risk: 'À surveiller', off_track: 'En retard' }
export const STAGE_LABEL: Record<string, string> = { todo: 'À venir', in_progress: 'En cours', done: 'Terminée', blocked: 'En attente' }
export const PRIORITY_LABEL: Record<string, string> = { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' }
export const BILLING_LABEL: Record<string, string> = {
  none: 'Non facturable', hourly: "À l'heure", retainer: 'Forfait mensuel', fixed: 'Forfait global', milestone: 'Par étape',
}
export const ROLE_LABEL: Record<string, string> = { admin: 'Administrateur', manager: 'Responsable', member: 'Membre' }
export const PROJECT_ROLE_LABEL: Record<string, string> = { lead: 'Chef de projet', member: 'Intervenant', observer: 'Observateur' }
