import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppState } from '../useAppState'

describe('useAppState - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useAppState.setState({
        streamingContent: undefined,
        loadingModel: false,
        tools: [],
        ragToolNames: new Set<string>(),
        mcpToolNames: new Set<string>(),
        serverStatus: 'stopped',
        abortControllers: {},
        tokenSpeed: undefined,
        showOutOfContextDialog: false,
        cancelToolCall: undefined,
        errorMessage: undefined,
        promptProgress: undefined,
        activeModels: [],
      })
    })
  })

  it('should clear streaming content when passing undefined', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateStreamingContent({ id: 'msg-1', content: 'Hi', role: 'user', thread_id: 't1', created_at: 123 } as any)
    })
    expect(result.current.streamingContent).toBeDefined()

    act(() => {
      result.current.updateStreamingContent(undefined)
    })
    expect(result.current.streamingContent).toBeUndefined()
  })

  it('should add created_at when content has no created_at', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateStreamingContent({ id: 'msg-1', content: 'Hi', role: 'user', thread_id: 't1' } as any)
    })
    expect(result.current.streamingContent?.created_at).toBeGreaterThan(0)
  })

  it('should update rag tool names', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateRagToolNames(['rag1', 'rag2'])
    })

    expect(result.current.ragToolNames).toEqual(new Set(['rag1', 'rag2']))
  })

  it('should update mcp tool names', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateMcpToolNames(['mcp1', 'mcp2'])
    })

    expect(result.current.mcpToolNames).toEqual(new Set(['mcp1', 'mcp2']))
  })

  it('should clear app state', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateStreamingContent({ id: 'x', content: 'y', role: 'user', thread_id: 't', created_at: 1 } as any)
      result.current.setAbortController('t1', new AbortController())
      result.current.setOutOfContextDialog(true)
      result.current.setErrorMessage({ subtitle: 'err' })
      result.current.setCancelToolCall(() => {})
    })

    act(() => {
      result.current.clearAppState()
    })

    expect(result.current.streamingContent).toBeUndefined()
    expect(result.current.abortControllers).toEqual({})
    expect(result.current.showOutOfContextDialog).toBe(false)
    expect(result.current.errorMessage).toBeUndefined()
    expect(result.current.cancelToolCall).toBeUndefined()
  })

  it('should set and clear cancel tool call', () => {
    const { result } = renderHook(() => useAppState())
    const fn = vi.fn()

    act(() => {
      result.current.setCancelToolCall(fn)
    })
    expect(result.current.cancelToolCall).toBe(fn)

    act(() => {
      result.current.setCancelToolCall(undefined)
    })
    expect(result.current.cancelToolCall).toBeUndefined()
  })

  it('should set error message', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setErrorMessage({ subtitle: 'Something went wrong', title: 'Error', message: 'Details' })
    })
    expect(result.current.errorMessage?.subtitle).toBe('Something went wrong')

    act(() => {
      result.current.setErrorMessage(undefined)
    })
    expect(result.current.errorMessage).toBeUndefined()
  })

  it('should update prompt progress', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updatePromptProgress({ cache: 10, processed: 50, time_ms: 200, total: 100 })
    })
    expect(result.current.promptProgress).toEqual({ cache: 10, processed: 50, time_ms: 200, total: 100 })

    act(() => {
      result.current.updatePromptProgress(undefined)
    })
    expect(result.current.promptProgress).toBeUndefined()
  })

  it('should update live token stats globally and per-thread', () => {
    const { result } = renderHook(() => useAppState())
    const stats = {
      promptTokens: 12,
      completionTokens: 34,
      tokensPerSecond: 56.7,
      promptPerSecond: 89.1,
    }

    act(() => {
      result.current.updateLiveTokenStats(stats)
      result.current.updateThreadLiveTokenStats('t1', stats)
    })
    expect(result.current.liveTokenStats).toEqual(stats)
    expect(result.current.liveTokenStatsByThread['t1']).toEqual(stats)

    act(() => {
      result.current.updateLiveTokenStats(undefined)
      result.current.updateThreadLiveTokenStats('t1', undefined)
    })
    expect(result.current.liveTokenStats).toBeUndefined()
    expect(result.current.liveTokenStatsByThread['t1']).toBeUndefined()
  })

  it('should clear liveTokenStatsByThread on clearThreadState', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateThreadLiveTokenStats('t1', {
        promptTokens: 1,
        completionTokens: 2,
        tokensPerSecond: 3,
        promptPerSecond: 4,
      })
      result.current.clearThreadState('t1')
    })
    expect(result.current.liveTokenStatsByThread['t1']).toBeUndefined()
  })

  it('should update model load progress globally and per-thread', () => {
    const { result } = renderHook(() => useAppState())
    const progress = { modelId: 'model-1', value: 0.42, stage: 'text_model' }

    act(() => {
      result.current.updateModelLoadProgress(progress)
      result.current.updateThreadModelLoadProgress('t1', progress)
    })
    expect(result.current.modelLoadProgress).toEqual(progress)
    expect(result.current.modelLoadProgressByThread['t1']).toEqual(progress)

    act(() => {
      result.current.updateModelLoadProgress(undefined)
      result.current.updateThreadModelLoadProgress('t1', undefined)
    })
    expect(result.current.modelLoadProgress).toBeUndefined()
    expect(result.current.modelLoadProgressByThread['t1']).toBeUndefined()
  })

  it('should clear modelLoadProgressByThread on clearThreadState', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateThreadModelLoadProgress('t1', {
        modelId: 'model-1',
        value: 0.5,
      })
      result.current.clearThreadState('t1')
    })
    expect(result.current.modelLoadProgressByThread['t1']).toBeUndefined()
  })

  it('should set active models', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveModels(['model-a', 'model-b'])
    })
    expect(result.current.activeModels).toEqual(['model-a', 'model-b'])
  })

  it('should remove a single active model', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveModels(['model-a', 'model-b'])
      result.current.removeActiveModel('model-a')
    })
    expect(result.current.activeModels).toEqual(['model-b'])
  })

  it('should no-op removing a model that is not active', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveModels(['model-a'])
      result.current.removeActiveModel('model-does-not-exist')
    })
    expect(result.current.activeModels).toEqual(['model-a'])
  })

})
