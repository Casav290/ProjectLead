/**
 * Images de la page d'accueil, tirées des captures de `captures.mjs` : AVIF (4:4:4, net sur le texte de l'interface)
 * et WebP de repli, en deux largeurs chacune. Elles vont dans `media/accueil/`, servi par l'application hors du
 * paquet JS (voir server/lib/media.ts). `node scripts/landing/images.mjs <dossier des captures>`
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'

const SRC = process.argv[2]
if (!SRC) throw new Error('usage : node scripts/landing/images.mjs <dossier des captures>')
const OUT = 'media/accueil'
mkdirSync(OUT, { recursive: true })

/** [nom, capture, largeurs, recadrage x,y,l,h en pixels de la capture] : captures bureau 2880 px (1440 en densité 2), téléphone 1290 px (430 en densité 3). */
const LIST = [
  ['accueil', 'desktop/accueil.png', [1280, 2400]],
  // Au téléphone, le héros montre l'application telle qu'elle s'affiche sur un téléphone (haut de l'accueil, 430 x 600).
  ['accueil-tel', 'mobile/accueil.png', [860], [0, 0, 1290, 1800]],
  ['projet', 'desktop/projet.png', [800, 1600]],
  ['gantt', 'desktop/gantt.png', [800, 1600]],
  ['tableau', 'desktop/tableau.png', [800, 1600]],
  ['temps', 'desktop/temps.png', [800, 1600]],
  ['emails', 'desktop/emails.png', [800, 1600]],
  ['charge', 'desktop/charge.png', [800, 1600]],
  ['facturation', 'desktop/facturation.png', [800, 1600]],
  ['portail', 'mobile/portail-long.png', [640]],
  ['rdv', 'mobile/rdv.png', [640]],
]

const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' })
for (const [name, file, widths, crop] of LIST) {
  for (const w of widths) {
    const scale = `${crop ? `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},` : ''}scale=${w}:-2:flags=lanczos`
    ff(['-i', `${SRC}/${file}`, '-vf', `${scale},format=yuv444p`, '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '30', '-cpu-used', '4', `${OUT}/${name}-${w}.avif`])
    ff(['-i', `${SRC}/${file}`, '-vf', scale, '-c:v', 'libwebp', '-quality', '84', '-compression_level', '6', `${OUT}/${name}-${w}.webp`])
    console.log(name, w, statSync(`${OUT}/${name}-${w}.avif`).size, statSync(`${OUT}/${name}-${w}.webp`).size)
  }
}
console.log('IMAGES-OK')
