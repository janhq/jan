import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const hoisted = vi.hoisted(() => ({
  getMtpInfo: vi.fn(),
  updateMtpSettings: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    models: () => ({
      getMtpInfo: hoisted.getMtpInfo,
      updateMtpSettings: hoisted.updateMtpSettings,
    }),
  }
  return { useServiceHub: () => hub, getServiceHub: () => hub }
})

import { SpecDraftPanel } from '../ModelSetting'

// llama.cpp is linked into the worker at a pinned version, so there is no
// backend build number left to gate MTP on.
describe('SpecDraftPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.updateMtpSettings.mockResolvedValue(undefined)
  })

  it('offers the toggle for a model with MTP heads', async () => {
    hoisted.getMtpInfo.mockResolvedValue({ mtp_layers: 2, mtp: false })
    render(<SpecDraftPanel modelId="glm" />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeEnabled()
  })

  it('reports a model whose MTP is already on as on', async () => {
    hoisted.getMtpInfo.mockResolvedValue({ mtp_layers: 2, mtp: true })
    render(<SpecDraftPanel modelId="glm" />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeChecked()
  })

  it('renders nothing for a model with no MTP heads', async () => {
    hoisted.getMtpInfo.mockResolvedValue({ mtp_layers: 0, mtp: false })
    render(<SpecDraftPanel modelId="llama" />)

    await waitFor(() => expect(hoisted.getMtpInfo).toHaveBeenCalled())
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
