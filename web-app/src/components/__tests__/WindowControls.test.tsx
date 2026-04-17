import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WindowControls } from '../WindowControls'

const mockMinimize = vi.fn()
const mockToggleMaximize = vi.fn()
const mockClose = vi.fn()

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    minimize: mockMinimize,
    toggleMaximize: mockToggleMaximize,
    close: mockClose,
  })),
}))

describe('WindowControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders minimize, maximize, and close buttons', () => {
    render(<WindowControls />)
    expect(screen.getByLabelText('Minimize')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximize')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('calls minimize on click', async () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    expect(mockMinimize).toHaveBeenCalled()
  })

  it('calls toggleMaximize on click', async () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByLabelText('Maximize'))
    expect(mockToggleMaximize).toHaveBeenCalled()
  })

  it('calls close on click', async () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(mockClose).toHaveBeenCalled()
  })
})
