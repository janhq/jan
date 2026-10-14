import type { MetadataRoute } from 'next'
import { isNightly, siteUrl } from '@/lib/shared'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    // Crawlers must be able to fetch nightly pages to see their meta noindex.
    rules: { userAgent: '*', allow: '/' },
    ...(isNightly ? {} : { sitemap: `${siteUrl}/sitemap.xml` }),
  }
}
