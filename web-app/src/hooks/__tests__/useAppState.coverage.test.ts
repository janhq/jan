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

  it('should set token speed directly', () => {
    const { result } = renderHook(() => useAppState())
    const msg = { id: 'msg-1', thread_id: 't1' } as any

    act(() => {
      result.current.setTokenSpeed(msg, 25.5, 100)
    })

    expect(result.current.tokenSpeed).toBeDefined()
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(25.5)
    expect(result.current.tokenSpeed?.tokenCount).toBe(100)
    expect(result.current.tokenSpeed?.message).toBe('msg-1')
  })

  it('should compute average token speed on subsequent updates', () => {
    const { result } = renderHook(() => useAppState())
    const msg = { id: 'msg-1', thread_id: 't1' } as any

    // First update initializes
    act(() => {
      result.current.updateTokenSpeed(msg, 1)
    })
    expect(result.current.tokenSpeed?.tokenCount).toBe(1)
    expect(result.current.tokenSpeed?.tokenSpeed).toBe(0)

    // Second update computes average
    act(() => {
      result.current.updateTokenSpeed(msg, 5)
    })
    expect(result.current.tokenSpeed?.tokenCount).toBe(6)
    expect(result.current.tokenSpeed?.tokenSpeed).toBeGreaterThan(0)
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
    expect(result.current.tokenSpeed).toBeUndefined()
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

  it('should set active models', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setActiveModels(['model-a', 'model-b'])
    })
    expect(result.current.activeModels).toEqual(['model-a', 'model-b'])
  })

  it('should update token speed with default increment', () => {
    const { result } = renderHook(() => useAppState())
    const msg = { id: 'msg-1', thread_id: 't1' } as any

    act(() => {
      result.current.updateTokenSpeed(msg)
    })
    expect(result.current.tokenSpeed?.tokenCount).toBe(1)
  })
})
