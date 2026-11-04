// Textes français du site public. Chaque fait vient du code de ProjectLead (server/lib/plans.ts, docs/FONCTIONNALITES.md,
// docs/ASSISTANT-ACTIONS.md) : rien d'inventé, aucun prix de concurrent, aucun tiret long.
const ui = {
  skip: 'Aller au contenu', brandLabel: 'ProjectLead, accueil', navLabel: 'Navigation principale', langLabel: 'Langue',
  nav: { features: 'Fonctions', client: 'Suivi client', pricing: 'Tarifs', guides: 'Guides' },
  login: 'Se connecter', signup: 'Créer mon compte', signupFree: 'Créer mon compte gratuit', seeFeatures: 'Voir les fonctions',
  fine: 'Gratuit pour 3 projets en cours, sans carte bancaire et sans limite de durée.',
  shotCaption: "Capture de l'application. L'entreprise, ses clients et ses projets sont fictifs.",
  crumbs: "Fil d'Ariane", faqMeta: 'Questions', faqTitle: 'Questions fréquentes', moreGuides: 'Les autres guides ProjectLead',
  startMeta: 'Commencer', finalTitle: 'Votre prochain projet commence ici.', backHome: "Retour à l'accueil",
  footGuides: 'Guides', footSuite: 'La suite Lead', footHome: 'Accueil', privacy: 'Confidentialité', terms: "Conditions d'utilisation",
  footPart: 'ProjectLead fait partie des applications Lead.',
  ogAlt: "ProjectLead : le projet vendu, livré à temps. Capture de l'accueil de l'application.",
}

const offers = {
  free: 'Gratuit', freeDesc: '3 projets en cours, 1 personne, toutes les fonctions, sans limite de durée',
  proDesc: 'Projets sans limite, 1 personne, 19 € par mois ou 190 € par an, hors taxes',
  proPlusDesc: "Projets sans limite, jusqu'à 5 personnes, 39 € par mois ou 390 € par an, hors taxes",
}

const plans = {
  title: 'Commencez gratuitement. Passez à Pro quand vos projets se multiplient.',
  free: 'Gratuit', freeBig: '3 projets en cours',
  freeList: ['1 personne', 'Toutes les fonctions', "L'Assistant IA, environ 10 demandes par mois", 'Sans limite de durée'],
  proBig: 'Projets sans limite', proList: ['1 personne', 'Toutes les fonctions', "Pour l'indépendant qui mène plusieurs projets"],
  proPlusBig: 'Projets sans limite', proPlusList: ["Jusqu'à 5 personnes", 'Toutes les fonctions', "Pour l'équipe qui partage le planning"],
  start: 'Commencer',
  foot: "Pro à 19 € par mois ou 190 € par an, Pro+ à 39 € par mois ou 390 € par an, hors taxes. La formule se choisit dans ProjectLead (Réglages, Entreprise) et ne vaut que pour ProjectLead. Les projets terminés, archivés, les modèles et les demandes à qualifier ne comptent pas. Une limite empêche d'ouvrir un projet de plus, elle ne bloque jamais vos données.",
}

const homeFaq = [
  ['ProjectLead est-il vraiment gratuit ?', "Oui. La formule Gratuit donne toutes les fonctions pour 3 projets en cours à la fois et une personne, sans limite de durée et sans carte bancaire. Un projet terminé ou archivé libère sa place."],
  ['ProjectLead convient-il aux indépendants ?', "Oui. Un indépendant y suit ses projets, ses heures et ses rendez-vous seul. La formule Pro ouvre les projets sans limite pour une personne ; Pro+ accueille jusqu'à 5 personnes."],
  ['Faut-il CRMlead ou InvoiceLead pour utiliser ProjectLead ?', "Non. ProjectLead fonctionne seul. Relié à CRMlead, il reçoit les affaires gagnées ; relié à InvoiceLead, il prépare les brouillons de facture. La liaison se fait sans clé, par le même compte."],
  ["Que fait l'Assistant IA ?", "Il répond à vos questions sur vos projets, ouvre le bon écran et prépare des changements, par exemple le plan complet d'un projet avec ses étapes, tâches, jalons et dépendances. Tout s'affiche sur une carte « À confirmer » : un clic sur « Confirmer » l'applique, avec vos droits."],
  ['Comment se connecte-t-on ?', "Avec votre compte ERPlead, le compte commun des applications Lead. Si vous n'en avez pas, il se crée au premier passage, sans carte bancaire."],
  ['Mes clients doivent-ils créer un compte ?', 'Non. Ils suivent leur projet par un lien personnel et prennent rendez-vous sur une page publique.'],
  ['Quelles messageries puis-je brancher ?', 'Gmail, Microsoft 365 et toute messagerie IMAP : Infomaniak, Hostpoint, OVH, iCloud et les autres.'],
  ["Dans quelles langues l'application existe-t-elle ?", "En français, allemand, anglais, italien et espagnol. Chaque personne choisit sa langue, et chaque projet peut avoir la langue de ses documents client."],
]

const img = (name, alt, extra = '') => `<picture class="step-img"${extra}>
            <source type="image/avif" srcset="/media/accueil/${name}-800.avif 800w, /media/accueil/${name}-1600.avif 1600w" sizes="(max-width: 600px) 180vw, calc(100vw - 32px)">
            <img src="/media/accueil/${name}-800.webp" srcset="/media/accueil/${name}-800.webp 800w, /media/accueil/${name}-1600.webp 1600w" sizes="(max-width: 600px) 180vw, calc(100vw - 32px)" width="1440" height="900" alt="${alt}" loading="lazy" decoding="async">
          </picture>`
const tourShot = (n, on = false) => `<picture class="shot${on ? ' is-on' : ''}" data-shot="${n}"><source type="image/avif" srcset="/media/accueil/${n}-800.avif 800w, /media/accueil/${n}-1600.avif 1600w" sizes="(min-width: 1212px) 680px, 56vw"><img src="/media/accueil/${n}-800.webp" srcset="/media/accueil/${n}-800.webp 800w, /media/accueil/${n}-1600.webp 1600w" sizes="(min-width: 1212px) 680px, 56vw" width="1440" height="900" alt="" loading="lazy" decoding="async"></picture>`
export const tourView = (dots, url) => `<div class="tour-view" aria-hidden="true">
        <div class="tour-sticky">
          <div class="frame">
            <div class="frame-bar"><span class="sq sq-s">PL</span><span class="url" id="tour-url">${url}</span><span class="bar-fill"></span></div>
            <div class="tour-shots"><div class="tour-zoom" id="tour-zoom">
              ${['projet', 'gantt', 'tableau', 'temps', 'emails', 'charge', 'facturation'].map((n, i) => tourShot(n, i === 0)).join('\n              ')}
              <span class="hl" id="tour-hl"></span>
            </div></div>
          </div>
          <div class="tour-dots">
            ${dots.map(([k, v], i) => `<span data-dot="${k}"${i === 0 ? ' class="is-on"' : ''}>${v}</span>`).join('')}
          </div>
        </div>
      </div>`
export { img }

