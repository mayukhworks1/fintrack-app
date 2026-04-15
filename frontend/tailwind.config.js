/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          900: '#14532d',
        },
        surface: {
          900: '#080b12',
          800: '#0f1420',
          750: '#141928',
          700: '#1a2035',
          600: '#232b42',
          500: '#2e3a55',
          400: '#3d4d6b',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-shine': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)',
      },
      backdropBlur: {
        xs: '4px',
      },
      boxShadow: {
        'glass':     '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        'glass-sm':  '0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
        'glass-lg':  '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)',
        'glow':      '0 0 20px rgba(34,197,94,0.25)',
        'glow-sm':   '0 0 10px rgba(34,197,94,0.15)',
      },
      animation: {
        'fade-in':   'fadeIn 0.3s ease both',
        'slide-up':  'slideUp 0.3s ease both',
        'slide-in':  'slideIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
        'pulse-slow':'pulse 3s ease-in-out infinite',
        'shimmer':   'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: 0 },                          to: { opacity: 1 } },
        slideUp:  { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        slideIn:  { from: { opacity: 0, transform: 'translateX(120%)' }, to: { opacity: 1, transform: 'translateX(0)' } },
        shimmer:  { from: { backgroundPosition: '-200% 0' },       to: { backgroundPosition: '200% 0' } },
      },
    },
  },
  plugins: [],
}
