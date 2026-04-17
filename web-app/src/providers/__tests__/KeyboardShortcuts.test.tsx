import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KeyboardShortcutsProvider } from '../KeyboardShortcuts'
import { useKeyboardShortcut } from '@/hooks/useHotkeys'

const mockNavigate = vi.fn()
const mockSetLeftPanel = vi.fn()
const mockSetSearchOpen = vi.fn()
const mockSetProjectOpen = vi.fn()
const mockRemoveThread = vi.fn()

vi.mock('@/hooks/useHotkeys', () => ({
  useKeyboardShortcut: vi.fn(),
}))

vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: vi.fn(() => ({
    open: true,
    setLeftPanel: mockSetLeftPanel,
  })),
}))

vi.mock('@/hooks/useSearchDialog', () => ({
  useSearchDialog: vi.fn(() => ({ setOpen: mockSetSearchOpen })),
}))

vi.mock('@/hooks/useProjectDialog', () => ({
  useProjectDialog: vi.fn(() => ({ setOpen: mockSetProjectOpen })),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: vi.fn(() => ({ navigate: mockNavigate })),
}))

vi.mock('@/constants/routes', () => ({
  route: { home: '/', settings: { general: '/settings/general' } },
}))

vi.mock('@/lib/shortcuts', () => ({
  PlatformShortcuts: {
    TOGGLE_SIDEBAR: { key: 'b', metaKey: true },
    NEW_CHAT: { key: 'n', metaKey: true },
    NEW_PROJECT: { key: 'p', metaKey: true },
    GO_TO_SETTINGS: { key: ',', metaKey: true },
    SEARCH: { key: 'k', metaKey: true },
  },
  ShortcutAction: {
    TOGGLE_SIDEBAR: 'TOGGLE_SIDEBAR',
    NEW_CHAT: 'NEW_CHAT',
    NEW_PROJECT: 'NEW_PROJECT',
    GO_TO_SETTINGS: 'GO_TO_SETTINGS',
    SEARCH: 'SEARCH',
  },
}))

vi.mock('@/hooks/useAgentMode', () => ({
  useAgentMode: { getState: vi.fn(() => ({ removeThread: mockRemoveThread })) },
}))

vi.mock('@/constants/chat', () => ({ TEMPORARY_CHAT_ID: 'temp' }))

describe('KeyboardShortcutsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers 5 keyboard shortcuts', () => {
    render(<KeyboardShortcutsProvider />)
    expect(useKeyboardShortcut).toHaveBeenCalledTimes(5)
  })

  it('sidebar shortcut toggles left panel', () => {
    render(<KeyboardShortcutsProvider />)
    // Find the sidebar callback (first call)
    const sidebarCall = vi.mocked(useKeyboardShortcut).mock.calls[0][0]
    sidebarCall.callback()
    expect(mockSetLeftPanel).toHaveBeenCalledWith(false) // toggles from true
  })

  it('new chat shortcut navigates home', () => {
    render(<KeyboardShortcutsProvider />)
    const newChatCall = vi.mocked(useKeyboardShortcut).mock.calls[1][0]
    newChatCall.callback()
    expect(mockRemoveThread).toHaveBeenCalledWith('temp')
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('new project shortcut opens dialog', () => {
    render(<KeyboardShortcutsProvider />)
    const call = vi.mocked(useKeyboardShortcut).mock.calls[2][0]
    call.callback()
    expect(mockSetProjectOpen).toHaveBeenCalledWith(true)
  })

  it('settings shortcut navigates to settings', () => {
    render(<KeyboardShortcutsProvider />)
    const call = vi.mocked(useKeyboardShortcut).mock.calls[3][0]
    call.callback()
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings/general' })
  })

  it('search shortcut opens search', () => {
    render(<KeyboardShortcutsProvider />)
    const call = vi.mocked(useKeyboardShortcut).mock.calls[4][0]
    call.callback()
    expect(mockSetSearchOpen).toHaveBeenCalledWith(true)
  })

  it('renders null', () => {
    const { container } = render(<KeyboardShortcutsProvider />)
    expect(container.innerHTML).toBe('')
  })
})
