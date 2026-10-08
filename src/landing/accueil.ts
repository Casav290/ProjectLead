/**
 * Mouvements de la page d'accueil : apparitions au défilement, compteurs, visite guidée des fonctions,
 * chronomètre du héros, film en lecture muette quand il est à l'écran. Rien n'est imposé : avec
 * « réduire les animations », tout est affiché d'emblée et le film attend un clic.
 */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const still = () => reduced.matches
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T & HTMLElement>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T & HTMLElement>(sel)]

/* ------------------------------------------------------------ nombres */
const fmt = (n: number) => Math.round(n).toLocaleString('fr-CH').replace(/[’']/g, ' ')
function countUp(el: HTMLElement) {
  const target = Number(el.dataset.count)
  if (!Number.isFinite(target) || el.dataset.counted) return
  el.dataset.counted = '1'
  if (still()) { el.textContent = fmt(target); return }
  const dur = target > 100 ? 1400 : 900
  const t0 = performance.now()
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / dur)
    el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)))
    if (k < 1) requestAnimationFrame(tick)
  }
  el.textContent = fmt(0)
  requestAnimationFrame(tick)
}

/* ------------------------------------------------------------ apparitions */
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    const el = e.target as HTMLElement
    el.classList.add('in')
    $$('[data-count]', el).forEach(countUp)
    if (el.dataset.count) countUp(el)
    seen.unobserve(el)
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 })
$$('[data-reveal], .chain, .phones, .flows, .final').forEach((el) => seen.observe(el))
$$('.stats [data-count], .plans [data-count]').forEach((el) => seen.observe(el))

/* ------------------------------------------------------------ héros : cadre, pastilles, chronomètre */
const stage = $('.stage')
if (stage) {
  const img = $<HTMLImageElement>('img', stage)
  const start = () => {
    stage.classList.add('ready')
    window.setTimeout(() => $$('[data-count]', stage).forEach(countUp), 700)
  }
  if (!img || img.complete) requestAnimationFrame(start)
  else { img.addEventListener('load', start, { once: true }); img.addEventListener('error', start, { once: true }); window.setTimeout(start, 1600) }

  const timer = $('[data-timer]', stage)
  if (timer) {
    let s = Number(timer.dataset.timer)
    const show = () => { timer.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
    window.setInterval(() => { if (!still() && !document.hidden) { s++; show() } }, 1000)
  }

  // Parallaxe légère des pastilles, seulement sur grand écran et sans « réduire les animations ».
  const wide = window.matchMedia('(min-width: 901px)')
  let raf = 0
  const onScroll = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (still() || !wide.matches) { stage.style.setProperty('--py', '0'); return }
      const r = stage.getBoundingClientRect()
      const py = Math.max(-400, Math.min(400, window.innerHeight * 0.5 - (r.top + r.height * 0.5)))
      stage.style.setProperty('--py', py.toFixed(1))
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

/* ------------------------------------------------------------ visite guidée */
const steps = $$('.step[data-step]')
const hl = $('#tour-hl')
const zoom = $('#tour-zoom')
const url = $('#tour-url')
const URLS: Record<string, string> = {
  projet: 'projectlead.io/projets/residence-les-tilleuls', gantt: 'projectlead.io/projets/residence-les-tilleuls/gantt',
  tableau: 'projectlead.io/projets/residence-les-tilleuls/tableau', temps: 'projectlead.io/temps', emails: 'projectlead.io/emails',
  charge: 'projectlead.io/charge', facturation: 'projectlead.io/facturation',
}
function activate(step: HTMLElement) {
  const key = step.dataset.step!
  steps.forEach((s) => s.classList.toggle('is-on', s === step))
  $$('.shot').forEach((s) => s.classList.toggle('is-on', s.dataset.shot === key))
  $$('.tour-dots [data-dot]').forEach((d) => d.classList.toggle('is-on', d.dataset.dot === key))
  if (url) url.textContent = URLS[key] ?? 'projectlead.io'
  if (hl) {
    const [x, y, w, h] = (step.dataset.hl ?? '').split(',').map(Number)
    if ([x, y, w, h].every(Number.isFinite)) {
      hl.style.setProperty('--x', String(x)); hl.style.setProperty('--y', String(y))
      hl.style.setProperty('--w', String(w)); hl.style.setProperty('--h', String(h))
      hl.classList.remove('is-on')
      window.setTimeout(() => hl.classList.add('is-on'), still() ? 0 : 380)
      // Petite zone : l'écran s'approche d'elle pour qu'on la lise ; grande zone : il reste entier.
      if (zoom) {
        const zs = still() ? 1 : Math.max(1, Math.min(1.6, 0.62 / Math.max(w / 100, h / 100)))
        zoom.style.setProperty('--ox', String(x + w / 2)); zoom.style.setProperty('--oy', String(y + h / 2))
        zoom.style.setProperty('--zs', zs.toFixed(3))
      }
    } else hl.classList.remove('is-on')
  }
}
if (steps.length) {
  const tour = new IntersectionObserver((entries) => {
    const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
    if (hit) activate(hit.target as HTMLElement)
  }, { rootMargin: '-42% 0px -42% 0px', threshold: [0, 0.01, 0.5, 1] })
  steps.forEach((s) => tour.observe(s))
  activate(steps[0])
}

/* ------------------------------------------------------------ menu : section en cours */
const links = $$<HTMLAnchorElement>('.cells-nav a[href^="#"]')
const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter((s): s is HTMLElement => Boolean(s))
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    links.forEach((a) => {
      const on = a.hash === `#${e.target.id}`
      a.classList.toggle('is-on', on)
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current')
    })
  }
}, { rootMargin: '-45% 0px -50% 0px' })
sections.forEach((s) => spy.observe(s))

