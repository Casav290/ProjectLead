/**
 * Image de partage (Open Graph, 1200 x 630) de la page d'accueil : marque, accroche et capture de l'application.
 * `node scripts/landing/partage.mjs` (après images.mjs) → media/accueil/partage.jpg
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('/usr/lib/node_modules/playwright')) }

const shot = readFileSync('media/accueil/accueil-1280.webp').toString('base64')
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400;62..125,700;62..125,800;62..125,900&display=block">
<style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#eceae7;font-family:Archivo,sans-serif;color:#1b1a19;overflow:hidden;position:relative}
.l{position:absolute;left:64px;top:64px;width:500px;display:grid;gap:26px}
.b{display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px}
.sq{display:grid;place-items:center;width:46px;height:46px;background:#9a6a00;color:#fff;font-weight:800;font-size:19px}
h1{font-size:76px;line-height:.92;font-weight:900;font-stretch:76%;letter-spacing:-.035em}
h1 span{color:#9a6a00;display:block}
p{font-size:22px;color:#44403c;line-height:1.35}
.u{position:absolute;left:64px;bottom:56px;font-weight:800;font-size:22px;border-top:3px solid #9a6a00;padding-top:12px}
.f{position:absolute;left:600px;top:84px;width:860px;border:1px solid #cfcac4;background:#fff}
.f .bar{height:34px;border-bottom:1px solid #cfcac4;background:#f7f5f3;display:flex;align-items:center;gap:10px;padding-left:10px;font-size:14px;font-weight:600;color:#57534e}
.f .bar i{display:grid;place-items:center;width:20px;height:20px;background:#9a6a00;color:#fff;font-style:normal;font-size:9px;font-weight:800}
.f img{display:block;width:100%}
</style></head><body>
<div class="l"><div class="b"><span class="sq">PL</span>ProjectLead</div>
<h1>Le projet vendu, livré à temps.<span>Sans heures perdues.</span></h1>
<p>Étapes, Gantt, tâches, temps, suivi client et facturation avec InvoiceLead.</p></div>
<div class="u">projectlead.io · gratuit pour 3 projets en cours</div>
<div class="f"><div class="bar"><i>PL</i>projectlead.io</div><img src="data:image/webp;base64,${shot}"></div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: 'media/accueil/partage.png' })
await browser.close()
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'media/accueil/partage.png', '-q:v', '3', 'media/accueil/partage.jpg'])
unlinkSync('media/accueil/partage.png')
console.log('PARTAGE-OK')
