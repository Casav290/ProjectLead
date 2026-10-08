import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'

/**
 * Les images et le film de la page d'accueil (`/media/...`), servis par l'application mais HORS du paquet JS :
 * le paquet Neon embarque l'interface en base64, une vidéo de plusieurs mégaoctets n'y a pas sa place.
 * - Serveur Node : lus dans le dossier `media/` du dépôt.
 * - Neon : téléchargés une fois par instance depuis GitHub, au commit fixé par `scripts/neon-build.mjs`,
 *   empreinte SHA-256 vérifiée, puis gardés en mémoire (voir server/neon.ts).
 * Réponses avec ETag et requêtes partielles (Range) : Safari ne lit une vidéo qu'en 206.
 */
export const MEDIA_TYPES: Record<string, string> = {
  '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8',
}

export type MediaFile = { body: Uint8Array<ArrayBuffer>; type: string; etag: string }

/** Un chemin de média acceptable : `/media/` puis des segments simples, une extension connue. */
export function mediaPath(pathname: string): string | null {
  if (!/^\/media\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/i.test(pathname) || pathname.includes('..')) return null
  return MEDIA_TYPES[extname(pathname).toLowerCase()] ? pathname : null
}

export const etagOf = (sha256hex: string) => `"${sha256hex.slice(0, 32)}"`

/**
 * La réponse HTTP d'un média : 304 si l'ETag correspond, 206 pour une plage, 416 pour une plage impossible,
 * 200 sinon. `HEAD` rend les mêmes en-têtes sans corps.
 */
export function mediaResponse(request: Request, file: MediaFile): Response {
  const size = file.body.byteLength
  const headers = new Headers({
    'Content-Type': file.type,
    'Accept-Ranges': 'bytes',
    ETag: file.etag,
    // Les noms ne changent pas d'une version à l'autre : un jour de cache, puis revalidation par l'ETag.
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'X-Content-Type-Options': 'nosniff',
  })
  const head = request.method === 'HEAD'
  const inm = request.headers.get('if-none-match')
  if (inm && inm.split(',').map((s) => s.trim().replace(/^W\//, '')).includes(file.etag)) return new Response(null, { status: 304, headers })

  const range = request.headers.get('range')
  const ifRange = request.headers.get('if-range')
  const m = range && (!ifRange || ifRange === file.etag) ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (range && m && (m[1] || m[2])) {
    let start: number, end: number
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1 }
    else { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1 }
    if (!(start <= end) || start >= size) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
    return new Response(head ? null : file.body.slice(start, end + 1), { status: 206, headers })
  }
  headers.set('Content-Length', String(size))
  return new Response(head ? null : file.body, { status: 200, headers })
}

/** Source locale (serveur Node, développement) : le dossier `media/` du dépôt, gardé en mémoire après lecture. */
export function localMedia(root: string) {
  const base = resolve(root)
  const cache = new Map<string, MediaFile>()
  return (pathname: string): MediaFile | null => {
    const p = mediaPath(pathname)
    if (!p) return null
    const hit = cache.get(p)
    if (hit) return hit
    const file = join(base, p.slice('/media/'.length))
    if (!existsSync(file) || !statSync(file).isFile()) return null
    // Pas de lien symbolique qui mènerait hors du dossier.
    const real = realpathSync(file)
    if (real !== base && !real.startsWith(base + sep)) return null
    const body = new Uint8Array(readFileSync(real))
    const out = { body, type: MEDIA_TYPES[extname(p).toLowerCase()], etag: etagOf(createHash('sha256').update(body).digest('hex')) }
    cache.set(p, out)
    return out
  }
}

export type MediaManifest = { base: string; files: Record<string, { sha256: string; size: number; type: string }> }

/**
 * Source distante (Neon) : chaque fichier est téléchargé une fois depuis `base` (GitHub, commit fixé), refusé si son
 * empreinte ne correspond pas au manifeste, puis gardé en mémoire pour la vie de l'instance.
 */
export function remoteMedia(manifest: MediaManifest, fetcher: typeof fetch = fetch) {
  const cache = new Map<string, Promise<MediaFile>>()
  return async (pathname: string): Promise<MediaFile | null> => {
    const p = mediaPath(pathname)
    const entry = p ? manifest.files[p] : undefined
    if (!p || !entry) return null
    let job = cache.get(p)
    if (!job) {
      job = (async () => {
        const r = await fetcher(manifest.base + p.slice('/media/'.length))
        if (!r.ok) throw new Error(`média ${p} : ${r.status}`)
        const body = new Uint8Array(await r.arrayBuffer())
        const sum = createHash('sha256').update(body).digest('hex')
        if (sum !== entry.sha256) throw new Error(`média ${p} : empreinte`)
        return { body, type: entry.type, etag: etagOf(sum) }
      })()
      cache.set(p, job)
      job.catch(() => cache.delete(p))
    }
    return job
  }
}
