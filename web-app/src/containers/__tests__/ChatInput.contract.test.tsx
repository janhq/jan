import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

/**
 * Composer <-> route onSubmit contract, with the REAL pieces on both sides.
 *
 * EVIDENCE LEVELS (what this file does and does not prove):
 *
 *  REAL here:
 *   - ChatInput (the production component, unmodified)
 *   - usePrompt store, useChatAttachments store, useMessageQueue store,
 *     useFailedDrafts store (all production zustand stores, no mocks)
 *   - restoreSubmittedDraft / restoreQueueHead: the production helpers,
 *     imported from '@/lib/composer-restore' (the route imports the same
 *     functions, so this is the code that runs in the route, not a copy)
 *
 *  SIMULATED here (a thin host, not the route):
 *   - the parent `onSubmit`. It reproduces only what the route does around
 *     the helper: capture the lifetime token, read the attachment bucket,
 *     clear it when processing begins, wait for an outcome, then call the
 *     production helper and return `false`. It does NOT run
 *     processAndSendMessage, so the route's own branch selection
 *     (cancel vs processing failure vs rejection) is covered by the mocked
 *     route tests in routes/threads/__tests__/$threadId.test.tsx, not here.
 *     "cancel" and "processing failure" therefore share one helper call and
 *     differ only by label.
 *   - useThreads (only currentThreadId is needed) and the unrelated
 *     service/UI boundaries, copied from ChatInput.admission.test.tsx.
 *
 *  Regression value: the old route tests assert against ~190 mocked route
 *  checks; these assert on what the real composer actually shows and keeps.
 */

const threadsState = { currentThreadId: 'thread-1' as string | undefined }
const threadsApi = () => ({
  currentThreadId: threadsState.currentThreadId,
  threads: {},
  getConversationCapabilities: () => ({ folderScope: null }),
  getCurrentThread: () => undefined,
  updateCurrentThreadAssistant: vi.fn(),
  updateCurrentThreadModel: vi.fn(),
  createThread: vi.fn(),
  acceptCreatedThread: vi.fn(),
  rollbackCreatedThread: vi.fn(),
})
vi.mock('@/hooks/useThreads', () => ({
  useThreads: Object.assign(
    (selector: (s: unknown) => unknown) => selector(threadsApi()),
    { getState: () => threadsApi() }
  ),
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

const selectedModel = {
  id: 'model-a',
  capabilities: ['tools', 'vision'],
  provider: 'llamacpp',
}
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        selectedModel,
        selectedProvider: 'llamacpp',
        providers: [],
        selectModelProvider: vi.fn(),
        updateProvider: vi.fn(),
        getProviderByName: vi.fn(),
      }),
    { getState: () => ({ selectedModel, selectedProvider: 'llamacpp' }) }
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

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: () => undefined,
      getByName: () => undefined,
      listExtensions: () => [],
    }),
  },
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

// Import after mocks. usePrompt, useChatAttachments, useMessageQueue and
// useFailedDrafts are deliberately NOT mocked.
import { useChatPlan } from '@/hooks/useChatPlan'
import ChatInput from '../ChatInput'
import { usePrompt } from '@/hooks/usePrompt'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useMessageQueue } from '@/stores/message-queue-store'
import { useFailedDrafts } from '@/stores/failed-draft-store'
import { restoreSubmittedDraft, restoreQueueHead } from '@/lib/composer-restore'
import type { Attachment } from '@/types/attachment'

const THREAD = 'thread-1'

const doc: Attachment = {
  name: 'sheet.pdf',
  type: 'document',
  path: '/tmp/sheet.pdf',
  fileType: 'pdf',
  id: 'doc-1',
}
const img: Attachment = {
  name: 'shot.png',
  type: 'image',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,AAAA',
  base64: 'AAAA',
  id: 'img-1',
}

const textarea = () => screen.getByTestId('chat-input') as HTMLTextAreaElement
const bucket = () => useChatAttachments.getState().getAttachments(THREAD)

type Outcome = 'cancel' | 'processing-failure' | 'rejection' | 'accepted'

const newerDoc: Attachment = {
  name: 'new.pdf',
  type: 'document',
  path: '/tmp/new.pdf',
  fileType: 'pdf',
  id: 'doc-2',
}

/**
 * Parent onSubmit stand-in. Mirrors the route around the production helper:
 * token captured first, bucket read, bucket cleared when processing begins,
 * then, on failure, restoreSubmittedDraft + `return false`.
 */
