import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageStatus, ContentType } from '@janhq/core'

// Initialize mock functions immediately for use in vi.mock
const mockAddMessage = vi.fn()
const mockUpdateMessage = vi.fn()
const mockGetMessages = vi.fn(() => [])
const mockStartModel = vi.fn(() => Promise.resolve())
const mockSendCompletion = vi.fn(() =>
  Promise.resolve({
    choices: [
      {
        message: {
          content: 'AI response',
          role: 'assistant',
        },
      },
    ],
  })
)
const mockPostMessageProcessing = vi.fn((toolCalls, builder, content) =>
  Promise.resolve(content)
)
const mockCompletionMessagesBuilder = {
  addUserMessage: vi.fn(),
  addAssistantMessage: vi.fn(),
  getMessages: vi.fn(() => []),
}
const mockSetPrompt = vi.fn()
const mockResetTokenSpeed = vi.fn()

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
        setPrompt: mockSetPrompt,
      }),
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
        setTokenSpeed: vi.fn(), // Added setTokenSpeed mock
        setActiveModels: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: vi.fn(() => ({
        tools: [],
        tokenSpeed: { tokensPerSecond: 10 },
        streamingContent: undefined,
      })),
    }
  ),
}))

vi.mock('../useAssistant', () => ({
  useAssistant: Object.assign(
    (selector: any) => {
      const state = {
        assistants: [
          {
            id: 'test-assistant',
            instructions: 'test instructions',
            parameters: { stream: true },
          },
        ],
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
        assistants: [
          {
            id: 'test-assistant',
            instructions: 'test instructions',
            parameters: { stream: true },
          },
        ],
        currentAssistant: {
          id: 'test-assistant',
          instructions: 'test instructions',
          parameters: { stream: true },
        },
      }),
    }
  ),
}))

vi.mock('../useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: any) => {
      const state = {
        getProviderByName: vi.fn(() => ({
          provider: 'llamacpp',
          // FIX: Add a model to the provider to allow execution to proceed
          models: [
            {
              id: 'test-model',
              capabilities: ['tools', 'vision'],
              settings: {},
            },
          ],
          settings: [],
        })),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools', 'vision'],
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
          // FIX: Add a model to the provider to allow execution to proceed
          models: [
            {
              id: 'test-model',
              capabilities: ['tools', 'vision'],
              settings: {},
            },
          ],
          settings: [],
        })),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools', 'vision'],
        },
        selectedProvider: 'llamacpp',
        updateProvider: vi.fn(),
      }),
    }
  ),
}))

vi.mock('../useThreads', () => ({
  useThreads: Object.assign(
    (selector: any) => {
      const state = {
        getCurrentThread: vi.fn(() => ({
          id: 'test-thread',
          model: { id: 'test-model', provider: 'llamacpp' },
        })),
        createThread: vi.fn(() =>
          Promise.resolve({
            id: 'test-thread',
            model: { id: 'test-model', provider: 'llamacpp' },
          })
        ),
        updateThreadTimestamp: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getThreadById: vi.fn(() => ({
          id: 'test-thread',
          metadata: { hasDocuments: false },
        })),
      }),
    }
  ),
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
      }),
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
      getActiveModels: vi.fn(() => Promise.resolve([])),
    }),
    providers: () => ({
      updateSettings: vi.fn(() => Promise.resolve()),
    }),
    uploads: () => ({
      ingestImage: vi.fn(() => Promise.resolve({ id: 'img-id' })),
      ingestFileAttachment: vi.fn(() => Promise.resolve({ id: 'doc-id' })),
    }),
    rag: () => ({
      getTools: vi.fn(() => Promise.resolve([])),
    }),
  })),
}))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: Object.assign(
    (selector: any) => {
      const state = {
        enabled: true,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({ enabled: true }),
    }
  ),
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: { ATTACHMENTS: true },
}))
vi.mock('@/lib/platform/types', () => ({
  PlatformFeature: { ATTACHMENTS: 'ATTACHMENTS' },
}))

