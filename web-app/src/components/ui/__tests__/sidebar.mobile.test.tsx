import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const viewport = vi.hoisted(() => ({ mobile: true }))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => viewport.mobile }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: () => ({ open: true, setLeftPanel: vi.fn() }),
}))
vi.mock('@/containers/DownloadManegement', () => ({ DownloadManagement: () => null }))

import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import HeaderPage from '@/containers/HeaderPage'

function ShortcutProbe() {
  const { toggleSidebar } = useSidebar()
  return <button onClick={() => toggleSidebar()}>shortcut</button>
}

function renderShell(onOpenChange = vi.fn()) {
  render(
    <SidebarProvider open onOpenChange={onOpenChange}>
      <Sidebar collapsible="offcanvas">
        <a href="#projects">Projects link</a>
      </Sidebar>
      <HeaderPage>
        <span>Page</span>
      </HeaderPage>
      <ShortcutProbe />
    </SidebarProvider>
  )
  return onOpenChange
}

beforeEach(() => {
  viewport.mobile = true
  vi.stubGlobal('IS_MACOS', false)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('mobile sidebar overlay', () => {
  it('offers a header toggle on a narrow window even though the desktop sidebar preference is open', () => {
    renderShell()
    const toggle = screen.getByTestId('sidebar-toggle')
    expect(toggle).toHaveAttribute('aria-label', 'common:sidebar.toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a named modal navigation overlay without flipping the persisted desktop state', () => {
    const onOpenChange = renderShell()
    fireEvent.click(screen.getByTestId('sidebar-toggle'))

    const dialog = screen.getByRole('dialog', { name: 'common:sidebar.navigation' })
    expect(dialog).toHaveTextContent('Projects link')
    expect(screen.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('returns focus to the header toggle when the overlay closes, even if the browser never focused it on click', async () => {
    renderShell()
    const toggle = screen.getByTestId('sidebar-toggle')
    // WebKit does not focus a button on click: nothing is active when it opens.
    fireEvent.click(toggle)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  it('returns focus to the activated toggle, not a previously focused composer', async () => {
    render(
      <SidebarProvider open>
        <Sidebar collapsible="offcanvas">
          <span>Nav</span>
        </Sidebar>
        <textarea aria-label="composer" />
        <SidebarTrigger />
      </SidebarProvider>
    )
    const composer = screen.getByLabelText('composer')
    const toggle = screen.getByRole('button', { name: 'common:sidebar.toggle' })
    composer.focus()
    // WebKit: clicking the button leaves focus on the composer.
    fireEvent.click(toggle)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  it('falls back to a visible toggle, skipping hidden or disconnected ones', async () => {
    const view = render(
      <SidebarProvider open>
        <Sidebar collapsible="offcanvas">
          <span>Nav</span>
        </Sidebar>
        <div style={{ display: 'none' }}>
          <button data-sidebar-toggle="sidebar">hidden toggle</button>
        </div>
        <button data-sidebar-toggle="sidebar">visible toggle</button>
        <SidebarTrigger data-testid="opener" />
      </SidebarProvider>
    )
    fireEvent.click(screen.getByTestId('opener'))
    // The opener is re-rendered away while the overlay is open.
    screen.getByTestId('opener').remove()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByText('visible toggle')).toHaveFocus()
    view.unmount()
  })

  it('toggles the overlay, not the desktop sidebar, from the keyboard shortcut path', () => {
    const onOpenChange = renderShell()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('does not pop the overlay back open after the window grows and shrinks again', () => {
    const view = render(
      <SidebarProvider open>
        <Sidebar collapsible="offcanvas">
          <span>Nav</span>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'common:sidebar.toggle' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    viewport.mobile = false
    view.rerender(
      <SidebarProvider open>
        <Sidebar collapsible="offcanvas">
          <span>Nav</span>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    )
    viewport.mobile = true
    view.rerender(
      <SidebarProvider open>
        <Sidebar collapsible="offcanvas">
          <span>Nav</span>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('desktop sidebar toggle', () => {
  it('keeps the header toggle hidden while docked open and toggles the persisted state when used', () => {
    viewport.mobile = false
    const onOpenChange = renderShell()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('shortcut'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
