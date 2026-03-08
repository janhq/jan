/** @type {import('next').NextConfig} */

import nextra from 'nextra'
import { remarkCodeHike } from '@code-hike/mdx'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
  latex: true,
  mdxOptions: {
    remarkPlugins: [
      [
        remarkCodeHike,
        {
          theme: 'dark-plus',
          showCopyButton: true,
          skipLanguages: ['mermaid'],
        },
      ],
    ],
  },
})

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  env: {
    GTM_ID: process.env.GTM_ID,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
  },
  transpilePackages: ['@scalar', 'react-tweet'],
  images: {
    formats: ['image/webp'],
    unoptimized: true,
  },
}

export default withNextra(nextConfig)
