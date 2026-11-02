import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const { persist, updateThread } = vi.hoisted(() => ({
  persist: vi.fn(),
  updateThread: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    threads: () => ({
      setConversationCapabilities: persist,
      updateThread,
      deleteThread: vi.fn(),
    }),
  }),
}))
vi.mock('@/lib/agentTools', () => ({
  cleanupThreadWorkspace: vi.fn(),
  cancelAgentThreadBash: vi.fn(),
  stopAgentSessionMonitors: vi.fn(),
}))
vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: { getState: () => ({ removeThread: vi.fn() }) },
}))
vi.mock('@/stores/chat-session-store', () => ({
  useChatSessions: { getState: () => ({ removeSession: vi.fn() }) },
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: { getState: () => ({ clearThreadState: vi.fn() }) },
}))
vi.mock('@/hooks/useCoworkSessions', () => ({ useCoworkSessions: {} }))
vi.mock('@/hooks/useCoworkRun', () => ({ useCoworkRun: {} }))
vi.mock('@/lib/coworkRunner', () => ({ abortRun: vi.fn() }))
vi.mock('@/lib/coworkMonitor', () => ({ dropMonitorLane: vi.fn() }))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => undefined }) },
}))
vi.mock('@janhq/core', () => ({
  ExtensionTypeEnum: {},
  VectorDBExtension: class {},
  EngineManager: { instance: () => ({ get: () => undefined }) },
}))

import { useThreads } from '@/hooks/useThreads'
import { ConversationScopeControl } from '../ConversationScopeControl'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

function thread(id: string, metadata: Thread['metadata'] = {}): Thread {
  return { id, title: 'Conversation', assistants: [], updated: 123, metadata }
}

const elevated = {
  version: 1,
  folderScope: { path: '/workspace/project', access: 'write' },
  shellNetwork: true,
  memoryWrite: true,
} as const

// Unique thread id per test: the process-local effective overlay inside
// useThreads is module state and would otherwise leak between tests.
let seq = 0
const freshId = () => `chat-${++seq}`

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mount = (id: string, pickFolder = vi.fn(async () => null)) =>
  render(<ConversationScopeControl threadId={id} pickFolder={pickFolder} />)

const SHELL_LABEL = 'Allow shell commands to access the network'
const L1_COPY = /Turning a permission off applies from the next tool call/

