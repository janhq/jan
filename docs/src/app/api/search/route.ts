import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

export const revalidate = false

// Pre-built Orama index, written to out/api/search at build time.
export const { staticGET: GET } = createFromSource(source, {
  language: 'english',
})
