/**
 * Site public de ProjectLead servi en HTML (référencement, 04.11.2026) : accueils fr (/), en (/en), de (/de) et pages
 * mots-clés (/fr/…, /en/…, /de/…), plus robots.txt, sitemap.xml, llms.txt et une vraie page 404.
 *
 * Aucune dépendance à l'application : des pages statiques écrites au build dans `<out>/_site/` (servies par les routes
 * de scripts/vercel-build.mjs, jamais par leur chemin de fichier), styles et mouvements dans `<out>/site-assets/`,
 * images et film dans `<out>/media/`. Le visuel est celui de la page d'accueil « Trait net » (site/accueil.css).
 *
 *   node site/build.mjs <dossier de sortie>      (dist, appelé par scripts/vercel-build.mjs après vite build)
 */
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { HOME_PATH, LANGS, ORIGIN, TOPICS, pagePath } from './pages.mjs'
import fr from './content/fr.mjs'
import en from './content/en.mjs'
import de from './content/de.mjs'
import { suite } from './content/suite.mjs'
import { extra } from './content/extra.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const C = { fr, en, de }
const OG_LOCALE = { fr: 'fr_CH', en: 'en_US', de: 'de_CH' }
const X_DEFAULT = 'en'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const abs = (p) => `${ORIGIN}${p}`
const signup = (l) => `/auth/lead/start?signup=1&amp;locale=${l}`
const login = (l) => `/auth/lead/start?locale=${l}`

export function render(out) {
  // Styles et mouvements : un nom à empreinte, gardés un an.
  const css = readFileSync(join(HERE, 'accueil.css'), 'utf8') + readFileSync(join(HERE, 'site.css'), 'utf8')
  const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10)
  mkdirSync(join(out, 'site-assets'), { recursive: true })
  const cssName = `site-assets/site.${h(css)}.css`
  writeFileSync(join(out, cssName), css)
  const js = build({ entryPoints: [join(HERE, 'accueil.ts')], bundle: true, minify: true, format: 'esm', target: 'es2020', write: false })
  return js.then((r) => {
    const code = r.outputFiles[0].text
    const jsName = `site-assets/site.${h(code)}.js`
    writeFileSync(join(out, jsName), code)
    cpSync(join(HERE, 'media'), join(out, 'media'), { recursive: true })
    const assets = { css: `/${cssName}`, js: `/${jsName}` }
    const files = []
    const write = (rel, html) => { const f = join(out, '_site', rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, html); files.push(rel) }
    for (const l of LANGS) {
      write(`${l}.html`, homePage(l, assets))
      for (const t of TOPICS) write(`${l}/${t[l]}.html`, topicPage(l, t, assets))
    }
    write('404.html', notFound(assets))
    writeFileSync(join(out, 'robots.txt'), robots())
    writeFileSync(join(out, 'sitemap.xml'), sitemap())
    writeFileSync(join(out, 'llms.txt'), llms())
    return files
  })
}

/* ------------------------------------------------------------ morceaux communs */
function alternates(paths) {
  return LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs(paths[l])}">`).join('\n')
    + `\n<link rel="alternate" hreflang="x-default" href="${abs(paths[X_DEFAULT])}">`
}

function head(l, { title, description, path, paths, ld, assets, preload = '' }) {
  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${abs(path)}">
${alternates(paths)}
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#eceae7">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ProjectLead">
<meta property="og:locale" content="${OG_LOCALE[l]}">
<meta property="og:url" content="${abs(path)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ORIGIN}/media/accueil/partage.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(C[l].ui.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ORIGIN}/media/accueil/partage.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400;62..125,600;62..125,700;62..125,800;62..125,900&display=swap">
${preload}<script>document.documentElement.classList.add('js')</script>
<link rel="stylesheet" href="${assets.css}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>`
}

