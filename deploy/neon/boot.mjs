// Amorçage Neon Functions : télécharge le paquet ProjectLead à un commit fixé, vérifie son empreinte, le charge.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const SRC = 'https://raw.githubusercontent.com/Casav290/ProjectLead/c7cd50f0e3770911be8be4ac18eba0530e26eb5f/deploy/neon/index.mjs'
const SUM = '683a2279c62556f3fc746a7ea54a40273799f17c55735b74904e4bfbc01f36ab'
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
