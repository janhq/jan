import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---- Module mocks ----------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  janModel: null as any,
  metadataError: null as any,
  fetchLatestJanModel: vi.fn(),
  downloadStore: {
    downloads: {} as Record<string, any>,
    localDownloadingModels: new Set<string>(),
    addLocalDownloadingModel: vi.fn(),
  },
  providersMock: {
    getProviderByName: vi.fn(() => ({ models: [] })),
    selectModelProvider: vi.fn(),
    setProviders: vi.fn(),
  },
  pullModelWithMetadataMock: vi.fn(),
  navigateMock: vi.fn(),
  eventHandlers: {} as Record<string, any>,
  huggingfaceToken: 'hf-token',
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: hoisted.toastMock }))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => hoisted.providersMock,
}))

vi.mock('@/hooks/useDownloadStore', () => ({
  useDownloadStore: () => hoisted.downloadStore,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      isModelSupported: vi.fn().mockResolvedValue('GREEN'),
      pullModelWithMetadata: hoisted.pullModelWithMetadataMock,
    }),
    providers: () => ({
      getProviders: vi.fn().mockResolvedValue([]),
    }),
  }),
}))

vi.mock('@/hooks/useLatestJanModel', () => ({
  useLatestJanModel: () => ({
    model: hoisted.janModel,
    error: hoisted.metadataError,
    fetchLatestJanModel: hoisted.fetchLatestJanModel,
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (selector: any) =>
    selector({ huggingfaceToken: hoisted.huggingfaceToken }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => opts?.defaultValue ?? k,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => hoisted.navigateMock,
}))

vi.mock('@janhq/core', () => ({
  AppEvent: { onModelImported: 'onModelImported' },
  events: {
    on: vi.fn((name: string, handler: any) => {
      hoisted.eventHandlers[name] = handler
    }),
    off: vi.fn(),
  },
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelSupportCache: 'msc',
    setupCompleted: 'sc',
    lastUsedModel: 'lum',
  },
  CACHE_EXPIRY_MS: 60000,
}))

vi.mock('@/constants/routes', () => ({
  route: { home: '/' },
}))

vi.mock('@/constants/models', () => ({
  SETUP_SCREEN_QUANTIZATIONS: ['q4_k_m', 'q8_0'],
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: () => <header data-testid="header-page" />,
}))
vi.mock('../HeaderPage', () => ({
  default: () => <header data-testid="header-page" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}))

import SetupScreen from '../SetupScreen'

const sampleModel = {
  model_name: 'jan-model',
  display_name: 'Jan Model',
  quants: [
    { model_id: 'jan-q4_k_m', path: '/models/q4', file_size: '2 GB' },
    { model_id: 'jan-q8_0', path: '/models/q8', file_size: '4 GB' },
  ],
  mmproj_models: [{ model_id: 'mmproj-f16', path: '/mmproj' }],
}

describe('SetupScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.janModel = null
    hoisted.metadataError = null
    hoisted.downloadStore.downloads = {}
    hoisted.downloadStore.localDownloadingModels = new Set()
    hoisted.providersMock.getProviderByName.mockReturnValue({ models: [] })
    hoisted.eventHandlers = {}
    localStorage.clear()
  })

  it('renders welcome header when no download is active', () => {
    render(<SetupScreen />)
    expect(screen.getByText('Hey, welcome to Jan!')).toBeInTheDocument()
    expect(screen.getByText('Download')).toBeInTheDocument()
  })

  it('renders the header page component', () => {
    render(<SetupScreen />)
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
  })

  it('calls fetchLatestJanModel on mount', () => {
    render(<SetupScreen />)
    expect(hoisted.fetchLatestJanModel).toHaveBeenCalledWith(true)
  })

  it('shows the model display name once metadata is available', async () => {
    hoisted.janModel = sampleModel
    render(<SetupScreen />)
    await waitFor(() => expect(screen.getByText(/Jan Model/)).toBeInTheDocument())
  })

  it('clicking download triggers pullModelWithMetadata once metadata is ready', async () => {
    hoisted.janModel = sampleModel
    render(<SetupScreen />)
    await waitFor(() =>
      expect(hoisted.downloadStore.addLocalDownloadingModel).toHaveBeenCalled()
    )
    // auto-start calls pull once support check completes
    await waitFor(() =>
      expect(hoisted.pullModelWithMetadataMock).toHaveBeenCalled()
    )
  })

  it('queues the download if metadata is not yet ready and user clicks Download', () => {
    hoisted.janModel = null
    render(<SetupScreen />)
    const btn = screen.getByText('Download') as HTMLButtonElement
    fireEvent.click(btn)
    // No pull yet because metadata is null
    expect(hoisted.pullModelWithMetadataMock).not.toHaveBeenCalled()
  })

  it('shows downloading state when a matching download is active', () => {
    hoisted.janModel = sampleModel
    hoisted.downloadStore.downloads = {
      'jan-q4_k_m': {
        name: 'jan-q4_k_m',
        progress: 0.25,
        current: 500_000_000,
        total: 2_000_000_000,
      },
    }
    render(<SetupScreen />)
    expect(screen.getByText('Sit tight, Jan is getting ready...')).toBeInTheDocument()
    expect(screen.getByText('Downloading')).toBeInTheDocument()
  })

  it('shows error toast when queued download fails due to metadata error', async () => {
    // First render with no model so quickstart gets queued
    hoisted.janModel = null
    const { rerender } = render(<SetupScreen />)
    const btn = screen.getByText('Download') as HTMLButtonElement
    fireEvent.click(btn)
    // Now flip metadata error and rerender to trigger useEffect
    hoisted.metadataError = new Error('fail')
    rerender(<SetupScreen />)
    await waitFor(() => expect(hoisted.toastMock.error).toHaveBeenCalled())
  })

  it('navigates home when onModelImported fires for the default variant', async () => {
    hoisted.janModel = sampleModel
    hoisted.providersMock.selectModelProvider.mockReturnValue({ id: 'jan-q4_k_m' })
    render(<SetupScreen />)
    // wait for registration
    await waitFor(() => expect(hoisted.eventHandlers['onModelImported']).toBeDefined())
    await hoisted.eventHandlers['onModelImported']({ modelId: 'jan-q4_k_m' })
    await waitFor(() => expect(hoisted.navigateMock).toHaveBeenCalled())
    expect(localStorage.getItem('sc')).toBe('true')
  })

  it('ignores onModelImported for unrelated model ids', async () => {
    hoisted.janModel = sampleModel
    render(<SetupScreen />)
    await waitFor(() => expect(hoisted.eventHandlers['onModelImported']).toBeDefined())
    await hoisted.eventHandlers['onModelImported']({ modelId: 'some-other' })
    expect(hoisted.navigateMock).not.toHaveBeenCalled()
  })

  it('does not auto-start download when model is already present in provider', async () => {
    hoisted.janModel = sampleModel
    hoisted.providersMock.getProviderByName.mockReturnValue({
      models: [{ id: 'jan-q4_k_m' }],
    })
    render(<SetupScreen />)
    // Give useEffect chance to run
    await new Promise((r) => setTimeout(r, 20))
    expect(hoisted.pullModelWithMetadataMock).not.toHaveBeenCalled()
  })

  it('Download button is disabled while downloading', () => {
    hoisted.janModel = sampleModel
    hoisted.downloadStore.downloads = {
      'jan-q4_k_m': {
        name: 'jan-q4_k_m',
        progress: 0.1,
        current: 10,
        total: 100,
      },
    }
    render(<SetupScreen />)
    const btn = screen.getByText('Downloading').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
