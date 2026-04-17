import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NavProjects } from '../NavProjects'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: vi.fn(() => ({
    folders: [],
    updateFolder: vi.fn(),
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: any) => <a href={to}>{children}</a>,
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children, ...props }: any) => <div data-testid="sidebar-group" {...props}>{children}</div>,
  SidebarGroupLabel: ({ children }: any) => <div>{children}</div>,
  SidebarMenu: ({ children }: any) => <div>{children}</div>,
  SidebarMenuButton: ({ children, asChild, ...props }: any) => <button {...props}>{children}</button>,
  SidebarMenuItem: ({ children }: any) => <div>{children}</div>,
  SidebarMenuAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  useSidebar: vi.fn(() => ({ isMobile: false })),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...props }: any) => (
    <div role="menuitem" onClick={onSelect} {...props}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/containers/dialogs/AddProjectDialog', () => ({
  default: () => <div data-testid="add-project-dialog" />,
}))

vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => <div data-testid="delete-project-dialog" />,
}))

describe('NavProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders null when no folders', () => {
    const { container } = render(<NavProjects />)
    expect(container.innerHTML).toBe('')
  })

  it('renders projects when folders exist', async () => {
    const { useThreadManagement } = await import('@/hooks/useThreadManagement')
    vi.mocked(useThreadManagement).mockReturnValue({
      folders: [{ id: 'p1', name: 'Project 1' }],
      updateFolder: vi.fn(),
    } as any)

    render(<NavProjects />)
    expect(screen.getByText('Project 1')).toBeInTheDocument()
  })
})
