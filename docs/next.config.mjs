import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  // Fully static: deployed to Cloudflare Pages (docs.jan.ai).
  output: 'export',
  reactStrictMode: true,
  // One URL per page, no trailing slash; `_redirects` matches this policy.
  trailingSlash: false,
  images: { unoptimized: true },
  env: {
    GTM_ID: process.env.GTM_ID,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
  },
}

export default withMDX(config)
