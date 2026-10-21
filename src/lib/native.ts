/**
 * L'app Android / iOS de ProjectLead (coque Capacitor, dépôt de l'app : ~/projets/projectlead-mobile) ouvre
 * https://projectlead.io : c'est ce même code qui tourne dedans. On la reconnaît à son agent (`ProjectLeadApp`, posé par
 * `appendUserAgent`) ou au pont Capacitor injecté dans la page.
 *
 * Dans l'app, ni prix, ni formule à prendre, ni renvoi vers un paiement ailleurs : Apple (règle 3.1.1) et Google Play
 * exigent leurs propres achats intégrés pour un abonnement numérique. La formule se lit, elle ne s'achète pas ici.
 */
declare global {
  interface Window { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }
}

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
const bridge = typeof window === 'undefined' ? undefined : window.Capacitor

export const NATIVE_UA = /ProjectLeadApp/
export const isNativeApp = NATIVE_UA.test(ua) || !!bridge?.isNativePlatform?.()
