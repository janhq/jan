import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChat } from '../useChat'

// Mock dependencies
vi.mock('../usePrompt', () => ({
  usePrompt: vi.fn(() => ({
    prompt: 'test prompt',
    setPrompt: vi.fn(),
  })),
}))

vi.mock('../useAppState', () => ({
  useAppState: Object.assign(
    vi.fn(() => ({
      tools: [],
      updateTokenSpeed: vi.fn(),
      resetTokenSpeed: vi.fn(),
      updateTools: vi.fn(),
      updateStreamingContent: vi.fn(),
      updateLoadingModel: vi.fn(),
      setAbortController: vi.fn(),
    })),
    {
      getState: vi.fn(() => ({
        tokenSpeed: { tokensPerSecond: 10 },
      }))
    }
  ),
}))

vi.mock('../useAssistant', () => ({
  useAssistant: vi.fn(() => ({
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
  })),
}))

vi.mock('../useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
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
  })),
}))

vi.mock('../useThreads', () => ({
  useThreads: vi.fn(() => ({
    getCurrentThread: vi.fn(() => ({
      id: 'test-thread',
      model: { id: 'test-model', provider: 'openai' },
    })),
    createThread: vi.fn(() => Promise.resolve({
      id: 'test-thread',
      model: { id: 'test-model', provider: 'openai' },
    })),
    updateThreadTimestamp: vi.fn(),
  })),
}))

vi.mock('../useMessages', () => ({
  useMessages: vi.fn(() => ({
    getMessages: vi.fn(() => []),
    addMessage: vi.fn(),
  })),
}))

vi.mock('../useToolApproval', () => ({
  useToolApproval: vi.fn(() => ({
    approvedTools: [],
    showApprovalModal: vi.fn(),
    allowAllMCPPermissions: false,
  })),
}))

vi.mock('../useToolAvailable', () => ({
  useToolAvailable: vi.fn(() => ({
    getDisabledToolsForThread: vi.fn(() => []),
  })),
}))

vi.mock('../useModelContextApproval', () => ({
  useContextSizeApproval: vi.fn(() => ({
    showApprovalModal: vi.fn(),
  })),
}))

vi.mock('../useModelLoad', () => ({
  useModelLoad: vi.fn(() => ({
    setModelLoadError: vi.fn(),
  })),
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
    
    expect(result.current.sendMessage).toBeDefined()
    expect(typeof result.current.sendMessage).toBe('function')
  })

  it('sends message successfully', async () => {
    const { result } = renderHook(() => useChat())
    
    await act(async () => {
      await result.current.sendMessage('Hello world')
    })
    
    expect(result.current.sendMessage).toBeDefined()
  })
})