import { invoke } from '@tauri-apps/api/core'
import { SearchResult, FetchedPage, ProxyConfig } from './types'

export { SearchResult, FetchedPage, ProxyConfig } from './types'

export async function webSearch(
  query: string,
  count?: number,
  apiKey?: string,
  provider?: string,
  endpoint?: string,
  proxy?: ProxyConfig
): Promise<SearchResult[]> {
  return await invoke('plugin:websearch|web_search', {
    query,
    count,
    provider,
    apiKey,
    endpoint,
    proxy,
  })
}

export async function webFetch(
  url: string,
  apiKey?: string,
  provider?: string,
  endpoint?: string,
  proxy?: ProxyConfig
): Promise<FetchedPage> {
  return await invoke('plugin:websearch|web_fetch', {
    url,
    provider,
    apiKey,
    endpoint,
    proxy,
  })
}
