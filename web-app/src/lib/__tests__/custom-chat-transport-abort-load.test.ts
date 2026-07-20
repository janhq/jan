import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'

// Regression test for https://github.com/janhq/jan/issues/8432 (Stop-during-load):
// aborting a request while ModelFactory.createModel() is still awaiting
// llama-server's "Loading model..." phase must (1) reject the in-flight
// sendMessages() call and (2) unload the (possibly still-loading) model via
// the tauri-plugin-llamacpp guest-js command directly, instead of silently
// ignoring the abort until the model finishes/times out.

const h = vi.hoisted(() => ({
  serviceHub: null as unknown,
  getLoadedModels: vi.fn(async () => [] as string[]),
  unloadLlamaModel: vi.fn(async () => ({ success: true })),
  resolveCreateModel: undefined as (() => void) | undefined,
  createModelMock: vi.fn(
    () =>
      new Promise((resolve) => {
        h.resolveCreateModel = () => resolve({ modelId: 'qwen3-4b' })
      })
  ),
}))

h.serviceHub = {
  mcp: () => ({ getTools: vi.fn(async () => []) }),
  rag: () => ({ getTools: async () => [] }),
}

const provider = { provider: 'llamacpp', api_key: '', models: [] }
const selectedModel = { id: 'qwen3-4b', capabilities: [] as string[] }

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
// Every getState() setter is a no-op; unknown reads resolve to undefined.
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
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  getLoadedModels: h.getLoadedModels,
  unloadLlamaModel: h.unloadLlamaModel,
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
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
vi.mock('@/lib/providerCaps', () => ({
  isPredefinedRemoteProvider: () => false,
  getProviderApiType: () => 'openai',
}))

// Simulates llama-server's real "Loading model..." phase: createModel()
// blocks until manually resolved, standing in for the 600s wait_until_loaded
// poll loop on the Rust side.
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: h.createModelMock },
}))
// The load-success path calls through to real streamText(), which validates
// the resolved model against AI SDK's LanguageModelV2 shape -- irrelevant to
// this test's concern (did createModelOrAbort resolve without unloading).
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

describe('CustomChatTransport: abort during model load', () => {
  beforeEach(() => {
    h.getLoadedModels.mockClear()
    h.unloadLlamaModel.mockClear()
    h.resolveCreateModel = undefined
  })

  it('rejects with AbortError and unloads the model when aborted mid-load', async () => {
    const transport = new CustomChatTransport()
    const controller = new AbortController()

    const send = transport.sendMessages({
      chatId: 'thread-1',
      messages: [user('m1', 'hi')],
      abortSignal: controller.signal,
      trigger: 'submit-message',
      messageId: undefined,
    })

    // Give sendMessages a tick to reach createModel() and start "loading".
    await Promise.resolve()
    await Promise.resolve()

    controller.abort()

    await expect(send).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.unloadLlamaModel).toHaveBeenCalledWith('qwen3-4b')
  })

  it('resolves normally when load finishes before any abort', async () => {
    const transport = new CustomChatTransport()
    const controller = new AbortController()

    const send = transport.sendMessages({
      chatId: 'thread-1',
      messages: [user('m1', 'hi')],
      abortSignal: controller.signal,
      trigger: 'submit-message',
      messageId: undefined,
    })

    await Promise.resolve()
    await Promise.resolve()
    h.resolveCreateModel?.()

    await expect(send).resolves.toBeDefined()
    expect(h.unloadLlamaModel).not.toHaveBeenCalled()
  })
})
