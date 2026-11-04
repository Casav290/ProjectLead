import type { Me } from '../lib/types'
import type { TourStep } from './types'

/**
 * Les étapes de la visite de ProjectLead (04.11.2026). Une idée par étape, fidèle aux vraies fonctions ; les zones
 * voisines du menu sont groupées pour garder la visite courte. Textes : `tour.*` (src/i18n/locales/<langue>/tour.json).
 * Cibles : les `data-tour` de Layout.tsx et la bulle de l'Assistant IA (`data-assistant-bubble`, Assistant.tsx).
 */
const nav = (...to: string[]) => to.map((p) => `[data-tour="nav:${p}"]`)

export function projectLeadSteps(me: Me): TourStep[] {
  const steps: TourStep[] = [
    { id: 'welcome', title: 'tour.welcome.title', body: 'tour.welcome.body', art: 'map' },
    { id: 'home', target: nav('/'), inMenu: true, title: 'tour.home.title', body: 'tour.home.body', art: 'home' },
    { id: 'projects', target: nav('/projets'), inMenu: true, title: 'tour.projects.title', body: 'tour.projects.body', art: 'stages' },
    { id: 'tasks', target: nav('/taches'), inMenu: true, title: 'tour.tasks.title', body: 'tour.tasks.body', art: 'board' },
    { id: 'inbox', target: nav('/emails', '/agenda'), inMenu: true, title: 'tour.inbox.title', body: 'tour.inbox.body', art: 'mail' },
    { id: 'time', target: nav('/temps', '/charge', '/rapports'), inMenu: true, title: 'tour.time.title', body: 'tour.time.body', art: 'clock' },
    { id: 'clients', target: nav('/clients', '/facturation'), inMenu: true, title: 'tour.clients.title', body: 'tour.clients.body', art: 'invoice' },
    { id: 'search', target: '[data-tour="search"]', title: 'tour.search.title', body: 'tour.search.body', art: 'search' },
    { id: 'settings', target: nav('/modeles', '/reglages'), inMenu: true, title: 'tour.settings.title', body: 'tour.settings.body', art: 'toggles' },
  ]
  // La bulle n'existe que si l'Assistant IA est branché sur ce serveur (Assistant.tsx).
  if (me.features.assistant) {
    steps.push({
      id: 'assistant', target: '[data-assistant-bubble]', title: 'tour.assistant.title', body: 'tour.assistant.body', art: 'chat',
      action: { label: 'tour.try', run: () => document.querySelector<HTMLButtonElement>('[data-assistant-bubble]')?.click() },
    })
  }
  steps.push({ id: 'replay', target: '[data-tour="profile"]', title: 'tour.replay.title', body: 'tour.replay.body', art: 'menu' })
  return steps
}
