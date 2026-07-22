import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'

// Capture every streamText({...}) call so we can compare the prompt prefix
// (system + tools + prior model messages) across consecutive turns.
const streamTextCalls: Array<Record<string, unknown>> = []

const h = vi.hoisted(() => ({
  disabledTools: [] as string[],
  servers: ['srv'] as string[],
  getRelevantTools: vi.fn(),
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

const provider = { provider: 'openai', api_key: 'k', models: [] }
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
      selectedProvider: 'openai',
      getProviderByName: () => provider,
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
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
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))
vi.mock('@/lib/llamacppRouterProps', () => ({
  getLlamacppExtension: () => null,
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
vi.mock('@/lib/providerCaps', () => ({
  isPredefinedRemoteProvider: () => false,
  getProviderApiType: () => 'openai',
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn(async () => ({ modelId: 'gpt' })) },
}))

import { CustomChatTransport } from '../custom-chat-transport'

const user = (id: string, text: string): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage
const assistant = (id: string, text: string): UIMessage =>
  ({ id, role: 'assistant', parts: [{ type: 'text', text }] }) as UIMessage

async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

const send = (transport: CustomChatTransport, messages: UIMessage[]) =>
  transport.sendMessages({
    chatId: 'thread-1',
    messages,
    abortSignal: undefined,
    trigger: 'submit-message',
    messageId: undefined,
  })

describe('CustomChatTransport prompt-prefix stability across turns', () => {
  beforeEach(() => {
    streamTextCalls.length = 0
    h.disabledTools = []
    h.servers = ['srv']
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([
      { name: 'tool_a', description: 'a', inputSchema: {}, server: 'srv' },
    ])
  })

  it('sends a byte-identical prefix (system + tools + prior turns) on the next turn', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')

    const turn1 = [user('u1', 'hello')]
    await drain(await send(transport, turn1))

    // A new turn: prior turn + assistant reply + new user question.
    const turn2 = [
      ...turn1,
      assistant('a1', 'hi there'),
      user('u2', 'again'),
    ]
    await drain(await send(transport, turn2))

    expect(streamTextCalls).toHaveLength(2)
    const [first, second] = streamTextCalls

    // System prompt is byte-identical.
    expect(JSON.stringify(second.system)).toBe(JSON.stringify(first.system))

    // Tool set is byte-identical (frozen for the thread's lifetime).
    expect(JSON.stringify(Object.keys(second.tools as object))).toBe(
      JSON.stringify(Object.keys(first.tools as object))
    )

    // The prior turn's model messages are re-serialized byte-for-byte, so the
    // second request's message array starts with turn 1's exact prefix.
    const firstMessages = first.messages as unknown[]
    const secondMessages = second.messages as unknown[]
    expect(secondMessages.length).toBeGreaterThan(firstMessages.length)
    expect(
      JSON.stringify(secondMessages.slice(0, firstMessages.length))
    ).toBe(JSON.stringify(firstMessages))
  })

  it('keeps the prefix stable when the third turn extends the second', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')

    const turn2 = [
      user('u1', 'hello'),
      assistant('a1', 'hi there'),
      user('u2', 'again'),
    ]
    await drain(await send(transport, turn2))

    const turn3 = [...turn2, assistant('a2', 'sure'), user('u3', 'more')]
    await drain(await send(transport, turn3))

    expect(streamTextCalls).toHaveLength(2)
    const [second, third] = streamTextCalls
    const secondMessages = second.messages as unknown[]
    const thirdMessages = third.messages as unknown[]
    expect(
      JSON.stringify(thirdMessages.slice(0, secondMessages.length))
    ).toBe(JSON.stringify(secondMessages))
  })
})

describe('CustomChatTransport assistant completion (continuation prefill)', () => {
  beforeEach(() => {
    streamTextCalls.length = 0
    h.disabledTools = []
    h.servers = ['srv']
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([
      { name: 'tool_a', description: 'a', inputSchema: {}, server: 'srv' },
    ])
  })

  const history: UIMessage[] = [
    user('u1', 'write a poem'),
    assistant('a1', 'here goes'),
    user('u2', 'continue'),
  ]

  it('appends the partial content as a trailing assistant prefill message', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    transport.setContinueFromContent('Roses are red,')
    await drain(await send(transport, history))

    expect(streamTextCalls).toHaveLength(1)
    const messages = streamTextCalls[0].messages as Array<{
      role: string
      content: unknown
    }>
    const last = messages[messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toEqual([{ type: 'text', text: 'Roses are red,' }])
  })

  it('prefills reasoning so a turn stopped mid-thinking resumes inside <think>', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    transport.setContinueFromContent({ reasoning: 'let me think', text: '' })
    await drain(await send(transport, history))

    const messages = streamTextCalls[0].messages as Array<{
      role: string
      content: unknown
    }>
    const last = messages[messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toEqual([{ type: 'reasoning', text: 'let me think' }])
  })

  it('leaves the cached prefix byte-identical (prefill only appends)', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')

    // Normal send seeds the cache prefix.
    await drain(await send(transport, history))
    // Continuation send of the same history appends the prefill.
    transport.setContinueFromContent('Roses are red,')
    await drain(await send(transport, history))

    expect(streamTextCalls).toHaveLength(2)
    const [normal, cont] = streamTextCalls
    const normalMessages = normal.messages as unknown[]
    const contMessages = cont.messages as unknown[]

    // The prefill adds exactly one trailing message; everything before it is
    // re-serialized byte-for-byte, so llama.cpp reuses the KV cache.
    expect(contMessages).toHaveLength(normalMessages.length + 1)
    expect(JSON.stringify(contMessages.slice(0, normalMessages.length))).toBe(
      JSON.stringify(normalMessages)
    )
  })

  it('consumes the prefill once (next send appends nothing)', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')

    transport.setContinueFromContent('Roses are red,')
    await drain(await send(transport, history))
    // A second send without re-setting must not re-append the prefill.
    await drain(await send(transport, history))

    expect(streamTextCalls).toHaveLength(2)
    const [withPrefill, without] = streamTextCalls
    const withMessages = withPrefill.messages as unknown[]
    const withoutMessages = without.messages as unknown[]
    expect(withMessages).toHaveLength(withoutMessages.length + 1)
    const last = (withoutMessages[withoutMessages.length - 1] as {
      role: string
    }).role
    expect(last).toBe('user')
  })
})
