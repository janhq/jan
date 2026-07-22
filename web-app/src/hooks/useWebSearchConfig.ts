import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'
import { getServiceHub } from '@/hooks/useServiceHub'

export type WebSearchProviderMeta = {
  id: string
  label: string
  keyless: boolean
  secretKey: string
  homepage: string
  requiresEndpoint?: boolean
}

export const WEB_SEARCH_PROVIDERS: WebSearchProviderMeta[] = [
  {
    id: 'exa',
    label: 'Exa',
    keyless: true,
    secretKey: 'exa-api-key',
    homepage: 'exa.ai',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    keyless: false,
    secretKey: 'tavily-api-key',
    homepage: 'tavily.com',
  },
  {
    id: 'searxng',
    label: 'SearXNG',
    keyless: true,
    secretKey: '',
    homepage: 'searxng.org',
    requiresEndpoint: true,
  },
]

export const DEFAULT_SEARCH_PROVIDER = 'exa'

export const providerFavicon = (meta: WebSearchProviderMeta): string =>
  `https://www.google.com/s2/favicons?domain=${meta.homepage}&sz=64`

export const getProviderMeta = (id: string): WebSearchProviderMeta =>
  WEB_SEARCH_PROVIDERS.find((p) => p.id === id) ?? WEB_SEARCH_PROVIDERS[0]

type WebSearchConfigState = {
  webSearchEnabled: boolean
  searchProvider: string
  apiKeys: Record<string, string>
  endpoints: Record<string, string>
  setWebSearchEnabled: (value: boolean) => void
  setSearchProvider: (value: string) => void
  setApiKey: (providerId: string, value: string) => void
  setEndpoint: (providerId: string, value: string) => void
}

export const useWebSearchConfig = create<WebSearchConfigState>()(
  persist(
    (set, get) => ({
      webSearchEnabled: true,
      searchProvider: DEFAULT_SEARCH_PROVIDER,
      apiKeys: {},
      endpoints: {},
      setWebSearchEnabled: (webSearchEnabled) => set({ webSearchEnabled }),
      setSearchProvider: (searchProvider) => set({ searchProvider }),
      setApiKey: (providerId, value) => {
        set({ apiKeys: { ...get().apiKeys, [providerId]: value } })
        const secretKey = getProviderMeta(providerId).secretKey
        if (!secretKey) return
        // Canonical secret store is the OS keyring, not settings.json.
        getServiceHub()
          .core()
          .invoke('set_secret', { key: secretKey, value })
          .catch((err) =>
            console.warn('Failed to persist web search API key to keyring:', err)
          )
      },
      // Instance URLs are not secrets; they persist in settings.json.
      setEndpoint: (providerId, value) =>
        set({ endpoints: { ...get().endpoints, [providerId]: value } }),
    }),
    {
      name: localStorageKey.settingWebSearch,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      // Never write API keys to plaintext settings.json; they live in the keyring.
      partialize: (state) => ({
        webSearchEnabled: state.webSearchEnabled,
        searchProvider: state.searchProvider,
        endpoints: state.endpoints,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        for (const provider of WEB_SEARCH_PROVIDERS) {
          getServiceHub()
            .core()
            .invoke<string | null>('get_secret', { key: provider.secretKey })
            .then((value) => {
              if (!value) return
              useWebSearchConfig.setState((s) => ({
                apiKeys: { ...s.apiKeys, [provider.id]: value },
              }))
            })
            .catch(() => {})
        }
      },
    }
  )
)
