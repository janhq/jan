import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// Capture every streamText({...}) call, and the options each request's UI
// stream was built with (its messageMetadata).
const streamTextCalls: Array<Record<string, unknown>> = []
type MetadataFn = (args: { part: Record<string, unknown> }) => unknown
const uiStreamOptions: Array<{ messageMetadata?: MetadataFn }> = []

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
        toUIMessageStream: (options: { messageMetadata?: MetadataFn }) =>
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

import { CustomChatTransport } from '../custom-chat-transport'

async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

/** The metadata one request leaves on its reply after streaming `outputTokens` over `ms`. */
async function metadataAfter(messages: UIMessage[], outputTokens: number, ms: number) {
  const transport = new CustomChatTransport('you are jan', 'thread-1')
  await drain(
    await transport.sendMessages({
      chatId: 'thread-1',
      messages,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })
  )
  const metadataOf = uiStreamOptions[uiStreamOptions.length - 1].messageMetadata!
  metadataOf({ part: { type: 'text-start' } })
  vi.advanceTimersByTime(ms)
  return metadataOf({
    part: {
      type: 'finish',
      finishReason: 'stop',
      totalUsage: { inputTokens: 1_000, outputTokens, totalTokens: 1_000 + outputTokens },
    },
  }) as { tokenSpeed: { tokenCount: number; tokenSpeed: number }; usage: { outputTokens: number } }
}

const user = (id: string, text: string): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

// A reply whose model called a tool Jan runs continues in a new request; the
// reply's speed and token count cover all of its requests.
describe('CustomChatTransport token speed of a reply', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    streamTextCalls.length = 0
    uiStreamOptions.length = 0
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a continuing request to the reply so far', async () => {
    const replySoFar = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Let me run that.' }],
      metadata: { tokenSpeed: { tokenSpeed: 10, tokenCount: 100, durationMs: 10_000 } },
    } as UIMessage

    const meta = await metadataAfter([user('u1', 'go'), replySoFar], 5_000, 100_000)

    expect(meta.tokenSpeed.tokenCount).toBe(5_100)
    expect(meta.tokenSpeed.tokenSpeed).toBe(46.36)
    expect(meta.usage.outputTokens).toBe(5_000)
  })

  it('starts from zero for a new reply', async () => {
    const earlierReply = {
      id: 'a0',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done.' }],
      metadata: { tokenSpeed: { tokenSpeed: 10, tokenCount: 100, durationMs: 10_000 } },
    } as UIMessage

    const meta = await metadataAfter(
      [user('u0', 'first'), earlierReply, user('u1', 'next')],
      500,
      10_000
    )

    expect(meta.tokenSpeed.tokenCount).toBe(500)
    expect(meta.tokenSpeed.tokenSpeed).toBe(50)
  })
})
