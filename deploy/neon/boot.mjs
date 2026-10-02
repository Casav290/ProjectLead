// Amorçage Neon Functions : télécharge le paquet ProjectLead à un commit fixé, vérifie son empreinte, le charge.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const SRC = 'https://raw.githubusercontent.com/Casav290/ProjectLead/06d39a6763104c5835eb1c7fd8a1bc52ab2d123a/deploy/neon/index.mjs'
const SUM = 'ee351c35a6bde25e3b4784f4f9332847f2456983506a72c5b1a726e8ee462594'
let app = null

async function load() {
  const r = await fetch(SRC)
  if (!r.ok) throw new Error('paquet ' + r.status)
  const buf = Buffer.from(await r.arrayBuffer())
  if (createHash('sha256').update(buf).digest('hex') !== SUM) throw new Error('empreinte du paquet')
  const file = tmpdir() + '/projectlead-' + SUM.slice(0, 12) + '.mjs'
  await writeFile(file, buf)
  return (await import(file)).default
}

export default {
  async fetch(request, env, ctx) {
    app ??= load().catch((e) => { app = null; throw e })
    return (await app).fetch(request, env, ctx)
  },
}
