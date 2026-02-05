import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type LocalApiServerState = {
  // Run local API server once app opens
  enableOnStartup: boolean
  setEnableOnStartup: (value: boolean) => void
  // Server host option (127.0.0.1 or 0.0.0.0)
  serverHost: '127.0.0.1' | '0.0.0.0'
  setServerHost: (value: '127.0.0.1' | '0.0.0.0') => void
  // Server port (default 1337)
  serverPort: number
  setServerPort: (value: number) => void
  // API prefix (default /v1)
  apiPrefix: string
  setApiPrefix: (value: string) => void
  // CORS enabled
  corsEnabled: boolean
  setCorsEnabled: (value: boolean) => void
  // Verbose server logs
  verboseLogs: boolean
  setVerboseLogs: (value: boolean) => void
  apiKey: string
  setApiKey: (value: string) => void
  // Trusted hosts
  trustedHosts: string[]
  addTrustedHost: (host: string) => void
  removeTrustedHost: (host: string) => void
  setTrustedHosts: (hosts: string[]) => void
  // Server request timeout (default 600 sec)
  proxyTimeout: number
  setProxyTimeout: (value: number) => void
}

export const useLocalApiServer = create<LocalApiServerState>()(
  persist(
    (set) => ({
      enableOnStartup: false,
      setEnableOnStartup: (value) => set({ enableOnStartup: value }),
      serverHost: '127.0.0.1',
      setServerHost: (value) => set({ serverHost: value }),
      // Use port 0 (auto-assign) for mobile to avoid conflicts, 1337 for desktop
      serverPort: (typeof window !== 'undefined' && (window as { IS_ANDROID?: boolean }).IS_ANDROID) || (typeof window !== 'undefined' && (window as { IS_IOS?: boolean }).IS_IOS) ? 0 : 1337,
      setServerPort: (value) => set({ serverPort: value }),
      apiPrefix: '/v1',
      setApiPrefix: (value) => set({ apiPrefix: value }),
      corsEnabled: true,
      setCorsEnabled: (value) => set({ corsEnabled: value }),
      verboseLogs: true,
      setVerboseLogs: (value) => set({ verboseLogs: value }),
      trustedHosts: [],
      addTrustedHost: (host) =>
        set((state) => ({
          trustedHosts: [...state.trustedHosts, host],
        })),
      removeTrustedHost: (host) =>
        set((state) => ({
          trustedHosts: state.trustedHosts.filter((h) => h !== host),
        })),
      setTrustedHosts: (hosts) => set({ trustedHosts: hosts }),
      proxyTimeout: 600,
      setProxyTimeout: (value) => set({ proxyTimeout: value }),
      apiKey: '',
      setApiKey: (value) => set({ apiKey: value }),
    }),
    {
      name: localStorageKey.settingLocalApiServer,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
