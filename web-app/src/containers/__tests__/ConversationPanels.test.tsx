import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { ConversationPanelControls, ConversationPanelRail, type ConversationRail } from '../ConversationPanels'
import type { ConversationPanelContent, ConversationPanelKind } from '@/lib/conversationPanels'

vi.mock('motion/react', () => ({ AnimatePresence: ({ children }: any) => <>{children}</> }))

vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({ threadWorkspacePath: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: vi.fn(), useServiceHub: () => ({}) }))
vi.mock('@/containers/CoworkSidePanel', () => ({
  CoworkPanelButton: (p: any) => <button {...p} />,
  CoworkSidePanel: ({ title, onClose, children }: any) => (
    <aside><span>{title}</span><button onClick={onClose}>close</button>{children}</aside>
  ),
}))
vi.mock('@/containers/ChatPreviewPanel', () => ({
  ChatPreviewPanel: ({ path, threadId }: any) => <div data-testid="preview">{path}|{threadId}</div>,
}))
vi.mock('@/containers/CoworkFilesPanel', () => ({ CoworkFilesPanel: ({ artifacts, onPreview }: any) => <div>{artifacts.map((a: any) => <button key={a.path} onClick={() => onPreview(a.path)}>{a.title}</button>)}</div> }))
vi.mock('@/containers/CoworkTasksPanel', () => ({ CoworkTasksPanel: () => <div>tasks-panel</div> }))
vi.mock('@/containers/CoworkTodoPanel', () => ({ CoworkTodoPanel: ({ onClose }: any) => <div>todo-panel<button onClick={onClose}>close</button></div> }))
vi.mock('@/containers/CoworkDiffPanel', () => ({ CoworkDiffPanel: ({ onClose }: any) => <div>diff-panel<button onClick={onClose}>close</button></div> }))

afterEach(cleanup)

const empty: ConversationPanelContent = { todos: undefined, tasks: [], artifacts: [], diffs: [] }
const full: ConversationPanelContent = {
  todos: { phases: [{ name: 'p', tasks: [{ content: 'a', status: 'pending' }] }] },
  tasks: [],
  artifacts: [{ path: '/r/a.html', title: 'a', group: 'Code', label: 'HTML' }],
  diffs: [{ path: '/r/a.html', additions: 1, deletions: 0, operations: [] }],
}

function Harness({ content }: { content: ConversationPanelContent }) {
  const [rail, setRail] = useState<ConversationRail | null>(null)
  const active: ConversationPanelKind | null = rail ? (rail.kind === 'preview' ? 'files' : rail.kind) : null
  return (
    <div>
      <ConversationPanelControls content={content} active={active} panelId="p"
        onToggle={(k) => setRail(active === k ? null : { kind: k })} />
      <ConversationPanelRail threadId="t1" rail={rail} content={content} roots={{ scratch: '/r', folder: null }} panelId="p"
        onSelect={setRail} onClose={() => setRail(null)} />
    </div>
  )
}

describe('ConversationPanels', () => {
  it('renders no controls without settled content', () => {
    const { container } = render(<Harness content={empty} />)
    expect(container.firstElementChild).toBeEmptyDOMElement()
  })
  it('shows only relevant buttons', () => {
    render(<Harness content={{ ...empty, diffs: full.diffs }} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /changes\.title/ })).toHaveAttribute('aria-expanded', 'false')
  })
  it('keeps a single panel, closes on toggle, close button and Escape', async () => {
    const user = userEvent.setup()
    render(<Harness content={full} />)
    await user.click(screen.getByRole('button', { name: 'common:todoPanelTitle' }))
    expect(screen.getByText('todo-panel')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /changes\.title/ }))
    expect(screen.queryByText('todo-panel')).toBeNull()
    expect(screen.getByText('diff-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /changes\.title/ })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByText('close'))
    expect(screen.queryByText('diff-panel')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'common:todoPanelTitle' }))
    screen.getByText('todo-panel').closest('[tabindex]')?.focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('todo-panel')).toBeNull()
  })
  it('previews offered roots through the thread-scoped panel', async () => {
    const user = userEvent.setup()
    render(<Harness content={full} />)
    await user.click(screen.getByRole('button', { name: 'common:overview.files' }))
    await user.click(screen.getByText('a'))
    expect(screen.getByTestId('preview')).toHaveTextContent('/r/a.html|t1')
  })
})
