import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { __resetCoworkRunCloseForTests, quiesceCoworkRuns, resumeCoworkAfterPreventedClose, useCoworkRun } from '@/hooks/useCoworkRun'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { usePrompt } from '@/hooks/usePrompt'
import { CoworkPage } from '../CoworkPage'
import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import type { CoworkTurn, TodoList } from '@/types/coworkSession'

const mocks = vi.hoisted(() => ({ run: vi.fn(), sandbox: vi.fn(), refresh: vi.fn(), cancelShells: vi.fn(), dispatch: vi.fn(), handoff: vi.fn(), ensure: vi.fn(), navigate: vi.fn(), pick: vi.fn(), setGrant: vi.fn(), toastError: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useThreadManagement', () => ({ useThreadManagement: () => ({ folders: [] }) }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({}), useServiceHub: () => ({ app: () => ({ getJanDataFolder: async () => null }), dialog: () => ({ open: mocks.pick }) }) }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
const skillsFolder = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useSkills', () => ({ useSkills: (folder: string | null) => { skillsFolder(folder); return { skills: [], invoke: vi.fn() } } }))
vi.mock('@/hooks/useAutoScroll', () => ({ useAutoScroll: () => ({}) }))
vi.mock('@/lib/coworkSubagentRegistry', () => ({ listSubagents: async () => [] }))
vi.mock('@/lib/coworkHandoff', () => ({ peekCoworkHandoff: mocks.handoff, claimCoworkHandoff: () => true, clearCoworkHandoff: vi.fn(), releaseCoworkHandoff: vi.fn() }))
vi.mock('@/lib/agentTools', () => ({ isRecordedShellCall: () => false, getSandboxStatus: mocks.sandbox, cancelAgentThreadBash: vi.fn(), cancelAgentThreadBashStrict: mocks.cancelShells, activeAgentMonitorIds: async () => null }))
vi.mock('@/lib/coworkAttachments', async (original) => ({ ...await original<typeof import('@/lib/coworkAttachments')>(), importAttachedFiles: async (files: unknown[]) => files }))
vi.mock('@/lib/coworkSync', () => ({ ensureCoworkRecorded: mocks.ensure }))
vi.mock('@/lib/coworkEnv', () => ({ getCoworkEnvironment: async () => ({}) }))
vi.mock('@/lib/coworkTransport', () => ({ CoworkChatTransport: class { refreshTools = mocks.refresh } }))
vi.mock('@/lib/coworkDispatch', () => ({ dispatchCoworkTool: mocks.dispatch }))
vi.mock('@/lib/coworkRunner', async (original) => ({ ...await original<typeof import('@/lib/coworkRunner')>(), runTurn: mocks.run }))
// A mounted composer contract double: like ChatInput, only explicit false keeps
// prompt and documents. Its submit Promise must not wait for the agent stream.
vi.mock('@/containers/ChatInput', () => ({ default: ({ onSubmit }: { onSubmit: (text: string, files: undefined, documents: unknown[]) => boolean }) => {
  const prompt = usePrompt((s) => s.prompt)
  const [files, setFiles] = useState(['notes.txt'])
  return <div><input aria-label="Prompt" value={prompt} onChange={(e) => usePrompt.getState().setPrompt(e.target.value)} /><span>{files.join(',')}</span><button onClick={async () => {
    const accepted = await onSubmit(prompt, undefined, files.map((name) => ({ name, path: '/notes.txt', fileType: 'txt' })))
    if (accepted !== false) { usePrompt.getState().setPrompt(''); setFiles([]) }
  }}>Submit</button></div>
} }))
vi.mock('@/components/ai-elements/conversation-column', () => ({ ConversationColumn: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkOverviewPanel', () => ({ CoworkOverviewPanel: ({ todos }: { todos?: TodoList }) => <output data-testid="rail-todos">{JSON.stringify(todos)}</output> }))
vi.mock('@/containers/ConversationHeaderTitle', () => ({ ConversationHeaderTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkComposerMenu', () => ({ CoworkComposerMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/MessageItem', () => ({ MessageItem: (props: Record<string, unknown>) => <div>{['onRegenerate', 'onEdit', 'onRetry', 'onDelete'].map((name) => typeof props[name] === 'function' ? <button key={name} onClick={() => (props[name] as (...args: string[]) => void)((props.message as { id: string }).id, 'Edited question')}>{name}</button> : null)}</div> }))
vi.mock('@/components/PromptProgress', () => ({ PromptProgress: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ai-elements/conversation', () => ({ Conversation: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, ConversationContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, ConversationScrollButton: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkWorkspacePill', () => ({ CoworkWorkspacePill: ({ folder, access, saving, onAccessChange, onAllowAccess, onAttach, onDetach }: { folder: string; access?: string | null; saving?: boolean; onAccessChange?: (a: 'read' | 'write') => void; onAllowAccess?: () => void; onAttach: () => void; onDetach: () => void }) => <div data-testid="pill" data-access={String(access)} data-saving={String(!!saving)}>{folder}<button onClick={() => onAccessChange?.('read')}>make-read</button><button onClick={onAllowAccess}>allow-access</button><button onClick={onAttach}>attach</button><button onClick={onDetach}>detach</button></div> }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))
vi.mock('@/lib/coworkFolderAccess', async (original) => ({ ...await original<typeof import('@/lib/coworkFolderAccess')>(), setCoworkFolderGrant: mocks.setGrant }))
vi.mock('@/containers/CoworkPlanToggle', () => ({ CoworkPlanToggle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkEmptyState', () => ({ CoworkEmptyState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkArtifactCard', () => ({ CoworkArtifactCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkPreviewPanel', () => ({ CoworkPreviewPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkDiffPanel', () => ({ CoworkDiffPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkTodoPanel', () => ({ CoworkTodoPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkTasksPanel', () => ({ CoworkTasksPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkFilesPanel', () => ({ CoworkFilesPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/ModelSetting', () => ({ ModelSettingSheet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkBudgetNotice', () => ({ CoworkBudgetNotice: ({ children, onNewConversation }: { children?: React.ReactNode; onNewConversation?: () => void }) => <div>{children}{onNewConversation && <button onClick={onNewConversation}>New conversation</button>}</div> }))
vi.mock('@/containers/CoworkRunNotice', () => ({ CoworkRunNotice: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkAskCard', () => ({ CoworkAskCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkParkedNotice', () => ({ CoworkParkedNotice: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))

let finish: () => void
beforeEach(() => {
  vi.clearAllMocks()
  mocks.dispatch.mockReset()
  mocks.run.mockReset()
  mocks.ensure.mockReset()
  mocks.ensure.mockResolvedValue(undefined)
  __resetCoworkRunCloseForTests()
  mocks.handoff.mockReturnValue(undefined)
  useCoworkSessions.setState({ sessions: [{ id: 'test', title: 'New session', folder: null, turns: [], messages: [], updated: 0 }], currentId: 'test' })
  useCoworkRun.setState({ runId: {}, liveTurns: {}, outcomes: {} })
  useModelProvider.setState({ selectedProvider: 'remote', selectedModel: { id: 'model', capabilities: ['tools'] }, providers: [{ provider: 'remote', active: true, models: [{ id: 'model', capabilities: ['tools'] }] }] } as never)
  usePrompt.getState().setPrompt('Keep my draft')
  mocks.cancelShells.mockResolvedValue(undefined)
  mocks.refresh.mockResolvedValue(undefined)
  mocks.sandbox.mockResolvedValue(undefined)
  mocks.run.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ stoppedBy: 'done', messages: [], usage: null }) }))
})
afterEach(() => { vi.useRealTimers() })
describe('CoworkPage legacy new conversation action', () => {
  it('routes to unified home, keeping the legacy session', async () => {
    const legacy = { id: 'test', title: 'Legacy', folder: null, turns: [{ role: 'user' as const, content: 'Old question' }], messages: [], updated: 1 }
    useCoworkSessions.setState({ sessions: [legacy], currentId: 'test' })
    useCoworkRun.setState({ outcomes: { test: { stoppedBy: 'tokens' } } })
    render(<CoworkPage />)
    await act(async () => {})
    fireEvent.click(screen.getByText('New conversation'))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
    expect(useCoworkSessions.getState().sessions).toEqual([legacy])
  })
})
describe('CoworkPage request acceptance', () => {
  it('keeps prompt and attached documents when the model cannot call tools', async () => {
    useModelProvider.setState({ providers: [{ provider: 'remote', active: true, models: [{ id: 'model', capabilities: [] }] }] } as never)
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await act(async () => {})
    expect(screen.getByLabelText('Prompt')).toHaveValue('Keep my draft')
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it('restores refused handoff text and every attachment to the session draft', async () => {
    useModelProvider.setState({ providers: [] })
    mocks.handoff.mockReturnValue({ text: 'Expanded prompt', draft: 'Original prompt', documents: [{ type: 'document', name: 'report.pdf', path: '/report.pdf' }], files: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,abc' }] })
    render(<CoworkPage />)
    await act(async () => {})
    expect(usePrompt.getState().prompt).toBe('Original prompt')
    expect(useChatAttachments.getState().getAttachments('test')).toEqual([
      { type: 'document', name: 'report.pdf', path: '/report.pdf' },
      expect.objectContaining({ type: 'image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,abc' }),
    ])
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('clears the accepted composer before the stream completes', async () => {
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('Prompt')).toHaveValue('')
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    expect(useCoworkRun.getState().runId.test).toBeTruthy()
    await act(async () => finish())
  })
  it('does not call the model until the session record is durable, and surfaces failure', async () => {
    let resolveEnsure!: () => void
    mocks.ensure.mockImplementationOnce(() => new Promise<void>((r) => { resolveEnsure = r }))
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await act(async () => {})
    expect(mocks.ensure).toHaveBeenCalledWith('test')
    expect(mocks.run).not.toHaveBeenCalled()
    await act(async () => resolveEnsure())
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    await act(async () => finish())
  })
  it('does not start the model when recording the session fails', async () => {
    mocks.ensure.mockRejectedValueOnce(new Error('record failed'))
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await act(async () => {})
    await act(async () => {})
    expect(mocks.run).not.toHaveBeenCalled()
    expect(useCoworkRun.getState().outcomes.test?.errorText ?? '').toContain('record failed')
  })
  it('abort while the session record is being written starts no model call and releases the run', async () => {
    let resolveEnsure!: () => void
    mocks.ensure.mockImplementationOnce(() => new Promise<void>((r) => { resolveEnsure = r }))
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.ensure).toHaveBeenCalledWith('test'))
    expect(useCoworkRun.getState().runId.test).toBeTruthy()
    const closing = quiesceCoworkRuns()
    await act(async () => resolveEnsure())
    await act(async () => { await closing })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(useCoworkRun.getState().runId.test).toBeUndefined()
    await expect(quiesceCoworkRuns()).resolves.toBeUndefined()
  })
  it('blocks close-time submission and resolves close only after the run commits', async () => {
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    let closed = false
    const closing = quiesceCoworkRuns().then(() => { closed = true })
    await act(async () => {})
    expect(closed).toBe(false)
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Not accepted during close' } })
    fireEvent.click(screen.getByText('Submit'))
    await act(async () => {})
    expect(screen.getByLabelText('Prompt')).toHaveValue('Not accepted during close')
    await act(async () => { finish(); await closing })
    expect(closed).toBe(true)
    expect(useCoworkRun.getState().runId.test).toBeUndefined()
    expect(useCoworkSessions.getState().sessions[0].turns[0].content).toBe('Keep my draft')
  })
  it('waits for native shell cancellation as well as transcript commit', async () => {
    let cancel!: () => void
    mocks.cancelShells.mockImplementationOnce(() => new Promise<void>((resolve) => { cancel = resolve }))
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    let closed = false
    const closing = quiesceCoworkRuns().then(() => { closed = true })
    await act(async () => finish())
    expect(mocks.cancelShells).toHaveBeenCalledWith('test')
    expect(closed).toBe(false)
    await act(async () => { cancel(); await closing })
    expect(closed).toBe(true)
  })
  it('retains a committed run after cancellation timeout and retries native teardown', async () => {
    let confirmRetry!: () => void
    mocks.cancelShells
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { confirmRetry = resolve }))
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    vi.useFakeTimers()
    const rejected = expect(quiesceCoworkRuns()).rejects.toThrow('teardown did not settle')
    await act(async () => finish())
    expect(useCoworkRun.getState().runId.test).toBeUndefined()
    expect(useCoworkSessions.getState().sessions[0].turns[0].content).toBe('Keep my draft')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await rejected })
    resumeCoworkAfterPreventedClose()
    let closed = false
    const retry = quiesceCoworkRuns().then(() => { closed = true })
    await act(async () => {})
    expect(mocks.cancelShells).toHaveBeenCalledTimes(2)
    expect(closed).toBe(false)
    await act(async () => { confirmRetry(); await retry })
    expect(closed).toBe(true)
    // Confirmed participants are removed, not leaked into later closes.
    resumeCoworkAfterPreventedClose()
    await quiesceCoworkRuns()
    expect(mocks.cancelShells).toHaveBeenCalledTimes(2)
  })
  it('retries rejected cancellation after execution commits', async () => {
    mocks.cancelShells.mockRejectedValueOnce(new Error('native cancellation failed'))
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    await act(async () => {
      await expect(quiesceCoworkRuns()).rejects.toThrow('native cancellation failed')
      finish()
    })
    expect(useCoworkRun.getState().runId.test).toBeUndefined()
    resumeCoworkAfterPreventedClose()
    await act(async () => { await quiesceCoworkRuns() })
    expect(mocks.cancelShells).toHaveBeenCalledTimes(2)
  })
  it('unregisters normally completed runs without requesting cancellation', async () => {
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    await act(async () => finish())
    await quiesceCoworkRuns()
    expect(mocks.cancelShells).not.toHaveBeenCalled()
  })
  it('refuses close after bounded settlement while startup is stalled, then does not dispatch after abort', async () => {
    let prepared!: () => void
    mocks.sandbox.mockImplementationOnce(() => new Promise<void>((resolve) => { prepared = resolve }))
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.sandbox).toHaveBeenCalledOnce())
    vi.useFakeTimers()
    const closing = quiesceCoworkRuns()
    const rejected = expect(closing).rejects.toThrow('teardown did not settle')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await rejected })
    expect(useCoworkRun.getState().runId.test).toBeTruthy()
    expect(mocks.cancelShells).toHaveBeenCalledWith('test')
    await act(async () => prepared())
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(useCoworkRun.getState().runId.test).toBeUndefined()
    await expect(quiesceCoworkRuns()).resolves.toBeUndefined()
  })
  it('refuses close when a dispatched tool has not settled, without pretending the run ended', async () => {
    let dispatched!: () => void
    mocks.dispatch.mockImplementationOnce(() => new Promise((resolve) => { dispatched = () => resolve({ output: 'stopped' }) }))
    mocks.run.mockImplementationOnce(async ({ deps, signal }) => {
      await deps.dispatch({ toolCallId: 'shell', toolName: 'bash', input: { command: 'work' } }, signal)
      return { stoppedBy: 'aborted', messages: [], usage: null }
    })
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    vi.useFakeTimers()
    const rejected = expect(quiesceCoworkRuns()).rejects.toThrow('teardown did not settle')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await rejected })
    expect(useCoworkRun.getState().runId.test).toBeTruthy()
    expect(mocks.cancelShells).toHaveBeenCalledWith('test')
    await act(async () => dispatched())
    expect(useCoworkRun.getState().runId.test).toBeUndefined()
  })
  it.each([undefined, '', ' ', null, 7, {}])('does not mutate transcript rows for invalid optional todo id %j', async (callId) => {
    const list = { phases: [] }
    mocks.dispatch.mockImplementationOnce(async (_call, ctx) => {
      await ctx.onTodo({ op: 'view' }, callId)
      return { output: 'ok' }
    })
    mocks.run.mockImplementationOnce(async ({ deps }) => {
      deps.sink.onText('Original answer')
      await deps.dispatch({ toolCallId: 'dispatch', toolName: 'todo', input: {} })
      return { stoppedBy: 'done', messages: [], usage: null }
    })
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    const turns = useCoworkSessions.getState().sessions[0].turns
    expect(turns).toEqual([
      expect.objectContaining({ role: 'user', content: 'Keep my draft' }),
      { role: 'assistant', content: 'Original answer' },
    ])
    for (const row of turns) {
      expect(row).not.toHaveProperty('result')
      expect(row).not.toHaveProperty('status')
    }
    expect(useCoworkSessions.getState().sessions[0].todos).toEqual(list)
  })
  it('projects a valid todo id into only the matching todo tool row', async () => {
    const list = { phases: [] }
    mocks.dispatch.mockImplementationOnce(async (_call, ctx) => {
      await ctx.onTodo({ op: 'view' }, 'target')
      return { output: 'ok' }
    })
    mocks.run.mockImplementationOnce(async ({ deps }) => {
      deps.sink.onText('Original answer')
      deps.sink.onToolStart('other', 'todo')
      deps.sink.onToolStart('target', 'shell')
      deps.sink.onToolStart('target', 'todo')
      await deps.dispatch({ toolCallId: 'dispatch', toolName: 'todo', input: {} })
      return { stoppedBy: 'done', messages: [], usage: null }
    })
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
    const turns = useCoworkSessions.getState().sessions[0].turns
    expect(turns.filter((row) => row.result === JSON.stringify(list))).toEqual([
      expect.objectContaining({ role: 'tool', name: 'todo', callId: 'target', status: 'done' }),
    ])
    expect(turns[0]).not.toHaveProperty('result')
    expect(turns[1]).toEqual({ role: 'assistant', content: 'Original answer' })
    expect(turns.find((row) => row.callId === 'other')?.result).toBe('(interrupted)')
    expect(turns.find((row) => row.name === 'shell')?.result).toBe('(interrupted)')
  })
  it('commits interrupted tool input with its partial arguments intact on abort', async () => {
    mocks.run.mockImplementationOnce(({ deps, signal }) => {
      deps.sink.onToolStart('partial', 'write')
      deps.sink.onToolArgsDelta('partial', '{"path":"/draft","body":"unfinished')
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ stoppedBy: 'aborted', messages: [], usage: null }), { once: true }))
    })
    render(<CoworkPage />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    await act(async () => { await quiesceCoworkRuns() })
    expect(useCoworkSessions.getState().sessions[0].turns).toContainEqual(expect.objectContaining({
      callId: 'partial', status: 'done', isError: true, result: '(interrupted)',
      argsLive: '{"path":"/draft","body":"unfinished',
    }))
  })
  it.each(['missing-sidecar', 'unreadable-sidecar', 'id-collision'] as const)('makes %s sessions read-only and refuses automatic handoffs', async (unavailable) => {
    useCoworkSessions.setState((s) => ({ sessions: s.sessions.map((session) => ({ ...session, unavailable, turns: [{ role: 'user' as const, content: 'Old question' }, { role: 'assistant' as const, content: 'Old answer' }] })) }))
    useCoworkRun.setState({ outcomes: { test: { stoppedBy: 'error', errorText: 'Retry?' } } })
    mocks.handoff.mockReturnValue({ text: 'Execute tools' })
    render(<CoworkPage />)
    await act(async () => {})
    expect(screen.getByRole('alert')).toHaveTextContent('read-only')
    expect(screen.queryByLabelText('Prompt')).not.toBeInTheDocument()
    expect(screen.queryByText('onRegenerate')).not.toBeInTheDocument()
    expect(screen.queryByText('onRetry')).not.toBeInTheDocument()
    expect(screen.queryByText('onEdit')).not.toBeInTheDocument()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.sandbox).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})


// Exercise the mounted callbacks, not a pre-truncated fixture: both the rail
// and the next run's real conversation-tool handler must forget discarded work.
describe('CoworkPage todo rewind authority', () => {
  const empty: TodoList = { phases: [] }
  const snapshot = (content: string): TodoList => ({ phases: [{ name: '', tasks: [{ content, status: 'pending' }] }] })
  const earlier = snapshot('Earlier task')
  const discarded = snapshot('Discarded task')
  const todo = (list: TodoList, callId: string): CoworkTurn => ({ role: 'tool', name: 'todo', callId, content: '', status: 'done', result: JSON.stringify(list) })
  const seed = (turns: CoworkTurn[], todos = discarded) => {
    useCoworkSessions.setState({ sessions: [{ id: 'test', title: 'Todo history', folder: null, turns, messages: coworkTurnsToUIMessages(turns), todos, updated: 0 }] })
  }
  const mountRail = () => {
    render(<CoworkPage />)
    fireEvent.click(screen.getByTestId('overview-toggle'))
  }
  const expectRail = (list: TodoList) => expect(screen.getByTestId('rail-todos').textContent).toBe(JSON.stringify(list))
  const arrangeModelRead = (list: TodoList) => {
    mocks.dispatch.mockImplementationOnce(async (_call, ctx) => {
      // `view` passes through createConversationToolHandlers.getTodo, exactly
      // the read the model makes. Assert before onTodo can update the sidecar.
      expect(useCoworkSessions.getState().sessions[0].todos).toEqual(list)
      const result = await ctx.onTodo({ op: 'view' }, 'read-after-rewind')
      expect(result.isError).not.toBe(true)
      expect(useCoworkSessions.getState().sessions[0].todos).toEqual(list)
      return result
    })
    mocks.run.mockImplementationOnce(async ({ deps }) => {
      await deps.dispatch({ toolCallId: 'read-after-rewind', toolName: 'todo', input: { op: 'view' } })
      return { stoppedBy: 'done', messages: [], usage: null }
    })
  }

  it('bounds committed todo parsing across mounted live text deltas and prefers the latest live snapshot, even empty', async () => {
    const history = Array.from({ length: 48 }, (_, index) => snapshot(`Parse-bound history task ${index}`))
    const fixtureStrings = new Set(history.map((list) => JSON.stringify(list)))
    seed(history.flatMap((list, index): CoworkTurn[] => [
      { role: 'user', content: `Historical question ${index}` },
      todo(list, `history-${index}`),
      { role: 'assistant', content: `Historical answer ${index}` },
    ]))
    useCoworkRun.setState({ runId: { test: 'parse-bound-run' }, liveTurns: { test: [] } })
    const parse = vi.spyOn(JSON, 'parse')
    // Ignore framework/store parsing: count only this test's unique committed
    // snapshot strings, not the live snapshots which legitimately reparse.
    const committedParses = () => parse.mock.calls.filter(([value]) => fixtureStrings.has(value)).length
    try {
      mountRail()
      await act(async () => {})
      expectRail(history.at(-1)!) // Transcript wins over the stale legacy sidecar.
      const initialParses = committedParses()
      expect(initialParses).toBe(history.length)
      const publish = async (snapshots: TodoList[], delta: number) => {
        await act(async () => {
          useCoworkRun.setState({ liveTurns: { test: [
            ...snapshots.map((list, index) => todo(list, `live-${index}`)),
            { role: 'assistant', content: `Live text delta ${delta}` },
          ] } })
        })
      }
      for (let delta = 0; delta < 16; delta++) {
        await publish([], delta)
        expectRail(history.at(-1)!)
        expect(committedParses()).toBe(initialParses)
      }
      const liveFirst = snapshot('Parse-bound first live task')
      const liveLatest = snapshot('Parse-bound latest live task')
      await publish([liveFirst, liveLatest], 16)
      expectRail(liveLatest)
      await publish([liveFirst, liveLatest, empty], 17)
      expectRail(empty) // An explicit clear must not fall back to history.
      await publish([liveFirst, liveLatest, empty], 18)
      expectRail(empty)
      expect(committedParses()).toBe(initialParses)
      expect(mocks.run).not.toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  })

  it('publishes live todo progress before a same-step ask suspends', async () => {
    seed([{ role: 'user', content: 'Previous' }, todo(earlier, 'old'), { role: 'assistant', content: 'Previous answer' }], earlier)
    let answer!: () => void
    mocks.dispatch.mockImplementation(async (call, ctx) => {
      if (call.toolName === 'todo') return ctx.onTodo(call.input, call.toolCallId)
      return ctx.onAsk(call.toolCallId, call.input)
    })
    mocks.run.mockImplementationOnce(async ({ deps }) => {
      // Materialize and flush both running rows before dispatch, as a streamed
      // model step does. No later onStep/text delta may refresh the rail.
      deps.sink.onToolStart('live-todo', 'todo')
      deps.sink.onToolCall({ toolCallId: 'live-todo', toolName: 'todo', input: { op: 'init', items: ['Updated live task'] } })
      deps.sink.onToolStart('live-ask', 'ask')
      deps.sink.onToolCall({ toolCallId: 'live-ask', toolName: 'ask', input: {} })
      await deps.dispatch({ toolCallId: 'live-todo', toolName: 'todo', input: { op: 'init', items: ['Updated live task'] } })
      const pending = deps.dispatch({ toolCallId: 'live-ask', toolName: 'ask', input: { questions: [{ id: 'q', question: 'Wait here?', options: [{ label: 'Yes' }, { label: 'No' }] }] } })
      answer = () => { void import('@/lib/coworkRunner').then(({ answerAsk }) => answerAsk('test', 'live-ask', [{ id: 'q', selected: ['Yes'] }])) }
      await pending
      return { stoppedBy: 'done', messages: [], usage: null }
    })
    mountRail()
    expectRail(earlier)
    await act(async () => { fireEvent.click(screen.getByText('Submit')) })
    await waitFor(() => expect(useCoworkRun.getState().pendingAsks.test).toHaveLength(1))
    expect(screen.getByTestId('rail-todos').textContent).toContain('Updated live task')
    expect(screen.getByTestId('rail-todos').textContent).not.toContain('Earlier task')
    expect(useCoworkRun.getState().runId.test).toBeTruthy()
    await act(async () => { answer(); await Promise.resolve() })
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
  })

  it.each(['onRegenerate', 'onEdit', 'onDelete'] as const)('%s clears the last snapshot instead of resurrecting the legacy sidecar', async (action) => {
    seed([{ role: 'user', content: 'Question' }, todo(discarded, 'last'), { role: 'assistant', content: 'Answer' }])
    mountRail()
    expectRail(discarded)
    arrangeModelRead(empty)
    await act(async () => { fireEvent.click(screen.getAllByText(action).at(-1)!) })
    expectRail(empty)
    if (action === 'onDelete') fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
    expectRail(empty)
    expect(useCoworkSessions.getState().sessions[0].turns.some((turn) => turn.callId === 'last')).toBe(false)
  })

  it.each(['onRegenerate', 'onEdit', 'onDelete'] as const)('%s restores the earlier surviving snapshot in rail and model', async (action) => {
    seed([{ role: 'user', content: 'First' }, todo(earlier, 'first'), { role: 'assistant', content: 'First answer' }, { role: 'user', content: 'Second' }, todo(discarded, 'last'), { role: 'assistant', content: 'Second answer' }])
    mountRail()
    expectRail(discarded)
    arrangeModelRead(earlier)
    await act(async () => { fireEvent.click(screen.getAllByText(action).at(-1)!) })
    expectRail(earlier)
    if (action === 'onDelete') fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
    expectRail(earlier)
  })

  it('permits untouched legacy fallback but clears it when a mounted history is rewound', async () => {
    seed([{ role: 'user', content: 'Legacy question' }, { role: 'assistant', content: 'Legacy answer' }])
    mountRail()
    expectRail(discarded)
    arrangeModelRead(empty)
    await act(async () => { fireEvent.click(screen.getAllByText('onRegenerate').at(-1)!) })
    expectRail(empty)
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
    expectRail(empty)
  })

  it('does not resurrect a stale sidecar after an explicit zero-task transcript snapshot', async () => {
    seed([{ role: 'user', content: 'Clear tasks' }, todo(discarded, 'old'), todo(empty, 'cleared'), { role: 'assistant', content: 'Cleared' }])
    mountRail()
    expectRail(empty)
    // Here the sidecar is intentionally stale: only the real model read should
    // replace it with the authoritative empty transcript result.
    mocks.dispatch.mockImplementationOnce(async (_call, ctx) => {
      const result = await ctx.onTodo({ op: 'view' }, 'view-empty')
      expect(useCoworkSessions.getState().sessions[0].todos).toEqual(empty)
      return result
    })
    mocks.run.mockImplementationOnce(async ({ deps }) => {
      await deps.dispatch({ toolCallId: 'view-empty', toolName: 'todo', input: { op: 'view' } })
      return { stoppedBy: 'done', messages: [], usage: null }
    })
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
    expectRail(empty)
  })
})


describe('CoworkPage legacy first todo read', () => {
  it.each([false, true])('preserves legacy tasks through a pending first view (failed operation first: %s)', async (failFirst) => {
    const legacy: TodoList = { phases: [{ name: '', tasks: [{ content: 'Legacy task', status: 'pending' }] }] }
    useCoworkSessions.setState({ sessions: [{ id: 'test', title: 'Legacy', folder: null, turns: [{ role: 'user', content: 'Previous question' }, { role: 'assistant', content: 'Previous answer' }], messages: [], todos: legacy, updated: 0 }] })
    mocks.dispatch.mockImplementation(async (_call, ctx) => {
      const result = await ctx.onTodo(_call.input, _call.toolCallId)
      if (_call.toolCallId === 'failed') expect(result.isError).toBe(true)
      else expect(useCoworkSessions.getState().sessions[0].todos).toEqual(legacy)
      return result
    })
    mocks.run.mockImplementationOnce(async ({ deps }) => {
      if (failFirst) {
        deps.sink.onToolStart('failed', 'todo')
        await deps.dispatch({ toolCallId: 'failed', toolName: 'todo', input: { op: 'not-an-operation' } })
      }
      deps.sink.onToolStart('first-view', 'todo')
      await deps.dispatch({ toolCallId: 'first-view', toolName: 'todo', input: { op: 'view' } })
      return { stoppedBy: 'done', messages: [], usage: null }
    })
    render(<CoworkPage />)
    fireEvent.click(screen.getByTestId('overview-toggle'))
    expect(screen.getByTestId('rail-todos').textContent).toBe(JSON.stringify(legacy))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(failFirst ? 2 : 1))
    await waitFor(() => expect(useCoworkRun.getState().runId.test).toBeUndefined())
    expect(screen.getByTestId('rail-todos').textContent).toBe(JSON.stringify(legacy))
  })
})

describe('CoworkPage folder access', () => {
  const seedFolder = (extra: Record<string, unknown> = {}) => useCoworkSessions.setState({ sessions: [{ id: 'test', title: 'T', folder: '/proj', turns: [], messages: [], updated: 0, ...extra }] as never, currentId: 'test' })
  const runDispatchOnce = async () => {
    mocks.dispatch.mockResolvedValue({ output: 'ok' })
    mocks.run.mockImplementationOnce(async ({ deps }) => {
      await deps.dispatch({ toolCallId: 'c', toolName: 'read', input: {} })
      return { stoppedBy: 'done', messages: [], usage: null }
    })
    render(<CoworkPage />)
    await act(async () => { fireEvent.click(screen.getByText('Submit')) })
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce())
    return mocks.dispatch.mock.calls[0][1]
  }
  beforeEach(() => {
    mocks.setGrant.mockReset()
    mocks.setGrant.mockResolvedValue(undefined)
    mocks.pick.mockReset()
  })

  it('shows a read-only grant as read-only and dispatch receives read, not write', async () => {
    seedFolder({ folderAccess: 'read' })
    const ctx = await runDispatchOnce()
    expect(screen.getByTestId('pill').dataset.access).toBe('read')
    expect(ctx).toMatchObject({ readOnlyFolder: '/proj', folderAccess: 'read' })
  })

  it('a legacy session with no host record is inactive: no write display, no tool folder', async () => {
    seedFolder()
    const ctx = await runDispatchOnce()
    expect(screen.getByTestId('pill').textContent).toContain('/proj')
    expect(screen.getByTestId('pill').dataset.access).toBe('null')
    expect(ctx).toMatchObject({ readOnlyFolder: null, folderAccess: null })
  })

  it('does not inject the legacy folder into skills before a grant, and does after', async () => {
    skillsFolder.mockClear()
    seedFolder()
    render(<CoworkPage />)
    expect(skillsFolder).toHaveBeenCalled()
    expect(skillsFolder.mock.calls.every(([f]) => f === null)).toBe(true)
    cleanup()
    skillsFolder.mockClear()
    seedFolder({ folderAccess: 'read' })
    render(<CoworkPage />)
    expect(skillsFolder).toHaveBeenLastCalledWith('/proj')
  })

  it('Confirm restores only read access so a denied read-only grant cannot silently widen', async () => {
    seedFolder()
    mocks.setGrant.mockImplementationOnce(async (sid: string, scope: { path: string; access: 'read' | 'write' }) => {
      useCoworkSessions.getState().setFolderGrant(sid, scope)
    })
    render(<CoworkPage />)
    await act(async () => { fireEvent.click(screen.getByText('allow-access')) })
    expect(mocks.setGrant).toHaveBeenCalledExactlyOnceWith('test', { path: '/proj', access: 'read' })
    expect(screen.getByTestId('pill').dataset.access).toBe('read')
    expect(skillsFolder).toHaveBeenLastCalledWith('/proj')
  })

  it('a failed Allow access toasts and stays inactive', async () => {
    seedFolder()
    mocks.setGrant.mockRejectedValueOnce(new Error('host down'))
    render(<CoworkPage />)
    await act(async () => { fireEvent.click(screen.getByText('allow-access')) })
    expect(mocks.toastError).toHaveBeenCalledWith('common:conversationScope.saveFailed')
    expect(screen.getByTestId('pill').dataset.access).toBe('null')
    expect(screen.getByTestId('pill').dataset.saving).toBe('false')
    expect(skillsFolder).toHaveBeenLastCalledWith(null)
  })

  it('explicit saved write restores without confirmation', async () => {
    seedFolder({ folderAccess: 'write' })
    const ctx = await runDispatchOnce()
    expect(mocks.setGrant).not.toHaveBeenCalled()
    expect(screen.getByTestId('pill').dataset.access).toBe('write')
    expect(ctx).toMatchObject({ readOnlyFolder: '/proj', folderAccess: 'write' })
  })

  it('a denied grant keeps the folder visible but dispatch gets no folder and no access', async () => {
    seedFolder({ folderAccess: null })
    const ctx = await runDispatchOnce()
    expect(screen.getByTestId('pill').textContent).toContain('/proj')
    expect(screen.getByTestId('pill').dataset.access).toBe('null')
    expect(ctx).toMatchObject({ readOnlyFolder: null, folderAccess: null })
  })

  it('attaching a picked folder saves read+write through the strict setter', async () => {
    seedFolder({ folderAccess: 'write' })
    mocks.pick.mockResolvedValue('/Users/me/other')
    render(<CoworkPage />)
    await act(async () => { fireEvent.click(screen.getByText('attach')) })
    expect(mocks.setGrant).toHaveBeenCalledExactlyOnceWith('test', { path: '/Users/me/other', access: 'write' })
  })

  it('does not save an unsupported picked path', async () => {
    seedFolder({ folderAccess: 'write' })
    mocks.pick.mockResolvedValue('relative/dir')
    render(<CoworkPage />)
    await act(async () => { fireEvent.click(screen.getByText('attach')) })
    expect(mocks.setGrant).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('common:conversationScope.invalidFolder')
  })

  it('detach and access switch persist through the setter; session is not mutated by the page', async () => {
    seedFolder({ folderAccess: 'write' })
    render(<CoworkPage />)
    await act(async () => { fireEvent.click(screen.getByText('make-read')) })
    expect(mocks.setGrant).toHaveBeenLastCalledWith('test', { path: '/proj', access: 'read' })
    await act(async () => { fireEvent.click(screen.getByText('detach')) })
    expect(mocks.setGrant).toHaveBeenLastCalledWith('test', null)
    expect(useCoworkSessions.getState().sessions[0]).toMatchObject({ folder: '/proj', folderAccess: 'write' })
  })

  it('a rejected save tells the user and leaves the session as the setter left it', async () => {
    seedFolder({ folderAccess: 'write' })
    mocks.setGrant.mockImplementationOnce(async () => {
      useCoworkSessions.getState().setFolderGrant('test', { path: '/proj', access: null })
      throw new Error('host down')
    })
    render(<CoworkPage />)
    await act(async () => { fireEvent.click(screen.getByText('make-read')) })
    expect(mocks.toastError).toHaveBeenCalledWith('common:conversationScope.saveFailed')
    expect(screen.getByTestId('pill').dataset.access).toBe('null')
    expect(screen.getByTestId('pill').dataset.saving).toBe('false')
  })
})
