import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChat } from '../useChat'

// Use hoisted storage for our mock to avoid hoist errors
const hoisted = vi.hoisted(() => ({
  builderMock: vi.fn(() => ({
    addUserMessage: vi.fn(),
    addAssistantMessage: vi.fn(),
    getMessages: vi.fn(() => []),
  })),
}))

vi.mock('@/lib/messages', () => ({
  CompletionMessagesBuilder: hoisted.builderMock,
}))

// Mock dependencies similar to existing tests, but customize assistant
vi.mock('../../hooks/usePrompt', () => ({
  usePrompt: vi.fn(() => ({ prompt: 'test prompt', setPrompt: vi.fn() })),
}))

vi.mock('../../hooks/useAppState', () => ({
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
    { getState: vi.fn(() => ({ tokenSpeed: { tokensPerSecond: 10 } })) }
  ),
}))

vi.mock('../../hooks/useAssistant', () => ({
  useAssistant: vi.fn(() => ({
    assistants: [
      {
        id: 'test-assistant',
        instructions: 'Today is {{current_date}}',
        parameters: { stream: true },
      },
    ],
    currentAssistant: {
      id: 'test-assistant',
      instructions: 'Today is {{current_date}}',
      parameters: { stream: true },
    },
  })),
}))

vi.mock('../../hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    getProviderByName: vi.fn(() => ({ provider: 'openai', models: [] })),
    selectedModel: { id: 'test-model', capabilities: ['tools'] },
    selectedProvider: 'openai',
    updateProvider: vi.fn(),
  })),
}))

vi.mock('../../hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    getCurrentThread: vi.fn(() => ({ id: 'test-thread', model: { id: 'test-model', provider: 'openai' } })),
    createThread: vi.fn(() => Promise.resolve({ id: 'test-thread', model: { id: 'test-model', provider: 'openai' } })),
    updateThreadTimestamp: vi.fn(),
  })),
}))

vi.mock('../../hooks/useMessages', () => ({
  useMessages: vi.fn(() => ({ getMessages: vi.fn(() => []), addMessage: vi.fn() })),
}))

vi.mock('../../hooks/useToolApproval', () => ({
  useToolApproval: vi.fn(() => ({ approvedTools: [], showApprovalModal: vi.fn(), allowAllMCPPermissions: false })),
}))

vi.mock('../../hooks/useModelContextApproval', () => ({
  useContextSizeApproval: vi.fn(() => ({ showApprovalModal: vi.fn() })),
}))

vi.mock('../../hooks/useModelLoad', () => ({
  useModelLoad: vi.fn(() => ({ setModelLoadError: vi.fn() })),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: vi.fn(() => ({ navigate: vi.fn() })),
}))

vi.mock('@/lib/completion', () => ({
  emptyThreadContent: { thread_id: 'test-thread', content: '' },
  extractToolCall: vi.fn(),
  newUserThreadContent: vi.fn(() => ({ thread_id: 'test-thread', content: 'user message' })),
  newAssistantThreadContent: vi.fn(() => ({ thread_id: 'test-thread', content: 'assistant message' })),
  sendCompletion: vi.fn(() => Promise.resolve({ choices: [{ message: { content: '' } }] })),
  postMessageProcessing: vi.fn(),
  isCompletionResponse: vi.fn(() => true),
}))

vi.mock('@/services/mcp', () => ({ getTools: vi.fn(() => Promise.resolve([])) }))

vi.mock('@/services/models', () => ({
  startModel: vi.fn(() => Promise.resolve()),
  stopModel: vi.fn(() => Promise.resolve()),
  stopAllModels: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/services/providers', () => ({ updateSettings: vi.fn(() => Promise.resolve()) }))

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }))

describe('useChat instruction rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders assistant instructions by replacing {{current_date}} with today', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-08-16T00:00:00Z'))

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current.sendMessage('Hello')
    })

    expect(hoisted.builderMock).toHaveBeenCalled()
    const calls = (hoisted.builderMock as any).mock.calls as any[]
    const call = calls[0]
    expect(call[0]).toEqual([])
    expect(call[1]).toMatch(/^Today is /)
    expect(call[1]).not.toContain('{{current_date}}')

    vi.useRealTimers()
  })
})
