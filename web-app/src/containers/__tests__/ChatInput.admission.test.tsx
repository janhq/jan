import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { UIMessageChunk } from 'ai'

// Regression for the reviewer's composer finding: the production hook's
// returned sendMessage resolves at SDK admission (transport entry), not when
// the whole turn settles, so the REAL ChatInput's post-onSubmit setPrompt('')
// clears the original draft promptly and cannot wipe text typed during a held
// tool at turn end. Cancellation must still await the full tracked SDK
// operation. Real pieces: ChatInput, usePrompt store, use-chat hook, SDK Chat,
// createChatRunStream/runTurn. Mocked: model step (h.send) and ChatInput's
// unrelated service/UI boundaries, copied from ChatInput.test.tsx.

const h = vi.hoisted(() => ({
  send: vi.fn(),
  tracked: [] as Array<Promise<void>>,
  // When set, the tracked-operation chain handed to the production barrier
  // resolves only after this gate: cancelChatRun can then be observed actually
  // awaiting the tracked operation rather than winning a microtask race.
  gate: undefined as Promise<void> | undefined,
}))

vi.mock('@/lib/custom-chat-transport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/custom-chat-transport')>('@/lib/custom-chat-transport')
  return {
    CustomChatTransport: class extends actual.CustomChatTransport {
      // Real beginChatRun/cancelChatRun/trackChatOperation barriers; only the
      // model step and discovery surfaces are stubbed.
      trackChatOperation(operation: Promise<void>) {
        h.tracked.push(operation)
        const gated = operation.then(() => h.gate, () => h.gate) as Promise<void>
        super.trackChatOperation(gated)
      }
      getTurnModelSelection() {
        return { selectedModel: { settings: { ctx_len: { controller_props: { value: 1000000 } } } } } as never
      }
      sendMessages = h.send
      reconnectToStream = async () => null
      updateSystemMessage() {}
      setOnTokenUsage() {}
      refreshTools() { return Promise.resolve() }
    },
  }
})

// --- ChatInput service/UI boundary mocks (from ChatInput.test.tsx). ---------
// usePrompt and the AI SDK stay REAL on purpose: the draft lifecycle under
// test lives in the real store and the real SDK Chat admission timing.

vi.mock('@/hooks/useThreads', () => ({
  useThreads: Object.assign((selector: (s: unknown) => unknown) =>
    selector({
      currentThreadId: 'thread-1',
      threads: {},
      getConversationCapabilities: () => ({ folderScope: null }),
      getCurrentThread: () => undefined,
      updateCurrentThreadAssistant: vi.fn(),
      updateCurrentThreadModel: vi.fn(),
      createThread: vi.fn(),
      acceptCreatedThread: vi.fn(),
      rollbackCreatedThread: vi.fn(),
    }), { getState: () => ({ threads: {} }) }),
}))

const appState = {
  mcpToolNames: new Set<string>(),
  ragToolNames: new Set<string>(),
  abortControllers: {},
  tools: [],
  cancelToolCall: vi.fn(),
  activeModels: [],
  setThreadBusy: vi.fn(),
  setThreadEmbedding: vi.fn(),
}
vi.mock('@/hooks/useAppState', () => ({
  useAppState: Object.assign(
    (selector?: (s: unknown) => unknown) =>
      typeof selector === 'function' ? selector(appState) : appState,
    { getState: () => appState }
  ),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (selector: (s: unknown) => unknown) =>
    selector({ spellCheckChatInput: false, tokenCounterCompact: false }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        selectedModel: { id: 'model-a', capabilities: ['tools'], provider: 'llamacpp' },
        selectedProvider: 'llamacpp',
        providers: [],
        selectModelProvider: vi.fn(),
        updateProvider: vi.fn(),
        getProviderByName: vi.fn(),
      }),
    {
      getState: () => ({
        selectedModel: { id: 'model-a', capabilities: ['tools'], provider: 'llamacpp' },
        selectedProvider: 'llamacpp',
      }),
    }
  ),
}))

vi.mock('@/hooks/useTokensCount', () => ({
  useTokensCount: () => ({
    maxTokens: undefined,
    configuredCtxLen: undefined,
    tokenCount: 0,
    isNearLimit: false,
    loading: false,
    fitEnabled: false,
    calculateTokens: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    loading: false,
    currentAssistant: { id: 'a1', name: 'Assistant', avatar: '' },
    setCurrentAssistant: vi.fn(),
    assistants: [{ id: 'a1', name: 'Assistant', avatar: '' }],
  }),
}))

vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ agentThreads: {}, toggleAgentMode: vi.fn() }),
    { getState: () => ({ setAgentMode: vi.fn(), removeThread: vi.fn() }) }
  ),
}))

vi.mock('@/hooks/useMessages', () => ({
  useMessages: (selector: (s: unknown) => unknown) =>
    selector({ messages: { 'thread-1': [] } }),
}))

vi.mock('@/hooks/useTools', () => ({ useTools: () => undefined }))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: (selector: (s: unknown) => unknown) =>
    selector({ enabled: true, parseMode: 'auto', maxFileSizeMB: 10 }),
}))

vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}))

const attachmentStore = {
  getAttachments: () => [],
  setAttachments: vi.fn(),
  clearAttachments: vi.fn(),
  transferAttachments: vi.fn(),
}
vi.mock('@/hooks/useChatAttachments', () => ({
  NEW_THREAD_ATTACHMENT_KEY: '__new_thread__',
  useChatAttachments: Object.assign(
    (selector: (s: unknown) => unknown) => selector(attachmentStore),
    { getState: () => attachmentStore }
  ),
}))

vi.mock('@/hooks/useJanBrowserExtension', () => ({
  useJanBrowserExtension: () => ({
    hasConfig: false,
    isActive: false,
    isLoading: false,
    dialogOpen: false,
    dialogState: null,
    toggleBrowser: vi.fn(),
    handleCancel: vi.fn(),
    setDialogOpen: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAttachmentIngestionPrompt', () => ({
  useAttachmentIngestionPrompt: vi.fn(),
}))

const queueStore = {
  getQueue: () => [],
  isPaused: () => false,
  enqueue: vi.fn(),
  removeMessage: vi.fn(),
  clearQueue: vi.fn(),
}
vi.mock('@/stores/message-queue-store', () => ({
  useMessageQueue: Object.assign(
    (selector?: (s: unknown) => unknown) =>
      typeof selector === 'function' ? selector(queueStore) : queueStore,
    { getState: () => queueStore }
  ),
}))

vi.mock('@/containers/ComposerModelPicker', () => ({
  default: () => <button aria-label="Select model">Model</button>,
}))

vi.mock('@/lib/path-references', () => ({
  expandPromptReferences: async (text: string) => ({ text, resolvedContents: '' }),
  searchFiles: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
    state: { location: { searchStr: window.location.search } },
  }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/containers/QueuedMessageBubble', () => ({
  QueuedMessageChip: () => <div data-testid="queued-chip" />,
}))
vi.mock('@/containers/DropdownToolsAvailable', () => ({
  __esModule: true,
  default: () => <div data-testid="stub-tools" />,
}))
vi.mock('@/containers/AvatarEmoji', () => ({
  AvatarEmoji: () => <span data-testid="stub-avatar" />,
}))
vi.mock('@/containers/McpExtensionToolLoader', () => ({
  McpExtensionToolLoader: () => null,
}))
vi.mock('@/containers/dialogs/JanBrowserExtensionDialog', () => ({
  __esModule: true,
  default: () => null,
}))
vi.mock('@/containers/MovingBorder', () => ({
  MovingBorder: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/TokenCounter', () => ({
  TokenCounter: () => <div data-testid="stub-token-counter" />,
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
      <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
    DropdownMenuTrigger: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuCheckboxItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  }
})
vi.mock('@/components/ui/tooltip', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return { Tooltip: Pass, TooltipContent: Pass, TooltipProvider: Pass, TooltipTrigger: Pass }
})

vi.mock('@/lib/agentTools', () => ({
  getSandboxStatus: vi.fn().mockResolvedValue({ enforces: false }),
  cancelAgentThreadBash: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => false,
}))

// Import after mocks.
import React, { useRef } from 'react'
import ChatInput from '../ChatInput'
import { useChat } from '@/hooks/use-chat'
import { usePrompt } from '@/hooks/usePrompt'
import { useChatSessions } from '@/stores/chat-session-store'
import { generateId } from 'ai'

const wave = () => new ReadableStream<UIMessageChunk>({ start(c) {
  c.enqueue({ type: 'tool-input-available', toolCallId: 'held', toolName: 'held', input: {} })
  c.enqueue({ type: 'finish' }); c.close()
} })
const answer = () => new ReadableStream<UIMessageChunk>({ start(c) {
  c.enqueue({ type: 'text-start', id: 'text' }); c.enqueue({ type: 'text-delta', id: 'text', delta: 'done' }); c.enqueue({ type: 'text-end', id: 'text' }); c.enqueue({ type: 'finish' }); c.close()
} })

