// Ancienne fonction Neon `projectlead`, depuis le 13.10.2026 : ProjectLead est sur Vercel (docs/PASSATION.md). Elle ne
// fait plus que renvoyer vers https://projectlead.io (308, même chemin) : ni base, ni tâches de fond, ni secret lu.
// Ses variables restent dans Neon (déploiement avec le zip seul). Retour arrière : zipper `boot.mjs` sous le nom
// `index.mjs` et le déployer de même (`deploy_function`, zip seul), AVANT de remettre le DNS vers Neon.
const SITE = 'https://projectlead.io'

export default {
  fetch(request) {
    const { pathname, search } = new URL(request.url)
    return new Response(null, { status: 308, headers: { Location: SITE + pathname + search, 'Cache-Control': 'no-store' } })
  },
}
