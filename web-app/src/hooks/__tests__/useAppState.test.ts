import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppState } from '../useAppState'

<<<<<<< HEAD
// Mock the useAssistant hook as a Zustand store
vi.mock('../useAssistant', () => ({
  useAssistant: Object.assign(
    vi.fn(() => ({
      selectedAssistant: null,
      updateAssistantTools: vi.fn()
    })),
    {
      getState: vi.fn(() => ({
        currentAssistant: { id: 'test-assistant', name: 'Test Assistant' },
        assistants: [{ id: 'test-assistant', name: 'Test Assistant' }]
      }))
    }
  )
}))
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

describe('useAppState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store
    act(() => {
      useAppState.setState({
        streamingContent: undefined,
        loadingModel: false,
        tools: [],
        serverStatus: 'stopped',
        abortControllers: {},
        tokenSpeed: undefined,
        currentToolCall: undefined,
        showOutOfContextDialog: false
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAppState())
    
    expect(result.current.streamingContent).toBeUndefined()
    expect(result.current.loadingModel).toBe(false)
    expect(result.current.tools).toEqual([])
    expect(result.current.serverStatus).toBe('stopped')
    expect(result.current.abortControllers).toEqual({})
    expect(result.current.tokenSpeed).toBeUndefined()
    expect(result.current.currentToolCall).toBeUndefined()
    expect(result.current.showOutOfContextDialog).toBe(false)
  })

  it('should update streaming content', () => {
    const { result } = renderHook(() => useAppState())
<<<<<<< HEAD
    
    const content = { id: 'msg-1', content: 'Hello', role: 'user' }
    
    act(() => {
      result.current.updateStreamingContent(content)
    })
    
    // The function adds created_at and metadata.assistant
    expect(result.current.streamingContent).toMatchObject({
      ...content,
      created_at: expect.any(Number),
      metadata: {
        assistant: { id: 'test-assistant', name: 'Test Assistant' }
      }
=======

    const content = { id: 'msg-1', content: 'Hello', role: 'user' }

    act(() => {
      result.current.updateStreamingContent(content)
    })

    // The function adds created_at if not present
    expect(result.current.streamingContent).toMatchObject({
      ...content,
      created_at: expect.any(Number),
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })
  })

  it('should update loading model state', () => {
    const { result } = renderHook(() => useAppState())
    
    act(() => {
      result.current.updateLoadingModel(true)
    })
    
    expect(result.current.loadingModel).toBe(true)
    
    act(() => {
      result.current.updateLoadingModel(false)
    })
    
    expect(result.current.loadingModel).toBe(false)
  })

  it('should update tools', () => {
    const { result } = renderHook(() => useAppState())
    
    const tools = [
      { name: 'tool1', description: 'First tool' },
      { name: 'tool2', description: 'Second tool' }
    ]
    
    act(() => {
      result.current.updateTools(tools)
    })
    
    expect(result.current.tools).toEqual(tools)
  })

  it('should update server status', () => {
    const { result } = renderHook(() => useAppState())
    
    act(() => {
      result.current.setServerStatus('running')
    })
    
    expect(result.current.serverStatus).toBe('running')
    
    act(() => {
      result.current.setServerStatus('pending')
    })
    
    expect(result.current.serverStatus).toBe('pending')
  })

  it('should set abort controller', () => {
    const { result } = renderHook(() => useAppState())
    
    const controller = new AbortController()
    
    act(() => {
      result.current.setAbortController('thread-123', controller)
    })
    
    expect(result.current.abortControllers['thread-123']).toBe(controller)
  })

  it('should update current tool call', () => {
    const { result } = renderHook(() => useAppState())
    
    const toolCall = {
      id: 'call-123',
      type: 'function' as const,
      function: { name: 'test_function', arguments: '{}' }
    }
    
    act(() => {
      result.current.updateCurrentToolCall(toolCall)
    })
    
    expect(result.current.currentToolCall).toEqual(toolCall)
  })

  it('should set out of context dialog', () => {
    const { result } = renderHook(() => useAppState())
    
    act(() => {
      result.current.setOutOfContextDialog(true)
    })
    
    expect(result.current.showOutOfContextDialog).toBe(true)
    
    act(() => {
      result.current.setOutOfContextDialog(false)
    })
    
    expect(result.current.showOutOfContextDialog).toBe(false)
  })

  it('should update token speed', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello world',
      role: 'assistant',
      created_at: Date.now(),
      thread_id: 'thread-123'
    }
    
    act(() => {
      result.current.updateTokenSpeed(message)
    })
    
    // Token speed calculation depends on implementation
    expect(result.current.tokenSpeed).toBeDefined()
  })

  it('should reset token speed', () => {
    const { result } = renderHook(() => useAppState())
    
    const message = {
      id: 'msg-1',
      content: 'Hello world',
      role: 'assistant',
      created_at: Date.now(),
      thread_id: 'thread-123'
    }
    
    act(() => {
      result.current.updateTokenSpeed(message)
    })
    
    expect(result.current.tokenSpeed).toBeDefined()
    
    act(() => {
      result.current.resetTokenSpeed()
    })
    
    expect(result.current.tokenSpeed).toBeUndefined()
  })
})
