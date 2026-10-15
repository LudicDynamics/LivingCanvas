/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          bg: 'var(--ux-color-wall)',
          card: 'var(--ux-color-cream)',
          wall: 'var(--ux-color-wall)',
          dark: 'var(--ux-color-ink)',
          ink: 'var(--ux-color-ink)',
          muted: 'var(--ux-color-muted)',
        },
        rust: {
          DEFAULT: 'var(--ux-color-rust)',
          light: 'var(--ux-color-rust)',
          dark: 'var(--ux-color-rust)',
        },
        sage: {
          DEFAULT: 'var(--ux-color-sage)',
          light: 'var(--ux-color-sage)',
          dark: 'var(--ux-color-sage)',
        },
        blue: {
          DEFAULT: 'var(--ux-color-blue)',
          light: 'var(--ux-color-blue)',
          dark: 'var(--ux-color-blue)',
        },
      },
      fontFamily: {
        serif: ['var(--ux-font-human)'],
        sans: ['var(--ux-font-ui)'],
        mono: ['var(--ux-font-machine)'],
        hand: ['var(--ux-font-hand)'],
      },
      boxShadow: {
        soft: 'var(--ux-shadow-soft)',
        halo: 'var(--ux-shadow-halo)',
        deep: 'var(--ux-shadow-deep)',
      },
      borderRadius: {
        '2xl': 'var(--ux-radius-panel)',
        '3xl': 'var(--ux-radius-toolbar)',
      }
    },
  },
  plugins: [],
}
