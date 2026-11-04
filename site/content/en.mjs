// English texts of the public site. Facts from the ProjectLead code (server/lib/plans.ts, docs/FONCTIONNALITES.md,
// docs/ASSISTANT-ACTIONS.md): nothing invented, no competitor prices, no em dash.
import { img, tourView } from './fr.mjs'

const ui = {
  skip: 'Skip to content', brandLabel: 'ProjectLead, home', navLabel: 'Main navigation', langLabel: 'Language',
  nav: { features: 'Features', client: 'Client portal', pricing: 'Pricing', guides: 'Guides' },
  login: 'Log in', signup: 'Create my account', signupFree: 'Create my free account', seeFeatures: 'See the features',
  fine: 'Free for 3 ongoing projects, no credit card and no time limit.',
  shotCaption: 'Screenshot of the app (French interface). The company, its clients and projects are fictional.',
  crumbs: 'Breadcrumb', faqMeta: 'Questions', faqTitle: 'Frequently asked questions', moreGuides: 'More ProjectLead guides',
  startMeta: 'Get started', finalTitle: 'Your next project starts here.', backHome: 'Back to home',
  footGuides: 'Guides', footSuite: 'The Lead suite', footHome: 'Home', privacy: 'Privacy', terms: 'Terms of use',
  footPart: 'ProjectLead is part of the Lead apps.',
  ogAlt: 'ProjectLead: the project you sold, delivered on time. Screenshot of the app home screen.',
}

const offers = {
  free: 'Free', freeDesc: '3 ongoing projects, 1 person, all features, no time limit',
  proDesc: 'Unlimited projects, 1 person, EUR 19 per month or EUR 190 per year, excl. tax',
  proPlusDesc: 'Unlimited projects, up to 5 people, EUR 39 per month or EUR 390 per year, excl. tax',
}

const plans = {
  title: 'Start for free. Move to Pro when your projects multiply.',
  free: 'Free', freeBig: '3 ongoing projects',
  freeList: ['1 person', 'All features', 'AI Assistant, about 10 requests a month', 'No time limit'],
  proBig: 'Unlimited projects', proList: ['1 person', 'All features', 'For the freelancer running several projects'],
  proPlusBig: 'Unlimited projects', proPlusList: ['Up to 5 people', 'All features', 'For the team sharing one schedule'],
  start: 'Get started',
  foot: 'Pro costs EUR 19 per month or EUR 190 per year, Pro+ EUR 39 per month or EUR 390 per year, excluding tax. You choose the plan inside ProjectLead (Settings, Company) and it applies to ProjectLead only. Finished and archived projects, templates and requests to qualify do not count. A limit only stops you from opening one more project; it never blocks your data.',
}

const homeFaq = [
  ['Is ProjectLead really free?', 'Yes. The Free plan gives you every feature for 3 ongoing projects at a time and one person, with no time limit and no credit card. A finished or archived project frees its slot.'],
  ['Is ProjectLead suitable for freelancers?', 'Yes. A freelancer can run projects, hours and appointments alone. Pro opens unlimited projects for one person; Pro+ welcomes up to 5 people.'],
  ['Do I need CRMlead or InvoiceLead?', 'No. ProjectLead works on its own. Connected to CRMlead it receives won deals; connected to InvoiceLead it prepares invoice drafts. They connect through the same account, with no API key.'],
  ['What does the AI Assistant do?', 'It answers questions about your projects, opens the right screen and prepares changes, such as a full project plan with stages, tasks, milestones and dependencies. Everything shows on a "To confirm" card: one click on "Confirm" applies it, with your permissions.'],
  ['How do I sign in?', 'With your ERPlead account, the account shared by all Lead apps. If you do not have one, it is created on your first visit, without a credit card.'],
  ['Do my clients need an account?', 'No. They follow their project through a personal link and book appointments on a public page.'],
  ['Which mailboxes can I connect?', 'Gmail, Microsoft 365 and any IMAP mailbox, such as iCloud or your hosting provider.'],
  ['Which languages are available?', 'English, French, German, Italian and Spanish. Each person picks a language, and each project can have its own language for client documents.'],
]

