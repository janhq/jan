import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

export const revalidate = false

// Pre-built Orama index, written to out/api/search at build time.
export const { staticGET: GET } = createFromSource(source, {
  language: 'english',
  // Results are ranked by relevance; the sort table (~25% of the exported
  // index) is never used, so don't build or ship it.
  sort: { enabled: false },
})
