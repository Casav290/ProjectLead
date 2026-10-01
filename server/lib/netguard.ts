import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isProduction } from './env.js'

/**
 * Une adresse saisie par un client (webhook) ne doit jamais faire frapper CRMlead sur son
 * propre réseau : tout nouvel inscrit est administrateur de son compte, et le journal des
 * livraisons lui renverrait le code obtenu. HTTPS seulement, et des adresses publiques,
 * vérifiées au moment de l'appel (un nom peut changer d'adresse après l'enregistrement).
 */
const privateV4 = (ip: string) =>
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip)

/**
 * Une adresse IPv4 cachée dans une IPv6 : `::ffff:127.0.0.1` devient `::ffff:7f00:1` une fois
 * normalisée par `URL`, et `64:ff9b::a9fe:a9fe` (NAT64) mène aussi à 169.254.169.254.
 * On en extrait l'IPv4 pour la juger comme les autres (bêta-test E4-2).
 */
function embeddedV4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:::ffff:(?:0:)?|::|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/)
  if (!m) return null
  if (m[1]) return m[1]
  const hi = parseInt(m[2], 16), lo = parseInt(m[3], 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

export const privateIp = (ip: string): boolean => {
  if (privateV4(ip)) return true
  const v4 = isIP(ip) === 6 ? embeddedV4(ip) : null
  if (v4) return privateV4(v4) || v4.startsWith('0.') || v4 === '0.0.0.0'
  return ip === '::1' || ip === '::' || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip) || /^::ffff:/i.test(ip)
}

/** Réservé aux contrôles de non-régression, qui parlent à des récepteurs locaux. Jamais en production. */
export const allowPrivate = () =>
  process.env.MAILBOX_ALLOW_PRIVATE_HOSTS === '1' && !isProduction()

/** Rend l'erreur à afficher, ou null si l'adresse est acceptable à l'enregistrement. */
export function outboundUrlProblem(raw: string): 'https_required' | 'host_not_allowed' | null {
  let u: URL
  try { u = new URL(raw) } catch { return 'https_required' }
  if (u.protocol !== 'https:' && !(allowPrivate() && u.protocol === 'http:')) return 'https_required'
  if (allowPrivate()) return null
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return 'host_not_allowed'
  if (isIP(host) && privateIp(host)) return 'host_not_allowed'
  return null
}

/** Au moment de l'appel : le nom est résolu et chacune de ses adresses doit être publique. */
export async function assertPublicUrl(raw: string) {
  const problem = outboundUrlProblem(raw)
  if (problem) throw new Error(problem)
  if (allowPrivate()) return
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '')
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (!ips.length || ips.some(privateIp)) throw new Error('host_not_allowed')
}
