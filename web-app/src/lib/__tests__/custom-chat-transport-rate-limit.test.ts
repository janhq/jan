import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// Capture every streamText({...}) call, and the options each request's UI
// stream was built with (its onError).
const streamTextCalls: Array<Record<string, unknown>> = []
const uiStreamOptions: Array<{ onError?: (error: unknown) => string }> = []

const h = vi.hoisted(() => ({
  disabledTools: [] as string[],
  servers: ['srv'] as string[],
  getRelevantTools: vi.fn(),
  getModelProps: vi.fn(),
  assistantParameters: null as Record<string, unknown> | null,
  providerId: 'openai',
  serviceHub: null as unknown,
}))

const mcpService = {
  getTools: vi.fn(async () => []),
  getToolsForServers: vi.fn(async () => []),
  getServerSummaries: vi.fn(async () =>
    h.servers.map((name) => ({ name, capabilities: [], description: '' }))
  ),
}

h.serviceHub = {
  mcp: () => mcpService,
  rag: () => ({ getTools: async () => [] }),
}

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    streamText: (args: Record<string, unknown>) => {
      streamTextCalls.push(args)
      return {
        toUIMessageStream: (options: { onError?: (error: unknown) => string }) =>
          uiStreamOptions.push(options) &&
          new ReadableStream({
            start(controller) {
              controller.close()
            },
          }),
      }
    },
  }
})

const provider = {
  provider: 'openai',
  active: true,
  api_key: 'k',
  models: [{ id: 'gpt', capabilities: ['tools'] }],
  settings: [] as Array<{ key: string; controller_props: { value: boolean } }>,
}
const selectedModel = { id: 'gpt', capabilities: ['tools'] }

// Translated errors show their key and values, so a test can tell them apart.
vi.mock('@/i18n/react-i18next-compat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/react-i18next-compat')>()),
  i18n: {
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: h.serviceHub }) },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: {
    getState: () => ({ getDisabledTools: () => h.disabledTools }),
  },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel,
      selectedProvider: h.providerId,
      getProviderByName: () => provider,
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: {
    getState: () => ({
      currentAssistant: h.assistantParameters
        ? { parameters: h.assistantParameters }
        : null,
    }),
  },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: false }) },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: {
    getState: () => ({ settings: { enableSmartToolRouting: true } }),
  },
}))
// Every getState() setter is a no-op; unknown reads (currentStreamThreadId)
// resolve to undefined.
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () =>
      new Proxy(
        {},
        {
          get: () => () => undefined,
        }
      ),
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => []) }))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  getLoadedModels: vi.fn(async () => ['llama-local']),
  unloadLlamaModel: vi.fn(),
}))
vi.mock('@/lib/llamacppRouterProps', () => ({
  getLlamacppExtension: () => ({ getModelProps: h.getModelProps }),
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: h.getRelevantTools },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('@/lib/reasoningProviderOptions', () => ({
  buildReasoningProviderOptions: () => undefined,
}))
vi.mock('@/lib/providerCaps', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderCaps>()),
  isPredefinedRemoteProvider: () => false,
  getProviderApiType: () => 'openai',
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn(async () => ({ modelId: 'gpt' })) },
}))

import { APICallError } from 'ai'
import { CustomChatTransport } from '../custom-chat-transport'
import { useRateLimitRetry } from '@/stores/rate-limit-retry-store'

async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

/** The onError of a request sent on thread-1. */
async function requestOnError() {
  const transport = new CustomChatTransport('you are jan', 'thread-1')
  await drain(
    await transport.sendMessages({
      chatId: 'thread-1',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as UIMessage,
      ],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })
  )
  return uiStreamOptions[uiStreamOptions.length - 1].onError!
}

const RATE_LIMIT_BODY = {
  message: 'Your requests to gpt-6.1-sol for gpt-6.1-sol in eastus2 have exceeded token rate limit.',
  type: 'too_many_requests',
  param: null,
  code: 'rate_limit_exceeded',
}

// The provider refused the request for its rate limit: the thread learns how
// long to wait before it retries on its own, and the user reads why.
describe('CustomChatTransport rate-limit errors', () => {
  beforeEach(() => {
    streamTextCalls.length = 0
    uiStreamOptions.length = 0
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([])
    useRateLimitRetry.setState({ reported: {}, attempts: {}, pending: {}, gaveUp: {} })
  })

  it('reports the wait for an HTTP 429', async () => {
    const onError = await requestOnError()

    const message = onError(
      new APICallError({
        message: RATE_LIMIT_BODY.message,
        url: 'https://example.openai.azure.com/openai/v1/responses',
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { 'retry-after': '15', 'x-ratelimit-reset-tokens': '75' },
        data: { error: RATE_LIMIT_BODY },
        isRetryable: true,
      })
    )

    expect(useRateLimitRetry.getState().reported['thread-1']).toBe(75_000)
    expect(message).toContain('model-errors:rateLimited')
    expect(message).toContain('exceeded token rate limit')
  })

  it('reports the wait for a rate limit hit mid-stream', async () => {
    const onError = await requestOnError()

    const message = onError({ type: 'error', sequence_number: 12, error: RATE_LIMIT_BODY })

    expect(useRateLimitRetry.getState().reported['thread-1']).toBe(60_000)
    expect(message).toContain('model-errors:rateLimited')
  })

  it('reports nothing for other errors', async () => {
    const onError = await requestOnError()

    const message = onError(new Error('network down'))

    expect(useRateLimitRetry.getState().reported['thread-1']).toBeUndefined()
    expect(message).toBe('network down')
  })
})
