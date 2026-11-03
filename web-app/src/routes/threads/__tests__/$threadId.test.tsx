import { CHAT_RUN_NOTICE_METADATA } from '@/lib/chatRunNotice'
import { Chat, useChat as useSDKChat } from '@ai-sdk/react'
import { trackChat, quiesceChats, __resetChatCloseForTests } from '@/lib/chatClose'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as WebSearchConfigModule from '@/hooks/useWebSearchConfig'
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
    getConversationCapabilities: vi.fn(() => ({ version: 1, folderScope: null, shellNetwork: false, memoryWrite: false })),
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
    tools: [] as Array<{ name: string; server?: string; inputSchema?: unknown }>,
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
    isToolDisabled: vi.fn(() => false),
  }
  const useToolAvailableMock: any = (selector: any) => selector(toolAvailableState)
  useToolAvailableMock.getState = () => toolAvailableState

  const toolApprovalState: any = {
    approveToolForThread: vi.fn(),
    clearPendingForThread: vi.fn(),
    cancelApproval: vi.fn(),
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
  useMessageQueueMock.setState = (update: any) => Object.assign(messageQueueState, typeof update === 'function' ? update(messageQueueState) : update)

  return {
    // The route's thread id, which the tests move to simulate a thread switch.
    integrationChat: null as Chat | null,
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
  Link: ({ children }: any) => <a>{children}</a>,
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
    onContinue,
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
      <button data-testid={`continue-${message.id}`} onClick={() => onContinue(message.id)}>continue</button>
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

vi.mock('@/lib/messages', async (importOriginal) => {
  // The route's save path uses the real builder (and the real content
  // extraction inside it); the display-side converters stay controlled fakes.
  const actual = await importOriginal<typeof import('@/lib/messages')>()
  return {
    convertThreadMessagesToUIMessages: (msgs: any[]) =>
      msgs.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: 'text', text: m.content?.[0]?.text?.value ?? '' }],
      })),
    uiMessageHasMeaningfulContent: (msg: any) =>
      !!msg?.parts?.some((p: any) => p.type === 'text' && p.text?.trim()),
    toolErrorsOf: actual.toolErrorsOf,
    extractContentPartsFromUIMessage: actual.extractContentPartsFromUIMessage,
    assistantRecordFields: actual.assistantRecordFields,
  }
})

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

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateId: () => 'gen-id',
  lastAssistantMessageIsCompleteWithToolCalls: () => true,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}))

vi.mock('@/hooks/use-chat', () => ({
  useChat: (_args: any) => {
    // Model the session transport's last advertised identity, not the live menu.
    const threadId = h.routeParams.threadId
    const session = (h.chatSessionsState.sessions[threadId] ??= {})
    session.chat ??= {
      get messages() { return h.chatState.messages },
      set messages(messages) { h.chatState.messages = messages },
      stop: () => {
        h.mockStop()
        session.isStreaming = false
        h.appStateState.setThreadBusy(threadId, false)
      },
    }
    session.transport ??= { getTurnModelSelection: () => null }
    session.transport.cancelChatRun ??= vi.fn().mockResolvedValue(undefined)
    session.transport.setContinueFromContent ??= h.mockSetContinueFromContent
    session.transport.hasAdvertisedNativeTool ??= () => true
    session.transport.getMcpServerForTool ??= (name: string) =>
      h.appStateState.mcpToolNames.has(name)
        ? h.appStateState.tools.find((tool) => tool.name === name)?.server ?? 'test-server'
        : undefined
    ;(h as any).capturedOnFinish = _args?.onFinish
    ;(h as any).capturedOnToolCall = _args?.onToolCall
    ;(h as any).capturedDispatchTool = _args?.dispatchTool
    // Integration mode keeps the real SDK's reactive status/messages. The
    // normal branch remains a lightweight fixture for presentation-only tests.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const live = h.integrationChat ? useSDKChat({ chat: h.integrationChat }) : null
    if (live) {
      const threadId = _args.sessionId
      const session = h.chatSessionsState.sessions[threadId]
      if (session) session.isStreaming = live.status === 'submitted' || live.status === 'streaming'
      h.appStateState.busyThreads[threadId] = !!session?.isStreaming
      h.appStateState.setThreadBusy(threadId, !!session?.isStreaming)
    }
    return {
      messages: h.integrationChat?.messages ?? h.chatState.messages,
      status: live?.status ?? h.chatState.status,
      error: h.chatState.error,
      sendMessage: h.integrationChat ? (...args: Parameters<Chat['sendMessage']>) => h.integrationChat!.sendMessage(...args) : h.mockSendMessage,
      regenerate: h.integrationChat ? (...args: Parameters<Chat['regenerate']>) => h.integrationChat!.regenerate(...args) : h.mockRegenerate,
      setMessages: h.integrationChat ? (update: any) => {
        h.integrationChat!.messages = typeof update === 'function' ? update(h.integrationChat!.messages) : update
      } : h.mockSetChatMessages,
      stop: h.integrationChat ? () => h.integrationChat!.stop() : h.mockStop,
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
vi.mock('@/hooks/useToolApprovalRequests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useToolApprovalRequests')>()),
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

// The real store persists through localStorage on every write, which this
// environment does not provide; the route only reads the on/off switch.
const webConfig = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/hooks/useWebSearchConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSearchConfigModule>()),
  useWebSearchConfig: {
    getState: () => ({ webSearchEnabled: webConfig.enabled }),
  },
}))

