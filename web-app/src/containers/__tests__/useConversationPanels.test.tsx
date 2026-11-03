import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import type { UIMessage } from 'ai'
import { useConversationPanels } from '../ConversationPanels'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'

const { folders, getDataFolder, workspacePath, fakeThreads } = vi.hoisted(() => ({
  folders: { current: {} as Record<string, string | null> },
  getDataFolder: vi.fn(),
  workspacePath: vi.fn(),
  fakeThreads: { current: null as any },
}))

// A minimal store stands in for the effective (overlay) grant so no native or
// persistence call can run; the real revoke semantics live in the useThreads tests.
vi.mock('@/hooks/useThreads', async () => {
  const { create } = await import('zustand')
  const store = create<{
    folders: Record<string, string | null>
    getConversationCapabilities: (id: string) => { folderScope: { path: string } | null }
  }>((_set, get) => ({
    folders: {},
    getConversationCapabilities: (id) => {
      const path = get().folders[id]
      return { folderScope: path ? { path } : null }
    },
  }))
  fakeThreads.current = store
  return { useThreads: store }
})
vi.mock('motion/react', () => ({ AnimatePresence: ({ children }: any) => <>{children}</> }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({ threadWorkspacePath: workspacePath }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ app: () => ({ getJanDataFolder: getDataFolder }) }),
  useServiceHub: () => ({}),
}))
vi.mock('@/containers/CoworkSidePanel', () => ({
  CoworkPanelButton: (p: any) => <button {...p} />,
  CoworkSidePanel: ({ children }: any) => <aside>{children}</aside>,
}))
vi.mock('@/containers/CoworkPreviewPanel', () => ({
  CoworkPreviewPanel: ({ path, roots }: any) => (
    <div data-testid="preview">{path}|{roots.filter(Boolean).join(',')}</div>
  ),
}))
vi.mock('@/containers/CoworkFilesPanel', () => ({
  CoworkFilesPanel: ({ artifacts, onPreview }: any) => (
    <div data-testid="files">
      {artifacts.map((a: any) => (
        <button key={a.path} onClick={() => onPreview(a.path)}>{a.path}</button>
      ))}
    </div>
  ),
}))
vi.mock('@/containers/CoworkTasksPanel', () => ({ CoworkTasksPanel: () => <div>tasks-panel</div> }))
vi.mock('@/containers/CoworkTodoPanel', () => ({ CoworkTodoPanel: () => <div>todo-panel</div> }))
vi.mock('@/containers/CoworkDiffPanel', () => ({
  CoworkDiffPanel: ({ files }: any) => <div data-testid="diff-panel">{files.map((f: any) => f.path).join(',')}</div>,
}))

const write = (path: string, id = `write-${path}`, withDiff = true): any => ({
  type: 'tool-write',
  toolCallId: id,
  state: 'output-available',
  input: { path },
  output: withDiff ? `@@ created file @@\n+ hi\nCreated ${path} (2 bytes)` : `Created ${path} (2 bytes)`,
})
const msgs = (...parts: any[]): UIMessage[] => [{ id: 'a', role: 'assistant', parts } as UIMessage]

function Host({ threadId, messages }: { threadId: string; messages: readonly UIMessage[] }) {
  const { controls, rail } = useConversationPanels({ threadId, messages })
  return <div>{controls}{rail}</div>
}

