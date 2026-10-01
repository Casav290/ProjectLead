import { localInstant } from './time.js'

/**
 * Lire l'agenda d'un vendeur depuis son adresse iCal secrète (Google Agenda, iCloud,
 * Outlook, Infomaniak la donnent toutes), sans OAuth ni validation Google.
 *
 * On n'en garde que ce dont CRMlead a besoin : quand le vendeur est occupé, et le titre
 * pour l'afficher dans son Agenda. Les répétitions courantes (quotidienne, hebdomadaire
 * avec jours, mensuelle, annuelle ; INTERVAL, COUNT, UNTIL, EXDATE) sont déroulées sur la
 * fenêtre demandée. Un événement « disponible » (TRANSP:TRANSPARENT) ou annulé est ignoré.
 */

export type ExternalEvent = { uid: string; start: Date; end: Date; summary: string; allDay: boolean }

type Prop = { name: string; params: Record<string, string>; value: string }

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function parseProp(line: string): Prop | null {
  const i = line.indexOf(':')
  if (i < 0) return null
  const [head, value] = [line.slice(0, i), line.slice(i + 1)]
  const [name, ...rest] = head.split(';')
  const params: Record<string, string> = {}
  for (const r of rest) { const [k, v] = r.split('='); if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, '') }
  return { name: name.toUpperCase(), params, value }
}

const unescape = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()

/** DTSTART/DTEND/EXDATE → instant. `Z` = UTC ; TZID = fuseau ; sans rien = heure de Zurich. */
function parseDate(p: Prop, fallbackTz: string): { at: Date; allDay: boolean } | null {
  const v = p.value.trim()
  const d = v.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (d || p.params.VALUE === 'DATE') {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/)
    if (!m) return null
    const at = localInstant(`${m[1]}-${m[2]}-${m[3]}`, '00:00', fallbackTz)
    return at ? { at, allDay: true } : null
  }
  const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (!t) return null
  if (t[7]) return { at: new Date(Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +(t[6] ?? 0))), allDay: false }
  const tz = validTz(p.params.TZID) ?? fallbackTz
  const at = localInstant(`${t[1]}-${t[2]}-${t[3]}`, `${t[4]}:${t[5]}`, tz)
  return at ? { at, allDay: false } : null
}

function validTz(tz?: string) {
  if (!tz) return null
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz } catch { return null }
}

/** PT1H30M, P1D… en millisecondes. */
function duration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return 0
  const ms = (+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400e3 + +(m[4] ?? 0) * 3600e3 + +(m[5] ?? 0) * 60e3 + +(m[6] ?? 0) * 1e3
  return m[1] === '-' ? -ms : ms
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Les occurrences d'une règle de répétition qui tombent dans [from, to]. */
function expand(start: Date, rule: string, from: Date, to: Date, exdates: Set<number>, tz: string): Date[] {
  const r = Object.fromEntries(rule.split(';').map((x) => x.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.toUpperCase(), v]))
  const freq = r.FREQ
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return start >= from && start <= to ? [start] : []
  const interval = Math.max(1, Number(r.INTERVAL) || 1)
  const count = r.COUNT ? Number(r.COUNT) : Infinity
  const until = r.UNTIL ? parseDate({ name: 'UNTIL', params: {}, value: r.UNTIL }, tz)?.at ?? null : null
  const byDay = (r.BYDAY ?? '').split(',').map((x: string) => DAYS.indexOf(x.replace(/^[+-]?\d+/, ''))).filter((x: number) => x >= 0)
  // L'heure locale de la première occurrence est gardée d'une occurrence à l'autre,
  // y compris au passage à l'heure d'été.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(start).map((x) => [x.type, x.value]))
  const hm = `${parts.hour}:${parts.minute}`
  const base = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day))
  const out: Date[] = []
  let n = 0
  const push = (day: Date) => {
    const at = localInstant(day.toISOString().slice(0, 10), hm, tz)
    if (!at || at < start) return true
    if (until && at > until) return false
    if (n >= count) return false
    n++
    if (at > to) return false
    if (at >= from && !exdates.has(at.getTime())) out.push(at)
    return true
  }
  for (let i = 0; i < 2000; i++) {
    if (freq === 'DAILY') {
      if (!push(new Date(base.getTime() + i * interval * 86400e3))) break
    } else if (freq === 'WEEKLY') {
      const weekStart = new Date(base.getTime() + i * interval * 7 * 86400e3 - base.getUTCDay() * 86400e3)
      const days = byDay.length ? [...byDay].sort((a, b) => a - b) : [base.getUTCDay()]
      let go = true
      for (const d of days) { if (!push(new Date(weekStart.getTime() + d * 86400e3))) { go = false; break } }
      if (!go) break
    } else if (freq === 'MONTHLY') {
      const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i * interval, base.getUTCDate()))
      if (day.getUTCDate() !== base.getUTCDate()) continue
      if (!push(day)) break
    } else {
      const day = new Date(Date.UTC(base.getUTCFullYear() + i * interval, base.getUTCMonth(), base.getUTCDate()))
      if (!push(day)) break
    }
  }
  return out
}

