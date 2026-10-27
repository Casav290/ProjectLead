/** Pour les scripts sous Node (smoke.ts, suites-check.ts) : charge une langue de l'interface depuis les fichiers JSON. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setDict, type Locale } from '../src/i18n/index.tsx'

export function useLocaleFromFiles(l: Locale = 'fr') {
  const dir = join(import.meta.dirname, '../src/i18n/locales', l)
  const d: Record<string, string> = {}
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) Object.assign(d, JSON.parse(readFileSync(join(dir, f), 'utf8')))
  setDict(l, d)
}
