import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ stores: new Map<string, { persist: { rehydrate: ReturnType<typeof vi.fn>, hasHydrated: ReturnType<typeof vi.fn> } }>() }))
vi.mock('@/hooks/useTheme', () => ({ useTheme: h.stores.get('useTheme') }))
vi.mock('@/hooks/useInterfaceSettings', () => ({ useInterfaceSettings: h.stores.get('useInterfaceSettings') }))
vi.mock('@/hooks/useGeneralSetting', () => ({ useGeneralSetting: h.stores.get('useGeneralSetting') }))
vi.mock('@/hooks/useLeftPanel', () => ({ useLeftPanel: h.stores.get('useLeftPanel') }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: h.stores.get('useModelProvider') }))
vi.mock('@/hooks/useAnalytic', () => ({ useProductAnalytic: h.stores.get('useProductAnalytic'), useProductAnalyticPrompt: h.stores.get('useProductAnalyticPrompt') }))
vi.mock('@/hooks/useHardware', () => ({ useHardware: h.stores.get('useHardware') }))
vi.mock('@/hooks/useLocalApiServer', () => ({ useLocalApiServer: h.stores.get('useLocalApiServer') }))
vi.mock('@/hooks/useToolApproval', () => ({ useToolApproval: h.stores.get('useToolApproval') }))
vi.mock('@/hooks/useToolAvailable', () => ({ useToolAvailable: h.stores.get('useToolAvailable') }))
vi.mock('@/hooks/useDownloadStore', () => ({ useDownloadStore: h.stores.get('useDownloadStore') }))
vi.mock('@/hooks/useProxyConfig', () => ({ useProxyConfig: h.stores.get('useProxyConfig') }))
vi.mock('@/hooks/useVulkan', () => ({ useVulkan: h.stores.get('useVulkan') }))
vi.mock('@/hooks/useFavoriteModel', () => ({ useFavoriteModel: h.stores.get('useFavoriteModel') }))
vi.mock('@/hooks/useLatestJanModel', () => ({ useLatestJanModel: h.stores.get('useLatestJanModel') }))
vi.mock('@/hooks/useJanModelPrompt', () => ({ useJanModelPromptDismissed: h.stores.get('useJanModelPromptDismissed') }))
vi.mock('@/hooks/useDefaultEmbeddingModel', () => ({ useDefaultEmbeddingModel: h.stores.get('useDefaultEmbeddingModel') }))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: h.stores.get('useAgentMode') }))
vi.mock('@/hooks/useWebSearchConfig', () => ({ useWebSearchConfig: h.stores.get('useWebSearchConfig') }))
vi.mock('@/hooks/useCoworkSessions', () => ({ useCoworkSessions: h.stores.get('useCoworkSessions') }))
vi.mock('@/hooks/useCoworkConfig', () => ({ useCoworkConfig: h.stores.get('useCoworkConfig') }))
vi.mock('@/hooks/useChatShell', () => ({ useChatShell: h.stores.get('useChatShell') }))
vi.mock('@/hooks/useCoTDuration', () => ({ useCoTDuration: h.stores.get('useCoTDuration') }))
vi.mock('@/hooks/useImageAttachmentConfig', () => ({ useImageAttachmentConfig: h.stores.get('useImageAttachmentConfig') }))

beforeEach(() => {
  vi.resetModules()
  // Mock factories are cached across resetModules; keep their store objects.
  if (h.stores.size === 0) {
  h.stores.set('useTheme', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useInterfaceSettings', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useGeneralSetting', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useLeftPanel', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useModelProvider', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useProductAnalytic', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useProductAnalyticPrompt', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useHardware', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useLocalApiServer', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useToolApproval', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useToolAvailable', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useDownloadStore', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useProxyConfig', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useVulkan', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useFavoriteModel', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useLatestJanModel', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useJanModelPromptDismissed', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useDefaultEmbeddingModel', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useAgentMode', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useWebSearchConfig', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useCoworkSessions', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useCoworkConfig', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useChatShell', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useCoTDuration', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  h.stores.set('useImageAttachmentConfig', { persist: { rehydrate: vi.fn().mockResolvedValue(undefined), hasHydrated: vi.fn().mockReturnValue(true) } })
  }
  for (const { persist } of h.stores.values()) {
    persist.rehydrate.mockReset().mockResolvedValue(undefined)
    persist.hasHydrated.mockReset().mockReturnValue(true)
  }
})

it('retries a resolved but unsuccessful hydration and loads theme before dependent stores', async () => {
  const theme = h.stores.get('useTheme')!.persist
  theme.hasHydrated.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true)
  const secondary = h.stores.get('useInterfaceSettings')!.persist
  secondary.rehydrate.mockImplementation(() => {
    expect(theme.rehydrate).toHaveBeenCalledTimes(3)
  })
  const { hydrateBackendStores } = await import('../hydrateStores')
  await hydrateBackendStores()
  expect(theme.rehydrate).toHaveBeenCalledTimes(3)
  expect(secondary.rehydrate).toHaveBeenCalledOnce()
})

it('tries every secondary store even if theme fails permanently, then rejects', async () => {
  const theme = h.stores.get('useTheme')!.persist
  theme.hasHydrated.mockReturnValue(false)
  const { hydrateBackendStores } = await import('../hydrateStores')
  await expect(hydrateBackendStores()).rejects.toThrow('three attempts')
  expect(theme.rehydrate).toHaveBeenCalledTimes(3)
  for (const [name, store] of h.stores) {
    if (name !== 'useTheme') expect(store.persist.rehydrate).toHaveBeenCalledOnce()
  }
})

it('bounds secondary retries and allows a later initialization to recover', async () => {
  const secondary = h.stores.get('useGeneralSetting')!.persist
  secondary.hasHydrated.mockReturnValue(false)
  const { hydrateBackendStores } = await import('../hydrateStores')
  await expect(hydrateBackendStores()).rejects.toThrow('three attempts')
  expect(secondary.rehydrate).toHaveBeenCalledTimes(3)
  secondary.hasHydrated.mockReturnValue(true)
  await hydrateBackendStores()
  expect(secondary.rehydrate).toHaveBeenCalledTimes(4)
})

it('shares one in-flight hydration between concurrent callers', async () => {
  let resolve!: () => void
  h.stores.get('useTheme')!.persist.rehydrate.mockReturnValueOnce(new Promise<void>(yes => { resolve = yes }))
  const { hydrateBackendStores } = await import('../hydrateStores')
  const first = hydrateBackendStores()
  const second = hydrateBackendStores()
  expect(first).toBe(second)
  resolve()
  await first
  for (const store of h.stores.values()) expect(store.persist.rehydrate).toHaveBeenCalledOnce()
})
