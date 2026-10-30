/**
 * La page https://projectlead.io/lead-auth/return (lead-auth-return.html ; contrat d'ERPlead docs/GOOGLE-APP.md § 3c).
 * Le lien de retour de « Continuer avec Google » est réservé à l'app : quand l'app s'ouvre (Universal Link, App Link
 * vérifié, session iOS), cette page n'est jamais chargée. Elle s'affiche dans le navigateur quand l'app ne s'est pas
 * ouverte (app pas à jour, domaine pas encore vérifié) : elle dit quoi faire, sans aucun bouton ni lien qui porte le code
 * (un lien du même domaine n'ouvrirait pas l'app), et le code a déjà quitté l'adresse (script de la page).
 *
 * Chargée DANS la vue web de l'app (pont natif présent) : son adresse passe par le même traitement que les liens reçus
 * (src/lib/leadAppAuth.ts : connexion en cours exigée, une seule fois) ; un lien ignoré ramène à l'accueil de l'app.
 * Aucune autre dépendance que ce module et les textes de la page (cinq langues, un petit fichier par langue).
 */
import { leadAppAuth } from './lib/leadAppAuth'

const LOCALES = ['fr', 'de', 'en', 'it', 'es'] as const
type Locale = typeof LOCALES[number]
const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v)
const loaders: Record<Locale, () => Promise<{ default: Record<string, string> }>> = {
  fr: () => import('./i18n/locales/fr/leadauth.json'),
  de: () => import('./i18n/locales/de/leadauth.json'),
  en: () => import('./i18n/locales/en/leadauth.json'),
  it: () => import('./i18n/locales/it/leadauth.json'),
  es: () => import('./i18n/locales/es/leadauth.json'),
}

/** La langue de `locale` (gardée par le script de la page avant d'effacer l'adresse), sinon celle du navigateur, sinon fr. */
function pageLocale(): Locale {
  const asked = document.documentElement.getAttribute('data-locale')
  if (isLocale(asked)) return asked
  for (const l of navigator.languages ?? [navigator.language]) {
    const c = String(l).slice(0, 2).toLowerCase()
    if (isLocale(c)) return c
  }
  return 'fr'
}

async function show() {
  // Au cas où le script de la page n'a pas pu le faire : le code quitte l'adresse avant tout affichage.
  try { if (location.search) history.replaceState(null, '', '/lead-auth/return') } catch { /* rien de plus à effacer */ }
  const l = pageLocale()
  const dict = (await loaders[l]().catch(() => loaders.fr())).default
  const t = (k: string) => dict[k] ?? k
  document.documentElement.lang = l
  document.title = t('leadauth.return.title')
  const set = (sel: string, text: string) => { const el = document.querySelector<HTMLElement>(sel); if (el) el.textContent = text }
  set('[data-title]', t('leadauth.return.title'))
  set('[data-body]', t('leadauth.return.body'))
  set('[data-nothing]', t('leadauth.return.nothing'))
  if (/Android/i.test(navigator.userAgent)) {
    set('[data-android]', t('leadauth.return.android'))
    document.querySelector('[data-android]')?.removeAttribute('hidden')
  }
  document.querySelector('[data-lead-auth-return]')?.removeAttribute('hidden')
}

const auth = leadAppAuth()
if (auth.inApp()) {
  // Dans l'app : les écoutes de toutes les pages, puis l'adresse de cette page comme un lien reçu.
  auth.listen()
  void auth.returnPage(location.href)
} else {
  void show()
}
