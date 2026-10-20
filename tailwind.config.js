/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark fintech canvas
        canvas: '#0a0c10',
        surface: '#111318',
        'surface-2': '#181c24',
        'surface-3': '#1e2330',
        border: '#252b38',
        'border-subtle': '#1a1f2a',
        // Red brand accent
        brand: {
          DEFAULT: '#e53e3e',
          light: '#fc5f5f',
          dark: '#b91c1c',
          muted: 'rgba(229,62,62,0.15)',
        },
        // Text
        'text-primary': '#f1f3f7',
        'text-secondary': '#8b95a8',
        'text-muted': '#4f5766',
        // Semantic
        success: '#22c55e',
        'success-muted': 'rgba(34,197,94,0.12)',
        warning: '#f59e0b',
        'warning-muted': 'rgba(245,158,11,0.12)',
        error: '#ef4444',
        'error-muted': 'rgba(239,68,68,0.12)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tight: '-0.03em',
        tighter: '-0.04em',
        wide: '0.06em',
        wider: '0.08em',
      },
      borderRadius: {
        card: '14px',
        btn: '10px',
        chip: '999px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
        'brand-glow': '0 0 20px rgba(229,62,62,0.2)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s cubic-bezier(0.22,1,0.36,1)',
        pulse: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
