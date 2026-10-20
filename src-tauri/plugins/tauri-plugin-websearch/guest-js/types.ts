export interface SearchResult {
  title: string
  url: string
  snippet: string
  published_at?: string
}

export interface FetchedPage {
  url: string
  title: string
  content: string
  truncated: boolean
}