function makeParent(opts: { ingestion?: boolean } = {}) {
  let settle!: (o: Outcome) => void
  const outcome = new Promise<Outcome>((resolve) => {
    settle = resolve
  })
  const returned: Array<boolean | undefined> = []
  const onSubmit = vi.fn(async (_text: string, _files?: unknown, _docs?: unknown, draft?: string) => {
    const text = draft ?? _text
    const token = useFailedDrafts.getState().getToken(THREAD)
    const submitted = useChatAttachments.getState().getAttachments(THREAD)
    // Route clears the bucket when processing begins. An ingestion-dialog cancel
    // happens BEFORE that point, so the files are still in the bucket.
    if (!opts.ingestion) useChatAttachments.getState().clearAttachments(THREAD)
    const o = await outcome
    if (o === 'accepted') {
      returned.push(undefined)
      return undefined
    }
    restoreSubmittedDraft({
      threadId: THREAD,
      attachmentsKey: THREAD,
      draft: text,
      attachments: submitted,
      token,
      setAttachments: useChatAttachments.getState().setAttachments,
      // Mirrors the route's ingestion-cancel call.
      bucketHoldsAttachments: opts.ingestion === true,
    })
    returned.push(false)
    return false
  })
  return { onSubmit, settle, returned }
}

const send = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('send-message-button'))
  })
}

