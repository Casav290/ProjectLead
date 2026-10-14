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

/** L'adresse de départ vers le Compte Lead, avec la page demandée pour y revenir ensuite. */
export function leadStart(next: string | null, signup = false) {
  const q = new URLSearchParams()
  if (signup) q.set('signup', '1')
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
 * L'écran de connexion part-il seul vers le Compte Lead ? Oui une fois, quand le Compte Lead est branché et qu'on
 * arrive sans erreur ; jamais après un retour en erreur (`erreur=…`) ni sur l'accès par e-mail : pas de boucle.
 */
export const departsAlone = (o: { leadId: boolean | null; code: string; withEmail: boolean }) => o.leadId === true && !o.code && !o.withEmail
