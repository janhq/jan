import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SamplerPopover } from '../SamplerPopover'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'

const { persistAssistant, persistThread, errorToast } = vi.hoisted(() => ({
  persistAssistant: vi.fn(), persistThread: vi.fn(), errorToast: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({
  assistants: () => ({ createAssistant: persistAssistant }),
  threads: () => ({ updateThread: persistThread }),
}) }))
vi.mock('sonner', () => ({ toast: { error: errorToast } }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/AssistantsMenu', () => ({ AssistantsMenu: () => null }))
vi.mock('@/containers/AvatarEmoji', () => ({ AvatarEmoji: () => null }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}))
vi.mock('@/containers/ParametersSection', () => ({ ParametersSection: ({ params, onChange }: {
  params: Record<string, unknown>; onChange: (key: string, value: unknown) => void
}) => <input aria-label="temperature" value={String(params.temperature ?? '')} onChange={(event) => onChange('temperature', event.target.value)} /> }))

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const assistant = (id: string): Assistant => ({ id, name: id, parameters: { temperature: '0.5' }, created_at: 1 })
function Harness() {
  const thread = useThreads((state) => state.threads[state.currentThreadId ?? ''])
  const assistants = useAssistant((state) => state.assistants)
  return <SamplerPopover hideTrigger open assistantSwitcher={{
    assistants, currentThread: thread, selectedAssistantId: thread?.assistants?.[0]?.id,
    setSelectedAssistantId: vi.fn(), updateCurrentThreadAssistant: useThreads.getState().updateCurrentThreadAssistant,
  }} />
}
function change(value: string) {
  fireEvent.change(screen.getByLabelText('temperature'), { target: { value } })
}
beforeEach(() => {
  vi.clearAllMocks()
  persistAssistant.mockResolvedValue(undefined)
  persistThread.mockResolvedValue(undefined)
  const a = assistant('a'), b = assistant('b')
  useAssistant.setState({ assistants: [a, b], currentAssistant: a, loading: false })
  useThreads.setState({ threads: {
    A: { id: 'A', assistants: [a] }, B: { id: 'B', assistants: [b] },
  }, currentThreadId: 'A' })
})
describe('SamplerPopover asynchronous sampling', () => {
  it('saves captured A without changing B after navigation', async () => {
    const pending = deferred()
    persistAssistant.mockReturnValueOnce(pending.promise)
    render(<Harness />)
    change('0.7')
    act(() => useThreads.getState().setCurrentThreadId('B'))
    await act(async () => pending.resolve())
    await waitFor(() => expect(useThreads.getState().threads.A.assistants?.[0].parameters?.temperature).toBe('0.7'))
    expect(useThreads.getState().threads.B.assistants?.[0].parameters?.temperature).toBe('0.5')
    expect(screen.getByLabelText('temperature')).toHaveValue('0.5')
  })
  it('does not overwrite a new assistant selection on A', async () => {
    const pending = deferred()
    persistAssistant.mockReturnValueOnce(pending.promise)
    render(<Harness />)
    change('0.7')
    const replacement = assistant('b')
    act(() => useThreads.setState({ threads: { A: { id: 'A', assistants: [replacement] } } }))
    await act(async () => pending.resolve())
    expect(useThreads.getState().threads.A.assistants?.[0]).toBe(replacement)
    expect(persistThread).not.toHaveBeenCalled()
    expect(screen.getByLabelText('temperature')).toHaveValue('0.5')
  })
  it('also guards a new snapshot with the same assistant ID', async () => {
    const pending = deferred()
    persistAssistant.mockReturnValueOnce(pending.promise)
    render(<Harness />)
    change('0.7')
    const replacement = assistant('a')
    act(() => useThreads.setState({ threads: { A: { id: 'A', assistants: [replacement] } } }))
    await act(async () => pending.resolve())
    expect(useThreads.getState().threads.A.assistants?.[0]).toBe(replacement)
    expect(persistThread).not.toHaveBeenCalled()
  })
  it('keeps thread UI truthful when thread persistence rejects', async () => {
    persistThread.mockRejectedValueOnce(new Error('thread write failed'))
    render(<Harness />)
    change('0.7')
    await waitFor(() => expect(errorToast).toHaveBeenCalled())
    expect(screen.getByLabelText('temperature')).toHaveValue('0.5')
    change('0.9')
    await waitFor(() => expect(useThreads.getState().threads.A.assistants?.[0].parameters?.temperature).toBe('0.9'))
  })
  it('coalesces rapid edits with immediate drafts and persists the last value', async () => {
    const pending = deferred()
    persistAssistant.mockReturnValueOnce(pending.promise)
    render(<Harness />)
    change('0.6'); change('0.7'); change('0.8')
    expect(screen.getByLabelText('temperature')).toHaveValue('0.8')
    expect(persistAssistant).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve())
    await waitFor(() => expect(persistAssistant).toHaveBeenCalledTimes(2))
    expect(persistAssistant.mock.calls[1][0].parameters.temperature).toBe('0.8')
    expect(useThreads.getState().threads.A.assistants?.[0].parameters?.temperature).toBe('0.8')
  })
  it('rolls back rejected drafts, reports an actionable error, and permits retry', async () => {
    const pending = deferred()
    persistAssistant.mockReturnValueOnce(pending.promise)
    render(<Harness />)
    change('0.7')
    await act(async () => pending.reject(new Error('disk full')))
    expect(errorToast).toHaveBeenCalledWith(expect.stringContaining('Please try again'), { description: 'disk full' })
    expect(screen.getByLabelText('temperature')).toHaveValue('0.5')
    change('0.9')
    await waitFor(() => expect(useThreads.getState().threads.A.assistants?.[0].parameters?.temperature).toBe('0.9'))
  })
})
