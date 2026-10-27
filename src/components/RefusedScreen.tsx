import { useT } from '../i18n'
import { leadStart, placesRefusal, REFUSED, type Formule } from '../lib/arrival'
import { leadEntry } from '../lib/leadFamily'
import { isNativeApp } from '../lib/native'
import { AuthShell, AuthSwitch, authLink } from './AuthShell'

/**
 * L'écran d'une arrivée refusée (places prises, accès retiré), servi sans session à
 * `/login?erreur=places&formule=<free|pro|proplus>` (suites de l'abonnement, 15.10.2026, points 4 et 6a ; modèle :
 * /no-access de Greetlead). Il dit quoi faire selon la formule de l'entreprise (src/lib/arrival.ts) et offre :
 * - « Changer de compte » (data-switch-account) : nouveau départ avec `switch=1`, le Compte Lead redemande l'adresse et
 *   le mot de passe (prompt=login) ; plus de « Réessayer », qui reprenait la même session et ramenait au même refus ;
 * - « Voir les formules » (data-upgrade, page publique /formules) quand une formule avec plus de places existe ;
 * - « Retour à mon Compte Lead » : https://erplead.io/account.
 */
export function RefusedScreen({ reason, formule, next }: { reason: 'places' | 'desactive'; formule: Formule | null; next: string | null }) {
  const t = useT()
  const r = reason === 'places' ? placesRefusal(formule) : REFUSED.desactive
  return (
    <AuthShell title={r.title}>
      <p role="alert" className="mb-6 text-sm text-muted-foreground">{r.text}</p>
      <a href={leadStart(next, false, true)} data-switch-account="" data-testid="lead-switch"
        className="flex h-10 w-full items-center justify-center bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-accent-dark">
        {t('shell.refused.switch')}</a>
      <p className="mt-3 text-center text-sm text-muted-foreground">{t('shell.refused.switchHint')}</p>
      {r.upgrade && !isNativeApp && (
        <a href="/formules" data-upgrade=""
          className="mt-4 flex h-10 w-full items-center justify-center border border-input bg-card px-3 text-sm font-bold hover:bg-[#f4f2ef]">
          {t('shell.refused.seePlans')}</a>
      )}
      <AuthSwitch><a href={leadEntry('erplead')} className={authLink}>{t('shell.refused.backToLead')}</a></AuthSwitch>
    </AuthShell>
  )
}
