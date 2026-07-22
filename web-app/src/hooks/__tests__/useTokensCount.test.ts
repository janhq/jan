import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ThreadMessage } from '@janhq/core'
import { useTokensCount } from '../useTokensCount'
import { useAppState } from '../useAppState'

const mockGetModelProps = vi.fn()

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      getByName: () => ({ getModelProps: mockGetModelProps }),
      listExtensions: () => [],
    }),
  },
}))

const modelProviderState = {
  selectedModel: { id: 'model-1', name: 'Model One', capabilities: [], settings: {} } as Record<string, unknown>,
  selectedProvider: 'llamacpp' as string,
}

vi.mock('../useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: modelProviderState.selectedModel,
    selectedProvider: modelProviderState.selectedProvider,
    getProviderByName: () => ({ settings: [] }),
  }),
}))

function makeMessage(
  overrides: Partial<ThreadMessage> = {}
): ThreadMessage {
  return {
    id: 'm1',
    object: 'thread.message',
    thread_id: 'thread-1',
    role: 'assistant',
    content: [],
    status: 'ready' as ThreadMessage['status'],
    created_at: 1,
    completed_at: 1,
    metadata: {},
    ...overrides,
  } as ThreadMessage
}

describe('useTokensCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetModelProps.mockResolvedValue({ nCtx: 1000 })
    modelProviderState.selectedProvider = 'llamacpp'
    modelProviderState.selectedModel = {
      id: 'model-1',
      name: 'Model One',
      capabilities: [],
      settings: {},
    }
    act(() => {
      useAppState.setState({
        liveTokenStats: undefined,
        liveTokenStatsByThread: {},
      })
    })
  })

  it('falls back to the last message usage when no live stats are present', async () => {
    const messages = [
      makeMessage({ metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }),
    ]
    const { result } = renderHook(() => useTokensCount(messages))
    await waitFor(() => expect(result.current.modelProps).toBeDefined())
    expect(result.current.tokenCount).toBe(15)
  })

  it('prefers live per-thread token stats over the static last-message usage while streaming', async () => {
    const messages = [
      makeMessage({ metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }),
    ]
    act(() => {
      useAppState.getState().updateThreadLiveTokenStats('thread-1', {
        promptTokens: 900,
        completionTokens: 40,
        tokensPerSecond: 30,
        promptPerSecond: 60,
      })
    })
    const { result } = renderHook(() => useTokensCount(messages))
    await waitFor(() => expect(result.current.modelProps).toBeDefined())
    expect(result.current.tokenCount).toBe(940)
    expect(result.current.inputTokens).toBe(900)
    expect(result.current.outputTokens).toBe(40)
  })

  it('context overflow still takes priority over live stats', async () => {
    const messages = [
      makeMessage({
        metadata: {
          contextError: 'Context length exceeded (1200 tokens) is greater than context size (1000 tokens)',
        },
      }),
    ]
    act(() => {
      useAppState.getState().updateThreadLiveTokenStats('thread-1', {
        promptTokens: 50,
        completionTokens: 5,
        tokensPerSecond: 30,
        promptPerSecond: 60,
      })
    })
    const { result } = renderHook(() => useTokensCount(messages))
    await waitFor(() => expect(result.current.modelProps).toBeDefined())
    expect(result.current.isOverflow).toBe(true)
    expect(result.current.tokenCount).toBe(1200)
    expect(result.current.maxTokens).toBe(1000)
  })

  it('reports total usage for a remote provider without a percentage', async () => {
    modelProviderState.selectedProvider = 'openai'
    modelProviderState.selectedModel = {
      id: 'gpt-x',
      name: 'GPT X',
      capabilities: [],
      settings: {},
    }
    const messages = [
      makeMessage({ metadata: { usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 } } }),
    ]
    const { result } = renderHook(() => useTokensCount(messages))
    expect(result.current.tokenCount).toBe(140)
    expect(result.current.inputTokens).toBe(100)
    expect(result.current.outputTokens).toBe(40)
    expect(result.current.maxTokens).toBeUndefined()
    expect(result.current.percentage).toBeUndefined()
    expect(result.current.isNearLimit).toBe(false)
    expect(result.current.modelDisplayName).toBe('GPT X')
  })

  it('does not call llamacpp getModelProps for a remote provider', async () => {
    modelProviderState.selectedProvider = 'openai'
    const messages = [
      makeMessage({ metadata: { usage: { totalTokens: 10 } } }),
    ]
    renderHook(() => useTokensCount(messages))
    await Promise.resolve()
    expect(mockGetModelProps).not.toHaveBeenCalled()
  })

  it('treats mlx as local: uses getModelProps nCtx for a real percentage', async () => {
    modelProviderState.selectedProvider = 'mlx'
    modelProviderState.selectedModel = {
      id: 'mlx-model',
      name: 'MLX Model',
      capabilities: [],
      settings: {},
    }
    mockGetModelProps.mockResolvedValue({ nCtx: 8192, modelAlias: 'MLX Model' })
    const messages = [
      makeMessage({ metadata: { usage: { inputTokens: 3000, outputTokens: 1096, totalTokens: 4096 } } }),
    ]
    const { result } = renderHook(() => useTokensCount(messages))
    await waitFor(() => expect(result.current.modelProps).toBeDefined())
    expect(mockGetModelProps).toHaveBeenCalledWith('mlx-model')
    expect(result.current.tokenCount).toBe(4096)
    expect(result.current.maxTokens).toBe(8192)
    expect(result.current.percentage).toBeCloseTo(50, 5)
    expect(result.current.isNearLimit).toBe(false)
  })

  it('flags mlx near-limit when usage exceeds 85% of nCtx', async () => {
    modelProviderState.selectedProvider = 'mlx'
    modelProviderState.selectedModel = {
      id: 'mlx-model',
      name: 'MLX Model',
      capabilities: [],
      settings: {},
    }
    mockGetModelProps.mockResolvedValue({ nCtx: 1000 })
    const messages = [
      makeMessage({ metadata: { usage: { inputTokens: 800, outputTokens: 100, totalTokens: 900 } } }),
    ]
    const { result } = renderHook(() => useTokensCount(messages))
    await waitFor(() => expect(result.current.modelProps).toBeDefined())
    expect(result.current.isNearLimit).toBe(true)
  })

  it('reports zero tokens for a remote provider before any turn completes', async () => {
    modelProviderState.selectedProvider = 'anthropic'
    const messages = [makeMessage({ metadata: {} })]
    const { result } = renderHook(() => useTokensCount(messages))
    expect(result.current.tokenCount).toBe(0)
    expect(result.current.percentage).toBeUndefined()
  })

  it('context overflow still works when there are no live stats at all', async () => {
    const messages = [
      makeMessage({
        metadata: {
          contextError: 'Context length exceeded (1200 tokens) is greater than context size (1000 tokens)',
        },
      }),
    ]
    const { result } = renderHook(() => useTokensCount(messages))
    await waitFor(() => expect(result.current.modelProps).toBeDefined())
    expect(result.current.isOverflow).toBe(true)
    expect(result.current.tokenCount).toBe(1200)
    expect(result.current.maxTokens).toBe(1000)
  })
})
