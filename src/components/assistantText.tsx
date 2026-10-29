import clsx from 'clsx'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Le texte de l'Assistant IA, rendu sans HTML brut (alignement des bulles, 28.10.2026, B6 et B7). Tout passe par des
 * éléments React (des nœuds DOM) : jamais innerHTML ni dangerouslySetInnerHTML ; un HTML écrit par le modèle reste du
 * texte (React l'échappe).
 * - `**gras**` → <strong> ; `[libellé](/chemin)` → lien interne (le chemin ne s'affiche pas) ; `code` → <code> ;
 * - `<br>` / `<br/>` → saut de ligne ; `#` de titre en début de ligne retiré ; barrière de bloc de code retirée ;
 * - une ligne de tableau Markdown n'est jamais montrée brute : séparateurs `|---|` retirés, cellules en ligne simple ;
 * - typographie française (espace fine insécable avant ; : ! ? et dans « ») en français seulement.
 */

const NNBSP = ' '

/** Espace fine insécable avant ; : ! ? et à l'intérieur des guillemets « » (français seulement). */
export function frenchSpacing(s: string): string {
  return s
    .replace(/«[   ]*/g, `«${NNBSP}`)
    .replace(/[   ]*»/g, `${NNBSP}»`)
    .replace(/([^\s  «([/])[   ]?([;:!?])(?=\s|$|[»).,])/g, `$1${NNBSP}$2`)
}

const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/

/** Les lignes à montrer : sauts de ligne HTML, tableaux, titres et barrières de code remis en texte simple. */
export function plainLines(text: string): { text: string; heading: boolean }[] {
  const out: { text: string; heading: boolean }[] = []
  for (const raw of text.replace(/<br\s*\/?>/gi, '\n').split('\n')) {
    let line = raw.trimEnd()
    if (/^\s*(```|~~~)/.test(line) || TABLE_RULE.test(line)) continue
    const row = line.match(TABLE_ROW)
    if (row) line = row[1].split('|').map((c) => c.trim()).filter(Boolean).join(' · ')
    const h = line.match(/^\s*#{1,6}\s+(.*)$/)
    out.push({ text: h ? h[1] : line, heading: Boolean(h) })
  }
  return out
}

/** Une ligne : gras, liens internes, code ; le reste en texte (échappé), sans « ** » orphelin. */
export function inline(text: string, onLink: () => void, fr: boolean): ReactNode[] {
  const typo = (s: string) => (fr ? frenchSpacing(s) : s)
  const plain = (s: string) => typo(s.replace(/\*\*/g, ''))
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)|`([^`]+)`/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(plain(text.slice(last, m.index)))
    if (m[1]) out.push(<strong key={k++}>{typo(m[1])}</strong>)
    else if (m[2]) out.push(<Link key={k++} to={m[3]} onClick={onLink} className="font-semibold text-accent-dark underline">{typo(m[2])}</Link>)
    else if (m[4]) out.push(<code key={k++} className="bg-muted px-1 font-mono text-[12px]">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(plain(text.slice(last)))
  return out
}

/** La réponse en paragraphes et listes courtes (« - », « 1. »). */
export function Rich({ text, onLink, fr }: { text: string; onLink: () => void; fr: boolean }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list.ordered ? 'ol' : 'ul'
    blocks.push(<L key={blocks.length} className={clsx('my-1 space-y-0.5 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>
      {list.items.map((t, i) => <li key={i}>{inline(t, onLink, fr)}</li>)}</L>)
    list = null
  }
  for (const { text: line, heading } of plainLines(text)) {
    const b = !heading && line.match(/^\s*[-*•]\s+(.*)$/), o = !heading && line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (b || o) {
      const ordered = Boolean(o)
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((b || o as RegExpMatchArray)[1])
      continue
    }
    flush()
    if (!line.trim()) continue
    blocks.push(<p key={blocks.length} className={clsx('my-1', heading && 'font-bold')}>{inline(line, onLink, fr)}</p>)
  }
  flush()
  return <>{blocks}</>
}

/**
 * Une ligne de carte « À confirmer » : « Échéance : lun. 27 oct. → ven. 31 oct. » ; la flèche se voit, un lecteur
 * d'écran lit « devient » (B7). Sur une carte, « → » ne sert qu'à « avant → après » (les intervalles sont en mots).
 */
export function CardText({ text, becomes }: { text: string; becomes: string }) {
  const parts = text.split(' → ')
  if (parts.length < 2) return <>{text}</>
  return (
    <>{parts.map((p, i) => (
      <Fragment key={i}>
        {i > 0 && <><span aria-hidden="true"> → </span><span className="sr-only"> {becomes} </span></>}
        {p}
      </Fragment>
    ))}</>
  )
}
