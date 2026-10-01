import trait from './trait-net/tailwind-preset.cjs'

/** Visuel « Trait net » commun aux apps Lead : le preset met arrondis et ombres à zéro
 *  à la source (copie de ~/partage/Quantum Liquid LLC/Trait-net/tailwind-preset.cjs). */
/** @type {import('tailwindcss').Config} */
export default {
  presets: [trait],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        accent: {
          DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))',
          light: 'hsl(var(--accent-light))', veil: 'hsl(var(--accent-veil))', dark: 'hsl(var(--accent-dark))',
        },
        marine: { DEFAULT: 'hsl(var(--marine))', deep: 'hsl(var(--marine-deep))' },
        won: { DEFAULT: 'hsl(var(--won))', foreground: 'hsl(var(--won-foreground))' },
        late: { DEFAULT: 'hsl(var(--late))', foreground: 'hsl(var(--late-foreground))' },
        soon: 'hsl(var(--soon))',
        idle: 'hsl(var(--idle))',
        head: 'hsl(var(--head))',
        brand: 'hsl(var(--brand))',
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      transitionTimingFunction: { crm: 'var(--ease)' },
    },
  },
  plugins: [],
}
