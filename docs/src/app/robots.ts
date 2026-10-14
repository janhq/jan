import type { MetadataRoute } from 'next'
import { isNightly, siteUrl } from '@/lib/shared'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: isNightly
      ? { userAgent: '*', disallow: '/' }
      : { userAgent: '*', allow: '/' },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
