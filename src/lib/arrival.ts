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
export function leadStart(next: string | null, signup = false, switchAccount = false) {
  const q = new URLSearchParams()
  if (signup) q.set('signup', '1')
  else if (switchAccount) q.set('switch', '1')
  const page = sameSitePath(next)
  if (page && !/^\/(login|signup)\b/.test(page)) q.set('next', page)
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
 * aussitôt dans l'espace, sans formulaire (même défaut que ScanLead sous un Compte Lead lent). `stopLeaving` : la
 * déconnexion a échoué, ou la page revient du cache arrière du navigateur.
 */
let leavingNow = false
export const startLeaving = () => { leavingNow = true }
export const stopLeaving = () => { leavingNow = false }
export const isLeaving = () => leavingNow

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
const PLACES_TITLE = 'Toutes les places ProjectLead de votre entreprise sont prises'
export const REFUSED: Record<'places' | 'desactive', Refusal> = {
  // Formule inconnue (ancienne adresse sans « formule ») : les deux remèdes.
  places: {
    title: PLACES_TITLE,
    text: 'Votre entreprise a déjà autant de personnes dans ProjectLead que sa formule le permet. Demandez à un administrateur de votre entreprise de libérer une place (Réglages → Équipe) ou, si elle n\'est pas encore en Pro+, de passer à Pro+, jusqu\'à 5 places (Réglages → Entreprise).',
    upgrade: true,
  },
  desactive: {
    title: 'Votre accès à ProjectLead est désactivé',
    text: 'Votre accès à l\'espace ProjectLead de votre entreprise est désactivé. Un administrateur de votre entreprise peut le rétablir (Réglages → Équipe).',
    upgrade: false,
  },
}

/**
 * Le conseil d'un refus « places », juste pour la formule de l'entreprise (suites de l'abonnement, 15.10.2026, points
 * 4 et 6a) : Pro+ plein → libérer une place, aucune offre (aucune formule ne donne plus de places) ; Gratuit ou Pro
 * (1 place) → Pro+ en donne 5, ou libérer la place, avec « Voir les formules ». Un administrateur actif entre toujours :
 * c'est à lui de le faire.
 */
export function placesRefusal(formule: Formule | null): Refusal {
  if (formule === 'proplus') return { title: PLACES_TITLE, upgrade: false,
    text: 'Votre entreprise utilise déjà les 5 places de sa formule Pro+ dans ProjectLead, la plus grande. Demandez à un administrateur de votre entreprise de libérer une place (Réglages → Équipe) : il peut toujours se connecter.' }
  if (formule === 'free' || formule === 'pro') return { title: PLACES_TITLE, upgrade: true,
    text: `Votre entreprise est en formule ${formule === 'free' ? 'Gratuite' : 'Pro'} dans ProjectLead : 1 place, déjà prise. Pro+ donne jusqu'à 5 places. Demandez à un administrateur de votre entreprise de passer à Pro+ (Réglages → Entreprise) ou de libérer la place (Réglages → Équipe) : il peut toujours se connecter.` }
  return REFUSED.places
}
