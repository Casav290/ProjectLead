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
