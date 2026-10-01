import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { anon } from '../db.js'
import { isProduction } from './env.js'
import { parseIcs } from './icsparse.js'
import { open } from './mailbox/secret.js'
import { privateIp } from './netguard.js'

/**
 * Les agendas extérieurs (Google, Outlook, iCloud, Infomaniak) lus par leur adresse iCalendar
 * secrète, repris de CRMlead : HTTPS seulement, adresses publiques seulement (y compris après
 * redirection), 5 Mo et 20 secondes au plus.
 */
const MAX_BYTES = 5 * 1024 * 1024
const testing = () => process.env.MAILBOX_ALLOW_PRIVATE_HOSTS === '1' && !isProduction()

export function normalizeCalendarUrl(raw: string): string | null {
  let s = raw.trim()
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:/i, 'https:')
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && !(testing() && u.protocol === 'http:')) return null
    if (u.username || u.password) return null
    return u.toString()
  } catch { return null }
}

async function assertPublic(url: URL) {
  if (testing()) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (!ips.length || ips.some(privateIp)) throw new Error('host_not_allowed')
}

export async function fetchCalendar(url: string): Promise<string> {
  let current = new URL(url)
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current)
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'text/calendar, */*;q=0.5', 'User-Agent': 'ProjectLead-calendar/1.0' } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current)
      if (current.protocol !== 'https:' && !(testing() && current.protocol === 'http:')) throw new Error('redirect_not_https')
      continue
    }
    if (!res.ok) throw new Error(`http_${res.status}`)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('empty')
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error('too_large') }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('not_ical')
    return text
  }
  throw new Error('too_many_redirects')
}

/** Relit un agenda : 7 jours en arrière, 120 en avant, remplacés d'un bloc. */
export async function syncFeed(feed: { id: string; account_id: string; user_id: string; url: string }) {
  try {
    const url = open<string>(feed.url)
    const text = await fetchCalendar(url)
    const now = Date.now()
    const events = parseIcs(text, new Date(now - 7 * 86400e3), new Date(now + 120 * 86400e3))
    await anon(async (db) => {
      await db.query('begin')
      try {
        await db.query('delete from external_events where feed_id = $1', [feed.id])
        for (const e of events) {
          await db.query(
            `insert into external_events (account_id, feed_id, user_id, uid, title, starts_at, ends_at, all_day)
             values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
            [feed.account_id, feed.id, feed.user_id, e.uid.slice(0, 300), e.summary, e.start, e.end, e.allDay])
        }
        await db.query('update calendar_feeds set last_synced_at = now(), sync_error = null where id = $1', [feed.id])
        await db.query('commit')
      } catch (e) { await db.query('rollback'); throw e }
    })
    return { ok: true as const, count: events.length }
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 120)
    await anon((db) => db.query('update calendar_feeds set last_synced_at = now(), sync_error = $2 where id = $1', [feed.id, error])).catch(() => {})
    return { ok: false as const, error }
  }
}

export async function calendarsOnce(limit = 20) {
  const due = await anon(async (db) => (await db.query(
    `select id, account_id, user_id, url from calendar_feeds
      where last_synced_at is null or last_synced_at < now() - interval '15 minutes' order by last_synced_at nulls first limit $1`, [limit])).rows)
  for (const f of due) await syncFeed(f)
  return due.length
}
