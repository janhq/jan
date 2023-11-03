/* eslint-disable @typescript-eslint/naming-convention */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './containers/**/*.{js,ts,jsx,tsx,mdx}',
    './screens/**/*.{js,ts,jsx,tsx,mdx}',
    // './node_modules/@janhq/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    animation: {
      wave: 'wave 2.5s linear infinite',
    },
    keyframes: {
      wave: {
        '0%': { transform: 'rotate( 0.0deg)' },
        '10%': { transform: 'rotate(14.0deg)' },
        '20%': { transform: 'rotate(-8.0deg)' },
        '30%': { transform: 'rotate(14.0deg)' },
        '40%': { transform: 'rotate(-4.0deg)' },
        '50%': { transform: 'rotate(10.0deg)' },
        '60%': { transform: 'rotate( 0.0deg)' },
        '100%': { transform: 'rotate( 0.0deg)' },
      },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)'],
      },
      colors: {
        background: 'hsl(var(--background))',
        border: 'hsl(var(--border))',
      },
    },
  },
  plugins: [],
}
