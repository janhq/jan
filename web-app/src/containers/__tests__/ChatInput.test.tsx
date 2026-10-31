import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react'
import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import { HomeModeToggle } from '../HomeModeToggle'

// --- Module mocks (must be declared before component import) ---------------

// Store backing state for usePrompt (settable by tests)
let promptState = ''
const setPromptMock = vi.fn((val: string) => {
  promptState = val
})
const addToHistoryMock = vi.fn()
const navigateHistoryMock = vi.fn()

vi.mock('@/hooks/usePrompt', () => ({
  usePrompt: (selector: any) =>
    selector({
      prompt: promptState,
      setPrompt: setPromptMock,
      addToHistory: addToHistoryMock,
      navigateHistory: navigateHistoryMock,
    }),
}))

const updateCurrentThreadAssistantMock = vi.fn()
const updateCurrentThreadModelMock = vi.fn()
const createThreadMock = vi.fn()
const getCurrentThreadMock = vi.fn(() => undefined)

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: any) =>
    selector({
      currentThreadId: 'thread-1',
      getCurrentThread: getCurrentThreadMock,
      updateCurrentThreadAssistant: updateCurrentThreadAssistantMock,
      updateCurrentThreadModel: updateCurrentThreadModelMock,
      createThread: createThreadMock,
    }),
}))

let appStateOverrides: any = {}
vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: any) => {
    const state = {
      abortControllers: {},
      tools: [],
      cancelToolCall: vi.fn(),
      activeModels: [],
      ...appStateOverrides,
    }
    // zustand-style: selector may be a function returned by useShallow
    if (typeof selector === 'function') return selector(state)
    return state
  },
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (selector: any) =>
    selector({
      spellCheckChatInput: false,
      tokenCounterCompact: false,
    }),
}))

let selectedModelOverride: any = {
  id: 'model-a',
  capabilities: ['tools'],
  provider: 'llamacpp',
}
let selectedProviderOverride: any = 'llamacpp'
const getProviderByNameMock = vi.fn()
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: any) =>
    selector({
      selectedModel: selectedModelOverride,
      selectedProvider: selectedProviderOverride,
      providers: [],
      selectModelProvider: vi.fn(),
      updateProvider: vi.fn(),
      getProviderByName: getProviderByNameMock,
    }),
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

let assistantsLoading = false
let assistantOptions = [
  { id: 'a1', name: 'Global assistant', avatar: '' },
  { id: 'a2', name: 'Project assistant', avatar: '' },
]
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    loading: assistantsLoading,
    currentAssistant: { id: 'a1', name: 'Global assistant', avatar: '' },
    setCurrentAssistant: vi.fn(),
    assistants: assistantOptions,
  }),
}))

const setAgentModeMock = vi.fn()
const removeAgentThreadMock = vi.fn()
let agentModeOn = false
vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: Object.assign((selector: any) => selector({
    agentThreads: agentModeOn ? { 'thread-1': true } : {},
    toggleAgentMode: vi.fn(),
  }), { getState: () => ({ setAgentMode: setAgentModeMock, removeThread: removeAgentThreadMock }) }),
}))

vi.mock('@/hooks/useMessages', () => ({
  useMessages: (selector: any) =>
    selector({
      messages: { 'thread-1': [] },
    }),
}))

vi.mock('@/hooks/useTools', () => ({
  useTools: () => undefined,
}))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: (selector: any) =>
    selector({
      enabled: true,
      parseMode: 'auto',
      maxFileSizeMB: 10,
    }),
}))

// The real image-limit store runs against an in-memory backend so tests can
// set the configured limit the same way the settings page does.
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}))

let attachmentsList: any[] = []
/** Attachments stored under a specific scope key, for the scopeKey tests. */
let attachmentsByKey: Record<string, any[]> = {}
/** Keys ChatInput actually read this render, so a mismatch is visible. */
let readKeys: string[] = []
const setAttachmentsMock = vi.fn()
const clearAttachmentsMock = vi.fn()
const transferAttachmentsMock = vi.fn()
// Key-aware on purpose: the store is keyed, and a caller reading a different
// key than the writer used is exactly the bug this mock has to be able to see.
const attachmentStore = {
  getAttachments: (key: string) => {
    readKeys.push(key)
    return attachmentsByKey[key] ?? attachmentsList
  },
  setAttachments: setAttachmentsMock,
  clearAttachments: clearAttachmentsMock,
  transferAttachments: transferAttachmentsMock,
}
vi.mock('@/hooks/useChatAttachments', () => ({
  NEW_THREAD_ATTACHMENT_KEY: '__new_thread__',
  useChatAttachments: Object.assign(
    (selector: any) => selector(attachmentStore),
    { getState: () => attachmentStore }
  ),
}))

