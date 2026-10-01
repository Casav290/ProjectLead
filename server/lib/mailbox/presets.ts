import { resolveMx } from 'node:dns/promises'

/**
 * Reconnaître la messagerie d'une adresse, pour que brancher sa boîte se résume à
 * son adresse et son mot de passe.
 *
 * Trois étages, du plus sûr au plus large :
 *  1. le domaine de l'adresse, pour les messageries grand public (gmail.com, orange.fr…) ;
 *  2. ses serveurs MX, pour un domaine d'entreprise hébergé chez Google, Microsoft,
 *     Infomaniak, OVH ou Hostpoint ;
 *  3. la base publique de Thunderbird, qui connaît des milliers d'hébergeurs.
 *
 * Les réglages des messageries connues sont écrits ici et non lus à chaque fois :
 * ils ne changent presque jamais, et brancher Gmail ne doit pas dépendre de la
 * disponibilité d'un service tiers.
 */

export type Servers = {
  imapHost: string; imapPort: number; imapSecure: boolean
  smtpHost: string; smtpPort: number; smtpSecure: boolean
  /** Ce que le serveur attend comme identifiant : l'adresse entière, ou ce qui précède l'@. */
  imapUser: 'address' | 'local'
  smtpUser: 'address' | 'local'
}

export type Detected = {
  /** Clé de la messagerie reconnue, ou `other` quand seuls ses réglages le sont. */
  key: string
  name: string
  /** La messagerie se branche d'un clic chez son fournisseur, quand ce serveur le sait faire. */
  oauth: 'google' | 'microsoft' | null
  /** Elle refuse le mot de passe habituel et exige un mot de passe d'application. */
  appPassword: boolean
  /** Absents pour Microsoft, qui a fermé l'IMAP par mot de passe. */
  servers: Servers | null
}

const ssl = (imapHost: string, smtpHost: string, user: 'address' | 'local' = 'address'): Servers => ({
  imapHost, imapPort: 993, imapSecure: true,
  smtpHost, smtpPort: 465, smtpSecure: true,
  imapUser: user, smtpUser: user,
})

type Preset = Omit<Detected, 'key'>

export const PRESETS: Record<string, Preset> = {
  gmail: { name: 'Gmail', oauth: 'google', appPassword: true, servers: ssl('imap.gmail.com', 'smtp.gmail.com') },
  microsoft: { name: 'Outlook', oauth: 'microsoft', appPassword: false, servers: null },
  icloud: {
    name: 'iCloud', oauth: null, appPassword: true,
    servers: { imapHost: 'imap.mail.me.com', imapPort: 993, imapSecure: true,
      smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecure: false,
      imapUser: 'local', smtpUser: 'address' },
  },
  yahoo: { name: 'Yahoo', oauth: null, appPassword: true, servers: ssl('imap.mail.yahoo.com', 'smtp.mail.yahoo.com') },
  infomaniak: { name: 'Infomaniak', oauth: null, appPassword: false, servers: ssl('mail.infomaniak.com', 'mail.infomaniak.com') },
  hostpoint: { name: 'Hostpoint', oauth: null, appPassword: false, servers: ssl('imap.mail.hostpoint.ch', 'asmtp.mail.hostpoint.ch') },
  swisscom: { name: 'Swisscom (Bluewin)', oauth: null, appPassword: false, servers: ssl('imaps.bluewin.ch', 'smtpauths.bluewin.ch') },
  gmx: { name: 'GMX', oauth: null, appPassword: false, servers: ssl('imap.gmx.net', 'mail.gmx.net') },
  ovh: { name: 'OVHcloud', oauth: null, appPassword: false, servers: ssl('ssl0.ovh.net', 'ssl0.ovh.net') },
  orange: { name: 'Orange', oauth: null, appPassword: false, servers: ssl('imap.orange.fr', 'smtp.orange.fr') },
  sfr: { name: 'SFR', oauth: null, appPassword: false, servers: ssl('imap.sfr.fr', 'smtp.sfr.fr') },
  free: { name: 'Free', oauth: null, appPassword: false, servers: ssl('imap.free.fr', 'smtp.free.fr', 'local') },
  laposte: { name: 'La Poste', oauth: null, appPassword: false, servers: ssl('imap.laposte.net', 'smtp.laposte.net', 'local') },
}

