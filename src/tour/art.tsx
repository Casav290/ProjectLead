/**
 * Les petites animations de la visite guidée (une par étape) : elles MONTRENT la fonction au lieu de la décrire. Traits
 * de 1,8 comme les icônes de l'application, angles vifs (Trait net), encre et couleur de l'application seulement.
 * Aucun texte dedans (rien à traduire). Le mouvement vit dans tour.css ; avec prefers-reduced-motion, chaque dessin
 * reste sur son image finale, qui se lit seule.
 */
export type ArtName = 'map' | 'home' | 'stages' | 'board' | 'mail' | 'clock' | 'invoice' | 'search' | 'toggles' | 'chat' | 'menu'

const S = { fill: 'none', stroke: 'var(--plt-ink)', strokeWidth: 1.8, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const }
const A = { ...S, stroke: 'var(--plt-accent)' }

function Map() {
  return (
    <g>
      <rect x="40" y="10" width="160" height="76" {...S} />
      <path d="M78 10v76M78 26h122" {...S} />
      {[34, 44, 54, 64].map((y) => <path key={y} d={`M48 ${y}h22`} {...S} strokeWidth={1.4} opacity={0.55} />)}
      <rect x="88" y="34" width="48" height="20" {...S} opacity={0.55} />
      <rect x="144" y="34" width="46" height="42" {...S} opacity={0.55} />
      <rect x="88" y="60" width="48" height="16" {...S} opacity={0.55} />
      <circle cx="188" cy="74" r="5" fill="var(--plt-accent)" />
      {/* Le cadre de visée passe du menu à la recherche puis à la bulle : là où la visite va aller. */}
      {[[42, 28, 76, 72], [84, 12, 140, 24], [180, 66, 196, 82]].map(([x1, y1, x2, y2], i) => (
        <path key={i} className="plt-a-seq" style={{ animationDelay: `${i * 1.8}s` }} {...A} strokeWidth={2.2}
              d={`M${x1} ${y1 + 5}V${y1}h5M${x2 - 5} ${y1}h5v5M${x2} ${y2 - 5}v5h-5M${x1 + 5} ${y2}h-5v-5`} />
      ))}
    </g>
  )
}

function Home() {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${30 + i * 64} 16)`}>
          <rect width="52" height="64" {...S} />
          <path d="M8 12h24" {...S} />
          <rect x="8" y="24" width="36" height="5" fill="var(--plt-accent)" className="plt-a-grow" style={{ animationDelay: `${i * 0.35}s` }} />
          <path d="M8 40h30M8 50h20" {...S} strokeWidth={1.4} opacity={0.5} />
        </g>
      ))}
    </g>
  )
}

function Stages() {
  return (
    <g>
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${24 + i * 46} 34h36l8 12-8 12h-36l8-12z`} {...S}
              fill="var(--plt-accent)" fillOpacity={1} className="plt-a-fill" style={{ animationDelay: `${i * 0.45}s` }} />
      ))}
      <g className="plt-a-drop">
        <path d="M200 66h14l6 6v18h-20z M214 66v6h6" {...S} />
      </g>
    </g>
  )
}

function Board() {
  return (
    <g>
      {[0, 1, 2].map((i) => <rect key={i} x={30 + i * 64} y="12" width="52" height="72" {...S} opacity={0.55} />)}
      {[0, 1, 2].map((i) => <path key={i} d={`M${38 + i * 64} 22h22`} {...S} />)}
      <rect x="38" y="52" width="36" height="12" {...S} opacity={0.4} />
      <rect x="166" y="34" width="36" height="12" {...S} opacity={0.4} />
      {/* La carte passe de « à faire » à « terminé », puis se coche. */}
      <g className="plt-a-card">
        <rect x="166" y="52" width="36" height="12" fill="var(--plt-accent)" />
        <path d="M178 58l4 3 7-6" stroke="var(--plt-on-accent)" strokeWidth={1.8} fill="none" />
      </g>
    </g>
  )
}

function Mail() {
  return (
    <g>
      <g className="plt-a-mail">
        <rect x="34" y="30" width="44" height="30" {...S} />
        <path d="M34 30l22 16 22-16" {...S} />
      </g>
      <path d="M96 46h40M128 40l8 6-8 6" {...S} opacity={0.6} />
      <rect x="150" y="18" width="62" height="58" {...A} />
      <path d="M150 32h62" {...A} />
      <path d="M160 44h40M160 54h28M160 64h34" {...S} strokeWidth={1.4} opacity={0.5} className="plt-a-lines" />
    </g>
  )
}

