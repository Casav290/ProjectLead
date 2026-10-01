// Amorçage Neon Functions : télécharge le paquet ProjectLead à un commit fixé, vérifie son empreinte, le charge.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const SRC = 'https://raw.githubusercontent.com/Casav290/ProjectLead/6fb95be683206af315bd78f85595a58d2ef080b3/deploy/neon/index.mjs'
const SUM = '287167a2afd508fc2b1c36f5ba7c5b3d7950270e12a47cc814119a2e93c00d4d'
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
