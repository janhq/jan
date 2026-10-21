/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// -----------------------------------------------------------------------------
// Hoisted shared state + mocks (needed because vi.mock factory runs first)
// -----------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const mockSendMessage = vi.fn()
  const mockRegenerate = vi.fn()
  const mockStop = vi.fn()
  const mockAddToolOutput = vi.fn()
  const mockSetChatMessages = vi.fn()
  const mockUpdateRag = vi.fn()
  const mockSetContinueFromContent = vi.fn()

  const chatState: { messages: any[]; status: string; error: Error | null } = {
    messages: [],
    status: 'ready',
    error: null,
  }

  const threadsState: any = {
    threads: {
      'thread-1': {
        id: 'thread-1',
        title: 'My Thread',
        metadata: {},
        assistants: [],
        model: { id: 'gpt-x', provider: 'openai' },
      },
    },
    setCurrentThreadId: vi.fn(),
    updateThread: vi.fn(),
  }
  const useThreadsMock: any = (selector: any) => selector(threadsState)
  useThreadsMock.getState = () => threadsState

  const messagesState: any = {
    setMessages: vi.fn(),
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    getMessages: vi.fn(() => []),
  }
  const useMessagesMock: any = (selector: any) => selector(messagesState)
  useMessagesMock.getState = () => messagesState

  const appStateState = {
    ragToolNames: new Set<string>(),
    mcpToolNames: new Set<string>(),
    tools: [] as Array<{ name: string; server?: string }>,
    setOomError: vi.fn(),
    setBackendError: vi.fn(),
    busyThreads: {} as Record<string, boolean>,
    embeddingThreads: {} as Record<string, boolean>,
    setThreadBusy: vi.fn(),
    setThreadEmbedding: vi.fn(),
  }
  const useAppStateMock: any = (selector: any) => selector(appStateState)
  useAppStateMock.getState = () => appStateState

  const modelProviderState: any = {
    selectedModel: {
      id: 'gpt-x',
      capabilities: ['tools'],
      settings: {
        ctx_len: { controller_props: { value: 4096, max: 131072 } },
        auto_increase_ctx_len: { controller_props: { value: true } },
      },
    },
    selectedProvider: 'openai',
    getProviderByName: vi.fn((name: string) => ({
      provider: name,
      models: [
        {
          id: 'gpt-x',
          settings: {
            ctx_len: { controller_props: { value: 4096, max: 131072 } },
          },
        },
      ],
    })),
    updateProvider: vi.fn(),
  }
  const useModelProviderMock: any = (selector: any) => selector(modelProviderState)
  useModelProviderMock.getState = () => modelProviderState

  const chatSessionsState: any = {
    sessions: {},
    getSessionData: vi.fn(() => ({ tools: [] })),
  }
  const useChatSessionsMock: any = (selector: any) => selector(chatSessionsState)
  useChatSessionsMock.getState = () => chatSessionsState
  // Listeners the route registers to learn a thread's session was removed (the
  // thread was deleted); removeChatSession below notifies them.
  const chatSessionListeners = new Set<(state: any) => void>()
  useChatSessionsMock.subscribe = (listener: (state: any) => void) => {
    chatSessionListeners.add(listener)
    return () => chatSessionListeners.delete(listener)
  }
  const removeChatSession = (threadId: string) => {
    const rest = { ...chatSessionsState.sessions }
    delete rest[threadId]
    chatSessionsState.sessions = rest
    for (const listener of [...chatSessionListeners]) listener(chatSessionsState)
  }

  const attachmentsState: any = {
    getAttachments: vi.fn(() => []),
    clearAttachments: vi.fn(),
    setAttachments: vi.fn(),
  }
  const useChatAttachmentsMock: any = (selector: any) => selector(attachmentsState)
  useChatAttachmentsMock.getState = () => attachmentsState

  const useAttachmentsState: any = { enabled: true, parseMode: 'auto' }
  const useAttachmentsMock: any = (selector: any) => selector(useAttachmentsState)
  useAttachmentsMock.getState = () => useAttachmentsState

  const toolAvailableState: any = {
    getDisabledToolsForThread: vi.fn(() => []),
  }
  const useToolAvailableMock: any = (selector: any) => selector(toolAvailableState)
  useToolAvailableMock.getState = () => toolAvailableState

  const toolApprovalState: any = {
    approveToolForThread: vi.fn(),
    clearPendingForThread: vi.fn(),
    requestApproval: vi.fn().mockResolvedValue(true),
  }
  const useToolApprovalMock: any = (selector: any) => selector(toolApprovalState)
  useToolApprovalMock.getState = () => toolApprovalState
  // Transient approval store shares the same backing object so existing
  // toolApprovalState.requestApproval / clearPendingForThread refs keep working.
  const useToolApprovalRequestsMock: any = (selector: any) =>
    selector(toolApprovalState)
  useToolApprovalRequestsMock.getState = () => toolApprovalState

  const agentModeState: any = { agentThreads: {} }
  const useAgentModeMock: any = (selector: any) => selector(agentModeState)
  useAgentModeMock.getState = () => agentModeState

  const messageQueueState: any = {
    dequeue: vi.fn(() => null),
    clearQueue: vi.fn(),
  }
  const useMessageQueueMock: any = (_selector: any) => undefined
  useMessageQueueMock.getState = () => messageQueueState

  return {
    // The route's thread id, which the tests move to simulate a thread switch.
    routeParams: { threadId: 'thread-1' },
    mockSendMessage,
    mockRegenerate,
    mockStop,
    mockAddToolOutput,
    mockSetChatMessages,
    mockUpdateRag,
    mockSetContinueFromContent,
    chatState,
    threadsState,
    useThreadsMock,
    messagesState,
    useMessagesMock,
    appStateState,
    useAppStateMock,
    modelProviderState,
    useModelProviderMock,
    chatSessionsState,
    useChatSessionsMock,
    removeChatSession,
    attachmentsState,
    useChatAttachmentsMock,
    useAttachmentsState,
    useAttachmentsMock,
    toolAvailableState,
    useToolAvailableMock,
    toolApprovalState,
    useToolApprovalMock,
    useToolApprovalRequestsMock,
    agentModeState,
    useAgentModeMock,
    messageQueueState,
    useMessageQueueMock,
  }
})

// -----------------------------------------------------------------------------
// Module mocks
// -----------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/threads/$threadId' }),
  useParams: () => ({ threadId: h.routeParams.threadId }),
  useSearch: () => ({ threadModel: undefined }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div data-testid="header-page">{children}</div>,
}))

vi.mock('@/containers/DropdownModelProvider', () => ({
  default: ({ model }: any) => (
    <div data-testid="model-dropdown">{model ? model.id : 'no-model'}</div>
  ),
}))

vi.mock('@/containers/ChatInput', () => ({
  default: ({ onSubmit, onStop, chatStatus }: any) => (
    <div data-testid="chat-input">
      <span data-testid="chat-status">{chatStatus}</span>
      <button
        data-testid="chat-send"
        onClick={() => onSubmit('hello world', undefined)}
      >
        send
      </button>
      <button
        data-testid="chat-send-ref"
        onClick={() =>
          onSubmit(
            'summarise\n\n---\nReferenced file contents:\n\nbody',
            undefined,
            undefined,
            'summarise @notes.md'
          )
        }
      >
        send with reference
      </button>
      <button data-testid="chat-stop" onClick={() => onStop()}>
        stop
      </button>
    </div>
  ),
}))

vi.mock('@/containers/MessageItem', () => ({
  MessageItem: ({
    message,
    onRegenerate,
    onEdit,
    onDelete,
    versionInfo,
    onSwitchVersion,
  }: any) => (
    <div data-testid={`message-${message.id}`} data-role={message.role}>
      <span>{message.id}</span>
      {versionInfo && (
        <span data-testid={`version-${message.id}`}>
          {versionInfo.index}/{versionInfo.count}
        </span>
      )}
      <button
        data-testid={`prev-${message.id}`}
        onClick={() => onSwitchVersion?.(message.id, -1)}
      >
        prev
      </button>
      <button
        data-testid={`regen-${message.id}`}
        onClick={() => onRegenerate(message.id)}
      >
        regen
      </button>
      <button
        data-testid={`edit-${message.id}`}
        onClick={() => onEdit(message.id, 'edited text')}
      >
        edit
      </button>
      <button
        data-testid={`del-${message.id}`}
        onClick={() => onDelete(message.id)}
      >
        del
      </button>
    </div>
  ),
}))

vi.mock('@/components/ai-elements/conversation', () => ({
  Conversation: ({ children }: any) => <div>{children}</div>,
  ConversationContent: ({ children }: any) => <div>{children}</div>,
  ConversationScrollButton: () => <div data-testid="scroll-btn" />,
}))

vi.mock('@/components/ai-elements/shimmer', () => ({
  Shimmer: ({ children }: any) => <div data-testid="shimmer">{children}</div>,
}))

