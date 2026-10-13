/**
 * La famille Lead : la liste canonique, la même dans les six applications (demande d'Ève du 13.10.2026 : « toutes les
 * applications apparaissent sur toutes les apps »). Copie TELLE QUELLE de ~/projets/lead-e2e/lead-family.json (champ
 * « family » de la conception du passage) : ne pas la modifier ici seule, check-launchers.mjs compare les six dépôts.
 *
 * Le lanceur à 9 points (src/components/AppSwitcher.tsx) la lit directement : ni réseau, ni formule, ni droits. Chaque
 * entrée mène à l'adresse d'entrée de l'application (`entry`), qui ouvre tout droit l'espace de l'entreprise quand la
 * session ERPlead est ouverte, jamais à sa page publique ni à une page de formule.
 */
export const LEAD_FAMILY = {
  "version": 1,
  "note": "Liste canonique de la famille Lead. Copiée telle quelle (même contenu, même ordre) dans les 6 dépôts et dans ~/projets/lead-e2e/lead-family.json ; check-launchers.mjs compare les copies.",
  "title": {
    "fr": "Applications Lead",
    "de": "Lead-Apps",
    "en": "Lead apps",
    "it": "App Lead",
    "es": "Apps Lead"
  },
  "open": {
    "fr": "Ouvrir",
    "de": "Öffnen",
    "en": "Open",
    "it": "Apri",
    "es": "Abrir"
  },
  "here": {
    "fr": "Vous êtes ici",
    "de": "Sie sind hier",
    "en": "You are here",
    "it": "Sei qui",
    "es": "Estás aquí"
  },
  "apps": [
    {
      "code": "erplead",
      "name": "ERPlead",
      "mark": "EL",
      "color": "#4338ca",
      "origin": "https://erplead.io",
      "entry": "https://erplead.io/account",
      "fresh": "https://erplead.io/account",
      "do": {
        "fr": "Gérer mon compte",
        "de": "Mein Konto verwalten",
        "en": "Manage my account",
        "it": "Gestire il mio account",
        "es": "Gestionar mi cuenta"
      }
    },
    {
      "code": "scanlead",
      "name": "Scanlead",
      "mark": "SL",
      "color": "#2563eb",
      "origin": "https://scanlead.io",
      "entry": "https://scanlead.io/login",
      "fresh": "https://scanlead.io/auth/lead/start?locale={locale}&fresh=1",
      "do": {
        "fr": "Scanner des contacts",
        "de": "Kontakte scannen",
        "en": "Scan contacts",
        "it": "Scansionare contatti",
        "es": "Escanear contactos"
      }
    },
    {
      "code": "crmlead",
      "name": "CRMlead",
      "mark": "CL",
      "color": "#0f6e70",
      "origin": "https://crmlead.io",
      "entry": "https://crmlead.io/login",
      "fresh": "https://crmlead.io/auth/lead/start?locale={locale}&fresh=1",
      "do": {
        "fr": "Suivre mes leads",
        "de": "Meine Leads verfolgen",
        "en": "Follow up my leads",
        "it": "Seguire i miei lead",
        "es": "Seguir mis leads"
      }
    },
    {
      "code": "projectlead",
      "name": "ProjectLead",
      "mark": "PL",
      "color": "#9a6a00",
      "origin": "https://projectlead.io",
      "entry": "https://projectlead.io/login",
      "fresh": "https://projectlead.io/auth/lead/start?locale={locale}&fresh=1",
      "do": {
        "fr": "Gérer mes projets",
        "de": "Meine Projekte verwalten",
        "en": "Manage my projects",
        "it": "Gestire i miei progetti",
        "es": "Gestionar mis proyectos"
      }
    },
    {
      "code": "invoicelead",
      "name": "InvoiceLead",
      "mark": "IL",
      "color": "#7a2e67",
      "origin": "https://invoicelead.io",
      "entry": "https://invoicelead.io/login",
      "fresh": "https://invoicelead.io/auth/lead/start?locale={locale}&fresh=1",
      "do": {
        "fr": "Faire une facture",
        "de": "Rechnung erstellen",
        "en": "Create an invoice",
        "it": "Creare una fattura",
        "es": "Crear una factura"
      }
    },
    {
      "code": "greetlead",
      "name": "Greetlead",
      "mark": "GL",
      "color": "#c2185b",
      "origin": "https://greetlead.io",
      "entry": "https://greetlead.io/login",
      "fresh": "https://greetlead.io/auth/lead/start?locale={locale}&fresh=1",
      "do": {
        "fr": "Envoyer une carte",
        "de": "Karte senden",
        "en": "Send a card",
        "it": "Inviare un biglietto",
        "es": "Enviar una tarjeta"
      }
    }
  ],
  "workspace_home": {
    "erplead": "/account",
    "scanlead": "/dashboard",
    "crmlead": "/",
    "projectlead": "/",
    "invoicelead": "/{locale}/app",
    "greetlead": "/{locale}/app"
  }
} as const

export type LeadAppCode = (typeof LEAD_FAMILY.apps)[number]['code']
export type LeadLocale = keyof typeof LEAD_FAMILY.title

/** Cette application-ci : elle reste à sa place dans la liste, sans lien, « Vous êtes ici ». */
export const HERE_APP: LeadAppCode = 'projectlead'

/** La langue du lanceur : fr, de, en, it ou es ; le français par défaut. */
export function leadLocale(l?: string | null): LeadLocale {
  const two = String(l ?? '').slice(0, 2).toLowerCase()
  return two in LEAD_FAMILY.title ? (two as LeadLocale) : 'fr'
}

/** L'adresse d'entrée d'une application de la famille (lanceur, liens entre applications). */
export const leadEntry = (code: LeadAppCode) => LEAD_FAMILY.apps.find((a) => a.code === code)!.entry
