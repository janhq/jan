import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateText = vi.fn()
const mockCreateModel = vi.fn()

vi.mock('ai', () => ({
  generateText: (...args: any[]) => mockGenerateText(...args),
}))

vi.mock('@/lib/model-factory', () => ({
  ModelFactory: {
    createModel: (...args: any[]) => mockCreateModel(...args),
  },
}))

const mockGetState = vi.fn()

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => mockGetState(),
  },
}))

const mockAssistantGetState = vi.fn()

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: {
    getState: () => mockAssistantGetState(),
  },
}))

const mockServiceHub = {
  models: () => ({ startModel: vi.fn() }),
}

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: mockServiceHub,
    }),
  },
}))

import { runParagraphEditCompletion } from '../runParagraphEditCompletion'

describe('runParagraphEditCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetState.mockReturnValue({
      selectedModel: { id: 'gpt-4' },
      selectedProvider: 'openai',
      getProviderByName: vi.fn(() => ({ provider: 'openai', api_key: 'key', base_url: 'https://api.openai.com/v1' })),
    })
    mockAssistantGetState.mockReturnValue({
      currentAssistant: { parameters: { temperature: 0.7 } },
    })
    mockCreateModel.mockResolvedValue({ modelId: 'gpt-4' })
    mockGenerateText.mockResolvedValue({ text: 'edited text' })
  })

  it('returns generated text on success', async () => {
    const result = await runParagraphEditCompletion({
      system: 'You are a helpful editor',
      user: 'Fix this paragraph',
    })
    expect(result).toBe('edited text')
    expect(mockCreateModel).toHaveBeenCalledWith('gpt-4', expect.any(Object), { temperature: 0.7 })
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a helpful editor',
        messages: [{ role: 'user', content: 'Fix this paragraph' }],
        maxOutputTokens: 4096,
      })
    )
  })

  it('throws when no model is selected', async () => {
    mockGetState.mockReturnValue({
      selectedModel: null,
      selectedProvider: 'openai',
      getProviderByName: vi.fn(() => ({ provider: 'openai' })),
    })

    await expect(
      runParagraphEditCompletion({ system: 'sys', user: 'usr' })
    ).rejects.toThrow('No model selected or service is not ready.')
  })

  it('throws when provider is not found', async () => {
    mockGetState.mockReturnValue({
      selectedModel: { id: 'gpt-4' },
      selectedProvider: 'openai',
      getProviderByName: vi.fn(() => null),
    })

    await expect(
      runParagraphEditCompletion({ system: 'sys', user: 'usr' })
    ).rejects.toThrow('No model selected or service is not ready.')
  })

  it('uses empty parameters when no assistant configured', async () => {
    mockAssistantGetState.mockReturnValue({
      currentAssistant: null,
    })

    const result = await runParagraphEditCompletion({
      system: 'sys',
      user: 'usr',
    })
    expect(result).toBe('edited text')
    expect(mockCreateModel).toHaveBeenCalledWith('gpt-4', expect.any(Object), {})
  })

  it('passes abortSignal to generateText', async () => {
    const controller = new AbortController()

    await runParagraphEditCompletion({
      system: 'sys',
      user: 'usr',
      abortSignal: controller.signal,
    })

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: controller.signal,
      })
    )
  })
})
