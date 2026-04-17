import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, component: config.component }),
}))
vi.mock('@/constants/routes', () => ({ route: { settings: { assistant: '/settings/assistant' } } }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: any) => <div data-testid="header-page">{children}</div> }))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => <div data-testid="settings-menu" /> }))
vi.mock('@/containers/Card', () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardItem: ({ title, actions }: any) => <div data-testid="card-item"><span>{typeof title === 'string' ? title : ''}</span>{actions}</div>,
}))
vi.mock('@/containers/dialogs/AddEditAssistant', () => ({ default: () => <div data-testid="add-edit-assistant" /> }))
vi.mock('@/containers/dialogs', () => ({ DeleteAssistantDialog: () => <div data-testid="delete-dialog" /> }))
vi.mock('@/containers/AvatarEmoji', () => ({ AvatarEmoji: () => <div data-testid="avatar" /> }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...p }: any) => <div role="menuitem" {...p}>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@radix-ui/react-dropdown-menu', () => ({ DropdownMenuSeparator: () => <hr /> }))
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))
vi.mock('lucide-react', () => ({ ChevronsUpDown: () => <span /> }))
vi.mock('@tabler/icons-react', () => ({
  IconCirclePlus: () => <span />, IconPencil: () => <span />, IconTrash: () => <span />,
}))

const mockAssistants = [
  { id: 'a1', name: 'Assistant One', description: 'Desc', avatar: '🤖', created_at: 1 },
  { id: 'a2', name: 'Assistant Two', description: '', avatar: '🧠', created_at: 2 },
]
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: mockAssistants,
    addAssistant: vi.fn(),
    updateAssistant: vi.fn(),
    deleteAssistant: vi.fn(),
    defaultAssistantId: 'a1',
    setDefaultAssistant: vi.fn(),
  }),
}))

global.IS_MACOS = false

import { Route } from '../assistant'

describe('AssistantSettings', () => {
  const Component = Route.component as React.ComponentType

  it('renders header and settings menu', () => {
    render(<Component />)
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('renders assistant names', () => {
    render(<Component />)
    expect(screen.getByText('Assistant One')).toBeInTheDocument()
    expect(screen.getByText('Assistant Two')).toBeInTheDocument()
  })

  it('renders add button', () => {
    render(<Component />)
    expect(screen.getByText('assistants:addAssistant')).toBeInTheDocument()
  })
})
