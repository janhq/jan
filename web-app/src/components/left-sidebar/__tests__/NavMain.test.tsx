import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NavMain } from '../NavMain'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: vi.fn(() => ({
    addFolder: vi.fn().mockResolvedValue({ id: 'new-project' }),
  })),
}))

vi.mock('@/hooks/useSearchDialog', () => ({
  useSearchDialog: vi.fn(() => ({
    open: false,
    setOpen: vi.fn(),
  })),
}))

vi.mock('@/hooks/useProjectDialog', () => ({
  useProjectDialog: vi.fn(() => ({
    open: false,
    setOpen: vi.fn(),
  })),
}))

vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: {
    getState: vi.fn(() => ({
      removeThread: vi.fn(),
      setAgentMode: vi.fn(),
    })),
  },
}))

vi.mock('@/constants/chat', () => ({
  TEMPORARY_CHAT_ID: 'temp-chat',
}))

vi.mock('@/constants/routes', () => ({
  route: {
    home: '/',
    hub: { index: '/hub' },
    settings: { general: '/settings/general' },
  },
}))

vi.mock('@/lib/shortcuts', () => ({
  PlatformShortcuts: {
    NEW_CHAT: { key: 'n' },
    NEW_AGENT_CHAT: { key: 'a' },
    NEW_PROJECT: { key: 'p' },
    SEARCH: { key: 'k' },
  },
  ShortcutAction: {
    NEW_CHAT: 'NEW_CHAT',
    NEW_AGENT_CHAT: 'NEW_AGENT_CHAT',
    NEW_PROJECT: 'NEW_PROJECT',
    SEARCH: 'SEARCH',
  },
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: any) => <div data-testid="sidebar-menu">{children}</div>,
  SidebarMenuButton: ({ children, asChild, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
  SidebarMenuItem: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: any) => <span>{children}</span>,
  KbdGroup: ({ children }: any) => <span>{children}</span>,
}))

vi.mock('@/containers/PlatformMetaKey', () => ({
  PlatformMetaKey: () => <span>Ctrl</span>,
}))

// Mock all animated icons
const mockIcon = vi.fn().mockImplementation(
  ({ className }: any, ref: any) => <span data-testid="icon" className={className} />
)
const forwardRefIcon = vi.fn().mockImplementation(() => <span data-testid="icon" />)

vi.mock('@/components/animated-icon/search', () => ({
  SearchIcon: vi.fn((props: any) => <span data-testid="search-icon" />),
}))
vi.mock('@/components/animated-icon/folder-plus', () => ({
  FolderPlusIcon: vi.fn((props: any) => <span data-testid="folder-icon" />),
}))
vi.mock('@/components/animated-icon/message-circle', () => ({
  MessageCircleIcon: vi.fn((props: any) => <span data-testid="msg-icon" />),
}))
vi.mock('@/components/animated-icon/settings', () => ({
  SettingsIcon: vi.fn((props: any) => <span data-testid="settings-icon" />),
}))
vi.mock('@/components/animated-icon/blocks', () => ({
  BlocksIcon: vi.fn((props: any) => <span data-testid="blocks-icon" />),
}))
vi.mock('@/components/animated-icon/bot', () => ({
  BotIcon: vi.fn((props: any) => <span data-testid="bot-icon" />),
}))

vi.mock('@/containers/dialogs/AddProjectDialog', () => ({
  default: () => <div data-testid="add-project-dialog" />,
}))

vi.mock('@/containers/dialogs/SearchDialog', () => ({
  SearchDialog: () => <div data-testid="search-dialog" />,
}))

describe('NavMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders sidebar menu items', () => {
    render(<NavMain />)
    expect(screen.getByTestId('sidebar-menu')).toBeInTheDocument()
  })

  it('renders nav items with translated labels', () => {
    render(<NavMain />)
    // Should have newChat, newProject, search, hub, settings (newAgentChat filtered out)
    expect(screen.getByText('common:newChat')).toBeInTheDocument()
    expect(screen.getByText('common:search')).toBeInTheDocument()
    expect(screen.getByText('common:hub')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('renders AddProjectDialog and SearchDialog', () => {
    render(<NavMain />)
    expect(screen.getByTestId('add-project-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('search-dialog')).toBeInTheDocument()
  })
})
