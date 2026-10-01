/**
 * TRAIT NET — preset Tailwind commun aux applications Lead. v1, 23.09.2026.
 *
 *   // tailwind.config.js
 *   presets: [require('./trait-net/tailwind-preset.cjs')]
 *
 * Il supprime les arrondis et les ombres à la source : un `rounded-lg` ou un
 * `shadow-md` hérité d'un ancien écran rend désormais un angle vif et un trait,
 * sans avoir à réécrire chaque composant. Ce qui flotte (shadow-md et plus) garde
 * un filet net à la place de l'ombre. `rounded-full` est conservé pour les
 * pastilles et interrupteurs.
 *
 * Pour une app shadcn/ui (variables HSL `--background`, `--primary`…), reprendre
 * aussi le bloc « Jetons shadcn » de TRAIT-NET.md.
 */
const zero = '0px'
module.exports = {
  theme: {
    extend: {
      colors: {
        tn: {
          app: '#eceae7', panel: '#ffffff', muted: '#f2f0ee', head: '#f7f5f3', strip: '#f4f2ef', rowhover: '#f4f8ff',
          'line-strong': '#cfcac4', line: '#e7e4e0', 'line-soft': '#eeebe7', 'line-cell': '#f4f1ee',
          ink: '#1b1a19', 'ink-2': '#44403c', 'ink-3': '#57534e', 'ink-muted': '#6f6a64',
          // Couleur d'action de l'app, lue dans --tn-accent* (voir trait-net.css).
          accent: 'var(--tn-accent)', 'accent-dark': 'var(--tn-accent-dark)', 'accent-pale': 'var(--tn-accent-pale)',
          hot: '#dc2626', 'hot-bg': '#fee2e2', 'hot-fg': '#b91c1c',
          warm: '#ea580c', 'warm-bg': '#ffedd5', 'warm-fg': '#c2410c',
          cold: '#0284c7', 'cold-bg': '#e0f2fe', 'cold-fg': '#0369a1',
          ok: '#16a34a', 'ok-bg': '#dcfce7', 'ok-fg': '#15803d',
        },
      },
      fontFamily: { sans: ['Archivo', 'system-ui', 'sans-serif'], display: ['Archivo', 'system-ui', 'sans-serif'] },
    },
    borderRadius: { none: zero, sm: zero, DEFAULT: zero, md: zero, lg: zero, xl: zero, '2xl': zero, '3xl': zero, full: '9999px' },
    // Pas d'ombre portée. Ce qui flotte (menu, fenêtre, bulle) garde un contour marqué d'un trait :
    // shadow-md et au-delà rendent un filet #cfcac4, sans flou ni décalage.
    boxShadow: { none: 'none', sm: 'none', DEFAULT: 'none', inner: 'none',
      md: '0 0 0 1px #cfcac4', lg: '0 0 0 1px #cfcac4', xl: '0 0 0 1px #cfcac4', '2xl': '0 0 0 1px #cfcac4' },
  },
}
