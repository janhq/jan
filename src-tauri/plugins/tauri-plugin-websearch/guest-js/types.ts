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

export interface ProxyConfig {
  url: string
  username?: string
  password?: string
  no_proxy?: string[]
  ignore_ssl?: boolean
}
