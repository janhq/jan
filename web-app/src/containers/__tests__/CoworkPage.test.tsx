import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { __resetCoworkRunCloseForTests, quiesceCoworkRuns, resumeCoworkAfterPreventedClose, useCoworkRun } from '@/hooks/useCoworkRun'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { usePrompt } from '@/hooks/usePrompt'
import { CoworkPage } from '../CoworkPage'

const mocks = vi.hoisted(() => ({ run: vi.fn(), sandbox: vi.fn(), refresh: vi.fn(), cancelShells: vi.fn(), dispatch: vi.fn(), handoff: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useThreadManagement', () => ({ useThreadManagement: () => ({ folders: [] }) }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({ app: () => ({ getJanDataFolder: async () => null }) }) }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('@/hooks/useSkills', () => ({ useSkills: () => ({ skills: [], invoke: vi.fn() }) }))
vi.mock('@/hooks/useAutoScroll', () => ({ useAutoScroll: () => ({}) }))
vi.mock('@/lib/coworkSubagentRegistry', () => ({ listSubagents: async () => [] }))
vi.mock('@/lib/coworkHandoff', () => ({ peekCoworkHandoff: mocks.handoff, claimCoworkHandoff: () => true, clearCoworkHandoff: vi.fn(), releaseCoworkHandoff: vi.fn() }))
vi.mock('@/lib/agentTools', () => ({ getSandboxStatus: mocks.sandbox, cancelAgentThreadBash: vi.fn(), cancelAgentThreadBashStrict: mocks.cancelShells, activeAgentMonitorIds: async () => null }))
vi.mock('@/lib/coworkAttachments', async (original) => ({ ...await original<typeof import('@/lib/coworkAttachments')>(), importAttachedFiles: async (files: unknown[]) => files }))
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
vi.mock('@/containers/CoworkOverviewPanel', () => ({ CoworkOverviewPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/ConversationHeaderTitle', () => ({ ConversationHeaderTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkComposerMenu', () => ({ CoworkComposerMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/MessageItem', () => ({ MessageItem: (props: Record<string, unknown>) => <div>{['onRegenerate', 'onEdit', 'onRetry', 'onDelete'].map((name) => typeof props[name] === 'function' ? <button key={name}>{name}</button> : null)}</div> }))
vi.mock('@/components/PromptProgress', () => ({ PromptProgress: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ai-elements/conversation', () => ({ Conversation: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, ConversationContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, ConversationScrollButton: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkWorkspacePill', () => ({ CoworkWorkspacePill: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkPlanToggle', () => ({ CoworkPlanToggle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkEmptyState', () => ({ CoworkEmptyState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkArtifactCard', () => ({ CoworkArtifactCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkPreviewPanel', () => ({ CoworkPreviewPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkDiffPanel', () => ({ CoworkDiffPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkTodoPanel', () => ({ CoworkTodoPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkTasksPanel', () => ({ CoworkTasksPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkFilesPanel', () => ({ CoworkFilesPanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/ModelSetting', () => ({ ModelSettingSheet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkBudgetNotice', () => ({ CoworkBudgetNotice: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkRunNotice', () => ({ CoworkRunNotice: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkAskCard', () => ({ CoworkAskCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/containers/CoworkParkedNotice', () => ({ CoworkParkedNotice: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))

let finish: () => void
beforeEach(() => {
  vi.clearAllMocks()
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
