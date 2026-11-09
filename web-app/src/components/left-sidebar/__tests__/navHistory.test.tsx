import '@testing-library/jest-dom/vitest'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  sessionId: undefined as string | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useParams: ({ select }: { select?: (p: unknown) => unknown }) => {
    const params = { sessionId: router.sessionId }
    return select ? select(params) : params
  },
}))
// A stable `t`: RenameThreadDialog re-seeds its input whenever `t` changes.
const t = (key: string) => key
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t }),
}))
vi.mock('@/lib/backendStorage', () => {
  const store = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }
  return { backendStorage: store, default: store }
})
// Not the dev server: the old gate let `isDev()` through, which hid the bug.
vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils')>()),
  isDev: () => false,
}))
vi.mock('@/lib/agentTools', () => ({
  stopAgentSessionMonitors: vi.fn(),
  cancelAgentThreadBash: vi.fn(),
}))
vi.mock('@/lib/coworkRunner', () => ({ abortRun: vi.fn() }))
vi.mock('@/lib/coworkMonitor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/coworkMonitor')>()),
  dropMonitorLane: vi.fn(),
}))
vi.mock('@/containers/ThreadList', () => ({
  ThreadItem: ({ thread }: { thread: { id: string } }) => <li data-testid={`thread-${thread.id}`} />,
}))
const projects = vi.hoisted(() => ({
  folders: [] as { id: string }[],
  foldersLoaded: true,
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => projects,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/containers/dialogs/DeleteAllThreadsDialog', () => ({
  DeleteAllThreadsDialog: () => <div data-testid="delete-all" />,
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    onSelect?: () => void
  }) => (
    <button role="menuitem" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}))
vi.mock('@/components/ui/sidebar', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Btn = (props: ComponentProps<'button'> & { showOnHover?: boolean; isActive?: boolean }) => {
    const { showOnHover, isActive, ...rest } = props
    void showOnHover
    void isActive
    return <button {...rest} />
  }
  return {
    SidebarGroup: Box,
    SidebarGroupLabel: Box,
    SidebarGroupAction: Btn,
    SidebarMenu: ({ children }: { children?: ReactNode }) => <ul>{children}</ul>,
    SidebarMenuItem: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
    SidebarMenuButton: Btn,
    SidebarMenuAction: Btn,
    useSidebar: () => ({ isMobile: false }),
  }
})

import { NavHistory } from '../NavHistory'
import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'

const session = (id: string, title: string): CoworkSession =>
  ({
    id,
    title,
    folder: null,
    turns: [{ role: 'user', content: 'hi' }],
    messages: [],
    updated: Date.now(),
  }) as unknown as CoworkSession

const ids = () => useCoworkSessions.getState().sessions.map((s) => s.id)

