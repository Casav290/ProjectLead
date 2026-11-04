// Deutsche Texte der öffentlichen Website. Fakten aus dem Code von ProjectLead (server/lib/plans.ts,
// docs/FONCTIONNALITES.md, docs/ASSISTANT-ACTIONS.md): nichts erfunden, keine Preise von Mitbewerbern, kein Geviertstrich.
import { img, tourView } from './fr.mjs'

const ui = {
  skip: 'Zum Inhalt', brandLabel: 'ProjectLead, Startseite', navLabel: 'Hauptnavigation', langLabel: 'Sprache',
  nav: { features: 'Funktionen', client: 'Kundenportal', pricing: 'Preise', guides: 'Ratgeber' },
  login: 'Anmelden', signup: 'Konto erstellen', signupFree: 'Kostenloses Konto erstellen', seeFeatures: 'Funktionen ansehen',
  fine: 'Kostenlos für 3 laufende Projekte, ohne Kreditkarte und ohne zeitliche Begrenzung.',
  shotCaption: 'Bildschirmfoto der App (französische Oberfläche). Firma, Kunden und Projekte sind erfunden.',
  crumbs: 'Brotkrumen', faqMeta: 'Fragen', faqTitle: 'Häufige Fragen', moreGuides: 'Weitere Ratgeber zu ProjectLead',
  startMeta: 'Loslegen', finalTitle: 'Ihr nächstes Projekt beginnt hier.', backHome: 'Zur Startseite',
  footGuides: 'Ratgeber', footSuite: 'Die Lead-Suite', footHome: 'Startseite', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen',
  footPart: 'ProjectLead gehört zu den Lead-Apps.',
  ogAlt: 'ProjectLead: das verkaufte Projekt, pünktlich geliefert. Bildschirmfoto der Startseite der App.',
}

const offers = {
  free: 'Gratis', freeDesc: '3 laufende Projekte, 1 Person, alle Funktionen, ohne zeitliche Begrenzung',
  proDesc: 'Unbegrenzte Projekte, 1 Person, 19 € pro Monat oder 190 € pro Jahr, zzgl. Steuern',
  proPlusDesc: 'Unbegrenzte Projekte, bis zu 5 Personen, 39 € pro Monat oder 390 € pro Jahr, zzgl. Steuern',
}

const plans = {
  title: 'Kostenlos starten. Zu Pro wechseln, wenn die Projekte mehr werden.',
  free: 'Gratis', freeBig: '3 laufende Projekte',
  freeList: ['1 Person', 'Alle Funktionen', 'KI-Assistent, etwa 10 Anfragen pro Monat', 'Ohne zeitliche Begrenzung'],
  proBig: 'Unbegrenzte Projekte', proList: ['1 Person', 'Alle Funktionen', 'Für Selbstständige mit mehreren Projekten'],
  proPlusBig: 'Unbegrenzte Projekte', proPlusList: ['Bis zu 5 Personen', 'Alle Funktionen', 'Für das Team mit gemeinsamer Planung'],
  start: 'Loslegen',
  foot: 'Pro kostet 19 € pro Monat oder 190 € pro Jahr, Pro+ 39 € pro Monat oder 390 € pro Jahr, zuzüglich Steuern. Der Tarif wird in ProjectLead gewählt (Einstellungen, Unternehmen) und gilt nur für ProjectLead. Abgeschlossene und archivierte Projekte, Vorlagen und zu prüfende Anfragen zählen nicht. Eine Grenze verhindert nur ein weiteres Projekt, sie sperrt nie Ihre Daten.',
}

const homeFaq = [
  ['Ist ProjectLead wirklich kostenlos?', 'Ja. Der Gratis-Tarif enthält alle Funktionen für 3 gleichzeitig laufende Projekte und eine Person, ohne zeitliche Begrenzung und ohne Kreditkarte. Ein abgeschlossenes oder archiviertes Projekt gibt seinen Platz frei.'],
  ['Eignet sich ProjectLead für Selbstständige?', 'Ja. Selbstständige führen dort ihre Projekte, Stunden und Termine allein. Pro öffnet unbegrenzte Projekte für eine Person, Pro+ für bis zu 5 Personen.'],
  ['Brauche ich CRMlead oder InvoiceLead?', 'Nein. ProjectLead funktioniert allein. Mit CRMlead verbunden, erhält es gewonnene Aufträge; mit InvoiceLead verbunden, bereitet es Rechnungsentwürfe vor. Die Verbindung läuft über dasselbe Konto, ohne API-Schlüssel.'],
  ['Was macht der KI-Assistent?', 'Er beantwortet Fragen zu Ihren Projekten, öffnet die richtige Ansicht und bereitet Änderungen vor, etwa den vollständigen Projektplan mit Phasen, Aufgaben, Meilensteinen und Abhängigkeiten. Alles erscheint auf einer Karte zum Bestätigen: Ein Klick auf „Bestätigen“ übernimmt es, mit Ihren Rechten.'],
  ['Wie melde ich mich an?', 'Mit Ihrem ERPlead-Konto, dem gemeinsamen Konto der Lead-Apps. Falls Sie keines haben, entsteht es beim ersten Besuch, ohne Kreditkarte.'],
  ['Brauchen meine Kunden ein Konto?', 'Nein. Sie verfolgen ihr Projekt über einen persönlichen Link und buchen Termine auf einer öffentlichen Seite.'],
  ['Welche Postfächer kann ich verbinden?', 'Gmail, Microsoft 365 und jedes IMAP-Postfach, zum Beispiel Infomaniak, Hostpoint oder iCloud.'],
  ['In welchen Sprachen gibt es die App?', 'Deutsch, Französisch, Englisch, Italienisch und Spanisch. Jede Person wählt ihre Sprache, und jedes Projekt kann eine eigene Sprache für Kundendokumente haben.'],
]

