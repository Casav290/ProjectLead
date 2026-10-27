import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Les cinq langues de la famille Lead (chantier « cinq langues partout », 27.10.2026) : français, allemand, anglais,
 * italien, espagnol. Les textes sont dans `locales/<langue>/<partie>.json` (une partie par zone de l'application, clés
 * préfixées par la partie) ; `bundle/<langue>.ts` les réunit en un seul fichier chargé à la demande.
 *
 * Aucune chaîne en dur dans les composants : tout passe par t() (contrôle : scripts/i18n-check.ts).
 *
 * La langue : le choix fait au sélecteur (localStorage `pl.lang` et cookie `pl_lang`, puis le profil `users.locale`),
 * sinon `?lang=` dans l'adresse (liens des e-mails), sinon la langue du profil (reprise du Compte Lead), sinon celle
 * du navigateur, sinon le français.
 */
export const LOCALES = ['fr', 'de', 'en', 'it', 'es'] as const
export type Locale = typeof LOCALES[number]
export const LOCALE_NAMES: Record<Locale, string> = { fr: 'Français', de: 'Deutsch', en: 'English', it: 'Italiano', es: 'Español' }
export const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v)

type Dict = Record<string, string>
const loaders: Record<Locale, () => Promise<{ default: Dict }>> = {
  fr: () => import('./bundle/fr'),
  de: () => import('./bundle/de'),
  en: () => import('./bundle/en'),
  it: () => import('./bundle/it'),
  es: () => import('./bundle/es'),
}
const dicts: Partial<Record<Locale, Dict>> = {}
let current: Locale = 'fr'

/** La locale Intl d'une langue (dates, nombres) : la Suisse pour fr, de, it ; le Royaume-Uni pour en ; l'Espagne pour es. */
export const intlLocale = (l: Locale = current) =>
  ({ fr: 'fr-CH', de: 'de-CH', en: 'en-GB', it: 'it-CH', es: 'es-ES' } as const)[l]

const CHOSEN = 'pl.lang'
const COOKIE = 'pl_lang'
function readChosen(): Locale | null {
  try {
    const v = localStorage.getItem(CHOSEN)
    if (isLocale(v)) return v
  } catch { /* stockage refusé */ }
  const m = typeof document !== 'undefined' ? document.cookie.match(/(?:^|;\s*)pl_lang=([a-z]{2})/) : null
  return m && isLocale(m[1]) ? m[1] : null
}
function fromUrl(): Locale | null {
  try {
    const v = new URLSearchParams(window.location.search).get('lang')
    return isLocale(v) ? v : null
  } catch { return null }
}
function fromBrowser(): Locale {
  for (const l of (typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [])) {
    const c = String(l).slice(0, 2).toLowerCase()
    if (isLocale(c)) return c
  }
  return 'fr'
}
function remember(l: Locale) {
  try { localStorage.setItem(CHOSEN, l) } catch { /* navigation privée */ }
  try { document.cookie = `${COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}` } catch { /* */ }
}

/** La langue de départ (avant /me). */
export const initialLocale = (): Locale => readChosen() ?? fromUrl() ?? fromBrowser()
export const hasChosenLocale = () => readChosen() !== null

export async function loadLocale(l: Locale): Promise<void> {
  if (!dicts[l]) dicts[l] = (await loaders[l]()).default
}

/** À appeler avant le premier rendu : charge la langue de départ. */
export async function initI18n(): Promise<Locale> {
  const l = initialLocale()
  await loadLocale(l).catch(() => loadLocale('fr'))
  current = dicts[l] ? l : 'fr'
  if (typeof document !== 'undefined') document.documentElement.lang = current
  return current
}

export const getLocale = () => current

/**
 * La traduction d'une clé, dans la langue en cours. Variables `{nom}` ; accord `{n|un projet|{n} projets}` (en français
 * 0 et 1 au singulier). Une clé absente rend la clé elle-même : le contrôle scripts/i18n-check.ts l'empêche.
 */
export function t(key: string, vars?: Record<string, unknown>): string {
  let s = dicts[current]?.[key] ?? key
  s = s.replace(/\{(\w+)\|((?:[^|{}]|\{\w+\})*)\|((?:[^|{}]|\{\w+\})*)\}/g, (_w, k, one, many) => {
    const n = Math.abs(Number(vars?.[k]))
    if (!Number.isFinite(n)) return many
    return (current === 'fr' ? n < 2 : n === 1) ? one : many
  })
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ''))
  return s
}

/**
 * Un tableau de libellés qui suit la langue : `labels('status', ['lead', 'active'])` → objet dont chaque clé lit
 * `status.<clé>` à chaque accès. `Object.entries` et `LABEL[k]` marchent comme avec un objet ordinaire.
 */
export function labels<K extends string>(prefix: string, keys: readonly K[]): Record<K, string> & Record<string, string> {
  const o = {} as Record<string, string>
  for (const k of keys) Object.defineProperty(o, k, { enumerable: true, get: () => t(`${prefix}.${k}`) })
  return o as Record<K, string> & Record<string, string>
}

type Ctx = { locale: Locale; setLocale: (l: Locale) => Promise<void>; adoptLocale: (l: string | null | undefined) => void; t: typeof t }
const I18nCtx = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<Locale>(current)
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const apply = useCallback(async (l: Locale) => {
    await loadLocale(l)
    current = l
    setState(l)
  }, [])
  const setLocale = useCallback(async (l: Locale) => {
    remember(l)
    await apply(l)
    // Sans session, la requête échoue sans conséquence : le choix reste dans ce navigateur (cookie et localStorage).
    fetch('/api/me/locale', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ locale: l }) }).catch(() => {})
  }, [apply])
  /** La langue du profil (reprise du Compte Lead) : appliquée tant que la personne n'a rien choisi dans ce navigateur. */
  const adoptLocale = useCallback((l: string | null | undefined) => {
    if (isLocale(l) && l !== current && !hasChosenLocale() && !fromUrl()) apply(l).catch(() => {})
  }, [apply])

  // `t` change d'identité avec la langue : les composants qui le reçoivent se redessinent.
  const value = useMemo<Ctx>(() => ({ locale, setLocale, adoptLocale, t: (k, v) => t(k, v) }), [locale, setLocale, adoptLocale])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx)
  if (!c) throw new Error('useI18n hors I18nProvider')
  return c
}
/** La fonction de traduction ; le composant se redessine au changement de langue. */
export const useT = () => useI18n().t
