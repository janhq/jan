import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: vi.fn(),
  },
}))

vi.mock('@/utils/getModelToStart', () => ({
  getModelToStart: vi.fn(),
}))

import { ensureModelForServer, type EnsureModelDeps } from '../ensureModelForServer'
import { useModelProvider } from '@/hooks/useModelProvider'
import { getModelToStart } from '@/utils/getModelToStart'

const makeProvider = (name: string, modelIds: string[]): ModelProvider => ({
  provider: name,
  models: modelIds.map((id) => ({ id })),
} as any)

const makeDeps = (overrides?: Partial<EnsureModelDeps>): EnsureModelDeps => ({
  modelsService: {
    getActiveModels: vi.fn().mockResolvedValue([]),
    startModel: vi.fn().mockResolvedValue(undefined),
  },
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

describe('ensureModelForServer', () => {
  it('returns already_loaded when a model is active', async () => {
    const llamacpp = makeProvider('llamacpp', ['model-a'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [llamacpp],
    } as any)

    const deps = makeDeps({
      modelsService: {
        getActiveModels: vi.fn().mockResolvedValue(['model-a']),
        startModel: vi.fn(),
      },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({
      status: 'already_loaded',
      modelId: 'model-a',
      providerName: 'llamacpp',
    })
  })

  it('falls back to "llamacpp" when provider not found for active model', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
    } as any)

    const deps = makeDeps({
      modelsService: {
        getActiveModels: vi.fn().mockResolvedValue(['unknown-model']),
        startModel: vi.fn(),
      },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({
      status: 'already_loaded',
      modelId: 'unknown-model',
      providerName: 'llamacpp',
    })
  })

  it('uses modelOverride when provided and valid', async () => {
    const myProvider = makeProvider('openai', ['gpt-4'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn().mockReturnValue(myProvider),
    } as any)

    const deps = makeDeps({
      modelOverride: { model: 'gpt-4', provider: 'openai' },
    })

    const promise = ensureModelForServer(deps)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result).toEqual({
      status: 'loaded',
      modelId: 'gpt-4',
      providerName: 'openai',
    })
    expect(deps.modelsService.startModel).toHaveBeenCalledWith(myProvider, 'gpt-4', true)
  })

  it('skips invalid modelOverride and falls through to getModelToStart', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn().mockReturnValue(undefined),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue(null)

    const deps = makeDeps({
      modelOverride: { model: 'bad', provider: 'bad' },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({ status: 'no_model_available' })
    expect(getModelToStart).toHaveBeenCalled()
  })

  it('uses getModelToStart when no override and no active model', async () => {
    const prov = makeProvider('llamacpp', ['llama'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue({ model: 'llama', provider: prov })

    const deps = makeDeps()
    const promise = ensureModelForServer(deps)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result).toEqual({
      status: 'loaded',
      modelId: 'llama',
      providerName: 'llamacpp',
    })
  })

  it('returns no_model_available when getModelToStart returns null', async () => {
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue(null)

    const result = await ensureModelForServer(makeDeps())
    expect(result).toEqual({ status: 'no_model_available' })
  })

  it('calls onLoadStart and onLoadEnd around startModel', async () => {
    const prov = makeProvider('llamacpp', ['m1'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue({ model: 'm1', provider: prov })

    const onLoadStart = vi.fn()
    const onLoadEnd = vi.fn()
    const deps = makeDeps({ onLoadStart, onLoadEnd })

    const promise = ensureModelForServer(deps)
    await vi.advanceTimersByTimeAsync(500)
    await promise

    expect(onLoadStart).toHaveBeenCalled()
    expect(onLoadEnd).toHaveBeenCalled()
  })

  it('calls onLoadEnd even when startModel throws', async () => {
    const prov = makeProvider('llamacpp', ['m1'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn(),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue({ model: 'm1', provider: prov })

    const onLoadEnd = vi.fn()
    const deps = makeDeps({ onLoadEnd })
    ;(deps.modelsService.startModel as any).mockRejectedValue(new Error('fail'))

    await expect(ensureModelForServer(deps)).rejects.toThrow('fail')
    expect(onLoadEnd).toHaveBeenCalled()
  })

  it('skips modelOverride when provider exists but model not in provider.models', async () => {
    const prov = makeProvider('openai', ['other-model'])
    vi.mocked(useModelProvider.getState).mockReturnValue({
      providers: [],
      selectedModel: null,
      selectedProvider: null,
      getProviderByName: vi.fn().mockReturnValue(prov),
    } as any)
    vi.mocked(getModelToStart).mockReturnValue(null)

    const deps = makeDeps({
      modelOverride: { model: 'not-there', provider: 'openai' },
    })

    const result = await ensureModelForServer(deps)
    expect(result).toEqual({ status: 'no_model_available' })
  })
})
