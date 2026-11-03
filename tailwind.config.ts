import type { Config } from 'tailwindcss';

// Colours are the semantic tokens from src/index.css. Keep using them by name
// (bg-card, text-soft, border-line, …) rather than Tailwind's palette, so a
// theme change stays a token change.
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        page: 'var(--page)',
        nav: 'var(--nav)',
        card: { DEFAULT: 'var(--bg)', foreground: 'var(--ink)' },
        popover: { DEFAULT: 'var(--bg)', foreground: 'var(--ink)' },
        background: 'var(--page)',
        foreground: 'var(--ink)',
        ink: 'var(--ink)',
        soft: 'var(--soft)',
        side: 'var(--side)',
        hover: 'var(--hover)',
        line: 'var(--line)',
        rule: 'var(--rule)',
        wait: 'var(--wait)',
        border: 'var(--line)',
        input: 'var(--line)',
        ring: 'var(--accent)',
        accent: { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)', foreground: 'var(--on-accent)' },
        primary: { DEFAULT: 'var(--accent)', foreground: 'var(--on-accent)' },
        late: { DEFAULT: 'var(--late)', soft: 'var(--late-soft)' },
        destructive: { DEFAULT: 'var(--late)', foreground: '#FFFFFF' },
        muted: { DEFAULT: 'var(--side)', foreground: 'var(--soft)' },
        secondary: { DEFAULT: 'var(--side)', foreground: 'var(--ink)' },
      },
      borderRadius: { xl: '12px', lg: '10px', md: '8px', sm: '7px' },
      fontSize: {
        xs: ['12px', { lineHeight: '1.4' }],
        sm: ['13px', { lineHeight: '1.45' }],
        base: ['14px', { lineHeight: '1.45' }],
      },
      boxShadow: {
        pop: '0 10px 28px rgba(16, 24, 40, 0.12)',
        drawer: '0 12px 40px rgba(16, 24, 40, 0.18)',
      },
    },
  },
  plugins: [],
} satisfies Config;