// -----------------------------------------------------------------------------
// Import component AFTER mocks
// -----------------------------------------------------------------------------
import { Route } from '../$threadId'
import { createChatRunStream } from '@/lib/chatRunTransport'
import { CustomChatTransport } from '@/lib/custom-chat-transport'
import type { UIMessageChunk } from 'ai'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useMCPServers } from '@/hooks/useMCPServers'
import { toolOriginKey, useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { useMessageErrors } from '@/stores/message-errors'
import {
  processAttachmentsForSend,
  promptIngestionChoices,
  resolveAutoInlineBudget,
} from '@/lib/attachmentProcessing'
import { usePrompt } from '@/hooks/usePrompt'
import { computeActivePath } from '@/lib/message-branching'

// The global setup mock is a shared object, so an overridden factory has to be
// put back or it leaks into every later test.
const hub = getServiceHub() as unknown as Record<string, unknown>
const realMcp = hub.mcp
// Live discovery is independently controllable from the advertised transport.
const getMcpTools = vi.fn(async () =>
  [...h.appStateState.mcpToolNames].map((name) => ({
    name,
    server: h.appStateState.tools.find((tool) => tool.name === name)?.server ?? 'test-server',
  }))
)


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
    h.chatSessionsState.sessions = {}
    vi.clearAllMocks()
    h.integrationChat = null
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
    h.appStateState.busyThreads = {}
    h.appStateState.oomError = undefined
    h.appStateState.ragToolNames = new Set<string>()
    h.appStateState.mcpToolNames = new Set<string>()
    h.appStateState.tools = []
    h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue(true)
    getMcpTools.mockImplementation(async () =>
      [...h.appStateState.mcpToolNames].map((name) => ({
        name,
        server: h.appStateState.tools.find((tool) => tool.name === name)?.server ?? 'test-server',
      }))
    )
    h.toolAvailableState.isToolDisabled.mockReturnValue(false)
    hub.mcp = () => ({ ...(realMcp as () => object)(), getTools: getMcpTools })
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

  it('renders conversation header and chat input without a header model picker', () => {
    renderComponent()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.queryByTestId('model-dropdown')).not.toBeInTheDocument()
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

  // The save path runs the real assistantRecordFields: a streamed turn the
  // content round trip would lose is stored with its parts as uiParts.
  it('onFinish stores a lossy streamed turn with its uiParts', () => {
    renderComponent()
    const parts = [
      { type: 'step-start' },
      { type: 'reasoning', text: 'think', providerMetadata: { anthropic: { signature: 'sig' } } },
      { type: 'text', text: '\n\nanswer' },
    ]
    const onFinish = (h as any).capturedOnFinish
    act(() => {
      onFinish({
        message: { id: 'a-ui', role: 'assistant', parts, metadata: {} },
        isAbort: false,
        isError: false,
      })
    })
    const saved = h.messagesState.addMessage.mock.calls
      .map((c: any[]) => c[0])
      .find((m: any) => m.id === 'a-ui')
    expect(saved.content).toEqual([
      { type: 'reasoning', text: { value: 'think', annotations: [] } },
      { type: 'text', text: { value: '\n\nanswer', annotations: [] } },
    ])
    expect(saved.metadata.uiParts).toEqual({ v: 1, parts })
    expect(saved.metadata).not.toHaveProperty('uiPartsSkipped')
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

  it('handles a rejected production submit without phantom persistence or lost draft', async () => {
    const rejected = new Error('Chat turn already running')
    h.mockSendMessage.mockRejectedValueOnce(rejected)
    h.threadsState.currentThreadId = 'thread-1'
    usePrompt.getState().resetPrompt()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderComponent()
    await act(async () => { screen.getByTestId('chat-send').click() })
    await waitFor(() => expect(h.messagesState.deleteMessage).toHaveBeenCalled())
    const persisted = h.messagesState.addMessage.mock.calls[0][0]
    expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', persisted.id)
    expect(usePrompt.getState().prompt).toBeTruthy()
    expect(log).toHaveBeenCalledWith('Chat send was not accepted:', rejected)
    log.mockRestore()
    delete h.threadsState.currentThreadId
    usePrompt.getState().resetPrompt()
  })

  it('restores a rejected queued send without retaining a phantom user turn', async () => {
    const queued = { id: 'queued-fixture', text: 'preserve queued', createdAt: 1 }
    h.messageQueueState.queues = { 'thread-1': [] }
    h.messageQueueState.dequeue.mockReturnValueOnce(queued)
    h.mockSendMessage.mockRejectedValueOnce(new Error('Chat turn already running'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderComponent()
    await waitFor(() => expect(log).toHaveBeenCalledWith('Failed to send queued message:', expect.any(Error)))
    expect(h.messageQueueState.queues['thread-1']).toEqual([queued])
    const persisted = h.messagesState.addMessage.mock.calls[0][0]
    expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', persisted.id)
    log.mockRestore()
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

  it('regenerate from a user message calls regenerate with its id', async () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    await act(async () => { screen.getByTestId('regen-u1').click() })
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'u1' })
  })

  it('regenerate from an assistant message keeps the prior version (no delete)', async () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    await act(async () => { screen.getByTestId('regen-a1').click() })
    // Versioning: the old reply is preserved, parent links are backfilled.
    expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a1' })
  })

  it('edit on a user message forks a new version and regenerates', async () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    await act(async () => { screen.getByTestId('edit-u1').click() })
    // A new sibling version is added; the original branch is not deleted.
    expect(h.messagesState.addMessage).toHaveBeenCalled()
    expect(h.messagesState.updateMessage).toHaveBeenCalled()
    expect(h.mockSetChatMessages).toHaveBeenCalled()
    expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
    expect(h.mockRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: expect.any(String) })
    )
  })

  it('edit on an assistant message updates without regenerating', async () => {
    h.chatState.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]
    renderComponent()
    await act(async () => { screen.getByTestId('edit-a1').click() })
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

    // A reply that fills a local model's context was generated; dropping it left
    // the user with only their own message and a banner.
    it('keeps the partial reply of a local model near ctx_len, with the banner', () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      renderComponent()
      act(() => {
        finishAtLength()
      })
      const added = h.messagesState.addMessage.mock.calls.map((c: any[]) => c[0])
      const persisted = added.find((m: any) => m.id === 'a-len')
      expect(persisted).toBeTruthy()
      expect(persisted.metadata.stopped).toBe(true)
      expect(screen.getByText('Increase Context Size')).toBeInTheDocument()
    })

    // Clicks Increase Context Size and lets its delayed regenerate fire. Returns
    // what the click replayed to the thread's transport as the assistant prefill.
    const increaseContext = async () => {
      const setContinueFromContent = vi.fn()
      h.chatSessionsState.sessions = {
        'thread-1': {
          transport: { getTurnModelSelection: () => null, setContinueFromContent, cancelChatRun: vi.fn().mockResolvedValue(undefined) },
        },
      }
      const realModels = hub.models as () => Record<string, unknown>
      hub.models = () => ({
        ...realModels(),
        updateModelSettings: vi.fn().mockResolvedValue(undefined),
      })
      vi.useFakeTimers()
      try {
        await act(async () => {
          screen.getByText('Increase Context Size').click()
        })
        await act(async () => {
          vi.advanceTimersByTime(1000)
        })
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
        hub.models = realModels
        h.chatSessionsState.sessions = {}
      }
      return setContinueFromContent
    }

    // The saved partial is in memory only; after a restart the stopped reply is
    // what hydration restored. Increase Context Size resumes it in place instead
    // of regenerating from scratch and keeping the partial as another version,
    // and replays its reasoning with its text.
    it('resumes the stored partial in place after an application restart', async () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      h.chatState.status = 'error'
      h.chatState.error = new Error(
        'request (518 tokens) exceeds the available context size (512 tokens)'
      )
      h.chatState.messages = [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'q' }] },
        {
          id: 'a-len',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'thinking' },
            { type: 'text', text: 'partial answer' },
          ],
          metadata: { stopped: true, parentId: 'u1' },
        },
      ]
      const stored = [
        { id: 'u1', role: 'user', thread_id: 'thread-1', content: [], metadata: { parentId: null } },
        { id: 'a-len', role: 'assistant', thread_id: 'thread-1', content: [], metadata: { stopped: true, parentId: 'u1' } },
      ]
      h.messagesState.getMessages = vi.fn(() => stored)
      renderComponent()
      const onFinish = (h as any).capturedOnFinish

      const prefill = await increaseContext()
      expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a-len' })
      expect(prefill).toHaveBeenCalledWith({
        text: 'partial answer',
        reasoning: 'thinking',
      })

      act(() => {
        onFinish({
          message: {
            id: 'a-new',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial answer, done' }],
            metadata: {},
          },
          isAbort: false,
          isError: false,
        })
      })
      expect(h.messagesState.deleteMessage).toHaveBeenCalledWith('thread-1', 'a-len')
    })

    // A thinking model can fill the context while still reasoning: there is no
    // text yet, but the reasoning is what to resume from.
    it('resumes a reply that filled the context while still reasoning', async () => {
      h.modelProviderState.selectedProvider = 'llamacpp'
      renderComponent()
      act(() => {
        ;(h as any).capturedOnFinish({
          message: {
            id: 'a-len',
            role: 'assistant',
            parts: [{ type: 'reasoning', text: 'still thinking' }],
            metadata: {
              finishReason: 'length',
              usage: { inputTokens: 30000, outputTokens: 4000 },
            },
          },
          isAbort: false,
          isError: false,
        })
      })

      const prefill = await increaseContext()
      expect(h.mockRegenerate).toHaveBeenCalledWith({ messageId: 'a-len' })
      expect(prefill).toHaveBeenCalledWith({
        text: '',
        reasoning: 'still thinking',
      })
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
      const other: any = { id: 'a-other', role: 'assistant', parts: [{ type: 'tool-fetch', toolCallId: 'tcO', state: 'input-available' }] }
      const chat = new Chat({ messages: [
        { id: 'a-early', role: 'assistant', parts: [{ type: 'tool-fetch', toolCallId: 'tcE', state: 'input-streaming' }] }, other,
      ] })
      h.chatSessionsState.sessions['thread-1'] = { chat }
      renderComponent()
      act(() => {
        ;(h as any).capturedOnFinish({ message: chat.messages[0], isAbort: true, isError: false })
      })
      expect(chat.messages[0].parts[0]).toMatchObject({ state: 'output-error' })
      expect(chat.messages[1]).toBe(other)
    })

    it('close after navigating A to B settles only retained A, never B', async () => {
      __resetChatCloseForTests()
      const a = new Chat({ messages: [{ id: 'a-close', role: 'assistant', parts: [{ type: 'tool-fetch', toolCallId: 'tc-close', state: 'input-available', input: {} }] }] })
      const b = new Chat({ messages: [{ id: 'b-close', role: 'assistant', parts: [{ type: 'text', text: 'B stays intact' }] }] })
      const beforeB = b.messages
      trackChat(a, new Set()); trackChat(b, new Set())
      h.chatSessionsState.sessions = { 'thread-1': { chat: a }, 'thread-2': { chat: b } }
      h.messagesState.getMessages = vi.fn((id: string) => id === 'thread-1' ? [{ id: 'a-close', thread_id: id, content: [], metadata: {} }] : [])
      const { rerender } = renderComponent()
      h.routeParams.threadId = 'thread-2'
      const Component = Route.component as React.ComponentType
      rerender(<Component />)
      await act(async () => { await quiesceChats() })
      expect(a.messages[0].parts[0]).toMatchObject({ state: 'output-error' })
      expect(b.messages).toBe(beforeB)
      expect(h.messagesState.updateMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-close', metadata: expect.objectContaining({ stopped: true }) }))
      __resetChatCloseForTests()
      h.routeParams.threadId = 'thread-1'
      h.chatSessionsState.sessions = {}
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

  describe('adapter tool dispatch', () => {
    type Call = { toolCallId: string; toolName: string; input: Record<string, unknown> }
    type Outcome = { output: unknown; isError?: boolean }
    type Dispatch = (call: Call, signal: AbortSignal) => Promise<Outcome>
    const call = (id = 'tc1', toolName = 'fetch', input: Record<string, unknown> = { url: 'x' }): Call => ({
      toolCallId: id, toolName, input,
    })
    const arrive = (toolCall: Call) => (h as any).capturedOnToolCall({ toolCall })
    const dispatch = (toolCall: Call, signal = new AbortController().signal) =>
      ((h as any).capturedDispatchTool as Dispatch)(toolCall, signal)
    const serveMcp = () => {
      const run = vi.fn().mockResolvedValue({ error: '', content: ['result'] })
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      return run
    }
    const finish = () => (h as any).capturedOnFinish({
      message: { id: 'a-tc', role: 'assistant', parts: [{ type: 'text', text: '' }], metadata: { finishReason: 'tool-calls' } },
      isAbort: false,
    })

    beforeEach(() => {
      // The adapter creates and retains a session before invoking dispatchTool.
      h.chatSessionsState.sessions = { 'thread-1': { transport: { getTurnModelSelection: () => null, cancelChatRun: vi.fn().mockResolvedValue(undefined) }, chat: { messages: [], stop: vi.fn() } } }
      h.appStateState.mcpToolNames = new Set(['fetch'])
      shell.enabled = true
      shell.execute.mockClear()
      webConfig.enabled = true
      webTool.executeWebTool.mockReset()
      webTool.executeWebTool.mockResolvedValue({ content: 'page' })
    })
    afterEach(() => {
      // A retained adapter emits a terminal finish on cancellation/deletion too.
      finish()
      h.chatSessionsState.sessions = {}
      shell.enabled = true
      webConfig.enabled = true
    })

    it('persists only this message’s captured tool identities in minimal metadata', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      renderComponent()
      await act(async () => { await (h as any).capturedOnToolCall({ toolCall: call('origin-persist') }) })
      useToolCallRuntime.getState().recordOrigin('other-message-call', 'unrelated')
      await act(async () => {
        await (h as any).capturedOnFinish({
          message: { id: 'origin-message', role: 'assistant', parts: [
            { type: 'text', text: 'fixture result' },
            { type: 'tool-fetch', toolCallId: 'origin-persist', input: { url: 'fixture' }, state: 'input-available' },
          ] },
          isAbort: false,
        })
      })
      expect(h.messagesState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
        id: 'origin-message', metadata: expect.objectContaining({
          toolOrigins: { 'origin-persist': 'test-server' },
        }),
      }))
    })

    it('reports early validation failures as identity errors, never user denial', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.toolApprovalState.requestApproval = vi.fn().mockResolvedValue({ kind: 'validation-error', errorText: 'MCP target unavailable during approval' })
      renderComponent()
      await arrive(call('validation-error'))
      const result = await dispatch(call('validation-error'))
      expect(result).toMatchObject({ isError: true, output: expect.stringContaining('MCP target unavailable during approval') })
      expect(result.output).not.toBe('Tool execution denied by user')
      expect(h.mockAddToolOutput).not.toHaveBeenCalled()
    })

    it('streaming Stop releases pre-enqueue origins after persisting serializer metadata', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      renderComponent()
      await act(async () => { await (h as any).capturedOnToolCall({ toolCall: call('stream-stop-origin') }) })
      useToolCallRuntime.getState().recordOrigin('stream-stop-origin', 'sibling', 'other-thread')
      await act(async () => {
        await (h as any).capturedOnFinish({
          message: { id: 'stopped-origin-message', role: 'assistant', parts: [
            { type: 'text', text: 'partial' },
            { type: 'tool-fetch', toolCallId: 'stream-stop-origin', input: { url: 'fixture' }, state: 'input-available' },
          ] }, isAbort: true,
        })
      })
      expect(h.messagesState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ toolOrigins: { 'stream-stop-origin': 'test-server' } }),
      }))
      expect(useToolCallRuntime.getState().origins[toolOriginKey('thread-1', 'stream-stop-origin')]).toBeUndefined()
      expect(useToolCallRuntime.getState().origins[toolOriginKey('other-thread', 'stream-stop-origin')]).toBe('sibling')
    })

    it('retains prior step origins across leave/prune/resave and filters edited-away calls', async () => {
      const saved = { id: 'multi-step', role: 'assistant', metadata: { toolOrigins: { old: 'alpha', removed: 'stale', internal: null } } }
      h.messagesState.getMessages.mockImplementation((id: string) => id === 'thread-1' ? [saved] : [{ ...saved, metadata: { toolOrigins: { old: 'sibling' } } }])
      useToolCallRuntime.getState().recordOrigin('old', 'alpha', 'thread-1')
      useToolCallRuntime.getState().enqueue(['old'], 'thread-1')
      useToolCallRuntime.getState().markSettled('old')
      useToolCallRuntime.getState().releaseSettled('thread-1')
      useToolCallRuntime.getState().recordOrigin('new', 'beta', 'thread-1')
      useToolCallRuntime.getState().recordOrigin('old', 'sibling', 'other-thread')
      renderComponent()
      await act(async () => {
        await (h as any).capturedOnFinish({ message: { id: 'multi-step', role: 'assistant', parts: [
          { type: 'text', text: 'step N' },
          ...['old', 'internal', 'new'].map((id) => ({ type: 'tool-fetch', toolCallId: id, input: {}, state: 'output-available', output: 'fixture' })),
        ] }, isAbort: false })
      })
      const record = h.messagesState.updateMessage.mock.calls.map(([item]: any[]) => item).find((item: any) => item.id === 'multi-step')
      expect(JSON.parse(JSON.stringify(record)).metadata.toolOrigins).toEqual({ old: 'alpha', internal: null, new: 'beta' })
    })

    describe('advertised MCP identity stays paired with approval and execution', () => {
      const advertisedServer = 'advertised-server'
      const otherServer = 'menu-server'
      let pending: Promise<Outcome>
      let controller: AbortController
      let approve: (allowed: boolean) => void
      let callTool: ReturnType<typeof vi.fn>

      beforeEach(() => {
        h.appStateState.mcpToolNames = new Set(['fetch'])
        // A stale/live menu must not choose the identity for this turn.
        h.appStateState.tools = [{ name: 'fetch', server: otherServer }, { name: 'fetch', server: advertisedServer, inputSchema: { type: 'object' } }]
        h.chatSessionsState.sessions['thread-1'] = {
          transport: {
            getTurnModelSelection: () => null,
            getMcpServerForTool: vi.fn(() => advertisedServer),
          },
        }
        getMcpTools.mockResolvedValue([{ name: 'fetch', server: advertisedServer }])
        h.toolApprovalState.requestApproval = vi.fn(() =>
          new Promise<boolean>((resolve) => { approve = resolve })
        )
        controller = new AbortController()
        callTool = vi.fn().mockResolvedValue({ error: '', content: [] })
        hub.mcp = () => ({
          getTools: getMcpTools,
          callToolWithCancellation: cancellable(callTool),
        })
      })

      const waitForApproval = async () => {
        renderComponent()
        await act(async () => {
          await arrive(call('bound-call'))
          pending = dispatch(call('bound-call'), controller.signal)
        })
        expect(h.toolApprovalState.requestApproval).toHaveBeenCalledExactlyOnceWith(
          'bound-call', 'fetch', 'thread-1', advertisedServer, expect.any(Function)
        )
        expect(callTool).not.toHaveBeenCalled()
        await waitFor(() => expect(getMcpTools).toHaveBeenCalledTimes(1))
      }

      it('supplies the request-bound validator to early approval before onFinish', async () => {
        renderComponent()
        await act(async () => { await arrive(call('validator-call')) })
        const validate = h.toolApprovalState.requestApproval.mock.calls[0][4]
        await expect(validate()).resolves.toBeUndefined()
        getMcpTools.mockResolvedValue([{ name: 'fetch', server: otherServer }])
        h.appStateState.tools = [{ name: 'fetch', server: otherServer }]
        await expect(validate()).rejects.toThrow(/stale|ambiguous|unavailable|changed/)
        expect(callTool).not.toHaveBeenCalled()
      })

      it('keeps A approval valid while B config and tool inventory refresh', async () => {
        await waitForApproval()
        useMCPServers.setState({ mcpServers: { ...useMCPServers.getState().mcpServers, unrelated: { command: 'fixture', args: [], env: {} } } })
        h.appStateState.tools = [{ name: 'fetch', server: advertisedServer, inputSchema: { type: 'object' } }, { name: 'unrelated-tool', server: 'unrelated' }]
        await act(async () => { approve(true); await pending })
        expect(callTool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ serverName: advertisedServer }))
        await waitFor(() => expect(getMcpTools).toHaveBeenCalledTimes(1))
      })

      it('refuses a changed target configuration without blaming user denial', async () => {
        await waitForApproval()
        useMCPServers.setState({ mcpServers: { ...useMCPServers.getState().mcpServers, [advertisedServer]: { command: 'replacement', args: [], env: {} } } })
        await act(async () => { approve(true); await pending })
        expect(callTool).not.toHaveBeenCalled()
        expect(await pending).toMatchObject({ isError: true, output: expect.stringMatching(/changed/) })
      })

      it('executes only the server advertised by the session, even if the menu disagrees', async () => {
        await waitForApproval()
        // Even a transport refresh after arrival cannot rebind this call.
        h.chatSessionsState.sessions['thread-1'].transport.getMcpServerForTool
          .mockReturnValue(otherServer)
        await act(async () => { approve(true); await pending })
        expect(callTool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          toolName: 'fetch', serverName: advertisedServer, arguments: { url: 'x' },
        }))
        expect(getMcpTools).toHaveBeenCalledTimes(1)
        expect(await pending).toEqual({ output: [] })
      })

      it.each(['revoked', 'disconnected', 'replaced'] as const)(
        'does not dispatch when the advertised pair is %s while approval is pending',
        async (change) => {
          await waitForApproval()
          if (change === 'revoked') h.toolAvailableState.isToolDisabled.mockReturnValue(true)
          if (change === 'disconnected') { getMcpTools.mockResolvedValue([]); h.appStateState.tools = [] }
          if (change === 'replaced') { getMcpTools.mockResolvedValue([{ name: 'fetch', server: otherServer }]); h.appStateState.tools = [{ name: 'fetch', server: otherServer }] }
          await act(async () => { approve(true); await pending })
          expect(callTool).not.toHaveBeenCalled()
          expect(await pending).toMatchObject({ isError: true, output: expect.stringMatching(/unavailable|disabled|ambiguous|changed/g) })
          expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
        }
      )

      it('dispatches only the bound server despite a newly advertised same-name rival', async () => {
        await waitForApproval()
        getMcpTools.mockResolvedValue([{ name: 'fetch', server: advertisedServer }, { name: 'fetch', server: otherServer }])
        await act(async () => { approve(true); await pending })
        expect(callTool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ serverName: advertisedServer }))
      })

      it('Stop releases the thread while inventory is unresolved and ignores a late inventory result', async () => {
        let resolveInventory!: (tools: Array<{ name: string; server: string }>) => void
        getMcpTools.mockImplementation(() => new Promise((resolve) => {
          resolveInventory = resolve
        }))
        renderComponent()
        await act(async () => {
          await arrive(call('bound-call'))
          pending = dispatch(call('bound-call'), controller.signal)
        })
        expect(getMcpTools).toHaveBeenCalledTimes(1)
        const earlyPrompts = h.toolApprovalState.requestApproval.mock.calls.length
        await act(async () => { screen.getByTestId('chat-stop').click(); controller.abort(); await pending; finish() })
        expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
        expect(h.toolApprovalState.cancelApproval).toHaveBeenCalledWith('bound-call', 'thread-1')
        await act(async () => {
          resolveInventory([{ name: 'fetch', server: advertisedServer }])
          approve(true)
          await pending
        })
        expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(earlyPrompts)
        expect(callTool).not.toHaveBeenCalled()
        expect(h.mockAddToolOutput).not.toHaveBeenCalled()
      })

      it('dismisses the early approval when inventory rejects the advertised identity before approval', async () => {
        getMcpTools.mockResolvedValue([{ name: 'fetch', server: otherServer }])
        renderComponent()
        await act(async () => {
          await arrive(call('bound-call'))
          pending = dispatch(call('bound-call'), controller.signal)
        })
        expect(h.toolApprovalState.requestApproval).toHaveBeenCalledExactlyOnceWith(
          'bound-call', 'fetch', 'thread-1', advertisedServer, expect.any(Function)
        )
        await pending
        expect(h.toolApprovalState.cancelApproval).toHaveBeenCalledExactlyOnceWith('bound-call', 'thread-1')
        expect(await pending).toMatchObject({ isError: true, output: expect.stringMatching(/unavailable|stale|ambiguous/) })
        await act(async () => { approve(true); await pending })
        expect(callTool).not.toHaveBeenCalled()
        expect(h.toolApprovalState.approveToolForThread).not.toHaveBeenCalled()
      })

      it('does not execute a late approval after Stop', async () => {
        await waitForApproval()
        await act(async () => { screen.getByTestId('chat-stop').click(); controller.abort(); await pending; finish() })
        await act(async () => { approve(true); await pending })
        expect(callTool).not.toHaveBeenCalled()
        expect(h.mockAddToolOutput).not.toHaveBeenCalled()
        expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
      })

      it('cancels the running bound call and ignores its late result after Stop', async () => {
        let resolveResult!: (result: unknown) => void
        const cancel = vi.fn().mockResolvedValue(undefined)
        const backendDispatch = vi.fn(() => ({
          promise: new Promise((resolve) => { resolveResult = resolve }),
          cancel,
          token: 'bound-token',
        }))
        hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: backendDispatch })
        await waitForApproval()
        await act(async () => { approve(true) })
        await waitFor(() => expect(backendDispatch).toHaveBeenCalledTimes(1))
        expect(backendDispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          toolName: 'fetch', serverName: advertisedServer,
        }))
        await act(async () => { screen.getByTestId('chat-stop').click(); controller.abort(); await pending; finish() })
        expect(cancel).toHaveBeenCalledTimes(1)
        await act(async () => { resolveResult({ error: '', content: [{ text: 'late' }] }) })
        expect(h.mockAddToolOutput).not.toHaveBeenCalled()
        expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
      })
    })

    it('prompts once for elevated shell and re-reads the grant after approval', async () => {
      let grant = { version: 1, folderScope: null, shellNetwork: true, memoryWrite: false }
      h.threadsState.getConversationCapabilities.mockImplementation(() => grant)
      h.appStateState.mcpToolNames = new Set()
      h.chatSessionsState.sessions['thread-1'].transport.getMcpServerForTool = () => undefined
      let approve!: (allowed: boolean) => void
      h.toolApprovalState.requestApproval = vi.fn(() => new Promise<boolean>(resolve => { approve = resolve }))
      shell.execute.mockImplementationOnce(async () => {
        expect(h.threadsState.getConversationCapabilities('thread-1').shellNetwork).toBe(false)
        return { output: 'scratch only' }
      })
      renderComponent()
      const toolCall = call('elevated-shell', 'shell', { command: 'echo safe' })
      await arrive(toolCall)
      const pending = dispatch(toolCall)
      await waitFor(() => expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1))
      expect(h.toolApprovalState.requestApproval.mock.calls[0][4]).toBeUndefined()
      expect(h.toolApprovalState.requestApproval.mock.calls[0][5]).toMatchObject({ native: { grantKey: expect.any(String) } })
      expect(shell.execute).not.toHaveBeenCalled()
      grant = { ...grant, shellNetwork: false }
      approve(true)
      await pending
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
      expect(shell.execute).toHaveBeenCalledExactlyOnceWith('shell', { command: 'echo safe' }, 'thread-1', undefined, undefined, undefined, undefined, undefined, expect.objectContaining({ shellNetwork: true }))
      h.threadsState.getConversationCapabilities.mockImplementation(() => ({ version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }))
    })

    it('refuses unadvertised native calls before approval or execution', async () => {
      h.appStateState.mcpToolNames = new Set()
      h.chatSessionsState.sessions['thread-1'].transport.hasAdvertisedNativeTool = () => false
      renderComponent()
      expect(await dispatch(call('unadvertised', 'read', { path: 'scratch.txt' }))).toMatchObject({ isError: true, output: expect.stringContaining('not advertised') })
      expect(shell.execute).not.toHaveBeenCalled()
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
    })

    it.each([false, true])('refuses memory mutation before approval even with memoryWrite=%s', async (memoryWrite) => {
      h.appStateState.mcpToolNames = new Set()
      h.chatSessionsState.sessions['thread-1'].transport.hasAdvertisedNativeTool = () => true
      h.threadsState.getConversationCapabilities.mockImplementation(() => ({ version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }))
      renderComponent()
      h.threadsState.getConversationCapabilities.mockImplementation(() => ({ version: 1, folderScope: null, shellNetwork: false, memoryWrite }))
      const toolCall = call('denied-memory-write', 'memory', { op: 'write', name: 'note', content: 'value' })
      await arrive(toolCall)
      expect(await dispatch(toolCall)).toMatchObject({ isError: true, output: expect.stringContaining('durable memory writes') })
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(shell.execute).not.toHaveBeenCalled()
    })

    it('raises no prompt on arrival for an unadvertised elevated native call', async () => {
      h.appStateState.mcpToolNames = new Set()
      h.chatSessionsState.sessions['thread-1'].transport.hasAdvertisedNativeTool = () => false
      h.threadsState.getConversationCapabilities.mockImplementation(() => ({ version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }))
      renderComponent()
      const toolCall = call('revoked-skill-write', 'skill_write', { name: 'x', content: 'y' })
      await arrive(toolCall)
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(await dispatch(toolCall)).toMatchObject({ isError: true, output: expect.stringContaining('not advertised') })
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(shell.execute).not.toHaveBeenCalled()
    })

    it('freezes one grant per toolCallId across arrival and dispatch (no orphan prompt after revoke)', async () => {
      h.appStateState.mcpToolNames = new Set()
      h.chatSessionsState.sessions['thread-1'].transport.hasAdvertisedNativeTool = () => true
      let reads = 0
      h.threadsState.getConversationCapabilities.mockImplementation(() => (
        ++reads === 1
          ? { version: 1, folderScope: null, shellNetwork: false, memoryWrite: true }
          : { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }
      ))
      renderComponent()
      const toolCall = call('frozen-skill-write', 'skill_write', { name: 'x', content: 'y' })
      await arrive(toolCall)
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledExactlyOnceWith(
        'frozen-skill-write', 'skill_write', 'thread-1', undefined, undefined,
        { native: { grantKey: expect.stringContaining('"memoryWrite":true') } }
      )
      await dispatch(toolCall)
      // dispatch reused the arrival grant: one prompt, one execution under it
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
      expect(shell.execute).toHaveBeenCalledExactlyOnceWith('skill_write', { name: 'x', content: 'y' }, 'thread-1', undefined, undefined, undefined, undefined, undefined, expect.objectContaining({ memoryWrite: true }))
      expect(reads).toBe(1)
    })

    it('dispatches an advertised native read even with a same-name MCP inventory entry', async () => {
      h.appStateState.mcpToolNames = new Set(['read'])
      h.chatSessionsState.sessions['thread-1'].transport.getMcpServerForTool = () => undefined
      renderComponent()
      const toolCall = call('native-read', 'read', { path: 'scratch.txt' })
      await arrive(toolCall)
      await dispatch(toolCall)
      expect(shell.execute).toHaveBeenCalledExactlyOnceWith('read', { path: 'scratch.txt' }, 'thread-1', undefined, undefined, undefined, undefined, undefined, expect.objectContaining({ shellNetwork: false, memoryWrite: false }))
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
    })

    it('releases an undispatched streamed origin on an error terminal without touching a sibling', async () => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      renderComponent()
      await arrive(call('failed-input'))
      useToolCallRuntime.getState().recordOrigin('failed-input', 'sibling', 'other-thread')
      await act(async () => {
        await (h as any).capturedOnFinish({
          message: { id: 'failed-provider', role: 'assistant', parts: [
            { type: 'tool-fetch', toolCallId: 'failed-input', input: {}, state: 'input-available' },
          ] }, isAbort: false, isError: true,
        })
      })
      expect(useToolCallRuntime.getState().origins[toolOriginKey('thread-1', 'failed-input')]).toBeUndefined()
      expect(useToolCallRuntime.getState().origins[toolOriginKey('other-thread', 'failed-input')]).toBe('sibling')
    })

    it('runs the advertised native shell without a prompt even with a same-name MCP tool', async () => {
      h.appStateState.mcpToolNames = new Set(['shell'])
      h.chatSessionsState.sessions['thread-1'].transport.getMcpServerForTool = () => undefined
      renderComponent()
      const toolCall = call('native-shell', 'shell')
      await arrive(toolCall)
      await dispatch(toolCall)
      expect(shell.execute).toHaveBeenCalledTimes(1)
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(useToolCallRuntime.getState().origins[toolOriginKey('thread-1', 'native-shell')]).toBeNull()
    })

    it('refuses an advertised MCP web_search if native web search is enabled during approval', async () => {
      webConfig.enabled = false
      h.appStateState.mcpToolNames = new Set(['web_search'])
      h.chatSessionsState.sessions['thread-1'].transport.getMcpServerForTool = () => 'search-server'
      getMcpTools.mockResolvedValue([{ name: 'web_search', server: 'search-server' }])
      let approve!: (allowed: boolean) => void
      h.toolApprovalState.requestApproval = vi.fn(() => new Promise<boolean>(resolve => { approve = resolve }))
      const run = serveMcp()
      renderComponent()
      const toolCall = call('web-identity-change', 'web_search', { query: 'jan' })
      await arrive(toolCall)
      const pending = dispatch(toolCall)
      await waitFor(() => expect(getMcpTools).toHaveBeenCalledTimes(1))
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledExactlyOnceWith('web-identity-change', 'web_search', 'thread-1', 'search-server', expect.any(Function))
      expect(run).not.toHaveBeenCalled()
      expect(webTool.executeWebTool).not.toHaveBeenCalled()
      webConfig.enabled = true
      approve(true)
      expect(await pending).toMatchObject({ isError: true, output: expect.stringMatching(/identity changed/i) })
      expect(run).not.toHaveBeenCalled()
      expect(webTool.executeWebTool).not.toHaveBeenCalled()
    })

    it('approves and dispatches advertised MCP retrieve rather than an unadvertised RAG tool', async () => {
      h.appStateState.ragToolNames = new Set(['retrieve'])
      h.chatSessionsState.sessions['thread-1'].transport.getMcpServerForTool = () => 'retrieval-server'
      getMcpTools.mockResolvedValue([{ name: 'retrieve', server: 'retrieval-server' }])
      let approve!: (allowed: boolean) => void
      h.toolApprovalState.requestApproval = vi.fn(() => new Promise<boolean>(resolve => { approve = resolve }))
      const run = serveMcp().mockResolvedValue({ content: [] })
      const originalRag = hub.rag
      const ragCallTool = vi.fn()
      hub.rag = () => ({ callTool: ragCallTool })
      try {
        renderComponent()
        const toolCall = call('mcp-retrieve', 'retrieve', { query: 'jan' })
        await arrive(toolCall)
        const pending = dispatch(toolCall)
        await waitFor(() => expect(getMcpTools).toHaveBeenCalledTimes(1))
        expect(h.toolApprovalState.requestApproval).toHaveBeenCalledExactlyOnceWith('mcp-retrieve', 'retrieve', 'thread-1', 'retrieval-server', expect.any(Function))
        expect(useToolCallRuntime.getState().origins[toolOriginKey('thread-1', 'mcp-retrieve')]).toBe('retrieval-server')
        expect(run).not.toHaveBeenCalled()
        expect(ragCallTool).not.toHaveBeenCalled()
        approve(true)
        expect(await pending).toEqual({ output: [] })
        expect(run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ toolName: 'retrieve', serverName: 'retrieval-server', arguments: { query: 'jan' } }))
        expect(ragCallTool).not.toHaveBeenCalled()
      } finally { hub.rag = originalRag }
    })

    it('requests approval on arrival without executing, including the server to trust', async () => {
      const run = serveMcp()
      h.appStateState.tools = [{ name: 'fetch', server: 'fetch-server' }]
      renderComponent()
      await act(async () => { await arrive(call()) })
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledExactlyOnceWith('tc1', 'fetch', 'thread-1', 'fetch-server', expect.any(Function))
      expect(run).not.toHaveBeenCalled()
      expect(h.mockAddToolOutput).not.toHaveBeenCalled()
    })

    it('onFinish persists the turn but never executes tools or injects results', async () => {
      const run = serveMcp()
      renderComponent()
      await act(async () => { await arrive(call()); await finish() })
      expect(run).not.toHaveBeenCalled()
      expect(h.mockAddToolOutput).not.toHaveBeenCalled()
    })

    it('dispatches exactly one approved call, reusing early approval and returning its outcome to the adapter', async () => {
      const run = serveMcp()
      renderComponent()
      await act(async () => { await arrive(call()); await arrive(call()); await arrive(call('tc2')) })
      expect(await dispatch(call())).toEqual({ output: ['result'] })
      expect(run).toHaveBeenCalledTimes(1)
      // tc2 remains approval-only: dispatch never drains a route-owned loop.
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(2)
      expect(h.mockAddToolOutput).not.toHaveBeenCalled()
    })

    it('requests approval at dispatch if no early event arrived', async () => {
      const run = serveMcp()
      renderComponent()
      expect(await dispatch(call())).toEqual({ output: ['result'] })
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('awaits approval and records runtime only while the tool is actually running', async () => {
      let decide!: (approved: boolean) => void
      let complete!: (value: unknown) => void
      h.toolApprovalState.requestApproval = vi.fn(() => new Promise<boolean>((r) => { decide = r }))
      const run = vi.fn(() => new Promise((r) => { complete = r }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      renderComponent()
      await arrive(call())
      const pending = dispatch(call())
      expect(run).not.toHaveBeenCalled()
      expect(useToolCallRuntime.getState().timings.tc1?.startedAt).toBeUndefined()
      decide(true)
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      expect(useToolCallRuntime.getState().timings.tc1?.startedAt).toBeDefined()
      complete({ content: 'done' })
      expect(await pending).toEqual({ output: 'done' })
      expect(useToolCallRuntime.getState().queue).toEqual([])
      expect(useToolCallRuntime.getState().timings.tc1?.endedAt).toBeDefined()
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
    })

    it('denies one call without blocking the next adapter dispatch', async () => {
      const run = serveMcp()
      h.toolApprovalState.requestApproval = vi.fn((id) => Promise.resolve(id !== 'tc1'))
      renderComponent()
      expect(await dispatch(call())).toEqual({ output: 'Tool execution denied by user', isError: true })
      expect(useToolCallRuntime.getState().timings.tc1?.startedAt).toBeUndefined()
      expect(useToolCallRuntime.getState().timings.tc1?.endedAt).toBeDefined()
      expect(await dispatch(call('tc2'))).toEqual({ output: ['result'] })
      expect(run).toHaveBeenCalledTimes(1)
      expect(useToolCallRuntime.getState().queue).toEqual([])
    })

    it.each([true, false])('hands MCP the context budget (known window: %s)', async (known) => {
      const run = serveMcp()
      const settings = h.modelProviderState.selectedModel.settings
      if (!known) h.modelProviderState.selectedModel.settings = {}
      try {
        renderComponent()
        await dispatch(call())
        const args = run.mock.calls[0][0]
        expect(args).toMatchObject({ toolName: 'fetch', arguments: { url: 'x' } })
        if (known) {
          expect(args.maxOutputChars).toBeGreaterThan(0)
          expect(args.maxOutputChars).toBeLessThan(4096 * 3.5)
        } else expect(args.maxOutputChars).toBeUndefined()
      } finally { h.modelProviderState.selectedModel.settings = settings }
    })

    it.each([undefined, 'project-1'])('dispatches RAG against the correct document scope (%s)', async (projectId) => {
      const originalRag = hub.rag
      const run = vi.fn().mockResolvedValue({ content: 'document excerpt' })
      hub.rag = () => ({ callTool: run }) as never
      h.appStateState.ragToolNames = new Set(['rag_search'])
      if (projectId) h.threadsState.threads['thread-1'].metadata = { project: { id: projectId } }
      try {
        renderComponent()
        const toolCall = call('rag', 'rag_search', { query: 'document' })
        await arrive(toolCall)
        expect(await dispatch(toolCall)).toEqual({ output: 'document excerpt' })
        expect(run).toHaveBeenCalledExactlyOnceWith({
          toolName: 'rag_search', arguments: { query: 'document' },
          threadId: 'thread-1', projectId, scope: projectId ? 'project' : 'thread',
        })
        expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      } finally { hub.rag = originalRag }
    })

    it('returns backend errors and settles runtime on failure', async () => {
      const run = serveMcp().mockResolvedValue({ error: 'server failed' })
      renderComponent()
      expect(await dispatch(call())).toEqual({ output: 'Error: server failed', isError: true })
      expect(run).toHaveBeenCalledTimes(1)
      expect(useToolCallRuntime.getState().queue).toEqual([])
    })

    it('returns an error for an unavailable tool', async () => {
      renderComponent()
      expect(await dispatch(call('missing', 'unknown'))).toEqual({ output: "Error: MCP tool 'unknown' is unavailable or disabled", isError: true })
    })

    it('Stop signal cancels a hung MCP call exactly once and drains runtime', async () => {
      const cancel = vi.fn().mockResolvedValue(undefined)
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: () => ({ promise: new Promise(() => {}), cancel, token: 't' }) }) as never
      renderComponent()
      const controller = new AbortController()
      const pending = dispatch(call(), controller.signal)
      await waitFor(() => expect(useToolCallRuntime.getState().timings.tc1?.startedAt).toBeDefined())
      controller.abort()
      expect(await pending).toMatchObject({ isError: true })
      controller.abort()
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(useToolCallRuntime.getState().queue).toEqual([])
      expect(useToolCallRuntime.getState().timings.tc1?.endedAt).toBeDefined()
      expect(h.mockAddToolOutput).not.toHaveBeenCalled()
    })

    it('does not execute an already aborted call or a call for a deleted session', async () => {
      const run = serveMcp()
      renderComponent()
      const controller = new AbortController()
      controller.abort()
      expect(await dispatch(call(), controller.signal)).toMatchObject({ isError: true, output: expect.stringContaining('chat was closed') })
      h.removeChatSession('thread-1')
      expect(await dispatch(call('tc2'))).toMatchObject({ isError: true, output: expect.stringContaining('chat was closed') })
      expect(run).not.toHaveBeenCalled()
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
    })

    it('deletion with adapter abort returns an interrupted error without executing', async () => {
      const run = serveMcp()
      let decide!: (approved: boolean) => void
      h.toolApprovalState.requestApproval = vi.fn(() => new Promise<boolean>((r) => { decide = r }))
      renderComponent()
      await arrive(call())
      const controller = new AbortController()
      const pending = dispatch(call(), controller.signal)
      h.removeChatSession('thread-1')
      controller.abort()
      expect(await pending).toMatchObject({ isError: true, output: '(interrupted)' })
      decide(false) // A late answer cannot restart the cancelled dispatch.
      expect(run).not.toHaveBeenCalled()
      expect(useToolCallRuntime.getState().queue).toEqual([])
      expect(await dispatch(call('queued'), controller.signal)).toMatchObject({ isError: true })
      expect(run).not.toHaveBeenCalled()
    })

    it('a retained dispatch survives navigation and does not consume the other thread approval', async () => {
      const run = serveMcp()
      let decide!: (approved: boolean) => void
      h.toolApprovalState.requestApproval = vi.fn((id) => id === 'tc1' ? new Promise<boolean>((r) => { decide = r }) : Promise.resolve(true))
      const { rerender } = renderComponent()
      const dispatchA = (h as any).capturedDispatchTool as Dispatch
      await arrive(call())
      const pendingA = dispatchA(call(), new AbortController().signal)
      const Component = Route.component as React.ComponentType
      try {
        h.routeParams.threadId = 'thread-2'
        h.chatSessionsState.sessions['thread-2'] = { transport: { getTurnModelSelection: () => null, cancelChatRun: vi.fn().mockResolvedValue(undefined) }, chat: { messages: [], stop: vi.fn() } }
        rerender(<Component />)
        await arrive(call('tcB'))
        expect(h.toolApprovalState.clearPendingForThread).not.toHaveBeenCalled()
        decide(true)
        expect(await pendingA).toEqual({ output: ['result'] })
        expect(await dispatch(call('tcB'))).toEqual({ output: ['result'] })
        expect(run).toHaveBeenCalledTimes(2)
        expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(2)
      } finally { h.routeParams.threadId = 'thread-1' }
    })

    it('unmounting does not cancel a retained running dispatch', async () => {
      let complete!: (value: unknown) => void
      const cancel = vi.fn().mockResolvedValue(undefined)
      const run = vi.fn(() => ({ promise: new Promise((r) => { complete = r }), cancel, token: 't' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: run }) as never
      const { unmount } = renderComponent()
      const pending = dispatch(call())
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      unmount()
      expect(cancel).not.toHaveBeenCalled()
      complete({ content: 'retained result' })
      expect(await pending).toEqual({ output: 'retained result' })
    })

    it.each([true, false])('enforces the built-in shell switch at dispatch (enabled: %s)', async (enabled) => {
      shell.enabled = enabled
      renderComponent()
      const toolCall = call('sh1', 'shell', { url: 'unused' })
      await arrive(toolCall)
      const outcome = await dispatch(toolCall)
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(shell.execute).toHaveBeenCalledTimes(enabled ? 1 : 0)
      if (!enabled) expect(outcome).toMatchObject({ isError: true, output: expect.stringMatching(/turned off.*Do not call the shell again/s) })
    })

    it.each([false, true])('serves the advertised MCP shell with native switch %s (no native schema)', async (enabled) => {
      shell.enabled = enabled
      h.appStateState.mcpToolNames = new Set(['shell'])
      const run = serveMcp()
      renderComponent()
      const toolCall = call('sh-mcp', 'shell')
      await arrive(toolCall)
      expect(await dispatch(toolCall)).toEqual({ output: ['result'] })
      expect(run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ toolName: 'shell', serverName: 'test-server' }))
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledWith('sh-mcp', 'shell', 'thread-1', 'test-server', expect.any(Function))
      expect(shell.execute).not.toHaveBeenCalled()
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
    })

    it('runs the built-in web tool without approval and with the context budget', async () => {
      renderComponent()
      const toolCall = call('web', 'web_fetch')
      await arrive(toolCall)
      expect(await dispatch(toolCall)).toEqual({ output: 'page' })
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(webTool.executeWebTool).toHaveBeenCalledTimes(1)
      const [name, input, options] = webTool.executeWebTool.mock.calls[0]
      expect(name).toBe('web_fetch')
      expect(input).toEqual({ url: 'x' })
      expect(options.maxOutputChars).toBeGreaterThan(0)
      expect(options.maxOutputChars).toBeLessThan(4096 * 3.5)
    })

    it.each(['web_search', 'web_fetch'])('uses MCP for %s when built-in web is disabled', async (name) => {
      webConfig.enabled = false
      h.appStateState.mcpToolNames = new Set([name])
      const run = serveMcp()
      renderComponent()
      const toolCall = call('web-mcp', name)
      await arrive(toolCall)
      expect(await dispatch(toolCall)).toEqual({ output: ['result'] })
      expect(run).toHaveBeenCalledTimes(1)
      expect(run.mock.calls[0][0]).toMatchObject({ toolName: name })
      expect(webTool.executeWebTool).not.toHaveBeenCalled()
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
    })

    it('refuses disabled web tools before prompting when no MCP provides them', async () => {
      webConfig.enabled = false
      renderComponent()
      const toolCall = call('disabled-web', 'web_search')
      await arrive(toolCall)
      expect(await dispatch(toolCall)).toMatchObject({ isError: true, output: expect.stringMatching(/turned off.*Do not call web_search/s) })
      expect(webTool.executeWebTool).not.toHaveBeenCalled()
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
    })
  })

  describe('mounted route with the real Chat runner adapter', () => {
    const chunks = (items: UIMessageChunk[]) => new ReadableStream<UIMessageChunk>({
      start(controller) { for (const item of items) controller.enqueue(item); controller.close() },
    })
    const toolStep = (...ids: string[]): UIMessageChunk[] => [
      { type: 'start', messageId: 'provider-id' },
      ...ids.map(toolCallId => ({ type: 'tool-input-available' as const, toolCallId, toolName: 'fetch', input: { id: toolCallId } })),
      { type: 'finish', finishReason: 'tool-calls' },
    ]
    const textStep: UIMessageChunk[] = [
      { type: 'start', messageId: 'provider-final' },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'continued' },
      { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: 'stop' },
    ]
    let integrationMaxSteps: number | undefined
    const setup = (ids = ['tcA', 'tcB'], threadId = 'thread-1', partialText = false) => {
      let args: any
      let controller: AbortController | undefined
      const transport = new CustomChatTransport(undefined, threadId)
      const records: any[] = []
      h.messagesState.getMessages.mockImplementation(() => records)
      h.messagesState.addMessage.mockImplementation((record: any) => { records.push(record) })
      h.messagesState.updateMessage.mockImplementation((record: any) => {
        const index = records.findIndex(item => item.id === record.id)
        if (index >= 0) records[index] = record
      })
      h.threadsState.updateThread.mockImplementation((id: string, patch: any) => {
        Object.assign(h.threadsState.threads[id], patch)
      })
      const steps = vi.fn(async (messages: any[]) => {
        for (const message of messages.filter(m => m.role === 'user')) {
          if (!records.some(record => record.id === message.id)) records.push({
            id: message.id, thread_id: threadId, role: 'user', metadata: {},
            content: [{ type: 'text', text: { value: message.parts.find((p: any) => p.type === 'text')?.text ?? '', annotations: [] } }],
          })
        }
        return chunks(steps.mock.calls.length === 1 ? [
          ...(partialText ? [
            { type: 'text-start' as const, id: 'partial' }, { type: 'text-delta' as const, id: 'partial', delta: 'partial' }, { type: 'text-end' as const, id: 'partial' },
            { type: 'text-start' as const, id: 'notice' }, { type: 'text-delta' as const, id: 'notice', delta: 'UI limit notice must not be prefill' }, { type: 'text-end' as const, id: 'notice', providerMetadata: CHAT_RUN_NOTICE_METADATA },
          ] : []),
          ...toolStep(...ids),
        ] : textStep)
      })
      const cancel = transport.cancelChatRun.bind(transport)
      const cancelChatRun = vi.spyOn(transport, 'cancelChatRun').mockImplementation(cancel)
      const finished = vi.fn((event: any) => args.onFinish(event))
      const requests: any[] = []
      const chat = new Chat({
        id: threadId,
        transport: {
          sendMessages: async (request) => {
            requests.push(request)
            controller = new AbortController()
            const abort = () => controller?.abort()
            request.abortSignal?.addEventListener('abort', abort, { once: true })
            const release = transport.beginChatRun(() => controller?.abort())
            return createChatRunStream({
              messages: request.messages, messageId: requests.length === 1 ? 'a-integration-' + threadId : 'replacement-' + threadId,
              signal: controller.signal,
              maxSteps: integrationMaxSteps,
              sendStep: steps,
              dispatch: args.dispatchTool,
              onFinally: () => {
                request.abortSignal?.removeEventListener('abort', abort)
                release()
              },
            })
          },
          reconnectToStream: async () => null,
        },
        // As in production, only the presentation stream requests approval.
        onToolCall: event => args.onToolCall(event),
        onFinish: finished,
      })
      // Mirror the production admission guard, but retain the real SDK request,
      // ready/onFinish lifecycle and production transport settlement barrier.
      let reserved = false
      const guarded = (operation: () => Promise<void>) => {
        if (reserved || chat.status === 'submitted' || chat.status === 'streaming') {
          return Promise.reject(new Error('Stop the current Chat turn before regenerating'))
        }
        reserved = true
        const settled = operation().finally(() => { reserved = false })
        transport.trackChatOperation(settled)
        return settled
      }
      const send = chat.sendMessage.bind(chat)
      const regenerate = chat.regenerate.bind(chat)
      chat.sendMessage = (...args) => guarded(() => send(...args))
      chat.regenerate = (...args) => guarded(() => regenerate(...args))
      vi.spyOn(transport, 'hasAdvertisedNativeTool').mockReturnValue(true)
      vi.spyOn(transport, 'getMcpServerForTool').mockReturnValue('test-server')
      h.integrationChat = chat
      h.chatSessionsState.sessions[threadId] = { chat, transport }
      const view = renderComponent()
      args = {
        onToolCall: (h as any).capturedOnToolCall,
        onFinish: (h as any).capturedOnFinish,
        dispatchTool: (h as any).capturedDispatchTool,
      }
      return { ...view, chat, steps, cancelChatRun, requests, finished }
    }
    beforeEach(() => {
      h.appStateState.mcpToolNames = new Set(['fetch'])
      h.chatSessionsState.sessions = {}
      integrationMaxSteps = undefined
    })
    afterEach(() => { h.integrationChat = null; h.chatSessionsState.sessions = {} })

    it('uses exactly two SDK inference steps for a native read and its final answer', async () => {
      h.appStateState.mcpToolNames = new Set()
      shell.execute.mockClear()
      const { chat, steps } = setup(['native-read-sdk'])
      vi.mocked(h.chatSessionsState.sessions['thread-1'].transport.getMcpServerForTool).mockReturnValue(undefined)
      steps.mockImplementation(async () => chunks(steps.mock.calls.length === 1 ? [
        { type: 'start', messageId: 'native-provider' },
        { type: 'tool-input-available', toolCallId: 'native-read-sdk', toolName: 'read', input: { path: 'scratch.txt' } },
        { type: 'finish', finishReason: 'tool-calls' },
      ] : textStep))
      await act(async () => { await chat.sendMessage({ text: 'read the scratch file' }) })
      expect(steps).toHaveBeenCalledTimes(2)
      expect(shell.execute).toHaveBeenCalledExactlyOnceWith('read', { path: 'scratch.txt' }, 'thread-1', undefined, undefined, undefined, undefined, undefined, expect.objectContaining({ shellNetwork: false, memoryWrite: false }))
      expect(h.toolApprovalState.requestApproval).not.toHaveBeenCalled()
      expect(chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ toolCallId: 'native-read-sdk', state: 'output-available' }))
      expect(chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'continued' }))
    })

    it('keeps an ordinary SDK answer to exactly one inference step', async () => {
      const { chat, steps } = setup([])
      steps.mockImplementation(async () => chunks(textStep))
      await act(async () => { await chat.sendMessage({ text: 'hello' }) })
      expect(steps).toHaveBeenCalledTimes(1)
      expect(chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'continued' }))
    })

    it('runs multiple calls serially, injects each result once, continues once, and clears busy after drain', async () => {
      let release!: (value: unknown) => void
      const run = vi.fn((args: any) => args.arguments.id === 'tcA'
        ? new Promise(resolve => { release = resolve })
        : Promise.resolve({ content: 'B' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      const { chat, steps } = setup()
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', true)
      expect(run.mock.calls[0][0].arguments.id).toBe('tcA')
      release({ content: 'A' })
      await act(async () => { await pending })
      expect(run).toHaveBeenCalledTimes(2)
      expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(2)
      expect(steps).toHaveBeenCalledTimes(2)
      const assistant = chat.messages.find(m => m.role === 'assistant')!
      const outputs = assistant.parts.filter(p => 'toolCallId' in p)
      expect(outputs).toMatchObject([
        { toolCallId: 'tcA', state: 'output-available', output: 'A' },
        { toolCallId: 'tcB', state: 'output-available', output: 'B' },
      ])
      expect(assistant.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'continued' }))
      expect(h.mockAddToolOutput).not.toHaveBeenCalled()
      expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
      expect(useToolCallRuntime.getState().queue).toEqual([])
      for (const id of ['tcA', 'tcB']) {
        expect(useToolCallRuntime.getState().timings[id]?.startedAt).toBeDefined()
        expect(useToolCallRuntime.getState().timings[id]?.endedAt).toBeDefined()
      }
    })

    it.each(['Stop', 'delete'])('%s cancels a running backend call without executing queued calls or following up', async action => {
      const cancel = vi.fn().mockResolvedValue(undefined)
      const run = vi.fn(() => ({ promise: new Promise(() => {}), cancel, token: 't' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: run }) as never
      const { chat, steps, cancelChatRun } = setup()
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      h.chatState.messages = chat.messages
      if (action === 'delete') {
        // Session store owns drain-before-removal, not the route callback.
        await act(async () => { await cancelChatRun(); h.removeChatSession('thread-1') })
      } else if (action === 'Stop') {
        await act(async () => { screen.getByTestId('chat-stop').click() })
      }
      await act(async () => { await pending })
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledTimes(1)
      expect(steps).toHaveBeenCalledTimes(1)
      expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
    })

    it.each(['edit', 'regenerate', 'Continue'])('%s settles the original SDK operation then starts exactly one replacement during a held tool', async action => {
      const cancel = vi.fn().mockResolvedValue(undefined)
      const run = vi.fn(() => ({ promise: new Promise(() => {}), cancel, token: 'held-tool' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: run }) as never
      const { chat, steps, cancelChatRun, rerender, requests, finished } = setup(['tcA', 'tcB'], 'thread-1', action === 'Continue')
      let originalSettled = false
      const pending = chat.sendMessage({ text: 'go' }).finally(() => { originalSettled = true })
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      expect(originalSettled).toBe(false)
      const replacementAdmission = vi.fn(() => {
        expect(originalSettled).toBe(true)
        expect(finished).toHaveBeenCalledTimes(1)
      })
      const originalRegenerate = chat.regenerate.bind(chat)
      chat.regenerate = (...args) => { replacementAdmission(); return originalRegenerate(...args) }
      const originalUser = chat.messages[0].id
      const originalAssistant = chat.messages[1].id
      const Component = Route.component as React.ComponentType
      rerender(<Component />)
      await act(async () => {
        screen.getByTestId(action === 'edit' ? `edit-${originalUser}`
          : action === 'Continue' ? `continue-${originalAssistant}` : `regen-${originalAssistant}`).click()
      })
      await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
      expect(cancelChatRun).toHaveBeenCalledTimes(1)
      await act(async () => { await pending })
      expect(originalSettled).toBe(true)
      expect(finished).toHaveBeenCalled()
      await waitFor(() => expect(steps).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(chat.status).toBe('ready'))
      expect(run).toHaveBeenCalledTimes(1) // queued tcB and old follow-up never run
      expect(h.mockRegenerate).not.toHaveBeenCalled()
      const replacement = chat.messages.find(message => message.role === 'assistant')!
      expect(replacement.parts).toContainEqual({ type: 'text', text: 'continued', state: 'done' })
      expect(replacementAdmission).toHaveBeenCalledTimes(1)
      expect(requests).toHaveLength(2)
      expect(requests.map(request => request.trigger)).toEqual(['submit-message', 'regenerate-message'])
      expect(steps.mock.calls[1][0].filter((message: any) => message.role === 'user').at(-1)).toMatchObject({
        id: action === 'edit' ? 'gen-id' : originalUser,
        parts: [{ type: 'text', text: action === 'edit' ? 'edited text' : 'go' }],
      })
      expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
      expect(useToolCallRuntime.getState().queue).toEqual([])
      if (action === 'Continue') {
        expect(h.mockSetContinueFromContent).toHaveBeenCalledExactlyOnceWith({ text: 'partial', reasoning: '' })
        expect(JSON.stringify(replacement.parts)).not.toContain('UI limit notice')
        expect(h.messagesState.deleteMessage).toHaveBeenCalledExactlyOnceWith('thread-1', originalAssistant)
        expect(h.messagesState.addMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'replacement-thread-1', role: 'assistant' }))
      }
    })

    it('Continue on a tool-only capped turn resumes from kept history without re-executing tools', async () => {
      integrationMaxSteps = 1
      const run = vi.fn(() => Promise.resolve({ content: 'A' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      const { chat, steps, rerender } = setup(['tcA'])
      await act(async () => { await chat.sendMessage({ text: 'go' }) })
      await waitFor(() => expect(chat.status).toBe('ready'))
      const capped = chat.messages.find(message => message.role === 'assistant')!
      expect(capped.metadata).toMatchObject({ stopped: true, runStopReason: 'steps' })
      expect(capped.parts).toContainEqual(expect.objectContaining({ toolCallId: 'tcA', state: 'output-available' }))
      expect(run).toHaveBeenCalledTimes(1)

      const Component = Route.component as React.ComponentType
      rerender(<Component />)
      await act(async () => { screen.getByTestId(`continue-${capped.id}`).click() })
      await waitFor(() => expect(steps).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(chat.status).toBe('ready'))

      // The capped assistant (tool call and result) stays canonical history in
      // the next model request; the tool is not executed again.
      expect(run).toHaveBeenCalledTimes(1)
      const history = steps.mock.calls[1][0]
      const keptAssistant = history.find((message: any) => message.role === 'assistant')
      expect(keptAssistant).toBeDefined()
      expect(keptAssistant.parts).toContainEqual(
        expect.objectContaining({ toolCallId: 'tcA', state: 'output-available', output: 'A' })
      )
      // The continuation enters through the normal send path as a user turn.
      const lastUser = history.filter((message: any) => message.role === 'user').at(-1)
      expect(lastUser.parts).toEqual([{ type: 'text', text: 'Continue.' }])
      // Not the regenerate/prefill path: nothing is deleted or prefilled.
      expect(h.mockSetContinueFromContent).not.toHaveBeenCalled()
      expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
      // The capped turn keeps its record; the continuation persists as its own
      // assistant reply.
      expect(chat.messages.filter(message => message.role === 'assistant')).toHaveLength(2)
      expect(chat.messages.at(-1)!.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'continued' }))
      expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
    })

    it('Continue after a user Stop keeps settled tool waves in the request without re-execution', async () => {
      const run = vi.fn(() => Promise.resolve({ content: 'A' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      const { chat, steps, rerender } = setup(['tcA'])
      // Step 1: tool wave settles. Step 2: final text streams and is held open
      // so Stop lands mid-text. Step 3: the continuation reply.
      steps.mockImplementation(async (messages: any[]) => {
        const records = h.messagesState.getMessages('thread-1')
        for (const message of messages.filter((m: any) => m.role === 'user')) {
          if (!records.some((record: any) => record.id === message.id)) records.push({
            id: message.id, thread_id: 'thread-1', role: 'user', metadata: {},
            content: [{ type: 'text', text: { value: message.parts.find((p: any) => p.type === 'text')?.text ?? '', annotations: [] } }],
          })
        }
        const call = steps.mock.calls.length
        if (call === 1) return chunks(toolStep('tcA'))
        if (call === 2) return new ReadableStream<UIMessageChunk>({ start(c) {
          c.enqueue({ type: 'start', messageId: 'provider-final' })
          c.enqueue({ type: 'text-start', id: 'text' })
          c.enqueue({ type: 'text-delta', id: 'text', delta: 'the result shows' })
          // Held open: only Stop ends this stream.
        } })
        return chunks(textStep)
      })
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(JSON.stringify(chat.messages.at(-1)!.parts)).toContain('the result shows'))
      const Component = Route.component as React.ComponentType
      rerender(<Component />)
      await act(async () => { screen.getByTestId('chat-stop').click() })
      await act(async () => { await pending })
      await waitFor(() => expect(chat.status).toBe('ready'))
      const stopped = chat.messages.find(message => message.role === 'assistant')!
      expect(stopped.metadata).toMatchObject({ stopped: true })
      expect(stopped.parts).toContainEqual(expect.objectContaining({ toolCallId: 'tcA', state: 'output-available', output: 'A' }))

      rerender(<Component />)
      await act(async () => { screen.getByTestId(`continue-${stopped.id}`).click() })
      await waitFor(() => expect(steps).toHaveBeenCalledTimes(3))
      await waitFor(() => expect(chat.status).toBe('ready'))

      // The settled tool wave stays in the next request; nothing re-executes.
      expect(run).toHaveBeenCalledTimes(1)
      const history = steps.mock.calls[2][0]
      const kept = history.find((message: any) =>
        message.role === 'assistant' && message.parts.some((p: any) => p.toolCallId === 'tcA'))
      expect(kept).toBeDefined()
      expect(kept.parts).toContainEqual(
        expect.objectContaining({ toolCallId: 'tcA', state: 'output-available', output: 'A' })
      )
      expect(history.filter((message: any) => message.role === 'user').at(-1)!.parts)
        .toEqual([{ type: 'text', text: 'Continue.' }])
      // Not the regenerate/prefill path: the stopped record is kept, nothing
      // is prefilled, and the continuation persists as its own reply.
      expect(h.mockSetContinueFromContent).not.toHaveBeenCalled()
      expect(h.messagesState.deleteMessage).not.toHaveBeenCalled()
      expect(chat.messages.filter(message => message.role === 'assistant')).toHaveLength(2)
      expect(chat.messages.at(-1)!.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'continued' }))
    })

    it('Continue after stopping a held tool keeps the truthful error outcome, never a false result', async () => {
      const cancel = vi.fn().mockResolvedValue(undefined)
      const run = vi.fn(() => ({ promise: new Promise(() => {}), cancel, token: 't' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: run }) as never
      const { chat, steps, rerender } = setup(['tcA'])
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      h.chatState.messages = chat.messages
      const Component = Route.component as React.ComponentType
      rerender(<Component />)
      await act(async () => { screen.getByTestId('chat-stop').click() })
      await act(async () => { await pending })
      await waitFor(() => expect(chat.status).toBe('ready'))
      const stopped = chat.messages.find(message => message.role === 'assistant')!
      const settledError = stopped.parts.find((p: any) => p.toolCallId === 'tcA') as any
      expect(settledError).toMatchObject({ state: 'output-error' })

      rerender(<Component />)
      await act(async () => { screen.getByTestId(`continue-${stopped.id}`).click() })
      await waitFor(() => expect(steps).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(chat.status).toBe('ready'))
      expect(run).toHaveBeenCalledTimes(1)
      const history = steps.mock.calls[1][0]
      const kept = history.find((message: any) =>
        message.role === 'assistant' && message.parts.some((p: any) => p.toolCallId === 'tcA'))
      expect(kept).toBeDefined()
      const keptPart = kept.parts.find((p: any) => p.toolCallId === 'tcA')
      // Truthfully an error — never rewritten into a completed result.
      expect(keptPart).toMatchObject({ state: 'output-error' })
      expect(keptPart.output).toBeUndefined()
    })

    it('branched Continue links the user turn and reply into the active path across reload', async () => {
      integrationMaxSteps = 1
      const run = vi.fn(() => Promise.resolve({ content: 'A' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      const { chat, steps, rerender } = setup(['tcA'])
      await act(async () => { await chat.sendMessage({ text: 'go' }) })
      await waitFor(() => expect(chat.status).toBe('ready'))
      const capped = chat.messages.find(message => message.role === 'assistant')!
      expect(capped.metadata).toMatchObject({ stopped: true, runStopReason: 'steps' })

      // The thread was edited/regenerated before: an older sibling root with
      // its own reply, and the capped pair linked as the active branch.
      const records = h.messagesState.getMessages('thread-1')
      const goRecord = records.find((record: any) => record.role === 'user')!
      const cappedRecord = records.find((record: any) => record.id === capped.id)!
      goRecord.created_at = 10
      goRecord.metadata = { ...goRecord.metadata, parentId: null }
      cappedRecord.created_at = 11
      cappedRecord.metadata = { ...cappedRecord.metadata, parentId: goRecord.id }
      records.unshift(
        { id: 'old-root', thread_id: 'thread-1', role: 'user', created_at: 1, metadata: { parentId: null }, content: [{ type: 'text', text: { value: 'old', annotations: [] } }] },
        { id: 'old-reply', thread_id: 'thread-1', role: 'assistant', created_at: 2, metadata: { parentId: 'old-root' }, content: [{ type: 'text', text: { value: 'old reply', annotations: [] } }] },
      )
      h.threadsState.threads['thread-1'].metadata = {
        ...(h.threadsState.threads['thread-1'].metadata ?? {}),
        activeRootId: goRecord.id,
      }

      const Component = Route.component as React.ComponentType
      rerender(<Component />)
      await act(async () => { screen.getByTestId(`continue-${capped.id}`).click() })
      await waitFor(() => expect(steps).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(chat.status).toBe('ready'))
      expect(run).toHaveBeenCalledTimes(1)

      // The Continue user turn and its reply are linked, so a reload's active
      // path keeps them instead of silently dropping the exchange.
      const after = h.messagesState.getMessages('thread-1')
      const continueUser = after.find((record: any) =>
        record.role === 'user' && record.content?.[0]?.text?.value === 'Continue.')!
      expect(continueUser.metadata).toMatchObject({ parentId: capped.id })
      const reply = after.find((record: any) =>
        record.role === 'assistant' && record.id !== capped.id && record.id !== 'old-reply')!
      expect(reply.metadata).toMatchObject({ parentId: continueUser.id })
      const persisted = JSON.parse(JSON.stringify(after))
      const path = computeActivePath(persisted, goRecord.id)
      expect(path.map((record: any) => record.id)).toEqual([
        goRecord.id, capped.id, continueUser.id, reply.id,
      ])
    })

    it('Stop during approval never executes, settles queued cards, and ignores a late approval', async () => {
      let decide!: (value: boolean) => void
      h.toolApprovalState.requestApproval = vi.fn(() => new Promise<boolean>(resolve => { decide = resolve }))
      const run = vi.fn()
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      const { chat, steps } = setup()
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(2))
      await act(async () => { screen.getByTestId('chat-stop').click(); await pending })
      decide(true)
      expect(run).not.toHaveBeenCalled()
      expect(steps).toHaveBeenCalledTimes(1)
      const tools = chat.messages.flatMap(m => m.parts).filter(p => 'toolCallId' in p)
      expect(tools).toHaveLength(2)
      expect(tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ toolCallId: 'tcA', state: 'output-error' }),
        expect.objectContaining({ toolCallId: 'tcB', state: 'output-error' }),
      ]))
      expect(h.toolApprovalState.clearPendingForThread).toHaveBeenCalledWith('thread-1')
      expect(h.appStateState.setThreadBusy).toHaveBeenLastCalledWith('thread-1', false)
    })

    it('a denied first call still executes the next call and continues once', async () => {
      h.toolApprovalState.requestApproval = vi.fn(id => Promise.resolve(id !== 'tcA'))
      const run = vi.fn().mockResolvedValue({ content: 'allowed B' })
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      const { chat, steps } = setup()
      await act(async () => { await chat.sendMessage({ text: 'go' }) })
      expect(run).toHaveBeenCalledTimes(1)
      expect(run.mock.calls[0][0].arguments.id).toBe('tcB')
      expect(steps).toHaveBeenCalledTimes(2)
      expect(chat.messages.flatMap(m => m.parts)).toEqual(expect.arrayContaining([
        expect.objectContaining({ toolCallId: 'tcA', state: 'output-error', errorText: expect.stringContaining('denied') }),
        expect.objectContaining({ toolCallId: 'tcB', state: 'output-available', output: 'allowed B' }),
      ]))
      expect(useToolCallRuntime.getState().queue).toEqual([])
    })

    it('Stop after returning cancels only the retained thread and preserves completed output', async () => {
      const cancel = vi.fn().mockResolvedValue(undefined)
      const run = vi.fn((args: any) => ({
        promise: args.arguments.id === 'tcA' ? Promise.resolve({ content: 'A survives' }) : new Promise(() => {}),
        cancel, token: 't',
      }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: run }) as never
      const { chat, rerender, steps } = setup()
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
      const Component = Route.component as React.ComponentType
      try {
        h.routeParams.threadId = 'thread-2'
        h.integrationChat = new Chat({ id: 'thread-2' })
        h.chatSessionsState.sessions['thread-2'] = { chat: h.integrationChat }
        rerender(<Component />)
        await act(async () => { screen.getByTestId('chat-stop').click() })
        expect(cancel).not.toHaveBeenCalled()
        h.routeParams.threadId = 'thread-1'; h.integrationChat = chat
        rerender(<Component />)
        await act(async () => { screen.getByTestId('chat-stop').click(); await pending })
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(steps).toHaveBeenCalledTimes(1)
        expect(chat.messages.flatMap(m => m.parts)).toEqual(expect.arrayContaining([
          expect.objectContaining({ toolCallId: 'tcA', state: 'output-available', output: 'A survives' }),
          expect.objectContaining({ toolCallId: 'tcB', state: 'output-error' }),
        ]))
      } finally { h.routeParams.threadId = 'thread-1' }
    })

    it('a pending approval survives navigation and another thread terminal finish', async () => {
      const decisions: Array<(approved: boolean) => void> = []
      h.toolApprovalState.requestApproval = vi.fn(() => new Promise<boolean>(resolve => decisions.push(resolve)))
      const run = vi.fn().mockResolvedValue({ content: 'approved on return' })
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: cancellable(run) }) as never
      const { chat, rerender, steps } = setup(['tcA'])
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(decisions).toHaveLength(1))
      const Component = Route.component as React.ComponentType
      try {
        h.routeParams.threadId = 'thread-2'; h.integrationChat = new Chat({ id: 'thread-2' })
        h.chatSessionsState.sessions['thread-2'] = { chat: h.integrationChat }
        rerender(<Component />)
        await act(async () => { (h as any).capturedOnFinish({ message: { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'B' }] }, isAbort: true }) })
        expect(h.toolApprovalState.clearPendingForThread).not.toHaveBeenCalledWith('thread-1')
        h.routeParams.threadId = 'thread-1'; h.integrationChat = chat; rerender(<Component />)
        await act(async () => { decisions[0](true); await pending })
        expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(1)
        expect(run).toHaveBeenCalledTimes(1)
        expect(steps).toHaveBeenCalledTimes(2)
      } finally { h.routeParams.threadId = 'thread-1' }
    })

    it('completion of a left thread does not disrupt the current running thread continuation', async () => {
      const release: Record<string, (value: unknown) => void> = {}
      const run = vi.fn((args: any) => ({
        promise: new Promise(resolve => { release[args.arguments.id] = resolve }),
        cancel: vi.fn().mockResolvedValue(undefined), token: args.arguments.id,
      }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: run }) as never
      const a = setup(['tcA'])
      const pendingA = a.chat.sendMessage({ text: 'A' })
      await waitFor(() => expect(release.tcA).toBeTypeOf('function'))
      a.unmount()
      try {
        h.routeParams.threadId = 'thread-2'
        const b = setup(['tcB'], 'thread-2')
        const pendingB = b.chat.sendMessage({ text: 'B' })
        await waitFor(() => expect(release.tcB).toBeTypeOf('function'))
        await act(async () => { release.tcA({ content: 'A result' }); await pendingA })
        expect(a.steps).toHaveBeenCalledTimes(2)
        expect(b.steps).toHaveBeenCalledTimes(1)
        expect(b.chat.status).toBe('streaming')
        await act(async () => { release.tcB({ content: 'B result' }); await pendingB })
        expect(b.steps).toHaveBeenCalledTimes(2)
        expect(h.toolApprovalState.requestApproval).toHaveBeenCalledTimes(2)
        expect(b.chat.messages.flatMap(m => m.parts)).toContainEqual(expect.objectContaining({ toolCallId: 'tcB', state: 'output-available', output: 'B result' }))
      } finally { h.routeParams.threadId = 'thread-1' }
    })

    it('navigation and Stop in another thread leave the retained run and its follow-up intact', async () => {
      let release!: (value: unknown) => void
      const cancel = vi.fn().mockResolvedValue(undefined)
      const run = vi.fn(() => ({ promise: new Promise(resolve => { release = resolve }), cancel, token: 't' }))
      hub.mcp = () => ({ getTools: getMcpTools, callToolWithCancellation: run }) as never
      const { chat, steps, rerender } = setup(['tcA'])
      const pending = chat.sendMessage({ text: 'go' })
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      const Component = Route.component as React.ComponentType
      try {
        h.routeParams.threadId = 'thread-2'
        h.integrationChat = new Chat({ id: 'thread-2' })
        h.chatSessionsState.sessions['thread-2'] = { chat: h.integrationChat }
        rerender(<Component />)
        await act(async () => { screen.getByTestId('chat-stop').click() })
        expect(cancel).not.toHaveBeenCalled()
        release({ content: 'retained' })
        await act(async () => { await pending })
        expect(steps).toHaveBeenCalledTimes(2)
        expect(chat.messages.flatMap(m => m.parts)).toContainEqual(expect.objectContaining({ toolCallId: 'tcA', state: 'output-available', output: 'retained' }))
        expect(chat.status).toBe('ready')
      } finally { h.routeParams.threadId = 'thread-1' }
    })
  })

  it('leaving a thread releases only its own settled runtime state', () => {
    const runtime = useToolCallRuntime.getState()
    runtime.enqueue(['a-done', 'a-running'], 'thread-1')
    runtime.markRunning('a-done'); runtime.markSettled('a-done'); runtime.markRunning('a-running')
    runtime.enqueue(['b-done'], 'thread-3'); runtime.markRunning('b-done'); runtime.markSettled('b-done')
    const { rerender } = renderComponent()
    const Component = Route.component as React.ComponentType
    try { h.routeParams.threadId = 'thread-2'; rerender(<Component />) }
    finally { h.routeParams.threadId = 'thread-1' }
    const { timings } = useToolCallRuntime.getState()
    expect(timings['a-done']).toBeUndefined()
    expect(timings['a-running']?.startedAt).toBeDefined()
    expect(timings['b-done']).toBeDefined()
  })

  describe('Stop persists tool state', () => {
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
          { type: 'tool_call', tool_call_id: 'tcA', tool_name: 'fetch', input: {}, output: 'result A' },
          { type: 'tool_call', tool_call_id: 'tcB', tool_name: 'fetch', input: {}, output: undefined },
        ])
        expect(rewritten.metadata).toMatchObject({
          parentId: 'u1',
          stopped: true,
          toolErrors: { tcB: expect.stringContaining('Stopped') },
        })
        expect(rewritten.metadata.toolErrors).not.toHaveProperty('tcA')
      })


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
            transport: { getTurnModelSelection: () => null, cancelChatRun: vi.fn().mockResolvedValue(undefined) },
            chat: {
              stop: vi.fn(),
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
