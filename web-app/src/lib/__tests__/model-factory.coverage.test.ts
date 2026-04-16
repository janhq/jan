import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory } from '../model-factory'

const mockGlobalFetch = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn().mockImplementation(async (input: any, init: any) => {
    return new Response('{}', { status: 200 })
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

vi.mock('@ai-sdk/openai-compatible', () => {
  const MockChatModel = vi.fn().mockImplementation(() => ({
    type: 'openai-compatible',
    modelId: 'test-model',
  }))
  return {
    createOpenAICompatible: vi.fn(() => ({
      languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
    })),
    OpenAICompatibleChatLanguageModel: MockChatModel,
    MetadataExtractor: vi.fn(),
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ type: 'anthropic' }))),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ type: 'google' }))),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({ type: 'openai' }))),
}))

vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn(() => vi.fn(() => ({ type: 'xai' }))),
}))

vi.mock('ai', () => ({
  wrapLanguageModel: vi.fn(({ model }) => model),
  extractReasoningMiddleware: vi.fn(() => ({})),
}))

const mockStartModel = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        models: () => ({ startModel: mockStartModel }),
      },
    }),
  },
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn(() => false),
}))

vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteApiKeyChain: vi.fn((p: any) => {
    const primary = p.api_key?.trim()
    const fallbacks = (p.api_key_fallbacks ?? []).map((k: string) => k.trim()).filter((k: string) => k.length > 0)
    return [...(primary ? [primary] : []), ...fallbacks]
  }),
}))

describe('ModelFactory - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mkProvider = (provider: string, overrides: Partial<ProviderObject> = {}): ProviderObject => ({
    provider,
    api_key: 'test-key',
    base_url: 'https://api.test.com/v1',
    ...overrides,
  } as ProviderObject)

  it('creates anthropic model', async () => {
    const model = await ModelFactory.createModel('claude-3', mkProvider('anthropic'), {})
    expect(model).toBeDefined()
  })

  it('creates anthropic model with custom headers', async () => {
    const model = await ModelFactory.createModel(
      'claude-3',
      mkProvider('anthropic', {
        custom_header: [{ header: 'anthropic-version', value: '2024-01-01' }],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('creates google model', async () => {
    const model = await ModelFactory.createModel('gemini-pro', mkProvider('google'), {})
    expect(model).toBeDefined()
  })

  it('creates gemini model (alias)', async () => {
    const model = await ModelFactory.createModel('gemini-pro', mkProvider('gemini'), {})
    expect(model).toBeDefined()
  })

  it('creates openai model', async () => {
    const model = await ModelFactory.createModel('gpt-4', mkProvider('openai'), {})
    expect(model).toBeDefined()
  })

  it('creates xai model', async () => {
    const model = await ModelFactory.createModel('grok-1', mkProvider('xai'), {})
    expect(model).toBeDefined()
  })

  it('creates openai-compatible model for known providers', async () => {
    for (const p of ['azure', 'groq', 'together', 'fireworks', 'deepseek', 'mistral', 'cohere', 'perplexity', 'moonshot', 'minimax']) {
      const model = await ModelFactory.createModel('model-1', mkProvider(p), {})
      expect(model).toBeDefined()
    }
  })

  it('creates openai-compatible model for unknown providers', async () => {
    const model = await ModelFactory.createModel('model-1', mkProvider('custom-provider'), {})
    expect(model).toBeDefined()
  })

  it('creates openai-compatible model with custom headers', async () => {
    const model = await ModelFactory.createModel(
      'model-1',
      mkProvider('groq', {
        custom_header: [{ header: 'X-Custom', value: 'value' }],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('creates anthropic model with multiple API keys for rotation', async () => {
    const model = await ModelFactory.createModel(
      'claude-3',
      mkProvider('anthropic', {
        api_key: 'key1',
        api_key_fallbacks: ['key2', 'key3'],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('creates openai model with multiple API keys for rotation', async () => {
    const model = await ModelFactory.createModel(
      'gpt-4',
      mkProvider('openai', {
        api_key: 'key1',
        api_key_fallbacks: ['key2'],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('creates xai model with multiple API keys for rotation', async () => {
    const model = await ModelFactory.createModel(
      'grok-1',
      mkProvider('xai', {
        api_key: 'key1',
        api_key_fallbacks: ['key2'],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('creates google model with multiple API keys for rotation', async () => {
    const model = await ModelFactory.createModel(
      'gemini-pro',
      mkProvider('google', {
        api_key: 'key1',
        api_key_fallbacks: ['key2'],
      }),
      {}
    )
    expect(model).toBeDefined()
  })

  it('passes parameters including max_output_tokens remapping', async () => {
    const model = await ModelFactory.createModel(
      'gpt-4',
      mkProvider('openai'),
      { max_output_tokens: 4096, temperature: 0.5, max_context_tokens: 8192 }
    )
    expect(model).toBeDefined()
  })

  it('creates llamacpp model', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue({ port: 8080, api_key: 'test-key' })
    const model = await ModelFactory.createModel('llama-model', mkProvider('llamacpp'), {})
    expect(model).toBeDefined()
  })

  it('throws when no llamacpp session found', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue(null)
    await expect(
      ModelFactory.createModel('llama-model', mkProvider('llamacpp'), {})
    ).rejects.toThrow('No running session found')
  })

  it('creates mlx model', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue({ port: 9090, api_key: 'mlx-key' })
    const model = await ModelFactory.createModel('mlx-model', mkProvider('mlx'), {})
    expect(model).toBeDefined()
  })

  it('throws when no mlx session found', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue(null)
    await expect(
      ModelFactory.createModel('mlx-model', mkProvider('mlx'), {})
    ).rejects.toThrow('No running MLX session found')
  })

  it('creates foundation-models model', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke)
      .mockResolvedValueOnce('available')  // availability check
      .mockResolvedValueOnce(true)          // is_loaded check
    const model = await ModelFactory.createModel('apple/on-device', mkProvider('foundation-models'), {})
    expect(model).toBeDefined()
  })

  it('throws when foundation-models not available', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValueOnce('notEligible')
    await expect(
      ModelFactory.createModel('apple/on-device', mkProvider('foundation-models'), {})
    ).rejects.toThrow('Apple Intelligence is not supported')
  })

  it('throws when foundation-models not loaded', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke)
      .mockResolvedValueOnce('available')
      .mockResolvedValueOnce(false)
    await expect(
      ModelFactory.createModel('apple/on-device', mkProvider('foundation-models'), {})
    ).rejects.toThrow('No running Foundation Models session')
  })

  it('throws specific messages for each unavailability reason', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    for (const [reason, snippet] of [
      ['appleIntelligenceNotEnabled', 'not enabled'],
      ['modelNotReady', 'still preparing'],
      ['unavailable', 'currently unavailable'],
    ] as const) {
      vi.mocked(invoke).mockResolvedValueOnce(reason)
      await expect(
        ModelFactory.createModel('apple/on-device', mkProvider('foundation-models'), {})
      ).rejects.toThrow(snippet)
    }
  })
})
