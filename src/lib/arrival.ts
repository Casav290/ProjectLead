/**
 * L'arrivée dans ProjectLead (passer d'une application Lead à l'autre, Ève, 13.10.2026). ProjectLead n'a pas de page
 * publique : sa racine EST l'application. L'adresse d'entrée https://projectlead.io/login (celle du lanceur et des
 * liens des autres applications), la racine tapée et tout lien profond suivent la même règle :
 * - session ProjectLead ouverte → la page demandée, sinon l'accueil de l'espace (`alreadyInTarget`) ;
 * - sinon UN départ vers le Compte Lead, sans `prompt` (`leadStart`) : session ERPlead ouverte, retour sans écran dans
 *   l'espace de l'entreprise ; fermée, ERPlead montre sa connexion aux couleurs de ProjectLead, puis revient sur la page
 *   demandée. ERPlead affiche un formulaire au lieu de renvoyer : pas de boucle possible.
 * - un retour en erreur (`/login?erreur=…`) ne repart jamais seul (`departsAlone`) : seul un clic relance.
 * Mêmes règles que le serveur (`safeNext`, server/routes/auth.ts) pour la page demandée.
 */

import { t } from '../i18n'

/** Un chemin de ProjectLead seulement : ni « //autre.site », ni « /\autre.site », ni caractère de contrôle. */
export function sameSitePath(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(v) && v.length <= 2048
    ? v : undefined
}

/** La page demandée avant la connexion : `?next=` de /login, sinon l'adresse profonde ouverte sans session. */
export function requestedPage(pathname: string, search: string): string | null {
  const next = new URLSearchParams(search).get('next')
  if (next !== null) return sameSitePath(next) ?? null
  return pathname !== '/' && pathname !== '/login' ? sameSitePath(pathname + search) ?? null : null
}

/**
 * L'adresse de départ vers le Compte Lead, avec la page demandée pour y revenir ensuite. `switchAccount` (« Changer de
 * compte » d'un écran de refus) : le Compte Lead redemande l'identifiant (prompt=login), jamais la même session reprise.
 */
export function leadStart(next: string | null, signup = false, switchAccount = false, locale?: string | null) {
  const q = new URLSearchParams()
  if (signup) q.set('signup', '1')
  else if (switchAccount) q.set('switch', '1')
  const page = sameSitePath(next)
  if (page && !/^\/(login|signup)\b/.test(page)) q.set('next', page)
  // La langue de l'écran : le serveur la passe à ERPlead (ui_locales), qui montre sa connexion dans la même langue.
  if (locale) q.set('locale', locale)
  const s = q.toString()
  return `/auth/lead/start${s ? `?${s}` : ''}`
}

/** /login avec une session déjà ouverte : la page demandée (?next=), sinon l'accueil de l'espace. */
export const alreadyInTarget = (next: string | null) => {
  const page = sameSitePath(next)
  return page && !/^\/(login|signup)\b/.test(page) ? page : '/'
}

/**
 * « Se déconnecter » en route (15.10.2026). La session ProjectLead est déjà fermée et la page attend la déconnexion du
 * Compte Lead (ERPlead /oauth/logout), parfois plusieurs secondes. Pendant ce temps, rien ne doit la renvoyer vers la
 * connexion : la relecture de /me (toutes les minutes) y voyait un 401, l'écran de connexion partait seul vers le
 * Compte Lead et remplaçait la déconnexion encore en route ; la session ERPlead restait ouverte et la personne rentrait
 * aussitôt dans l'espace, sans formulaire (même défaut que ScanLead sous un Compte Lead lent). `to` : l'adresse de
 * sortie reçue au 1er clic (null tant que la réponse n'est pas là). `stopLeaving` : la déconnexion a échoué, ou la page
 * revient du cache arrière du navigateur.
 */
export type Leaving = { to: string | null }
let leavingNow: Leaving | null = null
const watchers = new Set<() => void>()
const setLeaving = (v: Leaving | null) => { leavingNow = v; watchers.forEach((f) => f()) }
export const startLeaving = () => setLeaving({ to: null })
export const stopLeaving = () => setLeaving(null)
export const isLeaving = () => leavingNow !== null
/** La sortie en cours, pour le bouton (useSyncExternalStore) : le même objet tant qu'elle ne change pas. */
export const leavingState = () => leavingNow
export const watchLeaving = (f: () => void) => { watchers.add(f); return () => { watchers.delete(f) } }

