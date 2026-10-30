import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthShell, AuthSwitch, authLink } from '../components/AuthShell'
import { Spinner } from '../components/ui'
import { useT } from '../i18n'
import { leadAppAuth } from '../lib/leadAppAuth'

/**
 * Page relais de « Continuer avec Google » dans l'app mobile (src/lib/leadAppAuth.ts) : ERPlead y envoie la vue web de
 * l'app ; la connexion Google s'ouvre dans le navigateur du téléphone, l'app revient ensuite toute seule. Publique : la
 * personne n'a pas encore de session ProjectLead. « Retour » ramène à l'écran de connexion de l'app.
 */
export default function LeadAuthGoogle() {
  const t = useT()
  const { search } = useLocation()
  const [back, setBack] = useState<string | null>(null)
  useEffect(() => { void leadAppAuth().relay(search).then((r) => { if (r.back) setBack(r.back) }) }, [search])
  return (
    <AuthShell title={t('shell.leadAuth.title')}>
      <div data-lead-auth-relay>
        <Spinner label={t('shell.leadAuth.body')} />
        {back && <AuthSwitch><a href={back} data-lead-auth-back className={authLink}>{t('shell.leadAuth.back')}</a></AuthSwitch>}
      </div>
    </AuthShell>
  )
}
