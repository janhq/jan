import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// A request that throws before its stream exists never reaches the stream's
// onError/onFinish, so it must release the "request in flight" marker itself:
// the hardware check is disabled for as long as that marker is set.

const h = vi.hoisted(() => ({
  serviceHub: null as unknown,
  app: { currentStreamThreadId: undefined as string | undefined },
  loads: [] as { reject: (e: unknown) => void }[],
}))

h.serviceHub = {
  mcp: () => ({ getTools: vi.fn(async () => []) }),
  rag: () => ({ getTools: async () => [] }),
}

const provider = { provider: 'llamacpp', api_key: '', models: [] }
const selectedModel = { id: 'broken', capabilities: [] as string[] }

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
      selectedModel,
      selectedProvider: 'llamacpp',
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
  useMCPServers: { getState: () => ({ settings: {} }) },
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () =>
      new Proxy(h.app, {
        get: (target, key) => {
          if (key === 'currentStreamThreadId') return target.currentStreamThreadId
          if (key === 'setCurrentStreamThreadId')
            return (id: string | undefined) => {
              target.currentStreamThreadId = id
            }
          return () => undefined
        },
      }),
  },
}))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  getLoadedModels: async () => [],
  unloadLlamaModel: async () => ({ success: true }),
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
  ModelFactory: {
    createModel: () =>
      new Promise((_, reject) => {
        h.loads.push({ reject })
      }),
  },
}))

import { CustomChatTransport } from '../custom-chat-transport'

const user = (id: string, text: string): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

const send = (transport: CustomChatTransport, chatId: string) =>
  transport.sendMessages({
    chatId,
    messages: [user('m1', 'hi')],
    abortSignal: undefined,
    trigger: 'submit-message',
    messageId: undefined,
  })

const loadStarted = async (count: number) => {
  await vi.waitFor(() => expect(h.loads).toHaveLength(count))
}

describe('CustomChatTransport: a failed model load', () => {
  beforeEach(() => {
    h.app.currentStreamThreadId = undefined
    h.loads.length = 0
  })

  it('clears the in-flight stream marker', async () => {
    const transport = new CustomChatTransport()
    const pending = send(transport, 'thread-1')
    await loadStarted(1)
    expect(h.app.currentStreamThreadId).toBe('thread-1')

    h.loads[0].reject(new Error('failed to load model'))

    await expect(pending).rejects.toThrow()
    expect(h.app.currentStreamThreadId).toBeUndefined()
  })

  it('leaves the marker of a newer request alone', async () => {
    const transport = new CustomChatTransport()
    const first = send(transport, 'thread-1')
    await loadStarted(1)
    const second = send(transport, 'thread-2')
    await loadStarted(2)

    h.loads[0].reject(new Error('failed to load model'))
    await expect(first).rejects.toThrow()
    expect(h.app.currentStreamThreadId).toBe('thread-2')

    h.loads[1].reject(new Error('failed to load model'))
    await expect(second).rejects.toThrow()
    expect(h.app.currentStreamThreadId).toBeUndefined()
  })
})
