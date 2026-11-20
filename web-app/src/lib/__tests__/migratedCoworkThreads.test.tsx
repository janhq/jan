import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { ReactNode } from 'react'
import type { CoworkSession } from '@/hooks/useCoworkSessions'

// Only what ThreadList needs from the shell is faked; the thread service, the
// thread store and the list row are main's real code.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    'data-testid': testId,
  }: {
    children: ReactNode
    className?: string
    'data-testid'?: string
  }) => (
    <a className={className} data-testid={testId}>
      {children}
    </a>
  ),
  useParams: ({ select }: { select?: (p: { threadId?: string }) => unknown } = {}) =>
    select ? select({ threadId: undefined }) : { threadId: undefined },
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ folders: [], getFolderById: vi.fn() }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ path: () => ({ sep: () => '/' }) }),
  useServiceHub: () => ({
    messages: () => ({ fetchMessages: async () => [] }),
  }),
}))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuAction: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  useSidebar: () => ({ isMobile: false }),
}))
vi.mock('@/components/ui/dropdown-menu', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem: Passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
  }
})
vi.mock('@/containers/dialogs', () => ({
  RenameThreadDialog: () => null,
  DeleteThreadDialog: () => null,
}))
vi.mock('@/containers/extensions/ContributedMenuItems', () => ({
  ContributedMenuItems: () => null,
}))
// The thread store imports the agent-tools plugin only for delete cleanup.
vi.mock('@/lib/agentTools', () => ({
  cleanupThreadWorkspace: vi.fn(),
}))

import ThreadList from '@/containers/ThreadList'
import { useThreads } from '@/hooks/useThreads'
import { DefaultThreadsService } from '@/services/threads/default'
import { sessionToThread } from '../migrateCoworkSessions'

const session = (extra: Partial<CoworkSession> = {}) =>
  ({
    id: 'cowork-1',
    title: 'Refactor the parser',
    model: { id: 'gpt-5', provider: 'openai' },
    folder: '/work/proj',
    turns: [{ role: 'user', content: 'hi' }],
    messages: [],
    updated: 1_700_000_000_000,
    planMode: true,
    goal: { condition: 'tests pass', turns: 2, status: 'active', lastReason: '' },
    ...extra,
  }) as unknown as CoworkSession

// What the backend hands back: the stored record after a JSON round trip.
const asStored = (s: CoworkSession): unknown =>
  JSON.parse(JSON.stringify(sessionToThread(s)))

const listThreads = vi.fn()

describe('a migrated Cowork thread in the main thread list', () => {
  beforeEach(() => {
    listThreads.mockReset()
    ;(window as unknown as { core: unknown }).core = { api: { listThreads } }
    useThreads.setState({ threads: {}, searchIndex: null })
  })

  it('survives fetchThreads with its cowork metadata and a seconds timestamp', async () => {
    listThreads.mockResolvedValue([asStored(session())])
    const [thread] = await new DefaultThreadsService().fetchThreads()
    expect(thread.id).toBe('cowork-1')
    expect(thread.updated).toBe(1_700_000_000)
    expect(thread.model).toEqual({ id: 'gpt-5', provider: 'openai' })
    expect(thread.metadata?.mode).toBe('cowork')
    expect(thread.metadata?.folder).toBe('/work/proj')
    expect(thread.metadata?.project).toBeUndefined()
  })

  it('is stored and listed as a normal chat, searchable by title', async () => {
    listThreads.mockResolvedValue([
      asStored(session()),
      asStored(session({ id: 'cowork-2', title: 'Other', model: undefined, folder: null })),
    ])
    useThreads.getState().setThreads(await new DefaultThreadsService().fetchThreads())

    const listed = useThreads.getState().getFilteredThreads('')
    expect(listed.map((t) => t.id).sort()).toEqual(['cowork-1', 'cowork-2'])
    expect(useThreads.getState().getFilteredThreads('parser').map((t) => t.id)).toEqual([
      'cowork-1',
    ])
  })

  it('renders as a row, including a session that never chose a model or folder', async () => {
    listThreads.mockResolvedValue([
      asStored(session()),
      asStored(session({ id: 'cowork-2', title: 'No model', model: undefined, folder: null })),
    ])
    useThreads.getState().setThreads(await new DefaultThreadsService().fetchThreads())

    await act(async () => {
      render(<ThreadList threads={useThreads.getState().getFilteredThreads('')} />)
    })
    expect(screen.getByTestId('thread-row-cowork-1')).toHaveTextContent('Refactor the parser')
    expect(screen.getByTestId('thread-row-cowork-2')).toHaveTextContent('No model')
  })
})
