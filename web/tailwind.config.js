/* eslint-disable @typescript-eslint/naming-convention */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const defaultTheme = require('tailwindcss/defaultTheme')

/** @type {import('tailwindcss').Config} */

module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './containers/**/*.{js,ts,jsx,tsx,mdx}',
    './screens/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    boxShadow: {
      dropDown:
        '0px 8px 16px 0px hsla(0, 0%, 0%, 0.08), 0px 0px 4px 0px hsla(0, 0%, 0%, 0.04)',
    },
    maxHeight: {
      'screen-40': 'calc(100vh - 40%)',
    },
    animation: {
      'wave': 'wave 2.5s linear infinite',
      'enter': 'enter 200ms ease-out',
      'slide-in': 'slide-in 1.2s cubic-bezier(.41,.73,.51,1.02)',
      'leave': 'leave 150ms ease-in forwards',
      'bounce-right': 'bounce-right 3s infinite',
      'spin': 'spin 1s linear infinite',
    },
    keyframes: {
      'wave': {
        '0%': { transform: 'rotate( 0.0deg)' },
        '10%': { transform: 'rotate(14.0deg)' },
        '20%': { transform: 'rotate(-8.0deg)' },
        '30%': { transform: 'rotate(14.0deg)' },
        '40%': { transform: 'rotate(-4.0deg)' },
        '50%': { transform: 'rotate(10.0deg)' },
        '60%': { transform: 'rotate( 0.0deg)' },
        '100%': { transform: 'rotate( 0.0deg)' },
      },
      'enter': {
        '0%': { transform: 'scale(0.8)', opacity: '0' },
        '100%': { transform: 'scale(1)', opacity: '1' },
      },
      'leave': {
        '0%': { transform: 'scale(1)', opacity: '1' },
        '100%': { transform: 'scale(0.8)', opacity: '0' },
      },
      'slide-in': {
        '0%': { transform: 'translateY(-100%)' },
        '100%': { transform: 'translateY(0)' },
      },
      'bounce-right': {
        '0%,20%, 50%,80%,100%': { transform: 'translateX(0)' },
        '40%': { transform: 'translateX(-8px)' },
        '60%': { transform: 'translateX(-4px)' },
      },
      'spin': {
        from: { transform: 'rotate(0deg)' },
        to: { transform: 'rotate(360deg)' },
      },
    },
    extend: {
      fontFamily: {
        fontFamily: {
          sans: ['Inter var', ...defaultTheme.fontFamily.sans],
        },
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      const newUtilities = {
        '.custom-slider::-webkit-slider-thumb': {
          appearance: 'none',
          width: '14px',
          height: '14px',
          backgroundColor: '#FFFFFF',
          cursor: 'pointer',
          borderRadius: '9999px',
          pointerEvents: 'auto',
          border: '1px solid #2563EB',
        },
      }

      addUtilities(newUtilities, ['responsive', 'hover'])
    },
  ],
}