function deleteRow(id: string) {
  const row = screen.getByTestId(`history-cowork-${id}`).closest('li') as HTMLElement
  fireEvent.click(within(row).getByRole('menuitem', { name: 'common:deleteSession' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common:delete' }))
}

beforeEach(() => {
  projects.folders = []
  projects.foldersLoaded = true
  useThreads.setState({ threads: {} })
  router.navigate.mockClear()
  router.sessionId = undefined
  useCoworkSessions.setState({ sessions: [session('open', 'Open one'), session('other', 'Other one')] })
})

describe('NavHistory legacy Cowork sessions', () => {
  // vitest defines VERSION as 'test', i.e. a stable-style build with no channel
  // suffix: sessions used to be hidden here.
  it('lists legacy Cowork sessions on every channel, including stable', () => {
    render(<NavHistory />)
    expect(screen.getByTestId('history-cowork-open')).toBeInTheDocument()
    expect(screen.getByTestId('history-cowork-other')).toBeInTheDocument()
  })
})

describe('NavHistory delete Cowork session', () => {
  it('leaves the route and removes the session when the open conversation is deleted', () => {
    router.sessionId = 'open'
    render(<NavHistory />)
    deleteRow('open')
    expect(router.navigate).toHaveBeenCalledTimes(1)
    expect(router.navigate).toHaveBeenCalledWith({ to: route.home })
    expect(route.home).toBe('/')
    expect(ids()).toEqual(['other'])
  })

  it('stops the run, its shell and its monitors before removing the session', async () => {
    const { abortRun } = await import('@/lib/coworkRunner')
    const { cancelAgentThreadBash, stopAgentSessionMonitors } = await import('@/lib/agentTools')
    useCoworkRun.setState({ runId: { other: 'run-1' } } as never)
    render(<NavHistory />)
    deleteRow('other')
    expect(abortRun).toHaveBeenCalledWith('other')
    expect(cancelAgentThreadBash).toHaveBeenCalledWith('other')
    expect(stopAgentSessionMonitors).toHaveBeenCalledWith('other')
    expect(ids()).toEqual(['open'])
  })

  it('keeps rows keyed apart when a chat thread and a collision placeholder share an id', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    useThreads.setState({ threads: { other: { id: 'other', title: 'Chat', updated: 1, messages: [] } as never } })
    useCoworkSessions.setState({
      sessions: [session('open', 'Open one'), { ...session('other', 'Other one'), unavailable: 'id-collision' }],
    })
    render(<NavHistory />)
    expect(screen.getByTestId('thread-other')).toBeInTheDocument()
    expect(screen.getByTestId('history-cowork-other')).toBeInTheDocument()
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    errors.mockRestore()
  })

  it('stays on the current route when a different conversation is deleted', () => {
    router.sessionId = 'open'
    render(<NavHistory />)
    deleteRow('other')
    expect(router.navigate).not.toHaveBeenCalled()
    expect(ids()).toEqual(['open'])
  })
})

describe('NavHistory rename Cowork session', () => {
  it('renames a session through the session store', () => {
    render(<NavHistory />)
    const row = screen.getByTestId('history-cowork-open').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('menuitem', { name: 'common:rename' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  Renamed one  ' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common:rename' }))
    const renamed = useCoworkSessions.getState().sessions.find((s) => s.id === 'open')
    expect(renamed?.title).toBe('Renamed one')
    expect(useCoworkSessions.getState().sessions.find((s) => s.id === 'other')?.title).toBe('Other one')
  })
})

describe('NavHistory threads that point at a project', () => {
  const thread = (id: string, projectId?: string) =>
    ({ id, title: id, updated: 1, metadata: projectId ? { project: { id: projectId, name: 'P' } } : {} }) as never

  beforeEach(() => {
    useThreads.setState({
      threads: {
        plain: thread('plain'),
        homed: thread('homed', 'p1'),
        orphan: thread('orphan', 'missing'),
      },
    })
  })

  it('lists a thread whose project no longer exists, and hides one whose project does', () => {
    projects.folders = [{ id: 'p1' }]
    render(<NavHistory />)
    expect(screen.getByTestId('thread-plain')).toBeInTheDocument()
    expect(screen.getByTestId('thread-orphan')).toBeInTheDocument()
    expect(screen.queryByTestId('thread-homed')).not.toBeInTheDocument()
  })

  it('hides project threads until the project list has loaded', () => {
    projects.foldersLoaded = false
    render(<NavHistory />)
    expect(screen.queryByTestId('thread-orphan')).not.toBeInTheDocument()
    expect(screen.queryByTestId('thread-homed')).not.toBeInTheDocument()
    expect(screen.getByTestId('thread-plain')).toBeInTheDocument()
  })
})

describe('NavHistory rename availability', () => {
  it.each(['missing-sidecar', 'unreadable-sidecar', 'id-collision', 'missing-thread'] as const)(
    'does not offer Rename for an unavailable session (%s), only Delete',
    (unavailable) => {
      useCoworkSessions.setState({
        sessions: [{ ...session('open', 'Open one'), unavailable }],
      })
      render(<NavHistory />)
      const row = screen.getByTestId('history-cowork-open').closest('li') as HTMLElement
      expect(within(row).queryByRole('menuitem', { name: 'common:rename' })).toBeNull()
      expect(within(row).getByRole('menuitem', { name: 'common:deleteSession' })).toBeInTheDocument()
    }
  )
})

describe('NavHistory Delete All is offered only when it would delete something', () => {
  const t = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, title: id, updated: 1, metadata: {}, ...extra }) as never
  const orphan = (id: string) => t(id, { metadata: { project: { id: 'gone', name: 'P' } } })

  beforeEach(() => useCoworkSessions.setState({ sessions: [] }))

  it('is not offered for orphan-project threads, which Delete All keeps', () => {
    useThreads.setState({ threads: { a: orphan('a'), b: orphan('b'), c: orphan('c') } })
    render(<NavHistory />)
    expect(screen.getByTestId('thread-a')).toBeInTheDocument()
    expect(screen.queryByTestId('delete-all')).not.toBeInTheDocument()
  })

  it('is not offered for favorites only', () => {
    useThreads.setState({ threads: { a: t('a', { isFavorite: true }), b: t('b', { isFavorite: true }) } })
    render(<NavHistory />)
    expect(screen.queryByTestId('delete-all')).not.toBeInTheDocument()
  })

  it('is offered once two deletable chats exist, whatever else is listed', () => {
    useThreads.setState({ threads: { a: t('a'), b: t('b'), c: orphan('c') } })
    render(<NavHistory />)
    expect(screen.getByTestId('delete-all')).toBeInTheDocument()
  })
})

