import { LEAD_FAMILY, leadEntry } from '../lib/leadFamily'

/**
 * Les applications Lead reliées sans clé (26.10.2026) : même entreprise dans le Compte Lead = reliées. Ce qui se dit
 * quand une application n'est pas encore utilisée par l'entreprise, partout où elle servirait.
 */
export type LinkedApp = 'crmlead' | 'invoicelead'
export const APP_NAME: Record<LinkedApp, string> = { crmlead: 'CRMlead', invoicelead: 'InvoiceLead' }

/** L'adresse de l'application (liens construits ici par identifiant, jamais une URL reçue). */
export const appOrigin = (app: LinkedApp) => LEAD_FAMILY.apps.find((a) => a.code === app)!.origin

/** « Ouvrir {app} » : son adresse d'entrée, qui connecte par le Compte Lead. */
export function OpenApp({ app, className }: { app: LinkedApp; className?: string }) {
  return (
    <a data-open-app={app} href={leadEntry(app)} target="_blank" rel="noopener noreferrer"
      className={className ?? 'inline-flex items-center gap-1 border border-input bg-card px-3 py-1.5 text-sm font-bold hover:bg-muted'}>
      Ouvrir {APP_NAME[app]} ↗
    </a>
  )
}

/** Le texte « Pas encore utilisée », et le bouton pour l'ouvrir. */
export function NotUsed({ app, compact }: { app: LinkedApp; compact?: boolean }) {
  return (
    <div data-link-state="not_used" className={compact ? 'space-y-2' : 'space-y-3'}>
      <p className="text-sm">{APP_NAME[app]} : pas encore utilisée par votre entreprise. Ouvrez-la avec votre Compte Lead (gratuit pour
        commencer) : le lien se fait tout seul.</p>
      <OpenApp app={app} />
    </div>
  )
}
