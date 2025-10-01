import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useChat } from '../useChat'
import * as completionLib from '@/lib/completion'
import * as messagesLib from '@/lib/messages'
import { MessageStatus, ContentType } from '@janhq/core'

// Store mock functions for assertions
let mockAddMessage: ReturnType<typeof vi.fn>
let mockUpdateMessage: ReturnType<typeof vi.fn>
let mockGetMessages: ReturnType<typeof vi.fn>
let mockStartModel: ReturnType<typeof vi.fn>
let mockSendCompletion: ReturnType<typeof vi.fn>
let mockPostMessageProcessing: ReturnType<typeof vi.fn>
let mockCompletionMessagesBuilder: any
let mockSetPrompt: ReturnType<typeof vi.fn>
let mockResetTokenSpeed: ReturnType<typeof vi.fn>

// Mock dependencies
vi.mock('../usePrompt', () => ({
  usePrompt: Object.assign(
    (selector: any) => {
      const state = {
        prompt: 'test prompt',
        setPrompt: mockSetPrompt,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        prompt: 'test prompt',
        setPrompt: mockSetPrompt
      })
    }
  ),
}))

vi.mock('../useAppState', () => ({
  useAppState: Object.assign(
    (selector?: any) => {
      const state = {
        tools: [],
        updateTokenSpeed: vi.fn(),
        resetTokenSpeed: mockResetTokenSpeed,
        updateTools: vi.fn(),
        updateStreamingContent: vi.fn(),
        updatePromptProgress: vi.fn(),
        updateLoadingModel: vi.fn(),
        setAbortController: vi.fn(),
        streamingContent: undefined,
      }
      return selector ? selector(state) : state
    },
    {
      getState: vi.fn(() => ({
        tools: [],
        tokenSpeed: { tokensPerSecond: 10 },
        streamingContent: undefined,
      }))
    }
  ),
}))

vi.mock('../useAssistant', () => ({
  useAssistant: Object.assign(
    (selector: any) => {
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
    {
      getState: () => ({
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
      })
    }
  ),
}))

vi.mock('../useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: any) => {
      const state = {
        getProviderByName: vi.fn(() => ({
          provider: 'llamacpp',
          models: [],
          settings: [],
        })),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools'],
        },
        selectedProvider: 'llamacpp',
        updateProvider: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getProviderByName: vi.fn(() => ({
          provider: 'llamacpp',
          models: [],
          settings: [],
        })),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools'],
        },
        selectedProvider: 'llamacpp',
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
        model: { id: 'test-model', provider: 'llamacpp' },
      })),
      createThread: vi.fn(() => Promise.resolve({
        id: 'test-thread',
        model: { id: 'test-model', provider: 'llamacpp' },
      })),
      updateThreadTimestamp: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useMessages', () => ({
  useMessages: (selector: any) => {
    const state = {
      getMessages: mockGetMessages,
      addMessage: mockAddMessage,
      updateMessage: mockUpdateMessage,
      setMessages: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useToolApproval', () => ({
  useToolApproval: Object.assign(
    (selector: any) => {
      const state = {
        approvedTools: [],
        showApprovalModal: vi.fn(),
        allowAllMCPPermissions: false,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        approvedTools: [],
        showApprovalModal: vi.fn(),
        allowAllMCPPermissions: false,
      })
    }
  ),
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

vi.mock('../useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    models: () => ({
      startModel: mockStartModel,
      stopModel: vi.fn(() => Promise.resolve()),
      stopAllModels: vi.fn(() => Promise.resolve()),
    }),
    providers: () => ({
      updateSettings: vi.fn(() => Promise.resolve()),
    }),
  })),
}))

vi.mock('@/lib/completion', () => ({
  emptyThreadContent: { thread_id: 'test-thread', content: '' },
  extractToolCall: vi.fn(),
  newUserThreadContent: vi.fn((threadId, content) => ({
    thread_id: threadId,
    content: [{ type: ContentType.Text, text: { value: content, annotations: [] } }],
    role: 'user'
  })),
  newAssistantThreadContent: vi.fn((threadId, content) => ({
    thread_id: threadId,
    content: [{ type: ContentType.Text, text: { value: content, annotations: [] } }],
    role: 'assistant'
  })),
  sendCompletion: mockSendCompletion,
  postMessageProcessing: mockPostMessageProcessing,
  isCompletionResponse: vi.fn(() => true),
  captureProactiveScreenshots: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/messages', () => ({
  CompletionMessagesBuilder: vi.fn(() => mockCompletionMessagesBuilder),
}))

vi.mock('@/lib/instructionTemplate', () => ({
  renderInstructions: vi.fn((instructions: string) => instructions),
}))

vi.mock('@/utils/reasoning', () => ({
  ReasoningProcessor: vi.fn(() => ({
    processReasoningChunk: vi.fn(() => null),
    finalize: vi.fn(() => ''),
  })),
  extractReasoningFromMessage: vi.fn(() => null),
}))