describe('ConversationScopeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persist.mockResolvedValue(undefined)
    useThreads.setState({ threads: {}, currentThreadId: null, searchIndex: null })
  })

  it('renders nothing for missing, temporary, and Cowork threads', () => {
    const temp = thread(TEMPORARY_CHAT_ID)
    const cowork = thread('cowork-1', { mode: 'cowork' })
    useThreads.setState({ threads: { [temp.id]: temp, [cowork.id]: cowork } })
    const { container: missing } = mount('nonexistent')
    expect(missing).toBeEmptyDOMElement()
    const { container: temporary } = mount(TEMPORARY_CHAT_ID)
    expect(temporary).toBeEmptyDOMElement()
    const { container: session } = mount('cowork-1')
    expect(session).toBeEmptyDOMElement()
  })

  it('shows the denied default scope and the next-dispatch revocation copy', () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    mount(id)
    expect(screen.getByText('No folder access selected.')).toBeInTheDocument()
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
    expect(screen.getByText(L1_COPY)).toBeInTheDocument()
    expect(screen.queryByTestId('scope-reconfirm')).not.toBeInTheDocument()
  })

  it('persists a change through the strict setter and reflects it once saved', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    mount(id)
    fireEvent.click(screen.getByLabelText(SHELL_LABEL))
    await waitFor(() => expect(screen.getByLabelText(SHELL_LABEL)).toBeChecked())
    expect(persist).toHaveBeenCalledExactlyOnceWith(id, {
      version: 1,
      folderScope: null,
      shellNetwork: true,
      memoryWrite: false,
    })
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(true)
  })

  it('keeps elevated access off and says so when the save fails', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    persist.mockRejectedValueOnce(new Error('disk unavailable'))
    mount(id)
    fireEvent.click(screen.getByLabelText(SHELL_LABEL))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Permission change could not be saved. Elevated access stays off until a save succeeds.'
      )
    )
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(false)
  })

  it('offers reconfirmation for a stale elevated snapshot and activates it only via the setter', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    // Explicit revoke establishes process-local denied authority.
    await useThreads.getState().setConversationCapabilities(id, null)
    // Build the overlay-denied/metadata-elevated split directly: a real fetch
    // goes through setThreads, whose overlay merge would hide the stale disk
    // value, so this deliberately bypasses it to pin the defense-in-depth.
    useThreads.setState({
      threads: { [id]: thread(id, { conversationCapabilities: elevated }) },
    })
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(false)
    mount(id)
    const notice = screen.getByTestId('scope-reconfirm')
    expect(notice).toHaveTextContent('not active in this session')
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()

    persist.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Reconfirm saved permissions' }))
    await waitFor(() =>
      expect(screen.queryByTestId('scope-reconfirm')).not.toBeInTheDocument()
    )
    expect(persist).toHaveBeenCalledExactlyOnceWith(id, elevated)
    expect(screen.getByLabelText(SHELL_LABEL)).toBeChecked()
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual(elevated)
  })

  it('failed reconfirmation stays denied', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    await useThreads.getState().setConversationCapabilities(id, null)
    useThreads.setState({
      threads: { [id]: thread(id, { conversationCapabilities: elevated }) },
    })
    persist.mockRejectedValueOnce(new Error('disk unavailable'))
    mount(id)
    fireEvent.click(screen.getByRole('button', { name: 'Reconfirm saved permissions' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(false)
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
  })

  it('"Keep them off" persists the denial and clears the notice', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    await useThreads.getState().setConversationCapabilities(id, null)
    useThreads.setState({
      threads: { [id]: thread(id, { conversationCapabilities: elevated }) },
    })
    mount(id)
    persist.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Keep them off' }))
    await waitFor(() =>
      expect(screen.queryByTestId('scope-reconfirm')).not.toBeInTheDocument()
    )
    expect(persist).toHaveBeenCalledExactlyOnceWith(id, {
      version: 1,
      folderScope: null,
      shellNetwork: false,
      memoryWrite: false,
    })
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
  })

  it('re-renders only for effective-scope changes: unrelated store updates are equality-stable', async () => {
    const id = freshId()
    const other = thread('bystander')
    useThreads.setState({ threads: { [id]: thread(id), bystander: other } })
    const commits = vi.fn()
    render(
      <React.Profiler id="scope" onRender={commits}>
        <ConversationScopeControl threadId={id} pickFolder={vi.fn(async () => null)} />
      </React.Profiler>
    )
    const after = () => commits.mock.calls.length
    const baseline = after()
    // Unrelated store notifications: selection change and another thread's update.
    act(() => {
      useThreads.setState({ currentThreadId: 'bystander' })
      useThreads.setState((state) => ({
        threads: { ...state.threads, bystander: { ...other, title: 'Renamed' } },
      }))
    })
    expect(after()).toBe(baseline)
    // An effective change for this thread re-renders through the selector.
    await act(async () => {
      await useThreads.getState().setConversationCapabilities(id, elevated)
    })
    expect(after()).toBeGreaterThan(baseline)
    expect(screen.getByLabelText(SHELL_LABEL)).toBeChecked()
  })

  it('reflects an external revocation immediately, before the pending native save settles', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    await act(async () => {
      await useThreads.getState().setConversationCapabilities(id, elevated)
    })
    mount(id)
    expect(screen.getByLabelText(SHELL_LABEL)).toBeChecked()

    // External revoke (e.g. another surface) whose native write stays pending.
    const native = deferred()
    persist.mockReturnValueOnce(native.promise)
    let revoke!: Promise<void>
    act(() => {
      revoke = useThreads.getState().setConversationCapabilities(id, null)
    })
    // Authority and UI are already denied before the await resolves.
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(false)
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
    expect(screen.queryByTestId('scope-reconfirm')).not.toBeInTheDocument()

    await act(async () => {
      native.resolve()
      await revoke
    })
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(false)
  })

  it('a cancelled folder pick persists nothing', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    const pickFolder = vi.fn(async () => null)
    mount(id, pickFolder)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    await waitFor(() => expect(pickFolder).toHaveBeenCalledTimes(1))
    expect(persist).not.toHaveBeenCalled()
    expect(screen.getByText('No folder access selected.')).toBeInTheDocument()
  })

  it('selecting a folder through the injected picker saves read-only folder scope', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    const pickFolder = vi.fn(async () => '/workspace/project')
    mount(id, pickFolder)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Read only: /workspace/project'
      )
    )
    expect(persist).toHaveBeenCalledExactlyOnceWith(id, {
      version: 1,
      folderScope: { path: '/workspace/project', access: 'read' },
      shellNetwork: false,
      memoryWrite: false,
    })
  })
})
