import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  mobile: true,
  // Mutable so a test can customise the sidebar shortcut.
  sidebar: { key: 'b', metaKey: true, ctrlKey: false } as Record<string, unknown>,
}))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => h.mobile }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    state: { location: { pathname: '/' } },
    navigate: vi.fn(),
  }),
}))
vi.mock('@/hooks/useSearchDialog', () => ({
  useSearchDialog: () => ({ setOpen: vi.fn() }),
}))
vi.mock('@/hooks/useProjectDialog', () => ({
  useProjectDialog: () => ({ setOpen: vi.fn() }),
}))
vi.mock('@/hooks/useMessageZoom', () => ({ useMessageZoom: () => {} }))
vi.mock('@/lib/shortcuts', () => ({
  isMac: true,
  ShortcutAction: {
    TOGGLE_SIDEBAR: 'toggleSidebar',
    NEW_CHAT: 'newChat',
    NEW_PROJECT: 'newProject',
    GO_TO_SETTINGS: 'goSettings',
    SEARCH: 'search',
    SWITCH_ASSISTANT: 'switchAssistant',
  },
  PlatformShortcuts: new Proxy(
    {},
    {
      get: (_t, action) =>
        action === 'toggleSidebar'
          ? h.sidebar
          : { key: `unused-${String(action)}`, metaKey: true },
    }
  ),
}))

import { Sidebar, SidebarProvider } from '@/components/ui/sidebar'
import { KeyboardShortcutsProvider } from '@/providers/KeyboardShortcuts'

function renderApp({ builtin }: { builtin: boolean }, onOpenChange = vi.fn()) {
  render(
    <SidebarProvider
      open
      onOpenChange={onOpenChange}
      keyboardShortcut={builtin}
    >
      <KeyboardShortcutsProvider />
      <Sidebar collapsible="offcanvas">
        <span>Nav</span>
      </Sidebar>
    </SidebarProvider>
  )
  return onOpenChange
}

const press = (init: KeyboardEventInit) =>
  fireEvent.keyDown(window, init)

beforeEach(() => {
  h.mobile = true
  h.sidebar = { key: 'b', metaKey: true, ctrlKey: false }
})
afterEach(cleanup)

describe('sidebar shortcut ownership (root wiring)', () => {
  it('one default keypress toggles the mobile overlay exactly once', () => {
    renderApp({ builtin: false })
    press({ key: 'b', metaKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    press({ key: 'b', metaKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('one default keypress toggles the desktop sidebar exactly once', () => {
    h.mobile = false
    const onOpenChange = renderApp({ builtin: false })
    press({ key: 'b', metaKey: true })
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('a customised shortcut works and the old default leaves no ghost handler', () => {
    h.sidebar = { key: 'k', metaKey: true, ctrlKey: false }
    for (const mobile of [true, false]) {
      h.mobile = mobile
      const onOpenChange = renderApp({ builtin: false })
      press({ key: 'b', metaKey: true })
      press({ key: 'b', ctrlKey: true })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onOpenChange).not.toHaveBeenCalled()

      press({ key: 'k', metaKey: true })
      if (mobile) expect(screen.getByRole('dialog')).toBeInTheDocument()
      else expect(onOpenChange).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('a standalone provider keeps its built-in Cmd/Ctrl+B', () => {
    h.mobile = false
    const onOpenChange = vi.fn()
    render(<SidebarProvider open onOpenChange={onOpenChange} />)
    act(() => {
      press({ key: 'b', ctrlKey: true })
    })
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })
})
