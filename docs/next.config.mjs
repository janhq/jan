import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

const docsChannel = process.env.DOCS_CHANNEL ?? 'stable'
if (!['stable', 'nightly'].includes(docsChannel)) {
  throw new Error(`Invalid DOCS_CHANNEL: ${docsChannel}. Expected stable or nightly.`)
}

/** @type {import('next').NextConfig} */
const config = {
  // Fully static: deployed to Cloudflare Pages (stable or nightly).
  output: 'export',
  reactStrictMode: true,
  // One URL per page, no trailing slash; `_redirects` matches this policy.
  trailingSlash: false,
  images: { unoptimized: true },
  env: {
    // Shared config is also imported by client components; inline the channel.
    DOCS_CHANNEL: docsChannel,
    GTM_ID: process.env.GTM_ID,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    // Footer copyright year, inlined at build time (no hydration mismatch).
    BUILD_YEAR: String(new Date().getFullYear()),
  },
}

export default withMDX(config)