const home = {
  title: 'ProjectLead, project management software for small business',
  description: 'Online project management: stages, Gantt chart, tasks, time tracking, client portal and invoicing with InvoiceLead. Free for 3 ongoing projects.',
  faq: homeFaq,
  body: ({ signup, plans, faq, guides }) => `
  <section class="wrap hero" aria-labelledby="titre">
    <p class="meta" data-reveal>Project management software for small businesses and freelancers</p>
    <h1 id="titre" data-reveal style="--d:1">The project you sold, delivered on time. <span>No lost hours.</span></h1>
    <div class="hero-row">
    <p class="lede" data-reveal style="--d:2">ProjectLead takes over once the deal is signed. Stages, schedule, tasks, time, emails and appointments in one place. Your client follows progress on their own page, and the month's hours go to InvoiceLead for the invoice.</p>
    <div class="hero-act" data-reveal style="--d:3">
    <div class="ctas">
      <a class="btn btn-fill btn-lg" href="${signup}" rel="nofollow">Create my free account</a>
      <a class="btn btn-line btn-lg" href="#fonctions">See the features</a>
    </div>
    <p class="fine">Free for 3 ongoing projects, no credit card. Sign in with your ERPlead account, shared by all Lead apps.</p>
    </div>
    </div>
    <figure class="stage" aria-label="The ProjectLead home screen, with a fictional company">
      <div class="frame frame-hero">
        <div class="frame-bar" aria-hidden="true"><span class="sq sq-s">PL</span><span class="url">projectlead.io</span><span class="bar-fill"></span></div>
        <picture>
          <source media="(max-width: 600px)" type="image/avif" srcset="/media/accueil/accueil-tel-860.avif">
          <source media="(max-width: 600px)" type="image/webp" srcset="/media/accueil/accueil-tel-860.webp">
          <source type="image/avif" srcset="/media/accueil/accueil-1280.avif 1280w, /media/accueil/accueil-2400.avif 2400w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)">
          <img src="/media/accueil/accueil-1280.webp" srcset="/media/accueil/accueil-1280.webp 1280w, /media/accueil/accueil-2400.webp 2400w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)" width="1440" height="900" alt="ProjectLead home screen: today's tasks, followed projects with their progress, the week's time and appointments." fetchpriority="high" decoding="async">
        </picture>
      </div>
      <div class="chip chip-crm" aria-hidden="true"><span class="sq" style="background:var(--cl)">CL</span><span><b>Deal won in CRMlead</b>Les Tilleuls residence, CHF <span data-count="186400">186,400</span></span></div>
      <div class="chip chip-stage" aria-hidden="true"><span class="tag tag-ok">Done</span><span><b>Scaffolding and protection</b>The client is notified by email</span></div>
      <div class="chip chip-timer" aria-hidden="true"><span class="dot"></span><span><b>North facade insulation</b><span class="mono" data-timer="2832">0:47:12</span></span></div>
      <div class="chip chip-il" aria-hidden="true"><span class="sq" style="background:var(--il)">IL</span><span><b>InvoiceLead draft</b>September, CHF <span data-count="41000">41,000</span></span></div>
      <figcaption class="cap">Screenshots of the app (French interface). The company, its clients and projects are fictional.</figcaption>
    </figure>
  </section>

  <section class="wrap" aria-label="ProjectLead in numbers">
    <div class="stats">
      <div class="stat" data-reveal><b data-count="4">4</b><span>views of the same tasks: board, list, Gantt, calendar</span></div>
      <div class="stat" data-reveal style="--d:1"><b data-count="4">4</b><span>ways to bill: hourly, monthly, per stage, fixed price</span></div>
      <div class="stat" data-reveal style="--d:2"><b data-count="3">3</b><span>ongoing projects free, with no time limit</span></div>
      <div class="stat" data-reveal style="--d:3"><b data-count="5">5</b><span>languages: English, French, German, Italian, Spanish</span></div>
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="relais-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">The handover</p>
      <h2 id="relais-titre">The signed deal becomes a project. The project becomes an invoice.</h2>
      <p>ProjectLead sits between sales and billing. It receives the won deal from CRMlead and prepares the invoice in InvoiceLead.</p>
    </div>
    <div class="chain" data-reveal>
      <div class="link" style="--c:var(--cl);--i:0"><div class="who"><span class="sq" style="background:var(--cl)">CL</span>CRMlead</div><div class="verb">Win</div><div class="doc"><b>Les Tilleuls residence</b>Deal signed, CHF 186,400</div></div>
      <div class="link link-pl" style="--c:var(--accent);--i:1"><div class="who"><span class="sq sq-pl">PL</span>ProjectLead</div><div class="verb">Deliver</div><div class="doc"><b>Energy renovation</b>6 stages, 13 tasks, 5 people</div></div>
      <div class="link" style="--c:var(--il);--i:2"><div class="who"><span class="sq" style="background:var(--il)">IL</span>InvoiceLead</div><div class="verb">Bill</div><div class="doc"><b>September draft</b>2 stages delivered, CHF 41,000</div></div>
    </div>
    <p class="chain-foot">Fictional example. ProjectLead also works on its own, without CRMlead or InvoiceLead.</p>
  </section>

  <section id="fonctions" class="wrap sec" aria-labelledby="fonctions-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">Features</p>
      <h2 id="fonctions-titre">The whole project, from the first task to the last hour.</h2>
      <p>What the big project management tools do well, built for a small business or a freelancer: easy to learn, complete when the project grows.</p>
    </div>
    <div class="tour">
      <div class="tour-steps">
        <article class="step" data-step="projet" data-hl="17.3,44.1,55.4,20">
          <p class="meta">Overview</p>
          <h3>Every project has its stages, people and budget.</h3>
          <p>Progress at a glance: tasks done, time spent against budget, current stage. Each team member has a role and a rate on the project.</p>
          <ul class="dash"><li>Status updates: on track, at risk, late</li><li>Budget in hours and amount</li><li>Templates to open a project in one click</li></ul>
          ${img('projet', 'Overview of a renovation project: tasks, time spent, amount per stage, dated stages and team members.', ' style="--cx:45;--cy:54.1;--s:1.6"')}
        </article>
        <article class="step" data-step="gantt" data-hl="58.2,82.4,33.2,13">
          <p class="meta">Gantt</p>
          <h3>The whole schedule on one screen.</h3>
          <p>Stages, tasks, milestones and dependencies on one timeline. Drag a bar to reschedule; the today line stays in view. <a href="/en/gantt-chart-software-free-online">More on the Gantt chart</a>.</p>
          <ul class="dash"><li>Day, week and month scales</li><li>Blocked tasks flagged</li><li>Milestones for the dates that matter</li></ul>
          ${img('gantt', 'Project Gantt chart: stages, finished tasks in green, ongoing tasks in ochre, dependencies and the today line.', ' style="--cx:74.8;--cy:88.9;--s:1.9"')}
        </article>
        <article class="step" data-step="tableau" data-hl="37.1,42.5,18.5,10.7">
          <p class="meta">Board</p>
          <h3>The whole team on the same tasks.</h3>
          <p>Board, list, Gantt or calendar: four views of the same tasks. Everyone sees what to do, with due dates and priorities.</p>
          <ul class="dash"><li>Subtasks, checklists, comments with @mentions</li><li>Swimlanes by stage or by person</li><li>Recurring tasks and attached files</li></ul>
          ${img('tableau', 'Kanban board of the project: To do, In progress, In review and Done columns, cards with due dates, priorities and assignees.', ' style="--cx:46.4;--cy:47.9;--s:2.2"')}
        </article>
        <article class="step" data-step="temps" data-hl="17.3,29.4,81,47.3">
          <p class="meta">Time</p>
          <h3>Every hour finds its project.</h3>
          <p>The timer runs while you work and the weekly timesheet fills itself. Billable hours add up per project, task and person. <a href="/en/project-management-software-with-time-tracking">Time tracking in detail</a>.</p>
          <ul class="dash"><li>Timer and weekly timesheet</li><li>Time and profitability reports</li><li>CSV export for your accountant</li></ul>
          ${img('temps', 'Weekly timesheet: hours per project and task, daily total against capacity.', ' style="--cx:57.8;--cy:53;--s:1.5"')}
        </article>
        <article class="step" data-step="emails" data-hl="44.8,17.5,53.6,38">
          <p class="meta">Email</p>
          <h3>A request becomes a project.</h3>
          <p>Connect Gmail, Microsoft 365 or any mailbox. An email from a known client joins its project on its own. A new request becomes a project in one click, with the client created and the first task ready.</p>
          <ul class="dash"><li>Any IMAP mailbox</li><li>Link to a project, turn into a task or reply</li><li>A mailbox shared with the team</li></ul>
          ${img('emails', 'Inbox: an open quote request with the buttons Create a project, Link to a project, Reply and Dismiss.', ' style="--cx:71.6;--cy:36.5;--s:1.6"')}
        </article>
        <article class="step" data-step="charge" data-hl="17.3,17.4,81,42.4">
          <p class="meta">Workload</p>
          <h3>See who is overloaded before it happens.</h3>
          <p>Each person's workload, week by week, against their capacity. Spread the work before the schedule slips.</p>
          <ul class="dash"><li>Weekly capacity per person</li><li>Teams, roles and hourly rates</li></ul>
          ${img('charge', 'Team workload per week, in hours and percent of capacity, from green to red.', ' style="--cx:57.8;--cy:38.6;--s:1.5"')}
        </article>
        <article class="step" data-step="facturation" data-hl="17.2,62.4,81.1,17.9">
          <p class="meta">Billing</p>
          <h3>Hours go to InvoiceLead.</h3>
          <p>Each month ProjectLead prepares one invoice draft per project: hourly, monthly fixed fee, per delivered stage or fixed price. You review and issue the invoice from InvoiceLead.</p>
          <ul class="dash"><li>Billed time is locked</li><li>Never two drafts for the same month</li></ul>
          ${img('facturation', "Monthly billing: a preview per project, lines of hours and stages, and the Create drafts in InvoiceLead button.", ' style="--cx:57.75;--cy:71.35;--s:1.5"')}
        </article>
      </div>
      ${tourView([['projet', 'Overview'], ['gantt', 'Gantt'], ['tableau', 'Board'], ['temps', 'Time'], ['emails', 'Email'], ['charge', 'Workload'], ['facturation', 'Billing']], 'projectlead.io/projets')}
    </div>
  </section>

  <section id="client" class="wrap sec" aria-labelledby="client-titre">
    <div class="client">
      <div class="client-text">
        <div class="sec-head" data-reveal><p class="meta">Client portal</p><h2 id="client-titre">Your client follows the project, without creating an account.</h2></div>
        <div class="points">
          <div class="point" data-reveal><h3>A tracking page per project</h3><p>Progress, stages, latest shared notes and files. The client can write to the team. You choose what they see.</p></div>
          <div class="point" data-reveal style="--d:1"><h3>Updates go out on their own</h3><p>Every week, every two weeks, every month or at each finished stage: the client gets a clear email you did not have to write.</p></div>
          <div class="point" data-reveal style="--d:2"><h3>Online booking</h3><p>Public booking pages, round-robin hosts, slots blocked by your external calendars. An appointment can open a project.</p></div>
        </div>
      </div>
      <div class="phones" data-reveal>
        <figure class="phone phone-scroll"><div class="phone-screen"><div class="phone-track"><picture><source type="image/avif" srcset="/media/accueil/portail-640.avif"><img src="/media/accueil/portail-640.webp" width="640" height="3628" alt="Tracking page seen by the client on a phone: 33% progress, finished and ongoing stages, team notes." loading="lazy" decoding="async"></picture></div></div><figcaption>Tracking page</figcaption></figure>
        <figure class="phone phone-b"><div class="phone-screen"><picture><source type="image/avif" srcset="/media/accueil/rdv-640.avif"><img src="/media/accueil/rdv-640.webp" width="640" height="1388" alt="Booking page: a one-hour technical visit, choice of day and free time slots." loading="lazy" decoding="async"></picture></div><figcaption>Online booking</figcaption></figure>
      </div>
    </div>
  </section>

  <section id="assistant" class="wrap sec" aria-labelledby="ia-titre">
    <div class="sec-head" data-reveal>
      <p class="meta">AI Assistant</p>
      <h2 id="ia-titre">An assistant that prepares the work. You confirm in one click.</h2>
      <p>The AI Assistant built into ProjectLead knows your projects. It answers, opens the right screen and prepares changes; nothing is written until you click "Confirm".</p>
    </div>
    <div class="more" data-reveal>
      <div class="more-item"><h3>It answers</h3><p>Where a project stands, which tasks are late, how many hours this month: it reads your data, with your permissions.</p></div>
      <div class="more-item"><h3>It drafts a plan</h3><p>A full project plan: stages, tasks, milestones, dependencies and dates, shown in full on a single card.</p></div>
      <div class="more-item"><h3>It applies in one click</h3><p>A "To confirm" card shows every change. "Confirm" applies it through the same checks as the screen.</p></div>
      <div class="more-item"><h3>Nothing leaves without you</h3><p>The assistant never emails your clients. It is included in every plan, Free included.</p></div>
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="suite-titre">
    <div class="sec-head" data-reveal><p class="meta">With the Lead apps</p><h2 id="suite-titre">One account. Information flows from one app to the next.</h2></div>
    <div class="flows" data-reveal>
      <div class="flow"><span class="who"><span class="sq" style="background:var(--cl)">CL</span>CRMlead</span><span class="arrow" aria-hidden="true"></span><span class="who"><span class="sq sq-pl">PL</span>ProjectLead</span><p>A won deal arrives as a project, with the client, address and contacts.</p></div>
      <div class="flow"><span class="who"><span class="sq sq-pl">PL</span>ProjectLead</span><span class="arrow" aria-hidden="true"></span><span class="who"><span class="sq" style="background:var(--il)">IL</span>InvoiceLead</span><p>Each month, hours and delivered stages become an invoice draft.</p></div>
      <div class="flow"><span class="who"><span class="sq sq-el">EL</span>ERPlead</span><span class="arrow" aria-hidden="true"></span><span class="who apps"><span class="sq" style="background:var(--sl)">SL</span><span class="sq" style="background:var(--cl)">CL</span><span class="sq sq-pl">PL</span><span class="sq" style="background:var(--il)">IL</span></span><p>The same account opens every Lead app. No new password, no key to paste to connect them.</p></div>
    </div>
    <div class="more" data-reveal>
      <div class="more-item"><h3>Project templates</h3><p>Reusable stages, tasks and checklists, with dates shifted to the project start.</p></div>
      <div class="more-item"><h3>Automations</h3><p>When a task is done, the stage follows. "When... then..." rules do the rest.</p></div>
      <div class="more-item"><h3>Request forms</h3><p>A public form that opens a project to qualify as soon as a client fills it in.</p></div>
      <div class="more-item"><h3>Calendars</h3><p>Your appointments in Google Calendar, Outlook or Apple, invitations sent with an .ics file.</p></div>
      <div class="more-item"><h3>Reports</h3><p>Hours, billable amounts, costs and margin per project, client or person.</p></div>
      <div class="more-item"><h3>REST API</h3><p>Your projects, tasks and hours available to your other tools, with an API key.</p></div>
      <div class="more-item"><h3>Team</h3><p>Roles, teams, rates and capacity. A project can be restricted to its members.</p></div>
      <div class="more-item"><h3>Five languages</h3><p>English, French, German, Italian and Spanish, and a document language per project.</p></div>
    </div>
  </section>

  <section id="tarifs" class="wrap sec" aria-labelledby="tarifs-titre">
    <div class="sec-head" data-reveal><p class="meta">Pricing</p><h2 id="tarifs-titre">${plans_title}</h2><p>Every feature is in every plan. Only the quantities change.</p></div>
    ${plans}
  </section>

  <section id="guides" class="wrap sec" aria-labelledby="guides-titre">
    <div class="sec-head" data-reveal><p class="meta">Guides</p><h2 id="guides-titre">Find the right tool for your projects.</h2><p>Free software, small business, freelancers, Gantt charts, time tracking or an alternative to a known tool: what ProjectLead does for each.</p></div>
    ${guides}
  </section>

  <section id="questions" class="wrap sec" aria-labelledby="questions-titre">
    <div class="sec-head" data-reveal><p class="meta">Questions</p><h2 id="questions-titre">What people ask us most.</h2></div>
    <div class="faq" data-reveal>
      ${faq}
    </div>
  </section>

  <section class="wrap sec" aria-labelledby="final-titre">
    <div class="final" data-reveal>
      <div>
        <p class="meta">Get started</p>
        <h2 id="final-titre">Your next project starts here.</h2>
        <div class="ctas"><a class="btn btn-fill btn-lg" href="${signup}" rel="nofollow">Create my free account</a><a class="btn btn-line btn-lg" href="/login" rel="nofollow">Log in</a></div>
        <p class="fine">Free for 3 ongoing projects, no credit card.</p>
      </div>
      <div class="final-art" aria-hidden="true"><div class="gantt-art"><span style="--x:0;--w:34;--r:0"></span><span style="--x:22;--w:30;--r:1"></span><span style="--x:44;--w:36;--r:2"></span><span style="--x:62;--w:26;--r:3"></span><span style="--x:78;--w:22;--r:4"></span></div></div>
    </div>
  </section>`,
}
const plans_title = plans.title

