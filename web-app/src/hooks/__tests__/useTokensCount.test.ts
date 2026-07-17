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

vi.mock('../useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: { id: 'model-1', name: 'Model One', capabilities: [], settings: {} },
    selectedProvider: 'llamacpp',
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