function header(l, paths, homeAnchors) {
  const u = C[l].ui
  const home = HOME_PATH[l]
  const a = (id) => (homeAnchors ? `#${id}` : `${home === '/' ? '' : home}/#${id}`.replace('//#', '/#'))
  const langs = LANGS.map((x) => x === l
    ? `<span class="lang is-on" aria-current="true">${x.toUpperCase()}</span>`
    : `<a class="lang" href="${paths[x]}" hreflang="${x}" lang="${x}">${x.toUpperCase()}</a>`).join('')
  return `<a class="skip" href="#contenu">${esc(u.skip)}</a>
<header class="top">
  <div class="cells">
    <a class="cell brand" href="${home}" aria-label="${esc(u.brandLabel)}"><span class="sq" aria-hidden="true">PL</span>ProjectLead</a>
    <nav class="cells-nav" aria-label="${esc(u.navLabel)}">
      <a class="cell navlink" href="${a('fonctions')}">${esc(u.nav.features)}</a>
      <a class="cell navlink" href="${a('client')}">${esc(u.nav.client)}</a>
      <a class="cell navlink" href="${a('tarifs')}">${esc(u.nav.pricing)}</a>
      <a class="cell navlink" href="${a('guides')}">${esc(u.nav.guides)}</a>
    </nav>
    <span class="grow" aria-hidden="true"></span>
    <div class="cell langs" aria-label="${esc(u.langLabel)}">${langs}</div>
    <div class="cell util">
      <a class="btn btn-line login" href="${login(l)}" rel="nofollow">${esc(u.login)}</a>
      <a class="btn btn-fill" href="${signup(l)}" rel="nofollow">${esc(u.signup)}</a>
    </div>
  </div>
</header>`
}

function footer(l) {
  const u = C[l].ui
  const guides = TOPICS.map((t) => `<li><a href="${pagePath(l, t)}">${esc(C[l].pages[t.id].nav)}</a></li>`).join('')
  const apps = suite.map((s) => `<li><a href="${s.url}">${esc(s.name)}</a><span>${esc(s.line[l])}</span></li>`).join('')
  return `<footer>
  <div class="wrap foot-grid">
    <div class="foot-col">
      <p class="foot-title">${esc(u.footGuides)}</p>
      <ul class="foot-list">${guides}</ul>
    </div>
    <div class="foot-col foot-suite">
      <p class="foot-title">${esc(u.footSuite)}</p>
      <ul class="foot-list foot-apps">${apps}</ul>
    </div>
    <div class="foot-col">
      <p class="foot-title">ProjectLead</p>
      <ul class="foot-list">
        <li><a href="${HOME_PATH[l]}">${esc(u.footHome)}</a></li>
        <li><a href="/confidentialite">${esc(u.privacy)}</a></li>
        <li><a href="/conditions">${esc(u.terms)}</a></li>
        <li><a href="${login(l)}" rel="nofollow">${esc(u.login)}</a></li>
      </ul>
      <p class="foot-langs">${LANGS.map((x) => `<a href="${HOME_PATH[x]}" hreflang="${x}" lang="${x}">${{ fr: 'Français', en: 'English', de: 'Deutsch' }[x]}</a>`).join('')}</p>
    </div>
  </div>
  <div class="wrap foot">
    <span>&copy; 2026 Quantum Liquid LLC, 30 N Gould St, Sheridan, WY 82801, USA. ${esc(u.footPart)}</span>
  </div>
</footer>`
}

const org = { '@type': 'Organization', '@id': `${ORIGIN}/#org`, name: 'Quantum Liquid LLC', url: ORIGIN + '/',
  address: { '@type': 'PostalAddress', streetAddress: '30 N Gould St', addressLocality: 'Sheridan', addressRegion: 'WY', postalCode: '82801', addressCountry: 'US' } }

function offers(l) {
  const o = C[l].offers
  return [
    { '@type': 'Offer', name: o.free, price: '0', priceCurrency: 'EUR', description: o.freeDesc },
    { '@type': 'Offer', name: 'Pro', price: '19', priceCurrency: 'EUR', description: o.proDesc,
      priceSpecification: { '@type': 'UnitPriceSpecification', price: '19', priceCurrency: 'EUR', unitCode: 'MON', valueAddedTaxIncluded: false } },
    { '@type': 'Offer', name: 'Pro+', price: '39', priceCurrency: 'EUR', description: o.proPlusDesc,
      priceSpecification: { '@type': 'UnitPriceSpecification', price: '39', priceCurrency: 'EUR', unitCode: 'MON', valueAddedTaxIncluded: false } },
  ]
}

