import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock('@/constants/models', () => ({
  JAN_V2_VL_MODEL_HF_REPO: 'test/repo',
  JAN_V2_VL_QUANTIZATIONS: ['q4_k_m'],
}))
vi.mock('@janhq/core', () => ({
  AppEvent: { onModelImported: 'onModelImported' },
  events: { on: vi.fn(), off: vi.fn() },
}))

vi.mock('@/hooks/useDownloadStore', () => ({
  useDownloadStore: () => ({
    downloads: {}, localDownloadingModels: new Set(), addLocalDownloadingModel: vi.fn(),
  }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({ getProviderByName: vi.fn().mockReturnValue(null) }),
}))
vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (sel?: any) => {
    const state = { huggingfaceToken: '' }
    return sel ? sel(state) : state
  },
}))

import { PromptVisionModel } from '../PromptVisionModel'

describe('PromptVisionModel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <PromptVisionModel open={false} onClose={vi.fn()} onDownloadComplete={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders content when open', () => {
    const { container } = render(
      <PromptVisionModel open={true} onClose={vi.fn()} onDownloadComplete={vi.fn()} />
    )
    expect(container.innerHTML).not.toBe('')
  })
})
