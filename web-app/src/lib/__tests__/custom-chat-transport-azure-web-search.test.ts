import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// Capture every streamText({...}) call so we can compare the prompt prefix
// (system + tools + prior model messages) across consecutive turns.
const streamTextCalls: Array<Record<string, unknown>> = []

const h = vi.hoisted(() => ({
  disabledTools: [] as string[],
  servers: ['srv'] as string[],
  getRelevantTools: vi.fn(),
  getModelProps: vi.fn(),
  assistantParameters: null as Record<string, unknown> | null,
  providerId: 'azure',
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
        toUIMessageStream: () =>
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
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { WEB_SEARCH_DESCRIPTION } from '@/lib/webSearchTool'

const user = (id: string, text: string): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

async function sendOnce(
  messages: UIMessage[] = [user('u1', 'what is new today?')]
): Promise<Record<string, unknown>> {
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
  return streamTextCalls[streamTextCalls.length - 1]
}

describe('CustomChatTransport web search on Azure', () => {
  beforeEach(() => {
    streamTextCalls.length = 0
    h.providerId = 'azure'
    provider.provider = 'azure'
    delete provider.azure_web_search
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([
      { name: 'tool_a', description: 'a', inputSchema: {}, server: 'srv' },
    ])
    useWebSearchConfig.setState({ webSearchEnabled: true })
  })

  it("searches with Azure's web_search tool by default instead of Jan's search provider", async () => {
    const call = await sendOnce()
    const tools = call.tools as Record<string, Record<string, unknown>>

    expect(tools.web_search).toMatchObject({
      type: 'provider',
      id: 'openai.web_search',
    })
    expect(tools).not.toHaveProperty('web_fetch')
    expect(tools).toHaveProperty('tool_a')
    // The instruction must not point the model at a tool it was not given.
    expect(call.system).toContain('web_search')
    expect(call.system).not.toContain('web_fetch')
  })

  it("uses Jan's search provider when the Azure switch is off", async () => {
    provider.azure_web_search = false
    const call = await sendOnce()
    const tools = call.tools as Record<string, Record<string, unknown>>

    expect(tools.web_search.description).toBe(WEB_SEARCH_DESCRIPTION)
    expect(tools).toHaveProperty('web_fetch')
    expect(call.system).toContain('web_fetch')
  })

  it('sends no web search at all while web search is turned off', async () => {
    useWebSearchConfig.setState({ webSearchEnabled: false })
    const call = await sendOnce()

    expect(call.tools).not.toHaveProperty('web_search')
    expect(call.tools).not.toHaveProperty('web_fetch')
  })

  it("keeps Jan's search provider for other providers", async () => {
    h.providerId = 'openai'
    provider.provider = 'openai'
    const call = await sendOnce()
    const tools = call.tools as Record<string, Record<string, unknown>>

    expect(tools.web_search.description).toBe(WEB_SEARCH_DESCRIPTION)
    expect(tools).toHaveProperty('web_fetch')
  })

  // A search Azure ran is replayed as a reference only Azure can resolve.
  describe('a thread that used Azure web search', () => {
    const thread = (): UIMessage[] =>
      [
        user('u1', 'weather in tokyo?'),
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-web_search',
              toolCallId: 'ws_hosted_1',
              state: 'output-available',
              providerExecuted: true,
              input: {},
              output: { action: { type: 'search', query: 'tokyo weather' } },
            },
            { type: 'text', text: 'Sunny in Tokyo.' },
          ],
        },
        user('u2', 'and tomorrow?'),
      ] as UIMessage[]

    it('replays the search to Azure', async () => {
      const call = await sendOnce(thread())
      expect(JSON.stringify(call.messages)).toContain('ws_hosted_1')
    })

    it('leaves the search out, keeping the answer, after switching to another provider', async () => {
      h.providerId = 'openai'
      provider.provider = 'openai'
      const call = await sendOnce(thread())
      const sent = JSON.stringify(call.messages)

      expect(sent).not.toContain('ws_hosted_1')
      expect(sent).toContain('Sunny in Tokyo.')
    })
  })
})
