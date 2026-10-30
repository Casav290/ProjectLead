import { Hono } from 'hono'

/**
 * Les fichiers d'association des liens d'app (« Continuer avec Google » dans l'app mobile, 30.10.2026, révisé : liens
 * vérifiés ; contrat d'ERPlead docs/GOOGLE-APP.md § 3d). Ils réservent à l'app ProjectLead, et à elle seule, le lien de
 * retour https://projectlead.io/lead-auth/return :
 * - iOS : `apple-app-site-association` (Universal Link `applinks`, et `webcredentials`, exigé par
 *   ASWebAuthenticationSession pour un retour https) ; l'app déclare `applinks:projectlead.io` et
 *   `webcredentials:projectlead.io` (ios/App/App/App.entitlements du dépôt mobile) ;
 * - Android : `assetlinks.json` (App Link vérifié) ; l'app déclare un intent-filter `android:autoVerify="true"` sur
 *   https://projectlead.io/lead-auth/return. Empreintes : certificat Play App Signing (lu par l'API Play, vérifié sur les
 *   APK générés par Play) et clé d'envoi (AAB signés de ~/projets/publications/projectlead/android/).
 *
 * Servis par la fonction (scripts/vercel-build.mjs : /.well-known → fonction), avec leurs en-têtes : 200,
 * `Content-Type: application/json`, aucune redirection (ni www, ni langue), pour tout agent (le CDN d'Apple, Google).
 * Rien d'autre du site n'est revendiqué : un lien vers une autre page de projectlead.io reste dans le navigateur.
 */
export const IOS_APP_ID = 'X6K5247J6G.io.projectlead.app'
export const ANDROID_PACKAGE = 'io.projectlead.app'
export const ANDROID_CERT_SHA256 = [
  // Play App Signing (certificat de signature des APK distribués par Google Play)
  '4C:19:E3:F6:B5:48:5E:F4:93:07:0D:5C:CA:DF:6F:F5:CF:D7:59:36:6E:F5:83:84:1B:1D:C4:64:B3:B4:4E:2C',
  // Clé d'envoi (~/.android-signing/projectlead-upload.jks : AAB envoyés à Play, APK d'essai construits ici)
  'E1:42:CC:0C:43:67:1C:EC:CA:C6:3D:32:31:C3:4D:57:E4:5A:3E:AD:F0:27:D1:3B:27:64:B5:C8:43:4A:5E:2A',
]
export const RETURN_PATH = '/lead-auth/return'

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: [IOS_APP_ID],
        components: [
          { '/': RETURN_PATH, comment: 'Retour de « Continuer avec Google » (Compte Lead) vers l\'app' }, // i18n-ok
        ],
      },
    ],
  },
  webcredentials: { apps: [IOS_APP_ID] },
}

export const ASSET_LINKS = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_CERT_SHA256 },
}]

const json = (body: unknown) => new Response(`${JSON.stringify(body, null, 2)}\n`, {
  status: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
})

const app = new Hono()
app.get('/.well-known/apple-app-site-association', () => json(APPLE_APP_SITE_ASSOCIATION))
app.get('/.well-known/assetlinks.json', () => json(ASSET_LINKS))

export default app
