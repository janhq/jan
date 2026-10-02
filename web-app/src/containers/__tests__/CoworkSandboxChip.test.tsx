import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const { getSandboxStatus, refreshSandboxStatus } = vi.hoisted(() => ({
  getSandboxStatus: vi.fn(),
  refreshSandboxStatus: vi.fn(),
}))
vi.mock('@/lib/agentTools', () => ({ getSandboxStatus, refreshSandboxStatus }))

import { CoworkSandboxChip } from '../CoworkSandboxChip'

describe('CoworkSandboxChip', () => {
  beforeEach(() => {
    getSandboxStatus.mockReset()
    refreshSandboxStatus.mockReset()
  })

  // The whole point: an enforcing sandbox is the normal case and must be
  // invisible. A chip that always showed would be permanent furniture.
  it('renders nothing when a sandbox enforces', async () => {
    getSandboxStatus.mockResolvedValue({ backend: 'bubblewrap', enforces: true })
    const { container } = render(<CoworkSandboxChip />)
    await waitFor(() => expect(getSandboxStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('stays hidden while the probe is still in flight', () => {
    getSandboxStatus.mockReturnValue(new Promise(() => {}))
    const { container } = render(<CoworkSandboxChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains the degradation and never shows the raw backend value', async () => {
    getSandboxStatus.mockResolvedValue({ backend: 'none', enforces: false })
    render(<CoworkSandboxChip />)
    const chip = await screen.findByRole('button')
    await userEvent.click(chip)

    expect(screen.getByText('common:sandbox.title')).toBeInTheDocument()
    expect(screen.getByText('common:sandbox.body')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('none')
  })

  it('re-probes on Check again and hides itself once a backend appears', async () => {
    getSandboxStatus.mockResolvedValue({ backend: 'none', enforces: false })
    refreshSandboxStatus.mockResolvedValue({
      backend: 'bubblewrap',
      enforces: true,
    })
    const { container } = render(<CoworkSandboxChip />)
    await userEvent.click(await screen.findByRole('button'))
    await userEvent.click(screen.getByText('common:sandbox.recheck'))

    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(refreshSandboxStatus).toHaveBeenCalled()
  })
})
