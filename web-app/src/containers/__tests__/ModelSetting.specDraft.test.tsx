import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { SpecDraftPanel } from '../ModelSetting'

const ENABLE = 'common:modelSettings.specDraft.enable'
const PROBABILISTIC = 'common:modelSettings.specDraft.probabilistic'

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

    const toggle = await screen.findByRole('switch', { name: ENABLE })
    expect(toggle).toBeEnabled()
    // The draft tunables only appear once speculative decoding is on.
    expect(
      screen.queryByRole('switch', { name: PROBABILISTIC })
    ).not.toBeInTheDocument()
  })

  it('reports a model whose MTP is already on as on', async () => {
    hoisted.getMtpInfo.mockResolvedValue({ mtp_layers: 2, mtp: true })
    render(<SpecDraftPanel modelId="glm" />)

    const toggle = await screen.findByRole('switch', { name: ENABLE })
    expect(toggle).toBeChecked()
  })

  // greedy is upstream's default, so turning probabilistic off clears the key
  // rather than writing `greedy`.
  it('persists probabilistic draft sampling and clears it when turned off', async () => {
    hoisted.getMtpInfo.mockResolvedValue({
      mtp_layers: 2,
      mtp: true,
      spec_draft_sampling: 'probabilistic',
    })
    render(<SpecDraftPanel modelId="glm" />)

    const toggle = await screen.findByRole('switch', { name: PROBABILISTIC })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(hoisted.updateMtpSettings).toHaveBeenCalledWith('glm', {
        spec_draft_sampling: null,
      })
    )
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(hoisted.updateMtpSettings).toHaveBeenLastCalledWith('glm', {
        spec_draft_sampling: 'probabilistic',
      })
    )
  })

  it('renders nothing for a model with no MTP heads', async () => {
    hoisted.getMtpInfo.mockResolvedValue({ mtp_layers: 0, mtp: false })
    render(<SpecDraftPanel modelId="llama" />)

    await waitFor(() => expect(hoisted.getMtpInfo).toHaveBeenCalled())
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