describe('NavHistory one row per conversation (write-through mirror)', () => {
  const mirror = (id: string, title: string) =>
    ({ id, title, updated: 1, metadata: { mode: 'cowork' } }) as never

  it('lists a session that is also mirrored into the thread list exactly once', () => {
    useThreads.setState({ threads: { open: mirror('open', 'Open one'), other: mirror('other', 'Other one') } })
    render(<NavHistory />)
    expect(screen.getAllByTestId('history-cowork-open')).toHaveLength(1)
    expect(screen.getAllByTestId('history-cowork-other')).toHaveLength(1)
    expect(screen.queryByTestId('thread-open')).not.toBeInTheDocument()
  })

  it('shows the session title for a mirrored row and routes it to the Cowork view', () => {
    useThreads.setState({ threads: { open: mirror('open', 'Stale mirror title') } })
    useCoworkSessions.setState({ sessions: [session('open', 'Live title')] })
    render(<NavHistory />)
    const row = screen.getByTestId('history-cowork-open')
    expect(row).toHaveTextContent('Live title')
    fireEvent.click(row)
    expect(router.navigate).toHaveBeenCalledWith({ to: route.coworkSession, params: { sessionId: 'open' } })
  })

  it('lists a mirrored Cowork thread whose session is not in the store', () => {
    useCoworkSessions.setState({ sessions: [] })
    useThreads.setState({ threads: { solo: mirror('solo', 'Solo') } })
    render(<NavHistory />)
    expect(screen.getByTestId('history-cowork-solo')).toHaveTextContent('Solo')
  })

  it('deletes a mirrored session through the session store', () => {
    useThreads.setState({ threads: { open: mirror('open', 'Open one'), other: mirror('other', 'Other one') } })
    render(<NavHistory />)
    deleteRow('other')
    expect(ids()).toEqual(['open'])
  })

  it('deletes a mirrored thread that has no live session through the thread list', () => {
    useCoworkSessions.setState({ sessions: [] })
    const deleteThread = vi.fn()
    useThreads.setState({ threads: { solo: mirror('solo', 'Solo') }, deleteThread } as never)
    render(<NavHistory />)
    deleteRow('solo')
    expect(deleteThread).toHaveBeenCalledWith('solo')
  })

  it('removes only the placeholder when a collision row is deleted, leaving the chat', () => {
    const deleteThread = vi.fn()
    useThreads.setState({ threads: { other: { id: 'other', title: 'Chat', updated: 1 } as never }, deleteThread } as never)
    useCoworkSessions.setState({
      sessions: [{ ...session('other', 'Placeholder'), unavailable: 'id-collision' }],
    })
    render(<NavHistory />)
    deleteRow('other')
    expect(ids()).toEqual([])
    expect(deleteThread).not.toHaveBeenCalled()
  })
})
