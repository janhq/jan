import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NavChats } from '../NavChats'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@/hooks/useThreads', () => {
  const store: any = {
    threads: [],
    getFilteredThreads: vi.fn(() => []),
    deleteAllThreads: vi.fn(),
  }
  return {
    useThreads: vi.fn((selector?: any) => {
      if (selector) return selector(store)
      return store
    }),
  }
})

vi.mock('@/containers/ThreadList', () => ({
  default: ({ threads }: any) => (
    <div data-testid="thread-list">{threads.length} threads</div>
  ),
}))

vi.mock('@/containers/dialogs/DeleteAllThreadsDialog', () => ({
  DeleteAllThreadsDialog: () => <div data-testid="delete-dialog" />,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children, ...props }: any) => <div data-testid="sidebar-group" {...props}>{children}</div>,
  SidebarGroupLabel: ({ children }: any) => <div>{children}</div>,
  SidebarMenu: ({ children }: any) => <div>{children}</div>,
  SidebarGroupAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}))

describe('NavChats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders null when no threads without project', () => {
    const { container } = render(<NavChats />)
    expect(container.innerHTML).toBe('')
  })

  it('renders thread list when threads exist', async () => {
    const { useThreads } = await import('@/hooks/useThreads')
    const mockThreads = [{ id: '1', metadata: {} }]
    vi.mocked(useThreads).mockImplementation((selector?: any) => {
      const store = {
        threads: mockThreads,
        getFilteredThreads: vi.fn(() => mockThreads),
        deleteAllThreads: vi.fn(),
      }
      if (selector) return selector(store)
      return store
    })

    render(<NavChats />)
    expect(screen.getByTestId('thread-list')).toBeInTheDocument()
  })
})