const home = {
  title: 'ProjectLead, logiciel de gestion de projet pour PME et indépendants',
  description: "Gestion de projet en ligne : étapes, Gantt, tâches, temps, suivi client et facturation avec InvoiceLead. Gratuit pour 3 projets en cours, sans carte bancaire.",
  faq: homeFaq,
  body: ({ signup, plans, faq, guides }) => `
  <section class="wrap hero" aria-labelledby="titre">
    <p class="meta" data-reveal>Logiciel de gestion de projet pour PME et indépendants</p>
    <h1 id="titre" data-reveal style="--d:1">Le projet vendu, livré à temps. <span>Sans heures perdues.</span></h1>
    <div class="hero-row">
    <p class="lede" data-reveal style="--d:2">ProjectLead prend le relais quand l'affaire est signée. Étapes, planning, tâches, temps, e-mails et rendez-vous au même endroit. Votre client suit l'avancement sur sa page, et les heures du mois partent dans InvoiceLead pour la facture.</p>
    <div class="hero-act" data-reveal style="--d:3">
    <div class="ctas">
      <a class="btn btn-fill btn-lg" href="${signup}" rel="nofollow">Créer mon compte gratuit</a>
      <a class="btn btn-line btn-lg" href="#film"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>Voir le film</a>
    </div>
    <p class="fine">Gratuit pour 3 projets en cours, sans carte bancaire. Connexion avec votre compte ERPlead, commun aux applications Lead.</p>
    </div>
    </div>

    <figure class="stage" aria-label="L'accueil de ProjectLead, avec une entreprise fictive">
      <div class="frame frame-hero">
        <div class="frame-bar" aria-hidden="true"><span class="sq sq-s">PL</span><span class="url">projectlead.io</span><span class="bar-fill"></span></div>
        <picture>
          <source media="(max-width: 600px)" type="image/avif" srcset="/media/accueil/accueil-tel-860.avif">
          <source media="(max-width: 600px)" type="image/webp" srcset="/media/accueil/accueil-tel-860.webp">
          <source type="image/avif" srcset="/media/accueil/accueil-1280.avif 1280w, /media/accueil/accueil-2400.avif 2400w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)">
          <img src="/media/accueil/accueil-1280.webp" srcset="/media/accueil/accueil-1280.webp 1280w, /media/accueil/accueil-2400.webp 2400w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)" width="1440" height="900" alt="Accueil de ProjectLead : tâches du jour, projets suivis avec leur avancement, semaine de temps et rendez-vous." fetchpriority="high" decoding="async">
        </picture>
      </div>
      <div class="chip chip-crm" aria-hidden="true">
        <span class="sq" style="background:var(--cl)">CL</span>
        <span><b>Affaire gagnée dans CRMlead</b>PPE Les Tilleuls, CHF <span data-count="186400">186 400</span></span>
      </div>
      <div class="chip chip-stage" aria-hidden="true">
        <span class="tag tag-ok">Terminée</span>
        <span><b>Échafaudages et protections</b>Le client est prévenu par e-mail</span>
      </div>
      <div class="chip chip-timer" aria-hidden="true">
        <span class="dot"></span>
        <span><b>Isolation façade nord</b><span class="mono" data-timer="2832">0:47:12</span></span>
      </div>
      <div class="chip chip-il" aria-hidden="true">
        <span class="sq" style="background:var(--il)">IL</span>
        <span><b>Brouillon InvoiceLead</b>Septembre, CHF <span data-count="41000">41 000</span></span>
      </div>
      <figcaption class="cap">Captures de l'application. L'entreprise, ses clients et ses projets sont fictifs.</figcaption>
    </figure>
  </section>

  <section class="wrap" aria-label="ProjectLead en chiffres">
    <div class="stats">
      <div class="stat" data-reveal><b data-count="4">4</b><span>vues des mêmes tâches : tableau, liste, Gantt, calendrier</span></div>
      <div class="stat" data-reveal style="--d:1"><b data-count="4">4</b><span>façons de facturer : à l'heure, au mois, par étape, au forfait</span></div>
      <div class="stat" data-reveal style="--d:2"><b data-count="3">3</b><span>projets en cours offerts, sans limite de durée</span></div>
      <div class="stat" data-reveal style="--d:3"><b data-count="5">5</b><span>langues : français, allemand, anglais, italien, espagnol</span></div>
    </div>
  </section>

  <section id="film" class="wrap sec" aria-labelledby="film-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Le film</p>
      <h2 id="film-titre">ProjectLead en quarante secondes.</h2>
      <p>Une affaire signée, un projet mené jusqu'à la facture. Toutes les images viennent de l'application.</p>
    </div>
    <div class="film" data-reveal>
      <div class="film-box">
        <video id="film-video" muted loop playsinline preload="none" poster="/media/film/projectlead-film-affiche.jpg" aria-describedby="film-texte-titre">
          <source src="/media/film/projectlead-film-720.mp4" type="video/mp4">
        </video>
        <button type="button" class="film-play" id="film-play" aria-label="Lire le film avec le son">
          <span class="film-play-sq" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg></span>
          <span class="film-play-txt">Lire le film</span>
        </button>
      </div>
      <div class="film-bar">
        <button type="button" class="fbtn" id="film-toggle" aria-pressed="false" disabled>Pause</button>
        <button type="button" class="fbtn" id="film-sound" aria-pressed="false">Activer le son</button>
        <span class="film-progress" aria-hidden="true"><span id="film-progress"></span></span>
        <span class="film-dur">42 s, musique originale</span>
      </div>
      <details class="film-texte">
        <summary id="film-texte-titre">Le texte du film</summary>
        <ul class="plain">
          <li>Gestion de projet pour les PME. L'affaire est signée.</li>
          <li>ProjectLead prend le relais : l'affaire gagnée dans CRMlead, CHF 186 400, devient un projet de 6 étapes, 13 tâches et 5 intervenants.</li>
          <li>Chaque étape a sa date.</li>
          <li>Le planning tient sur un écran.</li>
          <li>Toute l'équipe sur les mêmes tâches.</li>
          <li>Chaque heure trouve son projet.</li>
          <li>Un e-mail devient un projet.</li>
          <li>Le client suit, sans compte : lien personnel, envoi automatique, message à l'équipe.</li>
          <li>Les heures partent à la facture : les brouillons de septembre arrivent dans InvoiceLead.</li>
          <li>ProjectLead. Le projet vendu, livré à temps. projectlead.io, gratuit pour 3 projets en cours.</li>
        </ul>
      </details>
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="relais-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Le relais</p>
      <h2 id="relais-titre">L'affaire signée devient un projet. Le projet devient une facture.</h2>
      <p>ProjectLead se place entre la vente et la facturation. Il reçoit l'affaire gagnée dans CRMlead et prépare la facture dans InvoiceLead.</p>
    </div>
    <div class="chain" data-reveal>
      <div class="link" style="--c:var(--cl);--i:0">
        <div class="who"><span class="sq" style="background:var(--cl)">CL</span>CRMlead</div>
        <div class="verb">Gagner</div>
        <div class="doc"><b>PPE Les Tilleuls</b>Affaire signée, CHF 186 400</div>
      </div>
      <div class="link link-pl" style="--c:var(--accent);--i:1">
        <div class="who"><span class="sq sq-pl">PL</span>ProjectLead</div>
        <div class="verb">Mener</div>
        <div class="doc"><b>Rénovation énergétique</b>6 étapes, 13 tâches, 5 intervenants</div>
      </div>
      <div class="link" style="--c:var(--il);--i:2">
        <div class="who"><span class="sq" style="background:var(--il)">IL</span>InvoiceLead</div>
        <div class="verb">Facturer</div>
        <div class="doc"><b>Brouillon de septembre</b>2 étapes livrées, CHF 41 000</div>
      </div>
    </div>
    <p class="chain-foot">Exemple fictif. ProjectLead fonctionne aussi seul, sans CRMlead ni InvoiceLead.</p>
  </section>

  <section id="fonctions" class="wrap sec" aria-labelledby="fonctions-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Les fonctions</p>
      <h2 id="fonctions-titre">Tout le projet, de la première tâche à la dernière heure.</h2>
      <p>Ce que font bien les grands logiciels de gestion de projet, pensé pour une PME ou un indépendant : simple à prendre en main, complet quand le projet grandit.</p>
    </div>
    <div class="tour">
      <div class="tour-steps">
        <article class="step" data-step="projet" data-hl="17.3,44.1,55.4,20" id="vue-ensemble">
          <p class="meta">Vue d'ensemble</p>
          <h3>Chaque projet a ses étapes, ses intervenants et son budget.</h3>
          <p>L'avancement se lit d'un coup d'œil : tâches faites, temps passé face au budget, étape en cours. Chaque intervenant a son rôle et son taux sur le projet.</p>
          <ul class="dash"><li>Points d'avancement : dans les temps, à surveiller, en retard</li><li>Budget en heures et en montant</li><li>Modèles pour ouvrir un projet en un clic</li></ul>
          ${img('projet', "Vue d'ensemble d'un projet de rénovation : tâches, temps passé, montant par étape, étapes datées et intervenants.", ' style="--cx:45;--cy:54.1;--s:1.6"')}
        </article>
        <article class="step" data-step="gantt" data-hl="58.2,82.4,33.2,13">
          <p class="meta">Gantt</p>
          <h3>Le planning tient sur un écran.</h3>
          <p>Étapes, tâches, jalons et dépendances sur la même ligne de temps. On replanifie en glissant une barre, et la ligne du jour reste en vue. <a href="/fr/diagramme-de-gantt-en-ligne-gratuit">Le diagramme de Gantt en détail</a>.</p>
          <ul class="dash"><li>Échelles jour, semaine et mois</li><li>Tâches bloquées par une autre signalées</li><li>Jalons pour les dates qui comptent</li></ul>
          ${img('gantt', "Diagramme de Gantt du projet : étapes, tâches terminées en vert, tâches en cours en ocre, dépendances et ligne du jour.", ' style="--cx:74.8;--cy:88.9;--s:1.9"')}
        </article>
        <article class="step" data-step="tableau" data-hl="37.1,42.5,18.5,10.7">
          <p class="meta">Tableau</p>
          <h3>Toute l'équipe sur les mêmes tâches.</h3>
          <p>Tableau, liste, Gantt ou calendrier : quatre vues des mêmes tâches. Chacun voit ce qu'il a à faire, avec ses échéances et ses priorités.</p>
          <ul class="dash"><li>Sous-tâches, listes de contrôle, commentaires avec @mentions</li><li>Couloirs par étape ou par personne</li><li>Tâches récurrentes et fichiers joints</li></ul>
          ${img('tableau', "Tableau kanban du projet : colonnes À faire, En cours, En revue et Terminé, cartes avec échéances, priorités et personnes assignées.", ' style="--cx:46.4;--cy:47.9;--s:2.2"')}
        </article>
        <article class="step" data-step="temps" data-hl="17.3,29.4,81,47.3">
          <p class="meta">Temps</p>
          <h3>Chaque heure trouve son projet.</h3>
          <p>Le chronomètre tourne pendant que vous travaillez, la feuille de la semaine se remplit. Les heures facturables se comptent par projet, par tâche et par personne. <a href="/fr/logiciel-feuille-de-temps-et-facturation">Feuille de temps et facturation</a>.</p>
          <ul class="dash"><li>Chronomètre et feuille de temps de la semaine</li><li>Rapports de temps et de rentabilité</li><li>Export CSV pour la fiduciaire</li></ul>
          ${img('temps', "Feuille de temps de la semaine : heures par projet et par tâche, total du jour face à la capacité.", ' style="--cx:57.8;--cy:53;--s:1.5"')}
        </article>
        <article class="step" data-step="emails" data-hl="44.8,17.5,53.6,38">
          <p class="meta">E-mails</p>
          <h3>Une demande reçue devient un projet.</h3>
          <p>Branchez Gmail, Microsoft 365 ou votre messagerie. L'e-mail d'un client connu rejoint son projet tout seul. Une nouvelle demande devient un projet en un clic, avec le client créé et la première tâche prête.</p>
          <ul class="dash"><li>Infomaniak, Hostpoint, OVH, iCloud et toute messagerie IMAP</li><li>Rattacher à un projet, en faire une tâche ou répondre</li><li>Une boîte partagée pour toute l'équipe</li></ul>
          ${img('emails', "Boîte de réception : une demande d'offre ouverte, avec les boutons Créer un projet, Rattacher à un projet, Répondre et Écarter.", ' style="--cx:71.6;--cy:36.5;--s:1.6"')}
        </article>
        <article class="step" data-step="charge" data-hl="17.3,17.4,81,42.4">
          <p class="meta">Charge de travail</p>
          <h3>Vous voyez qui est débordé avant qu'il le soit.</h3>
          <p>La charge de chaque personne, semaine par semaine, face à sa capacité. Vous répartissez le travail avant que le planning ne glisse.</p>
          <ul class="dash"><li>Capacité hebdomadaire par personne</li><li>Équipes, rôles et taux horaires</li></ul>
          ${img('charge', "Charge de travail de l'équipe par semaine, en heures et en pourcentage de la capacité, du vert au rouge.", ' style="--cx:57.8;--cy:38.6;--s:1.5"')}
        </article>
        <article class="step" data-step="facturation" data-hl="17.2,62.4,81.1,17.9">
          <p class="meta">Facturation</p>
          <h3>Les heures partent dans InvoiceLead.</h3>
          <p>Chaque mois, ProjectLead prépare un brouillon de facture par projet : à l'heure, au forfait mensuel, par étape livrée ou au forfait global. Vous relisez et vous émettez la facture depuis InvoiceLead.</p>
          <ul class="dash"><li>Le temps facturé ne se modifie plus</li><li>Jamais deux brouillons pour le même mois</li></ul>
          ${img('facturation', "Facturation du mois : un aperçu par projet, lignes d'heures et d'étapes, bouton Créer les brouillons dans InvoiceLead.", ' style="--cx:57.75;--cy:71.35;--s:1.5"')}
        </article>
      </div>
      ${tourView([['projet', "Vue d'ensemble"], ['gantt', 'Gantt'], ['tableau', 'Tableau'], ['temps', 'Temps'], ['emails', 'E-mails'], ['charge', 'Charge'], ['facturation', 'Facturation']], 'projectlead.io/projets')}
    </div>
  </section>

  <section id="client" class="wrap sec" aria-labelledby="client-titre">
    <div class="client">
      <div class="client-text">
        <div class="sec-head" data-reveal>
          <p class="meta">Suivi client</p>
          <h2 id="client-titre">Votre client suit son projet, sans créer de compte.</h2>
        </div>
        <div class="points">
          <div class="point" data-reveal><h3>Une page de suivi par projet</h3><p>Avancement, étapes, derniers points partagés et fichiers. Le client y écrit à l'équipe. Vous choisissez ce qu'il voit.</p></div>
          <div class="point" data-reveal style="--d:1"><h3>Le suivi part tout seul</h3><p>Chaque semaine, chaque quinzaine ou chaque mois, ou à chaque étape terminée : le client reçoit un e-mail clair, sans que vous ayez à l'écrire.</p></div>
          <div class="point" data-reveal style="--d:2"><h3>Il prend rendez-vous en ligne</h3><p>Pages de rendez-vous publiques, hôtes à tour de rôle, créneaux bloqués par vos agendas extérieurs. Un rendez-vous peut ouvrir un projet.</p></div>
        </div>
      </div>
      <div class="phones" data-reveal>
        <figure class="phone phone-scroll">
          <div class="phone-screen"><div class="phone-track">
            <picture><source type="image/avif" srcset="/media/accueil/portail-640.avif"><img src="/media/accueil/portail-640.webp" width="640" height="3628" alt="Page de suivi vue par le client sur son téléphone : avancement de 33 %, étapes terminées et en cours, notes de l'équipe." loading="lazy" decoding="async"></picture>
          </div></div>
          <figcaption>Page de suivi</figcaption>
        </figure>
        <figure class="phone phone-b">
          <div class="phone-screen">
            <picture><source type="image/avif" srcset="/media/accueil/rdv-640.avif"><img src="/media/accueil/rdv-640.webp" width="640" height="1388" alt="Page de prise de rendez-vous : visite technique gratuite d'une heure, choix du jour et des horaires libres." loading="lazy" decoding="async"></picture>
          </div>
          <figcaption>Prise de rendez-vous</figcaption>
        </figure>
      </div>
    </div>
  </section>

  <section id="assistant" class="wrap sec" aria-labelledby="ia-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Assistant IA</p>
      <h2 id="ia-titre">Un assistant qui prépare le travail. Vous confirmez d'un clic.</h2>
      <p>L'Assistant IA intégré à ProjectLead connaît vos projets. Il répond, ouvre le bon écran et prépare les changements ; rien n'est écrit tant que vous n'avez pas cliqué sur « Confirmer ».</p>
    </div>
    <div class="more" data-reveal>
      <div class="more-item"><h3>Il répond</h3><p>Où en est un projet, quelles tâches sont en retard, combien d'heures ce mois : il lit vos données, avec vos droits.</p></div>
      <div class="more-item"><h3>Il prépare un plan</h3><p>Le plan complet d'un projet : étapes, tâches, jalons, dépendances et dates, montré en entier sur une seule carte.</p></div>
      <div class="more-item"><h3>Il applique en un clic</h3><p>Une carte « À confirmer » montre chaque changement. « Confirmer » l'applique, par les mêmes contrôles que l'écran.</p></div>
      <div class="more-item"><h3>Rien ne part sans vous</h3><p>L'assistant n'envoie aucun e-mail à vos clients. Il est inclus dans chaque formule, Gratuit compris.</p></div>
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="suite-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Avec les applications Lead</p>
      <h2 id="suite-titre">Un seul compte. Les informations passent d'une application à l'autre.</h2>
    </div>
    <div class="flows" data-reveal>
      <div class="flow">
        <span class="who"><span class="sq" style="background:var(--cl)">CL</span>CRMlead</span><span class="arrow" aria-hidden="true"></span>
        <span class="who"><span class="sq sq-pl">PL</span>ProjectLead</span>
        <p>Une affaire gagnée arrive en projet, avec le client, son adresse et ses contacts.</p>
      </div>
      <div class="flow">
        <span class="who"><span class="sq sq-pl">PL</span>ProjectLead</span><span class="arrow" aria-hidden="true"></span>
        <span class="who"><span class="sq" style="background:var(--il)">IL</span>InvoiceLead</span>
        <p>Chaque mois, les heures et les étapes livrées deviennent un brouillon de facture.</p>
      </div>
      <div class="flow">
        <span class="who"><span class="sq sq-el">EL</span>ERPlead</span><span class="arrow" aria-hidden="true"></span>
        <span class="who apps"><span class="sq" style="background:var(--sl)">SL</span><span class="sq" style="background:var(--cl)">CL</span><span class="sq sq-pl">PL</span><span class="sq" style="background:var(--il)">IL</span></span>
        <p>Le même compte ouvre toutes les applications Lead. Pas de nouveau mot de passe, aucune clé à coller pour les relier.</p>
      </div>
    </div>
    <div class="more" data-reveal>
      <div class="more-item"><h3>Modèles de projet</h3><p>Étapes, tâches et listes de contrôle réutilisées, dates recalées sur le début du projet.</p></div>
      <div class="more-item"><h3>Automatisations</h3><p>Quand une tâche est terminée, l'étape suit. Les règles « quand… alors… » font le reste.</p></div>
      <div class="more-item"><h3>Formulaires de demande</h3><p>Un formulaire public qui ouvre un projet à qualifier dès qu'un client le remplit.</p></div>
      <div class="more-item"><h3>Agendas</h3><p>Vos rendez-vous dans Google Agenda, Outlook ou Apple, invitations envoyées avec le fichier .ics.</p></div>
      <div class="more-item"><h3>Rapports</h3><p>Heures, montants facturables, coûts et marge par projet, client ou personne.</p></div>
      <div class="more-item"><h3>API REST</h3><p>Vos projets, tâches et heures accessibles à vos autres outils, par clé d'API.</p></div>
      <div class="more-item"><h3>Équipe</h3><p>Rôles, équipes, taux et capacités. Un projet peut être réservé à ses intervenants.</p></div>
      <div class="more-item"><h3>Cinq langues</h3><p>Français, allemand, anglais, italien et espagnol, et la langue des documents choisie par projet.</p></div>
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="change-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Ce qui change</p>
      <h2 id="change-titre">Moins de tableurs. Moins d'heures oubliées.</h2>
    </div>
    <div class="tablebox" data-reveal tabindex="0" role="region" aria-label="Comparaison sans et avec ProjectLead">
      <table>
        <thead><tr><th scope="col">Moment</th><th scope="col">Sans ProjectLead</th><th scope="col">Avec ProjectLead</th></tr></thead>
        <tbody>
          <tr><th scope="row">Au démarrage</th><td>L'affaire signée reste dans la boîte mail du vendeur.</td><td class="with">Le projet s'ouvre avec le client, ses contacts et un modèle d'étapes.</td></tr>
          <tr><th scope="row">Au planning</th><td>Un tableur que personne ne tient à jour.</td><td class="with">Un Gantt partagé, replanifié à la souris.</td></tr>
          <tr><th scope="row">Sur le terrain</th><td>Les heures notées dans un carnet, oubliées à la facture.</td><td class="with">Le chronomètre et la feuille de la semaine, projet par projet.</td></tr>
          <tr><th scope="row">Avec le client</th><td>Des appels pour savoir où en est le projet.</td><td class="with">Une page de suivi et un e-mail qui part chaque semaine.</td></tr>
          <tr><th scope="row">En fin de mois</th><td>Les heures recomptées à la main.</td><td class="with">Un brouillon par projet dans InvoiceLead, prêt à relire.</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="tarifs" class="wrap sec" aria-labelledby="tarifs-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Tarifs</p>
      <h2 id="tarifs-titre">${plansTitle}</h2>
      <p>Toutes les fonctions sont dans chaque formule. Seules changent les quantités.</p>
    </div>
    ${plans}
  </section>

  <section id="guides" class="wrap sec" aria-labelledby="guides-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Guides</p>
      <h2 id="guides-titre">Trouver le bon outil pour vos projets.</h2>
      <p>Logiciel gratuit, PME, indépendants, Gantt, feuille de temps ou alternative à un outil connu : ce que ProjectLead fait pour chacun.</p>
    </div>
    ${guides}
  </section>

  <section id="questions" class="wrap sec" aria-labelledby="questions-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Questions</p>
      <h2 id="questions-titre">Ce qu'on nous demande le plus.</h2>
    </div>
    <div class="faq" data-reveal>
      ${faq}
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="final-titre">
    <div class="final" data-reveal>
      <div>
        <p class="meta">Commencer</p>
        <h2 id="final-titre">Votre prochain projet commence ici.</h2>
        <div class="ctas">
          <a class="btn btn-fill btn-lg" href="${signup}" rel="nofollow">Créer mon compte gratuit</a>
          <a class="btn btn-line btn-lg" href="/login" rel="nofollow">Se connecter</a>
        </div>
        <p class="fine">Gratuit pour 3 projets en cours, sans carte bancaire.</p>
      </div>
      <div class="final-art" aria-hidden="true">
        <div class="gantt-art"><span style="--x:0;--w:34;--r:0"></span><span style="--x:22;--w:30;--r:1"></span><span style="--x:44;--w:36;--r:2"></span><span style="--x:62;--w:26;--r:3"></span><span style="--x:78;--w:22;--r:4"></span></div>
      </div>
    </div>
  </section>`,
}
const plansTitle = plans.title

