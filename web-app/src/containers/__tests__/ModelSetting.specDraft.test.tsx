import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const hoisted = vi.hoisted(() => ({
  getSpecDecodingSettings: vi.fn(),
  updateSpecDecodingSettings: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    models: () => ({
      getSpecDecodingSettings: hoisted.getSpecDecodingSettings,
      updateSpecDecodingSettings: hoisted.updateSpecDecodingSettings,
    }),
  }
  return { useServiceHub: () => hub, getServiceHub: () => hub }
})

import { SpecDecodingPanel } from '../ModelSetting'

// llama.cpp is linked into the worker at a pinned version, so there is no
// backend build number left to gate MTP on.
describe('SpecDecodingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.updateSpecDecodingSettings.mockResolvedValue(undefined)
  })

  it('offers the toggle for a model with MTP heads', async () => {
    hoisted.getSpecDecodingSettings.mockResolvedValue({ mtp_layers: 2, mtp: false })
    render(<SpecDecodingPanel modelId="glm" />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeEnabled()
  })

  it('reports a model whose MTP is already on as on', async () => {
    hoisted.getSpecDecodingSettings.mockResolvedValue({ mtp_layers: 2, mtp: true })
    render(<SpecDecodingPanel modelId="glm" />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeChecked()
  })

  it('renders nothing for a model with no MTP heads', async () => {
    hoisted.getSpecDecodingSettings.mockResolvedValue({ mtp_layers: 0, mtp: false })
    render(<SpecDecodingPanel modelId="llama" />)

    await waitFor(() => expect(hoisted.getSpecDecodingSettings).toHaveBeenCalled())
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