function Clock() {
  return (
    <g>
      <circle cx="72" cy="48" r="30" {...S} />
      <path d="M72 22v4M72 70v4M46 48h4M94 48h4" {...S} />
      <g className="plt-a-hand" style={{ transformOrigin: '72px 48px' }}>
        <path d="M72 48V28" {...A} strokeWidth={2.2} />
      </g>
      <circle cx="72" cy="48" r="2.5" fill="var(--plt-accent)" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={130 + i * 22} y={24} width="12" height="56" fill="var(--plt-accent)" className="plt-a-bar"
              style={{ animationDelay: `${i * 0.2}s`, ['--h' as string]: [0.45, 0.8, 0.6, 1][i] }} />
      ))}
      <path d="M124 80h102" {...S} />
    </g>
  )
}

function Invoice() {
  return (
    <g>
      <rect x="36" y="22" width="64" height="44" {...S} />
      <circle cx="52" cy="38" r="6" {...S} />
      <path d="M64 36h26M64 44h18M46 56h44" {...S} strokeWidth={1.4} opacity={0.55} />
      <path d="M112 44h16M122 38l6 6-6 6" {...S} opacity={0.6} />
      <rect x="142" y="10" width="62" height="78" {...A} strokeDasharray="5 4" />
      {[26, 36, 46, 56].map((y, i) => (
        <path key={y} d={`M152 ${y}h42`} {...S} strokeWidth={1.4} className="plt-a-write" style={{ animationDelay: `${i * 0.3}s` }} />
      ))}
      <path d="M170 74h24" {...A} strokeWidth={3} className="plt-a-write" style={{ animationDelay: '1.3s' }} />
    </g>
  )
}

function Search() {
  return (
    <g>
      <rect x="40" y="14" width="160" height="16" {...S} />
      {[44, 58, 72].map((y) => <rect key={y} x="40" y={y} width="160" height="10" {...S} strokeWidth={1.2} opacity={0.45} />)}
      <rect x="40" y="58" width="160" height="10" fill="var(--plt-accent)" className="plt-a-hit" />
      <g className="plt-a-lens">
        <circle cx="60" cy="22" r="5" {...A} strokeWidth={2} />
        <path d="M64 26l4 4" {...A} strokeWidth={2} />
      </g>
    </g>
  )
}

function Toggles() {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(52 ${16 + i * 24})`}>
          <path d="M0 8h84" {...S} strokeWidth={1.4} opacity={0.55} />
          <rect x="104" y="0" width="32" height="16" {...S} />
          <rect x="120" y="3" width="13" height="10" fill="var(--plt-accent)" className="plt-a-switch" style={{ animationDelay: `${i * 0.5}s` }} />
        </g>
      ))}
    </g>
  )
}

function Chat() {
  return (
    <g>
      <rect x="110" y="10" width="96" height="18" {...S} className="plt-a-pop" fill="var(--plt-soft)" />
      <g className="plt-a-typing">
        {[0, 1, 2].map((i) => <circle key={i} cx={44 + i * 9} cy="44" r="2.6" fill="var(--plt-ink)" style={{ animationDelay: `${i * 0.15}s` }} />)}
      </g>
      <g className="plt-a-reply">
        <rect x="34" y="36" width="120" height="44" {...S} />
        <path d="M44 48h76M44 58h56" {...S} strokeWidth={1.4} opacity={0.55} />
        <rect x="118" y="64" width="30" height="11" fill="var(--plt-accent)" />
        <path d="M128 70l3 2.5 6-5" stroke="var(--plt-on-accent)" strokeWidth={1.6} fill="none" />
      </g>
      <circle cx="208" cy="74" r="12" fill="var(--plt-accent)" />
      <path d="M202 72h12M202 77h8" stroke="var(--plt-on-accent)" strokeWidth={1.6} />
    </g>
  )
}

function Menu() {
  return (
    <g>
      <circle cx="190" cy="16" r="8" {...S} />
      <rect x="120" y="30" width="86" height="58" {...S} />
      <path d="M130 42h44M130 70h36" {...S} strokeWidth={1.4} opacity={0.5} />
      <rect x="121" y="50" width="84" height="13" fill="var(--plt-accent)" className="plt-a-hit" />
      <g className="plt-a-spin" style={{ transformOrigin: '134px 56.5px' }}>
        <path d="M138.5 56.5a4.5 4.5 0 1 1-1.3-3.2M138 51v3h-3" stroke="var(--plt-on-accent)" strokeWidth={1.5} fill="none" />
      </g>
      <path d="M144 56.5h44" stroke="var(--plt-on-accent)" strokeWidth={1.5} />
      <path d="M40 48h56M86 42l10 6-10 6" {...S} opacity={0.6} />
    </g>
  )
}

const ARTS: Record<ArtName, () => JSX.Element> = {
  map: Map, home: Home, stages: Stages, board: Board, mail: Mail, clock: Clock, invoice: Invoice, search: Search,
  toggles: Toggles, chat: Chat, menu: Menu,
}

export function TourArt({ name }: { name: ArtName }) {
  const Art = ARTS[name]
  return (
    <svg viewBox="0 0 240 96" className="plt-art-svg" aria-hidden="true" focusable="false">
      <Art />
    </svg>
  )
}
