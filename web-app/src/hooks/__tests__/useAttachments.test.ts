import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'

// Mock ExtensionManager before importing the store
const mockGetSettings = vi.fn()
const mockUpdateSettings = vi.fn()
const mockGetRag = vi.fn()

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: mockGetRag,
    }),
  },
}))

vi.mock('@janhq/core', () => ({
  ExtensionTypeEnum: { RAG: 'rag' },
}))

describe('useAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRag.mockReturnValue(undefined)
  })

  it('should have correct default values', async () => {
    const { useAttachments } = await import('../useAttachments')

    const state = useAttachments.getState()
    expect(state.enabled).toBe(true)
    expect(state.maxFileSizeMB).toBe(20)
    expect(state.retrievalLimit).toBe(3)
    expect(state.retrievalThreshold).toBe(0.3)
    expect(state.chunkSizeChars).toBe(512)
    expect(state.overlapChars).toBe(64)
    expect(state.searchMode).toBe('auto')
    expect(state.parseMode).toBe('auto')
    expect(state.autoInlineContextRatio).toBe(0.75)
    expect(state.settingsDefs).toEqual([])
  })

  it('should set enabled', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setEnabled(false)
    })

    expect(useAttachments.getState().enabled).toBe(false)
  })

  it('should set maxFileSizeMB', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setMaxFileSizeMB(50)
    })

    expect(useAttachments.getState().maxFileSizeMB).toBe(50)
  })

  it('should set retrievalLimit', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setRetrievalLimit(10)
    })

    expect(useAttachments.getState().retrievalLimit).toBe(10)
  })

  it('should set retrievalThreshold', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setRetrievalThreshold(0.5)
    })

    expect(useAttachments.getState().retrievalThreshold).toBe(0.5)
  })

  it('should set chunkSizeChars', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setChunkSizeChars(1024)
    })

    expect(useAttachments.getState().chunkSizeChars).toBe(1024)
  })

  it('should set overlapChars', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setOverlapChars(128)
    })

    expect(useAttachments.getState().overlapChars).toBe(128)
  })

  it('should set searchMode', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setSearchMode('ann')
    })

    expect(useAttachments.getState().searchMode).toBe('ann')
  })

  it('should set parseMode', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setParseMode('inline')
    })

    expect(useAttachments.getState().parseMode).toBe('inline')
  })

  it('should set autoInlineContextRatio', async () => {
    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setAutoInlineContextRatio(0.5)
    })

    expect(useAttachments.getState().autoInlineContextRatio).toBe(0.5)
  })

  it('should call updateSettings on RAG extension when setting enabled', async () => {
    mockGetRag.mockReturnValue({
      getSettings: mockGetSettings,
      updateSettings: mockUpdateSettings,
    })

    const { useAttachments } = await import('../useAttachments')

    await act(async () => {
      await useAttachments.getState().setEnabled(false)
    })

    expect(mockUpdateSettings).toHaveBeenCalledWith([
      { key: 'enabled', controllerProps: { value: false } },
    ])
  })

  it('should update settingsDefs when setting values with existing defs', async () => {
    const { useAttachments } = await import('../useAttachments')

    // Set up initial settingsDefs
    act(() => {
      useAttachments.setState({
        settingsDefs: [
          { key: 'enabled', controllerProps: { value: true } } as any,
          { key: 'max_file_size_mb', controllerProps: { value: 20 } } as any,
        ],
      })
    })

    await act(async () => {
      await useAttachments.getState().setEnabled(false)
    })

    const defs = useAttachments.getState().settingsDefs
    const enabledDef = defs.find((d) => d.key === 'enabled')
    expect((enabledDef as any)?.controllerProps?.value).toBe(false)
  })

  it('should load settings defs from RAG extension', async () => {
    const mockDefs = [
      { key: 'enabled', controllerProps: { value: false } },
      { key: 'max_file_size_mb', controllerProps: { value: 50 } },
      { key: 'retrieval_limit', controllerProps: { value: 5 } },
      { key: 'search_mode', controllerProps: { value: 'linear' } },
      { key: 'parse_mode', controllerProps: { value: 'embeddings' } },
      { key: 'auto_inline_context_ratio', controllerProps: { value: 0.9 } },
    ]

    mockGetRag.mockReturnValue({
      getSettings: vi.fn().mockResolvedValue(mockDefs),
      updateSettings: mockUpdateSettings,
    })

    const { useAttachments } = await import('../useAttachments')

    let success: boolean = false
    await act(async () => {
      success = await useAttachments.getState().loadSettingsDefs()
    })

    expect(success).toBe(true)
    expect(useAttachments.getState().enabled).toBe(false)
    expect(useAttachments.getState().maxFileSizeMB).toBe(50)
    expect(useAttachments.getState().retrievalLimit).toBe(5)
    expect(useAttachments.getState().searchMode).toBe('linear')
    expect(useAttachments.getState().parseMode).toBe('embeddings')
    expect(useAttachments.getState().autoInlineContextRatio).toBe(0.9)
  })

  it('should return false when RAG extension not found', async () => {
    mockGetRag.mockReturnValue(undefined)

    const { useAttachments } = await import('../useAttachments')

    let success: boolean = true
    await act(async () => {
      success = await useAttachments.getState().loadSettingsDefs()
    })

    expect(success).toBe(false)
  })

  it('should return false when getSettings returns non-array', async () => {
    mockGetRag.mockReturnValue({
      getSettings: vi.fn().mockResolvedValue('not-an-array'),
    })

    const { useAttachments } = await import('../useAttachments')

    let success: boolean = true
    await act(async () => {
      success = await useAttachments.getState().loadSettingsDefs()
    })

    expect(success).toBe(false)
  })
})
