import '@testing-library/jest-dom/vitest'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
vi.mock('@/lib/agentTools', () => ({ stopAgentSessionMonitors: vi.fn() }))
vi.mock('@/lib/coworkMonitor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/coworkMonitor')>()),
  dropMonitorLane: vi.fn(),
}))
vi.mock('@/containers/ThreadList', () => ({ ThreadItem: () => null }))
vi.mock('@/containers/dialogs/DeleteAllThreadsDialog', () => ({
  DeleteAllThreadsDialog: () => null,
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

const session = (id: string, title: string): CoworkSession =>
  ({
    id,
    title,
    folder: null,
    turns: [{ role: 'user', content: 'hi' }],
    messages: [],
    updated: Date.now(),
  }) as unknown as CoworkSession

beforeEach(() => {
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
