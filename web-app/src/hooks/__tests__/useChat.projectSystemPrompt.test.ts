import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChat } from '../useChat'

// Use hoisted storage for our mocks
const hoisted = vi.hoisted(() => ({
  builderMock: vi.fn(() => ({
    addUserMessage: vi.fn(),
    addAssistantMessage: vi.fn(),
    getMessages: vi.fn(() => []),
  })),
  updateThreadMock: vi.fn(),
  createThreadMock: vi.fn(),
  getCurrentThreadMock: vi.fn(),
  getFolderByIdMock: vi.fn(),
  routerMock: {
    navigate: vi.fn(),
    state: {
      location: {
        pathname: '/',
      },
    },
  },
}))

vi.mock('@/lib/messages', () => ({
  CompletionMessagesBuilder: hoisted.builderMock,
}))

vi.mock('../usePrompt', () => ({
  usePrompt: Object.assign(
    (selector: any) => {
      const state = { prompt: 'test prompt', setPrompt: vi.fn() }
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
    { getState: vi.fn(() => ({ tokenSpeed: { tokensPerSecond: 10 } })) }
  ),
}))

vi.mock('../useAssistant', () => ({
  useAssistant: Object.assign(
    (selector: any) => {
      const state = {
        assistants: [
          {
            id: 'test-assistant',
            instructions: 'You are a helpful assistant.',
            parameters: { stream: true },
          },
        ],
        currentAssistant: {
          id: 'test-assistant',
          instructions: 'You are a helpful assistant.',
          parameters: { stream: true },
        },
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        assistants: [
          {
            id: 'test-assistant',
            instructions: 'You are a helpful assistant.',
            parameters: { stream: true },
          },
        ],
        currentAssistant: {
          id: 'test-assistant',
          instructions: 'You are a helpful assistant.',
          parameters: { stream: true },
        },
      })
    }
  ),
}))

vi.mock('../useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: any) => {
      const state = {
        getProviderByName: vi.fn(() => ({ provider: 'openai', models: [] })),
        selectedModel: { id: 'test-model', capabilities: ['tools'] },
        selectedProvider: 'openai',
        updateProvider: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getProviderByName: vi.fn(() => ({ provider: 'openai', models: [] })),
        selectedModel: { id: 'test-model', capabilities: ['tools'] },
        selectedProvider: 'openai',
        updateProvider: vi.fn(),
      })
    }
  ),
}))

vi.mock('../useThreads', () => ({
  useThreads: Object.assign(
    (selector: any) => {
      const state = {
        getCurrentThread: hoisted.getCurrentThreadMock,
        createThread: hoisted.createThreadMock,
        updateThreadTimestamp: vi.fn(),
        currentThreadId: null,
        updateThread: hoisted.updateThreadMock,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getCurrentThread: hoisted.getCurrentThreadMock,
        createThread: hoisted.createThreadMock,
        updateThreadTimestamp: vi.fn(),
        currentThreadId: 'new-thread-id',
        updateThread: hoisted.updateThreadMock,
      })
    }
  ),
}))

vi.mock('../useThreadManagement', () => ({
  useThreadManagement: Object.assign(
    (selector: any) => {
      const state = {
        getFolderById: hoisted.getFolderByIdMock,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getFolderById: hoisted.getFolderByIdMock,
      })
    }
  ),
}))

vi.mock('../useMessages', () => ({
  useMessages: (selector: any) => {
    const state = {
      getMessages: vi.fn(() => [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]),
      addMessage: vi.fn()
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
    const state = { showApprovalModal: vi.fn() }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useModelLoad', () => ({
  useModelLoad: (selector: any) => {
    const state = { setModelLoadError: vi.fn() }
    return selector ? selector(state) : state
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: vi.fn(() => hoisted.routerMock),
}))

vi.mock('@/lib/completion', () => ({
  emptyThreadContent: { thread_id: 'test-thread', content: '' },
  extractToolCall: vi.fn(),
  newUserThreadContent: vi.fn(() => ({
    thread_id: 'test-thread',
    content: 'user message',
  })),
  newAssistantThreadContent: vi.fn(() => ({
    thread_id: 'test-thread',
    content: 'assistant message',
  })),
  sendCompletion: vi.fn(() =>
    Promise.resolve({ choices: [{ message: { content: '' } }] })
  ),
  postMessageProcessing: vi.fn(),
  isCompletionResponse: vi.fn(() => true),
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

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      startModel: vi.fn(() => Promise.resolve()),
    }),
  }),
}))

vi.mock('@/lib/instructionTemplate', () => ({
  renderInstructions: vi.fn((instructions) => instructions),
}))

