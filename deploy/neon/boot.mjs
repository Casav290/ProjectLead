// Amorçage Neon Functions : télécharge le paquet ProjectLead à un commit fixé, vérifie son empreinte, le charge.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const SRC = 'https://raw.githubusercontent.com/Casav290/ProjectLead/bb4fdbd9e2adb59513e3c995d66f5be3eb1a8d6f/deploy/neon/index.mjs'
const SUM = '8b5f0e5938ea363343e3aece3c9bb68a15bcd3e51f69b2d5e247a834d83ec385'
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
