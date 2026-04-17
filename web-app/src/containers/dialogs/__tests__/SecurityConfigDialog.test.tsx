import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SecurityConfigDialog } from '../SecurityConfigDialog'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve({
    auth_mode: 'none',
    has_token: false,
    has_password: false,
    require_pairing: false,
    approved_device_count: 0,
    recent_auth_failures: 0,
  })),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@tabler/icons-react', () => {
  const stub = () => <span />
  return {
    IconShield: stub,
    IconKey: stub,
    IconDevices: stub,
    IconHistory: stub,
    IconLoader2: stub,
    IconCopy: stub,
    IconCheck: stub,
    IconTrash: stub,
    IconRefresh: stub,
    IconAlertTriangle: stub,
    IconEye: stub,
    IconEyeOff: stub,
  }
})

describe('SecurityConfigDialog', () => {
  const onClose = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders dialog title when open', async () => {
    render(<SecurityConfigDialog isOpen={true} onClose={onClose} />)
    expect(screen.getByText('Security Settings')).toBeInTheDocument()
  })

  it('renders description', () => {
    render(<SecurityConfigDialog isOpen={true} onClose={onClose} />)
    expect(screen.getByText(/Configure authentication/)).toBeInTheDocument()
  })

  it('renders close button', () => {
    render(<SecurityConfigDialog isOpen={true} onClose={onClose} />)
    const closeButtons = screen.getAllByText('Close')
    expect(closeButtons.length).toBeGreaterThan(0)
  })

  it('renders tab buttons', async () => {
    render(<SecurityConfigDialog isOpen={true} onClose={onClose} />)
    expect(await screen.findByText('Authentication')).toBeInTheDocument()
    expect(screen.getByText('Devices')).toBeInTheDocument()
    expect(screen.getByText('Logs')).toBeInTheDocument()
  })

  it('does not render content when closed', () => {
    const { container } = render(
      <SecurityConfigDialog isOpen={false} onClose={onClose} />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