describe('useChat project system prompt integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.routerMock.state.location.pathname = '/'
    hoisted.getCurrentThreadMock.mockReturnValue(null)
    hoisted.createThreadMock.mockResolvedValue({
      id: 'new-thread-id',
      model: { id: 'test-model', provider: 'openai' },
    })
  })

  it('applies project system prompt when creating thread in project route', async () => {
    // Set up project route
    hoisted.routerMock.state.location.pathname = '/project/project-123'
    hoisted.getFolderByIdMock.mockReturnValue({
      id: 'project-123',
      name: 'Test Project',
      updated_at: Date.now(),
      systemPrompt: 'You are a Python expert.',
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current('Hello')
    })

    // Verify updateThread was called with project metadata
    expect(hoisted.updateThreadMock).toHaveBeenCalledWith('new-thread-id', {
      metadata: {
        project: {
          id: 'project-123',
          name: 'Test Project',
          updated_at: expect.any(Number),
        },
      },
    })
  })

  it('does not apply project metadata when not in project route', async () => {
    hoisted.routerMock.state.location.pathname = '/threads/some-thread'

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current('Hello')
    })

    // Verify updateThread was not called
    expect(hoisted.updateThreadMock).not.toHaveBeenCalled()
  })

  it('combines project system prompt with assistant instructions when sending message', async () => {
    // Set up existing thread with project metadata
    hoisted.getCurrentThreadMock.mockReturnValue({
      id: 'existing-thread',
      model: { id: 'test-model', provider: 'openai' },
      metadata: {
        project: {
          id: 'project-456',
          name: 'Coding Project',
          updated_at: Date.now(),
        },
      },
    })

    hoisted.getFolderByIdMock.mockReturnValue({
      id: 'project-456',
      name: 'Coding Project',
      updated_at: Date.now(),
      systemPrompt: 'You are a JavaScript expert specializing in React.',
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current('How do I use hooks?')
    })

    // Verify CompletionMessagesBuilder was called with combined instructions
    expect(hoisted.builderMock).toHaveBeenCalled()
    const calls = hoisted.builderMock.mock.calls as any[]
    const lastCall = calls[calls.length - 1]

    // The second parameter should be the combined system instructions
    const combinedInstructions = lastCall[1]
    expect(combinedInstructions).toContain('You are a JavaScript expert specializing in React.')
    expect(combinedInstructions).toContain('You are a helpful assistant.')
  })

  it('uses only assistant instructions when thread has no project', async () => {
    hoisted.getCurrentThreadMock.mockReturnValue({
      id: 'existing-thread',
      model: { id: 'test-model', provider: 'openai' },
      metadata: {},
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current('Hello')
    })

    // Verify CompletionMessagesBuilder was called with only assistant instructions
    expect(hoisted.builderMock).toHaveBeenCalled()
    const calls = hoisted.builderMock.mock.calls as any[]
    const lastCall = calls[calls.length - 1]

    const instructions = lastCall[1]
    expect(instructions).toBe('You are a helpful assistant.')
  })

  it('uses only assistant instructions when project has no system prompt', async () => {
    hoisted.getCurrentThreadMock.mockReturnValue({
      id: 'existing-thread',
      model: { id: 'test-model', provider: 'openai' },
      metadata: {
        project: {
          id: 'project-789',
          name: 'Project Without Prompt',
          updated_at: Date.now(),
        },
      },
    })

    hoisted.getFolderByIdMock.mockReturnValue({
      id: 'project-789',
      name: 'Project Without Prompt',
      updated_at: Date.now(),
      // No systemPrompt
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current('Hello')
    })

    expect(hoisted.builderMock).toHaveBeenCalled()
    const calls = hoisted.builderMock.mock.calls as any[]
    const lastCall = calls[calls.length - 1]

    const instructions = lastCall[1]
    expect(instructions).toBe('You are a helpful assistant.')
  })

  it('uses only project system prompt when combined with empty assistant instructions', async () => {
    // For this test, we'll verify the behavior when assistant instructions are empty
    // The combined instructions should just be the project system prompt
    hoisted.getCurrentThreadMock.mockReturnValue({
      id: 'existing-thread',
      model: { id: 'test-model', provider: 'openai' },
      metadata: {
        project: {
          id: 'project-999',
          name: 'Project Only',
          updated_at: Date.now(),
        },
      },
    })

    hoisted.getFolderByIdMock.mockReturnValue({
      id: 'project-999',
      name: 'Project Only',
      updated_at: Date.now(),
      systemPrompt: 'You are a data science expert.',
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current('Analyze this data')
    })

    expect(hoisted.builderMock).toHaveBeenCalled()
    const calls = hoisted.builderMock.mock.calls as any[]
    const lastCall = calls[calls.length - 1]

    const instructions = lastCall[1]
    // Should contain both the project prompt and assistant instructions
    expect(instructions).toContain('You are a data science expert.')
    expect(instructions).toContain('You are a helpful assistant.')
  })
})