const faqLd = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) })
const faqHtml = (faq, openFirst = true) => faq.map(([q, a], i) => `<details${i === 0 && openFirst ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ')

function plansHtml(l) {
  const p = C[l].plans
  return `<div class="plans">
      <div class="plan plan-free">
        <p class="plan-name">${esc(p.free)}</p>
        <p class="plan-big">${esc(p.freeBig)}</p>
        <ul class="dash">${p.freeList.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <a class="btn btn-fill" href="${signup(l)}" rel="nofollow">${esc(C[l].ui.signup)}</a>
      </div>
      <div class="plan">
        <p class="plan-name">Pro</p>
        <p class="plan-big">${esc(p.proBig)}</p>
        <ul class="dash">${p.proList.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <a class="btn btn-line" href="${signup(l)}" rel="nofollow">${esc(p.start)}</a>
      </div>
      <div class="plan">
        <p class="plan-name">Pro+</p>
        <p class="plan-big">${esc(p.proPlusBig)}</p>
        <ul class="dash">${p.proPlusList.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <a class="btn btn-line" href="${signup(l)}" rel="nofollow">${esc(p.start)}</a>
      </div>
    </div>
    <p class="plans-foot">${esc(p.foot)}</p>`
}

function guidesHtml(l, exceptId) {
  return `<div class="guides">${TOPICS.filter((t) => t.id !== exceptId).map((t) => {
    const g = C[l].pages[t.id]
    return `<a class="guide" href="${pagePath(l, t)}"><span class="meta">${esc(g.kicker)}</span><b>${esc(g.nav)}</b><span>${esc(g.teaser)}</span></a>`
  }).join('')}</div>`
}

/* ------------------------------------------------------------ accueil */
function homePage(l, assets) {
  const c = C[l], hm = c.home
  const paths = Object.fromEntries(LANGS.map((x) => [x, HOME_PATH[x]]))
  const path = HOME_PATH[l]
  const ld = { '@context': 'https://schema.org', '@graph': [
    org,
    { '@type': 'SoftwareApplication', name: 'ProjectLead', url: abs(path), applicationCategory: 'BusinessApplication', applicationSubCategory: 'Project management',
      operatingSystem: 'Web', inLanguage: l, description: hm.description, image: `${ORIGIN}/media/accueil/partage.jpg`,
      availableLanguage: ['fr', 'de', 'en', 'it', 'es'], offers: offers(l), publisher: { '@id': `${ORIGIN}/#org` } },
    { '@type': 'WebSite', '@id': `${ORIGIN}/#site`, name: 'ProjectLead', url: ORIGIN + '/', publisher: { '@id': `${ORIGIN}/#org` } },
    { ...faqLd(hm.faq), '@id': `${abs(path)}#faq` },
  ] }
  const preload = `<link rel="preload" as="image" type="image/avif" href="/media/accueil/accueil-1280.avif" imagesrcset="/media/accueil/accueil-1280.avif 1280w, /media/accueil/accueil-2400.avif 2400w" imagesizes="(min-width: 1212px) 1148px, calc(100vw - 32px)">\n`
  return `${head(l, { title: hm.title, description: hm.description, path, paths, ld, assets, preload })}
<body>
${header(l, paths, true)}
<main id="contenu">
${hm.body({ signup: signup(l), login: login(l), plans: plansHtml(l), faq: faqHtml(hm.faq), guides: guidesHtml(l) })}
</main>
${footer(l)}
<script type="module" src="${assets.js}"></script>
</body>
</html>
`
}

/* ------------------------------------------------------------ pages mots-clés */
const SHOTS = {
  projet: [1440, 900], gantt: [1440, 900], tableau: [1440, 900], temps: [1440, 900], emails: [1440, 900], charge: [1440, 900], facturation: [1440, 900],
}
function shot(name, alt, eager = false) {
  if (name === 'portail' || name === 'rdv') {
    const [w, hgt] = name === 'portail' ? [640, 3628] : [640, 1388]
    return `<figure class="phone phone-solo"><div class="phone-screen"><picture><source type="image/avif" srcset="/media/accueil/${name}-640.avif"><img src="/media/accueil/${name}-640.webp" width="${w}" height="${hgt}" alt="${esc(alt)}" loading="lazy" decoding="async"></picture></div></figure>`
  }
  const [w, hgt] = SHOTS[name]
  return `<div class="frame"><div class="frame-bar" aria-hidden="true"><span class="sq sq-s">PL</span><span class="url">projectlead.io</span><span class="bar-fill"></span></div>
        <picture>
          <source type="image/avif" srcset="/media/accueil/${name}-800.avif 800w, /media/accueil/${name}-1600.avif 1600w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)">
          <img src="/media/accueil/${name}-800.webp" srcset="/media/accueil/${name}-800.webp 800w, /media/accueil/${name}-1600.webp 1600w" sizes="(min-width: 1212px) 1148px, calc(100vw - 32px)" width="${w}" height="${hgt}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
        </picture></div>`
}

function topicPage(l, t, assets) {
  const c = C[l], g = c.pages[t.id], u = c.ui
  const paths = Object.fromEntries(LANGS.map((x) => [x, pagePath(x, t)]))
  const path = paths[l]
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': abs(path), url: abs(path), name: g.title, description: g.description, inLanguage: l,
      isPartOf: { '@type': 'WebSite', '@id': `${ORIGIN}/#site`, name: 'ProjectLead', url: ORIGIN + '/' },
      about: { '@type': 'SoftwareApplication', name: 'ProjectLead', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: abs(HOME_PATH[l]) },
      publisher: org },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ProjectLead', item: abs(HOME_PATH[l]) },
      { '@type': 'ListItem', position: 2, name: g.nav, item: abs(path) } ] },
    faqLd(g.faq),
  ] }
  const sections = [...g.sections, extra[l][t.id]].map((s, i) => `
  <section class="wrap sec art-sec" aria-labelledby="s${i}">
    <div class="art-grid${s.shot ? '' : ' art-solo'}">
      <div class="prose">
        <h2 id="s${i}">${esc(s.h2)}</h2>
        ${s.p.map((p) => `<p>${p}</p>`).join('\n        ')}
        ${s.list ? `<ul class="dash">${s.list.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      </div>
      ${s.shot ? `<div class="art-shot">${shot(s.shot, s.alt)}</div>` : ''}
    </div>
  </section>`).join('')
  return `${head(l, { title: g.title, description: g.description, path, paths, ld, assets })}
<body>
${header(l, paths, false)}
<main id="contenu">
  <section class="wrap hero art-hero" aria-labelledby="titre">
    <nav class="crumbs" aria-label="${esc(u.crumbs)}"><a href="${HOME_PATH[l]}">ProjectLead</a><span aria-hidden="true">/</span><span>${esc(g.nav)}</span></nav>
    <p class="meta">${esc(g.kicker)}</p>
    <h1 id="titre">${esc(g.h1)}</h1>
    <div class="hero-row">
      <p class="lede">${g.lede}</p>
      <div class="hero-act">
        <div class="ctas">
          <a class="btn btn-fill btn-lg" href="${signup(l)}" rel="nofollow">${esc(u.signupFree)}</a>
          <a class="btn btn-line btn-lg" href="${HOME_PATH[l] === '/' ? '' : HOME_PATH[l]}/#fonctions">${esc(u.seeFeatures)}</a>
        </div>
        <p class="fine">${esc(u.fine)}</p>
      </div>
    </div>
    <figure class="art-figure">${shot(g.shot, g.shotAlt, true)}<figcaption class="cap">${esc(u.shotCaption)}</figcaption></figure>
  </section>
${sections}
  <section class="wrap sec" aria-labelledby="tarifs-titre">
    <div class="sec-head"><p class="meta">${esc(u.nav.pricing)}</p><h2 id="tarifs-titre">${esc(c.plans.title)}</h2></div>
    ${plansHtml(l)}
  </section>
  <section class="wrap sec" aria-labelledby="faq-titre">
    <div class="sec-head"><p class="meta">${esc(u.faqMeta)}</p><h2 id="faq-titre">${esc(u.faqTitle)}</h2></div>
    <div class="faq">
      ${faqHtml(g.faq)}
    </div>
  </section>
  <section class="wrap sec" aria-labelledby="guides-titre">
    <div class="sec-head"><p class="meta">${esc(u.nav.guides)}</p><h2 id="guides-titre">${esc(u.moreGuides)}</h2></div>
    ${guidesHtml(l, t.id)}
  </section>
  <section class="wrap sec" aria-labelledby="final-titre">
    <div class="final">
      <div>
        <p class="meta">${esc(u.startMeta)}</p>
        <h2 id="final-titre">${esc(u.finalTitle)}</h2>
        <div class="ctas">
          <a class="btn btn-fill btn-lg" href="${signup(l)}" rel="nofollow">${esc(u.signupFree)}</a>
          <a class="btn btn-line btn-lg" href="${HOME_PATH[l]}">${esc(u.backHome)}</a>
        </div>
        <p class="fine">${esc(u.fine)}</p>
      </div>
      <div class="final-art" aria-hidden="true"><div class="gantt-art"><span style="--x:0;--w:34;--r:0"></span><span style="--x:22;--w:30;--r:1"></span><span style="--x:44;--w:36;--r:2"></span><span style="--x:62;--w:26;--r:3"></span><span style="--x:78;--w:22;--r:4"></span></div></div>
    </div>
  </section>
</main>
${footer(l)}
<script type="module" src="${assets.js}"></script>
</body>
</html>
`
}

/* ------------------------------------------------------------ 404, robots, sitemap, llms */
function notFound(assets) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page introuvable | ProjectLead</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400;62..125,700;62..125,900&display=swap">
<link rel="stylesheet" href="${assets.css}">
</head>
<body>
<header class="top"><div class="cells"><a class="cell brand" href="/"><span class="sq" aria-hidden="true">PL</span>ProjectLead</a><span class="grow" aria-hidden="true"></span></div></header>
<main class="wrap sec nf">
  <p class="meta">404</p>
  <h1>Page introuvable</h1>
  <p class="lede">Cette adresse n'existe pas ou n'existe plus.</p>
  <p class="lede" lang="en">This page does not exist. <span lang="de">Diese Seite existiert nicht.</span></p>
  <div class="ctas">
    <a class="btn btn-fill btn-lg" href="/">Accueil</a>
    <a class="btn btn-line btn-lg" href="/en" hreflang="en">Home</a>
    <a class="btn btn-line btn-lg" href="/de" hreflang="de">Startseite</a>
    <a class="btn btn-line btn-lg" href="/login">Se connecter / Log in</a>
  </div>
</main>
</body>
</html>
`
}

function robots() {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /auth/
Disallow: /suivi/
Disallow: /invitation/
Disallow: /rdv/gerer/
Disallow: /lead-auth/

Sitemap: ${ORIGIN}/sitemap.xml
`
}

export function sitemapUrls() {
  const groups = [Object.fromEntries(LANGS.map((l) => [l, HOME_PATH[l]])), ...TOPICS.map((t) => Object.fromEntries(LANGS.map((l) => [l, pagePath(l, t)])))]
  return groups
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10)
  const urls = sitemapUrls().flatMap((g) => LANGS.map((l) => `  <url>
    <loc>${abs(g[l])}</loc>
    <lastmod>${today}</lastmod>
${LANGS.map((x) => `    <xhtml:link rel="alternate" hreflang="${x}" href="${abs(g[x])}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(g[X_DEFAULT])}"/>
  </url>`))
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`
}

function llms() {
  const e = C.en
  return `# ProjectLead

> ProjectLead (https://projectlead.io) is web-based project management software for small businesses, teams and freelancers. It takes over once a deal is signed: stages, Gantt chart, tasks, time tracking, emails, appointments, a client follow-up page and monthly invoice drafts in InvoiceLead. Free plan for 3 ongoing projects. Published by Quantum Liquid LLC (30 N Gould St, Sheridan, WY 82801, USA).

## What it does
- Projects with dated stages, team members with their role and rate, budget in hours and amount, status updates (on track, at risk, late), project templates.
- Four views of the same tasks: board (kanban), list, Gantt chart, calendar. Subtasks, checklists, comments with @mentions, recurring tasks, files, dependencies, milestones.
- Time tracking: timer and weekly timesheet, billable hours per project, task and person, time and profitability reports, CSV export.
- Workload per person and per week against capacity.
- Email: Gmail, Microsoft 365 and any IMAP mailbox. An email from a known client joins its project; a new request becomes a project in one click.
- Client follow-up: a public tracking page per project (secret link, no client account), automatic update emails (weekly, every two weeks, monthly or at each finished stage), online booking pages, public request forms.
- Billing: each month one invoice draft per project in InvoiceLead (hourly, monthly fixed fee, per delivered stage or fixed price). Billed time is locked.
- AI Assistant built in: answers questions about your projects, opens the right screen and prepares changes (for example a full project plan with stages, tasks, milestones and dependencies) on a card you apply with one click on "Confirm".
- Interface in French, German, English, Italian and Spanish. REST API with keys for external tools.
- Sign in with the ERPlead account shared by all Lead apps; Lead apps connect to each other without any API key.

## Pricing
- Free: 3 ongoing projects, 1 person, all features, no time limit, AI Assistant for about 10 requests per month.
- Pro: unlimited projects, 1 person, EUR 19 per month or EUR 190 per year (excl. tax).
- Pro+: unlimited projects, up to 5 people, EUR 39 per month or EUR 390 per year (excl. tax).

## Key pages
- [Home (English)](${ORIGIN}/en)
- [Accueil (français)](${ORIGIN}/)
- [Startseite (Deutsch)](${ORIGIN}/de)
${TOPICS.map((t) => `- [${e.pages[t.id].nav}](${abs(pagePath('en', t))})`).join('\n')}
- [Privacy](${ORIGIN}/confidentialite)
- [Terms](${ORIGIN}/conditions)

## The Lead suite
${suite.map((s) => `- [${s.name}](${s.url}): ${s.line.en}`).join('\n')}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || 'dist'
  render(out).then((f) => console.log(`[site] ${f.length} pages dans ${out}/_site`))
}
