import { useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * Politique de confidentialité et conditions d'utilisation, lisibles sans compte.
 *
 * Le texte dit ce que le code fait réellement (boîtes mail : server/lib/mailbox/index.ts, pages
 * publiques : server/routes/portal.ts…) ; le modifier, c'est modifier une promesse.
 */

const UPDATED = '02.10.2026'
// Le contact de Quantum Liquid LLC, commun aux applications Lead.
const CONTACT = 'support@scanlead.io'
const PUBLISHER = 'Quantum Liquid LLC, société de droit du Wyoming, 30 N Gould St, Sheridan, WY 82801, États-Unis'

type Section = { h: string; p: (string | string[])[] }

const PRIVACY: { title: string; intro: string; sections: Section[] } = {
  title: 'Politique de confidentialité',
  intro: `ProjectLead est un logiciel de gestion de projet édité par ${PUBLISHER}. Cette page explique quelles données ProjectLead traite, pourquoi, où elles vont et combien de temps elles restent. Contact : ${CONTACT}.`,
  sections: [
    { h: '1. Données traitées', p: [[
      'Compte : nom, adresse e-mail, entreprise, rôle. La connexion passe par le Compte Lead (commun à Scanlead, CRMlead, ProjectLead et InvoiceLead) ; un mot de passe local, quand il existe, est enregistré sous forme d\'empreinte, jamais en clair.',
      'Données de travail saisies ou importées par les utilisateurs : projets, étapes, tâches, commentaires, pièces jointes, temps passé, taux horaires, budgets, modèles, notes.',
      'Clients et contacts : nom, fonction, e-mail, téléphone, adresse, saisis dans ProjectLead ou repris de CRMlead et d\'InvoiceLead.',
      'Demandes et rendez-vous reçus par les pages publiques (formulaire de demande, prise de rendez-vous) : nom, e-mail, téléphone et message laissés par la personne.',
      'Boîtes mail et agendas connectés, uniquement si l\'utilisateur les branche lui-même : voir la section 3.',
      'Données techniques : sessions de connexion (date, navigateur) et journal d\'activité des projets.',
    ]] },
    { h: '2. Finalités', p: [
      'Fournir le service : organiser les projets et les tâches, suivre le temps et la charge, tenir les clients informés, préparer la facturation dans InvoiceLead, envoyer les e-mails demandés par l\'utilisateur.',
      'Sécurité : authentification, isolation des entreprises, traçabilité des modifications.',
      'ProjectLead ne vend aucune donnée, ne fait pas de publicité, ne dépose aucun traceur publicitaire et ne constitue pas de profils à des fins marketing.',
    ] },
    { h: '3. Boîtes mail et agendas', p: [
      'Une boîte mail se branche par IMAP et SMTP avec un mot de passe d\'application que l\'utilisateur crée lui-même chez son fournisseur, ou, lorsque ces connexions sont proposées, par Google ou Microsoft. Les règles suivantes valent pour toutes les boîtes branchées :',
      [
        'Seuls les e-mails échangés avec un client du compte (ou un de ses contacts) sont enregistrés en entier et rattachés au projet en cours de ce client.',
        'File « À trier » : pour un message reçu d\'une personne qui n\'est pas encore cliente, seuls l\'expéditeur, l\'objet et la date sont enregistrés, pour proposer d\'ouvrir un projet. Jamais le contenu. Les lettres d\'information sont écartées, et ces entrées sont effacées après 30 jours si personne ne les traite.',
        'Les e-mails ne partent que sur action de l\'utilisateur, ou pour les suivis automatiques qu\'il a lui-même activés sur un projet, depuis sa propre adresse quand une boîte est branchée.',
        'Les mots de passe et jetons d\'accès sont chiffrés. Débrancher la boîte dans les réglages les supprime.',
      ],
      'Un agenda externe se relie par son adresse de publication (format iCalendar) : ProjectLead n\'en lit que les créneaux pour calculer les disponibilités et ne les modifie pas.',
    ] },
    { h: '4. Pages publiques et clients', p: [
      'La page de suivi d\'un projet, ouverte par un lien secret envoyé au client, ne montre que ce qui est coché « visible par le client » : jamais les autres projets, les montants internes, les commentaires internes ni les adresses de l\'équipe. Le lien peut être révoqué à tout moment.',
    ] },
    { h: '5. Destinataires et sous-traitants', p: [
      'Les données d\'une entreprise ne sont visibles que par ses membres, selon leurs droits. Une boîte mail connectée n\'est visible que par la personne qui l\'a branchée.',
      [
        'Neon, Inc. (États-Unis) : hébergement de l\'application et de la base de données, pièces jointes comprises.',
        'Resend, Inc. (États-Unis) : envoi des e-mails du service (suivis clients, invitations, confirmations de rendez-vous) quand aucune boîte n\'est branchée.',
        'CRMlead et InvoiceLead, applications de la même famille éditées par Quantum Liquid LLC : uniquement si l\'entreprise les relie par une clé d\'API (clients repris, affaires gagnées, brouillons de facture).',
        'Google LLC et Microsoft Corporation : uniquement pour les boîtes que l\'utilisateur a lui-même branchées.',
      ],
      'Ces prestataires traitent les données hors de l\'Union européenne, notamment aux États-Unis.',
    ] },
    { h: '6. Durées de conservation', p: [
      'Les données d\'une entreprise sont conservées tant que son compte est actif, puis effacées sur demande. Les sessions expirent après 30 jours, les invitations non acceptées après leur échéance.',
    ] },
    { h: '7. Sécurité', p: [
      'Connexions chiffrées (HTTPS), mots de passe hachés, secrets des boîtes et clés d\'API chiffrés, isolation des entreprises au niveau de la base de données, journal d\'activité.',
    ] },
    { h: '8. Vos droits', p: [
      `Vous pouvez demander l'accès à vos données, leur rectification, leur effacement ou leur export, et vous opposer à un traitement, en écrivant à ${CONTACT}. Ces droits s'exercent selon le RGPD pour les personnes situées dans l'Union européenne et selon la loi fédérale sur la protection des données pour la Suisse.`,
    ] },
    { h: '9. Modifications', p: [`Cette politique peut évoluer ; la date de dernière mise à jour figure ici. Dernière mise à jour : ${UPDATED}.`] },
  ],
}

const TERMS: typeof PRIVACY = {
  title: "Conditions d'utilisation",
  intro: `ProjectLead est édité par ${PUBLISHER}. En utilisant ProjectLead, vous acceptez les présentes conditions. Contact : ${CONTACT}.`,
  sections: [
    { h: '1. Le service', p: ['ProjectLead permet de mener les projets après la signature : étapes, tâches, temps, suivi des clients et préparation de la facturation. Le service évolue et peut être modifié, amélioré ou interrompu en partie.'] },
    { h: '2. Compte et formule', p: ['L\'accès se fait avec le Compte Lead, ouvert à tous, gratuitement. La formule de la famille Lead, prise une fois dans n\'importe quelle application, fixe seulement les quantités : en gratuit, 3 projets en cours à la fois et 1 personne ; en Pro, projets sans limite ; en Pro+, jusqu\'à 5 personnes. Une limite porte sur les actions, jamais sur les données déjà créées. Les brouillons de facture dans InvoiceLead demandent une clé d\'API InvoiceLead, comprise dans la formule Pro+. Vous êtes responsable de l\'exactitude des informations du compte, de la confidentialité de vos accès et de l\'usage fait par les membres que vous invitez.'] },
    { h: '3. Vos données', p: ['Les données que vous saisissez, importez ou synchronisez restent les vôtres. Vous garantissez avoir le droit de les traiter, notamment les coordonnées de vos clients et contacts. Leur traitement est décrit dans la politique de confidentialité.'] },
    { h: '4. Facturation dans InvoiceLead', p: ['ProjectLead ne crée dans InvoiceLead que des brouillons de facture. Rien n\'est émis ni envoyé à vos clients sans que vous le fassiez vous-même dans InvoiceLead : vous restez responsable des factures émises.'] },
    { h: '5. Usage acceptable', p: [[
      'Ne pas utiliser le service pour envoyer des messages non sollicités en masse ni pour des contenus illicites.',
      'Ne pas tenter d\'accéder aux données d\'une autre entreprise ni de perturber le service.',
      'Ne pas revendre l\'accès au service sans accord écrit.',
    ]] },
    { h: '6. Disponibilité et responsabilité', p: ['Le service est fourni « en l\'état ». L\'éditeur s\'efforce d\'en assurer la disponibilité et la sécurité, sans garantie d\'absence d\'interruption. Dans les limites permises par la loi, sa responsabilité est exclue pour les dommages indirects, notamment la perte de chiffre d\'affaires. Un compte qui enfreint ces conditions peut être suspendu.'] },
    { h: '7. Droit applicable', p: ['Ces conditions sont régies par le droit de l\'État du Wyoming, États-Unis d\'Amérique, à l\'exclusion de ses règles de conflit de lois. Tout litige relève de la compétence exclusive des tribunaux de Sheridan County, Wyoming.', 'Les utilisateurs consommateurs résidant dans l\'Union européenne ou en Suisse conservent le bénéfice des dispositions impératives de leur droit national.', `Dernière mise à jour : ${UPDATED}.`] },
  ],
}

export default function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const doc = kind === 'privacy' ? PRIVACY : TERMS
  useEffect(() => {
    const before = document.title
    document.title = `${doc.title} · ProjectLead`
    return () => { document.title = before }
  }, [doc.title])
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <article className="mx-auto max-w-[720px] border border-input bg-card p-6 sm:p-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-extrabold">
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center bg-brand text-[11px] text-white">PL</span>ProjectLead
        </Link>
        <h1 className="mt-6 text-[28px] font-extrabold leading-tight tracking-[-.025em]">{doc.title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.h} className="mt-8">
            <h2 className="text-base font-extrabold">{s.h}</h2>
            {s.p.map((p, i) => Array.isArray(p)
              ? <ul key={i} className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">{p.map((li) => <li key={li}>{li}</li>)}</ul>
              : <p key={i} className="mt-2 text-sm leading-relaxed">{p}</p>)}
          </section>
        ))}
        <p className="mt-10 text-[13px] text-muted-foreground">
          <Link to={kind === 'privacy' ? '/conditions' : '/confidentialite'} className="hover:underline">
            {kind === 'privacy' ? "Conditions d'utilisation" : 'Politique de confidentialité'}</Link>
        </p>
      </article>
    </div>
  )
}
