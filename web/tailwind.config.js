/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './containers/**/*.{js,ts,jsx,tsx,mdx}',
    './screens/**/*.{js,ts,jsx,tsx,mdx}',
    './uikit/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // colors: {
    //   border: 'hsl(var(--border))',
    //   input: 'hsl(var(--input))',
    //   ring: 'hsl(var(--ring))',
    //   background: 'hsl(var(--background))',
    //   foreground: 'hsl(var(--foreground))',
    //   primary: {
    //     DEFAULT: 'hsl(var(--primary))',
    //     foreground: 'hsl(var(--primary-foreground))',
    //   },
    //   secondary: {
    //     DEFAULT: 'hsl(var(--secondary))',
    //     foreground: 'hsl(var(--secondary-foreground))',
    //   },
    //   destructive: {
    //     DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
    //     foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
    //   },
    //   muted: {
    //     DEFAULT: 'hsl(var(--muted))',
    //     foreground: 'hsl(var(--muted-foreground))',
    //   },
    //   accent: {
    //     DEFAULT: 'hsl(var(--accent))',
    //     foreground: 'hsl(var(--accent-foreground))',
    //   },
    //   popover: {
    //     DEFAULT: 'hsl(var(--popover))',
    //     foreground: 'hsl(var(--popover-foreground))',
    //   },
    //   card: {
    //     DEFAULT: 'hsl(var(--card))',
    //     foreground: 'hsl(var(--card-foreground))',
    //   },
    // },

    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      animation: {
        bounce200: 'bounce 1s infinite 200ms',
        bounce400: 'bounce 1s infinite 400ms',
      },
      colors: {
        'hover-light': { DEFAULT: '#F9FAFB' },
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
}
