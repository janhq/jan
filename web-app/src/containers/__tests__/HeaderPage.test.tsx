import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import HeaderPage from '../HeaderPage'

const state = vi.hoisted(() => ({ open: true, left: [] as string[], right: ['minimize', 'maximize', 'close'] }))
vi.mock('@/hooks/useLeftPanel', () => ({ useLeftPanel: () => ({ open: state.open, setLeftPanel: vi.fn() }) }))
vi.mock('@/stores/titlebar-layout-store', () => ({
  useTitlebarLayout: (selector: (s: unknown) => unknown) => selector({ layout: { left: state.left, right: state.right } }),
}))
vi.mock('@/containers/DownloadManegement', () => ({ DownloadManagement: () => null }))

beforeEach(() => { state.open = true; state.left = []; state.right = ['minimize', 'maximize', 'close']; vi.stubGlobal('IS_MACOS', false) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('HeaderPage titlebar hit areas', () => {
  it('puts interactive controls above the global drag overlay without blocking empty drag space', () => {
    const click = vi.fn()
    const { container } = render(<HeaderPage><button onClick={click}>Toggle overview</button></HeaderPage>)
    const header = container.firstElementChild!
    expect(header).toHaveClass('relative', 'z-30', 'pointer-events-none', '[&_button]:pointer-events-auto')
    fireEvent.click(screen.getByRole('button', { name: 'Toggle overview' }))
    expect(click).toHaveBeenCalledOnce()
  })
  it('reserves the full caption-button area on Windows and right-button Linux layouts', () => {
    const { container } = render(<HeaderPage><button>Action</button></HeaderPage>)
    expect(container.firstElementChild).toHaveStyle({ paddingRight: '120px' })
  })
  it('does not reserve nonexistent right caption buttons on macOS', () => {
    vi.stubGlobal('IS_MACOS', true)
    const { container } = render(<HeaderPage><button>Action</button></HeaderPage>)
    expect((container.firstElementChild as HTMLElement).style.paddingRight).toBe('')
  })
  it('respects left-button Linux layouts when the sidebar is collapsed', () => {
    state.open = false; state.left = ['close', 'minimize', 'maximize']; state.right = []
    const { container } = render(<HeaderPage><button>Action</button></HeaderPage>)
    expect(container.firstElementChild).toHaveStyle({ paddingLeft: '120px' })
    expect((container.firstElementChild as HTMLElement).style.paddingRight).toBe('')
  })
})