vi.mock('@/lib/completion', () => ({
  emptyThreadContent: { thread_id: 'test-thread', content: '' },
  extractToolCall: vi.fn(),
  newUserThreadContent: vi.fn((threadId, content) => ({
    thread_id: threadId,
    content: [
      { type: ContentType.Text, text: { value: content, annotations: [] } },
    ],
    role: 'user',
  })),
  newAssistantThreadContent: vi.fn((threadId, content) => ({
    thread_id: threadId,
    content: [
      { type: ContentType.Text, text: { value: content, annotations: [] } },
    ],
    role: 'assistant',
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

// Import after mocks to avoid hoisting issues
const { useChat } = await import('../useChat')
const completionLib = await import('@/lib/completion')
const messagesLib = await import('@/lib/messages')

describe('useChat', () => {
  beforeEach(() => {
    // Clear mock call history
    vi.clearAllMocks()

    // Reset mock implementations
    mockGetMessages.mockReturnValue([])
    mockStartModel.mockResolvedValue(undefined)
    mockSendCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'AI response',
            role: 'assistant',
          },
        },
      ],
    })
    mockPostMessageProcessing.mockImplementation(
      (toolCalls, builder, content) => Promise.resolve(content)
    )
    mockCompletionMessagesBuilder.getMessages.mockReturnValue([])
    // Reset mock implementations for builder methods
    mockCompletionMessagesBuilder.addUserMessage.mockClear()
    mockCompletionMessagesBuilder.addAssistantMessage.mockClear()
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
        await result.current(
          'Hello world',
          true,
          undefined,
          undefined,
          undefined,
          undefined
        )
      })

      expect(completionLib.newUserThreadContent).toHaveBeenCalledWith(
        'test-thread',
        'Hello world',
        []
      )
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_id: 'test-thread',
          role: 'user',
        })
      )
      expect(mockCompletionMessagesBuilder.addUserMessage).toHaveBeenCalled()
    })

    it('should NOT add new user message when continueFromMessageId is provided', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial response', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // userContent is still created but not added to messages when continuing
      const userMessageCalls = mockAddMessage.mock.calls.filter(
        (call: any) => call[0]?.role === 'user'
      )
      expect(userMessageCalls).toHaveLength(0)
      expect(
        mockCompletionMessagesBuilder.addUserMessage
      ).not.toHaveBeenCalled()
    })

    it('should add partial assistant message to builder when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial response', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, should call addAssistantMessage with the partial message content
      const assistantCalls =
        mockCompletionMessagesBuilder.addAssistantMessage.mock.calls
      expect(assistantCalls.length).toBeGreaterThanOrEqual(1)
      // First call should be with the partial response content
      expect(assistantCalls[0]).toEqual(['Partial response', undefined, []])
    })

    it('should filter out stopped message from context when continuing', async () => {
      const userMsg = {
        id: 'msg-1',
        thread_id: 'test-thread',
        role: 'user',
        content: [
          { type: ContentType.Text, text: { value: 'Hello', annotations: [] } },
        ],
      }
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
      }
      mockGetMessages.mockReturnValue([userMsg, stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, the CompletionMessagesBuilder should be called with messages
      // that exclude the stopped message from the context
      expect(messagesLib.CompletionMessagesBuilder).toHaveBeenCalled()
      const builderCall = (messagesLib.CompletionMessagesBuilder as any).mock
        .calls[0]
      expect(builderCall[0]).toEqual([userMsg]) // stopped message filtered out
      expect(builderCall[1]).toEqual('test instructions')
    })

    it('should update existing message instead of adding new one when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, finalizeMessage should update the existing message
      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          status: MessageStatus.Ready,
        })
      )
    })

    it('should start with previous content when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial response', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      mockSendCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: ' continued',
              role: 'assistant',
            },
          },
        ],
      })

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, the accumulated text should start with the previous partial content
      // and append new content from the completion
      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          content: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                value: 'Partial response continued',
              }),
            }),
          ]),
        })
      )
    })

    it('should handle attachments correctly when not continuing', async () => {
      const { result } = renderHook(() => useChat())
      const attachments = [
        {
          name: 'test.png',
          type: 'image',
          size: 1024,
          base64: 'base64data',
          dataUrl: 'data:image/png;base64,base64data',
        } as any,
      ]

      await act(async () => {
        await result.current(
          'Message with attachment',
          true,
          attachments,
          undefined,
          undefined,
          undefined
        )
      })

      expect(completionLib.newUserThreadContent).toHaveBeenCalledWith(
        'test-thread',
        'Message with attachment',
        expect.arrayContaining([expect.objectContaining({ id: 'img-id' })])
      )
      expect(mockCompletionMessagesBuilder.addUserMessage).toHaveBeenCalled()
    })

    it('should preserve message status as Ready after continuation completes', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // After continuation completes, the message status should be set to Ready
      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          status: MessageStatus.Ready,
        })
      )
    })
  })

  describe('Normal message sending', () => {
    it('sends message successfully without continuation', async () => {
      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('Hello world')
      })

      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
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
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      expect(result.current).toBeDefined()
    })
  })
})
