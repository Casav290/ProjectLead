/** Écrire de l'iCalendar (RFC 5545) : flux d'agenda et invitations jointes aux emails. */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const day = (d: string) => d.replace(/-/g, '')

/** Une ligne de plus de 75 octets se replie (RFC 5545 §3.1). */
function fold(line: string) {
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) { out.push(cur); cur = ' ' + ch } else cur += ch
  }
  out.push(cur)
  return out.join('\r\n')
}

export type IcsEvent = {
  uid: string; title: string; description?: string; location?: string; url?: string
  start: Date; end: Date; allDay?: boolean; date?: string /* AAAA-MM-JJ pour une journée */
  organizer?: { name: string; email: string }; attendees?: { name?: string | null; email: string }[]
  status?: 'CONFIRMED' | 'CANCELLED'
}

export function ics(events: IcsEvent[], opts: { name?: string; method?: 'PUBLISH' | 'REQUEST' | 'CANCEL' } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ProjectLead//FR', 'CALSCALE:GREGORIAN', `METHOD:${opts.method ?? 'PUBLISH'}`]
  if (opts.name) L.push(`X-WR-CALNAME:${esc(opts.name)}`)
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(new Date())}`)
    if (e.allDay && e.date) {
      const next = new Date(Date.parse(e.date + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10)
      L.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(next)}`)
    } else {
      L.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`)
    }
    L.push(`SUMMARY:${esc(e.title)}`)
    if (e.description) L.push(`DESCRIPTION:${esc(e.description)}`)
    if (e.location) L.push(`LOCATION:${esc(e.location)}`)
    if (e.url) L.push(`URL:${e.url}`)
    if (e.organizer) L.push(`ORGANIZER;CN=${esc(e.organizer.name)}:mailto:${e.organizer.email}`)
    for (const a of e.attendees ?? []) L.push(`ATTENDEE;CN=${esc(a.name || a.email)};RSVP=TRUE:mailto:${a.email}`)
    L.push(`STATUS:${e.status ?? 'CONFIRMED'}`, 'END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.map(fold).join('\r\n') + '\r\n'
}
