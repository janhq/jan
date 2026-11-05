import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { ModelFactory } from '../model-factory'
import { buildsOwnToolImageRequest } from '../providerCaps'

// Azure reasoning deployments (gpt-6-astra, gpt-6.1-sol, ...) reject function
// tools on /chat/completions ("Function tools with reasoning_effort are not
// supported ... use /v1/responses"), even when no reasoning_effort is sent.
// These tests drive the real AI SDK and only stub the network, so they assert
// on the request that would actually leave the app.

const AZURE_BASE_URL = 'https://my-resource.openai.azure.com/openai/v1'

const provider = (
  name: string,
  overrides: Partial<ProviderObject> = {}
): ProviderObject =>
  ({
    provider: name,
    api_key: 'test-key',
    base_url: AZURE_BASE_URL,
    models: [],
    settings: [],
    ...overrides,
  }) as unknown as ProviderObject

const callWithTool = (model: LanguageModelV3) =>
  model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'What time is it?' }] }],
    tools: [
      {
        type: 'function',
        name: 'get_time',
        description: 'Returns the current time',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  })

describe('ModelFactory - Azure request routing', () => {
  const fetchMock = vi.fn<typeof globalThis.fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    // The request content is what is under test; reject the call so the SDK
    // does not need a schema-valid response body.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'stubbed' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const sentRequest = () => {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0]
    const url = typeof input === 'string' ? input : (input as Request).url
    const body = JSON.parse(String(init?.body ?? '{}'))
    const headers = new Headers(init?.headers)
    return { url, body, headers }
  }

  it('sends Azure requests with function tools to the Responses API', async () => {
    const model = (await ModelFactory.createModel(
      'gpt-6.1-sol',
      provider('azure')
    )) as LanguageModelV3

    await expect(callWithTool(model)).rejects.toThrow()

    const { url, body, headers } = sentRequest()
    expect(url).toBe(`${AZURE_BASE_URL}/responses`)
    expect(body.model).toBe('gpt-6.1-sol')
    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'get_time' }),
    ])
    expect(headers.get('authorization')).toBe('Bearer test-key')
  })

  it('hands tool images to the SDK as structured output, as the Responses API needs', () => {
    // The Responses request body is built by the SDK, so the request fetch
    // cannot decode a tool image sentinel the way it does for Chat Completions.
    expect(buildsOwnToolImageRequest(provider('azure'))).toBe(true)
    expect(buildsOwnToolImageRequest(provider('groq'))).toBe(false)
  })

  it('keeps other OpenAI-compatible providers on Chat Completions', async () => {
    const model = (await ModelFactory.createModel(
      'llama-3.3-70b',
      provider('groq', { base_url: 'https://api.groq.com/openai/v1' })
    )) as LanguageModelV3

    await expect(callWithTool(model)).rejects.toThrow()

    expect(sentRequest().url).toBe(
      'https://api.groq.com/openai/v1/chat/completions'
    )
  })
})