vi.mock('@/components/PromptProgress', () => ({
  PromptProgress: () => <div data-testid="prompt-progress" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconAlertCircle: () => <span />,
  IconRefresh: () => <span />,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/lib/instructionTemplate', () => ({
  renderInstructions: (i: string) => `rendered:${i}`,
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => ({
        listAttachmentsForProject: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}))

vi.mock('@/lib/messages', () => ({
  convertThreadMessagesToUIMessages: (msgs: any[]) =>
    msgs.map((m) => ({
      id: m.id,
      role: m.role,
      parts: [{ type: 'text', text: m.content?.[0]?.text?.value ?? '' }],
    })),
  extractContentPartsFromUIMessage: (msg: any) =>
    msg.parts.flatMap((p: any) =>
      p.type === 'text'
        ? [{ type: 'text', text: { value: p.text, annotations: [] } }]
        : p.type?.startsWith('tool-')
          ? [{ type: 'tool_call', tool_call_id: p.toolCallId, output: p.output }]
          : []
    ),
  uiMessageHasMeaningfulContent: (msg: any) =>
    !!msg?.parts?.some((p: any) => p.type === 'text' && p.text?.trim()),
  toolErrorsOf: (msg: any) => {
    const errors: Record<string, string> = {}
    for (const p of msg.parts ?? []) {
      if (p.state === 'output-error') errors[p.toolCallId] = p.errorText
    }
    return Object.keys(errors).length ? errors : undefined
  },
}))

// The chat runs MCP tools through the cancellable API so Stop can end the call.
const cancellable = (run: (args: any) => Promise<unknown>) => (args: any) => ({
  promise: run(args),
  cancel: vi.fn().mockResolvedValue(undefined),
  token: 'test-token',
})

vi.mock('@/lib/completion', () => ({
  newUserThreadContent: (threadId: string, text: string, _a: any, id: string) => ({
    id,
    thread_id: threadId,
    role: 'user',
    content: [{ type: 'text', text: { value: text, annotations: [] } }],
    metadata: {},
  }),
}))

vi.mock('@/lib/attachmentProcessing', () => ({
  processAttachmentsForSend: vi
    .fn()
    .mockResolvedValue({ processedAttachments: [], hasEmbeddedDocuments: false }),
  resolveAutoInlineBudget: vi.fn().mockResolvedValue(6144),
  needsIngestionChoice: vi.fn(
    (doc: any, pref: string) => (doc.parseMode ?? pref) === 'auto'
  ),
  promptIngestionChoices: vi.fn(),
  applyIngestionChoices: (atts: any[], choices: Map<string, string>) =>
    atts.map((a) =>
      choices.has(a.path) ? { ...a, parseMode: choices.get(a.path) } : a
    ),
}))

vi.mock('@/lib/thread-title-summarizer', () => ({
  generateThreadTitle: vi.fn().mockResolvedValue('Short title'),
}))

vi.mock('@/types/attachment', () => ({
  createImageAttachment: (x: any) => ({ type: 'image', ...x }),
}))

vi.mock('ai', () => ({
  generateId: () => 'gen-id',
  lastAssistantMessageIsCompleteWithToolCalls: () => true,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}))

vi.mock('@/hooks/use-chat', () => ({
  useChat: (_args: any) => {
    ;(h as any).capturedOnFinish = _args?.onFinish
    ;(h as any).capturedOnToolCall = _args?.onToolCall
    ;(h as any).capturedSendAutomaticallyWhen = _args?.sendAutomaticallyWhen
    return {
      messages: h.chatState.messages,
      status: h.chatState.status,
      error: h.chatState.error,
      sendMessage: h.mockSendMessage,
      regenerate: h.mockRegenerate,
      setMessages: h.mockSetChatMessages,
      stop: h.mockStop,
      addToolOutput: h.mockAddToolOutput,
      updateRagToolsAvailability: h.mockUpdateRag,
      setContinueFromContent: h.mockSetContinueFromContent,
    }
  },
}))

vi.mock('@/hooks/useThreads', () => ({ useThreads: h.useThreadsMock }))
vi.mock('@/hooks/useMessages', () => ({ useMessages: h.useMessagesMock }))
vi.mock('@/hooks/useTools', () => ({ useTools: vi.fn() }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: h.useAppStateMock }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: h.useModelProviderMock }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: h.useChatSessionsMock }))
vi.mock('@/hooks/useChatAttachments', () => ({
  useChatAttachments: h.useChatAttachmentsMock,
  NEW_THREAD_ATTACHMENT_KEY: '__new-thread__',
}))
vi.mock('@/hooks/useAttachments', () => ({ useAttachments: h.useAttachmentsMock }))
vi.mock('@/hooks/useToolAvailable', () => ({ useToolAvailable: h.useToolAvailableMock }))
const shell = vi.hoisted(() => ({
  enabled: true,
  execute: vi.fn(async () => ({ output: 'ok' })),
}))
vi.mock('@/hooks/useChatShell', () => ({
  useChatShell: { getState: () => ({ shellEnabled: shell.enabled }) },
}))
vi.mock('@/lib/agentTools', () => ({
  CHAT_AGENT_TOOL_NAMES: new Set(['shell']),
  executeAgentTool: shell.execute,
}))
vi.mock('@/hooks/useToolApproval', () => ({ useToolApproval: h.useToolApprovalMock }))
vi.mock('@/hooks/useToolApprovalRequests', () => ({
  useToolApprovalRequests: h.useToolApprovalRequestsMock,
}))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: h.useAgentModeMock }))
vi.mock('@/stores/message-queue-store', () => ({ useMessageQueue: h.useMessageQueueMock }))

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({
    containerRef: { current: null },
    isAtBottom: true,
    handleScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    forceScrollToBottom: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@janhq/core', () => ({
  MessageStatus: { Ready: 'ready' },
  ChatCompletionRole: { Assistant: 'assistant', User: 'user' },
  ContentType: { Text: 'text' },
  ExtensionTypeEnum: { VectorDB: 'vectorDB' },
  VectorDBExtension: class {},
}))

vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_PREFIX: { INITIAL_MESSAGE: 'initial-message-' },
}))

vi.mock('@/utils/error', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/error')>()),
  OUT_OF_CONTEXT_SIZE: 'OUT_OF_CONTEXT_SIZE',
}))

// The built-in web tools run in the webview rather than through the service
// hub, so a test can see what they were handed.
const webTool = vi.hoisted(() => ({ executeWebTool: vi.fn() }))
vi.mock('@/lib/webSearchTool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webSearchTool')>()),
  executeWebTool: webTool.executeWebTool,
}))

// -----------------------------------------------------------------------------
// Import component AFTER mocks
// -----------------------------------------------------------------------------
import { Route } from '../$threadId'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { useMessageErrors } from '@/stores/message-errors'
import {
  processAttachmentsForSend,
  promptIngestionChoices,
  resolveAutoInlineBudget,
} from '@/lib/attachmentProcessing'
import { usePrompt } from '@/hooks/usePrompt'