// Exposes the raw hook result so the test can assert on the value, not on markup.
const seen: { controls: unknown } = { controls: undefined }
function Probe({ threadId, messages }: { threadId: string; messages: readonly UIMessage[] }) {
  seen.controls = useConversationPanels({ threadId, messages }).controls
  return null
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const setFolder = (id: string, path: string | null) =>
  act(() => fakeThreads.current.setState((s: any) => ({ folders: { ...s.folders, [id]: path } })))

beforeEach(() => {
  getDataFolder.mockResolvedValue('/data')
  workspacePath.mockImplementation(async (_d: string, id: string) => `/scratch/${id}`)
  useToolCallRuntime.setState({ diffs: {}, timings: {}, queue: [] } as any)
  fakeThreads.current.setState({ folders: {} })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useConversationPanels', () => {
  it('closes files and preview as soon as the effective folder grant is revoked', async () => {
    const user = userEvent.setup()
    const messages = msgs(write('/proj/a.html', 'w1'))
    await setFolder('t1', '/proj')
    render(<Host threadId="t1" messages={messages} />)

    await user.click(screen.getByRole('button', { name: 'common:overview.files' }))
    await user.click(screen.getByRole('button', { name: '/proj/a.html' }))
    expect(screen.getByTestId('preview')).toHaveTextContent('/proj/a.html|/scratch/t1,/proj')

    await setFolder('t1', null)
    expect(screen.queryByTestId('preview')).toBeNull()
    expect(screen.queryByTestId('files')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common:overview.files' })).toBeNull()

    // Content is derived from the same canonical messages, so a new grant
    // makes the control available again, but the earlier request is forgotten:
    // nothing reopens by itself.
    await setFolder('t1', '/proj')
    expect(screen.getByRole('button', { name: 'common:overview.files' })).toBeInTheDocument()
    expect(screen.queryByTestId('preview')).toBeNull()
    expect(screen.queryByTestId('files')).toBeNull()
  })

  it('returns plain null controls when no panel kind is available', async () => {
    render(<Probe threadId="t1" messages={msgs({ type: 'text', text: 'hi' })} />)
    await act(async () => {})
    expect(seen.controls).toBeNull()
  })

  it('stays closed when content disappears and then returns', async () => {
    const user = userEvent.setup()
    await setFolder('t1', '/proj')
    const withFile = msgs(write('/proj/a.html', 'w1'))
    const view = render(<Host threadId="t1" messages={withFile} />)
    await user.click(screen.getByRole('button', { name: 'common:overview.files' }))
    expect(screen.getByTestId('files')).toBeInTheDocument()

    view.rerender(<Host threadId="t1" messages={msgs({ type: 'text', text: 'rewound' })} />)
    expect(screen.queryByTestId('files')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common:overview.files' })).toBeNull()

    view.rerender(<Host threadId="t1" messages={withFile} />)
    expect(screen.getByRole('button', { name: 'common:overview.files' })).toBeInTheDocument()
    expect(screen.queryByTestId('files')).toBeNull()
  })

  it('narrowing to another folder drops preview of the old folder', async () => {
    const user = userEvent.setup()
    await setFolder('t1', '/proj')
    render(<Host threadId="t1" messages={msgs(write('/proj/a.html', 'w1'))} />)
    await user.click(screen.getByRole('button', { name: 'common:overview.files' }))
    await user.click(screen.getByRole('button', { name: '/proj/a.html' }))
    await setFolder('t1', '/other')
    expect(screen.queryByTestId('preview')).toBeNull()
  })

  it('ignores a stale scratch-root result after a thread switch', async () => {
    const user = userEvent.setup()
    const a = deferred<string>()
    workspacePath.mockImplementation((_d: string, id: string) =>
      id === 'A' ? a.promise : Promise.resolve(`/scratch/${id}`)
    )
    const messages = msgs(write('/scratch/A/a.html', 'wa'), write('/scratch/B/b.html', 'wb'))
    const view = render(<Host threadId="A" messages={messages} />)
    await act(async () => {})
    view.rerender(<Host threadId="B" messages={messages} />)
    await act(async () => {})
    // B's own root resolved; only B's artifact is reachable.
    await user.click(screen.getByRole('button', { name: 'common:overview.files' }))
    expect(screen.getByRole('button', { name: '/scratch/B/b.html' })).toBeInTheDocument()

    // A's old native result lands late and must not widen B's roots.
    await act(async () => {
      a.resolve('/scratch/A')
    })
    expect(screen.queryByRole('button', { name: '/scratch/A/a.html' })).toBeNull()
    expect(screen.getByRole('button', { name: '/scratch/B/b.html' })).toBeInTheDocument()
  })

  it('exposes no previous-thread scratch root for the render right after a switch', async () => {
    const messages = msgs(write('/scratch/A/a.html', 'wa'))
    const view = render(<Host threadId="A" messages={messages} />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'common:overview.files' })).toBeInTheDocument()
    workspacePath.mockImplementation(() => new Promise(() => {}))
    view.rerender(<Host threadId="B" messages={messages} />)
    expect(screen.queryByRole('button', { name: 'common:overview.files' })).toBeNull()
  })

  it('fails closed when the scratch root cannot be resolved', async () => {
    workspacePath.mockRejectedValue(new Error('native down'))
    render(<Host threadId="t1" messages={msgs(write('/scratch/t1/a.html', 'w1'))} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'common:overview.files' })).toBeNull()
  })

  it('projects runtime diffs only for calls owned by this thread', async () => {
    // Same call ID, no diff in the canonical output: only a runtime diff can supply one.
    const messages = msgs(write('/scratch/t1/a.txt', 'dup', false))
    useToolCallRuntime.setState({
      diffs: { dup: '@@ runtime @@\n+ x' },
      timings: { dup: { owner: 'other' } },
    } as any)
    render(<Host threadId="t1" messages={messages} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /changes\.title/ })).toBeNull()

    act(() => useToolCallRuntime.setState({ timings: { dup: { owner: 't1' } } } as any))
    expect(screen.getByRole('button', { name: /changes\.title/ })).toBeInTheDocument()
  })
})
