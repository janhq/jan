import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { siteUrl } from '@/lib/shared'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl },
    ...source
      .getPages()
      .filter((page) => !page.data.noindex && page.url !== '/')
      .map((page) => ({ url: `${siteUrl}${page.url}` })),
  ]
}
