import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { CoworkSidePanel } from '../CoworkSidePanel'

const media = vi.hoisted(() => ({ phone: false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => media.phone }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
  motion: { aside: ({ children, animate, initial: _initial, exit: _exit, transition: _transition, style, ...props }: any) => <aside {...props} style={{ ...style, width: animate.width }}>{children}</aside> },
}))
let available = 1000
beforeEach(() => {
  media.phone = false
  localStorage.clear()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: available, height: 600, x: 0, y: 0, top: 0, left: 0, right: available, bottom: 600, toJSON: () => ({}) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const renderPanel = (close = vi.fn()) => render(<div><button>Conversation</button><CoworkSidePanel title="Preview" onClose={close}><button>Open file</button></CoworkSidePanel></div>)

describe('CoworkSidePanel sizing and keyboard access', () => {
  it('starts at half the parent area, not half the window', () => {
    available = 1000
    renderPanel()
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '500')
    expect(screen.getByText('Preview').closest('aside')).toHaveClass('z-(--layer-panel)')
  })
  it('persists a keyboard resize ratio and resets to equal split', () => {
    available = 1000
    renderPanel()
    const divider = screen.getByRole('separator')
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    expect(divider).toHaveAttribute('aria-valuenow', '516')
    expect(Number(localStorage.getItem('cowork:sidePanelWidthRatio'))).toBe(0.516)
    fireEvent.doubleClick(divider)
    expect(divider).toHaveAttribute('aria-valuenow', '500')
    expect(localStorage.getItem('cowork:sidePanelWidthRatio')).toBeNull()
  })
  it('uses modal overlay with Escape close when both panes cannot fit', async () => {
    available = 600
    const close = vi.fn()
    renderPanel(close)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('absolute', 'z-(--layer-panel)')
    expect(screen.getByRole('separator')).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })
  it('keeps a phone rail below the titlebar and below floating menus', () => {
    available = 400
    media.phone = true
    renderPanel()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('fixed', 'bottom-0', 'z-(--layer-panel)')
    expect(dialog).not.toHaveClass('h-full', 'inset-0', 'z-50')
    expect(dialog).toHaveStyle({ top: '60px', width: '100vw' })
  })
  it('allows focus in its portalled overflow menu in overlay mode', async () => {
    available = 600
    const close = vi.fn()
    render(<div><CoworkSidePanel title="Preview" onClose={close} summary={
      <DropdownMenu>
        <DropdownMenuTrigger>More actions</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>Reveal file</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    }>Content</CoworkSidePanel></div>)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Reveal file' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
  })
  it('keeps expand/restore width behavior and gives close the same hit area', () => {
    available = 1200
    const close = vi.fn()
    renderPanel(close)
    const expand = screen.getByRole('button', { name: 'common:expand' })
    const closeButton = screen.getByRole('button', { name: 'common:close' })
    expect(expand).toHaveAttribute('data-size', 'icon-sm')
    expect(closeButton).toHaveAttribute('data-size', 'icon-sm')
    expect(closeButton.className).toBe(expand.className)
    expect(closeButton).toHaveAttribute('type', 'button')
    fireEvent.click(expand)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '720')
    fireEvent.click(screen.getByRole('button', { name: 'common:collapse' }))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '600')
    fireEvent.click(closeButton)
    expect(close).toHaveBeenCalledOnce()
  })
  it('clamps a saved ratio without overwriting it', () => {
    available = 1000
    localStorage.setItem('cowork:sidePanelWidthRatio', '0.8')
    renderPanel()
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '520')
    expect(localStorage.getItem('cowork:sidePanelWidthRatio')).toBe('0.8')
  })
})