// The route's onSubmit contract around sendMessage ($threadId.tsx): await the
// hook's sendMessage and return false on rejection so ChatInput keeps the
// draft; on acceptance ChatInput itself runs setPrompt('').
function Host({ dispatchTool }: { dispatchTool: (call: unknown, signal: AbortSignal) => Promise<{ output: unknown; isError?: boolean }> }) {
  const chat = useChat({ sessionId: 'thread-1', dispatchTool: dispatchTool as never })
  const chatRef = useRef(chat)
  chatRef.current = chat
  const onSubmit = async (text: string) => {
    try {
      await chatRef.current.sendMessage({
        parts: [{ type: 'text', text }],
        id: generateId(),
        metadata: { createdAt: new Date() },
      })
    } catch {
      return false
    }
  }
  return (
    <div>
      <ChatInput onSubmit={onSubmit} chatStatus={chat.status} onStop={() => chatRef.current.stop()} />
      <span data-testid="status">{chat.status}</span>
    </div>
  )
}

const textarea = () => screen.getByTestId('chat-input') as HTMLTextAreaElement

describe('real ChatInput with production use-chat hook and real SDK Chat', () => {
  beforeEach(() => {
    useChatSessions.getState().clearSessions()
    usePrompt.setState({ prompt: '' })
    h.send.mockReset()
    h.tracked.length = 0
    h.gate = undefined
  })

  it('clears the submitted draft at admission during a held tool and keeps text typed before turn end', async () => {
    h.send.mockResolvedValueOnce(wave()).mockResolvedValueOnce(answer())
    let finish!: (v: { output: unknown }) => void
    const dispatch = vi.fn(() => new Promise<{ output: unknown }>((resolve) => { finish = resolve }))
    render(<Host dispatchTool={dispatch} />)

    fireEvent.change(textarea(), { target: { value: 'original draft' } })
    expect(textarea()).toHaveValue('original draft')
    await act(async () => { fireEvent.click(screen.getByTestId('send-message-button')) })

    // Tool held: the turn is NOT settled, yet the submitted draft is gone.
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(textarea()).toHaveValue(''))
    expect(screen.getByTestId('status')).toHaveTextContent('streaming')

    // Type a fresh draft while the tool is still held.
    fireEvent.change(textarea(), { target: { value: 'typed during held tool' } })

    // End the turn: the held tool resolves, the follow-up answer streams.
    await act(async () => { finish({ output: 'done' }) })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))

    // The fresh draft survived turn end — nothing cleared it retroactively.
    expect(textarea()).toHaveValue('typed during held tool')
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it('cancellation still awaits the full tracked SDK operation, not the admission receipt', async () => {
    h.send.mockResolvedValueOnce(wave())
    const dispatch = vi.fn(() => new Promise<{ output: unknown }>(() => {}))
    let releaseGate!: () => void
    h.gate = new Promise<void>((resolve) => { releaseGate = resolve })
    render(<Host dispatchTool={dispatch} />)

    fireEvent.change(textarea(), { target: { value: 'original draft' } })
    await act(async () => { fireEvent.click(screen.getByTestId('send-message-button')) })
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(textarea()).toHaveValue(''))

    // The admission receipt resolved (draft cleared) but the tracked operation
    // must still be pending while the tool is held.
    expect(h.tracked).toHaveLength(1)
    let operationSettled = false
    h.tracked[0].then(() => { operationSettled = true }, () => { operationSettled = true })
    await Promise.resolve()
    expect(operationSettled).toBe(false)

    // Route cancellation path: the retained transport's cancel barrier. The
    // abort lets the SDK operation itself settle, but the tracked chain is
    // held by the gate — cancelChatRun may not resolve before it.
    const transport = useChatSessions.getState().sessions['thread-1'].transport
    let cancelSettled = false
    const cancelled = transport.cancelChatRun().then(() => { cancelSettled = true })
    await act(async () => { await waitFor(() => expect(operationSettled).toBe(true)) })
    expect(cancelSettled).toBe(false)

    releaseGate()
    await act(async () => { await cancelled })
    expect(cancelSettled).toBe(true)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
  })
})
