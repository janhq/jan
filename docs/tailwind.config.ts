import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'selector',

  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './theme.config.tsx',
  ],
  theme: {
    container: {
      center: true,
      padding: '16px',
    },
    fontFamily: {
      sans: [
        'StudioFeixenSans',
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'Roboto',
        'Oxygen-Sans',
        'Ubuntu,Cantarell',
        'Helvetica',
        'sans-serif',
      ],
      inter: [
        'Inter',
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'Roboto',
        'Oxygen-Sans',
        'Ubuntu,Cantarell',
        'Helvetica',
        'sans-serif',
      ],
      // Retired the PPEditorialNew serif site-wide; `font-serif` now renders
      // Studio Feixen Sans like everything else. Kept the token so the existing
      // font-serif display headings resolve without touching 19 files.
      serif: [
        'StudioFeixenSans',
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'Roboto',
        'Oxygen-Sans',
        'Ubuntu,Cantarell',
        'Helvetica',
        'sans-serif',
      ],
    },
    extend: {},
  },
  plugins: [],
}
export default config
