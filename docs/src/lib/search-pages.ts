import { source } from '@/lib/source'
import { SEARCH_LABELS } from '@/lib/search-labels'

// Title and description of every docs page, for the search dialog: it lists
// suggested pages before anything is typed and shows each page result's
// description under its title. Short labels from search-labels.ts, falling
// back to front matter.
export type SearchPage = {
  url: string
  title: string
  description: string
  /** 'Desktop' or 'Agent' */
  section: string
}

const SECTIONS: Record<string, string> = { desktop: 'Desktop', agent: 'Agent' }

export function getSearchPages(): SearchPage[] {
  return source.getPages().map((page) => {
    const label = SEARCH_LABELS[page.url]
    return {
      url: page.url,
      title: label?.title ?? page.data.title,
      description: label?.description ?? page.data.description ?? '',
      section: SECTIONS[page.slugs[0]] ?? '',
    }
  })
}