/* ------------------------------------------------------------ film */
const video = $<HTMLVideoElement>('#film-video')
const film = $('.film')
const play = $<HTMLButtonElement>('#film-play')
const toggle = $<HTMLButtonElement>('#film-toggle')
const sound = $<HTMLButtonElement>('#film-sound')
const bar = $('#film-progress')
if (video && film && play && toggle && sound) {
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  let userPaused = false
  let started = false
  let heard = false
  const sync = () => {
    const playing = !video.paused && !video.ended
    film.classList.toggle('is-playing', playing || (started && !video.muted))
    toggle.disabled = !started
    toggle.textContent = playing ? 'Pause' : 'Lecture'
    toggle.setAttribute('aria-pressed', String(!playing && started))
    sound.textContent = video.muted ? 'Activer le son' : 'Couper le son'
    sound.setAttribute('aria-pressed', String(!video.muted))
  }
  const go = async (withSound: boolean) => {
    // La première fois qu'on met le son, le film repart du début : on l'entend en entier.
    if (withSound) { video.muted = false; if (!heard) { heard = true; video.currentTime = 0 } }
    started = true
    try { await video.play() } catch { video.muted = true; try { await video.play() } catch { /* lecture refusée : l'affiche reste */ } }
    sync()
  }
  play.addEventListener('click', () => { userPaused = false; void go(true) })
  toggle.addEventListener('click', () => {
    if (video.paused) { userPaused = false; void go(false) } else { userPaused = true; video.pause() }
  })
  sound.addEventListener('click', () => {
    if (video.muted) { userPaused = false; void go(true) } else { video.muted = true; sync() }
  })
  for (const ev of ['play', 'pause', 'ended', 'volumechange']) video.addEventListener(ev, sync)
  video.addEventListener('timeupdate', () => {
    if (bar && video.duration) bar.style.width = `${(100 * video.currentTime / video.duration).toFixed(2)}%`
  })
  // Lecture muette en boucle quand le film est à l'écran ; pause dès qu'il en sort.
  const watch = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.4) {
        if (!still() && !saveData && !userPaused && (video.paused || !started)) { video.preload = 'auto'; void go(false) }
      } else if (!video.paused) video.pause()
    }
  }, { threshold: [0, 0.4, 0.8] })
  watch.observe(video)
  sync()
}
