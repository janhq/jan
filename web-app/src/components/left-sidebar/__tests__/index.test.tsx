import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LeftSidebar } from '../index'

vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: vi.fn(() => ({ open: true })),
}))

vi.mock('../NavMain', () => ({
  NavMain: () => <div data-testid="nav-main" />,
}))

vi.mock('../NavChats', () => ({
  NavChats: () => <div data-testid="nav-chats" />,
}))

vi.mock('../NavProjects', () => ({
  NavProjects: () => <div data-testid="nav-projects" />,
}))

vi.mock('@/containers/DownloadManegement', () => ({
  DownloadManagement: () => <div data-testid="download-mgmt" />,
}))

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: any) => <div data-testid="sidebar">{children}</div>,
  SidebarContent: ({ children }: any) => <div data-testid="sidebar-content">{children}</div>,
  SidebarTrigger: (props: any) => <button data-testid="sidebar-trigger" {...props} />,
  SidebarHeader: ({ children }: any) => <div data-testid="sidebar-header">{children}</div>,
  SidebarRail: () => <div data-testid="sidebar-rail" />,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

describe('LeftSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders sidebar structure', () => {
    render(<LeftSidebar />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-header')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-content')).toBeInTheDocument()
  })

  it('renders NavMain in header', () => {
    render(<LeftSidebar />)
    expect(screen.getByTestId('nav-main')).toBeInTheDocument()
  })

  it('shows download management when panel is open', () => {
    render(<LeftSidebar />)
    expect(screen.getByTestId('download-mgmt')).toBeInTheDocument()
  })
})