export function parseIcs(text: string, from: Date, to: Date, fallbackTz = 'Europe/Zurich'): ExternalEvent[] {
  const lines = unfold(text)
  const events: ExternalEvent[] = []
  // Une occurrence modifiée (RECURRENCE-ID) remplace celle de la règle.
  const overridden = new Set<string>()
  const blocks: Prop[][] = []
  let cur: Prop[] | null = null
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') { cur = []; continue }
    if (l === 'END:VEVENT') { if (cur) blocks.push(cur); cur = null; continue }
    if (cur) { const p = parseProp(l); if (p) cur.push(p) }
  }
  for (const b of blocks) {
    const get = (n: string) => b.find((p) => p.name === n)
    const rid = get('RECURRENCE-ID')
    const uid = get('UID')?.value ?? ''
    if (rid && uid) { const d = parseDate(rid, fallbackTz); if (d) overridden.add(`${uid}|${d.at.getTime()}`) }
  }
  for (const b of blocks) {
    const get = (n: string) => b.find((p) => p.name === n)
    if ((get('STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') continue
    if ((get('TRANSP')?.value ?? '').toUpperCase() === 'TRANSPARENT') continue
    const ds = get('DTSTART'); if (!ds) continue
    const start = parseDate(ds, fallbackTz); if (!start) continue
    const de = get('DTEND')
    const end = de ? parseDate(de, fallbackTz)?.at : null
    const len = end ? end.getTime() - start.at.getTime()
      : get('DURATION') ? duration(get('DURATION')!.value) : start.allDay ? 86400e3 : 3600e3
    const uid = get('UID')?.value || `${ds.value}-${get('SUMMARY')?.value ?? ''}`
    const summary = unescape(get('SUMMARY')?.value ?? '')
    const tz = validTz(ds.params.TZID) ?? fallbackTz
    const exdates = new Set<number>()
    for (const ex of b.filter((p) => p.name === 'EXDATE')) {
      for (const v of ex.value.split(',')) { const d = parseDate({ ...ex, value: v }, fallbackTz); if (d) exdates.add(d.at.getTime()) }
    }
    const rrule = get('RRULE')
    const starts = rrule && !get('RECURRENCE-ID')
      ? expand(start.at, rrule.value, new Date(from.getTime() - len), to, exdates, tz)
          .filter((s) => !overridden.has(`${uid}|${s.getTime()}`))
      : [start.at]
    for (const s of starts) {
      const e = new Date(s.getTime() + Math.max(len, 0))
      if (e <= from || s >= to) continue
      events.push({ uid, start: s, end: e, summary: summary.slice(0, 200), allDay: start.allDay })
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, 2000)
}