const IA = 'The built-in AI Assistant prepares the work for you: it can propose a full project plan (stages, tasks, milestones, dependencies and dates) or a batch of changes, shown in full on a "To confirm" card. One click on "Confirm" applies it with your permissions; the assistant never sends an email to your clients.'

const pages = {
  free: {
    nav: 'Free project management software', kicker: 'Free', teaser: 'Every feature for 3 ongoing projects, with no time limit.',
    keyword: 'free project management software',
    title: 'Free project management software, all features | ProjectLead',
    description: 'ProjectLead is free project management software: Gantt chart, tasks, time tracking and client portal for 3 ongoing projects, no credit card, no time limit.',
    h1: 'Free project management software with nothing held back',
    lede: 'ProjectLead gives you every feature in the Free plan: stages, Gantt chart, tasks, time tracking, email, appointments and a tracking page for your clients. The only limit is the number of ongoing projects: three at a time.',
    shot: 'projet', shotAlt: 'Overview of a project in ProjectLead: tasks, time spent, amount per stage and team members.',
    sections: [
      { h2: 'What the Free plan includes', p: [
        'Many free tools remove the features that matter: the Gantt chart, time tracking or the client portal. ProjectLead does the opposite. The Free plan has exactly the same screens as the paid plans; only the quantities change.',
        'You run three ongoing projects at a time, on your own. A finished, abandoned or archived project no longer counts and frees its slot. Project templates and requests to qualify do not count either. There is no trial that expires and no credit card to enter.',
      ], list: ['Dated stages, milestones and dependencies', 'Four task views: board, list, Gantt, calendar', 'Timer, timesheet and reports', 'Gmail, Microsoft 365 and IMAP email', 'Client tracking page and booking pages', 'AI Assistant, about 10 requests a month'] },
      { h2: 'Real software, not a shared spreadsheet', shot: 'gantt', alt: 'ProjectLead Gantt chart with stages, tasks, dependencies and the today line.', p: [
        'A free spreadsheet can list tasks, but it warns nobody when a deadline slips. In ProjectLead every project has stages and a budget in hours and amount; status reads at a glance: on track, at risk or late.',
        'The <a href="/en/gantt-chart-software-free-online">online Gantt chart</a> reschedules when you drag a bar. Tasks have subtasks, checklists, comments with @mentions, files and priorities. Recurring tasks come back daily, weekly or monthly on their own.',
      ] },
      { h2: 'Time and invoicing, even on the free plan', p: [
        'The timer runs while you work and the weekly timesheet fills up. Billable hours add up per project, task and person, and a CSV export goes to your accountant. See <a href="/en/project-management-software-with-time-tracking">project management software with time tracking</a> for details.',
        'If your company also uses InvoiceLead with the same account, ProjectLead prepares one invoice draft per project every month. The connection needs no key and costs nothing extra, on every plan.',
      ] },
      { h2: 'An AI assistant that applies its suggestions', p: [IA, 'On the Free plan, the assistant is available for the equivalent of about ten requests per month per company.'] },
      { h2: 'When to move to a paid plan', p: [
        'As long as three ongoing projects are enough, you can stay on Free for as long as you like. When projects multiply, Pro opens unlimited projects for one person, a good fit for <a href="/en/project-management-software-for-freelancers">freelancers</a>. Pro+ welcomes up to five people sharing one schedule, as in a <a href="/en/project-management-software-for-small-business">small business</a>.',
        'A limit never deletes or blocks your data: it only stops you from opening one more project. So you can start for free with no risk for later.',
      ] },
    ],
    faq: [
      ['Does the Free plan expire?', 'No. The Free plan has no time limit: it stays free as long as you run at most three ongoing projects and work alone.'],
      ['Do I need a credit card?', 'No. The ERPlead account that opens ProjectLead is created without a credit card.'],
      ['Which features are missing on Free?', 'None. Every feature is in every plan; only the number of ongoing projects, the number of people and the AI Assistant volume change.'],
      ['What happens with a fourth project?', 'ProjectLead suggests finishing or archiving a project, or moving to Pro. Your existing projects stay visible and editable.'],
    ],
  },
  smb: {
    nav: 'Project management software for small business', kicker: 'Small business', teaser: 'Schedule, team, time and clients for a team of 2 to 5.',
    keyword: 'project management software for small business',
    title: 'Project management software for small business | ProjectLead',
    description: 'Project management software for small business: stages, Gantt, team workload, billable hours and a client portal in one tool. Free for 3 ongoing projects.',
    h1: 'Project management software for small business, from signed deal to invoice',
    lede: 'A small business has no project office. It needs a tool learned in an hour, that the whole team really uses, and that follows the project from the signed deal to the invoice. That is what ProjectLead does.',
    shot: 'tableau', shotAlt: 'ProjectLead kanban board: To do, In progress, In review and Done columns with due dates and assignees.',
    sections: [
      { h2: 'What a small business needs from project software', p: [
        'In a small company, the same person sells, plans, works on the project and sends the invoice. Information is scattered across the inbox, a spreadsheet and a notebook of hours. ProjectLead brings it together: the project, its stages, tasks, hours, emails and appointments in one place.',
        'Nothing has to be configured before you start: a project opens from a template with its stages and tasks ready, and dates shift to the start date.',
      ], list: ['Projects with stages, budget and members', 'Roles: admin, manager, member', 'Teams, hourly rates and capacity', 'Projects restricted to their members'] },
      { h2: 'Team workload, week by week', shot: 'charge', alt: 'Team workload per week against each person\'s capacity.', p: [
        'The Workload view shows each person\'s planned hours, week by week, against their capacity. You see who is overloaded before it happens and spread the work before the schedule slips.',
        'The shared <a href="/en/gantt-chart-software-free-online">Gantt chart</a> shows stages, tasks, milestones and dependencies on one timeline. Everyone sees their own tasks in "My tasks", with due dates and priorities.',
      ] },
      { h2: 'Clients informed without phone calls', p: [
        'Each project can have a public tracking page opened by a personal link: the client sees progress, stages, shared notes and files, and can write to the team. You choose what is visible.',
        'Updates can go out by email on their own, weekly, every two weeks, monthly or at each finished stage. Public booking pages let clients pick a slot, and several hosts can share appointments in rotation.',
      ] },
      { h2: 'Hours and invoicing', p: [
        'Time is logged with the timer or in the weekly timesheet. Reports give hours, billable amounts, costs and margin per project, client or person. Read more on <a href="/en/project-management-software-with-time-tracking">time tracking</a>.',
        'With InvoiceLead, each month produces one invoice draft per project: hourly, monthly fixed fee, per delivered stage or fixed price. Billed time is locked, and two drafts are never created for the same month.',
      ] },
      { h2: 'The AI Assistant saves time', p: [IA, 'For a small business, that means the plan for a new job ready in seconds, to review before you confirm.'] },
      { h2: 'What ProjectLead costs a small business', p: [
        'To start, the Free plan is enough: three ongoing projects, one person, every feature. Pro+ welcomes up to five people with unlimited projects for EUR 39 per month or EUR 390 per year, excluding tax. The plan is taken inside ProjectLead and applies to ProjectLead only.',
      ] },
    ],
    faq: [
      ['How many people can use ProjectLead?', 'One person on Free and Pro, up to five on Pro+.'],
      ['Is the software translated?', 'Yes: English, French, German, Italian and Spanish. Each person picks a language.'],
      ['Can we connect the company mailbox?', 'Yes: Gmail, Microsoft 365 and any IMAP mailbox. A mailbox can be shared with the team.'],
      ['Do our clients need to install anything?', 'No. They open their tracking or booking page in the browser, without an account.'],
    ],
  },
  gantt: {
    nav: 'Gantt chart software, free online', kicker: 'Gantt', teaser: 'Stages, milestones and dependencies, rescheduled by dragging a bar.',
    keyword: 'gantt chart software free online',
    title: 'Gantt chart software free online | ProjectLead',
    description: 'Gantt chart software free online: stages, tasks, milestones and dependencies, rescheduled with the mouse and shared with your team. No download, no card.',
    h1: 'Gantt chart software free online, connected to your tasks',
    lede: 'In ProjectLead the Gantt chart is not a separate drawing: it is a view of the project\'s real tasks. What you drag on the timeline changes the task dates, and the whole team sees it right away.',
    shot: 'gantt', shotAlt: 'Gantt chart in ProjectLead: stages, finished tasks in green, ongoing tasks in ochre and the today line.',
    sections: [
      { h2: 'A Gantt chart in the browser, nothing to install', p: [
        'ProjectLead runs in the browser, on a computer or a tablet. There is nothing to download: open your account, create a project, and the Gantt chart is there. The Free plan includes it for three ongoing projects, with no time limit.',
        'The chart shows the project stages, their tasks and milestones on one timeline. The scale switches between day, week and month, and the today line stays in view.',
      ], list: ['Drag a bar to move its dates', 'Pull the right edge to change the due date', 'One click opens the task', 'Undated tasks listed separately'] },
      { h2: 'Dependencies and milestones', p: [
        'A task can wait for another one to finish: the dependency is drawn and the blocked task is flagged. Milestones mark the dates that matter, such as a delivery or a handover.',
        'Each stage has start and end dates, an amount and its people. Colors show the status: done, in progress, late. You see what slips before the client notices.',
      ] },
      { h2: 'The Gantt chart is one of four views', shot: 'tableau', alt: 'The same tasks as a kanban board in ProjectLead.', p: [
        'The same tasks also appear as a kanban board, a list and a calendar. Whoever prefers columns works on the board, the project manager watches the Gantt chart: everyone sees the same data.',
        'For a team, the Workload view completes the Gantt chart with each person\'s hours against capacity. That makes ProjectLead a fit for a <a href="/en/project-management-software-for-small-business">small business</a> as well as for <a href="/en/project-management-software-for-freelancers">freelancers</a>.',
      ] },
      { h2: 'A schedule drafted by the AI Assistant', p: [IA, 'The proposed plan then appears in the Gantt chart like any other: you can still reschedule it with the mouse.'] },
      { h2: 'Free, and more when you need it', p: [
        'The Gantt chart is part of every plan. Beyond three ongoing projects, Pro opens unlimited projects for one person and Pro+ for a team of up to five. See also our page on <a href="/en/free-project-management-software">free project management software</a>.',
      ] },
    ],
    faq: [
      ['Is the Gantt chart really free?', 'Yes, on the Free plan, for three ongoing projects at a time, with no time limit.'],
      ['Do I need to download software?', 'No. ProjectLead is used online, in the browser.'],
      ['Can I manage task dependencies?', 'Yes. A task can depend on another; a blocked task is flagged.'],
      ['Can my client see the schedule?', 'They see the progress and the stages you make visible on their tracking page, without an account.'],
    ],
  },
  time: {
    nav: 'Project management software with time tracking', kicker: 'Time', teaser: 'Timer, weekly timesheet and monthly invoice drafts.',
    keyword: 'project management software with time tracking',
    title: 'Project management software with time tracking | ProjectLead',
    description: 'Project management software with time tracking: timer, billable hours per project and a monthly invoice draft in InvoiceLead. Free for 3 ongoing projects.',
    h1: 'Project management software with time tracking built in',
    lede: 'Hours written in a notebook often get forgotten at invoicing time. ProjectLead connects the timesheet to projects and tasks, then prepares one invoice draft per project every month in InvoiceLead.',
    shot: 'temps', shotAlt: 'Weekly timesheet in ProjectLead: hours per project and task, daily total against capacity.',
    sections: [
      { h2: 'Track time without thinking about it', p: [
        'Start the timer on a task when you begin and stop it when you switch. Prefer to log afterwards? The weekly timesheet shows each day, project by project, with the total against your capacity.',
        'Each entry is linked to a project and, if you wish, a task. It is billable or not and takes the person\'s rate on that project.',
      ], list: ['Timer on a task', 'Weekly timesheet', 'Billable or non-billable hours', 'Rate per person and per project'] },
      { h2: 'Time and profitability reports', p: [
        'Reports give hours, billable amounts, costs and margin per project, client or person. You see which project is over its hour budget before it is too late.',
        'A CSV export of the month or of a report goes to your accountant. Each project\'s budget, in hours and amount, stays visible next to the time spent.',
      ] },
      { h2: 'From timesheet to invoice', shot: 'facturation', alt: 'Monthly billing in ProjectLead: a preview per project and the Create drafts in InvoiceLead button.', p: [
        'Each month ProjectLead prepares one invoice draft per project in InvoiceLead, the invoicing app of the Lead suite. Four billing methods are available: hourly (the month\'s time, one line per task and rate), monthly fixed fee, per delivered stage or a fixed price at the end.',
        'Drafts are created by hand or automatically on the chosen day. Billed time is locked and two drafts are never created for the same month. You review the draft and issue the invoice from InvoiceLead; ProjectLead itself issues nothing.',
      ] },
      { h2: 'The AI Assistant at your side', p: [IA, 'It can tell you how many hours went into a project this month, or prepare a corrected time entry for you to confirm.'] },
      { h2: 'Who it is for', p: [
        '<a href="/en/project-management-software-for-freelancers">Freelancers</a> bill their hours without counting them twice. A <a href="/en/project-management-software-for-small-business">small business</a> sees the profitability of each project and the workload of each person. Either way, the Free plan lets you start with three ongoing projects.',
      ] },
    ],
    faq: [
      ['Do I need InvoiceLead to track time?', 'No. The timesheet and reports work on their own. InvoiceLead is only used to turn hours into invoices.'],
      ['Can I change an hour that was already billed?', 'No. Billed time is locked, which prevents gaps between the invoice and the hours.'],
      ['Is time tracking included in the Free plan?', 'Yes. Every feature is in every plan.'],
      ['Can I export hours?', 'Yes, as CSV, from the month view or from a report.'],
    ],
  },
  freelance: {
    nav: 'Project management software for freelancers', kicker: 'Freelancers', teaser: 'Projects, hours, clients and bookings for people who work alone.',
    keyword: 'project management software for freelancers',
    title: 'Project management software for freelancers | ProjectLead',
    description: 'Project management software for freelancers: projects, hours, bookings and a client portal in one tool. Free for 3 ongoing projects, Pro at EUR 19 a month.',
    h1: 'Project management software for freelancers: projects, hours, clients',
    lede: 'A freelancer is project manager, doer and bookkeeper at once. ProjectLead keeps everything in one place: projects and their stages, time spent, client emails, appointments and the monthly invoice.',
    shot: 'projet', shotAlt: 'Overview of a project in ProjectLead, with stages, time spent and budget.',
    sections: [
      { h2: 'Built for independent professionals too', p: [
        'ProjectLead serves small businesses, and people who work alone. The Free plan gives every feature for three ongoing projects and one person, with no time limit. When your assignments multiply, Pro opens unlimited projects, still for one person, at EUR 19 per month or EUR 190 per year, excluding tax.',
        'You do not need a project management method: a project, a few dated stages and tasks are enough. Templates save you from rebuilding everything for each new assignment.',
      ], list: ['Projects, stages and tasks', 'Timer and timesheet', 'Email and calendar connected', 'A tracking page for each client'] },
      { h2: 'Client requests become projects', shot: 'emails', alt: 'ProjectLead inbox: an open request with Create a project and Link to a project buttons.', p: [
        'Connect Gmail, Microsoft 365 or your IMAP mailbox. An email from a known client joins its ongoing project on its own. A new request becomes a project in one click: the client is created from the sender and a first "Reply to" task is ready.',
        'A public request form can also open a project to qualify as soon as a prospect fills it in.',
      ] },
      { h2: 'Hours billed, not forgotten', p: [
        'The timer runs while you work and every hour finds its project. If you use InvoiceLead with the same account, ProjectLead prepares one invoice draft per project each month. Everything is explained on <a href="/en/project-management-software-with-time-tracking">project management software with time tracking</a>.',
      ] },
      { h2: 'Clients follow along without calling you', p: [
        'Each client gets a link to their project tracking page: progress, stages, shared notes and files. Updates can go out by email every week or at each finished stage. Your online booking pages save the back and forth to find a slot, and busy slots from your external calendars are blocked.',
      ] },
      { h2: 'The AI Assistant as a colleague', p: [IA, 'When you work alone, that is a draft assignment plan to review instead of a blank page.'] },
    ],
    faq: [
      ['Which plan suits a freelancer?', 'Free for three ongoing projects, Pro for unlimited projects. Both are for one person.'],
      ['Can I use ProjectLead without InvoiceLead?', 'Yes. ProjectLead works on its own; InvoiceLead adds invoice drafts.'],
      ['Do my clients need an account?', 'No. They follow their project through a personal link.'],
      ['Can I work in another language?', 'Yes. The interface exists in English, French, German, Italian and Spanish.'],
    ],
  },
  monday: {
    nav: 'monday.com alternative', kicker: 'Alternative', teaser: 'Project management that also tracks time, clients and invoices.',
    keyword: 'monday alternative',
    title: 'Monday alternative for small business and freelancers | ProjectLead',
    description: 'A Monday alternative built for small businesses and freelancers: Gantt chart, time tracking, client portal and invoicing in one place. Free for 3 projects.',
    h1: 'A Monday alternative that carries the project to the invoice',
    lede: 'monday.com is a highly configurable work platform, valued for its boards, automations and forms. If you are looking for a Monday alternative focused on client projects, from signed quote to invoice, ProjectLead is worth a try.',
    shot: 'tableau', shotAlt: 'ProjectLead kanban board with columns and task cards.',
    sections: [
      { h2: 'What ProjectLead takes from Monday', p: [
        'ProjectLead draws on what users like in monday.com: "when... then..." automations, public request forms and a workload view per person and per week.',
        'Tasks appear as a board, a list, a Gantt chart and a calendar. They have subtasks, checklists, comments with @mentions and files.',
      ], list: ['"When... then..." automations', 'Public request forms', 'Workload per person', 'Four views of the same tasks'] },
      { h2: 'What ProjectLead adds for client projects', shot: 'facturation', alt: 'Monthly billing in ProjectLead, one invoice draft per project.', p: [
        'ProjectLead is built around a project sold to a client. You do not design your own boards: stages, budget in hours and amount, members with their rates and client follow-up are there from the start.',
        'Time is logged with the timer or in the weekly timesheet, and each month one invoice draft per project goes to InvoiceLead. See <a href="/en/project-management-software-with-time-tracking">project management with time tracking</a>.',
        'The client follows the project on a public page, without an account, and receives automatic email updates. They book appointments on your online booking pages.',
      ] },
      { h2: 'Email, calendars and the Lead suite', p: [
        'Gmail, Microsoft 365 and any IMAP mailbox connect directly: a client email joins its project, a new request becomes a project. With CRMlead, a won deal arrives as a project with the client and contacts. All Lead apps open with the same ERPlead account, with no key to paste to connect them.',
      ] },
      { h2: 'An AI Assistant that acts', p: [IA] },
      { h2: 'Switching tools smoothly', p: [
        'The Free plan lets you try ProjectLead on three ongoing projects with no time limit, next to your current tool. Project templates spare you from retyping everything. For a team, Pro+ welcomes up to five people. Also comparing with Asana? Read our <a href="/en/asana-alternative">Asana alternative</a> page.',
      ] },
    ],
    faq: [
      ['Can ProjectLead replace Monday?', 'For managing client projects (schedule, time, client follow-up and invoicing), yes. For other uses of monday.com, such as custom boards outside projects, each team judges by its needs.'],
      ['Is there a free version?', 'Yes: every feature for three ongoing projects and one person, with no time limit.'],
      ['Can I import from Monday?', 'ProjectLead has no direct import from monday.com. Project templates and the AI Assistant help you rebuild your projects quickly.'],
      ['Which languages does it support?', 'English, French, German, Italian and Spanish.'],
    ],
  },
  asana: {
    nav: 'Asana alternative', kicker: 'Alternative', teaser: 'Status updates and dependencies, plus time and invoicing.',
    keyword: 'asana alternative',
    title: 'Asana alternative for small business and freelancers | ProjectLead',
    description: 'An Asana alternative for small businesses and freelancers: tasks, Gantt chart, billable time, client portal and invoicing in one tool. Free for 3 projects.',
    h1: 'An Asana alternative that also counts hours and prepares the invoice',
    lede: 'Asana is known for status updates, portfolios, "My tasks" and dependencies. ProjectLead takes these good ideas and adds what a service business needs: billable time, a client tracking page and monthly invoicing.',
    shot: 'projet', shotAlt: 'Overview of a project in ProjectLead with status, stages and members.',
    sections: [
      { h2: 'What ProjectLead takes from Asana', p: [
        'Status updates say whether a project is on track, at risk or late. The "My tasks" view gathers what each person has to do, with due dates. Dependencies, milestones, project templates and automatic rules are there too.',
      ], list: ['Status updates', 'My tasks', 'Dependencies and milestones', 'Templates and automations'] },
      { h2: 'What ProjectLead adds', shot: 'temps', alt: 'Weekly timesheet in ProjectLead.', p: [
        'Time tracking is built in: timer, weekly timesheet, billable hours per project, task and person, profitability reports and CSV export. Each project has a budget in hours and amount.',
        'The client follows the project on a public page and receives automatic email updates. They book appointments online. And each month ProjectLead prepares one invoice draft per project in InvoiceLead, hourly, fixed fee or per delivered stage.',
        'Email connects (Gmail, Microsoft 365, IMAP) and a request becomes a project in one click. The <a href="/en/gantt-chart-software-free-online">Gantt chart</a> reschedules when you drag a bar.',
      ] },
      { h2: 'An AI Assistant that applies', p: [IA] },
      { h2: 'Who ProjectLead is built for', p: [
        'ProjectLead is for <a href="/en/project-management-software-for-small-business">small businesses</a> and <a href="/en/project-management-software-for-freelancers">freelancers</a> who sell projects to clients: engineering offices, trades, agencies, consultants. The interface exists in five languages and the Free plan lets you try it on three ongoing projects, with no time limit and no credit card.',
        'Also considering monday.com? See our <a href="/en/monday-alternative">Monday alternative</a> page.',
      ] },
    ],
    faq: [
      ['Is ProjectLead a good Asana alternative?', 'For running client projects with time, client follow-up and invoicing in one place, yes. ProjectLead keeps Asana\'s strengths for task management.'],
      ['Is there a free version?', 'Yes, for three ongoing projects and one person, with every feature.'],
      ['How many people can join a team?', 'Up to five people on Pro+, EUR 39 per month or EUR 390 per year, excluding tax.'],
      ['Can ProjectLead connect to a CRM?', 'Yes, to CRMlead, with no key: a won deal becomes a project. A REST API is also available for your other tools.'],
    ],
  },
}

export default { ui, offers, plans, home, pages }
