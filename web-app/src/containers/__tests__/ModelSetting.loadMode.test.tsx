import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

const hoisted = vi.hoisted(() => ({
  updateModelSettings: vi.fn(),
  updateProvider: vi.fn(),
  getActiveModels: vi.fn(),
  stopModel: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    models: () => ({
      updateModelSettings: hoisted.updateModelSettings,
      getActiveModels: hoisted.getActiveModels,
      stopModel: hoisted.stopModel,
      getMtpInfo: vi.fn().mockResolvedValue({ mtp_layers: 0, mtp: false }),
    }),
    providers: () => ({ updateSettings: vi.fn() }),
  }
  return { useServiceHub: () => hub, getServiceHub: () => hub }
})

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: Object.assign(
    () => ({ updateProvider: hoisted.updateProvider }),
    { getState: () => ({ getProviderByName: () => undefined, updateProvider: vi.fn() }) }
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

import { ModelSettingFields } from '../ModelSetting'
import { modelSettings } from '@/lib/predefined'

const model = {
  id: 'm1',
  name: 'M1',
  settings: { load_mode: structuredClone(modelSettings.load_mode) },
} as unknown as Model
const provider = {
  provider: 'llamacpp',
  models: [model],
  settings: [],
} as unknown as ProviderObject

describe('ModelSettingFields load_mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.updateModelSettings.mockResolvedValue(undefined)
    hoisted.getActiveModels.mockResolvedValue([])
    hoisted.stopModel.mockResolvedValue(undefined)
  })

  it('shows the inherit option as selected for a model that never set one', async () => {
    render(<ModelSettingFields model={model} provider={provider} />)
    // Let SpecDraftPanel's async probe settle so it does not update outside act.
    await act(async () => {})
    expect(screen.getByText('Load Mode')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inherit global' })).toBeInTheDocument()
  })

  it('persists the chosen value to model.yml', async () => {
    const user = userEvent.setup()
    render(<ModelSettingFields model={model} provider={provider} />)
    await user.click(screen.getByRole('button', { name: 'Inherit global' }))
    await user.click(await screen.findByRole('menuitem', { name: 'mlock (no mmap)' }))

    await waitFor(
      () =>
        expect(hoisted.updateModelSettings).toHaveBeenCalledWith('m1', {
          load_mode: 'mlock',
        }),
      { timeout: 3000 }
    )
  })

  // The mode is only read while the weights load, so a running model keeps the
  // old one until it is stopped and reloaded.
  it('stops the model when it is running so the new mode takes effect', async () => {
    hoisted.getActiveModels.mockResolvedValue(['m1'])
    const user = userEvent.setup()
    render(<ModelSettingFields model={model} provider={provider} />)
    await user.click(screen.getByRole('button', { name: 'Inherit global' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Direct I/O' }))

    await waitFor(() => expect(hoisted.stopModel).toHaveBeenCalledWith('m1'), {
      timeout: 3000,
    })
  })
})
