import fr from '../i18n/fr.js'
import de from '../i18n/de.js'
import en from '../i18n/en.js'
import it from '../i18n/it.js'
import es from '../i18n/es.js'

/**
 * Les textes que le serveur envoie (e-mails, notifications, documents, export), dans les cinq langues de la famille
 * Lead. `tr(langue, clé, variables)` : même syntaxe que l'interface (src/i18n) — `{nom}`, `{n|un|plusieurs}`.
 * Contrôle : scripts/i18n-check.ts --keys (mêmes clés dans les cinq fichiers server/i18n/<langue>.ts).
 */
export const LOCALES = ['fr', 'de', 'en', 'it', 'es'] as const
export type Locale = typeof LOCALES[number]
export const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v)
/** Une langue connue, sinon le français (valeur d'une colonne, d'un en-tête ou d'un champ). */
export const asLocale = (v: unknown, fallback: Locale = 'fr'): Locale => {
  const s = typeof v === 'string' ? v.slice(0, 2).toLowerCase() : ''
  return isLocale(s) ? s : fallback
}
const dicts: Record<Locale, Record<string, string>> = { fr, de, en, it, es }

export function tr(locale: string | null | undefined, key: string, vars?: Record<string, unknown>): string {
  const l = asLocale(locale)
  let s = dicts[l][key] ?? dicts.fr[key] ?? key
  s = s.replace(/\{(\w+)\|((?:[^|{}]|\{\w+\})*)\|((?:[^|{}]|\{\w+\})*)\}/g, (_w, k, one, many) => {
    const n = Math.abs(Number(vars?.[k]))
    if (!Number.isFinite(n)) return many
    return (l === 'fr' ? n < 2 : n === 1) ? one : many
  })
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''))
  return s
}

/** La locale Intl d'une langue (dates et nombres des documents). */
export const intlLocale = (l: string | null | undefined) =>
  ({ fr: 'fr-CH', de: 'de-CH', en: 'en-GB', it: 'it-CH', es: 'es-ES' } as const)[asLocale(l)]

/** 2026-10-27 → « 27.10.2026 » (ou « 27/10/2026 ») dans la langue du document. */
export const fmtDateIn = (l: string | null | undefined, d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat(intlLocale(l), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(String(d).slice(0, 10) + 'T12:00:00Z')) : ''

/** La langue préférée d'une requête : cookie `pl_lang` (choix fait au sélecteur), sinon Accept-Language. */
export function requestLocale(cookieHeader: string | null | undefined, acceptLanguage: string | null | undefined): Locale | null {
  const m = /(?:^|;\s*)pl_lang=([a-z]{2})/.exec(cookieHeader ?? '')
  if (m && isLocale(m[1])) return m[1]
  for (const part of (acceptLanguage ?? '').split(',')) {
    const c = part.trim().slice(0, 2).toLowerCase()
    if (isLocale(c)) return c
  }
  return null
}

// ------------------------------------------------------------------ devise par pays (contrat, règle 4)
const EURO = new Set(['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK',
  'SI', 'ES', 'MC', 'SM', 'VA', 'AD', 'ME', 'XK', 'BG'])

/** CH/LI → CHF ; zone euro → EUR ; US → USD ; GB → GBP ; sinon CHF (la devise par défaut de ProjectLead). */
export function currencyForCountry(country: string | null | undefined): 'CHF' | 'EUR' | 'USD' | 'GBP' {
  const c = (country ?? '').toUpperCase()
  if (c === 'CH' || c === 'LI') return 'CHF'
  if (EURO.has(c)) return 'EUR'
  if (c === 'US') return 'USD'
  if (c === 'GB' || c === 'UK') return 'GBP'
  return 'CHF'
}

/**
 * La devise d'un nouveau projet : celle choisie, sinon celle du modèle, sinon celle de l'entreprise (lue seulement s'il le
 * faut). Une seule règle pour l'écriture (createProject, routes/projects.ts) et pour la carte « À confirmer » de
 * l'assistant (propose_create_project, lib/assistant/tools.ts) : la carte montre la devise qui sera écrite.
 */
export async function newProjectCurrency(chosen: string | null | undefined, template: string | null | undefined,
  account: () => Promise<string | null | undefined>): Promise<'CHF' | 'EUR' | 'USD' | 'GBP'> {
  return (chosen ?? template ?? (await account()) ?? 'CHF') as 'CHF' | 'EUR' | 'USD' | 'GBP'
}

/** Le pays de la personne : en-tête Vercel x-vercel-ip-country d'abord, sinon la région d'Accept-Language (« de-AT »). */
export function requestCountry(h: (name: string) => string | undefined | null): string | null {
  const v = h('x-vercel-ip-country')
  if (v && /^[A-Za-z]{2}$/.test(v)) return v.toUpperCase()
  for (const part of (h('accept-language') ?? '').split(',')) {
    const m = /^[a-z]{2,3}-([A-Za-z]{2})\b/.exec(part.trim())
    if (m) return m[1].toUpperCase()
  }
  return null
}
