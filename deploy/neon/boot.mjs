// Amorçage Neon Functions : télécharge le paquet ProjectLead à un commit fixé, vérifie son empreinte, le charge.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const SRC = 'https://raw.githubusercontent.com/Casav290/ProjectLead/29c2b936c6fb87b0538edb78a46a82dfe718dc28/deploy/neon/index.mjs'
const SUM = 'c176fc25456342e2bfa916f7248e6927852762ae753d3882decc039cba7d1dde'
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
