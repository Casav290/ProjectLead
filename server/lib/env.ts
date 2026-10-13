/**
 * Sommes-nous en production ? `NODE_ENV` ne suffit pas à lui seul : un déploiement qui l'oublie
 * ferait tomber en silence le cookie `secure` et la garde contre les adresses internes (bêta-test
 * du 19.09.2026). Une adresse publique en https hors localhost compte donc aussi comme production.
 */
export function isProduction() {
  if (process.env.NODE_ENV === 'production') return true
  try {
    const u = new URL(process.env.PUBLIC_URL ?? '')
    return u.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)
  } catch { return false }
}

/** Le Compte Lead est-il branché (connexion, formule, déclaration des abonnements) ? */
export const leadIdOn = () => Boolean(process.env.LEAD_ID_CLIENT_SECRET && process.env.LEAD_ID_ISSUER)

/** L'adresse publique de l'application, sans barre finale (liens de retour de Stripe, réponses 402). */
export const publicUrl = () => (process.env.PUBLIC_URL || 'https://projectlead.io').replace(/\/+$/, '')
