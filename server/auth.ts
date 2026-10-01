import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

// KDF mémoire-dure fournie par Node, sans dépendance native à compiler.
// Format stocké : scrypt$N$r$p$sel$empreinte, tout en base64.
const N = 16384, r = 8, p = 1, KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, rr, pp, salt, key] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const expected = Buffer.from(key, 'base64')
    const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length,
      { N: +n, r: +rr, p: +pp, maxmem: 64 * 1024 * 1024 })
    return timingSafeEqual(expected, actual)
  } catch { return false }
}

/** Jeton opaque. Ce n'est jamais un JWT : il ne porte rien, il se révoque. */
export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

export const SESSION_COOKIE = 'projectlead_session'
export const SESSION_DAYS = 30