describe('real ChatInput + real stores + production restoreSubmittedDraft', () => {
  beforeEach(() => {
    threadsState.currentThreadId = THREAD
    useChatPlan.setState({ drafts: {} })
    usePrompt.setState({ prompt: '', promptHistory: [], historyIndex: -1 })
    useChatAttachments.setState({ attachmentsByThread: {} })
    useMessageQueue.setState({ queues: {}, paused: {}, generations: {} })
    useFailedDrafts.setState({ drafts: {} })
  })

  const seedComposer = (prompt: string) => {
    useChatAttachments.getState().setAttachments(THREAD, [doc, img])
    usePrompt.setState({ prompt })
  }

  it('Plan slash action toggles a conversation draft without sending a model turn', async () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(textarea(), { target: { value: '/plan' } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(useChatPlan.getState().drafts[THREAD]).toBe(true)
    expect(textarea()).toHaveValue('')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'common:planMode.label' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['/help me debug', '/plan the migration', '/clear'])('sends reserved slash text unchanged: %s', async (text) => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(textarea(), { target: { value: text } })
    await send()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toBe(text)
    expect(useChatPlan.getState().drafts[THREAD]).not.toBe(true)
  })

  it.each(['/a', '/an', '/n'])('does not suggest or toggle Plan for non-prefix %s', async (text) => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(textarea(), { target: { value: text } })
    expect(screen.queryByRole('option', { name: '/plan' })).not.toBeInTheDocument()
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0][0]).toBe(text)
    expect(useChatPlan.getState().drafts[THREAD]).not.toBe(true)
  })

  it.each(['/p', '/pl'])('suggests Plan for prefix %s', (text) => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(textarea(), { target: { value: text } })
    expect(screen.getByRole('option', { name: '/plan' })).toBeInTheDocument()
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(useChatPlan.getState().drafts[THREAD]).toBe(true)
    expect(textarea()).toHaveValue('')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('control: an accepted send clears the prompt and attachments', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))
    // Files and documents reach the parent in the same call.
    const call = parent.onSubmit.mock.calls[0] as unknown[]
    expect(call[3]).toBe('original draft')
    expect(call[1]).toHaveLength(1)
    expect(call[2]).toHaveLength(1)
    await act(async () => parent.settle('accepted'))
    await waitFor(() => expect(textarea()).toHaveValue(''))
    expect(bucket()).toEqual([])
    expect(useFailedDrafts.getState().getDrafts(THREAD)).toEqual([])
  })

  it('rejected with the prompt still the original: false, prompt and files kept, no failed-draft duplicate', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))
    // While the send is held, processing already took the files out.
    expect(bucket()).toEqual([])
    expect(textarea()).toHaveValue('original draft')

    await act(async () => parent.settle('rejection'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(textarea()).toHaveValue('original draft')
    expect(usePrompt.getState().prompt).toBe('original draft')
    expect(bucket()).toEqual([doc, img])
    expect(useFailedDrafts.getState().getDrafts(THREAD)).toEqual([])
    expect(screen.queryByTestId('failed-draft-card')).not.toBeInTheDocument()
  })

  it.each(['cancel', 'processing-failure'] as const)(
    '%s: returning false keeps the prompt and files',
    async (outcome) => {
      seedComposer('original draft')
      const parent = makeParent()
      render(<ChatInput onSubmit={parent.onSubmit} />)
      await send()
      await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

      await act(async () => parent.settle(outcome))
      await waitFor(() => expect(parent.returned).toEqual([false]))

      expect(textarea()).toHaveValue('original draft')
      expect(bucket()).toEqual([doc, img])
      expect(useFailedDrafts.getState().getDrafts(THREAD)).toEqual([])
    }
  )

  it('a newer prompt typed while held: whole draft goes to a failed-draft entry, the newer prompt is kept', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    fireEvent.change(textarea(), { target: { value: 'newer prompt' } })
    expect(textarea()).toHaveValue('newer prompt')

    await act(async () => parent.settle('rejection'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    // Newer prompt untouched, nothing auto-restored into the composer.
    expect(textarea()).toHaveValue('newer prompt')
    expect(bucket()).toEqual([])
    // One complete entry: original text and all files together.
    const entries = useFailedDrafts.getState().getDrafts(THREAD)
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('original draft')
    expect(entries[0].attachments).toEqual([doc, img])
    // The real card renders it and offers Restore draft.
    expect(await screen.findByTestId('failed-draft-card')).toBeInTheDocument()
    // Nothing was sent.
    expect(parent.onSubmit).toHaveBeenCalledTimes(1)

    // Restore draft: failed text first, the newer prompt kept, files back, entry gone.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'chat:failedDraft.restore' }))
    })
    expect(textarea()).toHaveValue('original draft\n\nnewer prompt')
    expect(bucket()).toEqual([doc, img])
    expect(useFailedDrafts.getState().getDrafts(THREAD)).toEqual([])
    expect(screen.queryByTestId('failed-draft-card')).not.toBeInTheDocument()
  })

  it('a thread deleted while held and the prompt unchanged: the original is cleared everywhere', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    useFailedDrafts.getState().clearThread(THREAD)
    await act(async () => parent.settle('rejection'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(textarea()).toHaveValue('')
    expect(usePrompt.getState().prompt).toBe('')
    expect(bucket()).toEqual([])
    expect(useFailedDrafts.getState().getDrafts(THREAD)).toEqual([])
    expect(screen.queryByTestId('failed-draft-card')).not.toBeInTheDocument()
  })

  it('a thread deleted while held and a newer prompt typed: the newer prompt is preserved, the deleted draft is not recovered', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    fireEvent.change(textarea(), { target: { value: 'newer prompt' } })
    useFailedDrafts.getState().clearThread(THREAD)
    await act(async () => parent.settle('rejection'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(textarea()).toHaveValue('newer prompt')
    expect(usePrompt.getState().prompt).toBe('newer prompt')
    expect(bucket()).toEqual([])
    expect(useFailedDrafts.getState().getDrafts(THREAD)).toEqual([])
  })

  it('switched thread with the prompt unchanged: one failed-draft card, no duplicate left in the composer', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    threadsState.currentThreadId = 'thread-2'
    await act(async () => parent.settle('rejection'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    const entries = useFailedDrafts.getState().getDrafts(THREAD)
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('original draft')
    expect(entries[0].attachments).toEqual([doc, img])
    expect(usePrompt.getState().prompt).toBe('')
    expect(textarea()).toHaveValue('')
    expect(bucket()).toEqual([])
  })

  it('switched thread with a newer prompt: the newer prompt is untouched and the draft is recovered once', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    fireEvent.change(textarea(), { target: { value: 'newer prompt' } })
    threadsState.currentThreadId = 'thread-2'
    await act(async () => parent.settle('rejection'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(usePrompt.getState().prompt).toBe('newer prompt')
    expect(useFailedDrafts.getState().getDrafts(THREAD)).toHaveLength(1)
  })

  it('accepted send: text typed and files added while it was held are kept, only the submitted ones are cleared', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    const newer = newerDoc
    fireEvent.change(textarea(), { target: { value: 'newer prompt' } })
    act(() => useChatAttachments.getState().setAttachments(THREAD, [newer]))
    await act(async () => parent.settle('accepted'))
    await waitFor(() => expect(parent.returned).toEqual([undefined]))

    expect(textarea()).toHaveValue('newer prompt')
    expect(bucket()).toEqual([newer])
  })

  it('accepted send with the prompt unchanged and only newer files added: prompt cleared, newer files kept, submitted ones gone', async () => {
    seedComposer('original draft')
    const parent = makeParent()
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    act(() => useChatAttachments.getState().setAttachments(THREAD, [newerDoc]))
    await act(async () => parent.settle('accepted'))
    await waitFor(() => expect(parent.returned).toEqual([undefined]))

    expect(textarea()).toHaveValue('')
    expect(bucket()).toEqual([newerDoc])
  })

  it('accepted send where the submitted files are still in the bucket and nothing newer exists: bucket fully cleared', async () => {
    seedComposer('original draft')
    const parent = makeParent({ ingestion: true })
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))
    expect(bucket()).toEqual([doc, img])

    await act(async () => parent.settle('accepted'))
    await waitFor(() => expect(parent.returned).toEqual([undefined]))
    expect(textarea()).toHaveValue('')
    expect(bucket()).toEqual([])
  })

  it('ingestion cancel with the prompt unchanged: prompt and files stay once, no failed-draft entry', async () => {
    seedComposer('original draft')
    const parent = makeParent({ ingestion: true })
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))
    // Cancelled before the bucket is cleared: files are still there.
    expect(bucket()).toEqual([doc, img])

    await act(async () => parent.settle('cancel'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(textarea()).toHaveValue('original draft')
    expect(bucket()).toEqual([doc, img]) // not duplicated
    expect(useFailedDrafts.getState().drafts[THREAD] ?? []).toEqual([])
  })

  it('ingestion cancel with a newer prompt: the whole failed entry owns the files, none ride along with the newer prompt', async () => {
    seedComposer('original draft')
    const parent = makeParent({ ingestion: true })
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    fireEvent.change(textarea(), { target: { value: 'newer prompt' } })
    await act(async () => parent.settle('cancel'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(textarea()).toHaveValue('newer prompt')
    // Submitted files left the bucket: they live in the entry only.
    expect(bucket()).toEqual([])
    const entries = useFailedDrafts.getState().getDrafts(THREAD)
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('original draft')
    expect(entries[0].attachments).toEqual([doc, img])
    expect(parent.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('ingestion cancel with a newer prompt and a newer file: only the submitted files move into the entry, the newer file stays', async () => {
    seedComposer('original draft')
    const parent = makeParent({ ingestion: true })
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    fireEvent.change(textarea(), { target: { value: 'newer prompt' } })
    act(() => useChatAttachments.getState().setAttachments(THREAD, [doc, img, newerDoc]))
    await act(async () => parent.settle('cancel'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(bucket()).toEqual([newerDoc])
    const entries = useFailedDrafts.getState().getDrafts(THREAD)
    expect(entries).toHaveLength(1)
    expect(entries[0].attachments).toEqual([doc, img])
  })

  it('ingestion cancel after a switch to another thread: the entry owns the files, the original is not left in the shared prompt', async () => {
    seedComposer('original draft')
    const parent = makeParent({ ingestion: true })
    render(<ChatInput onSubmit={parent.onSubmit} />)
    await send()
    await waitFor(() => expect(parent.onSubmit).toHaveBeenCalledTimes(1))

    threadsState.currentThreadId = 'thread-2'
    await act(async () => parent.settle('cancel'))
    await waitFor(() => expect(parent.returned).toEqual([false]))

    expect(usePrompt.getState().prompt).toBe('')
    expect(bucket()).toEqual([])
    const entries = useFailedDrafts.getState().getDrafts(THREAD)
    expect(entries).toHaveLength(1)
    expect(entries[0].attachments).toEqual([doc, img])
  })
})

describe('real ChatInput + real queue store + production restoreQueueHead', () => {
  const queued = { id: 'queued-A', text: 'older message A', createdAt: 1 }

  beforeEach(() => {
    threadsState.currentThreadId = THREAD
    usePrompt.setState({ prompt: '', promptHistory: [], historyIndex: -1 })
    useChatAttachments.setState({ attachmentsByThread: {} })
    useMessageQueue.setState({ queues: {}, paused: {}, generations: {} })
    useFailedDrafts.setState({ drafts: {} })
  })

  // Route sequence for a pre-admission rejection of a dequeued head while the
  // SDK stayed 'ready': dequeue (queue now empty), sendMessage rejects, head put back.
  const rejectDequeuedHead = (latched: boolean) => {
    let token = 0
    let head: typeof queued
    act(() => {
      useMessageQueue.getState().enqueue(THREAD, queued)
      token = useMessageQueue.getState().getToken(THREAD)
      head = useMessageQueue.getState().dequeue(THREAD)!
    })
    expect(useMessageQueue.getState().getQueue(THREAD)).toEqual([])
    act(() => {
      restoreQueueHead(THREAD, head!, token, { status: 'ready', threadId: THREAD }, latched)
    })
  }

  it('latched pre-admission rejection while ready: head is held and a newer message C queues behind it, not sent', async () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    rejectDequeuedHead(true)
    expect(useMessageQueue.getState().isPaused(THREAD)).toBe(true)

    fireEvent.change(textarea(), { target: { value: 'newer message C' } })
    await send()

    await waitFor(() =>
      expect(useMessageQueue.getState().getQueue(THREAD).map((m) => m.text)).toEqual([
        'older message A',
        'newer message C',
      ])
    )
    expect(onSubmit).not.toHaveBeenCalled()
    expect(useMessageQueue.getState().isPaused(THREAD)).toBe(true)
    expect(textarea()).toHaveValue('')
  })

  it('negative control: without the latch the head is not held and C is sent directly ahead of A', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    rejectDequeuedHead(false)
    expect(useMessageQueue.getState().isPaused(THREAD)).toBe(false)

    fireEvent.change(textarea(), { target: { value: 'newer message C' } })
    await send()

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toBe('newer message C')
    expect(useMessageQueue.getState().getQueue(THREAD).map((m) => m.text)).toEqual(['older message A'])
  })
})
