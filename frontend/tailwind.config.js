/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Maps straight onto the real semantic tokens in
      // `KangaruRide Design System/tokens/colors.css` (--kr-*, --surface-*,
      // --text-*, --action-*) — NOT the shadcn HSL-triplet block in
      // DESIGN.md §4, which the actual components don't use.
      colors: {
        brand: {
          green: 'var(--kr-green)',
          'green-hover': 'var(--kr-green-hover)',
          'green-dark': 'var(--kr-green-dark)',
          'green-tint': 'var(--kr-green-tint)',
          navy: 'var(--kr-navy)',
          'navy-soft': 'var(--kr-navy-soft)',
        },
        surface: {
          page: 'var(--surface-page)',
          card: 'var(--surface-card)',
          sunken: 'var(--surface-sunken)',
          subtle: 'var(--surface-subtle)',
          accent: 'var(--surface-accent)',
          chrome: 'var(--surface-chrome)',
          'chrome-elevated': 'var(--surface-chrome-elevated)',
        },
        text: {
          heading: 'var(--text-heading)',
          body: 'var(--text-body)',
          secondary: 'var(--text-secondary)',
          placeholder: 'var(--text-placeholder)',
          disabled: 'var(--text-disabled)',
          link: 'var(--text-link)',
          accent: 'var(--text-accent)',
          'on-brand': 'var(--text-on-brand)',
          'on-chrome': 'var(--text-on-chrome)',
          'on-chrome-secondary': 'var(--text-on-chrome-secondary)',
        },
        border: {
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
          input: 'var(--border-input)',
          chrome: 'var(--border-chrome)',
          accent: 'var(--border-accent)',
        },
      },
      fontFamily: {
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
