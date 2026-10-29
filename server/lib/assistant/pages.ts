import type { Locale } from '../i18n.js'
import { callApi } from './internal.js'
import frShell from '../../../src/i18n/locales/fr/shell.json'
import frProject from '../../../src/i18n/locales/fr/project.json'
import frSettings from '../../../src/i18n/locales/fr/settings.json'
import frHome from '../../../src/i18n/locales/fr/home.json'
import deShell from '../../../src/i18n/locales/de/shell.json'
import deProject from '../../../src/i18n/locales/de/project.json'
import deSettings from '../../../src/i18n/locales/de/settings.json'
import deHome from '../../../src/i18n/locales/de/home.json'
import enShell from '../../../src/i18n/locales/en/shell.json'
import enProject from '../../../src/i18n/locales/en/project.json'
import enSettings from '../../../src/i18n/locales/en/settings.json'
import enHome from '../../../src/i18n/locales/en/home.json'
import itShell from '../../../src/i18n/locales/it/shell.json'
import itProject from '../../../src/i18n/locales/it/project.json'
import itSettings from '../../../src/i18n/locales/it/settings.json'
import itHome from '../../../src/i18n/locales/it/home.json'
import esShell from '../../../src/i18n/locales/es/shell.json'
import esProject from '../../../src/i18n/locales/es/project.json'
import esSettings from '../../../src/i18n/locales/es/settings.json'
import esHome from '../../../src/i18n/locales/es/home.json'

/**
 * Les écrans de ProjectLead dits par leur NOM, jamais par leur chemin (alignement des bulles, 28.10.2026, B5).
 * `open_page` rend au modèle et à la bulle un libellé (« Réglages › Équipe », « Site Internet › Gantt ») ; la bulle
 * écrit « Page ouverte : <libellé> » ; un chemin brut écrit par le modèle dans sa réponse est remplacé par le libellé
 * (`scrubPaths`). Mêmes mots que l'écran : les libellés viennent des fichiers de langue de l'interface (menu principal,
 * onglets du projet, menu des réglages).
 */
const SCREEN: Record<Locale, Record<string, string>> = {
  fr: { ...frShell, ...frProject, ...frSettings, ...frHome },
  de: { ...deShell, ...deProject, ...deSettings, ...deHome },
  en: { ...enShell, ...enProject, ...enSettings, ...enHome },
  it: { ...itShell, ...itProject, ...itSettings, ...itHome },
  es: { ...esShell, ...esProject, ...esSettings, ...esHome },
}
const SEP = ' › '
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const TOP: Record<string, string> = {
  '/': 'shell.nav.home', '/taches': 'shell.nav.tasks', '/projets': 'shell.nav.projects', '/modeles': 'shell.nav.templates',
  '/emails': 'shell.nav.emails', '/agenda': 'shell.nav.agenda', '/temps': 'shell.nav.time', '/charge': 'shell.nav.workload',
  '/rapports': 'shell.nav.reports', '/clients': 'shell.nav.clients', '/facturation': 'shell.nav.billing',
  '/reglages': 'settings.title', '/recherche': 'home.search.title',
}
const TAB: Record<string, string> = {
  tableau: 'project.tabs.board', liste: 'project.tabs.list', gantt: 'project.tabs.gantt', calendrier: 'project.tabs.calendar',
  etapes: 'project.tabs.stages', temps: 'project.tabs.time', fichiers: 'project.tabs.files', activite: 'project.tabs.activity',
  emails: 'project.tabs.emails', suivi: 'project.tabs.followUp', reglages: 'project.tabs.settings',
}
const SETTINGS: Record<string, string> = {
  profil: 'settings.menu.profile', entreprise: 'settings.menu.company', equipe: 'settings.menu.team', emails: 'settings.menu.emails',
  agendas: 'settings.menu.calendars', 'rendez-vous': 'settings.menu.booking', formulaires: 'settings.menu.forms',
  automatisations: 'settings.menu.automations', integrations: 'settings.menu.integrations', api: 'settings.menu.api',
}

export type PageNames = { project?: string | null; task?: string | null; client?: string | null }

/** Le libellé d'une page de l'application, dans la langue `l` ; les noms (projet, tâche, client) quand on les connaît. */
export function pageLabel(path: string, l: Locale, names: PageNames = {}): string {
  const s = (k: string) => SCREEN[l]?.[k] ?? SCREEN.fr[k] ?? k
  const [pathname, query = ''] = path.split('?')
  const q = new URLSearchParams(query)
  const project = pathname.match(new RegExp(`^/projets/${ID}(?:/([a-z]+))?$`))
  if (project) {
    const parts = [names.project || s('shell.nav.projects')]
    if (project[1] && TAB[project[1]]) parts.push(s(TAB[project[1]]))
    if (q.get('tache') && names.task) parts.push(names.task)
    return parts.join(SEP)
  }
  if (new RegExp(`^/clients/${ID}$`).test(pathname)) return [s('shell.nav.clients'), names.client].filter(Boolean).join(SEP)
  const settings = pathname.match(/^\/reglages\/([a-z-]+)$/)
  if (settings && SETTINGS[settings[1]]) return [s('settings.title'), s(SETTINGS[settings[1]])].join(SEP)
  if (pathname === '/recherche' && q.get('q')) return `${s('home.search.title')}${SEP}${q.get('q')!.slice(0, 80)}`
  return TOP[pathname] ? s(TOP[pathname]) : s('shell.nav.home')
}

/** Le libellé d'une page, avec les noms lus par les routes de l'écran (droits de la personne : sinon, sans le nom). */
export async function labelOf(cookie: string, path: string, l: Locale): Promise<string> {
  const names: PageNames = {}
  const read = async (p: string) => { try { const r = await callApi(cookie, 'GET', p); return r.status === 200 ? r.body : null } catch { return null } }
  const project = path.match(new RegExp(`^/projets/(${ID})`))
  if (project) names.project = (await read(`/api/projects/${project[1]}`))?.name ?? null
  const task = path.match(new RegExp(`[?&]tache=(${ID})`))
  if (task) names.task = (await read(`/api/tasks/${task[1]}`))?.title ?? null
  const client = path.match(new RegExp(`^/clients/(${ID})$`))
  if (client) names.client = (await read(`/api/clients/${client[1]}`))?.name ?? null
  return pageLabel(path, l, names)
}

/**
 * Un chemin de l'application écrit en clair par le modèle (« /reglages/equipe », « https://projectlead.io/projets/… ») :
 * remplacé par le libellé de la page. La cible d'un lien Markdown « [Gantt](/projets/…/gantt) » reste (la bulle n'en
 * montre que le texte et en fait un lien). Rien d'autre ne change.
 */
const RAW = /(?<!\]\()(?<![\w/.:@-])(?:https?:\/\/(?:www\.)?projectlead\.io)?(\/(?:taches|projets|modeles|emails|agenda|temps|charge|rapports|clients|facturation|recherche|reglages)(?:\/[\w-]+)*(?:\?[\w=&%.-]*)?)(?![\w/])/g
export function scrubPaths(text: string, l: Locale): string {
  return text.replace(RAW, (_m, path: string) => pageLabel(path, l))
}