// The global setup mock is a shared object, so an overridden factory has to be
// put back or it leaks into every later test.
const hub = getServiceHub() as unknown as Record<string, unknown>
const realMcp = hub.mcp

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('ThreadDetail route', () => {
  beforeEach(() => {
    // Leaving a thread no longer ends its tool loop, so a loop an earlier test
    // left waiting would keep its approvals. Deleting the threads ends them.
    h.removeChatSession('thread-1')
    h.removeChatSession('thread-2')
    vi.clearAllMocks()
    h.chatState.messages = []
    h.chatState.status = 'ready'
    h.chatState.error = null
    h.threadsState.threads['thread-1'] = {
      id: 'thread-1',
      title: 'My Thread',
      metadata: {},
      assistants: [],
      model: { id: 'gpt-x', provider: 'openai' },
    }
    h.threadsState.setCurrentThreadId = vi.fn()
    h.threadsState.updateThread = vi.fn()
    h.messagesState.getMessages = vi.fn(() => [
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
      },
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'hello', annotations: [] } }],
      },
    ])
    h.messagesState.addMessage = vi.fn()
    h.messagesState.updateMessage = vi.fn()
    h.messagesState.deleteMessage = vi.fn()
    h.messagesState.setMessages = vi.fn()
    h.chatSessionsState.getSessionData = vi.fn(() => ({ tools: [] }))
    h.messageQueueState.dequeue = vi.fn(() => null)
    h.messageQueueState.clearQueue = vi.fn()
    h.agentModeState.agentThreads = {}
    h.modelProviderState.selectedProvider = 'openai'
    h.appStateState.oomError = undefined
    h.appStateState.ragToolNames = new Set<string>()
    h.appStateState.mcpToolNames = new Set<string>()
    h.appStateState.tools = []
    h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
    hub.mcp = realMcp
    useToolCallRuntime.getState().reset()
    sessionStorage.clear()
  })

  it('validateSearch returns threadModel from search params', () => {
    const searchModel = { id: 'm1', provider: 'p1' }
    const result = (Route as any).validateSearch({ threadModel: searchModel })
    expect(result.threadModel).toEqual(searchModel)
  })

  it('validateSearch handles missing threadModel', () => {
    const result = (Route as any).validateSearch({})
    expect(result.threadModel).toBeUndefined()
  })

  it('renders header, model dropdown, and chat input', () => {
    renderComponent()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('model-dropdown')).toHaveTextContent('gpt-x')
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('chat-status')).toHaveTextContent('ready')
  })

  it('sets current thread id on mount and resets on unmount', () => {
    const { unmount } = renderComponent()
    expect(h.threadsState.setCurrentThreadId).toHaveBeenCalledWith('thread-1')
    unmount()
    expect(h.threadsState.setCurrentThreadId).toHaveBeenLastCalledWith(undefined)
  })

  // Leaving is not Stop: an approval the thread waits on stays up, and is still
  // there to answer on return (#9311).
  it('keeps this thread pending tool approvals on unmount', () => {
    const { unmount } = renderComponent()
    unmount()
    expect(h.toolApprovalState.clearPendingForThread).not.toHaveBeenCalled()
  })

  it('renders messages passed through useChat', () => {
    h.chatState.messages = [
      { id: 'm-a', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'm-b', role: 'assistant', parts: [{ type: 'text', text: 'yo' }] },
    ]
    renderComponent()
    expect(screen.getByTestId('message-m-a')).toBeInTheDocument()
    expect(screen.getByTestId('message-m-b')).toBeInTheDocument()
  })

  it('submits user text via ChatInput -> sendMessage', async () => {
    renderComponent()
    await act(async () => {
      screen.getByTestId('chat-send').click()
    })
    await waitFor(() => {
      expect(h.mockSendMessage).toHaveBeenCalled()
    })
    expect(h.messagesState.addMessage).toHaveBeenCalled()
  })

  it('keeps the thread in its project when attachments are embedded', async () => {
    const project = { id: 'p1', name: 'Proj', updated_at: 1 }
    h.threadsState.threads['thread-1'].metadata = { project }
    h.attachmentsState.getAttachments = vi.fn(() => [
      { name: 'doc.pdf', type: 'document', path: '/doc.pdf' },
    ])
    vi.mocked(processAttachmentsForSend).mockResolvedValueOnce({
      processedAttachments: [],
      hasEmbeddedDocuments: true,
    } as any)
    renderComponent()
    await act(async () => {
      screen.getByTestId('chat-send').click()
    })
    await waitFor(() => {
      expect(h.threadsState.updateThread).toHaveBeenCalledWith('thread-1', {
        metadata: { project, hasDocuments: true },
      })
    })
    h.attachmentsState.getAttachments = vi.fn(() => [])
  })

  it('keeps a project move made while attachments were embedding', async () => {
    const original = h.threadsState.threads['thread-1']
    const before = { id: 'p1', name: 'Before', updated_at: 1 }
    const moved = { id: 'p2', name: 'Moved', updated_at: 2 }
    h.threadsState.threads['thread-1'] = {
      ...original,
      metadata: { project: before },
    }
    h.attachmentsState.getAttachments = vi.fn(() => [
      { name: 'doc.pdf', type: 'document', path: '/doc.pdf' },
    ])
    vi.mocked(processAttachmentsForSend).mockImplementationOnce(async () => {
      // The user moves the thread to another project while it embeds.
      h.threadsState.threads['thread-1'] = {
        ...h.threadsState.threads['thread-1'],
        metadata: { project: moved, titleSetManually: true },
      }
      return { processedAttachments: [], hasEmbeddedDocuments: true } as any
    })
    renderComponent()
    await act(async () => {
      screen.getByTestId('chat-send').click()
    })
    await waitFor(() => {
      expect(h.threadsState.updateThread).toHaveBeenCalledWith('thread-1', {
        metadata: { project: moved, titleSetManually: true, hasDocuments: true },
      })
    })
    h.threadsState.threads['thread-1'] = original
    h.attachmentsState.getAttachments = vi.fn(() => [])
  })

  it('passes the auto-inline budget when sending documents', async () => {
    h.useAttachmentsState.autoInlineContextRatio = 0.75
    // 35 chars -> 10 estimated tokens + 4 per-message overhead.
    h.chatState.messages = [
      { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(35) }] },
    ]
    h.attachmentsState.getAttachments = vi.fn(() => [
      { name: 'sheet.xlsx', type: 'document', path: '/sheet.xlsx' },
    ])
    renderComponent()
    await act(async () => {
      screen.getByTestId('chat-send').click()
    })
    await waitFor(() => {
      expect(processAttachmentsForSend).toHaveBeenCalled()
    })
    expect(resolveAutoInlineBudget).toHaveBeenCalledWith(
      h.modelProviderState.selectedModel,
      'openai',
      0.75,
      14
    )
    expect(vi.mocked(processAttachmentsForSend).mock.calls[0][0]).toMatchObject({
      contextThreshold: 6144,
      parsePreference: 'auto',
    })
    expect(promptIngestionChoices).not.toHaveBeenCalled()
    h.attachmentsState.getAttachments = vi.fn(() => [])
  })

  describe('when processing a document fails', () => {
    const sheet = { name: 'sheet.xlsx', type: 'document', path: '/sheet.xlsx' }
    const later = { name: 'later.png', type: 'image', path: '/later.png' }

    // `openThreadId` is the thread the store reports as open when the failure
    // lands: its own, or null after the user went Home. The attachments are
    // keyed by thread, so they go back to it either way.
    const sendAndFail = async (openThreadId: string | null = 'thread-1') => {
      h.threadsState.currentThreadId = openThreadId ?? undefined
      h.attachmentsState.getAttachments = vi.fn(() => [sheet])
      vi.mocked(processAttachmentsForSend).mockRejectedValueOnce(
        new Error("Couldn't read sheet.xlsx as text.")
      )
      renderComponent()
      await act(async () => {
        screen.getByTestId('chat-send').click()
      })
      await waitFor(() => {
        expect(h.attachmentsState.setAttachments).toHaveBeenCalledWith(
          'thread-1',
          expect.any(Function)
        )
      })
    }

    afterEach(() => {
      h.attachmentsState.getAttachments = vi.fn(() => [])
      delete h.threadsState.currentThreadId
      usePrompt.getState().resetPrompt()
    })

    it('gives back the draft and attachments, ahead of any added since', async () => {
      await sendAndFail()

      const updater = vi
        .mocked(h.attachmentsState.setAttachments)
        .mock.calls.map((c) => c[1])
        .find((u) => typeof u === 'function')
      expect(updater?.([later])).toEqual([sheet, later])
      expect(usePrompt.getState().prompt).toBe('hello world')
      expect(h.mockSendMessage).not.toHaveBeenCalled()
    })

    it('keeps what the user typed while the document was processing', async () => {
      usePrompt.getState().setPrompt('typed meanwhile')
      await sendAndFail()

      expect(usePrompt.getState().prompt).toBe('typed meanwhile')
    })

    it('does not write the draft into another screen after the user left the thread', async () => {
      await sendAndFail(null)

      expect(usePrompt.getState().prompt).toBe('')
    })
  })

  describe('when the auto-inline budget is gone at send time', () => {
    const sheet = {
      name: 'sheet.xlsx',
      type: 'document',
      path: '/sheet.xlsx',
      parseMode: 'auto',
    }

    beforeEach(() => {
      // Cloud model, unloaded auto-fit model, or a conversation that has
      // outgrown the window all resolve to no budget.
      vi.mocked(resolveAutoInlineBudget).mockResolvedValueOnce(undefined)
      h.attachmentsState.getAttachments = vi.fn(() => [sheet])
    })

    it('asks the user and sends the document the way they chose', async () => {
      vi.mocked(promptIngestionChoices).mockResolvedValueOnce(
        new Map([['/sheet.xlsx', 'inline']])
      )
      renderComponent()
      await act(async () => {
        screen.getByTestId('chat-send').click()
      })
      await waitFor(() => {
        expect(processAttachmentsForSend).toHaveBeenCalled()
      })
      expect(promptIngestionChoices).toHaveBeenCalledWith([sheet])
      expect(
        vi.mocked(processAttachmentsForSend).mock.calls[0][0].attachments
      ).toEqual([{ ...sheet, parseMode: 'inline' }])
      h.attachmentsState.getAttachments = vi.fn(() => [])
    })

    it('cancelling keeps the draft and sends nothing', async () => {
      vi.mocked(promptIngestionChoices).mockResolvedValueOnce(undefined)
      renderComponent()
      await act(async () => {
        screen.getByTestId('chat-send').click()
      })
      await waitFor(() => {
        expect(h.attachmentsState.setAttachments).toHaveBeenCalledWith(
          'thread-1',
          [sheet]
        )
      })
      expect(usePrompt.getState().prompt).toBe('hello world')
      expect(processAttachmentsForSend).not.toHaveBeenCalled()
      expect(h.mockSendMessage).not.toHaveBeenCalled()
      expect(h.messagesState.addMessage).not.toHaveBeenCalled()
      h.attachmentsState.getAttachments = vi.fn(() => [])
      usePrompt.getState().resetPrompt()
    })

    it('cancelling restores the typed draft, not the expanded @references', async () => {
      vi.mocked(promptIngestionChoices).mockResolvedValueOnce(undefined)
      renderComponent()
      await act(async () => {
        screen.getByTestId('chat-send-ref').click()
      })
      await waitFor(() => {
        expect(usePrompt.getState().prompt).toBe('summarise @notes.md')
      })
      expect(h.mockSendMessage).not.toHaveBeenCalled()
      h.attachmentsState.getAttachments = vi.fn(() => [])
      usePrompt.getState().resetPrompt()
    })

    it('does not ask for project threads, whose files always embed', async () => {
      h.threadsState.threads['thread-1'].metadata = { project: { id: 'p1' } }
      renderComponent()
      await act(async () => {
        screen.getByTestId('chat-send').click()
      })
      await waitFor(() => {
        expect(processAttachmentsForSend).toHaveBeenCalled()
      })
      expect(promptIngestionChoices).not.toHaveBeenCalled()
      h.attachmentsState.getAttachments = vi.fn(() => [])
    })
  })

  it('invokes stop when ChatInput calls onStop', () => {
    renderComponent()
    screen.getByTestId('chat-stop').click()
    expect(h.mockStop).toHaveBeenCalled()
  })

  it('regenerate from a user message calls regenerate with its id', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('regen-u1').click()
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'u1' })
  })

  it('regenerate from an assistant message keeps the prior version (no delete)', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('regen-a1').click()
    // Versioning: the old reply is preserved, parent links are backfilled.
    expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a1' })
  })

  it('edit on a user message forks a new version and regenerates', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('edit-u1').click()
    // A new sibling version is added; the original branch is not deleted.
    expect(h.messagesState.addMessage).toHaveBeenCalled()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockSetChatMessages).toHaveBeenCalled()
    expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
    expect(h.mockRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: expect.any(String) })
    )
  })

  it('edit on an assistant message updates without regenerating', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    screen.getByTestId('edit-a1').click()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockRegenerate).not.toHaveBeenCalled()
  })

  it('shows a version chip and switches branches without regenerating', () => {
    const branched = [
      {
        id: 'u1',
        role: 'user',
        created_at: 1,
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: { parentId: null },
      },
      {
        id: 'a1a',
        role: 'assistant',
        created_at: 2,
        content: [{ type: 'text', text: { value: 'v1', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
      {
        id: 'a1b',
        role: 'assistant',
        created_at: 3,
        content: [{ type: 'text', text: { value: 'v2', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
    ]
    h.messagesState.messages = { 'thread-1': branched }
    h.messagesState.getMessages = vi.fn(() => branched)
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1b', role: 'assistant', parts: [{ type: 'text', text: 'v2' }] },
    ]
    renderComponent()
    // The active (newest) reply shows as version 2 of 2.
    expect(screen.getByTestId('version-a1b').textContent).toBe('2/2')
    screen.getByTestId('prev-a1b').click()
    // Switching pins the parent's active child and re-renders, no regeneration.
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockSetChatMessages).toHaveBeenCalled()
    expect(h.mockRegenerate).not.toHaveBeenCalled()
  })

  it('clears an active banner error when switching versions so a healthy assistant is not hidden', () => {
    // A prior turn left a router OOM banner active. Without clearing it on
    // switch, the render filter blanks the last assistant of whatever branch we
    // land on, leaving only user messages visible.
    h.modelProviderState.selectedProvider = 'llamacpp'
    h.appStateState.oomError = 'router crashed'
    const branched = [
      {
        id: 'u1',
        role: 'user',
        created_at: 1,
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: { parentId: null },
      },
      {
        id: 'a1a',
        role: 'assistant',
        created_at: 2,
        content: [{ type: 'text', text: { value: 'v1', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
      {
        id: 'a1b',
        role: 'assistant',
        created_at: 3,
        content: [{ type: 'text', text: { value: 'v2', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
    ]
    h.messagesState.messages = { 'thread-1': branched }
    h.messagesState.getMessages = vi.fn(() => branched)
    // a1b is rendered mid-list (a trailing user turn keeps it off the
    // last-message filter) so its version nav stays clickable.
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1b', role: 'assistant', parts: [{ type: 'text', text: 'v2' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'more' }] },
    ]
    renderComponent()
    screen.getByTestId('prev-a1b').click()
    expect(h.appStateState.setOomError).toHaveBeenCalledWith(undefined)
    expect(h.mockRegenerate).not.toHaveBeenCalled()
  })

  it('onFinish links a new assistant to the active user turn in a branched thread (never null parent)', () => {
    // Regression for #8357: once a thread is branched, a lost pending-parent ref
    // must not persist the assistant with parentId:null (which computeActivePath
    // drops as a phantom root, leaving "user messages in a row").
    const branched = [
      {
        id: 'u1',
        role: 'user',
        created_at: 1,
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: { parentId: null },
      },
      {
        id: 'a1',
        role: 'assistant',
        created_at: 2,
        content: [{ type: 'text', text: { value: 'r1', annotations: [] } }],
        metadata: { parentId: 'u1' },
      },
      {
        id: 'u2',
        role: 'user',
        created_at: 3,
        content: [{ type: 'text', text: { value: 'again', annotations: [] } }],
        metadata: { parentId: 'a1' },
      },
    ]
    h.messagesState.getMessages = vi.fn(() => branched)
    renderComponent()

    act(() => {
      ;(h as any).capturedOnFinish({
        message: {
          id: 'a2',
          role: 'assistant',
          parts: [{ type: 'text', text: 'reply for u2' }],
          metadata: {},
        },
        isAbort: false,
      })
    })

    const added = h.messagesState.addMessage.mock.calls.map((c: any[]) => c[0])
    const persisted = added.find((m: any) => m.id === 'a2')
    expect(persisted).toBeTruthy()
    expect(persisted.metadata.parentId).toBe('u2')
    expect(persisted.metadata.parentId).not.toBeNull()
  })

  describe('finishReason length (#9228)', () => {
    const finishAtLength = () =>
      (h as any).capturedOnFinish({
        message: {
          id: 'a-len',
          role: 'assistant',
          parts: [{ type: 'text', text: 'partial answer' }],
          metadata: {
            finishReason: 'length',
            usage: { inputTokens: 30000, outputTokens: 4000 },
          },
        },
        isAbort: false,
        isError: false,
      })

    it('keeps a truncated cloud reply as stopped instead of a context banner', () => {
      h.modelProviderState.selectedProvider = 'anthropic'
      renderComponent()
      act(() => {
        finishAtLength()
      })
      const added = h.messagesState.addMessage.mock.calls.map((c: any[]) => c[0])
      const persisted = added.find((m: any) => m.id === 'a-len')
      expect(persisted).toBeTruthy()
      expect(persisted.metadata.stopped).toBe(true)
      expect(screen.queryByText('Increase Context Size')).toBeNull()
    })

    it('still offers Increase Context Size for a local model near ctx_len', () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      renderComponent()
      act(() => {
        finishAtLength()
      })
      expect(
        h.messagesState.addMessage.mock.calls.some((c: any[]) => c[0].id === 'a-len')
      ).toBe(false)
      expect(screen.getByText('Increase Context Size')).toBeInTheDocument()
    })
  })

  // #9311: a turn keeps running after the user opens another thread, and its
  // onFinish is a closure of the render that created its chat. What the open
  // thread set up for its own next reply, and its banners, must not be taken
  // or shown by the background thread's turn.
  describe('a turn finishing behind another thread', () => {
    const Component = () => Route.component as React.ComponentType
    const text = (value: string) => [
      { type: 'text', text: { value, annotations: [] } },
    ]
    const threadB = [
      { id: 'b-u1', role: 'user', created_at: 1, content: text('q'), metadata: { parentId: null } },
      { id: 'b-a1', role: 'assistant', created_at: 2, content: text('r'), metadata: { parentId: 'b-u1' } },
    ]
    const openThreadB = (rerender: (ui: React.ReactElement) => void) => {
      const C = Component()
      h.routeParams.threadId = 'thread-2'
      h.threadsState.threads['thread-2'] = {
        id: 'thread-2',
        title: 'Other',
        metadata: {},
        assistants: [],
        model: { id: 'gpt-x', provider: 'openai' },
      }
      const threadA = h.messagesState.getMessages()
      h.messagesState.getMessages = vi.fn((id?: string) =>
        id === 'thread-2' ? threadB : threadA
      )
      h.chatState.messages = [
        { id: 'b-u1', role: 'user', parts: [{ type: 'text', text: 'q' }] },
        { id: 'b-a1', role: 'assistant', parts: [{ type: 'text', text: 'r' }] },
      ]
      rerender(<C />)
    }
    const persisted = (id: string) =>
      h.messagesState.addMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m.id === id)

    afterEach(() => {
      h.routeParams.threadId = 'thread-1'
      delete h.threadsState.threads['thread-2']
    })

    it("leaves the open thread's pending reply parent for its own reply", () => {
      const { rerender } = renderComponent()
      const onFinishA = (h as any).capturedOnFinish
      openThreadB(rerender)
      // The open thread starts a new version of its reply.
      act(() => {
        screen.getByTestId('regen-b-a1').click()
      })

      act(() => {
        onFinishA({
          message: { id: 'a-bg', role: 'assistant', parts: [{ type: 'text', text: 'A' }], metadata: {} },
          isAbort: false,
        })
      })
      expect(persisted('a-bg').thread_id).toBe('thread-1')
      expect(persisted('a-bg').metadata.parentId).not.toBe('b-u1')

      act(() => {
        ;(h as any).capturedOnFinish({
          message: { id: 'b-a2', role: 'assistant', parts: [{ type: 'text', text: 'B' }], metadata: {} },
          isAbort: false,
        })
      })
      expect(persisted('b-a2').metadata.parentId).toBe('b-u1')
    })

    // The partial shown while the model reloads after "Increase Context Size"
    // belongs to its thread: never shown in another, and cleared by its own
    // turn finishing even while another thread is open.
    it("keeps the reload placeholder to its own thread", async () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      const C = Route.component as React.ComponentType
      const { rerender } = renderComponent()
      const onFinishA = (h as any).capturedOnFinish
      act(() => {
        onFinishA({
          message: {
            id: 'a-len',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial answer' }],
            metadata: {
              finishReason: 'length',
              usage: { inputTokens: 30000, outputTokens: 4000 },
            },
          },
          isAbort: false,
          isError: false,
        })
      })
      const realModels = hub.models as () => Record<string, unknown>
      hub.models = () => ({
        ...realModels(),
        updateModelSettings: vi.fn().mockResolvedValue(undefined),
      })
      // The click regenerates after a delay; it must not fire in a later test.
      vi.useFakeTimers()
      try {
        await act(async () => {
          screen.getByText('Increase Context Size').click()
        })
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
        hub.models = realModels
      }
      // In front, its own thread shows the partial while the model reloads.
      h.chatState.status = 'submitted'
      rerender(<C />)
      expect(screen.getByTestId('message-a-len')).toBeInTheDocument()

      openThreadB(rerender)
      expect(screen.queryByTestId('message-a-len')).toBeNull()

      // A's resumed reply finishes behind B.
      act(() => {
        onFinishA({
          message: { id: 'a-len', role: 'assistant', parts: [{ type: 'text', text: 'partial answer, done' }], metadata: {} },
          isAbort: false,
        })
      })
      h.routeParams.threadId = 'thread-1'
      h.chatState.messages = []
      rerender(<C />)
      expect(screen.queryByTestId('message-a-len')).toBeNull()
    })

    it("does not show its context-limit banner on the open thread", () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      const { rerender } = renderComponent()
      const onFinishA = (h as any).capturedOnFinish
      openThreadB(rerender)

      act(() => {
        onFinishA({
          message: {
            id: 'a-len',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial answer' }],
            metadata: {
              finishReason: 'length',
              usage: { inputTokens: 30000, outputTokens: 4000 },
            },
          },
          isAbort: false,
          isError: false,
        })
      })

      expect(screen.queryByText('Increase Context Size')).toBeNull()
      // Stamped on its own thread instead, which shows it on return.
      const stamped = h.messagesState.updateMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m.metadata?.contextError)
      expect(stamped?.id).toBe('u1')
    })
  })

  describe('empty replies (#9228)', () => {
    beforeEach(() => {
      useMessageErrors.getState().clearAll()
    })

    const finishEmpty = (extra: Record<string, unknown> = {}) =>
      (h as any).capturedOnFinish({
        message: {
          id: 'a-empty',
          role: 'assistant',
          parts: [],
          metadata: { finishReason: 'stop' },
        },
        isAbort: false,
        isError: false,
        ...extra,
      })

    it('pins the error on the user turn, which is persisted', () => {
      // The empty assistant reply is never saved, so an error keyed to it
      // would vanish on reload; the user message survives and is hydrated.
      renderComponent()
      act(() => {
        finishEmpty()
      })
      const err = useMessageErrors.getState().errors['u1']
      expect(err).toBeTruthy()
      expect(err).not.toContain(':')
      expect(useMessageErrors.getState().errors['a-empty']).toBeUndefined()
    })

    it('persists the empty-reply error into the user turn metadata', () => {
      const u1 = {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'hi', annotations: [] } }],
        metadata: {},
      }
      h.messagesState.messages = { 'thread-1': [u1] }
      h.messagesState.getMessages = vi.fn(() => [u1])
      renderComponent()
      act(() => {
        finishEmpty()
      })
      const persisted = h.messagesState.updateMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m.id === 'u1' && m.metadata?.error)
      expect(persisted?.metadata.error).toBe(
        useMessageErrors.getState().errors['u1']
      )
    })

    it('does not flag a reply the user stopped', () => {
      renderComponent()
      act(() => {
        finishEmpty({ isAbort: true })
      })
      expect(useMessageErrors.getState().errors['a-empty']).toBeUndefined()
    })

    // Stopped right after the tool call started, before any input arrived: the
    // turn has nothing worth persisting, but its live card must not stay
    // "Running".
    it('settles a live tool call stopped before it had any input', () => {
      renderComponent()
      h.mockSetChatMessages.mockClear()
      act(() => {
        ;(h as any).capturedOnFinish({
          message: {
            id: 'a-early',
            role: 'assistant',
            parts: [{ type: 'tool-fetch', toolCallId: 'tcE', state: 'input-streaming' }],
            metadata: {},
          },
          isAbort: true,
          isError: false,
        })
      })
      const updater = h.mockSetChatMessages.mock.calls
        .map((c: any[]) => c[0])
        .find((a: unknown) => typeof a === 'function')
      // The open thread's own last message is still mid-call; it is not the
      // aborted turn, so it must be left alone.
      const other = {
        id: 'a-other',
        role: 'assistant',
        parts: [{ type: 'tool-fetch', toolCallId: 'tcO', state: 'input-available' }],
      }
      const live = [
        {
          id: 'a-early',
          role: 'assistant',
          parts: [{ type: 'tool-fetch', toolCallId: 'tcE', state: 'input-streaming' }],
        },
        other,
      ]
      const out = updater(live)
      expect(out[0].parts[0]).toMatchObject({ state: 'output-error' })
      expect(out[1]).toBe(other)
    })
  })

  describe('context overflow banner (#9228)', () => {
    it('does not offer a no-op Increase Context Size for a cloud overflow', () => {
      h.modelProviderState.selectedProvider = 'anthropic'
      h.chatState.status = 'error'
      h.chatState.error = new Error(
        'input length and `max_tokens` exceed context limit: 188240 + 21333 > 200000'
      )
      h.chatState.messages = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ]
      renderComponent()
      expect(screen.getByText('Model ran out of context size')).toBeInTheDocument()
      expect(screen.queryByText('Increase Context Size')).toBeNull()
      // The provider's own text says what to cut; the generic string hid it.
      expect(
        screen.getByText(/188240 \+ 21333 > 200000/)
      ).toBeInTheDocument()
      // Regenerate would re-send the same oversized prompt.
      expect(screen.queryByText('Regenerate')).toBeNull()
    })

    it('offers Increase Context Size for a llamacpp overflow', () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      h.chatState.status = 'error'
      h.chatState.error = new Error(
        'request (518 tokens) exceeds the available context size (512 tokens)'
      )
      h.chatState.messages = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ]
      renderComponent()
      expect(screen.getByText('Increase Context Size')).toBeInTheDocument()
    })
  })

  // #9222: the shell switch is enforced where the command would run, so a call
  // that still arrives while it is off (replayed history, a turn in flight when
  // the switch flipped) is refused rather than auto-approved.
  describe('the chat shell switch at execution time', () => {
    const shellCall = (id: string) => ({
      toolCall: { toolCallId: id, toolName: 'shell', input: { command: 'ls' } },
    })
    const finish = () =>
      (h as any).capturedOnFinish({
        message: {
          id: 'a-sh',
          role: 'assistant',
          parts: [{ type: 'text', text: '' }],
          metadata: { finishReason: 'tool-calls' },
        },
        isAbort: false,
      })

    beforeEach(() => {
      shell.enabled = true
      shell.execute.mockClear()
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(false)
    })

    it('runs the shell without a prompt while the switch is on', async () => {
      renderComponent()
      await act(async () => {
        await (h as any).capturedOnToolCall(shellCall('sh1'))
      })
      await act(async () => {
        await finish()
      })
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(shell.execute).toHaveBeenCalledTimes(1)
    })

    it('does not run the shell, and says why, once the switch is off', async () => {
      shell.enabled = false
      renderComponent()
      await act(async () => {
        await (h as any).capturedOnToolCall(shellCall('sh2'))
      })
      await act(async () => {
        await finish()
      })
      expect(shell.execute).not.toHaveBeenCalled()
      expect(h.mockAddToolOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'sh2',
          tool: 'shell',
          state: 'output-error',
          // What the model reads on its next turn: why the call did not run, and
          // that calling it again cannot succeed.
          errorText: expect.stringMatching(/turned off.*Do not call the shell again/s),
        })
      )
    })

    // A prompt for a tool the user turned off is itself wrong: an "always allow"
    // answer could save a permission for it. It is refused before any prompt,
    // on both paths that can open one.
    it('never prompts for a shell call while the switch is off', async () => {
      shell.enabled = false
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      renderComponent()
      await act(async () => {
        await (h as any).capturedOnToolCall(shellCall('sh3'))
      })
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      await act(async () => {
        await finish()
      })
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(shell.execute).not.toHaveBeenCalled()
    })

    // Turning the built-in off must not break a user's own MCP tool that happens
    // to be called `shell`: it is not offered by the built-in any more, so the
    // call is served by the MCP server and prompts like any MCP call.
    it('serves an MCP tool named shell while the switch is off', async () => {
      shell.enabled = false
      h.appStateState.mcpToolNames = new Set(['shell'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      const callTool = vi.fn().mockResolvedValue({ error: '', content: [] })
      hub.mcp = () =>
        ({
          callToolWithCancellation: (args: unknown) => ({
            promise: callTool(args),
            cancel: vi.fn().mockResolvedValue(undefined),
            token: 't',
          }),
        }) as never
      renderComponent()
      await act(async () => {
        await (h as any).capturedOnToolCall(shellCall('sh4'))
      })
      await act(async () => {
        await finish()
      })
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
      expect(callTool).toHaveBeenCalledTimes(1)
      expect(shell.execute).not.toHaveBeenCalled()
      expect(h.mockAddToolOutput).not.toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'sh4', state: 'output-error' })
      )
    })
  })

  describe('tool-call approval requested early, execution stays in onFinish', () => {
    const toolCall = (id: string) => ({
      toolCall: { toolCallId: id, toolName: 'fetch', input: { url: 'x' } },
    })
    const finishWithToolCalls = () =>
      (h as any).capturedOnFinish({
        message: {
          id: 'a-tc',
          role: 'assistant',
          parts: [{ type: 'text', text: '' }],
          metadata: { finishReason: 'tool-calls' },
        },
        isAbort: false,
      })

    it('requests approval as soon as a tool call arrives, before onFinish', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      renderComponent()

      expect((h as any).capturedOnToolCall).toBeTypeOf('function')

      await act(async () => {
        await (h as any).capturedOnToolCall(toolCall('tc1'))
      })

      // Popup is requested purely from the tool-call arrival, decoupled from onFinish.
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledWith(
        'tc1',
        'fetch',
        'thread-1',
        undefined
      )
    })

    // The prompt offers to trust the whole server, so it needs to know which.
    it('passes the tool server along with the approval request', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.appStateState.tools = [{ name: 'fetch', server: 'fetch-server' }]
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      renderComponent()

      await act(async () => {
        await (h as any).capturedOnToolCall(toolCall('tc-server'))
      })

      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledWith(
        'tc-server',
        'fetch',
        'thread-1',
        'fetch-server'
      )
    })

    it('does NOT execute the tool from onToolCall (execution deferred to onFinish)', async () => {
      // Executing during streaming lands addToolResult on an incomplete message,
      // which suppresses auto-resubmit and makes the model appear to "stop".
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      renderComponent()

      await act(async () => {
        await (h as any).capturedOnToolCall(toolCall('tc1'))
      })

      expect(h.mockAddToolOutput).not.toHaveBeenCalled()
    })

    it('executes approved tools in onFinish so the completed message can auto-resubmit', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      renderComponent()

      await act(async () => {
        await (h as any).capturedOnToolCall(toolCall('tc2'))
      })
      await act(async () => {
        await finishWithToolCalls()
      })

      // Global setup mock resolves callTool to { error: '', content: [] }.
      expect(h.mockAddToolOutput).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc2', tool: 'fetch' })
      )
    })

    it('reuses the early approval instead of prompting twice', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      renderComponent()

      await act(async () => {
        await (h as any).capturedOnToolCall(toolCall('tc4'))
      })
      await act(async () => {
        await finishWithToolCalls()
      })

      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
    })

    // A tool result is injected into conversation history verbatim, so an
    // uncapped one can exhaust the context on its own (#8557). The budget the
    // model's own window affords is handed to the backend, which enforces it.
    it('caps the tool result against the active model context window', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      const callTool = vi.fn().mockResolvedValue({ error: '', content: [] })
      hub.mcp = () =>
        ({ callToolWithCancellation: cancellable(callTool) }) as never
      renderComponent()

      const onToolCall = (
        h as { capturedOnToolCall: (arg: unknown) => Promise<void> }
      ).capturedOnToolCall
      await act(async () => {
        await onToolCall(toolCall('tc5'))
      })
      await act(async () => {
        await finishWithToolCalls()
      })

      const { maxOutputChars } = callTool.mock.calls[0][0]
      // 4096-token window in the harness: a fraction of it, not the whole thing.
      expect(maxOutputChars).toBeGreaterThan(0)
      expect(maxOutputChars).toBeLessThan(4096 * 3.5)
    })

    it('omits the cap when the model reports no context window', async () => {
      // Remote providers often don't; the user's configured ceiling then governs
      // alone rather than an invented budget silently clipping output.
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      const previousSettings = h.modelProviderState.selectedModel.settings
      h.modelProviderState.selectedModel.settings = {}
      const callTool = vi.fn().mockResolvedValue({ error: '', content: [] })
      hub.mcp = () =>
        ({ callToolWithCancellation: cancellable(callTool) }) as never

      try {
        renderComponent()
        const onToolCall = (
          h as { capturedOnToolCall: (arg: unknown) => Promise<void> }
        ).capturedOnToolCall
        await act(async () => {
          await onToolCall(toolCall('tc6'))
        })
        await act(async () => {
          await finishWithToolCalls()
        })

        expect(callTool.mock.calls[0][0].maxOutputChars).toBeUndefined()
      } finally {
        h.modelProviderState.selectedModel.settings = previousSettings
      }
    })

    // A page is a tool result like any other: held to the budget the window
    // affords, not the 40,000 characters it used to be allowed (#9170).
    it('hands a built-in web tool the budget of the active model context window', async () => {
      webTool.executeWebTool.mockReset()
      webTool.executeWebTool.mockResolvedValue({ content: 'page' })
      renderComponent()

      const onToolCall = (
        h as { capturedOnToolCall: (arg: unknown) => Promise<void> }
      ).capturedOnToolCall
      await act(async () => {
        await onToolCall({
          toolCall: {
            toolCallId: 'tcw',
            toolName: 'web_fetch',
            input: { url: 'https://example.com' },
          },
        })
      })
      await act(async () => {
        await finishWithToolCalls()
      })

      expect(webTool.executeWebTool).toHaveBeenCalledTimes(1)
      const [name, input, options] = webTool.executeWebTool.mock.calls[0]
      expect(name).toBe('web_fetch')
      expect(input).toEqual({ url: 'https://example.com' })
      // 4096-token window in the harness: a fraction of it, not the whole thing.
      expect(options.maxOutputChars).toBeGreaterThan(0)
      expect(options.maxOutputChars).toBeLessThan(4096 * 3.5)
    })

    // A model can request several tools in one turn. They arrive together but
    // are executed one at a time, which is what the queue display depends on.
    describe('several tool calls in one turn', () => {
      const arrive = async (...ids: string[]) => {
        for (const id of ids) {
          await act(async () => {
            await (h as any).capturedOnToolCall(toolCall(id))
          })
        }
      }

      it('executes every call in the turn', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        renderComponent()
        await arrive('tcA', 'tcB', 'tcC')
        await act(async () => {
          await finishWithToolCalls()
        })

        const ids = h.mockAddToolOutput.mock.calls.map(
          (c: any[]) => c[0].toolCallId
        )
        expect(ids).toEqual(['tcA', 'tcB', 'tcC'])
      })

      it('runs them one at a time, not concurrently', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const started: string[] = []
        let releaseFirst: (() => void) | undefined
        const callTool = vi.fn(({ arguments: args }: any) => {
          started.push(args.id)
          if (started.length === 1) {
            return new Promise((resolve) => {
              releaseFirst = () => resolve({ error: '', content: [] })
            })
          }
          return Promise.resolve({ error: '', content: [] })
        })
        hub.mcp = () =>
          ({ callToolWithCancellation: cancellable(callTool) }) as never

        renderComponent()
        await act(async () => {
          await (h as any).capturedOnToolCall({
            toolCall: {
              toolCallId: 'tcA',
              toolName: 'fetch',
              input: { id: 'tcA' },
            },
          })
          await (h as any).capturedOnToolCall({
            toolCall: {
              toolCallId: 'tcB',
              toolName: 'fetch',
              input: { id: 'tcB' },
            },
          })
        })
        await act(async () => {
          await finishWithToolCalls()
        })

        // Second call must not have been dispatched while the first is pending.
        expect(started).toEqual(['tcA'])
        await act(async () => {
          releaseFirst?.()
        })
        expect(started).toEqual(['tcA', 'tcB'])
      })

      // A call that never returns must not hold the loop, the thread, or the
      // backend: Stop ends all three, and the stopped call's output is dropped.
      it('Stop cancels a running MCP call and frees the thread', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const cancel = vi.fn().mockResolvedValue(undefined)
        const never = new Promise(() => {})
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: never,
              cancel,
              token: 't',
            }),
          }) as never
        h.appStateState.setThreadBusy.mockClear()
        h.mockAddToolOutput.mockClear()

        renderComponent()
        await arrive('tcA')
        await act(async () => {
          await finishWithToolCalls()
        })
        expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith(
          'thread-1',
          true
        )

        await act(async () => {
          screen.getByTestId('chat-stop').click()
        })

        expect(cancel).toHaveBeenCalledTimes(1)
        expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith(
          'thread-1',
          false
        )
        expect(h.mockAddToolOutput).not.toHaveBeenCalled()
      })

      // Edit and regenerate stay available while tools run (the status is
      // `ready`). The new reply replaces the turn it answers, so the call that
      // turn still has running must be ended first, or the new turn's loop would
      // take over the controllers and Stop could no longer reach it.
      it.each([
        ['editing a message', 'edit-u1'],
        ['regenerating a reply', 'regen-a-tc'],
      ])('%s ends the tool call the replaced turn still has running', async (_name, button) => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const cancel = vi.fn().mockResolvedValue(undefined)
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise(() => {}),
              cancel,
              token: 't',
            }),
          }) as never
        h.chatState.messages = [
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
          { id: 'a-tc', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
        ]

        renderComponent()
        await arrive('tcA')
        await act(async () => {
          await finishWithToolCalls()
        })
        await act(async () => {
          screen.getByTestId(button).click()
        })

        expect(cancel).toHaveBeenCalledTimes(1)
        expect(h.mockRegenerate).toHaveBeenCalled()
      })

      // A reply with no tool calls has no loop. If it registered one anyway it
      // would take the controllers of an earlier turn whose call is still
      // running, and its empty loop would delete them: Stop could no longer end
      // that call.
      it('a reply without tool calls leaves an earlier running call stoppable', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const cancel = vi.fn().mockResolvedValue(undefined)
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise(() => {}),
              cancel,
              token: 't',
            }),
          }) as never
        const Component = Route.component as React.ComponentType

        const { rerender } = renderComponent()
        await arrive('tcA')
        await act(async () => {
          await finishWithToolCalls()
        })

        // A newer reply with no tool calls finishes (a fresh render, so a fresh
        // tool list).
        rerender(<Component />)
        await act(async () => {
          await finishWithToolCalls()
        })

        await act(async () => {
          screen.getByTestId('chat-stop').click()
        })
        expect(cancel).toHaveBeenCalledTimes(1)
      })

      // Leaving the thread ends the loop but is not a Stop: a call already
      // running keeps going and its result still lands in the retained session.
      it('leaving the thread does not cancel a running MCP call', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const cancel = vi.fn().mockResolvedValue(undefined)
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise(() => {}),
              cancel,
              token: 't',
            }),
          }) as never

        const { unmount } = renderComponent()
        await arrive('tcA')
        await act(async () => {
          await finishWithToolCalls()
        })
        unmount()

        expect(cancel).not.toHaveBeenCalled()
      })

      // Deleting the thread is the one other way a running call ends: its result
      // would have nowhere to go.
      it('deleting the thread cancels its running MCP call', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const cancel = vi.fn().mockResolvedValue(undefined)
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise(() => {}),
              cancel,
              token: 't',
            }),
          }) as never

        renderComponent()
        await arrive('tcA')
        await act(async () => {
          await finishWithToolCalls()
        })
        expect(cancel).not.toHaveBeenCalled()
        await act(async () => {
          h.removeChatSession('thread-1')
        })

        expect(cancel).toHaveBeenCalledTimes(1)
      })

      // The left thread's finished cards unmount, so their runtime state goes;
      // a call its loop is still running stays for its return, and another
      // thread's state is not touched.
      it("leaving a thread releases only its own settled runtime state", async () => {
        const runtime = useToolCallRuntime.getState()
        runtime.enqueue(['a-done', 'a-running'], 'thread-1')
        runtime.markRunning('a-done')
        runtime.markSettled('a-done')
        runtime.markRunning('a-running')
        runtime.enqueue(['b-done'], 'thread-3')
        runtime.markRunning('b-done')
        runtime.markSettled('b-done')
        const Component = Route.component as React.ComponentType

        try {
          const { rerender } = renderComponent()
          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
        } finally {
          h.routeParams.threadId = 'thread-1'
        }

        const { timings } = useToolCallRuntime.getState()
        expect(timings['a-done']).toBeUndefined()
        expect(timings['a-running']?.startedAt).toBeDefined()
        expect(timings['b-done']).toBeDefined()
      })

      // A turn of a thread that was left can finish in the background, after
      // another thread is shown. A Stop there is that thread's, and must not end
      // the background thread's loop: its queued calls still run.
      it('Stop in the thread in front does not end another thread\'s loop', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
        const started: string[] = []
        const finish: Array<(r: unknown) => void> = []
        hub.mcp = () =>
          ({
            callToolWithCancellation: (args: any) => {
              started.push(args.arguments.id)
              return {
                promise: new Promise((resolve) => finish.push(resolve)),
                cancel: vi.fn().mockResolvedValue(undefined),
                token: 't',
              }
            },
          }) as never
        h.mockAddToolOutput.mockClear()
        const Component = Route.component as React.ComponentType
        const call = (id: string) => ({
          toolCall: { toolCallId: id, toolName: 'fetch', input: { id } },
        })

        try {
          const { rerender } = renderComponent()
          const onToolCallA = (h as any).capturedOnToolCall
          const onFinishA = (h as any).capturedOnFinish
          await act(async () => {
            await onToolCallA(call('tcA'))
            await onToolCallA(call('tcB'))
          })

          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
          await act(async () => {
            await onFinishA({
              message: {
                id: 'a-tc',
                role: 'assistant',
                parts: [{ type: 'text', text: '' }],
                metadata: { finishReason: 'tool-calls' },
              },
              isAbort: false,
            })
          })
          expect(started).toEqual(['tcA'])

          await act(async () => {
            screen.getByTestId('chat-stop').click()
          })
          await act(async () => {
            finish[0]({ error: '', content: [] })
          })

          expect(started).toEqual(['tcA', 'tcB'])
        } finally {
          h.routeParams.threadId = 'thread-1'
        }
      })

      // A loop left behind by a thread switch finishes later. It must not take
      // the controller of the thread now in front with it, or that thread's reply
      // would never continue after its tool result.
      it('a left thread\'s loop ending does not stop the current thread continuing', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const results: Array<(r: unknown) => void> = []
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise((resolve) => results.push(resolve)),
              cancel: vi.fn().mockResolvedValue(undefined),
              token: 't',
            }),
          }) as never
        const Component = Route.component as React.ComponentType

        try {
          const { rerender } = renderComponent()
          await arrive('tcA')
          await act(async () => {
            await finishWithToolCalls()
          })

          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
          await arrive('tcB')
          await act(async () => {
            await finishWithToolCalls()
          })

          // Thread 1's call, left running, now completes.
          await act(async () => {
            results[0]({ error: '', content: [] })
          })

          const followUp = (h as any).capturedSendAutomaticallyWhen
          expect(followUp({ messages: [] })).toBe(true)
        } finally {
          h.routeParams.threadId = 'thread-1'
        }
      })

      // The route component is reused across thread switches, so a Stop must
      // reach only the thread it is pressed in, and still work after returning.
      it('Stop reaches only its own thread\'s running call, also after returning', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const cancel = vi.fn().mockResolvedValue(undefined)
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise(() => {}),
              cancel,
              token: 't',
            }),
          }) as never
        const Component = Route.component as React.ComponentType

        try {
          const { rerender } = renderComponent()
          await arrive('tcA')
          await act(async () => {
            await finishWithToolCalls()
          })

          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
          await act(async () => {
            screen.getByTestId('chat-stop').click()
          })
          expect(cancel).not.toHaveBeenCalled()

          h.routeParams.threadId = 'thread-1'
          rerender(<Component />)
          await act(async () => {
            screen.getByTestId('chat-stop').click()
          })
          expect(cancel).toHaveBeenCalledTimes(1)
        } finally {
          h.routeParams.threadId = 'thread-1'
        }
      })

      // The turn was stored before any tool ran, so a call that finished while
      // another was still running has its output only in the rendered message.
      it('Stop keeps a finished call\'s output and settles only the running one', async () => {
        const part = (id: string, state: string, extra: object = {}) => ({
          type: 'tool-fetch',
          toolCallId: id,
          input: {},
          state,
          ...extra,
        })
        const stored = {
          id: 'a-tools',
          role: 'assistant',
          content: [],
          metadata: { parentId: 'u1' },
        }
        h.messagesState.getMessages = vi.fn(() => [stored])
        h.chatState.messages = [
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
          {
            id: 'a-tools',
            role: 'assistant',
            parts: [
              part('tcA', 'output-available', { output: 'result A' }),
              part('tcB', 'input-available'),
            ],
          },
        ]
        renderComponent()

        await act(async () => {
          screen.getByTestId('chat-stop').click()
        })

        const rewritten = h.messagesState.updateMessage.mock.calls
          .map((c: any[]) => c[0])
          .find((m: any) => m.id === 'a-tools')
        expect(rewritten.content).toEqual([
          { type: 'tool_call', tool_call_id: 'tcA', output: 'result A' },
          { type: 'tool_call', tool_call_id: 'tcB', output: undefined },
        ])
        expect(rewritten.metadata).toMatchObject({
          parentId: 'u1',
          stopped: true,
          toolErrors: { tcB: expect.stringContaining('Stopped') },
        })
        expect(rewritten.metadata.toolErrors).not.toHaveProperty('tcA')
      })

      // Leaving the thread deletes the loop controller but leaves the call
      // running. A Stop after coming back, with a newer turn sent since, must
      // still settle the turn that owns the call.
      it('Stop after returning to the thread still settles the turn that owns the call', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise(() => {}),
              cancel: vi.fn().mockResolvedValue(undefined),
              token: 't',
            }),
          }) as never
        h.messagesState.getMessages = vi.fn(() => [
          { id: 'a-tc', role: 'assistant', content: [], metadata: {} },
        ])
        h.chatSessionsState.sessions = {
          'thread-1': {
            transport: { getTurnModelSelection: () => null },
            chat: {
              messages: [
                {
                  id: 'a-tc',
                  role: 'assistant',
                  parts: [
                    {
                      type: 'tool-fetch',
                      toolCallId: 'tcA',
                      input: {},
                      state: 'input-available',
                    },
                  ],
                },
                { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
                {
                  id: 'a-newer',
                  role: 'assistant',
                  parts: [{ type: 'text', text: 'a newer turn' }],
                },
              ],
            },
          },
        }
        h.messagesState.updateMessage.mockClear()
        const Component = Route.component as React.ComponentType

        try {
          const { rerender } = renderComponent()
          await arrive('tcA')
          await act(async () => {
            await finishWithToolCalls()
          })

          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
          h.routeParams.threadId = 'thread-1'
          rerender(<Component />)

          await act(async () => {
            screen.getByTestId('chat-stop').click()
          })
        } finally {
          h.routeParams.threadId = 'thread-1'
          h.chatSessionsState.sessions = {}
        }

        const stored = h.messagesState.updateMessage.mock.calls
          .map((c: any[]) => c[0])
          .find((m: any) => m.id === 'a-tc')
        expect(stored.metadata.toolErrors).toEqual({
          tcA: expect.stringContaining('Stopped'),
        })
      })

      // The composer still sends while tools run, so the last message can be a
      // newer turn. Stop ends the older turn's loop, and that is the turn whose
      // call must be settled.
      it('Stop settles the turn whose loop it aborts, not just the last message', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        h.toolApprovalState.requestApproval = vi.fn(
          () => new Promise<boolean>(() => {})
        )
        h.messagesState.getMessages = vi.fn(() => [
          { id: 'a-tc', role: 'assistant', content: [], metadata: {} },
        ])
        h.chatSessionsState.sessions = {
          'thread-1': {
            transport: { getTurnModelSelection: () => null },
            chat: {
              messages: [
                {
                  id: 'a-tc',
                  role: 'assistant',
                  parts: [
                    {
                      type: 'tool-fetch',
                      toolCallId: 'tcA',
                      input: {},
                      state: 'input-available',
                    },
                  ],
                },
                { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
                {
                  id: 'a-newer',
                  role: 'assistant',
                  parts: [{ type: 'text', text: 'a newer turn' }],
                },
              ],
            },
          },
        }
        h.messagesState.updateMessage.mockClear()

        try {
          renderComponent()
          await arrive('tcA')
          await act(async () => {
            await finishWithToolCalls()
          })
          await act(async () => {
            screen.getByTestId('chat-stop').click()
          })
        } finally {
          h.chatSessionsState.sessions = {}
        }

        const stored = h.messagesState.updateMessage.mock.calls
          .map((c: any[]) => c[0])
          .find((m: any) => m.id === 'a-tc')
        expect(stored.metadata.toolErrors).toEqual({
          tcA: expect.stringContaining('Stopped'),
        })
      })

      // The rendered messages are throttled; the SDK's chat state is current.
      // A result that landed inside the throttle window must not be saved as a
      // stopped call while the live copy holds it.
      it('Stop saves from the live chat state, not the throttled snapshot', async () => {
        const part = (state: string, extra: object = {}) => ({
          type: 'tool-fetch',
          toolCallId: 'tcA',
          input: {},
          state,
          ...extra,
        })
        h.messagesState.getMessages = vi.fn(() => [
          { id: 'a-tools', role: 'assistant', content: [], metadata: {} },
        ])
        // Stale: still waiting on the call.
        h.chatState.messages = [
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
          { id: 'a-tools', role: 'assistant', parts: [part('input-available')] },
        ]
        // Live: the result has just landed, and a second call is unfinished.
        h.chatSessionsState.sessions = {
          'thread-1': {
            transport: { getTurnModelSelection: () => null },
            chat: {
              messages: [
                { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
                {
                  id: 'a-tools',
                  role: 'assistant',
                  parts: [
                    part('output-available', { output: 'result A' }),
                    { ...part('input-available'), toolCallId: 'tcB' },
                  ],
                },
              ],
            },
          },
        }
        renderComponent()

        try {
          await act(async () => {
            screen.getByTestId('chat-stop').click()
          })
        } finally {
          h.chatSessionsState.sessions = {}
        }

        const rewritten = h.messagesState.updateMessage.mock.calls
          .map((c: any[]) => c[0])
          .find((m: any) => m.id === 'a-tools')
        expect(rewritten.content[0]).toMatchObject({
          tool_call_id: 'tcA',
          output: 'result A',
        })
        expect(rewritten.metadata.toolErrors).toEqual({
          tcB: expect.stringContaining('Stopped'),
        })
      })

      it('drains the runtime queue and times every call', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        renderComponent()
        await arrive('tcA', 'tcB')
        await act(async () => {
          await finishWithToolCalls()
        })

        const runtime = useToolCallRuntime.getState()
        expect(runtime.queue).toEqual([])
        for (const id of ['tcA', 'tcB']) {
          expect(runtime.timings[id]?.startedAt).toBeDefined()
          expect(runtime.timings[id]?.endedAt).toBeDefined()
        }
      })

      // Deleting the thread resolves a pending approval as denied. It must be
      // recorded, or the call stays "Running" with nothing running, but not as a
      // refusal by the user.
      it('records a cut-short approval as the chat closing, not a user denial', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        let decide: (approved: boolean) => void = () => {}
        h.toolApprovalState.requestApproval = vi.fn(
          () => new Promise<boolean>((resolve) => (decide = resolve))
        )
        h.mockAddToolOutput.mockClear()

        renderComponent()
        await arrive('tcA')
        await act(async () => {
          await finishWithToolCalls()
        })
        await act(async () => {
          h.removeChatSession('thread-1')
        })
        expect(h.toolApprovalState.clearPendingForThread).toHaveBeenCalledWith(
          'thread-1'
        )
        await act(async () => {
          decide(false)
        })

        expect(h.mockAddToolOutput).toHaveBeenCalledWith(
          expect.objectContaining({
            toolCallId: 'tcA',
            state: 'output-error',
            errorText: expect.stringContaining('chat was closed'),
          })
        )
      })

      // #9311: leaving a thread while its tool call runs must not end the turn.
      // The call's result lands and the reply continues: the follow-up check,
      // which the SDK runs as the result lands, still says to send.
      it('leaving the thread lets the turn continue after its tool call', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        let finish: (r: unknown) => void = () => {}
        hub.mcp = () =>
          ({
            callToolWithCancellation: () => ({
              promise: new Promise((resolve) => (finish = resolve)),
              cancel: vi.fn().mockResolvedValue(undefined),
              token: 't',
            }),
          }) as never
        const Component = Route.component as React.ComponentType

        try {
          const { rerender } = renderComponent()
          const followUpA = (h as any).capturedSendAutomaticallyWhen
          const followUps: boolean[] = []
          h.mockAddToolOutput.mockImplementation(() => {
            followUps.push(followUpA({ messages: [] }))
          })
          await arrive('tcA')
          await act(async () => {
            await finishWithToolCalls()
          })

          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
          await act(async () => {
            finish({ error: '', content: [{ type: 'text', text: 'ok' }] })
          })

          expect(h.mockAddToolOutput).toHaveBeenCalledWith(
            expect.objectContaining({ toolCallId: 'tcA', output: expect.anything() })
          )
          expect(followUps).toEqual([true])
        } finally {
          h.routeParams.threadId = 'thread-1'
          h.mockAddToolOutput.mockReset()
        }
      })

      // An approval the left thread waits on stays pending, so the user can
      // answer it on return; the call then runs and the reply continues.
      it('leaving the thread keeps its pending approval answerable', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        let decide: (approved: boolean) => void = () => {}
        h.toolApprovalState.requestApproval = vi.fn(
          () => new Promise<boolean>((resolve) => (decide = resolve))
        )
        const started: string[] = []
        hub.mcp = () =>
          ({
            callToolWithCancellation: (call: any) => {
              started.push(call.toolName)
              return {
                promise: Promise.resolve({ error: '', content: [] }),
                cancel: vi.fn().mockResolvedValue(undefined),
                token: 't',
              }
            },
          }) as never
        h.mockAddToolOutput.mockClear()
        const Component = Route.component as React.ComponentType

        try {
          const { rerender } = renderComponent()
          await arrive('tcA')
          await act(async () => {
            await finishWithToolCalls()
          })

          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
          expect(h.toolApprovalState.clearPendingForThread).not.toHaveBeenCalled()

          h.routeParams.threadId = 'thread-1'
          rerender(<Component />)
          await act(async () => {
            decide(true)
          })

          expect(started).toEqual(['fetch'])
          expect(h.mockAddToolOutput).toHaveBeenCalledWith(
            expect.objectContaining({ toolCallId: 'tcA' })
          )
          expect(h.mockAddToolOutput).not.toHaveBeenCalledWith(
            expect.objectContaining({ state: 'output-error' })
          )
        } finally {
          h.routeParams.threadId = 'thread-1'
        }
      })

      // The approval promises are shared by every thread's loop. A thread whose
      // turn is cut off must forget only its own, or the thread in front would
      // be asked again about a call the user may already have allowed.
      it('another thread ending does not drop the approval in flight here', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        h.toolApprovalState.requestApproval = vi.fn(
          () => new Promise<boolean>(() => {})
        )
        const Component = Route.component as React.ComponentType

        try {
          const { rerender } = renderComponent()
          const onFinishA = (h as any).capturedOnFinish

          h.routeParams.threadId = 'thread-2'
          rerender(<Component />)
          await arrive('tcB')
          expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)

          // Thread 1's turn is cut off in the background.
          await act(async () => {
            await onFinishA({
              message: {
                id: 'a-bg',
                role: 'assistant',
                parts: [{ type: 'text', text: '' }],
                metadata: {},
              },
              isAbort: true,
            })
          })
          await act(async () => {
            await finishWithToolCalls()
          })

          expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
        } finally {
          h.routeParams.threadId = 'thread-1'
        }
      })

      // The calls queued behind the one awaiting approval are cut short too.
      it('settles the calls queued behind one whose approval was cut short', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        const decide: Record<string, (approved: boolean) => void> = {}
        h.toolApprovalState.requestApproval = vi.fn(
          (id: string) =>
            new Promise<boolean>((resolve) => (decide[id] = resolve))
        )
        h.mockAddToolOutput.mockClear()

        renderComponent()
        await arrive('tcA', 'tcB')
        await act(async () => {
          await finishWithToolCalls()
        })
        await act(async () => {
          h.removeChatSession('thread-1')
        })
        await act(async () => {
          decide.tcA(false)
        })

        const settled = h.mockAddToolOutput.mock.calls.map(
          (c: any[]) => c[0].toolCallId
        )
        expect(settled).toEqual(['tcA', 'tcB'])
        expect(h.mockAddToolOutput).toHaveBeenLastCalledWith(
          expect.objectContaining({ toolCallId: 'tcB', state: 'output-error' })
        )
      })

      it('keeps going when one call is denied', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        h.toolApprovalState.requestApproval = vi.fn((id: string) =>
          Promise.resolve(id !== 'tcA')
        )
        renderComponent()
        await arrive('tcA', 'tcB')
        await act(async () => {
          await finishWithToolCalls()
        })

        const outputs = h.mockAddToolOutput.mock.calls.map((c: any[]) => c[0])
        expect(outputs[0]).toMatchObject({
          toolCallId: 'tcA',
          state: 'output-error',
        })
        expect(outputs[1]).toMatchObject({ toolCallId: 'tcB' })
        expect(outputs[1].state).not.toBe('output-error')
      })

      // A denied call never runs, so it has no duration -- but leaving it in
      // the queue would keep its card claiming it is waiting its turn.
      it('leaves nothing queued after a denied call', async () => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(false)
        renderComponent()
        await arrive('tcA', 'tcB')
        await act(async () => {
          await finishWithToolCalls()
        })

        const runtime = useToolCallRuntime.getState()
        expect(runtime.queue).toEqual([])
        expect(runtime.timings['tcA']?.startedAt).toBeUndefined()
        expect(runtime.timings['tcA']?.endedAt).toBeDefined()
      })
    })

    it('marks the thread busy during onFinish execution and clears it when tools drain', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
      renderComponent()

      await act(async () => {
        await (h as any).capturedOnToolCall(toolCall('tc5'))
      })
      await act(async () => {
        await finishWithToolCalls()
      })

      expect(h.appStateState.setThreadBusy).toHaveBeenCalledWith('thread-1', true)
      expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
    })
  })

  it('delete removes message from store and chat list', () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ]
    renderComponent()
    screen.getByTestId('del-u1').click()
    expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', 'u1')
    expect(h.mockSetChatMessages).toHaveBeenCalled()
  })

  it('shows PromptProgress while status is submitted', () => {
    h.chatState.status = 'submitted'
    renderComponent()
    expect(screen.getByTestId('prompt-progress')).toBeInTheDocument()
  })

  it('processes an initial message from sessionStorage on mount', async () => {
    sessionStorage.setItem(
      'initial-message-thread-1',
      JSON.stringify({ text: 'hello from storage' })
    )
    renderComponent()
    await waitFor(() => {
      expect(h.mockSendMessage).toHaveBeenCalled()
    })
    expect(sessionStorage.getItem('initial-message-thread-1')).toBeNull()
  })

  it('clears queue on unmount', () => {
    const { unmount } = renderComponent()
    unmount()
    expect(h.messageQueueState.clearQueue).toHaveBeenCalledWith('thread-1')
  })

  it('updates RAG tool availability based on thread/model capabilities', async () => {
    renderComponent()
    await waitFor(() => {
      expect(h.mockUpdateRag).toHaveBeenCalled()
    })
    const args = h.mockUpdateRag.mock.calls[0]
    expect(args[1]).toBe(true) // modelSupportsTools
    expect(args[2]).toBe(true) // ragFeatureAvailable
  })
})