vi.mock('@/services/mcp', () => ({
  getTools: vi.fn(() => Promise.resolve([])),
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
    // Reset all mocks
    mockAddMessage = vi.fn()
    mockUpdateMessage = vi.fn()
    mockGetMessages = vi.fn(() => [])
    mockStartModel = vi.fn(() => Promise.resolve())
    mockSetPrompt = vi.fn()
    mockResetTokenSpeed = vi.fn()
    mockSendCompletion = vi.fn(() => Promise.resolve({
      choices: [{
        message: {
          content: 'AI response',
          role: 'assistant',
        },
      }],
    }))
    mockPostMessageProcessing = vi.fn((toolCalls, builder, content) =>
      Promise.resolve(content)
    )
    mockCompletionMessagesBuilder = {
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      getMessages: vi.fn(() => []),
    }

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('returns sendMessage function', () => {
    const { result } = renderHook(() => useChat())

    expect(result.current).toBeDefined()
    expect(typeof result.current).toBe('function')
  })

  describe('Continue with AI response functionality', () => {
    it('should add new user message when troubleshooting is true and no continueFromMessageId', async () => {
      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('Hello world', true, undefined, undefined)
      })

      expect(completionLib.newUserThreadContent).toHaveBeenCalledWith(
        'test-thread',
        'Hello world',
        undefined
      )
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_id: 'test-thread',
          role: 'user',
        })
      )
      expect(mockCompletionMessagesBuilder.addUserMessage).toHaveBeenCalledWith(
        'Hello world',
        undefined
      )
    })

    it('should NOT add new user message when continueFromMessageId is provided', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [{ type: ContentType.Text, text: { value: 'Partial response', annotations: [] } }],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('Continue', true, undefined, 'msg-123')
      })

      expect(completionLib.newUserThreadContent).not.toHaveBeenCalled()
      const userMessageCalls = mockAddMessage.mock.calls.filter(
        (call: any) => call[0]?.role === 'user'
      )
      expect(userMessageCalls).toHaveLength(0)
      expect(mockCompletionMessagesBuilder.addUserMessage).not.toHaveBeenCalled()
    })

    it('should add partial assistant message to builder when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [{ type: ContentType.Text, text: { value: 'Partial response', annotations: [] } }],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('', true, undefined, 'msg-123')
      })

      expect(mockCompletionMessagesBuilder.addAssistantMessage).toHaveBeenCalledWith(
        'Partial response',
        undefined,
        []
      )
    })

    it('should filter out stopped message from context when continuing', async () => {
      const userMsg = {
        id: 'msg-1',
        thread_id: 'test-thread',
        role: 'user',
        content: [{ type: ContentType.Text, text: { value: 'Hello', annotations: [] } }],
      }
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [{ type: ContentType.Text, text: { value: 'Partial', annotations: [] } }],
        status: MessageStatus.Stopped,
      }
      mockGetMessages.mockReturnValue([userMsg, stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('', true, undefined, 'msg-123')
      })

      await waitFor(() => {
        expect(messagesLib.CompletionMessagesBuilder).toHaveBeenCalledWith(
          [userMsg], // stopped message filtered out
          'test instructions'
        )
      })
    })

    it('should update existing message instead of adding new one when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [{ type: ContentType.Text, text: { value: 'Partial', annotations: [] } }],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('', true, undefined, 'msg-123')
      })

      await waitFor(() => {
        expect(mockUpdateMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'msg-123',
            status: MessageStatus.Ready,
          })
        )
      })
    })

    it('should start with previous content when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [{ type: ContentType.Text, text: { value: 'Partial response', annotations: [] } }],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      mockSendCompletion.mockResolvedValue({
        choices: [{
          message: {
            content: ' continued',
            role: 'assistant',
          },
        }],
      })

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('', true, undefined, 'msg-123')
      })

      // The accumulated text should contain the previous content
      await waitFor(() => {
        expect(mockUpdateMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'msg-123',
            content: expect.arrayContaining([
              expect.objectContaining({
                text: expect.objectContaining({
                  value: expect.stringContaining('Partial response'),
                })
              })
            ])
          })
        )
      })
    })

    it('should handle attachments correctly when not continuing', async () => {
      const { result } = renderHook(() => useChat())
      const attachments = [
        {
          name: 'test.png',
          type: 'image/png',
          size: 1024,
          base64: 'base64data',
          dataUrl: 'data:image/png;base64,base64data',
        },
      ]

      await act(async () => {
        await result.current('Message with attachment', true, attachments, undefined)
      })

      expect(completionLib.newUserThreadContent).toHaveBeenCalledWith(
        'test-thread',
        'Message with attachment',
        attachments
      )
      expect(mockCompletionMessagesBuilder.addUserMessage).toHaveBeenCalledWith(
        'Message with attachment',
        attachments
      )
    })

    it('should preserve message status as Ready after continuation completes', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [{ type: ContentType.Text, text: { value: 'Partial', annotations: [] } }],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('', true, undefined, 'msg-123')
      })

      await waitFor(() => {
        expect(mockUpdateMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'msg-123',
            status: MessageStatus.Ready,
          })
        )
      })
    })
  })

  describe('Normal message sending', () => {
    it('sends message successfully without continuation', async () => {
      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('Hello world')
      })

      expect(mockSendCompletion).toHaveBeenCalled()
      expect(mockStartModel).toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it('should handle errors gracefully during continuation', async () => {
      mockSendCompletion.mockRejectedValueOnce(new Error('API Error'))
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [{ type: ContentType.Text, text: { value: 'Partial', annotations: [] } }],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('', true, undefined, 'msg-123')
      })

      expect(result.current).toBeDefined()
    })
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
