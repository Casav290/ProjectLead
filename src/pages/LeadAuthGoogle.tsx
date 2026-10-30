import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthShell, AuthSwitch, authLink } from '../components/AuthShell'
import { Spinner } from '../components/ui'
import { useT } from '../i18n'
import { leadAppAuth, type RelayView } from '../lib/leadAppAuth'

/**
 * Page relais de « Continuer avec Google » dans l'app mobile (src/lib/leadAppAuth.ts) : ERPlead y envoie la vue web de
 * l'app ; la connexion Google s'ouvre dans le navigateur sûr du téléphone (session iOS, Custom Tab Android), l'app revient
 * ensuite toute seule par son lien vérifié. Sous iOS 15 à 17.3 (navigateur par défaut d'iOS, pas toujours Safari), la
 * personne touche « Ouvrir ProjectLead » à la fin : la page le dit. Publique : la personne n'a pas encore de session
 * ProjectLead. « Retour » ramène à l'écran de connexion de l'app.
 */
export default function LeadAuthGoogle() {
  const t = useT()
  const { search } = useLocation()
  const [view, setView] = useState<RelayView | null>(null)
  useEffect(() => {
    void leadAppAuth().relay(search, setView).then((r) => { if (r.back) setView((v) => v ?? { back: r.back!, mode: 'browser' }) })
  }, [search])
  return (
    <AuthShell title={t('shell.leadAuth.title')}>
      <div data-lead-auth-relay data-mode={view?.mode ?? ''}>
        <Spinner label={view?.mode === 'safari' ? t('shell.leadAuth.safari') : t('shell.leadAuth.body')} />
        {view && <AuthSwitch><a href={view.back} data-lead-auth-back className={authLink}>{t('shell.leadAuth.back')}</a></AuthSwitch>}
      </div>
    </AuthShell>
  )
}