const home = {
  title: 'ProjectLead, Projektmanagement Software für KMU und Selbstständige',
  description: 'Projektmanagement online: Phasen, Gantt-Diagramm, Aufgaben, Zeiterfassung, Kundenportal und Rechnungen mit InvoiceLead. Kostenlos für 3 laufende Projekte.',
  faq: homeFaq,
  body: ({ signup, plans, faq, guides }) => `
  <section class="wrap hero" aria-labelledby="titre">
    <p class="meta" data-reveal>Projektmanagement Software für KMU und Selbstständige</p>
    <h1 id="titre" data-reveal style="--d:1">Das verkaufte Projekt, pünktlich geliefert. <span>Ohne verlorene Stunden.</span></h1>
    <div class="hero-row">
    <p class="lede" data-reveal style="--d:2">ProjectLead übernimmt, sobald der Auftrag unterschrieben ist. Phasen, Planung, Aufgaben, Zeit, E-Mails und Termine an einem Ort. Ihr Kunde verfolgt den Fortschritt auf seiner Seite, und die Stunden des Monats gehen für die Rechnung an InvoiceLead.</p>
    <div class="hero-act" data-reveal style="--d:3">
    <div class="ctas">
      <a class="btn btn-fill btn-lg" href="${signup}" rel="nofollow">Kostenloses Konto erstellen</a>
      <a class="btn btn-line btn-lg" href="#fonctions">Funktionen ansehen</a>
    </div>
    <p class="fine">Kostenlos für 3 laufende Projekte, ohne Kreditkarte. Anmeldung mit Ihrem ERPlead-Konto, gemeinsam für alle Lead-Apps.</p>
    </div>
    </div>
    <figure class="stage" aria-label="Die Startseite von ProjectLead, mit einer erfundenen Firma">
      <div class="frame frame-hero">
        <div class="frame-bar" aria-hidden="true"><span class="sq sq-s">PL</span><span class="url">projectlead.io</span><span class="bar-fill"></span></div>
        <picture>
          <source media="(max-width: 600px)" type="image/avif" srcset="/media/accueil/accueil-tel-860.avif">
          <source media="(max-width: 600px)" type="image/webp" srcset="/media/accueil/accueil-tel-860.webp">
          <source type="image/avif" srcset="/media/accueil/accueil-1280.avif 1280w, /media/accueil/accueil-2400.avif 2400w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)">
          <img src="/media/accueil/accueil-1280.webp" srcset="/media/accueil/accueil-1280.webp 1280w, /media/accueil/accueil-2400.webp 2400w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)" width="1440" height="900" alt="Startseite von ProjectLead: Aufgaben des Tages, verfolgte Projekte mit Fortschritt, Wochenzeit und Termine." fetchpriority="high" decoding="async">
        </picture>
      </div>
      <div class="chip chip-crm" aria-hidden="true"><span class="sq" style="background:var(--cl)">CL</span><span><b>Auftrag gewonnen in CRMlead</b>Wohnanlage Les Tilleuls, CHF <span data-count="186400">186 400</span></span></div>
      <div class="chip chip-stage" aria-hidden="true"><span class="tag tag-ok">Erledigt</span><span><b>Gerüst und Schutz</b>Der Kunde wird per E-Mail informiert</span></div>
      <div class="chip chip-timer" aria-hidden="true"><span class="dot"></span><span><b>Dämmung Nordfassade</b><span class="mono" data-timer="2832">0:47:12</span></span></div>
      <div class="chip chip-il" aria-hidden="true"><span class="sq" style="background:var(--il)">IL</span><span><b>Entwurf in InvoiceLead</b>September, CHF <span data-count="41000">41 000</span></span></div>
      <figcaption class="cap">Bildschirmfotos der App (französische Oberfläche). Firma, Kunden und Projekte sind erfunden.</figcaption>
    </figure>
  </section>

  <section class="wrap" aria-label="ProjectLead in Zahlen">
    <div class="stats">
      <div class="stat" data-reveal><b data-count="4">4</b><span>Ansichten derselben Aufgaben: Board, Liste, Gantt, Kalender</span></div>
      <div class="stat" data-reveal style="--d:1"><b data-count="4">4</b><span>Abrechnungsarten: nach Stunden, monatlich, pro Phase, pauschal</span></div>
      <div class="stat" data-reveal style="--d:2"><b data-count="3">3</b><span>laufende Projekte gratis, ohne zeitliche Begrenzung</span></div>
      <div class="stat" data-reveal style="--d:3"><b data-count="5">5</b><span>Sprachen: Deutsch, Französisch, Englisch, Italienisch, Spanisch</span></div>
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="relais-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Die Übergabe</p>
      <h2 id="relais-titre">Der unterschriebene Auftrag wird zum Projekt. Das Projekt wird zur Rechnung.</h2>
      <p>ProjectLead steht zwischen Verkauf und Abrechnung. Es übernimmt den gewonnenen Auftrag aus CRMlead und bereitet die Rechnung in InvoiceLead vor.</p>
    </div>
    <div class="chain" data-reveal>
      <div class="link" style="--c:var(--cl);--i:0"><div class="who"><span class="sq" style="background:var(--cl)">CL</span>CRMlead</div><div class="verb">Gewinnen</div><div class="doc"><b>Wohnanlage Les Tilleuls</b>Auftrag unterschrieben, CHF 186 400</div></div>
      <div class="link link-pl" style="--c:var(--accent);--i:1"><div class="who"><span class="sq sq-pl">PL</span>ProjectLead</div><div class="verb">Führen</div><div class="doc"><b>Energetische Sanierung</b>6 Phasen, 13 Aufgaben, 5 Beteiligte</div></div>
      <div class="link" style="--c:var(--il);--i:2"><div class="who"><span class="sq" style="background:var(--il)">IL</span>InvoiceLead</div><div class="verb">Abrechnen</div><div class="doc"><b>Entwurf September</b>2 Phasen geliefert, CHF 41 000</div></div>
    </div>
    <p class="chain-foot">Erfundenes Beispiel. ProjectLead funktioniert auch allein, ohne CRMlead und InvoiceLead.</p>
  </section>

  <section id="fonctions" class="wrap sec" aria-labelledby="fonctions-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Funktionen</p>
      <h2 id="fonctions-titre">Das ganze Projekt, von der ersten Aufgabe bis zur letzten Stunde.</h2>
      <p>Was die grossen Projektmanagement-Tools gut machen, gedacht für KMU und Selbstständige: schnell gelernt, vollständig, wenn das Projekt wächst.</p>
    </div>
    <div class="tour">
      <div class="tour-steps">
        <article class="step" data-step="projet" data-hl="17.3,44.1,55.4,20">
          <p class="meta">Überblick</p>
          <h3>Jedes Projekt hat seine Phasen, Beteiligten und sein Budget.</h3>
          <p>Der Fortschritt auf einen Blick: erledigte Aufgaben, Zeit gegenüber Budget, aktuelle Phase. Jede beteiligte Person hat ihre Rolle und ihren Satz im Projekt.</p>
          <ul class="dash"><li>Statusmeldungen: im Plan, beobachten, im Verzug</li><li>Budget in Stunden und Betrag</li><li>Vorlagen, um ein Projekt mit einem Klick zu eröffnen</li></ul>
          ${img('projet', 'Überblick über ein Sanierungsprojekt: Aufgaben, aufgewendete Zeit, Betrag pro Phase, datierte Phasen und Beteiligte.', ' style="--cx:45;--cy:54.1;--s:1.6"')}
        </article>
        <article class="step" data-step="gantt" data-hl="58.2,82.4,33.2,13">
          <p class="meta">Gantt</p>
          <h3>Die ganze Planung auf einem Bildschirm.</h3>
          <p>Phasen, Aufgaben, Meilensteine und Abhängigkeiten auf einer Zeitachse. Ein Balken wird verschoben, die Heute-Linie bleibt sichtbar. <a href="/de/gantt-diagramm-online-kostenlos">Mehr zum Gantt-Diagramm</a>.</p>
          <ul class="dash"><li>Skalen Tag, Woche und Monat</li><li>Blockierte Aufgaben markiert</li><li>Meilensteine für wichtige Termine</li></ul>
          ${img('gantt', 'Gantt-Diagramm des Projekts: Phasen, erledigte Aufgaben grün, laufende ocker, Abhängigkeiten und Heute-Linie.', ' style="--cx:74.8;--cy:88.9;--s:1.9"')}
        </article>
        <article class="step" data-step="tableau" data-hl="37.1,42.5,18.5,10.7">
          <p class="meta">Board</p>
          <h3>Das ganze Team an denselben Aufgaben.</h3>
          <p>Board, Liste, Gantt oder Kalender: vier Ansichten derselben Aufgaben. Alle sehen, was zu tun ist, mit Fälligkeiten und Prioritäten.</p>
          <ul class="dash"><li>Unteraufgaben, Checklisten, Kommentare mit @Erwähnungen</li><li>Bahnen nach Phase oder Person</li><li>Wiederkehrende Aufgaben und Dateien</li></ul>
          ${img('tableau', 'Kanban-Board des Projekts: Spalten offen, in Arbeit, in Prüfung und erledigt, Karten mit Fälligkeit, Priorität und zugewiesenen Personen.', ' style="--cx:46.4;--cy:47.9;--s:2.2"')}
        </article>
        <article class="step" data-step="temps" data-hl="17.3,29.4,81,47.3">
          <p class="meta">Zeit</p>
          <h3>Jede Stunde findet ihr Projekt.</h3>
          <p>Die Stoppuhr läuft, während Sie arbeiten, und der Wochenzettel füllt sich. Verrechenbare Stunden pro Projekt, Aufgabe und Person. <a href="/de/projektzeiterfassung-software">Projektzeiterfassung im Detail</a>.</p>
          <ul class="dash"><li>Stoppuhr und Wochen-Stundenzettel</li><li>Zeit- und Rentabilitätsberichte</li><li>CSV-Export für die Treuhand</li></ul>
          ${img('temps', 'Wochen-Stundenzettel: Stunden pro Projekt und Aufgabe, Tagestotal gegenüber der Kapazität.', ' style="--cx:57.8;--cy:53;--s:1.5"')}
        </article>
        <article class="step" data-step="emails" data-hl="44.8,17.5,53.6,38">
          <p class="meta">E-Mails</p>
          <h3>Eine Anfrage wird zum Projekt.</h3>
          <p>Verbinden Sie Gmail, Microsoft 365 oder Ihr Postfach. Die E-Mail eines bekannten Kunden landet von selbst in seinem Projekt. Eine neue Anfrage wird mit einem Klick zum Projekt, mit angelegtem Kunden und erster Aufgabe.</p>
          <ul class="dash"><li>Infomaniak, Hostpoint, iCloud und jedes IMAP-Postfach</li><li>Einem Projekt zuordnen, zur Aufgabe machen oder antworten</li><li>Ein gemeinsames Postfach für das Team</li></ul>
          ${img('emails', 'Posteingang: eine Offertanfrage mit den Schaltflächen Projekt erstellen, Projekt zuordnen, Antworten und Verwerfen.', ' style="--cx:71.6;--cy:36.5;--s:1.6"')}
        </article>
        <article class="step" data-step="charge" data-hl="17.3,17.4,81,42.4">
          <p class="meta">Auslastung</p>
          <h3>Sie sehen, wer überlastet ist, bevor es passiert.</h3>
          <p>Die Auslastung jeder Person Woche für Woche gegenüber ihrer Kapazität. Sie verteilen die Arbeit, bevor die Planung rutscht.</p>
          <ul class="dash"><li>Wochenkapazität pro Person</li><li>Teams, Rollen und Stundensätze</li></ul>
          ${img('charge', 'Auslastung des Teams pro Woche, in Stunden und Prozent der Kapazität, von grün bis rot.', ' style="--cx:57.8;--cy:38.6;--s:1.5"')}
        </article>
        <article class="step" data-step="facturation" data-hl="17.2,62.4,81.1,17.9">
          <p class="meta">Abrechnung</p>
          <h3>Die Stunden gehen an InvoiceLead.</h3>
          <p>Jeden Monat bereitet ProjectLead einen Rechnungsentwurf pro Projekt vor: nach Stunden, als Monatspauschale, pro gelieferter Phase oder pauschal. Sie prüfen und stellen die Rechnung in InvoiceLead aus.</p>
          <ul class="dash"><li>Abgerechnete Zeit ist gesperrt</li><li>Nie zwei Entwürfe für denselben Monat</li></ul>
          ${img('facturation', 'Monatsabrechnung: eine Vorschau pro Projekt, Stunden- und Phasenzeilen, Schaltfläche Entwürfe in InvoiceLead erstellen.', ' style="--cx:57.75;--cy:71.35;--s:1.5"')}
        </article>
      </div>
      ${tourView([['projet', 'Überblick'], ['gantt', 'Gantt'], ['tableau', 'Board'], ['temps', 'Zeit'], ['emails', 'E-Mails'], ['charge', 'Auslastung'], ['facturation', 'Abrechnung']], 'projectlead.io/projets')}
    </div>
  </section>

  <section id="client" class="wrap sec" aria-labelledby="client-titre">
    <div class="client">
      <div class="client-text">
        <div class="sec-head" data-reveal><p class="meta">Kundenportal</p><h2 id="client-titre">Ihr Kunde verfolgt sein Projekt, ohne Konto.</h2></div>
        <div class="points">
          <div class="point" data-reveal><h3>Eine Statusseite pro Projekt</h3><p>Fortschritt, Phasen, zuletzt geteilte Notizen und Dateien. Der Kunde schreibt dort dem Team. Sie bestimmen, was er sieht.</p></div>
          <div class="point" data-reveal style="--d:1"><h3>Der Statusbericht geht von selbst</h3><p>Jede Woche, alle zwei Wochen, jeden Monat oder nach jeder abgeschlossenen Phase: Der Kunde erhält eine klare E-Mail, ohne dass Sie sie schreiben.</p></div>
          <div class="point" data-reveal style="--d:2"><h3>Online-Terminbuchung</h3><p>Öffentliche Buchungsseiten, Gastgeber im Wechsel, Zeitfenster durch Ihre externen Kalender blockiert. Ein Termin kann ein Projekt eröffnen.</p></div>
        </div>
      </div>
      <div class="phones" data-reveal>
        <figure class="phone phone-scroll"><div class="phone-screen"><div class="phone-track"><picture><source type="image/avif" srcset="/media/accueil/portail-640.avif"><img src="/media/accueil/portail-640.webp" width="640" height="3628" alt="Statusseite aus Sicht des Kunden auf dem Handy: 33 % Fortschritt, erledigte und laufende Phasen, Notizen des Teams." loading="lazy" decoding="async"></picture></div></div><figcaption>Statusseite</figcaption></figure>
        <figure class="phone phone-b"><div class="phone-screen"><picture><source type="image/avif" srcset="/media/accueil/rdv-640.avif"><img src="/media/accueil/rdv-640.webp" width="640" height="1388" alt="Buchungsseite: technische Besichtigung von einer Stunde, Wahl des Tages und freier Zeiten." loading="lazy" decoding="async"></picture></div><figcaption>Terminbuchung</figcaption></figure>
      </div>
    </div>
  </section>

  <section id="assistant" class="wrap sec" aria-labelledby="ia-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">KI-Assistent</p>
      <h2 id="ia-titre">Ein Assistent, der die Arbeit vorbereitet. Sie bestätigen mit einem Klick.</h2>
      <p>Der in ProjectLead eingebaute KI-Assistent kennt Ihre Projekte. Er antwortet, öffnet die richtige Ansicht und bereitet Änderungen vor; nichts wird gespeichert, bevor Sie auf „Bestätigen“ klicken.</p>
    </div>
    <div class="more" data-reveal>
      <div class="more-item"><h3>Er antwortet</h3><p>Wo ein Projekt steht, welche Aufgaben im Verzug sind, wie viele Stunden diesen Monat: Er liest Ihre Daten, mit Ihren Rechten.</p></div>
      <div class="more-item"><h3>Er entwirft einen Plan</h3><p>Den vollständigen Projektplan: Phasen, Aufgaben, Meilensteine, Abhängigkeiten und Termine, vollständig auf einer Karte.</p></div>
      <div class="more-item"><h3>Ein Klick übernimmt</h3><p>Eine Karte zum Bestätigen zeigt jede Änderung. „Bestätigen“ übernimmt sie mit denselben Prüfungen wie die Ansicht.</p></div>
      <div class="more-item"><h3>Nichts geht ohne Sie raus</h3><p>Der Assistent sendet nie E-Mails an Ihre Kunden. Er ist in jedem Tarif enthalten, auch im Gratis-Tarif.</p></div>
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="suite-titre">
    <div class="sec-head" data-reveal><p class="meta">Mit den Lead-Apps</p><h2 id="suite-titre">Ein Konto. Die Informationen fliessen von App zu App.</h2></div>
    <div class="flows" data-reveal>
      <div class="flow"><span class="who"><span class="sq" style="background:var(--cl)">CL</span>CRMlead</span><span class="arrow" aria-hidden="true"></span><span class="who"><span class="sq sq-pl">PL</span>ProjectLead</span><p>Ein gewonnener Auftrag kommt als Projekt an, mit Kunde, Adresse und Kontakten.</p></div>
      <div class="flow"><span class="who"><span class="sq sq-pl">PL</span>ProjectLead</span><span class="arrow" aria-hidden="true"></span><span class="who"><span class="sq" style="background:var(--il)">IL</span>InvoiceLead</span><p>Jeden Monat werden Stunden und gelieferte Phasen zum Rechnungsentwurf.</p></div>
      <div class="flow"><span class="who"><span class="sq sq-el">EL</span>ERPlead</span><span class="arrow" aria-hidden="true"></span><span class="who apps"><span class="sq" style="background:var(--sl)">SL</span><span class="sq" style="background:var(--cl)">CL</span><span class="sq sq-pl">PL</span><span class="sq" style="background:var(--il)">IL</span></span><p>Dasselbe Konto öffnet alle Lead-Apps. Kein neues Passwort, kein Schlüssel zum Verbinden.</p></div>
    </div>
    <div class="more" data-reveal>
      <div class="more-item"><h3>Projektvorlagen</h3><p>Wiederverwendete Phasen, Aufgaben und Checklisten, Termine auf den Projektstart verschoben.</p></div>
      <div class="more-item"><h3>Automationen</h3><p>Ist eine Aufgabe erledigt, folgt die Phase. Regeln „wenn… dann…“ erledigen den Rest.</p></div>
      <div class="more-item"><h3>Anfrageformulare</h3><p>Ein öffentliches Formular, das ein zu prüfendes Projekt eröffnet, sobald ein Kunde es ausfüllt.</p></div>
      <div class="more-item"><h3>Kalender</h3><p>Ihre Termine in Google Kalender, Outlook oder Apple, Einladungen mit .ics-Datei.</p></div>
      <div class="more-item"><h3>Berichte</h3><p>Stunden, verrechenbare Beträge, Kosten und Marge pro Projekt, Kunde oder Person.</p></div>
      <div class="more-item"><h3>REST-API</h3><p>Ihre Projekte, Aufgaben und Stunden für Ihre anderen Werkzeuge, per API-Schlüssel.</p></div>
      <div class="more-item"><h3>Team</h3><p>Rollen, Teams, Sätze und Kapazitäten. Ein Projekt kann seinen Beteiligten vorbehalten sein.</p></div>
      <div class="more-item"><h3>Fünf Sprachen</h3><p>Deutsch, Französisch, Englisch, Italienisch und Spanisch, dazu eine Dokumentsprache pro Projekt.</p></div>
    </div>
  </section>

  <section id="tarifs" class="wrap sec" aria-labelledby="tarifs-titre">
    <div class="sec-head" data-reveal><p class="meta">Preise</p><h2 id="tarifs-titre">${plans_title}</h2><p>Jeder Tarif enthält alle Funktionen. Nur die Mengen ändern sich.</p></div>
    ${plans}
  </section>

  <section id="guides" class="wrap sec" aria-labelledby="guides-titre">
    <div class="sec-head" data-reveal><p class="meta">Ratgeber</p><h2 id="guides-titre">Das passende Werkzeug für Ihre Projekte.</h2><p>Kostenlose Software, KMU, Selbstständige, Gantt-Diagramm, Projektzeiterfassung oder Alternative zu einem bekannten Tool: was ProjectLead jeweils bietet.</p></div>
    ${guides}
  </section>

  <section id="questions" class="wrap sec" aria-labelledby="questions-titre">
    <div class="sec-head" data-reveal><p class="meta">Fragen</p><h2 id="questions-titre">Was uns am häufigsten gefragt wird.</h2></div>
    <div class="faq" data-reveal>
      ${faq}
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="final-titre">
    <div class="final" data-reveal>
      <div>
        <p class="meta">Loslegen</p>
        <h2 id="final-titre">Ihr nächstes Projekt beginnt hier.</h2>
        <div class="ctas"><a class="btn btn-fill btn-lg" href="${signup}" rel="nofollow">Kostenloses Konto erstellen</a><a class="btn btn-line btn-lg" href="/login" rel="nofollow">Anmelden</a></div>
        <p class="fine">Kostenlos für 3 laufende Projekte, ohne Kreditkarte.</p>
      </div>
      <div class="final-art" aria-hidden="true"><div class="gantt-art"><span style="--x:0;--w:34;--r:0"></span><span style="--x:22;--w:30;--r:1"></span><span style="--x:44;--w:36;--r:2"></span><span style="--x:62;--w:26;--r:3"></span><span style="--x:78;--w:22;--r:4"></span></div></div>
    </div>
  </section>`,
}
const plans_title = plans.title

