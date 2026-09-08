import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

const h = vi.hoisted(() => {
  const provider = {
    provider: 'llamacpp',
    active: true,
    settings: [{ key: 'fit', controller_props: { value: false } }],
    models: [
      {
        id: 'local-model',
        settings: {
          ctx_len: { controller_props: { value: 4096, max: 10000 } },
        },
      },
    ],
  }
  const modelProviderState = {
    selectedProvider: 'llamacpp',
    selectedModel: provider.models[0],
    getProviderByName: vi.fn(() => provider),
    updateProvider: vi.fn(),
    selectModelProvider: vi.fn(),
  }
  const providersService = { updateSettings: vi.fn().mockResolvedValue(undefined) }
  const modelsService = { updateModelSettings: vi.fn().mockResolvedValue(undefined) }
  return { provider, modelProviderState, providersService, modelsService }
})

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (state: typeof h.modelProviderState) => unknown) =>
    selector(h.modelProviderState),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => h.providersService,
    models: () => h.modelsService,
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

import { CoworkModelControls } from '../CoworkModelControls'
import { nextCoworkContextSize } from '@/lib/coworkModelControls'

beforeEach(() => {
  vi.clearAllMocks()
  h.provider.settings[0].controller_props.value = false
  h.provider.models[0].settings.ctx_len.controller_props.value = 4096
})

describe('nextCoworkContextSize', () => {
  it('uses Chat steps and clamps to the model maximum', () => {
    expect(nextCoworkContextSize(4096, 10000)).toBe(8192)
    expect(nextCoworkContextSize(8192, 10000)).toBe(10000)
    expect(nextCoworkContextSize(10000, 10000)).toBeUndefined()
  })
})

describe('CoworkModelControls', () => {
  it('shows controls for an active local model', () => {
    render(<CoworkModelControls />)
    expect(
      screen.getByRole('button', { name: /common:modelControls.label/ })
    ).toBeInTheDocument()
  })

  it('persists context and fit changes for the next request', async () => {
    const user = userEvent.setup()
    render(<CoworkModelControls />)

    await user.click(screen.getByRole('button', { name: /common:modelControls.label/ }))
    await user.click(screen.getByRole('menuitem'))
    expect(h.modelsService.updateModelSettings).toHaveBeenCalledWith('local-model', {
      ctx_len: 8192,
    })

    await user.click(screen.getByRole('button', { name: /common:modelControls.label/ }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'common:modelControls.fit' }))
    expect(h.providersService.updateSettings).toHaveBeenCalledWith('llamacpp', [
      expect.objectContaining({ key: 'fit', controller_props: { value: true } }),
    ])
  })
})
