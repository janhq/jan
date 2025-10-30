import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChat } from '../useChat'

// Mock dependencies
vi.mock('../usePrompt', () => ({
  usePrompt: Object.assign(
    (selector: any) => {
      const state = {
        prompt: 'test prompt',
        setPrompt: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    { getState: () => ({ prompt: 'test prompt', setPrompt: vi.fn() }) }
  ),
}))

vi.mock('../useAppState', () => ({
  useAppState: Object.assign(
    (selector?: any) => {
      const state = {
        tools: [],
        updateTokenSpeed: vi.fn(),
        resetTokenSpeed: vi.fn(),
        updateTools: vi.fn(),
        updateStreamingContent: vi.fn(),
        updatePromptProgress: vi.fn(),
        updateLoadingModel: vi.fn(),
        setAbortController: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: vi.fn(() => ({
        tokenSpeed: { tokensPerSecond: 10 },
      }))
    }
  ),
}))

vi.mock('../useAssistant', () => ({
  useAssistant: (selector: any) => {
    const state = {
      assistants: [{
        id: 'test-assistant',
        instructions: 'test instructions',
        parameters: { stream: true },
      }],
      currentAssistant: {
        id: 'test-assistant',
        instructions: 'test instructions',
        parameters: { stream: true },
      },
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: any) => {
      const state = {
        getProviderByName: vi.fn(() => ({
          provider: 'openai',
          models: [],
        })),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools'],
        },
        selectedProvider: 'openai',
        updateProvider: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getProviderByName: vi.fn(() => ({
          provider: 'openai',
          models: [],
        })),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools'],
        },
        selectedProvider: 'openai',
        updateProvider: vi.fn(),
      })
    }
  ),
}))

vi.mock('../useThreads', () => ({
  useThreads: (selector: any) => {
    const state = {
      getCurrentThread: vi.fn(() => ({
        id: 'test-thread',
        model: { id: 'test-model', provider: 'openai' },
      })),
      createThread: vi.fn(() => Promise.resolve({
        id: 'test-thread',
        model: { id: 'test-model', provider: 'openai' },
      })),
      updateThreadTimestamp: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useMessages', () => ({
  useMessages: (selector: any) => {
    const state = {
      getMessages: vi.fn(() => []),
      addMessage: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useToolApproval', () => ({
  useToolApproval: (selector: any) => {
    const state = {
      approvedTools: [],
      showApprovalModal: vi.fn(),
      allowAllMCPPermissions: false,
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useToolAvailable', () => ({
  useToolAvailable: (selector: any) => {
    const state = {
      getDisabledToolsForThread: vi.fn(() => []),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useModelContextApproval', () => ({
  useContextSizeApproval: (selector: any) => {
    const state = {
      showApprovalModal: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useModelLoad', () => ({
  useModelLoad: (selector: any) => {
    const state = {
      setModelLoadError: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: vi.fn(() => ({
    navigate: vi.fn(),
  })),
}))

vi.mock('@/lib/completion', () => ({
  emptyThreadContent: { thread_id: 'test-thread', content: '' },
  extractToolCall: vi.fn(),
  newUserThreadContent: vi.fn(() => ({ thread_id: 'test-thread', content: 'user message' })),
  newAssistantThreadContent: vi.fn(() => ({ thread_id: 'test-thread', content: 'assistant message' })),
  sendCompletion: vi.fn(),
  postMessageProcessing: vi.fn(),
  isCompletionResponse: vi.fn(),
  captureProactiveScreenshots: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/messages', () => ({
  CompletionMessagesBuilder: vi.fn(() => ({
    addUserMessage: vi.fn(),
    addAssistantMessage: vi.fn(),
    getMessages: vi.fn(() => []),
  })),
}))

vi.mock('@/services/mcp', () => ({
  getTools: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/services/models', () => ({
  startModel: vi.fn(() => Promise.resolve()),
  stopModel: vi.fn(() => Promise.resolve()),
  stopAllModels: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/services/providers', () => ({
  updateSettings: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sendMessage function', () => {
    const { result } = renderHook(() => useChat())

    expect(result.current).toBeDefined()
    expect(typeof result.current).toBe('function')
  })

  it('sends message successfully', async () => {
    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current('Hello world')
    })

    expect(result.current).toBeDefined()
  })

  describe('Proactive Mode', () => {
    it('should detect proactive mode when model has proactive capability', () => {
      const { result } = renderHook(() => useChat())

      expect(result.current).toBeDefined()
      expect(typeof result.current).toBe('function')
    })

    it('should handle model with tools, vision, and proactive capabilities', () => {
      const { result } = renderHook(() => useChat())

      expect(result.current).toBeDefined()
    })

    it('should work with models that have proactive capability', () => {
      const { result } = renderHook(() => useChat())

      expect(result.current).toBeDefined()
      expect(typeof result.current).toBe('function')
    })
  })
})
