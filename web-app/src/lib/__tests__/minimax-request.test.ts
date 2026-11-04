import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText, streamText, jsonSchema, tool } from 'ai'
import { ModelFactory } from '../model-factory'
import { defaultModel, suggestedModelIds } from '../models'
import { predefinedProviders } from '@/constants/providers'

vi.mock('@/hooks/useAppState', () => ({
  useAppState: { getState: () => ({}) },
}))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => false }))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({ findSessionByModel: vi.fn() }))
vi.mock('@/lib/engineError', () => ({ engineFailure: vi.fn() }))
vi.mock('@/i18n/react-i18next-compat', () => ({ i18n: { t: (key: string) => key } }))
vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: { getState: () => ({ stripReasoningFromContext: false }) },
}))

// Keep the actual SDKs and request adapter; replace only the HTTP boundary.
async function captureRequest(
  apiType: 'openai' | 'anthropic',
  region: string,
  modelId = defaultModel('minimax'),
  parameters: Record<string, unknown> = {},
  custom: boolean | string = false,
  streaming = false
) {
  const requests: { url: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    const response = apiType === 'anthropic'
      ? {
          id: 'fixture', type: 'message', role: 'assistant', model: modelId,
          content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
          stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        }
      : {
          id: 'fixture', object: 'chat.completion', created: 0, model: modelId,
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
    if (streaming) {
      const events = apiType === 'anthropic'
        ? [
            { type: 'message_start', message: { ...response, content: [], stop_reason: null } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
            { type: 'message_stop' },
          ]
        : [{
            id: 'fixture', object: 'chat.completion.chunk', created: 0, model: modelId,
            choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          }]
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    return Response.json(response)
  }))
  const builtin = predefinedProviders.find((p) => p.provider === 'minimax')!
  expect(builtin.models.map((model) => model.id)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3'])
  const provider = {
    ...builtin,
    provider: typeof custom === 'string' ? custom : custom ? 'custom-minimax' : 'minimax',
    api_key: 'fixture-key',
    api_type: apiType,
    base_url: `https://${region}/${apiType === 'anthropic' ? 'anthropic' : 'v1'}`,
  }
  const model = await ModelFactory.createModel(modelId, provider, parameters)
  const result = await (streaming ? streamText : generateText)({
    model,
    maxRetries: 0,
    maxOutputTokens: 64,
    messages: [
      { role: 'user', content: 'Inspect the fixture first.' },
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'Inspecting fixture history.', providerOptions: { anthropic: { signature: 'fixture-signature' } } },
        { type: 'tool-call', toolCallId: 'fixture-call', toolName: 'inspect', input: {} },
      ] },
      { role: 'tool', content: [
        { type: 'tool-result', toolCallId: 'fixture-call', toolName: 'inspect', output: { type: 'text', value: 'fixture-result' } },
      ] },
      { role: 'user', content: [
      { type: 'text', text: 'Describe this fixture.' },
      { type: 'image', image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
    ] }],
    tools: {
      inspect: tool({
        description: 'Inspect a fixture',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
      }),
    },
  })
  expect(await result.text).toBe('ok')
  expect(requests).toHaveLength(1)
  return requests[0]
}

afterEach(() => vi.unstubAllGlobals())

describe('MiniMax gateway requests', () => {
  it.each([
    suggestedModelIds('openrouter', ['minimax/minimax-m3', 'minimax/minimax-m3.1-flash:free'])[0],
    'minimax/minimax-m3',
    'minimax/minimax-m2.7',
  ])('preserves selected or saved gateway ID %s', async (modelId) => {
    const { url, body } = await captureRequest('openai', 'openrouter.ai/api', modelId, {}, 'openrouter')
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(body.model).toBe(modelId)
    expect(body).not.toHaveProperty('service_tier')
  })
})

describe.each(['api.minimax.io', 'api.minimaxi.com'])('MiniMax transport at %s', (region) => {
  describe.each(['openai', 'anthropic'] as const)('%s compatible requests', (apiType) => {
    it.each([undefined, 'MiniMax-M3', 'MiniMax-M2.7', 'my-custom-model'])(
      'serializes the default or explicit model %s without rewriting it',
      async (modelId) => {
        const { url, body } = await captureRequest(apiType, region, modelId)
        expect(url).toBe(`https://${region}/${apiType === 'anthropic' ? 'anthropic/v1/messages' : 'v1/chat/completions'}`)
        expect(body.model).toBe(modelId ?? 'MiniMax-M3.1-Flash')
        expect(body.max_tokens).toBe(64)
        expect(body.tools).toHaveLength(1)
        expect(JSON.stringify(body.messages)).toContain('Describe this fixture.')
        expect(JSON.stringify(body.messages)).toContain('Inspecting fixture history.')
        expect(JSON.stringify(body.messages)).toContain('fixture-call')
        expect(JSON.stringify(body.messages)).toContain('fixture-result')
        expect(JSON.stringify(body.messages)).toContain(apiType === 'anthropic' ? 'base64' : 'image_url')
        expect(body).not.toHaveProperty('thinking')
        expect(body).not.toHaveProperty('reasoning_effort')
        expect(body).not.toHaveProperty('output_config')
        expect(body).not.toHaveProperty('service_tier')
        expect(body).not.toHaveProperty('reasoning_split')
      }
    )

    it('streams the Flash default through the real SDK', async () => {
      const { body } = await captureRequest(apiType, region, undefined, {}, false, true)
      expect(body.model).toBe('MiniMax-M3.1-Flash')
      expect(body.stream).toBe(true)
      expect(body).not.toHaveProperty('thinking')
      expect(body).not.toHaveProperty('service_tier')
    })

    it('preserves built-in Flash effort', async () => {
      const parameters = apiType === 'anthropic'
        ? { output_config: { effort: 'high' } }
        : { reasoning_effort: 'high' }
      const { body } = await captureRequest(apiType, region, undefined, parameters)
      if (apiType === 'anthropic') expect(body.output_config).toEqual({ effort: 'high' })
      else expect(body.reasoning_effort).toBe('high')
    })

    it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
      'preserves custom Flash effort %s in the protocol field', async (effort) => {
        const parameters = apiType === 'anthropic'
          ? { thinking: { type: 'adaptive' }, output_config: { effort } }
          : { thinking: { type: 'adaptive' }, reasoning_effort: effort }
        const { body } = await captureRequest(apiType, region, 'MiniMax-M3.1-Flash', parameters, true)
        expect(body.thinking).toEqual({ type: 'adaptive' })
        if (apiType === 'anthropic') expect(body.output_config).toEqual({ effort })
        else expect(body.reasoning_effort).toBe(effort)
      }
    )

    it('preserves explicit M3 disabled thinking on a custom endpoint', async () => {
      const { body } = await captureRequest(apiType, region, 'MiniMax-M3', { thinking: { type: 'disabled' } }, true)
      expect(body.model).toBe('MiniMax-M3')
      expect(body.thinking).toEqual({ type: 'disabled' })
    })
  })
})
