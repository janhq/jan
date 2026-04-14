import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ProviderObject } from '@janhq/core'
import { ModelFactory } from '../model-factory'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
  })),
  OpenAICompatibleChatLanguageModel: vi.fn(),
  MetadataExtractor: vi.fn(),
}))

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

const mockedCreateGoogleGenerativeAI = vi.mocked(createGoogleGenerativeAI)
const mockedCreateOpenAICompatible = vi.mocked(createOpenAICompatible)

describe('ModelFactory Gemini regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes Gemini OpenAI endpoint providers through the Google SDK path', async () => {
    const provider: ProviderObject = {
      provider: 'gemini',
      api_key: 'test-api-key',
      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
      models: [],
      settings: [],
      active: true,
    }

    const model = await ModelFactory.createModel('gemini-2.5-flash', provider)

    expect(model).toEqual({ type: 'google' })
    expect(mockedCreateGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      headers: undefined,
      fetch: expect.any(Function),
    })
    expect(mockedCreateOpenAICompatible).not.toHaveBeenCalled()
  })

  it('keeps non-Gemini providers on the OpenAI-compatible path', async () => {
    const provider: ProviderObject = {
      provider: 'groq',
      api_key: 'test-api-key',
      base_url: 'https://api.groq.com/openai/v1',
      models: [],
      settings: [],
      active: true,
    }

    const model = await ModelFactory.createModel('llama-3', provider)

    expect(model).toEqual({ type: 'openai-compatible' })
    expect(mockedCreateOpenAICompatible).toHaveBeenCalledTimes(1)
    expect(mockedCreateGoogleGenerativeAI).not.toHaveBeenCalled()
  })
})