/**
 * Un clic sur « Se déconnecter » (relecture du 20.10.2026). POST /auth/logout au 1er clic seulement : sa réponse ferme la
 * session et efface le cookie ; un 2e POST partait sans cookie, recevait « /login », et cette navigation coupait la
 * déconnexion d'ERPlead encore en route (la page /login neuve repartait vers le Compte Lead, toujours ouvert : la
 * personne rentrait sans formulaire). Un clic pendant la sortie : rien tant que la réponse n'est pas là ; ensuite, la
 * même adresse de sortie relancée (navigation arrêtée par Échap ou Stop), jamais /login à sa place.
 */
export async function leave(post: () => Promise<{ redirect: string | null }>, go: (to: string) => void) {
  if (leavingNow) { if (leavingNow.to) go(leavingNow.to); return }
  startLeaving()
  let to: string
  try { to = (await post()).redirect ?? '/login' } catch (e) { stopLeaving(); throw e }
  setLeaving({ to })
  go(to)
}

/**
 * L'écran de connexion part-il seul vers le Compte Lead ? Oui une fois, quand le Compte Lead est branché et qu'on
 * arrive sans erreur ; jamais après un retour en erreur (`erreur=…`) ni sur l'accès par e-mail : pas de boucle. Jamais
 * non plus pendant « Se déconnecter » (`startLeaving`) : ce départ remplacerait la déconnexion du Compte Lead.
 */
export const departsAlone = (o: { leadId: boolean | null; code: string; withEmail: boolean }) =>
  o.leadId === true && !o.code && !o.withEmail && !leavingNow

/** La formule de l'entreprise dans l'adresse d'un refus « places » (server/routes/auth.ts, refusalLocation). */
export type Formule = 'free' | 'pro' | 'proplus'
export const formuleOf = (v: string | null | undefined): Formule | null => (v === 'free' || v === 'pro' || v === 'proplus' ? v : null)

/**
 * Les arrivées refusées sans autre issue (server/routes/auth.ts, ArrivalRefused) : jamais d'espace à part, un écran qui
 * dit quoi faire (src/components/RefusedScreen.tsx). Pas de nouveau départ automatique ni de « Réessayer » : ils
 * redonneraient le même refus ; l'écran offre « Changer de compte » (prompt=login) et le Compte ERPlead.
 * « desactive » ne dit pas QUI a désactivé : un administrateur ProjectLead (« Retirer »), ou ERPlead pour une personne
 * sortie de son organisation avant le passage (rien ne distingue ces deux cas dans les données d'avant
 * db/009_passage.sql). Le remède est le même : un administrateur la rétablit dans Réglages → Équipe.
 * `upgrade` : l'écran offre « Voir les formules » (une formule avec plus de places existe).
 */
export type Refusal = { title: string; text: string; upgrade: boolean }
// Les textes suivent la langue : lus au rendu (getters), jamais figés au chargement (clés shell.refused.*).
const refusal = (title: string, text: string, upgrade: boolean): Refusal => ({
  get title() { return t(`shell.refused.${title}`) }, get text() { return t(`shell.refused.${text}`) }, upgrade,
})
export const REFUSED: Record<'places' | 'desactive', Refusal> = {
  // Formule inconnue (ancienne adresse sans « formule ») : les deux remèdes.
  places: refusal('placesTitle', 'placesText', true),
  desactive: refusal('disabledTitle', 'disabledText', false),
}

/**
 * Le conseil d'un refus « places », juste pour la formule de l'entreprise (suites de l'abonnement, 15.10.2026, points
 * 4 et 6a) : Pro+ plein → libérer une place, aucune offre (aucune formule ne donne plus de places) ; Gratuit ou Pro
 * (1 place) → Pro+ en donne 5, ou libérer la place, avec « Voir les formules ». Un administrateur actif entre toujours :
 * c'est à lui de le faire.
 */
export function placesRefusal(formule: Formule | null): Refusal {
  if (formule === 'proplus') return refusal('placesTitle', 'placesProPlusText', false)
  if (formule === 'free') return refusal('placesTitle', 'placesFreeText', true)
  if (formule === 'pro') return refusal('placesTitle', 'placesProText', true)
  return REFUSED.places
}
