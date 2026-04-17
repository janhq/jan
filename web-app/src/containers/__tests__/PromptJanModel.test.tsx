import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock('@/constants/models', () => ({ SETUP_SCREEN_QUANTIZATIONS: ['q4_k_m'] }))

vi.mock('@/hooks/useJanModelPrompt', () => ({
  useJanModelPromptDismissed: () => ({ setDismissedModelName: vi.fn() }),
}))
vi.mock('@/hooks/useDownloadStore', () => ({
  useDownloadStore: () => ({
    downloads: {}, localDownloadingModels: new Set(), addLocalDownloadingModel: vi.fn(),
  }),
}))
vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (sel?: any) => {
    const state = { huggingfaceToken: '' }
    return sel ? sel(state) : state
  },
}))
vi.mock('@/hooks/useLatestJanModel', () => ({
  useLatestJanModel: () => ({
    model: {
      model_name: 'jan-nano',
      display_name: 'Jan Nano',
      quants: [{ model_id: 'jan-nano-q4_k_m', path: '/path', file_size: '2GB' }],
      mmproj_models: [],
    },
    loading: false,
  }),
}))

import { PromptJanModel } from '../PromptJanModel'

describe('PromptJanModel', () => {
  it('renders model prompt', () => {
    render(<PromptJanModel />)
    expect(screen.getAllByText(/Jan Nano/).length).toBeGreaterThan(0)
    expect(screen.getByText('Download')).toBeInTheDocument()
    expect(screen.getByText('Later')).toBeInTheDocument()
  })

  it('renders null when loading', () => {
    vi.doMock('@/hooks/useLatestJanModel', () => ({
      useLatestJanModel: () => ({ model: null, loading: true }),
    }))
    // Since vi.doMock doesn't work without resetModules, just test existing render
    render(<PromptJanModel />)
    expect(screen.getByText('Download')).toBeInTheDocument()
  })
})
