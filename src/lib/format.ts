/** Dates, durées et montants, dans la langue de l'interface (src/i18n). */
import { intlLocale, labels, t } from '../i18n'


export const fmtDate = (d?: string | null) => {
  if (!d) return ''
  const s = d.slice(0, 10)
  return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(s + 'T12:00:00'))
}
export const fmtShortDate = (d?: string | null) => {
  if (!d) return ''
  const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d)
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' }).format(dt)
}
export const fmtDateTime = (d?: string | null) =>
  d ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) : ''
export const fmtTime = (d?: string | null) =>
  d ? new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : ''
export const fmtRelative = (d?: string | null) => {
  if (!d) return ''
  const diff = (Date.now() - new Date(d).getTime()) / 1000
  if (diff < 60) return t('time.justNow')
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) })
  if (diff < 7 * 86400) return t('time.daysAgo', { n: Math.floor(diff / 86400) })
  return fmtDate(d)
}

/** 90 → « 1 h 30 ». */
export const fmtMinutes = (m?: number | null) => {
  if (!m) return '0 h'
  const h = Math.floor(m / 60), r = m % 60
  return h ? (r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`) : `${r} min`
}
/** 90 → « 1,5 ». */
export const hours = (m?: number | null) => ((m ?? 0) / 60).toLocaleString(intlLocale(), { maximumFractionDigits: 2 })
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
  `${currency} ${((cents ?? 0) / 100).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
export const weekdayShort = (d: string) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(new Date(d + 'T12:00:00'))

export const STATUS_LABEL = labels('status', ['lead', 'planned', 'active', 'on_hold', 'done', 'cancelled'])
export const HEALTH_LABEL = labels('health', ['on_track', 'at_risk', 'off_track'])
export const STAGE_LABEL = labels('stage', ['todo', 'in_progress', 'done', 'blocked'])
export const PRIORITY_LABEL = labels('priority', ['low', 'normal', 'high', 'urgent'])
export const BILLING_LABEL = labels('billing', ['none', 'hourly', 'retainer', 'fixed', 'milestone'])
export const ROLE_LABEL = labels('role', ['admin', 'manager', 'member'])
export const PROJECT_ROLE_LABEL = labels('projectRole', ['lead', 'member', 'observer'])
