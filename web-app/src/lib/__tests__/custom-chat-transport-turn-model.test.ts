import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// #9311: a tool-using turn keeps running when the user opens another thread,
// and opening it moves the global model selection to that thread's model. The
// turn's automatic follow-up must still go to the model and provider the turn
// started on, never to the open thread's (possibly remote) one.

const h = vi.hoisted(() => ({
  serviceHub: null as unknown,
  selection: {
    selectedProvider: 'llamacpp',
    selectedModel: { id: 'local-model', capabilities: [] as string[] },
  },
  createModelMock: vi.fn(async (modelId: string) => ({ modelId })),
}))

h.serviceHub = {
  mcp: () => ({ getTools: vi.fn(async () => []) }),
  rag: () => ({ getTools: async () => [] }),
}

const providers: Record<string, { provider: string; models: unknown[] }> = {
  llamacpp: { provider: 'llamacpp', models: [] },
  openai: { provider: 'openai', models: [] },
}

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: h.serviceHub }) },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: {
    getState: () => ({
      getDisabledTools: () => [],
      getDefaultDisabledTools: () => [],
    }),
  },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      ...h.selection,
      getProviderByName: (name: string) => providers[name],
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
  useMCPServers: { getState: () => ({ settings: {} }) },
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => new Proxy({}, { get: () => () => undefined }),
  },
}))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  getLoadedModels: vi.fn(async () => ['local-model']),
  unloadLlamaModel: vi.fn(),
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: vi.fn() },
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
  ModelFactory: { createModel: h.createModelMock },
}))
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    streamText: () => ({
      toUIMessageStream: () => new ReadableStream({ start: (c) => c.close() }),
    }),
  }
})

import { CustomChatTransport } from '../custom-chat-transport'

const user = (id: string, text: string): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

// The assistant turn whose tool call has its result: what the SDK resubmits
// automatically as the turn's follow-up.
const toolTurn = (id: string): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-fetch',
        toolCallId: `${id}-call`,
        state: 'output-available',
        input: {},
        output: 'result',
      },
    ],
  }) as UIMessage

const send = (
  transport: CustomChatTransport,
  messages: UIMessage[],
  trigger: 'submit-message' | 'regenerate-message' = 'submit-message'
) =>
  transport.sendMessages({
    chatId: 'thread-a',
    messages,
    abortSignal: undefined,
    trigger,
    messageId: undefined,
  })

const openOtherThreadOnRemoteModel = () => {
  h.selection = {
    selectedProvider: 'openai',
    selectedModel: { id: 'remote-model', capabilities: [] },
  }
}

describe('CustomChatTransport: a turn keeps its model', () => {
  beforeEach(() => {
    h.createModelMock.mockClear()
    h.selection = {
      selectedProvider: 'llamacpp',
      selectedModel: { id: 'local-model', capabilities: [] },
    }
  })

  it('sends the follow-up to the model the turn started on', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    await send(transport, [user('u1', 'look it up')])

    openOtherThreadOnRemoteModel()
    await send(transport, [user('u1', 'look it up'), toolTurn('a1')])

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'local-model',
      providers.llamacpp,
      expect.anything()
    )
    expect(transport.getTurnModelSelection()).toMatchObject({
      selectedProvider: 'llamacpp',
      selectedModel: { id: 'local-model' },
    })
  })

  it('starts a new turn on the current selection', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    await send(transport, [user('u1', 'look it up')])

    openOtherThreadOnRemoteModel()
    await send(transport, [user('u1', 'look it up'), toolTurn('a1'), user('u2', 'next')])

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'remote-model',
      providers.openai,
      expect.anything()
    )
  })

  // Regenerating the reply that followed a tool step sends the same history as
  // the automatic follow-up did, but the user asked for a new reply: it runs on
  // the model selected now.
  it('regenerates a follow-up reply on the current selection', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    await send(transport, [user('u1', 'look it up')])

    openOtherThreadOnRemoteModel()
    await send(
      transport,
      [user('u1', 'look it up'), toolTurn('a1')],
      'regenerate-message'
    )

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'remote-model',
      providers.openai,
      expect.anything()
    )
  })

  // Nothing to continue: a transport that never ran a turn has no model to keep.
  it('uses the current selection when no turn has run yet', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-a')
    openOtherThreadOnRemoteModel()
    await send(transport, [user('u1', 'look it up'), toolTurn('a1')])

    expect(h.createModelMock).toHaveBeenLastCalledWith(
      'remote-model',
      providers.openai,
      expect.anything()
    )
  })
})
