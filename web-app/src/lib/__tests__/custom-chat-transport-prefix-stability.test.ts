import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// Capture every streamText({...}) call so we can compare the prompt prefix
// (system + tools + prior model messages) across consecutive turns.
const streamTextCalls: Array<Record<string, unknown>> = []
// What each request stamps on its reply's start part.
const startMetadata: unknown[] = []

const h = vi.hoisted(() => ({
  disabledTools: [] as string[],
  servers: ['srv'] as string[],
  getRelevantTools: vi.fn(),
  getModelProps: vi.fn(),
  assistantParameters: null as Record<string, unknown> | null,
  providerId: 'openai',
  serviceHub: null as unknown,
  predefinedRemote: false,
  ragTools: [] as Array<{ name: string; description: string; inputSchema: object; server: string }>,
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
  rag: () => ({ getTools: async () => h.ragTools }),
}

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    streamText: (args: Record<string, unknown>) => {
      streamTextCalls.push(args)
      return {
        toUIMessageStream: (opts?: {
          messageMetadata?: (o: { part: { type: string } }) => unknown
        }) => {
          startMetadata.push(
            opts?.messageMetadata?.({ part: { type: 'start' } })
          )
          return new ReadableStream({
            start(controller) {
              controller.close()
            },
          })
        },
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
// resolve to undefined. No extension contributes tools.
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () =>
      new Proxy(
        {},
        {
          get: (_target, key) =>
            key === 'extensionTools' ? [] : () => undefined,
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
  isPredefinedRemoteProvider: () => h.predefinedRemote,
  getProviderApiType: () => 'openai',
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn(async () => ({ modelId: 'gpt' })) },
}))

import { useChatPlan } from '@/hooks/useChatPlan'
import { CustomChatTransport } from '../custom-chat-transport'
import { CoworkChatTransport } from '../coworkTransport'
import { ModelFactory } from '../model-factory'

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
    useChatPlan.setState({ drafts: {} })
    streamTextCalls.length = 0
    h.disabledTools = []
    h.ragTools = []
    h.servers = ['srv']
    h.providerId = 'openai'
    h.assistantParameters = null
    h.getModelProps.mockReset()
    provider.provider = 'openai'
    provider.settings = []
    selectedModel.id = 'gpt'
    selectedModel.capabilities = ['tools']
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([
      { name: 'tool_a', description: 'a', inputSchema: {}, server: 'srv' },
    ])
  })

  it('freezes Plan prompt and advertisement until a validated review transition', async () => {
    useChatPlan.getState().setDraft('thread-1', true)
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    const finish = transport.beginChatRun()
    try {
      await drain(await send(transport, [user('u1', 'investigate')]))
      expect(String(streamTextCalls.at(-1)?.system)).toContain('PLAN MODE (read only)')
      expect(Object.keys(streamTextCalls.at(-1)?.tools as object)).not.toContain('tool_a')
      expect(transport.planToolRefusal('shell')).toContain('read-only')
      useChatPlan.getState().setDraft('thread-1', false)
      expect(transport.planToolRefusal('shell')).toContain('read-only')
      transport.executeReviewedPlan()
      await drain(await send(transport, [user('u1', 'investigate')]))
      expect(String(streamTextCalls.at(-1)?.system)).not.toContain('PLAN MODE (read only)')
      expect(transport.planToolRefusal('shell')).toBeUndefined()
      useChatPlan.getState().setDraft('thread-1', true)
      expect(transport.planToolRefusal('shell')).toContain('read-only')
    } finally { finish() }
  })

  it.each([false, true])('Plan advertises trusted attachment reads but rejects MCP collisions (spoof=%s)', async (spoof) => {
    useChatPlan.getState().setDraft('thread-1', true)
    h.ragTools = ['retrieve', 'list_attachments', 'get_chunks'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, server: 'rag' }))
    if (spoof) {
      const external = h.ragTools.map(tool => ({ ...tool, server: 'external' }))
      h.getRelevantTools.mockResolvedValue(external)
      mcpService.getTools.mockResolvedValueOnce(external as never).mockResolvedValueOnce(external as never)
    }
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    await transport.updateRagToolsAvailability(!spoof, true, true)
    const finish = transport.beginChatRun()
    try {
      await drain(await send(transport, [user('u1', 'read attachments')]))
      const tools = Object.keys(streamTextCalls.at(-1)?.tools as object)
      for (const { name } of h.ragTools) {
        if (spoof) {
          expect(tools).not.toContain(name)
        } else {
          expect(tools).toContain(name)
          expect(transport.planToolRefusal(name)).toBeUndefined()
        }
      }
    } finally { finish() }
  })

  it('latches Plan activated during an initially normal run even between dispatches', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    const finish = transport.beginChatRun()
    try {
      await drain(await send(transport, [user('u1', 'investigate')]))
      useChatPlan.getState().setDraft('thread-1', true)
      useChatPlan.getState().setDraft('thread-1', false)
      expect(transport.isPlanActive()).toBe(true)
      expect(transport.planToolRefusal('shell')).toContain('read-only')
      await drain(await send(transport, [user('u1', 'investigate')]))
      expect(String(streamTextCalls.at(-1)?.system)).toContain('PLAN MODE (read only)')
      transport.executeReviewedPlan()
      expect(transport.isPlanActive()).toBe(false)
      expect(transport.planToolRefusal('shell')).toBeUndefined()
    } finally { finish() }
  })

  it('never reinterprets slash paths or removed skills from reloaded history', async () => {
    const messages = [user('u1', '/tmp/logs'), assistant('a1', 'ok'), user('u2', '/skill:deleted'), assistant('a2', 'done'), user('u3', 'continue')]
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    await drain(await send(transport, messages))
    const sent = JSON.stringify(streamTextCalls.at(-1)?.messages)
    expect(sent).toContain('/tmp/logs')
    expect(sent).toContain('/skill:deleted')
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

  it('trims history to the loaded llama.cpp context window before streaming', async () => {
    h.providerId = 'llamacpp'
    h.getModelProps.mockResolvedValue({ nCtx: 4096 })
    provider.provider = 'llamacpp'
    provider.settings = [
      { key: 'ctx_shift', controller_props: { value: true } },
    ]
    selectedModel.id = 'llama-local'

    const transport = new CustomChatTransport('you are jan', 'thread-1')
    await drain(
      await send(transport, [
        user('u1', `old-user ${'context '.repeat(1_200)}`),
        assistant('a1', `old-assistant ${'context '.repeat(1_200)}`),
        user('u2', `latest-user ${'context '.repeat(1_200)}`),
      ])
    )

    const requestMessages = streamTextCalls[0].messages as unknown[]
    const serialized = JSON.stringify(requestMessages)
    expect(h.getModelProps).toHaveBeenCalledWith('llama-local')
    expect(requestMessages).toHaveLength(1)
    expect(serialized).not.toContain('old-user')
    expect(serialized).toContain('latest-user')
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

  it('keeps the configured limit when llama.cpp context shift is disabled', async () => {
    h.providerId = 'llamacpp'
    h.getModelProps.mockResolvedValue({ nCtx: 4096 })
    h.assistantParameters = {
      max_context_tokens: 12_000,
      max_output_tokens: 2048,
    }
    provider.provider = 'llamacpp'
    selectedModel.id = 'llama-local'

    const transport = new CustomChatTransport('you are jan', 'thread-1')
    await drain(
      await send(transport, [
        user('u1', `first-user ${'context '.repeat(1_200)}`),
        assistant('a1', `first-assistant ${'context '.repeat(1_200)}`),
        user('u2', `latest-user ${'context '.repeat(1_200)}`),
      ])
    )

    const requestMessages = streamTextCalls[0].messages as unknown[]
    expect(h.getModelProps).not.toHaveBeenCalled()
    expect(requestMessages).toHaveLength(3)
  })
})

describe('CustomChatTransport assistant completion (continuation prefill)', () => {
  beforeEach(() => {
    useChatPlan.setState({ drafts: {} })
    streamTextCalls.length = 0
    h.disabledTools = []
    h.servers = ['srv']
    h.providerId = 'openai'
    h.assistantParameters = null
    h.getModelProps.mockReset()
    provider.provider = 'openai'
    provider.settings = []
    selectedModel.id = 'gpt'
    selectedModel.capabilities = ['tools']
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

  // The continued reply replaces the stopped one, so it has to keep that
  // reply's author even when it now runs on a built-in model.
  it('stamps the continued reply with the partial reply author', async () => {
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    startMetadata.length = 0
    transport.setContinueFromContent({
      text: 'Roses are red,',
      extensionAuthor: 'acme.provider',
    })
    await drain(await send(transport, history))
    await drain(await send(transport, history))
    expect(startMetadata).toEqual([
      { extensionAuthor: 'acme.provider' },
      undefined,
    ])
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

// Anthropic falls back to the model's maximum max_tokens when no cap reaches
// the SDK, and counts it against the context window (janhq/jan#9227).
describe('CustomChatTransport output-token cap', () => {
  beforeEach(() => {
    useChatPlan.setState({ drafts: {} })
    streamTextCalls.length = 0
    h.providerId = 'anthropic'
    h.predefinedRemote = true
    provider.provider = 'anthropic'
    provider.settings = []
    selectedModel.id = 'gpt'
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([])
  })

  it('passes the assistant cap to streamText as maxOutputTokens for a predefined remote provider', async () => {
    h.assistantParameters = { max_output_tokens: '4096' }
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    await drain(await send(transport, [user('u1', 'hello')]))

    expect(streamTextCalls[0].maxOutputTokens).toBe(4096)
    expect(streamTextCalls[0]).not.toHaveProperty('maxTokens')
  })

  it('omits maxOutputTokens when the cap is 0 ("no cap") so the SDK does not reject it', async () => {
    h.assistantParameters = { max_output_tokens: 0 }
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    await drain(await send(transport, [user('u1', 'hello')]))

    expect(streamTextCalls[0]).not.toHaveProperty('maxOutputTokens')
  })

  afterAll(() => {
    h.predefinedRemote = false
  })
})

it('keeps a Cowork run on its chosen model when the viewed model changes between steps', async () => {
  provider.provider = 'openai'
  h.providerId = 'openai'
  selectedModel.id = 'gpt'
  const transport = new CoworkChatTransport('session-a', {
    model: { provider: 'openai', id: 'gpt' },
    workspacePath: null,
    readOnlyFolder: null,
    planMode: false,
    webSearch: false,
    allowSubagents: false,
    subagentNames: [],
  })
  vi.mocked(ModelFactory.createModel).mockClear()
  await drain(await send(transport, [user('first', 'First step')]))
  selectedModel.id = 'other-session-model'
  await drain(await send(transport, [user('next', 'Next step')]))
  expect(vi.mocked(ModelFactory.createModel).mock.calls.map(([id]) => id)).toEqual(['gpt', 'gpt'])
})

// The filesystem server's `read_media_file` result, stored as its MCP content
// array. Sent as-is, the SDK stringifies it and the model gets the base64 as
// text; the transport must turn it into a tool image first.
const mcpImageTurn = (): UIMessage[] => [
  user('u1', 'look at the frame'),
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-read_media_file',
        toolCallId: 'c1',
        state: 'output-available',
        input: { path: '/frames/a.png' },
        output: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
      },
    ],
  } as unknown as UIMessage,
]

// OpenAI-compatible providers get a sentinel, which the request fetch decodes
// into an `image_url` part on the `role: tool` message.
it('sends an MCP image result to an OpenAI-compatible provider as a sentinel', async () => {
  streamTextCalls.length = 0
  provider.provider = 'groq'
  h.providerId = 'groq'
  selectedModel.id = 'gpt'
  selectedModel.capabilities = ['tools', 'vision']
  const transport = new CustomChatTransport('you are jan', 'thread-1')
  await drain(await send(transport, mcpImageTurn()))
  const sent = JSON.stringify(streamTextCalls[0].messages)
  expect(sent).toMatch(
    /__JAN_TOOL_IMAGE__[0-9a-f]{32}:data:image\/png;base64,iVBORw0KGgo=/
  )
  expect(sent).not.toContain('mimeType')
})

// Anthropic, Gemini and OpenAI Responses build their own request, so the
// image must reach the SDK as structured tool output.
it.each(['anthropic', 'google', 'openai'])(
  'sends an MCP image result to %s as an image-data tool output',
  async (name) => {
    useChatPlan.setState({ drafts: {} })
    streamTextCalls.length = 0
    provider.provider = name
    h.providerId = name
    selectedModel.id = 'gpt'
    selectedModel.capabilities = ['tools', 'vision']
    const transport = new CustomChatTransport('you are jan', 'thread-1')
    await drain(await send(transport, mcpImageTurn()))
    const sent = JSON.stringify(streamTextCalls[0].messages)
    expect(sent).toContain(
      '"type":"image-data","mediaType":"image/png","data":"iVBORw0KGgo="'
    )
    expect(sent).not.toContain('__JAN_TOOL_IMAGE__')
  }
)

// Exercise the new adapter's actual canonical output through the production
// transport media/tool-wave pipeline, not SDK conversion alone.
it.each(['groq', 'anthropic', 'google', 'openai'])(
  'Chat runner typed MCP/RAG/media live and reload requests match for %s',
  async (name) => {
    const { createChatRunStream } = await import('../chatRunTransport')
    const { readUIMessageStream } = await import('ai')
    const { assistantRecordFields, convertThreadMessageToUIMessage } = await import('../messages')
    const chunks = (values: unknown[]) => new ReadableStream({ start(c) { values.forEach(v => c.enqueue(v)); c.close() } })
    const initial = user('u-fixture', 'controlled media fixture')
    let n = 0
    const responses = [
      chunks([{ type: 'start-step' }, ...['image', 'empty', 'zero', 'false', 'rag'].map(toolCallId => ({ type: 'tool-input-available', toolCallId, toolName: `fixture_${toolCallId}`, input: {} })), { type: 'finish-step' }, { type: 'finish' }]),
      chunks([{ type: 'start-step' }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'fixture done' }, { type: 'text-end', id: 't' }, { type: 'finish-step' }, { type: 'finish' }]),
    ]
    const outputs: Record<string, unknown> = {
      image: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
      empty: '', zero: 0, false: false, rag: [{ type: 'text', text: 'retrieved fixture' }],
    }
    let live: UIMessage | undefined
    for await (const message of readUIMessageStream({ stream: createChatRunStream({
      messages: [initial], messageId: 'a-fixture', signal: new AbortController().signal,
      sendStep: async () => responses[n++], dispatch: async call => ({ output: outputs[call.toolCallId] }),
    }) })) live = message
    const record = JSON.parse(JSON.stringify({ id: live!.id, thread_id: 'thread-1', role: 'assistant', status: 'ready', created_at: 1, completed_at: 1, ...assistantRecordFields(live!, {}, {}) }))
    const reloaded = convertThreadMessageToUIMessage(record)
    provider.provider = name
    h.providerId = name
    selectedModel.id = 'gpt'
    selectedModel.capabilities = ['tools', 'vision']
    useChatPlan.setState({ drafts: {} })
    streamTextCalls.length = 0
    const transport = new CustomChatTransport('fixture system', 'thread-1')
    await drain(await send(transport, [initial, live!]))
    await drain(await send(transport, [initial, reloaded]))
    expect(streamTextCalls[1].messages).toEqual(streamTextCalls[0].messages)
    const wire = JSON.stringify(streamTextCalls[0].messages)
    expect(wire).toContain(name === 'groq' ? '__JAN_TOOL_IMAGE__data:image/png;base64,iVBORw0KGgo=' : 'image-data')
    expect(wire).toContain('retrieved fixture')
    // Losing uiParts would corrupt falsy tool outcomes/wave boundaries.
    const legacy = convertThreadMessageToUIMessage({ ...record, metadata: {} })
    await drain(await send(transport, [initial, legacy]))
    expect(streamTextCalls[2].messages).not.toEqual(streamTextCalls[0].messages)
  }
)

it('does not send persisted Chat cap notices back through the production model conversion', async () => {
  const { CHAT_RUN_NOTICE_METADATA } = await import('../chatRunNotice')
  const transport = new CustomChatTransport('fixture system', 'thread-1')
  const message: UIMessage = { id: 'stopped', role: 'assistant', parts: [
    { type: 'text', text: 'Actual partial answer', state: 'done' },
    { type: 'text', text: 'DISPLAY_ONLY_CAP_NOTICE', state: 'done', providerMetadata: CHAT_RUN_NOTICE_METADATA },
  ] }
  streamTextCalls.length = 0
  await drain(await send(transport, [user('u-notice', 'fixture'), message]))
  const wire = JSON.stringify(streamTextCalls[0].messages)
  expect(wire).toContain('Actual partial answer')
  expect(wire).not.toContain('DISPLAY_ONLY_CAP_NOTICE')
  expect(wire).not.toContain('chatRunNotice')
})

// Real production path: a stored Chat assistant turn carrying `data-run-context`
// (assistantRecordFields -> JSON -> converter) goes through the actual
// CustomChatTransport.sendMessages. The captured provider request must carry the
// ping answer exactly once, as a marked USER turn, never as assistant prefill.
// Removing the production `expandChatRunContext` call in custom-chat-transport.ts
// must fail this test.
it('reloaded data-run-context reaches the provider request once, as a user turn', async () => {
  // This standalone case must not inherit provider/context settings from earlier suites.
  h.providerId = 'openai'
  h.assistantParameters = { ctx_len: 32768, max_tokens: 1024 }
  h.predefinedRemote = false
  provider.provider = 'openai'
  provider.settings = []
  selectedModel.id = 'gpt'
  selectedModel.capabilities = ['tools']
  h.getModelProps.mockReset()

  const { assistantRecordFields, convertThreadMessageToUIMessage } = await import('../messages')
  const { RUN_CONTEXT_PART } = await import('../chatRunContext')
  const ANSWER = 'UNIQUE-RUN-CONTEXT-ANSWER-5803'
  const stored: UIMessage = {
    id: 'a-ctx',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      { type: 'tool-task', toolCallId: 'tc1', state: 'output-available', input: { name: 'a' }, output: 'Dispatched 1 subagent(s)' },
      { type: 'data-task-status', id: 'task-status:tk:a', data: { subagents: [{ runId: 'tk:a', name: 'a', status: 'done', startedAt: 1, endedAt: 2, finalOutput: 'STATUS-ONLY-ROW' }] } },
      { type: 'data-tool-diff', id: 'diff-1', data: { toolCallId: 'tc1', diff: 'DISPLAY-ONLY-DIFF' } },
      { type: 'text', text: 'dispatched, waiting', state: 'done' },
      { type: RUN_CONTEXT_PART, data: { text: `Subagent 'a' (tk:a) finished. Its answer:\n\n${ANSWER}` } },
      { type: 'text', text: 'the child said so', state: 'done' },
    ],
  } as UIMessage
  const fields = assistantRecordFields(stored, {}, { stopped: false })
  expect(fields.metadata).not.toHaveProperty('uiPartsSkipped')
  const record = JSON.parse(JSON.stringify({
    id: stored.id, thread_id: 'thread-1', role: 'assistant', status: 'ready', object: 'thread.message',
    created_at: 1, completed_at: 1, ...fields,
  }))
  const reloaded = convertThreadMessageToUIMessage(record)
  expect(reloaded.parts.filter((p) => p.type === RUN_CONTEXT_PART)).toHaveLength(1)

  const transport = new CustomChatTransport('fixture system', 'thread-1')
  streamTextCalls.length = 0
  await drain(await send(transport, [user('u-ctx', 'delegate it'), reloaded, user('u-next', 'and now?')]))

  expect(streamTextCalls).toHaveLength(1) // one request, no child re-execution
  const messages = streamTextCalls[0].messages as Array<{ role: string; content: unknown }>
  const holders = messages.filter((m) => JSON.stringify(m).includes(ANSWER))
  expect(holders).toHaveLength(1)
  expect(holders[0].role).toBe('user')
  expect(JSON.stringify(holders[0])).toContain('<SYSTEM>')
  expect(JSON.stringify(holders[0])).toContain('</SYSTEM>')
  const wire = JSON.stringify(streamTextCalls[0].messages)
  expect(wire.split(ANSWER)).toHaveLength(2)
  // Not assistant prefill: the request ends on the user's next turn.
  expect(messages[messages.length - 1].role).toBe('user')
  expect(JSON.stringify(messages[messages.length - 1])).not.toContain(ANSWER)
  for (const m of messages.filter((x) => x.role === 'assistant')) expect(JSON.stringify(m)).not.toContain(ANSWER)
  // Display-only parts never reach the model.
  for (const banned of ['task-status', 'STATUS-ONLY-ROW', 'DISPLAY-ONLY-DIFF', 'data-tool-diff', RUN_CONTEXT_PART])
    expect(wire).not.toContain(banned)
})