const DOMAINS: Record<string, string> = {
  'gmail.com': 'gmail', 'googlemail.com': 'gmail',
  'outlook.com': 'microsoft', 'outlook.fr': 'microsoft', 'hotmail.com': 'microsoft', 'hotmail.fr': 'microsoft',
  'hotmail.ch': 'microsoft', 'live.com': 'microsoft', 'live.fr': 'microsoft', 'msn.com': 'microsoft',
  'icloud.com': 'icloud', 'me.com': 'icloud', 'mac.com': 'icloud',
  'yahoo.com': 'yahoo', 'yahoo.fr': 'yahoo', 'ymail.com': 'yahoo',
  'ik.me': 'infomaniak', 'etik.com': 'infomaniak', 'ikmail.com': 'infomaniak',
  'bluewin.ch': 'swisscom',
  'gmx.ch': 'gmx', 'gmx.net': 'gmx', 'gmx.fr': 'gmx', 'gmx.de': 'gmx', 'gmx.com': 'gmx',
  'orange.fr': 'orange', 'wanadoo.fr': 'orange',
  'sfr.fr': 'sfr', 'neuf.fr': 'sfr',
  'free.fr': 'free',
  'laposte.net': 'laposte',
}

/** Un domaine d'entreprise se reconnaît à ses serveurs MX. */
const MX: [RegExp, string][] = [
  [/(^|\.)(google\.com|googlemail\.com)$/i, 'gmail'],
  [/\.mail\.protection\.outlook\.com$/i, 'microsoft'],
  [/(^|\.)infomaniak\.ch$/i, 'infomaniak'],
  [/(^|\.)hostpoint\.ch$/i, 'hostpoint'],
  [/(^|\.)ovh\.net$/i, 'ovh'],
]

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), ms))])

const TB = 'https://autoconfig.thunderbird.net/v1.1/'

/** La base de Thunderbird. Seule l'adresse de ce service est jamais appelée : pas de porte ouverte vers ailleurs. */
async function thunderbird(domain: string): Promise<Servers | null> {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null
  try {
    const res = await fetch(TB + encodeURIComponent(domain.toLowerCase()), { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const xml = await res.text()
    const block = (tag: string, type: string) =>
      xml.match(new RegExp(`<${tag} type="${type}">([\\s\\S]*?)</${tag}>`))?.[1] ?? null
    const imap = block('incomingServer', 'imap')
    const smtp = block('outgoingServer', 'smtp')
    if (!imap || !smtp) return null
    const field = (b: string, f: string) => b.match(new RegExp(`<${f}>([^<]*)</${f}>`))?.[1]?.trim() ?? ''
    const secure = (b: string) => field(b, 'socketType').toUpperCase() === 'SSL'
    const user = (b: string) => (field(b, 'username') === '%EMAILLOCALPART%' ? 'local' : 'address') as 'address' | 'local'
    const host = (b: string) => field(b, 'hostname')
    if (!host(imap) || !host(smtp) || host(imap).includes('%') || host(smtp).includes('%')) return null
    return {
      imapHost: host(imap), imapPort: Number(field(imap, 'port')) || 993, imapSecure: secure(imap),
      smtpHost: host(smtp), smtpPort: Number(field(smtp, 'port')) || 465, smtpSecure: secure(smtp),
      imapUser: user(imap), smtpUser: user(smtp),
    }
  } catch {
    return null
  }
}

export async function detect(email: string): Promise<Detected | null> {
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain) return null
  const known = (key: string): Detected => ({ key, ...PRESETS[key] })

  if (DOMAINS[domain]) return known(DOMAINS[domain])

  let mx: string[] = []
  try {
    mx = (await withTimeout(resolveMx(domain), 5000))
      .sort((a, b) => a.priority - b.priority).map((r) => r.exchange.replace(/\.$/, ''))
  } catch { /* pas de MX lisible : on tente quand même la base publique */ }
  for (const host of mx) {
    const hit = MX.find(([re]) => re.test(host))
    if (hit) return known(hit[1])
  }

  // Par le domaine, puis par celui de son premier MX (ex. mx1.hebergeur.fr → hebergeur.fr).
  const candidates = [domain]
  if (mx[0]) candidates.push(mx[0].split('.').slice(-2).join('.'))
  for (const d of candidates) {
    const servers = await thunderbird(d)
    if (servers) return { key: 'other', name: d, oauth: null, appPassword: false, servers }
  }
  return null
}

/** L'identifiant attendu, tiré de l'adresse. */
export const userFor = (email: string, kind: 'address' | 'local') =>
  kind === 'local' ? email.split('@')[0] : email
