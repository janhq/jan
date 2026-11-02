import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const { persist, updateThread, revokeHost, stopAllMonitors } = vi.hoisted(() => ({
  persist: vi.fn(),
  updateThread: vi.fn(),
  revokeHost: vi.fn(),
  stopAllMonitors: vi.fn(),
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
  revokeThreadCapabilitiesInHost: revokeHost,
  stopAllThreadAgentMonitors: stopAllMonitors,
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
    revokeHost.mockResolvedValue(undefined)
    stopAllMonitors.mockResolvedValue(undefined)
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

  it('a failed host ACK while granting from default fails plain, with no background warning', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    revokeHost.mockRejectedValueOnce(new Error('ipc bridge down'))
    mount(id)
    fireEvent.click(screen.getByLabelText(SHELL_LABEL))
    // Nothing was elevated before this change, so there is no previous access
    // for background work to keep: the plain save-failure copy is the truth,
    // and the uncertainty warning would be noise.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Permission change could not be saved. Elevated access stays off until a save succeeds.'
      )
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent('previous access')
    expect(persist).not.toHaveBeenCalled()
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(false)
  })

  it('a failed host ACK while revoking an elevated grant warns that background access is not confirmed stopped', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    // Establish a live grant through the real setter first.
    await useThreads.getState().setConversationCapabilities(id, elevated)
    revokeHost.mockClear()
    persist.mockClear()
    revokeHost.mockRejectedValueOnce(new Error('ipc bridge down'))
    mount(id)
    fireEvent.click(screen.getByLabelText(SHELL_LABEL))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Background agent tasks may still have the previous access'
      )
    )
    // The unsafe universal claim must NOT appear: elevated access is not
    // provably off when the host never acknowledged the narrow.
    expect(screen.getByRole('alert')).not.toHaveTextContent('Elevated access stays off')
    expect(screen.getByRole('alert')).toHaveTextContent('quit Jan to guarantee they stop')
    // Nothing persisted, a stop was attempted, the toggles read denied.
    expect(persist).not.toHaveBeenCalled()
    expect(stopAllMonitors).toHaveBeenCalledExactlyOnceWith(id)
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

  it('revocation stays available during a busy save and supersedes it without a stale error', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    const pendingGrant = deferred()
    persist.mockReturnValueOnce(pendingGrant.promise)
    mount(id)
    // Start an elevation whose native write hangs.
    fireEvent.click(screen.getByLabelText(SHELL_LABEL))
    const revoke = await screen.findByTestId('scope-revoke-now')
    expect(revoke).toBeEnabled()
    // Revoke while the grant save is still in flight.
    fireEvent.click(revoke)
    expect(useThreads.getState().getConversationCapabilities(id).shellNetwork).toBe(false)
    // The hung grant write settles afterwards; it is superseded and must not
    // restore access or surface a stale error over the successful revoke.
    await act(async () => {
      pendingGrant.resolve()
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.queryByTestId('scope-revoke-now')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText(SHELL_LABEL)).not.toBeChecked()
    expect(useThreads.getState().getConversationCapabilities(id)).toEqual({
      version: 1,
      folderScope: null,
      shellNetwork: false,
      memoryWrite: false,
    })
    expect(persist).toHaveBeenLastCalledWith(id, {
      version: 1,
      folderScope: null,
      shellNetwork: false,
      memoryWrite: false,
    })
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

  it('a pending folder pick survives unrelated re-renders and applies exactly once', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    let resolvePick!: (path: string | null) => void
    const pickFolder = vi.fn(
      () => new Promise<string | null>((resolve) => { resolvePick = resolve })
    )
    mount(id, pickFolder)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    // Unrelated re-render with unchanged authority: this thread's title
    // changes, so the subscribed thread object is new but the effective value
    // identity must stay stable (the consent child would otherwise discard
    // the pending pick).
    act(() => {
      useThreads.setState((state) => ({
        threads: { ...state.threads, [id]: { ...state.threads[id], title: 'Renamed' } },
      }))
    })
    await act(async () => {
      resolvePick('/workspace/project')
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Read only: /workspace/project')
    )
    expect(persist).toHaveBeenCalledExactlyOnceWith(id, {
      version: 1,
      folderScope: { path: '/workspace/project', access: 'read' },
      shellNetwork: false,
      memoryWrite: false,
    })
  })

  it('an authority change while the dialog is open still discards the pick', async () => {
    const id = freshId()
    useThreads.setState({ threads: { [id]: thread(id) } })
    let resolvePick!: (path: string | null) => void
    const pickFolder = vi.fn(
      () => new Promise<string | null>((resolve) => { resolvePick = resolve })
    )
    mount(id, pickFolder)
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder to read' }))
    // Real authority change while the native dialog is open.
    await act(async () => {
      await useThreads.getState().setConversationCapabilities(id, {
        version: 1,
        folderScope: null,
        shellNetwork: true,
        memoryWrite: false,
      })
    })
    persist.mockClear()
    await act(async () => {
      resolvePick('/workspace/project')
      await Promise.resolve()
    })
    // The stale pick is discarded: no folder save, no folder shown.
    expect(persist).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('No folder access selected.')
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
