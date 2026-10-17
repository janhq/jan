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

  it('reports spec decoding as on for model with spec decoding parameter', async () => {
    hoisted.getSpecDecodingSettings.mockResolvedValue({
      mtp_layers: 0,
      spec_type: 'ngram-simple',
    })
    render(<SpecDecodingPanel modelId="llama" />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeChecked()
  })

  it('reports spec decoding as off for model without spec decoding parameter', async () => {
    hoisted.getSpecDecodingSettings.mockResolvedValue({ mtp_layers: 0 })
    render(<SpecDecodingPanel modelId="llama" />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).not.toBeChecked()
  })

  it('offers spec draft option for model with spec draft parameter', async () => {
    hoisted.getSpecDecodingSettings.mockResolvedValue({
      mtp_layers: 0,
      spec_type: 'draft-simple',
      spec_draft_type: 'draft-simple',
    })
    render(<SpecDecodingPanel modelId="llama" />)

    expect(
      await screen.findByRole('radio', { name: /draft.simple/i })
    ).toBeInTheDocument()
  })
})
