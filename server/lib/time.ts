/**
 * « 2026-09-18 » et « 10:00 », heure d'un fuseau → instant UTC. Le décalage est lu
 * pour ce jour précis : un rendez-vous d'octobre ne prend pas l'heure d'été.
 */
export function localInstant(date: string, time: string, timeZone = 'Europe/Zurich'): Date | null {
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const t = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!d || !t) return null
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2])
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]))
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  const at = new Date(guess - (shown - guess))
  return Number.isNaN(at.getTime()) ? null : at
}

/** La date du jour (AAAA-MM-JJ) et le jour ISO (1 = lundi) dans un fuseau. */
export function localDay(at: Date, timeZone = 'Europe/Zurich') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(at).map((x) => [x.type, x.value]))
  const iso = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1
  return { date: `${p.year}-${p.month}-${p.day}`, isoDay: iso }
}