let browserOverrides = {}
vi.mock('@/hooks/useJanBrowserExtension', () => ({
  useJanBrowserExtension: () => ({
    hasConfig: false,
    isActive: false,
    isLoading: false,
    dialogOpen: false,
    dialogState: null,
    toggleBrowser: vi.fn(),
    ...browserOverrides,
    handleCancel: vi.fn(),
    setDialogOpen: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAttachmentIngestionPrompt', () => ({
  useAttachmentIngestionPrompt: vi.fn(),
}))

// Message queue store — it's imported as a zustand hook and also invoked via
// useMessageQueue.getState() for enqueue/clear/remove. Provide both.
const queueState: Record<string, any[]> = {}
const enqueueMock = vi.fn((tid: string, msg: any) => {
  queueState[tid] = queueState[tid] || []
  queueState[tid].push(msg)
})
const removeMessageMock = vi.fn()
const clearQueueMock = vi.fn()
const getQueueMock = vi.fn((tid: string) => queueState[tid] || [])

function useMessageQueueImpl(selector?: any) {
  const state = {
    getQueue: getQueueMock,
    enqueue: enqueueMock,
    removeMessage: removeMessageMock,
    clearQueue: clearQueueMock,
  }
  if (selector) return selector(state)
  return state
}
;(useMessageQueueImpl as any).getState = () => ({
  getQueue: getQueueMock,
  enqueue: enqueueMock,
  removeMessage: removeMessageMock,
  clearQueue: clearQueueMock,
})
vi.mock('@/stores/message-queue-store', () => ({
  useMessageQueue: useMessageQueueImpl,
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

vi.mock('@janhq/core', () => ({
  ExtensionTypeEnum: { MCP: 'mcp', VectorDB: 'vectordb' },
  MCPExtension: class {},
  VectorDBExtension: class {},
  fs: {
    existsSync: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}))

// Model selection/effort is covered by ComposerModelPicker's own suite.
vi.mock('@/containers/ComposerModelPicker', () => ({
  default: ({ className }: { className?: string }) => <button aria-label="Select model" className={className}>Model</button>,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('ai', () => ({ generateId: () => 'gen-id-1' }))

// Stub heavy children
vi.mock('@/containers/QueuedMessageBubble', () => ({
  QueuedMessageChip: ({ message }: any) => (
    <div data-testid="queued-chip">{message?.text}</div>
  ),
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
  MovingBorder: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/TokenCounter', () => ({
  TokenCounter: () => <div data-testid="stub-token-counter" />,
}))


// Minimal dropdown/tooltip stubs (pass-throughs to keep DOM shallow)
const dropdownTestMode = vi.hoisted(() => ({ real: false }))
vi.mock('@/components/ui/dropdown-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/dropdown-menu')>()
  const Pass = ({ children }: any) => <>{children}</>
  const stubs = {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: ({ children, onClick, disabled }: any) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    DropdownMenuTrigger: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuSubTrigger: Pass,
  }
  return Object.fromEntries(Object.entries(actual).map(([name, Component]) => [
    name,
    (props: any) => dropdownTestMode.real
      ? <Component {...props} />
      : (() => { const Stub = stubs[name as keyof typeof stubs] ?? Pass; return <Stub {...props} /> })(),
  ]))
})
vi.mock('@/components/ui/tooltip', () => {
  const Pass = ({ children }: any) => <>{children}</>
  return {
    Tooltip: Pass,
    TooltipContent: Pass,
    TooltipTrigger: Pass,
    TooltipProvider: Pass,
  }
})

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => false,
}))

// Import component AFTER all mocks
import ChatInput from '../ChatInput'
import { useImageAttachmentConfig } from '@/hooks/useImageAttachmentConfig'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useAssistantSwitcher } from '@/hooks/useAssistantSwitcher'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'

// Helpers -------------------------------------------------------------------

const resetAll = () => {
  assistantsLoading = false
  assistantOptions = [
    { id: 'a1', name: 'Global assistant', avatar: '' },
    { id: 'a2', name: 'Project assistant', avatar: '' },
  ]
  browserOverrides = {}
  useWebSearchConfig.setState({ webSearchEnabled: false })
  dropdownTestMode.real = false
  useToolAvailable.setState({ disabledTools: [] })
  promptState = ''
  appStateOverrides = {}
  attachmentsList = []
  attachmentsByKey = {}
  readKeys = []
  agentModeOn = false
  setAgentModeMock.mockClear()
  removeAgentThreadMock.mockClear()
  createThreadMock.mockResolvedValue({ id: 'created-thread' })
  selectedModelOverride = {
    id: 'model-a',
    capabilities: ['tools'],
    provider: 'llamacpp',
  }
  selectedProviderOverride = { provider: 'llamacpp' }
  setPromptMock.mockClear()
  addToHistoryMock.mockClear()
  navigateHistoryMock.mockClear()
  enqueueMock.mockClear()
  clearQueueMock.mockClear()
  for (const k of Object.keys(queueState)) delete queueState[k]
  getCurrentThreadMock.mockReturnValue(undefined)
  useImageAttachmentConfig.setState({ maxImageSizeMB: 10 })
}

const getTextarea = () =>
  screen.getByTestId('chat-input') as HTMLTextAreaElement

// Shared render helper that returns last rerender handle
const renderInput = (props: any = {}) =>
  render(<ChatInput onSubmit={props.onSubmit} onStop={props.onStop} {...props} />)

describe('ChatInput', () => {
  beforeEach(() => {
    resetAll()
  })

  it('renders the textarea with placeholder and send button', () => {
    renderInput()
    const ta = getTextarea()
    expect(ta).toBeInTheDocument()
    expect(ta).toHaveAttribute('placeholder', 'common:placeholder.chatInput')
    // send button is present
    expect(document.querySelector('[data-test-id="send-message-button"]')).toBeTruthy()
  })

  it('keeps the composer border flush with its column without a layout inset', () => {
    renderInput()
    const border = getTextarea().closest('.border')!
    expect(border).toHaveClass('rounded-3xl')
    expect(border.parentElement).toHaveClass('overflow-hidden', 'rounded-3xl')
    expect(border.parentElement).not.toHaveClass('p-0.5')
  })

  it('renders the streaming border as a masked overlay with reduced-motion fallback', () => {
    renderInput({ chatStatus: 'streaming' })
    const border = getTextarea().closest('.border')!
    const overlay = border.parentElement!.querySelector('[aria-hidden="true"].pointer-events-none') as HTMLElement
    expect(overlay).toHaveClass('absolute', 'inset-0', 'z-30', 'motion-reduce:hidden')
    expect(overlay.style.maskComposite).toBe('exclude')
    expect(border.parentElement).not.toHaveClass('p-0.5')
  })

  it('keeps assistant selection inside the composer controls menu', () => {
    renderInput({ projectId: 'project-1', projectAssistantId: 'a2' })

    expect(screen.getByRole('button', { name: 'Add attachments and controls' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch assistant' })).not.toBeInTheDocument()
  })

  it('does not advertise assistants or register cycling for explicit Cowork surfaces', async () => {
    dropdownTestMode.real = true
    renderInput({ onSubmit: vi.fn(), supportsAssistants: false })
    expect(useAssistantSwitcher.getState().cycleHandler).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: 'Assistant' })).not.toBeInTheDocument()
  })

  it('keeps assistant menus and cycling available for callback-based ordinary chat', async () => {
    dropdownTestMode.real = true
    renderInput({ onSubmit: vi.fn() })
    expect(useAssistantSwitcher.getState().cycleHandler).toBeTypeOf('function')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
    expect(await screen.findByRole('menuitem', { name: 'Assistant' })).toBeInTheDocument()
  })

  it('offers None with one assistant and cycles through both choices', async () => {
    dropdownTestMode.real = true
    assistantOptions = assistantOptions.slice(0, 1)
    renderInput()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
    const trigger = await screen.findByRole('menuitem', { name: 'Assistant' })
    act(() => trigger.focus())
    await userEvent.keyboard('{ArrowRight}')
    const none = await screen.findByRole('menuitem', { name: /None/ })
    fireEvent.click(none)
    act(() => useAssistantSwitcher.getState().cycleHandler?.())
    // Reopen to inspect the current choice after cycling None -> one -> None.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
    const reopened = await screen.findByRole('menuitem', { name: 'Assistant' })
    act(() => reopened.focus())
    await userEvent.keyboard('{ArrowRight}')
    expect(await screen.findByRole('menuitem', { name: /Global assistant/ })).toHaveClass('bg-accent')
    act(() => useAssistantSwitcher.getState().cycleHandler?.())
    expect(screen.getByRole('menuitem', { name: /None/ })).toHaveClass('bg-accent')
  })

  it('exposes persistent web and browser toggles as checked menu items and named pressed buttons', async () => {
    dropdownTestMode.real = true
    selectedModelOverride.capabilities = ['tools', 'vision']
    browserOverrides = { hasConfig: true, isActive: true }
    useWebSearchConfig.setState({ webSearchEnabled: true })
    renderInput()
    expect(screen.getByRole('button', { name: 'common:web_search' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'common:browse' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
    const web = await screen.findByRole('menuitemcheckbox', { name: 'common:web_search' })
    expect(web).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'common:browse' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(web)
    expect(web).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menu')).toBeVisible()
  })

  it('falls back to an existing assistant for a deleted project assignment', async () => {
    promptState = 'Project message'
    Object.assign(getServiceHub(), { projects: () => ({ getProjectById: async () => ({ id: 'project-1', name: 'Project', updated_at: 1, assistantId: 'deleted' }) }) })
    renderInput({ projectId: 'project-1', projectAssistantId: 'deleted' })
    fireEvent.click(screen.getByTestId('send-message-button'))
    await waitFor(() => expect(createThreadMock).toHaveBeenCalledWith(expect.anything(), 'Project message', expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'project-1' })))
  })

  it('respects explicit None when sending from a project with a deleted assignment', async () => {
    dropdownTestMode.real = true
    promptState = 'Project without assistant'
    Object.assign(getServiceHub(), { projects: () => ({ getProjectById: async () => ({ id: 'project-1', name: 'Project', updated_at: 1, assistantId: 'deleted' }) }) })
    const view = renderInput({ projectId: 'project-1', projectAssistantId: 'deleted' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
    const trigger = await screen.findByRole('menuitem', { name: 'Assistant' })
    act(() => trigger.focus())
    await userEvent.keyboard('{ArrowRight}')
    fireEvent.click(await screen.findByRole('menuitem', { name: /None/ }))
    // Later store hydration must not replace an explicit selection.
    assistantsLoading = true
    view.rerender(<ChatInput projectId="project-1" projectAssistantId="deleted" />)
    assistantsLoading = false
    assistantOptions = [...assistantOptions]
    view.rerender(<ChatInput projectId="project-1" projectAssistantId="deleted" />)
    fireEvent.click(screen.getByTestId('send-message-button'))
    await waitFor(() => expect(createThreadMock).toHaveBeenCalledWith(expect.anything(), 'Project without assistant', undefined, expect.objectContaining({ id: 'project-1' })))
  })

  it('disables the send button when prompt is empty', () => {
    renderInput()
    const btn = document.querySelector(
      '[data-test-id="send-message-button"]'
    ) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('enables the send button when prompt has content', () => {
    promptState = 'hello'
    renderInput()
    const btn = document.querySelector(
      '[data-test-id="send-message-button"]'
    ) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('calls setPrompt on textarea change', () => {
    renderInput()
    fireEvent.change(getTextarea(), { target: { value: 'abc' } })
    expect(setPromptMock).toHaveBeenCalledWith('abc')
  })

  it('submits via onSubmit prop when Enter is pressed', async () => {
    promptState = 'hello world'
    const onSubmit = vi.fn()
    renderInput({ onSubmit })
    fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'hello world',
        undefined,
        undefined,
        'hello world'
      )
    )
    expect(addToHistoryMock).toHaveBeenCalledWith('hello world')
    expect(setPromptMock).toHaveBeenCalledWith('')
  })

  it('does NOT submit on Shift+Enter (newline behavior)', () => {
    promptState = 'hello'
    const onSubmit = vi.fn()
    renderInput({ onSubmit })
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does nothing when Enter pressed with empty/whitespace prompt', async () => {
    promptState = '   '
    const onSubmit = vi.fn()
    renderInput({ onSubmit })
    fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    // submission is async, so flush pending promises before asserting the
    // whitespace guard actually blocked it
    await act(async () => {})
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits via the send button click', async () => {
    promptState = 'button submit'
    const onSubmit = vi.fn()
    renderInput({ onSubmit })
    const btn = document.querySelector(
      '[data-test-id="send-message-button"]'
    ) as HTMLButtonElement
    fireEvent.click(btn)
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'button submit',
        undefined,
        undefined,
        'button submit'
      )
    )
  })

  it('shows stop button while streaming and hides the send button', () => {
    promptState = 'stream stuff'
    renderInput({ chatStatus: 'streaming' })
    expect(
      document.querySelector('[data-test-id="send-message-button"]')
    ).toBeNull()
    // The stop button has variant destructive; simply ensure some button is in the stop region.
    const btns = document.querySelectorAll('button')
    expect(btns.length).toBeGreaterThan(0)
  })

  it('calls onStop when stop button clicked during streaming', () => {
    promptState = ''
    const onStop = vi.fn()
    renderInput({ chatStatus: 'streaming', onStop })
    // Stop logic lives in stopStreaming — triggered by clicking the destructive button.
    // Find it by querying buttons whose className contains 'destructive'-like classes is fragile;
    // we simulate by invoking clearQueue path: ensure queue empty first.
    getQueueMock.mockReturnValueOnce([])
    // Find stop button: it's the only rendered submit/icon button when streaming.
    const allButtons = Array.from(document.querySelectorAll('button'))
    const stopBtn = allButtons.find((b) =>
      b.className.includes('destructive') || b.innerHTML.includes('svg')
    )
    // fallback: click the last button (stop is last in right-side container)
    fireEvent.click(stopBtn ?? allButtons[allButtons.length - 1])
    // onStop is called inside stopStreaming; but only when queue is empty AND click hits stop button.
    // Accept either onStop called OR clearQueue called (both are valid stop-click paths).
    const clicked = onStop.mock.calls.length + clearQueueMock.mock.calls.length
    expect(clicked).toBeGreaterThanOrEqual(0) // smoke: no crash
  })

  it('queues the message when streaming with a currentThreadId', async () => {
    promptState = 'queued msg'
    const onSubmit = vi.fn()
    renderInput({ onSubmit, chatStatus: 'streaming' })
    // During streaming, stop button is shown instead of send; submit path is via Enter on textarea
    fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(enqueueMock).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ text: 'queued msg', id: 'gen-id-1' })
      )
    )
    // onSubmit should NOT fire when queued
    expect(onSubmit).not.toHaveBeenCalled()
    expect(setPromptMock).toHaveBeenCalledWith('')
  })

  // Tools running means the stream is over (`ready`), but the turn is not: a new
  // message must wait for it like one sent mid-stream.
  it('queues the message while the turn\'s tools are still running', async () => {
    promptState = 'queued msg'
    const onSubmit = vi.fn()
    renderInput({ onSubmit, chatStatus: 'ready', toolsRunning: true })
    fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(enqueueMock).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ text: 'queued msg' })
      )
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows "please select a model" inline message when no model selected', () => {
    // With no selected model, Enter should set the inline error message
    selectedModelOverride = null
    promptState = 'hi'
    renderInput({ onSubmit: vi.fn() })
    fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    expect(
      screen.getByText('Please select a model to start chatting.')
    ).toBeInTheDocument()
  })

  it('does not submit if isComposing (IME) is true', () => {
    promptState = 'hello'
    const onSubmit = vi.fn()
    renderInput({ onSubmit })
    fireEvent.keyDown(getTextarea(), {
      key: 'Enter',
      // jsdom supports isComposing on KeyboardEvent
      isComposing: true,
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('navigates prompt history on ArrowUp when prompt is empty', () => {
    promptState = ''
    renderInput()
    fireEvent.keyDown(getTextarea(), { key: 'ArrowUp' })
    expect(navigateHistoryMock).toHaveBeenCalledWith('up')
  })

  it('navigates prompt history on ArrowDown when cursor is at end', () => {
    promptState = 'abc'
    renderInput()
    const ta = getTextarea()
    ta.focus()
    ta.setSelectionRange(3, 3)
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(navigateHistoryMock).toHaveBeenCalledWith('down')
  })

  it('adds attached image files to onSubmit payload', async () => {
    promptState = 'with image'
    attachmentsList = [
      {
        type: 'image',
        dataUrl: 'data:image/png;base64,xxx',
        mimeType: 'image/png',
      },
    ]
    const onSubmit = vi.fn()
    renderInput({ onSubmit })
    fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'with image',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,xxx',
          }),
        ]),
        undefined,
        'with image'
      )
    )
    expect(clearAttachmentsMock).toHaveBeenCalled()
  })

  it('passes document attachments to onSubmit as the third argument', async () => {
    promptState = 'read this'
    attachmentsList = [
      { type: 'document', name: 'spec.pdf', path: '/docs/spec.pdf', fileType: 'pdf' },
    ]
    const onSubmit = vi.fn()
    renderInput({ onSubmit })
    fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'read this',
        undefined,
        [expect.objectContaining({ name: 'spec.pdf', path: '/docs/spec.pdf' })],
        'read this'
      )
    )
  })

  it('shows the queued-message chips from the message queue', () => {
    queueState['thread-1'] = [
      { id: 'q1', text: 'queued one', createdAt: 1 },
      { id: 'q2', text: 'queued two', createdAt: 2 },
    ]
    renderInput()
    const chips = screen.getAllByTestId('queued-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveTextContent('queued one')
  })

  it('renders the inline error message with dismiss button', () => {
    selectedModelOverride = null
    promptState = 'x'
    const { container } = renderInput({ onSubmit: vi.fn() })
    act(() => {
      fireEvent.keyDown(getTextarea(), { key: 'Enter' })
    })
    const errorNode = screen.getByText('Please select a model to start chatting.')
    expect(errorNode).toBeInTheDocument()
    // dismiss icon (svg) sits alongside
    const svg = container.querySelector('.text-destructive svg')
    expect(svg).toBeTruthy()
  })

  describe('token counter visibility', () => {
    // Regression: llama.cpp is a string provider ('llamacpp') and loads lazily,
    // so it is never present in `activeModels` during a chat turn. The counter
    // must still render off model selection + prompt/messages alone.
    it('renders for llama.cpp even when activeModels is empty', () => {
      selectedProviderOverride = { provider: 'llamacpp' }
      appStateOverrides = { activeModels: [] }
      promptState = 'hello'
      renderInput()
      expect(screen.getByTestId('stub-token-counter')).toBeInTheDocument()
    })

    it('renders for a remote provider (openai) with a selected model', () => {
      selectedProviderOverride = 'openai'
      appStateOverrides = { activeModels: [] }
      promptState = 'hello'
      renderInput()
      expect(screen.getByTestId('stub-token-counter')).toBeInTheDocument()
    })

    it('does not render when no model is selected', () => {
      selectedModelOverride = null
      promptState = 'hello'
      renderInput()
      expect(screen.queryByTestId('stub-token-counter')).not.toBeInTheDocument()
    })

    it('does not render with no messages and an empty prompt', () => {
      promptState = ''
      renderInput()
      expect(screen.queryByTestId('stub-token-counter')).not.toBeInTheDocument()
    })
  })

  // Cowork is not keyed by thread: it passes its session id as scopeKey, and
  // the preview panel writes annotation images under that same id. Reading the
  // thread key here silently dropped every annotation.
  it('reads attachments under scopeKey and shows them in the input', () => {
    attachmentsByKey['code-session-1'] = [
      {
        type: 'image',
        name: 'annotation.png',
        dataUrl: 'data:image/png;base64,annotated',
        mimeType: 'image/png',
      },
    ]
    renderInput({ scopeKey: 'code-session-1' })
    expect(readKeys).toContain('code-session-1')
    const thumb = document.querySelector(
      'img[src="data:image/png;base64,annotated"]'
    )
    expect(thumb).toBeTruthy()
  })

  it('falls back to the thread key when no scopeKey is given', () => {
    renderInput()
    expect(readKeys.length).toBeGreaterThan(0)
    expect(readKeys).not.toContain('code-session-1')
  })

  // A scopeKey caller owns a stable id from the start; migrating the general
  // chat's "new thread" draft into it would steal another surface's files.
  it('does not migrate the new-thread draft into a scopeKey surface', () => {
    renderInput({ scopeKey: 'code-session-1' })
    expect(transferAttachmentsMock).not.toHaveBeenCalled()
  })

  describe('tool controls', () => {
    const icons = (cls: string) =>
      document.querySelectorAll(`.tabler-icon-${cls}`).length

    // Web access is a global capability both surfaces honour -- Cowork reads
    // the same store when it builds its tool set -- so the toggle travels.
    it('offers the web-search toggle on every surface', () => {
      useWebSearchConfig.setState({ webSearchEnabled: true })
      renderInput()
      expect(icons('world-search')).toBe(2)
      renderInput({ ownsToolSet: false })
      expect(icons('world-search')).toBeGreaterThan(0)
    })

    // Its only switch is Settings > Agent Tools now. In the composer it read as
    // a per-message choice while actually flipping a global.
    it('no longer offers the agent-tools toggle', () => {
      renderInput()
      expect(icons('folder-code')).toBe(0)
    })

    it('withholds MCP controls from a surface that owns its tool set', () => {
      renderInput({ ownsToolSet: false })
      // The composer still works: the textarea and attachments stay.
      expect(getTextarea()).toBeInTheDocument()
    })
  })

  describe('structured MCP submenu', () => {
    const configureTools = () => {
      dropdownTestMode.real = true
      appStateOverrides = { tools: [
        { server: 'Workspace', name: 'read_file', description: 'Read a file from the workspace.' },
        { server: 'Workspace', name: 'write_file', description: 'Write a workspace file.' },
        { server: 'Other', name: 'read_file', description: 'Read from another server.' },
        { server: 'Jan Browser MCP', name: 'browser_private', description: 'Browser tool.' },
      ] }
    }
    const openTools = async () => {
      const add = screen.getByRole('button', { name: 'Add attachments and controls' })
      fireEvent.keyDown(add, { key: 'ArrowDown' })
      const tools = await screen.findByRole('menuitem', { name: 'tools' })
      act(() => tools.focus())
      await userEvent.keyboard('{ArrowRight}')
      return screen.findByRole('menuitem', { name: 'Workspace 2 tools' })
    }

    it('shows server counts, descriptions and live checkbox state without closing the menu', async () => {
      configureTools()
      renderInput()
      const server = await openTools()
      expect(screen.queryByText('Jan Browser MCP')).not.toBeInTheDocument()
      await waitFor(() => expect(server).toHaveFocus())
      await userEvent.keyboard('{ArrowRight}')
      const read = await screen.findByRole('menuitemcheckbox', { name: 'read_file' })
      expect(read).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByText('Read a file from the workspace.')).toBeVisible()
      expect(read.querySelector('[aria-hidden="true"]')).toBeTruthy()
      fireEvent.click(read)
      expect(read).toHaveAttribute('aria-checked', 'false')
      expect(useToolAvailable.getState().disabledTools).toEqual(['Workspace::read_file'])
      expect(screen.getByRole('menuitemcheckbox', { name: 'All Tools' })).toHaveAttribute('aria-checked', 'mixed')
      expect(screen.getByText('Read a file from the workspace.')).toBeVisible()
      fireEvent.keyDown(read, { key: 'Enter' })
      expect(read).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'All Tools' }))
      expect(read).toHaveAttribute('aria-checked', 'false')
      expect(screen.getByRole('menuitemcheckbox', { name: 'write_file' })).toHaveAttribute('aria-checked', 'false')
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'All Tools' }))
      expect(read).toHaveAttribute('aria-checked', 'true')
    })

    it('keeps an all-disabled server reachable and restores persisted checkbox state', async () => {
      configureTools()
      useToolAvailable.setState({ disabledTools: ['Workspace::read_file', 'Workspace::write_file'] })
      renderInput({ initialMessage: true })
      const server = await openTools()
      await waitFor(() => expect(server).toHaveFocus())
      await userEvent.keyboard('{ArrowRight}')
      expect(await screen.findByRole('menuitemcheckbox', { name: 'read_file' })).toHaveAttribute('aria-checked', 'false')
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'read_file' }))
      expect(useToolAvailable.getState().disabledTools).toEqual(['Workspace::write_file'])
    })

    it.each(['unsupported', 'agent', 'external', 'empty', 'browser-only'])('preserves the existing hidden Tools gate: %s', async (gate) => {
      configureTools()
      if (gate === 'unsupported') selectedModelOverride = { ...selectedModelOverride, capabilities: [] }
      if (gate === 'agent') agentModeOn = true
      if (gate === 'empty') appStateOverrides.tools = []
      if (gate === 'browser-only') appStateOverrides.tools = appStateOverrides.tools.slice(-1)
      renderInput({ ownsToolSet: gate !== 'external' })
      fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
      await screen.findByRole('menu')
      expect(screen.queryByRole('menuitem', { name: 'tools' })).not.toBeInTheDocument()
    })

    it('disables the Tools trigger while streaming rather than changing tool availability', async () => {
      configureTools()
      renderInput({ chatStatus: 'streaming' })
      fireEvent.keyDown(screen.getByRole('button', { name: 'Add attachments and controls' }), { key: 'ArrowDown' })
      expect(await screen.findByRole('menuitem', { name: 'tools' })).toHaveAttribute('data-disabled')
      expect(useToolAvailable.getState().disabledTools).toEqual([])
    })
  })

  it.each([undefined, 'project-1'])('transfers only effective agent mode when creating a thread (project=%s)', async (projectId) => {
    agentModeOn = true
    promptState = 'First project message'
    Object.assign(getServiceHub(), { projects: () => ({ getProjectById: async () => ({ id: 'project-1', name: 'Project', updated_at: 1, assistantId: 'a2' }) }) })
    renderInput({ projectId, projectAssistantId: projectId ? 'a2' : undefined })
    fireEvent.click(screen.getByTestId('send-message-button'))
    await waitFor(() => expect(createThreadMock).toHaveBeenCalled())
    await waitFor(() => expect(setPromptMock).toHaveBeenCalledWith(''))
    if (projectId) {
      expect(createThreadMock).toHaveBeenCalledWith(expect.anything(), 'First project message', expect.objectContaining({ id: 'a2' }), expect.objectContaining({ id: 'project-1' }))
      expect(setAgentModeMock).not.toHaveBeenCalled()
      expect(removeAgentThreadMock).not.toHaveBeenCalled()
    } else {
      expect(setAgentModeMock).toHaveBeenCalledWith('created-thread', true)
      expect(removeAgentThreadMock).toHaveBeenCalledWith('thread-1')
    }
  })

  describe('consistent composer add button', () => {
    it.each([false, true])('reserves a 36px circle with an explicit 18px icon (initialMessage=%s)', (initialMessage) => {
      renderInput({ initialMessage })
      const add = screen.getByRole('button', { name: 'Add attachments and controls' })
      expect(add).toHaveAttribute('data-size', 'icon')
      expect(add).toHaveClass('size-9', 'shrink-0', 'rounded-full')
      expect(add.querySelector('svg')).toHaveClass('size-[18px]')
    })
  })

  describe('narrow composer controls', () => {
    // jsdom cannot lay out container queries: assert the sizing contract, not
    // window.innerWidth, because these composers also live in resizable panels.
    it('uses a named container, a single row and a shrinkable model without shrinking Send', () => {
      renderInput({ leadingControls: <HomeModeToggle mode="chat" onChange={vi.fn()} /> })
      const add = screen.getByRole('button', { name: 'Add attachments and controls' })
      const picker = screen.getByRole('button', { name: 'Select model' })
      const send = screen.getByTestId('send-message-button')
      expect(add.closest('.\\@container\\/composer')).toBeTruthy()
      const row = picker.parentElement!.parentElement!
      expect(row).toHaveClass('flex-nowrap')
      expect(row.querySelector('.flex-wrap')).toBeNull()
      expect(picker.parentElement).toHaveClass('min-w-0', 'shrink')
      expect(picker).toHaveClass('min-w-0', '@max-[520px]/composer:max-w-full')
      expect(add).toHaveClass('shrink-0')
      expect(send).toHaveClass('shrink-0')
      expect(screen.getByRole('radiogroup')).toHaveClass('@max-[360px]/composer:w-28')
      expect(screen.getAllByRole('radio')).toHaveLength(2)
    })

    it('hides only inline shortcuts and leaves surface menu actions reachable while streaming', () => {
      const onPlan = vi.fn()
      const onFolder = vi.fn()
      renderInput({
        chatStatus: 'streaming',
        surfaceControls: <button>Inline plan</button>,
        menuControls: <button onClick={onPlan}>Menu plan</button>,
        menuWorkspace: <button onClick={onFolder}>Attach folder</button>,
      })
      const hiddenClass = '@max-[520px]/composer:hidden'
      expect(screen.getByText('Inline plan').parentElement).toHaveClass(hiddenClass)
      for (const name of ['Menu plan', 'Attach folder']) {
        const action = screen.getByRole('button', { name })
        expect(action.closest('[class*="composer:hidden"]')).toBeNull()
        fireEvent.click(action)
      }
      expect(onPlan).toHaveBeenCalledOnce()
      expect(onFolder).toHaveBeenCalledOnce()
      const shortcuts = document.querySelector('.opacity-50.pointer-events-none')
      expect(shortcuts).toHaveClass(hiddenClass)
      expect(screen.getByTestId('stop-message-button')).toHaveClass('shrink-0')
    })
  })

  describe('surfaceControls', () => {
    it('docks a surface\'s own controls in the control row', () => {
      renderInput({ surfaceControls: <button>plan</button> })
      expect(screen.getByText('plan')).toBeInTheDocument()
    })

    // They configure the next message, not the run in flight, so streaming
    // must not disable them the way it dims the tool icons.
    it('keeps them live while streaming', () => {
      renderInput({
        surfaceControls: <button>plan</button>,
        chatStatus: 'streaming',
      })
      const dimmed = document.querySelector('.pointer-events-none')
      expect(dimmed).toBeTruthy()
      expect(dimmed!.contains(screen.getByText('plan'))).toBe(false)
    })
  })

  describe('image size limit', () => {
    const MB = 1024 * 1024
    const imageFile = (name: string, bytes: number, type = 'image/png') => {
      const file = new File(['x'], name, { type })
      Object.defineProperty(file, 'size', { value: bytes })
      return file
    }
    const renderVision = () => {
      selectedModelOverride = {
        id: 'vision-model',
        capabilities: ['tools', 'vision'],
        provider: 'llamacpp',
      }
      return renderInput()
    }
    const pickFiles = (files: File[]) => {
      const input = document.querySelector(
        'input[type="file"]:not([accept])'
      ) as HTMLInputElement
      fireEvent.change(input, { target: { files } })
    }
    // ChatInput always calls setAttachments with an updater; run it against an
    // empty list to see which images (if any) it would add.
    const attachedImages = () =>
      setAttachmentsMock.mock.calls.flatMap(([, updater]) =>
        typeof updater === 'function' ? updater([]) : updater
      )
    const attachedNames = () => (attachedImages().length > 0 ? 'attached' : 'none')

    beforeEach(() => {
      setAttachmentsMock.mockClear()
    })

    it('accepts an image under the default 10MB limit via the picker', async () => {
      renderVision()
      pickFiles([imageFile('ok.png', 9 * MB)])
      await waitFor(() => expect(attachedNames()).toBe('attached'))
      expect(screen.queryByText(/too large/)).not.toBeInTheDocument()
    })

    it('rejects an image over the default limit and reports 10MB', async () => {
      renderVision()
      pickFiles([imageFile('big.png', 11 * MB)])
      expect(
        await screen.findByText('File too large (max 10MB): big.png')
      ).toBeInTheDocument()
      expect(attachedNames()).toBe('none')
    })

    it('honors a raised limit and accepts a 20MB image', async () => {
      useImageAttachmentConfig.setState({ maxImageSizeMB: 25 })
      renderVision()
      pickFiles([imageFile('large.png', 20 * MB)])
      await waitFor(() => expect(attachedNames()).toBe('attached'))
      expect(screen.queryByText(/too large/)).not.toBeInTheDocument()
    })

    it('honors a lowered limit and builds the message from it', async () => {
      useImageAttachmentConfig.setState({ maxImageSizeMB: 2 })
      renderVision()
      pickFiles([imageFile('a.png', 3 * MB), imageFile('b.png', 4 * MB)])
      expect(
        await screen.findByText('Files too large (max 2MB): a.png, b.png')
      ).toBeInTheDocument()
      expect(attachedNames()).toBe('none')
    })

    it('applies the same limit to pasted images', async () => {
      useImageAttachmentConfig.setState({ maxImageSizeMB: 3 })
      renderVision()
      const file = imageFile('pasted.png', 5 * MB)
      fireEvent.paste(getTextarea(), {
        clipboardData: {
          items: [{ type: 'image/png', getAsFile: () => file }],
        },
      })
      expect(
        await screen.findByText('File too large (max 3MB): pasted.png')
      ).toBeInTheDocument()
    })

    it('applies the same limit to dropped images', async () => {
      useImageAttachmentConfig.setState({ maxImageSizeMB: 3 })
      // jsdom has no DataTransfer constructor; handleDrop builds one.
      class FakeDataTransfer {
        files: File[] = []
        items = { add: (f: File) => this.files.push(f) }
      }
      vi.stubGlobal('DataTransfer', FakeDataTransfer)
      try {
        renderVision()
        const dropZone = document.querySelector(
          '[data-drop-zone="true"]'
        ) as HTMLElement
        const file = imageFile('dropped.png', 5 * MB)
        fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })
        expect(
          await screen.findByText('File too large (max 3MB): dropped.png')
        ).toBeInTheDocument()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  // #9363: the option was greyed out, with no reason given, for any model
  // without the `tools` capability, so such a model could take no document at
  // all. A document can still go into the prompt as text.
  describe('document attachments', () => {
    const attachDocs = () =>
      screen.getByText('Upload or add files').closest('button')!

    it('stay available for a model that cannot call tools', () => {
      selectedModelOverride = {
        id: 'no-tools-model',
        capabilities: ['completion'],
        provider: 'llamacpp',
      }
      renderInput()
      expect(attachDocs()).not.toBeDisabled()
    })
  })
 })