/* ------------------------------------------------------------ pages mots-clés */
const IA = "L'Assistant IA intégré prépare le travail à votre place : il peut proposer le plan complet d'un projet (étapes, tâches, jalons, dépendances et dates) ou un lot de changements, affiché en entier sur une carte « À confirmer ». Un clic sur « Confirmer » l'applique avec vos droits ; l'assistant n'envoie jamais d'e-mail à vos clients."

const pages = {
  free: {
    nav: 'Logiciel de gestion de projet gratuit', kicker: 'Gratuit', teaser: 'Toutes les fonctions pour 3 projets en cours, sans limite de durée.',
    keyword: 'logiciel gestion de projet gratuit',
    title: 'Logiciel gestion de projet gratuit pour PME | ProjectLead',
    description: "ProjectLead, logiciel gestion de projet gratuit : Gantt, tâches, temps et suivi client pour 3 projets en cours, sans carte bancaire ni limite de durée.",
    h1: 'Logiciel gestion de projet gratuit, sans fonction bridée',
    lede: "ProjectLead donne toutes ses fonctions dans la formule Gratuit : étapes, diagramme de Gantt, tâches, suivi du temps, e-mails, rendez-vous et page de suivi pour vos clients. La seule limite est le nombre de projets en cours : trois à la fois.",
    shot: 'projet', shotAlt: "Vue d'ensemble d'un projet dans ProjectLead : tâches, temps passé, montant par étape et intervenants.",
    sections: [
      { h2: 'Ce que comprend la formule Gratuit', p: [
        "Beaucoup d'outils gratuits enlèvent les fonctions qui comptent : le Gantt, le suivi du temps ou le portail client. ProjectLead fait l'inverse. La formule Gratuit contient exactement les mêmes écrans que les formules payantes ; seules changent les quantités.",
        "Vous menez trois projets en cours à la fois, seul. Un projet terminé, abandonné ou archivé ne compte plus et libère sa place. Les modèles de projet et les demandes à qualifier ne comptent pas non plus. Il n'y a ni période d'essai qui expire, ni carte bancaire à donner.",
      ], list: ['Étapes datées, jalons et dépendances', 'Quatre vues des tâches : tableau, liste, Gantt, calendrier', 'Chronomètre, feuille de temps et rapports', 'Gmail, Microsoft 365 et messagerie IMAP', 'Page de suivi client et pages de rendez-vous', "L'Assistant IA, environ 10 demandes par mois"] },
      { h2: 'Un vrai logiciel, pas un tableur partagé', shot: 'gantt', alt: 'Diagramme de Gantt de ProjectLead avec étapes, tâches, dépendances et ligne du jour.', p: [
        "Un tableur gratuit dépanne pour lister des tâches, mais il ne prévient personne quand une échéance glisse. Dans ProjectLead, chaque projet a ses étapes et son budget en heures et en montant ; l'avancement se lit d'un coup d'œil : dans les temps, à surveiller ou en retard.",
        `Le <a href="/fr/diagramme-de-gantt-en-ligne-gratuit">diagramme de Gantt en ligne</a> se replanifie en glissant une barre. Les tâches ont des sous-tâches, des listes de contrôle, des commentaires avec @mentions, des fichiers et des priorités. Les tâches récurrentes reviennent seules chaque jour, semaine ou mois.`,
      ] },
      { h2: 'Le temps et la facture, même en gratuit', p: [
        `Le chronomètre tourne pendant que vous travaillez et la feuille de la semaine se remplit. Les heures facturables se comptent par projet, par tâche et par personne ; un export CSV part chez la fiduciaire. Pour aller plus loin, voyez la page <a href="/fr/logiciel-feuille-de-temps-et-facturation">feuille de temps et facturation</a>.`,
        "Si votre entreprise utilise aussi InvoiceLead avec le même compte, ProjectLead prépare chaque mois un brouillon de facture par projet. La liaison ne demande aucune clé et ne coûte rien de plus, dans toutes les formules.",
      ] },
      { h2: 'Un assistant IA qui applique ses propositions', p: [IA, "En formule Gratuit, l'assistant est disponible pour l'équivalent d'environ dix demandes par mois et par entreprise."] },
      { h2: 'Quand passer à une formule payante', p: [
        `Tant que trois projets en cours vous suffisent, vous restez en Gratuit aussi longtemps que vous voulez. Quand vos projets se multiplient, Pro ouvre les projets sans limite pour une personne, idéal pour un <a href="/fr/gestion-de-projet-freelance">indépendant ou freelance</a>. Pro+ accueille jusqu'à cinq personnes qui partagent le planning, comme dans une <a href="/fr/outil-gestion-de-projet-pme">petite PME</a>.`,
        "Une limite n'efface et ne bloque jamais vos données : elle empêche seulement d'ouvrir un projet de plus. Vous pouvez donc commencer gratuitement sans risque pour la suite.",
      ] },
    ],
    faq: [
      ['Le logiciel est-il gratuit pour toujours ?', "La formule Gratuit n'a pas de limite de durée : elle reste gratuite tant que vous menez au plus trois projets en cours et travaillez seul."],
      ['Faut-il une carte bancaire ?', "Non. Le compte ERPlead qui ouvre ProjectLead se crée sans carte bancaire."],
      ['Quelles fonctions manquent en gratuit ?', "Aucune. Toutes les fonctions sont dans chaque formule ; seuls le nombre de projets en cours, le nombre de personnes et le volume de l'Assistant IA changent."],
      ['Que se passe-t-il avec un quatrième projet ?', "ProjectLead vous propose de terminer ou d'archiver un projet, ou de passer à Pro. Vos projets existants restent visibles et modifiables."],
    ],
  },
  smb: {
    nav: 'Outil de gestion de projet pour PME', kicker: 'PME', teaser: 'Planning, équipe, temps et clients pour une entreprise de 2 à 5 personnes.',
    keyword: 'outil gestion de projet pme',
    title: 'Outil gestion de projet PME : planning, temps, clients | ProjectLead',
    description: "Outil gestion de projet PME : étapes, Gantt, charge de l'équipe, heures facturables et suivi client dans un seul logiciel. Gratuit pour 3 projets en cours.",
    h1: "L'outil gestion de projet PME qui va de l'affaire signée à la facture",
    lede: "Une PME n'a pas de bureau des méthodes. Elle a besoin d'un outil qui s'apprend en une heure, que toute l'équipe utilise vraiment, et qui suit le projet de l'affaire signée jusqu'à la facture. C'est ce que fait ProjectLead.",
    shot: 'tableau', shotAlt: 'Tableau kanban de ProjectLead : colonnes À faire, En cours, En revue et Terminé, avec échéances et personnes assignées.',
    sections: [
      { h2: "Ce qu'une PME attend d'un outil de gestion de projet", p: [
        "Dans une petite entreprise, la même personne vend, planifie, travaille sur le projet et facture. Les informations sont dispersées entre la boîte mail, un tableur et un carnet d'heures. ProjectLead les réunit : le projet, ses étapes, ses tâches, ses heures, ses e-mails et ses rendez-vous au même endroit.",
        "Rien n'est à paramétrer avant de commencer : un projet s'ouvre depuis un modèle, avec ses étapes et ses tâches déjà prêtes, et les dates se recalent sur la date de début.",
      ], list: ['Projets avec étapes, budget et intervenants', 'Rôles : administrateur, responsable, membre', 'Équipes, taux horaires et capacités', 'Projets réservés à leurs intervenants'] },
      { h2: "La charge de l'équipe, semaine par semaine", shot: 'charge', alt: "Charge de travail de l'équipe par semaine face à la capacité de chacun.", p: [
        "La vue Charge montre les heures prévues de chaque personne, semaine par semaine, face à sa capacité. Vous voyez qui est débordé avant qu'il le soit et vous répartissez le travail avant que le planning ne glisse.",
        `Le <a href="/fr/diagramme-de-gantt-en-ligne-gratuit">diagramme de Gantt</a> partagé montre étapes, tâches, jalons et dépendances sur la même ligne de temps. Chacun voit ses tâches dans « Mes tâches », avec ses échéances et ses priorités.`,
      ] },
      { h2: 'Le client informé sans appels', p: [
        "Chaque projet peut avoir sa page de suivi publique, ouverte par un lien personnel : le client y voit l'avancement, les étapes, les notes partagées et les fichiers, et il peut écrire à l'équipe. Vous choisissez ce qui est visible.",
        "Le suivi peut partir tout seul par e-mail, chaque semaine, chaque quinzaine, chaque mois ou à chaque étape terminée. Les pages de rendez-vous publiques permettent au client de réserver un créneau ; plusieurs hôtes peuvent se partager les rendez-vous à tour de rôle.",
      ] },
      { h2: 'Les heures et la facturation', p: [
        `Le temps se saisit au chronomètre ou dans la feuille de la semaine. Les rapports donnent heures, montants facturables, coûts et marge par projet, client ou personne. Le détail est sur la page <a href="/fr/logiciel-feuille-de-temps-et-facturation">feuille de temps et facturation</a>.`,
        "Avec InvoiceLead, chaque mois produit un brouillon de facture par projet : à l'heure, au forfait mensuel, par étape livrée ou au forfait global. Le temps facturé ne se modifie plus, et jamais deux brouillons ne sont créés pour le même mois.",
      ] },
      { h2: "L'Assistant IA pour gagner du temps", p: [IA, "Pour une PME, c'est le plan d'un nouveau chantier ou d'une nouvelle mission prêt en quelques secondes, à relire avant de confirmer."] },
      { h2: 'Combien coûte ProjectLead pour une PME', p: [
        "Pour commencer, la formule Gratuit suffit : trois projets en cours, une personne, toutes les fonctions. Pro+ accueille jusqu'à cinq personnes avec des projets sans limite, pour 39 € par mois ou 390 € par an hors taxes. La formule se prend dans ProjectLead et ne vaut que pour ProjectLead.",
      ] },
    ],
    faq: [
      ['Combien de personnes peuvent utiliser ProjectLead ?', "Une personne en Gratuit et en Pro, jusqu'à cinq en Pro+."],
      ["L'outil est-il traduit ?", "Oui : français, allemand, anglais, italien et espagnol. Chaque personne choisit sa langue."],
      ['Peut-on brancher la messagerie de l\'entreprise ?', "Oui : Gmail, Microsoft 365 et toute messagerie IMAP (Infomaniak, Hostpoint, OVH, iCloud…). Une boîte peut être partagée avec l'équipe."],
      ['Nos clients doivent-ils installer quelque chose ?', 'Non. Ils ouvrent leur page de suivi ou de rendez-vous dans le navigateur, sans compte.'],
    ],
  },
  gantt: {
    nav: 'Diagramme de Gantt en ligne gratuit', kicker: 'Gantt', teaser: 'Étapes, jalons et dépendances, replanifiés en glissant une barre.',
    keyword: 'diagramme de gantt en ligne gratuit',
    title: 'Diagramme de Gantt en ligne gratuit | ProjectLead',
    description: "Diagramme de Gantt en ligne gratuit : étapes, tâches, jalons et dépendances, replanifiés à la souris et partagés avec l'équipe. Sans téléchargement ni carte.",
    h1: 'Diagramme de Gantt en ligne gratuit, relié à vos tâches',
    lede: "Dans ProjectLead, le diagramme de Gantt n'est pas un dessin à part : c'est une vue des vraies tâches du projet. Ce que vous glissez sur la ligne de temps change les dates des tâches, et toute l'équipe le voit tout de suite.",
    shot: 'gantt', shotAlt: 'Diagramme de Gantt dans ProjectLead : étapes, tâches terminées en vert, tâches en cours en ocre et ligne du jour.',
    sections: [
      { h2: 'Un Gantt dans le navigateur, sans installation', p: [
        "ProjectLead fonctionne dans le navigateur, sur ordinateur comme sur tablette. Il n'y a rien à télécharger : vous ouvrez votre compte, vous créez un projet, et le Gantt est là. La formule Gratuit le donne pour trois projets en cours, sans limite de durée.",
        "Le diagramme montre les étapes du projet, leurs tâches et les jalons sur la même ligne de temps. L'échelle se règle au jour, à la semaine ou au mois, et la ligne du jour reste en vue.",
      ], list: ['Glisser une barre décale ses dates', 'Tirer le bord droit change l\'échéance', 'Un clic ouvre la tâche', 'Tâches sans date signalées à part'] },
      { h2: 'Dépendances et jalons', p: [
        "Une tâche peut attendre la fin d'une autre : la dépendance est dessinée et la tâche bloquée est signalée. Les jalons marquent les dates qui comptent, comme une livraison ou une réception de chantier.",
        "Chaque étape a sa date de début et de fin, son montant et ses intervenants. Les couleurs disent l'état : terminé, en cours, en retard. Vous voyez ce qui glisse avant que le client ne le remarque.",
      ] },
      { h2: 'Le Gantt est une vue parmi quatre', shot: 'tableau', alt: 'Les mêmes tâches en tableau kanban dans ProjectLead.', p: [
        "Les mêmes tâches s'affichent aussi en tableau kanban, en liste et en calendrier. Celui qui préfère les colonnes travaille en tableau, le chef de projet regarde le Gantt : tout le monde voit les mêmes données.",
        `Pour une équipe, la vue Charge complète le Gantt en montrant les heures de chacun face à sa capacité. C'est ce qui rend ProjectLead adapté à une <a href="/fr/outil-gestion-de-projet-pme">PME</a> comme à un <a href="/fr/gestion-de-projet-freelance">indépendant</a>.`,
      ] },
      { h2: "Un planning préparé par l'Assistant IA", p: [IA, "Le plan proposé apparaît ensuite dans le Gantt comme n'importe quel autre : vous pouvez encore le replanifier à la souris."] },
      { h2: 'Gratuit, et plus quand vous en avez besoin', p: [
        `Le Gantt fait partie de toutes les formules. Au-delà de trois projets en cours, Pro ouvre les projets sans limite pour une personne et Pro+ pour une équipe jusqu'à cinq personnes. Voyez aussi notre page <a href="/fr/logiciel-gestion-de-projet-gratuit">logiciel de gestion de projet gratuit</a>.`,
      ] },
    ],
    faq: [
      ['Le diagramme de Gantt est-il vraiment gratuit ?', 'Oui, dans la formule Gratuit, pour trois projets en cours à la fois, sans limite de durée.'],
      ['Faut-il télécharger un logiciel ?', "Non. ProjectLead s'utilise en ligne, dans le navigateur."],
      ['Peut-on gérer les dépendances entre tâches ?', 'Oui. Une tâche peut dépendre d\'une autre ; une tâche bloquée est signalée.'],
      ["Mon client peut-il voir le planning ?", "Il voit l'avancement et les étapes que vous rendez visibles sur sa page de suivi, sans compte."],
    ],
  },
  time: {
    nav: 'Logiciel feuille de temps et facturation', kicker: 'Temps', teaser: 'Chronomètre, feuille de la semaine et brouillons de facture.',
    keyword: 'logiciel feuille de temps et facturation',
    title: 'Logiciel feuille de temps et facturation | ProjectLead',
    description: "Logiciel feuille de temps et facturation : chronomètre, heures facturables par projet et brouillon de facture mensuel dans InvoiceLead. Gratuit pour 3 projets.",
    h1: 'Logiciel feuille de temps et facturation, sans heures oubliées',
    lede: "Les heures notées dans un carnet finissent souvent oubliées au moment de facturer. ProjectLead relie la feuille de temps aux projets et aux tâches, puis prépare chaque mois un brouillon de facture par projet dans InvoiceLead.",
    shot: 'temps', shotAlt: 'Feuille de temps de la semaine dans ProjectLead : heures par projet et par tâche, total du jour face à la capacité.',
    sections: [
      { h2: 'Saisir son temps sans y penser', p: [
        "Lancez le chronomètre sur une tâche quand vous commencez, arrêtez-le quand vous passez à autre chose. Vous préférez saisir après coup ? La feuille de la semaine montre chaque jour, projet par projet, avec le total face à votre capacité.",
        "Chaque saisie est rattachée à un projet et, si vous le voulez, à une tâche. Elle est facturable ou non, et prend le taux de la personne sur ce projet.",
      ], list: ['Chronomètre sur une tâche', 'Feuille de temps de la semaine', 'Heures facturables ou non', 'Taux par personne et par projet'] },
      { h2: 'Rapports de temps et de rentabilité', p: [
        "Les rapports donnent les heures, les montants facturables, les coûts et la marge par projet, par client ou par personne. Vous voyez quel projet dépasse son budget en heures avant qu'il ne soit trop tard.",
        "Un export CSV du mois ou d'un rapport part chez la fiduciaire ou dans votre comptabilité. Le budget de chaque projet, en heures et en montant, reste visible face au temps passé.",
      ] },
      { h2: 'De la feuille de temps à la facture', shot: 'facturation', alt: 'Facturation du mois dans ProjectLead : un aperçu par projet et le bouton Créer les brouillons dans InvoiceLead.', p: [
        "Chaque mois, ProjectLead prépare un brouillon de facture par projet dans InvoiceLead, l'application de facturation de la suite Lead. Quatre façons de facturer sont possibles : à l'heure (le temps du mois, une ligne par tâche et par taux), au forfait mensuel, par étape livrée ou au forfait global à la fin.",
        "Les brouillons se créent à la main ou automatiquement le jour choisi. Le temps facturé ne se modifie plus et jamais deux brouillons ne partent pour le même mois. Vous relisez le brouillon et vous émettez la facture depuis InvoiceLead ; ProjectLead n'émet rien lui-même.",
      ] },
      { h2: "L'Assistant IA à vos côtés", p: [IA, "Il peut par exemple vous dire combien d'heures ont été passées sur un projet ce mois-ci, ou préparer la correction d'une saisie à confirmer."] },
      { h2: 'Pour qui', p: [
        `Un <a href="/fr/gestion-de-projet-freelance">freelance ou indépendant</a> facture ses heures sans les recompter. Une <a href="/fr/outil-gestion-de-projet-pme">PME</a> voit la rentabilité de chaque projet et la charge de chacun. Dans les deux cas, la formule Gratuit permet de commencer avec trois projets en cours.`,
      ] },
    ],
    faq: [
      ['Faut-il InvoiceLead pour suivre le temps ?', "Non. La feuille de temps et les rapports fonctionnent seuls. InvoiceLead sert seulement à transformer les heures en factures."],
      ['Peut-on modifier une heure déjà facturée ?', "Non. Le temps facturé est verrouillé, ce qui évite les écarts entre la facture et les heures."],
      ['Le suivi du temps est-il dans la formule gratuite ?', 'Oui. Toutes les fonctions sont dans chaque formule.'],
      ['Peut-on exporter les heures ?', 'Oui, en CSV, depuis le mois ou depuis un rapport.'],
    ],
  },
  freelance: {
    nav: 'Gestion de projet freelance', kicker: 'Indépendants', teaser: 'Projets, heures, clients et rendez-vous pour qui travaille seul.',
    keyword: 'gestion de projet freelance',
    title: 'Gestion de projet freelance et indépendants | ProjectLead',
    description: "Gestion de projet freelance : projets, heures, rendez-vous et suivi client dans un seul outil. Gratuit pour 3 projets en cours, Pro à 19 € par mois.",
    h1: 'Gestion de projet freelance : vos projets, vos heures, vos clients',
    lede: "Un freelance est à la fois chef de projet, exécutant et comptable. ProjectLead garde tout au même endroit : les projets et leurs étapes, le temps passé, les e-mails des clients, les rendez-vous et la facture du mois.",
    shot: 'projet', shotAlt: "Vue d'ensemble d'un projet dans ProjectLead, avec étapes, temps passé et budget.",
    sections: [
      { h2: 'Un outil pensé aussi pour les indépendants', p: [
        "ProjectLead sert les PME, mais aussi ceux qui travaillent seuls. La formule Gratuit donne toutes les fonctions pour trois projets en cours et une personne, sans limite de durée. Quand vos missions se multiplient, Pro ouvre les projets sans limite, toujours pour une personne, à 19 € par mois ou 190 € par an hors taxes.",
        "Vous n'avez pas besoin d'une méthode de gestion de projet : un projet, quelques étapes datées et des tâches suffisent. Les modèles vous évitent de tout recréer pour chaque nouvelle mission.",
      ], list: ['Projets, étapes et tâches', 'Chronomètre et feuille de temps', 'E-mails et agenda branchés', 'Page de suivi pour chaque client'] },
      { h2: 'Les demandes clients deviennent des projets', shot: 'emails', alt: "Boîte de réception de ProjectLead : une demande ouverte avec les boutons Créer un projet et Rattacher à un projet.", p: [
        "Branchez Gmail, Microsoft 365 ou votre messagerie IMAP. L'e-mail d'un client connu rejoint tout seul son projet en cours. Une nouvelle demande devient un projet en un clic : le client est créé depuis l'expéditeur et la première tâche « Répondre à » est prête.",
        "Un formulaire de demande public peut aussi ouvrir un projet à qualifier dès qu'un prospect le remplit.",
      ] },
      { h2: 'Des heures facturées, pas oubliées', p: [
        `Le chronomètre tourne pendant que vous travaillez et chaque heure trouve son projet. Si vous utilisez InvoiceLead avec le même compte, ProjectLead prépare chaque mois un brouillon de facture par projet. Tout est expliqué sur la page <a href="/fr/logiciel-feuille-de-temps-et-facturation">feuille de temps et facturation</a>.`,
      ] },
      { h2: 'Vos clients suivent sans vous appeler', p: [
        "Chaque client reçoit un lien vers la page de suivi de son projet : avancement, étapes, notes partagées et fichiers. Le suivi peut partir par e-mail chaque semaine ou à chaque étape terminée. Vos pages de rendez-vous en ligne évitent les échanges pour trouver un créneau, et les créneaux occupés de vos agendas extérieurs sont bloqués.",
      ] },
      { h2: "L'Assistant IA comme collègue", p: [IA, "Quand on travaille seul, c'est un plan de mission prêt à relire au lieu d'une page blanche."] },
    ],
    faq: [
      ['Quelle formule pour un freelance ?', "Gratuit pour trois projets en cours, Pro pour des projets sans limite. Les deux sont pour une personne."],
      ['Puis-je utiliser ProjectLead sans InvoiceLead ?', "Oui. ProjectLead fonctionne seul ; InvoiceLead ajoute les brouillons de facture."],
      ['Mes clients ont-ils besoin d\'un compte ?', "Non. Ils suivent leur projet par un lien personnel."],
      ['Puis-je travailler en allemand ou en anglais ?', "Oui. L'interface existe en français, allemand, anglais, italien et espagnol."],
    ],
  },
  monday: {
    nav: 'Alternative à Monday', kicker: 'Alternative', teaser: 'Une gestion de projet qui suit aussi le temps, le client et la facture.',
    keyword: 'alternative à monday',
    title: 'Alternative à Monday pour PME et indépendants | ProjectLead',
    description: "Une alternative à Monday pensée pour les PME et indépendants : Gantt, temps, suivi client et facturation au même endroit. Gratuit pour 3 projets en cours.",
    h1: 'Une alternative à Monday pour mener le projet jusqu\'à la facture',
    lede: "monday.com est une plateforme de travail très configurable, appréciée pour ses tableaux, ses automatisations et ses formulaires. Si vous cherchez une alternative à Monday centrée sur le projet client, du devis signé à la facture, ProjectLead mérite un essai.",
    shot: 'tableau', shotAlt: 'Tableau kanban de ProjectLead avec colonnes et cartes de tâches.',
    sections: [
      { h2: 'Ce que ProjectLead reprend de Monday', p: [
        "ProjectLead s'inspire de ce que les utilisateurs aiment dans monday.com : les automatisations « quand… alors… », les formulaires de demande publics et la vue de la charge de travail par personne et par semaine.",
        "Les tâches s'affichent en tableau, en liste, en Gantt et en calendrier. Elles ont des sous-tâches, des listes de contrôle, des commentaires avec @mentions et des fichiers.",
      ], list: ['Automatisations « quand… alors… »', 'Formulaires de demande publics', 'Charge de travail par personne', 'Quatre vues des mêmes tâches'] },
      { h2: 'Ce que ProjectLead ajoute pour le projet client', shot: 'facturation', alt: 'Facturation du mois dans ProjectLead, un brouillon de facture par projet.', p: [
        "ProjectLead est construit autour du projet vendu à un client. Il ne demande pas de concevoir ses propres tableaux : les étapes, le budget en heures et en montant, les intervenants avec leur taux et le suivi client sont là dès le départ.",
        `Le temps se saisit au chronomètre ou dans la feuille de la semaine, et chaque mois un brouillon de facture par projet part dans InvoiceLead. Voyez la page <a href="/fr/logiciel-feuille-de-temps-et-facturation">feuille de temps et facturation</a>.`,
        "Le client suit son projet sur une page publique, sans compte, et reçoit un suivi automatique par e-mail. Il prend rendez-vous sur vos pages de réservation en ligne.",
      ] },
      { h2: 'E-mails, agendas et suite Lead', p: [
        "Gmail, Microsoft 365 et toute messagerie IMAP se branchent directement : un e-mail de client rejoint son projet, une nouvelle demande devient un projet. Avec CRMlead, une affaire gagnée arrive en projet avec le client et ses contacts. Toutes les applications Lead s'ouvrent avec le même compte ERPlead, sans clé à coller pour les relier.",
      ] },
      { h2: 'Un Assistant IA qui agit', p: [IA] },
      { h2: 'Changer d\'outil en douceur', p: [
        `La formule Gratuit permet d'essayer ProjectLead sur trois projets en cours sans limite de durée, à côté de votre outil actuel. Les modèles de projet vous évitent de tout ressaisir. Pour une équipe, Pro+ accueille jusqu'à cinq personnes. Vous comparez aussi avec Asana ? Lisez notre page <a href="/fr/alternative-asana">alternative à Asana</a>.`,
      ] },
    ],
    faq: [
      ['ProjectLead remplace-t-il Monday ?', "Pour la gestion de projets clients (planning, temps, suivi client et facturation), oui. Pour d'autres usages de monday.com, comme des tableaux sur mesure hors projet, chaque équipe juge selon ses besoins."],
      ['Existe-t-il une version gratuite ?', 'Oui : toutes les fonctions pour trois projets en cours et une personne, sans limite de durée.'],
      ['Peut-on importer depuis Monday ?', "ProjectLead n'a pas d'import direct depuis monday.com. Les modèles de projet et l'Assistant IA aident à recréer rapidement vos projets."],
      ['Le logiciel est-il en français ?', 'Oui, ainsi qu\'en allemand, anglais, italien et espagnol.'],
    ],
  },
  asana: {
    nav: 'Alternative à Asana', kicker: 'Alternative', teaser: 'Points d\'avancement et dépendances, plus le temps et la facture.',
    keyword: 'alternative asana',
    title: 'Alternative Asana pour PME et indépendants | ProjectLead',
    description: "Une alternative Asana pour PME et indépendants : tâches, Gantt, temps facturable, suivi client et facturation dans un seul outil. Gratuit pour 3 projets en cours.",
    h1: 'Une alternative Asana qui compte aussi les heures et prépare la facture',
    lede: "Asana est connu pour ses points d'avancement, ses portefeuilles, sa vue « Mes tâches » et ses dépendances. ProjectLead reprend ces bonnes idées et y ajoute ce dont une entreprise de services a besoin : le temps facturable, la page de suivi client et la facturation mensuelle.",
    shot: 'projet', shotAlt: "Vue d'ensemble d'un projet dans ProjectLead avec points d'avancement, étapes et intervenants.",
    sections: [
      { h2: "Ce que ProjectLead reprend d'Asana", p: [
        "Les points d'avancement disent si un projet est dans les temps, à surveiller ou en retard. La vue « Mes tâches » rassemble ce que chacun a à faire, avec ses échéances. Les dépendances, les jalons, les modèles de projet et les règles automatiques sont là aussi.",
      ], list: ["Points d'avancement", 'Mes tâches', 'Dépendances et jalons', 'Modèles et automatisations'] },
      { h2: 'Ce que ProjectLead ajoute', shot: 'temps', alt: 'Feuille de temps de la semaine dans ProjectLead.', p: [
        "Le suivi du temps est intégré : chronomètre, feuille de la semaine, heures facturables par projet, tâche et personne, rapports de rentabilité et export CSV. Chaque projet a un budget en heures et en montant.",
        "Le client suit son projet sur une page publique et reçoit un point automatique par e-mail. Il prend rendez-vous en ligne. Et chaque mois, ProjectLead prépare un brouillon de facture par projet dans InvoiceLead, à l'heure, au forfait ou par étape livrée.",
        `Les e-mails se branchent (Gmail, Microsoft 365, IMAP) et une demande reçue devient un projet en un clic. Le <a href="/fr/diagramme-de-gantt-en-ligne-gratuit">diagramme de Gantt</a> se replanifie en glissant une barre.`,
      ] },
      { h2: "L'Assistant IA qui applique", p: [IA] },
      { h2: 'Pour qui ProjectLead est fait', p: [
        `ProjectLead s'adresse aux <a href="/fr/outil-gestion-de-projet-pme">PME</a> et aux <a href="/fr/gestion-de-projet-freelance">indépendants</a> qui vendent des projets à des clients : bureaux d'études, artisans, agences, consultants. L'interface existe en cinq langues et la formule Gratuit permet d'essayer sur trois projets en cours, sans limite de durée et sans carte bancaire.`,
        `Vous hésitez aussi avec monday.com ? Voyez notre page <a href="/fr/alternative-a-monday">alternative à Monday</a>.`,
      ] },
    ],
    faq: [
      ['ProjectLead est-il une bonne alternative à Asana ?', "Pour mener des projets clients avec le temps, le suivi client et la facturation au même endroit, oui. ProjectLead reprend les points forts d'Asana pour la gestion des tâches."],
      ['Y a-t-il une version gratuite ?', 'Oui, pour trois projets en cours et une personne, avec toutes les fonctions.'],
      ['Combien de personnes en équipe ?', "Jusqu'à cinq personnes en Pro+, 39 € par mois ou 390 € par an hors taxes."],
      ['Peut-on relier ProjectLead à un CRM ?', "Oui, à CRMlead, sans clé : une affaire gagnée y devient un projet. Une API REST est aussi disponible pour vos autres outils."],
    ],
  },
}

export default { ui, offers, plans, home, pages }
