/** Les adresses du site public : accueils et pages mots-clés (une par sujet et par langue, reliées par hreflang). */
export const ORIGIN = 'https://projectlead.io'
export const LANGS = ['fr', 'en', 'de']
export const HOME_PATH = { fr: '/', en: '/en', de: '/de' }

export const TOPICS = [
  { id: 'free', fr: 'logiciel-gestion-de-projet-gratuit', en: 'free-project-management-software', de: 'projektmanagement-software-kostenlos' },
  { id: 'smb', fr: 'outil-gestion-de-projet-pme', en: 'project-management-software-for-small-business', de: 'projektmanagement-software-kmu' },
  { id: 'gantt', fr: 'diagramme-de-gantt-en-ligne-gratuit', en: 'gantt-chart-software-free-online', de: 'gantt-diagramm-online-kostenlos' },
  { id: 'time', fr: 'logiciel-feuille-de-temps-et-facturation', en: 'project-management-software-with-time-tracking', de: 'projektzeiterfassung-software' },
  { id: 'freelance', fr: 'gestion-de-projet-freelance', en: 'project-management-software-for-freelancers', de: 'projektmanagement-tool-fuer-selbststaendige' },
  { id: 'monday', fr: 'alternative-a-monday', en: 'monday-alternative', de: 'monday-alternative' },
  { id: 'asana', fr: 'alternative-asana', en: 'asana-alternative', de: 'asana-alternative' },
]

export const pagePath = (l, t) => `/${l}/${t[l]}`

/** Toutes les adresses servies par une page statique (routes de scripts/vercel-build.mjs) : chemin → fichier dans _site. */
export function staticRoutes() {
  const r = [['/', 'fr.html'], ['/en', 'en.html'], ['/de', 'de.html']]
  for (const t of TOPICS) for (const l of LANGS) r.push([pagePath(l, t), `${l}/${t[l]}.html`])
  return r
}