const IA = 'Der eingebaute KI-Assistent bereitet die Arbeit für Sie vor: Er kann einen vollständigen Projektplan vorschlagen (Phasen, Aufgaben, Meilensteine, Abhängigkeiten und Termine) oder mehrere Änderungen auf einmal, vollständig angezeigt auf einer Karte zum Bestätigen. Ein Klick auf „Bestätigen“ übernimmt sie mit Ihren Rechten; der Assistent sendet nie eine E-Mail an Ihre Kunden.'

const pages = {
  free: {
    nav: 'Projektmanagement Software kostenlos', kicker: 'Kostenlos', teaser: 'Alle Funktionen für 3 laufende Projekte, ohne zeitliche Begrenzung.',
    keyword: 'projektmanagement software kostenlos',
    title: 'Projektmanagement Software kostenlos, alle Funktionen | ProjectLead',
    description: 'ProjectLead: Projektmanagement Software kostenlos, mit Gantt-Diagramm, Aufgaben, Zeiterfassung und Kundenportal für 3 laufende Projekte, ohne Kreditkarte.',
    h1: 'Projektmanagement Software kostenlos, ohne abgespeckte Funktionen',
    lede: 'ProjectLead gibt im Gratis-Tarif alle Funktionen frei: Phasen, Gantt-Diagramm, Aufgaben, Zeiterfassung, E-Mails, Termine und eine Statusseite für Ihre Kunden. Die einzige Grenze ist die Zahl laufender Projekte: drei gleichzeitig.',
    shot: 'projet', shotAlt: 'Überblick über ein Projekt in ProjectLead: Aufgaben, aufgewendete Zeit, Betrag pro Phase und Beteiligte.',
    sections: [
      { h2: 'Was der Gratis-Tarif enthält', p: [
        'Viele kostenlose Tools streichen genau die Funktionen, auf die es ankommt: das Gantt-Diagramm, die Zeiterfassung oder das Kundenportal. ProjectLead macht es umgekehrt. Der Gratis-Tarif hat genau dieselben Ansichten wie die bezahlten Tarife; nur die Mengen unterscheiden sich.',
        'Sie führen drei laufende Projekte gleichzeitig, allein. Ein abgeschlossenes, abgebrochenes oder archiviertes Projekt zählt nicht mehr und gibt seinen Platz frei. Projektvorlagen und zu prüfende Anfragen zählen ebenfalls nicht. Es gibt keine ablaufende Testphase und keine Kreditkarte.',
      ], list: ['Datierte Phasen, Meilensteine und Abhängigkeiten', 'Vier Ansichten: Board, Liste, Gantt, Kalender', 'Stoppuhr, Stundenzettel und Berichte', 'Gmail, Microsoft 365 und IMAP', 'Statusseite und Buchungsseiten für Kunden', 'KI-Assistent, etwa 10 Anfragen pro Monat'] },
      { h2: 'Echte Software statt geteilter Tabelle', shot: 'gantt', alt: 'Gantt-Diagramm in ProjectLead mit Phasen, Aufgaben, Abhängigkeiten und Heute-Linie.', p: [
        'Eine kostenlose Tabelle listet Aufgaben, warnt aber niemanden, wenn ein Termin rutscht. In ProjectLead hat jedes Projekt Phasen und ein Budget in Stunden und Betrag; der Status ist auf einen Blick lesbar: im Plan, beobachten oder im Verzug.',
        'Das <a href="/de/gantt-diagramm-online-kostenlos">Gantt-Diagramm online</a> wird durch Ziehen eines Balkens neu geplant. Aufgaben haben Unteraufgaben, Checklisten, Kommentare mit @Erwähnungen, Dateien und Prioritäten. Wiederkehrende Aufgaben kommen täglich, wöchentlich oder monatlich von selbst.',
      ] },
      { h2: 'Zeit und Rechnung, auch kostenlos', p: [
        'Die Stoppuhr läuft, während Sie arbeiten, und der Wochen-Stundenzettel füllt sich. Verrechenbare Stunden werden pro Projekt, Aufgabe und Person gezählt, ein CSV-Export geht an die Treuhand. Mehr dazu auf der Seite <a href="/de/projektzeiterfassung-software">Projektzeiterfassung Software</a>.',
        'Nutzt Ihre Firma auch InvoiceLead mit demselben Konto, bereitet ProjectLead jeden Monat einen Rechnungsentwurf pro Projekt vor. Die Verbindung braucht keinen Schlüssel und kostet nichts extra, in jedem Tarif.',
      ] },
      { h2: 'Ein KI-Assistent, der seine Vorschläge umsetzt', p: [IA, 'Im Gratis-Tarif steht der Assistent für etwa zehn Anfragen pro Monat und Firma zur Verfügung.'] },
      { h2: 'Wann sich ein bezahlter Tarif lohnt', p: [
        'Solange drei laufende Projekte reichen, bleiben Sie so lange im Gratis-Tarif, wie Sie möchten. Werden es mehr, öffnet Pro unbegrenzte Projekte für eine Person, ideal für <a href="/de/projektmanagement-tool-fuer-selbststaendige">Selbstständige</a>. Pro+ nimmt bis zu fünf Personen mit gemeinsamer Planung auf, wie in einem <a href="/de/projektmanagement-software-kmu">KMU</a>.',
        'Eine Grenze löscht oder sperrt nie Ihre Daten: Sie verhindert nur ein weiteres Projekt. Sie können also ohne Risiko kostenlos starten.',
      ] },
    ],
    faq: [
      ['Läuft der Gratis-Tarif ab?', 'Nein. Der Gratis-Tarif hat keine zeitliche Begrenzung, solange Sie höchstens drei laufende Projekte führen und allein arbeiten.'],
      ['Brauche ich eine Kreditkarte?', 'Nein. Das ERPlead-Konto, das ProjectLead öffnet, entsteht ohne Kreditkarte.'],
      ['Welche Funktionen fehlen im Gratis-Tarif?', 'Keine. Jeder Tarif enthält alle Funktionen; nur die Zahl laufender Projekte, der Personen und das Volumen des KI-Assistenten ändern sich.'],
      ['Was passiert beim vierten Projekt?', 'ProjectLead schlägt vor, ein Projekt abzuschliessen oder zu archivieren oder zu Pro zu wechseln. Bestehende Projekte bleiben sichtbar und bearbeitbar.'],
    ],
  },
  smb: {
    nav: 'Projektmanagement Software für KMU', kicker: 'KMU', teaser: 'Planung, Team, Zeit und Kunden für Firmen mit 2 bis 5 Personen.',
    keyword: 'projektmanagement software kmu',
    title: 'Projektmanagement Software KMU: Planung, Zeit, Kunden | ProjectLead',
    description: 'Projektmanagement Software KMU: Phasen, Gantt, Auslastung des Teams, verrechenbare Stunden und Kundenportal in einem Tool. Kostenlos für 3 laufende Projekte.',
    h1: 'Projektmanagement Software KMU: vom Auftrag bis zur Rechnung',
    lede: 'Ein KMU hat kein Projektbüro. Es braucht ein Werkzeug, das in einer Stunde gelernt ist, das das ganze Team wirklich nutzt und das Projekt vom unterschriebenen Auftrag bis zur Rechnung begleitet. Genau das macht ProjectLead.',
    shot: 'tableau', shotAlt: 'Kanban-Board in ProjectLead mit Spalten, Fälligkeiten und zugewiesenen Personen.',
    sections: [
      { h2: 'Was ein KMU von Projektmanagement Software erwartet', p: [
        'In einer kleinen Firma verkauft dieselbe Person, plant, arbeitet am Projekt und stellt die Rechnung. Die Informationen liegen verstreut in Postfach, Tabelle und Stundenheft. ProjectLead bringt sie zusammen: Projekt, Phasen, Aufgaben, Stunden, E-Mails und Termine an einem Ort.',
        'Vor dem Start muss nichts eingerichtet werden: Ein Projekt entsteht aus einer Vorlage mit fertigen Phasen und Aufgaben, und die Termine richten sich nach dem Startdatum.',
      ], list: ['Projekte mit Phasen, Budget und Beteiligten', 'Rollen: Administrator, Verantwortlicher, Mitglied', 'Teams, Stundensätze und Kapazitäten', 'Projekte nur für ihre Beteiligten'] },
      { h2: 'Die Auslastung des Teams, Woche für Woche', shot: 'charge', alt: 'Auslastung des Teams pro Woche gegenüber der Kapazität jeder Person.', p: [
        'Die Ansicht Auslastung zeigt die geplanten Stunden jeder Person Woche für Woche gegenüber ihrer Kapazität. Sie sehen, wer überlastet ist, bevor es passiert, und verteilen die Arbeit rechtzeitig.',
        'Das gemeinsame <a href="/de/gantt-diagramm-online-kostenlos">Gantt-Diagramm</a> zeigt Phasen, Aufgaben, Meilensteine und Abhängigkeiten auf einer Zeitachse. Unter „Meine Aufgaben“ sieht jede Person ihre Aufgaben mit Fälligkeit und Priorität.',
      ] },
      { h2: 'Kunden informiert, ohne Anrufe', p: [
        'Jedes Projekt kann eine öffentliche Statusseite haben, geöffnet über einen persönlichen Link: Der Kunde sieht Fortschritt, Phasen, geteilte Notizen und Dateien und kann dem Team schreiben. Sie bestimmen, was sichtbar ist.',
        'Statusberichte gehen auf Wunsch von selbst per E-Mail raus, wöchentlich, alle zwei Wochen, monatlich oder nach jeder abgeschlossenen Phase. Öffentliche Buchungsseiten lassen Kunden einen Termin wählen; mehrere Gastgeber können sich Termine im Wechsel teilen.',
      ] },
      { h2: 'Stunden und Abrechnung', p: [
        'Zeit wird mit der Stoppuhr oder im Wochen-Stundenzettel erfasst. Berichte zeigen Stunden, verrechenbare Beträge, Kosten und Marge pro Projekt, Kunde oder Person. Details auf der Seite <a href="/de/projektzeiterfassung-software">Projektzeiterfassung</a>.',
        'Mit InvoiceLead entsteht jeden Monat ein Rechnungsentwurf pro Projekt: nach Stunden, als Monatspauschale, pro gelieferter Phase oder pauschal. Abgerechnete Zeit ist gesperrt, und nie entstehen zwei Entwürfe für denselben Monat.',
      ] },
      { h2: 'Der KI-Assistent spart Zeit', p: [IA, 'Für ein KMU heisst das: der Plan eines neuen Auftrags in Sekunden, zum Prüfen vor dem Bestätigen.'] },
      { h2: 'Was ProjectLead ein KMU kostet', p: [
        'Zum Start reicht der Gratis-Tarif: drei laufende Projekte, eine Person, alle Funktionen. Pro+ nimmt bis zu fünf Personen mit unbegrenzten Projekten auf, für 39 € pro Monat oder 390 € pro Jahr, zuzüglich Steuern. Der Tarif wird in ProjectLead gewählt und gilt nur für ProjectLead.',
      ] },
    ],
    faq: [
      ['Wie viele Personen können ProjectLead nutzen?', 'Eine Person im Gratis- und Pro-Tarif, bis zu fünf im Pro+-Tarif.'],
      ['Ist die Software auf Deutsch?', 'Ja, dazu Französisch, Englisch, Italienisch und Spanisch. Jede Person wählt ihre Sprache.'],
      ['Können wir das Firmenpostfach verbinden?', 'Ja: Gmail, Microsoft 365 und jedes IMAP-Postfach. Ein Postfach kann mit dem Team geteilt werden.'],
      ['Müssen unsere Kunden etwas installieren?', 'Nein. Sie öffnen ihre Status- oder Buchungsseite im Browser, ohne Konto.'],
    ],
  },
  gantt: {
    nav: 'Gantt-Diagramm online kostenlos', kicker: 'Gantt', teaser: 'Phasen, Meilensteine und Abhängigkeiten, per Ziehen neu geplant.',
    keyword: 'gantt diagramm online kostenlos',
    title: 'Gantt-Diagramm online kostenlos | ProjectLead',
    description: 'Gantt-Diagramm online kostenlos: Phasen, Aufgaben, Meilensteine und Abhängigkeiten, mit der Maus neu geplant und mit dem Team geteilt. Ohne Download.',
    h1: 'Gantt-Diagramm online kostenlos, verbunden mit Ihren Aufgaben',
    lede: 'In ProjectLead ist das Gantt-Diagramm keine separate Zeichnung, sondern eine Ansicht der echten Aufgaben des Projekts. Was Sie auf der Zeitachse verschieben, ändert die Termine der Aufgaben, und das ganze Team sieht es sofort.',
    shot: 'gantt', shotAlt: 'Gantt-Diagramm in ProjectLead: Phasen, erledigte Aufgaben grün, laufende Aufgaben ocker und Heute-Linie.',
    sections: [
      { h2: 'Ein Gantt-Diagramm im Browser, ohne Installation', p: [
        'ProjectLead läuft im Browser, auf Computer und Tablet. Es gibt nichts herunterzuladen: Konto öffnen, Projekt anlegen, und das Gantt-Diagramm ist da. Der Gratis-Tarif enthält es für drei laufende Projekte, ohne zeitliche Begrenzung.',
        'Das Diagramm zeigt die Phasen des Projekts, ihre Aufgaben und die Meilensteine auf einer Zeitachse. Die Skala lässt sich auf Tag, Woche oder Monat stellen, und die Heute-Linie bleibt sichtbar.',
      ], list: ['Balken ziehen verschiebt die Termine', 'Rechten Rand ziehen ändert die Fälligkeit', 'Ein Klick öffnet die Aufgabe', 'Aufgaben ohne Datum separat angezeigt'] },
      { h2: 'Abhängigkeiten und Meilensteine', p: [
        'Eine Aufgabe kann auf das Ende einer anderen warten: Die Abhängigkeit wird gezeichnet und die blockierte Aufgabe markiert. Meilensteine markieren wichtige Termine wie eine Lieferung oder eine Abnahme.',
        'Jede Phase hat Start- und Enddatum, Betrag und Beteiligte. Die Farben zeigen den Stand: erledigt, in Arbeit, im Verzug. Sie sehen, was rutscht, bevor der Kunde es merkt.',
      ] },
      { h2: 'Das Gantt-Diagramm ist eine von vier Ansichten', shot: 'tableau', alt: 'Dieselben Aufgaben als Kanban-Board in ProjectLead.', p: [
        'Dieselben Aufgaben erscheinen auch als Kanban-Board, Liste und Kalender. Wer Spalten mag, arbeitet im Board, die Projektleitung schaut auf das Gantt-Diagramm: Alle sehen dieselben Daten.',
        'Für ein Team ergänzt die Ansicht Auslastung das Gantt-Diagramm mit den Stunden jeder Person gegenüber ihrer Kapazität. Darum passt ProjectLead zu einem <a href="/de/projektmanagement-software-kmu">KMU</a> ebenso wie zu <a href="/de/projektmanagement-tool-fuer-selbststaendige">Selbstständigen</a>.',
      ] },
      { h2: 'Eine Planung, entworfen vom KI-Assistenten', p: [IA, 'Der vorgeschlagene Plan erscheint danach im Gantt-Diagramm wie jeder andere und lässt sich weiter mit der Maus verschieben.'] },
      { h2: 'Kostenlos, und mehr, wenn Sie es brauchen', p: [
        'Das Gantt-Diagramm gehört zu jedem Tarif. Ab drei laufenden Projekten öffnet Pro unbegrenzte Projekte für eine Person und Pro+ für ein Team mit bis zu fünf Personen. Siehe auch <a href="/de/projektmanagement-software-kostenlos">Projektmanagement Software kostenlos</a>.',
      ] },
    ],
    faq: [
      ['Ist das Gantt-Diagramm wirklich kostenlos?', 'Ja, im Gratis-Tarif, für drei gleichzeitig laufende Projekte, ohne zeitliche Begrenzung.'],
      ['Muss ich Software herunterladen?', 'Nein. ProjectLead wird online im Browser genutzt.'],
      ['Kann ich Abhängigkeiten zwischen Aufgaben setzen?', 'Ja. Eine Aufgabe kann von einer anderen abhängen; eine blockierte Aufgabe wird markiert.'],
      ['Kann mein Kunde die Planung sehen?', 'Er sieht den Fortschritt und die Phasen, die Sie auf seiner Statusseite sichtbar machen, ohne Konto.'],
    ],
  },
  time: {
    nav: 'Projektzeiterfassung Software', kicker: 'Zeit', teaser: 'Stoppuhr, Wochen-Stundenzettel und monatliche Rechnungsentwürfe.',
    keyword: 'projektzeiterfassung software',
    title: 'Projektzeiterfassung Software mit Abrechnung | ProjectLead',
    description: 'Projektzeiterfassung Software: Stoppuhr, verrechenbare Stunden pro Projekt und monatlicher Rechnungsentwurf in InvoiceLead. Kostenlos für 3 laufende Projekte.',
    h1: 'Projektzeiterfassung Software, direkt im Projektmanagement',
    lede: 'Stunden im Notizbuch gehen bei der Rechnung oft vergessen. ProjectLead verbindet den Stundenzettel mit Projekten und Aufgaben und bereitet jeden Monat einen Rechnungsentwurf pro Projekt in InvoiceLead vor.',
    shot: 'temps', shotAlt: 'Wochen-Stundenzettel in ProjectLead: Stunden pro Projekt und Aufgabe, Tagestotal gegenüber Kapazität.',
    sections: [
      { h2: 'Zeit erfassen, ohne daran zu denken', p: [
        'Starten Sie die Stoppuhr auf einer Aufgabe, wenn Sie beginnen, und halten Sie sie an, wenn Sie wechseln. Lieber nachträglich erfassen? Der Wochen-Stundenzettel zeigt jeden Tag, Projekt für Projekt, mit dem Total gegenüber Ihrer Kapazität.',
        'Jeder Eintrag gehört zu einem Projekt und, wenn gewünscht, zu einer Aufgabe. Er ist verrechenbar oder nicht und übernimmt den Satz der Person in diesem Projekt.',
      ], list: ['Stoppuhr auf einer Aufgabe', 'Wochen-Stundenzettel', 'Verrechenbare und nicht verrechenbare Stunden', 'Satz pro Person und Projekt'] },
      { h2: 'Zeit- und Rentabilitätsberichte', p: [
        'Berichte zeigen Stunden, verrechenbare Beträge, Kosten und Marge pro Projekt, Kunde oder Person. Sie sehen, welches Projekt sein Stundenbudget überschreitet, bevor es zu spät ist.',
        'Ein CSV-Export des Monats oder eines Berichts geht an die Treuhand oder in die Buchhaltung. Das Budget jedes Projekts, in Stunden und Betrag, bleibt neben der aufgewendeten Zeit sichtbar.',
      ] },
      { h2: 'Vom Stundenzettel zur Rechnung', shot: 'facturation', alt: 'Monatsabrechnung in ProjectLead: eine Vorschau pro Projekt und die Schaltfläche Entwürfe in InvoiceLead erstellen.', p: [
        'Jeden Monat bereitet ProjectLead einen Rechnungsentwurf pro Projekt in InvoiceLead vor, der Rechnungs-App der Lead-Suite. Vier Abrechnungsarten stehen zur Wahl: nach Stunden (die Zeit des Monats, eine Zeile pro Aufgabe und Satz), Monatspauschale, pro gelieferter Phase oder Pauschale am Ende.',
        'Die Entwürfe entstehen von Hand oder automatisch am gewählten Tag. Abgerechnete Zeit ist gesperrt, und nie entstehen zwei Entwürfe für denselben Monat. Sie prüfen den Entwurf und stellen die Rechnung in InvoiceLead aus; ProjectLead selbst stellt nichts aus.',
      ] },
      { h2: 'Der KI-Assistent an Ihrer Seite', p: [IA, 'Er sagt Ihnen zum Beispiel, wie viele Stunden diesen Monat in ein Projekt geflossen sind, oder bereitet die Korrektur eines Eintrags zum Bestätigen vor.'] },
      { h2: 'Für wen', p: [
        '<a href="/de/projektmanagement-tool-fuer-selbststaendige">Selbstständige</a> rechnen ihre Stunden ab, ohne sie nachzuzählen. Ein <a href="/de/projektmanagement-software-kmu">KMU</a> sieht die Rentabilität jedes Projekts und die Auslastung jeder Person. In beiden Fällen startet der Gratis-Tarif mit drei laufenden Projekten.',
      ] },
    ],
    faq: [
      ['Brauche ich InvoiceLead für die Zeiterfassung?', 'Nein. Stundenzettel und Berichte funktionieren allein. InvoiceLead macht aus den Stunden nur die Rechnungen.'],
      ['Kann ich eine abgerechnete Stunde ändern?', 'Nein. Abgerechnete Zeit ist gesperrt, so stimmen Rechnung und Stunden überein.'],
      ['Ist die Zeiterfassung im Gratis-Tarif enthalten?', 'Ja. Jeder Tarif enthält alle Funktionen.'],
      ['Kann ich die Stunden exportieren?', 'Ja, als CSV, aus dem Monat oder aus einem Bericht.'],
    ],
  },
  freelance: {
    nav: 'Projektmanagement Tool für Selbstständige', kicker: 'Selbstständige', teaser: 'Projekte, Stunden, Kunden und Termine für alle, die allein arbeiten.',
    keyword: 'projektmanagement tool für selbstständige',
    title: 'Projektmanagement Tool für Selbstständige | ProjectLead',
    description: 'Projektmanagement Tool für Selbstständige: Projekte, Stunden, Termine und Kundenportal in einem Werkzeug. Kostenlos für 3 Projekte, Pro für 19 € im Monat.',
    h1: 'Projektmanagement Tool für Selbstständige: Projekte, Stunden, Kunden',
    lede: 'Wer selbstständig ist, ist Projektleitung, Ausführung und Buchhaltung zugleich. ProjectLead hält alles an einem Ort: Projekte und ihre Phasen, die aufgewendete Zeit, die E-Mails der Kunden, Termine und die Rechnung des Monats.',
    shot: 'projet', shotAlt: 'Überblick über ein Projekt in ProjectLead mit Phasen, aufgewendeter Zeit und Budget.',
    sections: [
      { h2: 'Auch für Selbstständige gemacht', p: [
        'ProjectLead dient KMU, aber auch allen, die allein arbeiten. Der Gratis-Tarif enthält alle Funktionen für drei laufende Projekte und eine Person, ohne zeitliche Begrenzung. Werden die Aufträge mehr, öffnet Pro unbegrenzte Projekte, weiterhin für eine Person, für 19 € pro Monat oder 190 € pro Jahr, zuzüglich Steuern.',
        'Sie brauchen keine Projektmanagement-Methode: ein Projekt, einige datierte Phasen und Aufgaben genügen. Vorlagen ersparen es, alles für jeden neuen Auftrag neu anzulegen.',
      ], list: ['Projekte, Phasen und Aufgaben', 'Stoppuhr und Stundenzettel', 'E-Mail und Kalender verbunden', 'Eine Statusseite für jeden Kunden'] },
      { h2: 'Kundenanfragen werden zu Projekten', shot: 'emails', alt: 'Posteingang in ProjectLead: eine offene Anfrage mit den Schaltflächen Projekt erstellen und Projekt zuordnen.', p: [
        'Verbinden Sie Gmail, Microsoft 365 oder Ihr IMAP-Postfach. Die E-Mail eines bekannten Kunden landet von selbst in seinem laufenden Projekt. Eine neue Anfrage wird mit einem Klick zum Projekt: Der Kunde wird aus dem Absender angelegt und eine erste Aufgabe „Antworten an“ steht bereit.',
        'Ein öffentliches Anfrageformular kann ausserdem ein zu prüfendes Projekt eröffnen, sobald ein Interessent es ausfüllt.',
      ] },
      { h2: 'Stunden abgerechnet, nicht vergessen', p: [
        'Die Stoppuhr läuft, während Sie arbeiten, und jede Stunde findet ihr Projekt. Nutzen Sie InvoiceLead mit demselben Konto, bereitet ProjectLead jeden Monat einen Rechnungsentwurf pro Projekt vor. Alles dazu auf der Seite <a href="/de/projektzeiterfassung-software">Projektzeiterfassung Software</a>.',
      ] },
      { h2: 'Kunden informiert, ohne Sie anzurufen', p: [
        'Jeder Kunde erhält einen Link zur Statusseite seines Projekts: Fortschritt, Phasen, geteilte Notizen und Dateien. Statusberichte gehen jede Woche oder nach jeder abgeschlossenen Phase per E-Mail raus. Ihre Online-Buchungsseiten ersparen das Hin und Her bei der Terminsuche, und belegte Zeiten aus Ihren externen Kalendern sind blockiert.',
      ] },
      { h2: 'Der KI-Assistent als Kollege', p: [IA, 'Wer allein arbeitet, erhält so einen Auftragsplan zum Prüfen statt eines leeren Blatts.'] },
    ],
    faq: [
      ['Welcher Tarif passt zu Selbstständigen?', 'Gratis für drei laufende Projekte, Pro für unbegrenzte Projekte. Beide gelten für eine Person.'],
      ['Kann ich ProjectLead ohne InvoiceLead nutzen?', 'Ja. ProjectLead funktioniert allein; InvoiceLead ergänzt die Rechnungsentwürfe.'],
      ['Brauchen meine Kunden ein Konto?', 'Nein. Sie verfolgen ihr Projekt über einen persönlichen Link.'],
      ['Gibt es die App auf Deutsch?', 'Ja, dazu auf Französisch, Englisch, Italienisch und Spanisch.'],
    ],
  },
  monday: {
    nav: 'Monday Alternative', kicker: 'Alternative', teaser: 'Projektmanagement mit Zeit, Kundenportal und Rechnung.',
    keyword: 'monday alternative',
    title: 'Monday Alternative für KMU und Selbstständige | ProjectLead',
    description: 'Eine Monday Alternative für KMU und Selbstständige: Gantt-Diagramm, Zeiterfassung, Kundenportal und Abrechnung an einem Ort. Kostenlos für 3 Projekte.',
    h1: 'Eine Monday Alternative, die das Projekt bis zur Rechnung führt',
    lede: 'monday.com ist eine sehr anpassbare Arbeitsplattform, geschätzt für Boards, Automationen und Formulare. Suchen Sie eine Monday Alternative, die sich auf Kundenprojekte konzentriert, von der unterschriebenen Offerte bis zur Rechnung, lohnt sich ein Test von ProjectLead.',
    shot: 'tableau', shotAlt: 'Kanban-Board in ProjectLead mit Spalten und Aufgabenkarten.',
    sections: [
      { h2: 'Was ProjectLead von Monday übernimmt', p: [
        'ProjectLead greift auf, was Nutzer an monday.com schätzen: Automationen „wenn… dann…“, öffentliche Anfrageformulare und eine Auslastungsansicht pro Person und Woche.',
        'Aufgaben erscheinen als Board, Liste, Gantt-Diagramm und Kalender. Sie haben Unteraufgaben, Checklisten, Kommentare mit @Erwähnungen und Dateien.',
      ], list: ['Automationen „wenn… dann…“', 'Öffentliche Anfrageformulare', 'Auslastung pro Person', 'Vier Ansichten derselben Aufgaben'] },
      { h2: 'Was ProjectLead für Kundenprojekte ergänzt', shot: 'facturation', alt: 'Monatsabrechnung in ProjectLead, ein Rechnungsentwurf pro Projekt.', p: [
        'ProjectLead ist um das an einen Kunden verkaufte Projekt gebaut. Sie müssen keine eigenen Boards entwerfen: Phasen, Budget in Stunden und Betrag, Beteiligte mit ihren Sätzen und die Kundeninformation sind von Anfang an da.',
        'Zeit wird mit der Stoppuhr oder im Wochen-Stundenzettel erfasst, und jeden Monat geht ein Rechnungsentwurf pro Projekt an InvoiceLead. Siehe <a href="/de/projektzeiterfassung-software">Projektzeiterfassung Software</a>.',
        'Der Kunde verfolgt sein Projekt auf einer öffentlichen Seite, ohne Konto, und erhält automatische Statusberichte per E-Mail. Termine bucht er auf Ihren Online-Buchungsseiten.',
      ] },
      { h2: 'E-Mail, Kalender und die Lead-Suite', p: [
        'Gmail, Microsoft 365 und jedes IMAP-Postfach werden direkt verbunden: Die E-Mail eines Kunden landet in seinem Projekt, eine neue Anfrage wird zum Projekt. Mit CRMlead kommt ein gewonnener Auftrag als Projekt mit Kunde und Kontakten an. Alle Lead-Apps öffnen sich mit demselben ERPlead-Konto, ohne Schlüssel zum Verbinden.',
      ] },
      { h2: 'Ein KI-Assistent, der handelt', p: [IA] },
      { h2: 'Sanft wechseln', p: [
        'Mit dem Gratis-Tarif testen Sie ProjectLead mit drei laufenden Projekten ohne zeitliche Begrenzung, neben Ihrem bisherigen Werkzeug. Projektvorlagen ersparen das erneute Erfassen. Für ein Team nimmt Pro+ bis zu fünf Personen auf. Vergleichen Sie auch mit Asana? Lesen Sie unsere Seite <a href="/de/asana-alternative">Asana Alternative</a>.',
      ] },
    ],
    faq: [
      ['Kann ProjectLead Monday ersetzen?', 'Für Kundenprojekte (Planung, Zeit, Kundeninformation und Abrechnung) ja. Für andere Einsätze von monday.com, etwa eigene Boards ausserhalb von Projekten, entscheidet jedes Team nach seinem Bedarf.'],
      ['Gibt es eine kostenlose Version?', 'Ja: alle Funktionen für drei laufende Projekte und eine Person, ohne zeitliche Begrenzung.'],
      ['Kann ich aus Monday importieren?', 'ProjectLead hat keinen direkten Import aus monday.com. Projektvorlagen und der KI-Assistent helfen, Ihre Projekte schnell neu anzulegen.'],
      ['Gibt es die Software auf Deutsch?', 'Ja, dazu auf Französisch, Englisch, Italienisch und Spanisch.'],
    ],
  },
  asana: {
    nav: 'Asana Alternative', kicker: 'Alternative', teaser: 'Statusmeldungen und Abhängigkeiten, dazu Zeit und Rechnung.',
    keyword: 'asana alternative',
    title: 'Asana Alternative für KMU und Selbstständige | ProjectLead',
    description: 'Eine Asana Alternative für KMU und Selbstständige: Aufgaben, Gantt-Diagramm, verrechenbare Zeit, Kundenportal und Abrechnung. Kostenlos für 3 Projekte.',
    h1: 'Eine Asana Alternative, die auch Stunden zählt und die Rechnung vorbereitet',
    lede: 'Asana ist bekannt für Statusmeldungen, Portfolios, „Meine Aufgaben“ und Abhängigkeiten. ProjectLead übernimmt diese guten Ideen und ergänzt, was ein Dienstleistungsbetrieb braucht: verrechenbare Zeit, eine Statusseite für Kunden und die monatliche Abrechnung.',
    shot: 'projet', shotAlt: 'Überblick über ein Projekt in ProjectLead mit Status, Phasen und Beteiligten.',
    sections: [
      { h2: 'Was ProjectLead von Asana übernimmt', p: [
        'Statusmeldungen sagen, ob ein Projekt im Plan ist, beobachtet werden muss oder im Verzug ist. Die Ansicht „Meine Aufgaben“ sammelt, was jede Person zu tun hat, mit Fälligkeiten. Abhängigkeiten, Meilensteine, Projektvorlagen und automatische Regeln sind ebenfalls dabei.',
      ], list: ['Statusmeldungen', 'Meine Aufgaben', 'Abhängigkeiten und Meilensteine', 'Vorlagen und Automationen'] },
      { h2: 'Was ProjectLead ergänzt', shot: 'temps', alt: 'Wochen-Stundenzettel in ProjectLead.', p: [
        'Die Zeiterfassung ist eingebaut: Stoppuhr, Wochen-Stundenzettel, verrechenbare Stunden pro Projekt, Aufgabe und Person, Rentabilitätsberichte und CSV-Export. Jedes Projekt hat ein Budget in Stunden und Betrag.',
        'Der Kunde verfolgt sein Projekt auf einer öffentlichen Seite und erhält automatische Statusberichte per E-Mail. Termine bucht er online. Und jeden Monat bereitet ProjectLead einen Rechnungsentwurf pro Projekt in InvoiceLead vor, nach Stunden, pauschal oder pro gelieferter Phase.',
        'E-Mails werden verbunden (Gmail, Microsoft 365, IMAP) und eine Anfrage wird mit einem Klick zum Projekt. Das <a href="/de/gantt-diagramm-online-kostenlos">Gantt-Diagramm</a> wird durch Ziehen eines Balkens neu geplant.',
      ] },
      { h2: 'Ein KI-Assistent, der umsetzt', p: [IA] },
      { h2: 'Für wen ProjectLead gemacht ist', p: [
        'ProjectLead richtet sich an <a href="/de/projektmanagement-software-kmu">KMU</a> und <a href="/de/projektmanagement-tool-fuer-selbststaendige">Selbstständige</a>, die Projekte an Kunden verkaufen: Ingenieurbüros, Handwerk, Agenturen, Beratung. Die Oberfläche gibt es in fünf Sprachen, und der Gratis-Tarif erlaubt einen Test mit drei laufenden Projekten, ohne zeitliche Begrenzung und ohne Kreditkarte.',
        'Ziehen Sie auch monday.com in Betracht? Lesen Sie unsere Seite <a href="/de/monday-alternative">Monday Alternative</a>.',
      ] },
    ],
    faq: [
      ['Ist ProjectLead eine gute Asana Alternative?', 'Für Kundenprojekte mit Zeit, Kundeninformation und Abrechnung an einem Ort, ja. ProjectLead übernimmt die Stärken von Asana bei der Aufgabenverwaltung.'],
      ['Gibt es eine kostenlose Version?', 'Ja, für drei laufende Projekte und eine Person, mit allen Funktionen.'],
      ['Wie viele Personen passen in ein Team?', 'Bis zu fünf Personen im Pro+-Tarif, 39 € pro Monat oder 390 € pro Jahr, zuzüglich Steuern.'],
      ['Lässt sich ProjectLead mit einem CRM verbinden?', 'Ja, mit CRMlead, ohne Schlüssel: Ein gewonnener Auftrag wird zum Projekt. Eine REST-API steht für Ihre anderen Werkzeuge bereit.'],
    ],
  },
}

export default { ui, offers, plans, home, pages }
