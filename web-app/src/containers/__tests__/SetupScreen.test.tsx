import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
  startEngineSetupMock: vi.fn().mockResolvedValue(undefined),
  verifyGpuOffloadMock: vi.fn(),
  verifyEmbeddingModelMock: vi.fn(),
  getHardwareInfoMock: vi.fn(),
  navigateMock: vi.fn(),
  productAnalyticPrompt: false,
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

vi.mock('@/hooks/useServiceHub', () => {
  const stub = () => ({
    models: () => ({
      isModelSupported: vi.fn().mockResolvedValue('GREEN'),
      pullModelWithMetadata: hoisted.pullModelWithMetadataMock,
      startEngineSetup: hoisted.startEngineSetupMock,
      verifyGpuOffload: hoisted.verifyGpuOffloadMock,
      verifyEmbeddingModel: hoisted.verifyEmbeddingModelMock,
    }),
    providers: () => ({
      getProviders: vi.fn().mockResolvedValue([]),
    }),
    hardware: () => ({ getHardwareInfo: hoisted.getHardwareInfoMock }),
  })
  return { useServiceHub: stub, getServiceHub: stub }
})

vi.mock('@/hooks/useLatestJanModel', () => ({
  useLatestJanModel: () => ({
    model: hoisted.janModel,
    error: hoisted.metadataError,
    fetchLatestJanModel: hoisted.fetchLatestJanModel,
  }),
}))

vi.mock('@/hooks/useAnalytic', () => ({
  useAnalytic: () => ({
    productAnalyticPrompt: hoisted.productAnalyticPrompt,
    setProductAnalytic: vi.fn(),
    setProductAnalyticPrompt: vi.fn(),
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
  DownloadEvent: { onFileDownloadSuccess: 'onFileDownloadSuccess' },
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
  route: { home: '/', hub: { index: '/hub/' } },
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

// The readiness probes resolve after mount, so flush them before asserting to
// keep pending state updates out of the test.
const renderSetup = async () => {
  const utils = render(<SetupScreen />)
  await act(async () => {})
  return utils
}

/** Passes the welcome gate, which is where the flow now begins. */
const start = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('setup:startSetup'))
  })
}

const renderStarted = async () => {
  const utils = await renderSetup()
  await start()
  return utils
}

/** Advances past the llama.cpp setup page, which never auto-advances. */
const continueSetup = async () => {
  await act(async () => {
    fireEvent.click(
      screen.getByText(/setup:(continueStep|continueAnyway|skipStep)/)
    )
  })
}

const renderPastSetup = async () => {
  const utils = await renderStarted()
  await continueSetup()
  return utils
}

const currentPage = () =>
  screen.getByTestId('setup-wizard').getAttribute('data-page')

describe('SetupScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.janModel = sampleModel
    hoisted.metadataError = null
    hoisted.productAnalyticPrompt = false
    hoisted.downloadStore.downloads = {}
    hoisted.downloadStore.localDownloadingModels = new Set()
    hoisted.providersMock.getProviderByName.mockReturnValue({ models: [] })
    hoisted.eventHandlers = {}
    // Healthy by default, so the wizard settles on the model page; individual
    // tests opt into a warning to hold an earlier page.
    hoisted.getHardwareInfoMock.mockResolvedValue({
      cpu: { name: 'Ryzen 7 5800X' },
      gpus: [{ name: 'RTX 4070', driver_version: '550.54' }],
    })
    hoisted.verifyGpuOffloadMock.mockResolvedValue({
      status: 'ok',
      backend: 'linux-cuda-12-common_cpus-x64',
      gpuExpected: true,
      engineDeviceCount: 1,
    })
    hoisted.verifyEmbeddingModelMock.mockResolvedValue({
      status: 'ok',
      modelId: 'sentence-transformer-mini',
      dimension: 384,
    })
    localStorage.clear()
  })

  it('renders the header page component', async () => {
    await renderStarted()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
  })

  it('calls fetchLatestJanModel on mount', async () => {
    await renderStarted()
    expect(hoisted.fetchLatestJanModel).toHaveBeenCalledWith(true)
  })

  it('runs the engine and embedding probes on mount', async () => {
    await renderStarted()
    expect(hoisted.verifyGpuOffloadMock).toHaveBeenCalled()
    expect(hoisted.verifyEmbeddingModelMock).toHaveBeenCalled()
  })

  it('routes all visible copy through i18n', async () => {
    await renderStarted()
    expect(screen.queryByText('Hey, welcome to Jan!')).not.toBeInTheDocument()
    expect(screen.queryByText('Recommended model')).not.toBeInTheDocument()
    expect(screen.queryByText('Download')).not.toBeInTheDocument()
  })

  describe('welcome gate', () => {
    it('opens on the welcome page', async () => {
      await renderSetup()

      expect(currentPage()).toBe('welcome')
      expect(screen.getByText('setup:welcomeTitle')).toBeInTheDocument()
      expect(screen.getByText('setup:startSetup')).toBeInTheDocument()
    })

    // The first page is an invitation, not a progress report: nothing is probed
    // until the user asks for it.
    it('probes nothing until the user starts', async () => {
      await renderSetup()

      expect(hoisted.verifyGpuOffloadMock).not.toHaveBeenCalled()
      expect(hoisted.verifyEmbeddingModelMock).not.toHaveBeenCalled()
      expect(hoisted.getHardwareInfoMock).not.toHaveBeenCalled()
    })

    it('begins the checks on start', async () => {
      await renderSetup()
      await start()

      expect(hoisted.verifyGpuOffloadMock).toHaveBeenCalled()
      expect(hoisted.verifyEmbeddingModelMock).toHaveBeenCalled()
    })

    // The engine's own provisioning is hundreds of megabytes. It used to run at
    // app launch regardless, which made asking pointless.
    it('does not provision the engine until the user starts', async () => {
      await renderSetup()

      expect(hoisted.startEngineSetupMock).not.toHaveBeenCalled()
    })

    it('provisions the engine on start', async () => {
      await renderSetup()
      await start()

      expect(hoisted.startEngineSetupMock).toHaveBeenCalledTimes(1)
    })

    it('does not offer the model download yet', async () => {
      await renderSetup()

      expect(screen.queryByTestId('setup-model-card')).not.toBeInTheDocument()
      expect(screen.queryByText('setup:download')).not.toBeInTheDocument()
    })
  })

  describe('GPU badge', () => {
    const holdSetupPage = () =>
      hoisted.verifyEmbeddingModelMock.mockResolvedValue({
        status: 'ok',
        pending: true,
      })

    it('names the GPU when offload is confirmed', async () => {
      holdSetupPage()

      await renderStarted()

      expect(currentPage()).toBe('setup')
      expect(screen.getByTestId('setup-gpu-badge').textContent).toContain(
        'setup:badgeGpu'
      )
    })

    // A GPU build that found no device runs on the CPU regardless of its name,
    // so the device count decides rather than the backend label.
    it('says CPU when a GPU build sees no device', async () => {
      holdSetupPage()
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'warning',
        backend: 'linux-cuda-12-common_cpus-x64',
        gpuExpected: true,
        engineDeviceCount: 0,
        reason: 'runtimeUnreachable',
      })

      await renderStarted()

      expect(screen.getByTestId('setup-gpu-badge').textContent).toContain(
        'setup:badgeCpu'
      )
    })

    it('says CPU for a CPU-only build', async () => {
      holdSetupPage()
      hoisted.getHardwareInfoMock.mockResolvedValue({
        cpu: { name: 'Ryzen 7 5800X' },
        gpus: [],
      })
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'ok',
        backend: 'linux-common_cpus-x64',
        gpuExpected: false,
        engineDeviceCount: 0,
      })

      await renderStarted()

      expect(screen.getByTestId('setup-gpu-badge').textContent).toContain(
        'setup:badgeCpu'
      )
    })

    // Neither answer is known until the engine has a backend.
    it('stays undecided while the engine is still setting up', async () => {
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'ok',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        pending: true,
      })

      await renderStarted()

      expect(screen.getByTestId('setup-gpu-badge').textContent).toContain(
        'setup:badgeGpuUnknown'
      )
    })
  })

  describe('one page at a time', () => {
    it('shows only the current page', async () => {
      await renderPastSetup()

      expect(currentPage()).toBe('model')
      // Settled check pages are gone rather than stacked above this one.
      expect(screen.queryByText('setup:stageSetup')).not.toBeInTheDocument()
      expect(screen.queryByTestId('setup-gpu-badge')).not.toBeInTheDocument()
    })

    it('holds the setup page while the engine is still setting up', async () => {
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'ok',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        pending: true,
      })

      await renderStarted()

      expect(currentPage()).toBe('setup')
      expect(screen.getByText('setup:checkEnginePreparing')).toBeInTheDocument()
    })

    it('holds the setup page while the embedding check is pending', async () => {
      hoisted.verifyEmbeddingModelMock.mockResolvedValue({
        status: 'ok',
        pending: true,
      })

      await renderStarted()

      expect(currentPage()).toBe('setup')
    })

    it('reports position within the flow', async () => {
      await renderStarted()
      expect(screen.getByTestId('setup-step-counter')).toBeInTheDocument()
    })

    // Auto-advancing skipped this page whenever the engine was already
    // installed, hiding the GPU badge.
    it('does not advance past the setup page on its own', async () => {
      await renderStarted()

      expect(currentPage()).toBe('setup')
      expect(screen.getByTestId('setup-gpu-badge')).toBeInTheDocument()
    })

    it('offers Continue once the setup work is done', async () => {
      await renderStarted()

      expect(screen.getByText('setup:continueStep')).toBeInTheDocument()
    })

    it('offers a skip while the setup work is still running', async () => {
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'ok',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        pending: true,
      })

      await renderStarted()

      expect(screen.getByText('setup:skipStep')).toBeInTheDocument()
    })

    // An engine page can sit for the length of a backend download, so waiting
    // must never be the only option.
    it('lets the user skip a page that is still running', async () => {
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'ok',
        backend: '',
        gpuExpected: false,
        engineDeviceCount: 0,
        pending: true,
      })

      await renderStarted()
      expect(currentPage()).toBe('setup')

      fireEvent.click(screen.getByText('setup:skipStep'))

      expect(currentPage()).toBe('model')
    })
  })

  describe('warnings', () => {
    const armEngineWarning = () =>
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'warning',
        backend: 'linux-cuda-12-common_cpus-x64',
        gpuExpected: true,
        engineDeviceCount: 0,
        reason: 'runtimeUnreachable',
        error: 'device probe exploded',
      })

    it('holds the page that warned', async () => {
      armEngineWarning()

      await renderStarted()

      expect(currentPage()).toBe('setup')
      expect(
        screen.getByText('setup:checkEngineRuntimeUnreachable')
      ).toBeInTheDocument()
      expect(screen.getByTestId('setup-page-warning')).toBeInTheDocument()
    })

    it('advances past it on Continue', async () => {
      armEngineWarning()

      await renderStarted()
      fireEvent.click(screen.getByText('setup:continueAnyway'))

      expect(currentPage()).toBe('model')
    })

    it('offers a re-run of the checks', async () => {
      armEngineWarning()

      await renderStarted()
      await act(async () => {
        fireEvent.click(screen.getByText('setup:retryChecks'))
      })

      expect(hoisted.verifyGpuOffloadMock).toHaveBeenCalledTimes(2)
    })

    it('exposes the raw failure detail behind a disclosure', async () => {
      armEngineWarning()

      await renderStarted()
      expect(screen.queryByText(/device probe exploded/)).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('setup:showDetails'))

      expect(screen.getByText(/device probe exploded/)).toBeInTheDocument()
    })

    it('shows dependency install advice inline instead of as a dialog', async () => {
      hoisted.verifyGpuOffloadMock.mockResolvedValue({
        status: 'warning',
        backend: 'linux-cuda-12-common_cpus-x64',
        gpuExpected: true,
        engineDeviceCount: 0,
        reason: 'missingLibrary',
        missingLibraries: ['libnccl.so.2'],
      })

      await renderStarted()

      expect(screen.getByTestId('dependency-advice')).toBeInTheDocument()
    })

    it('shows no advice when no libraries are named', async () => {
      armEngineWarning()

      await renderStarted()

      expect(screen.queryByTestId('dependency-advice')).not.toBeInTheDocument()
    })
  })

  describe('consent page', () => {
    it('asks for consent as its own page when pending', async () => {
      hoisted.productAnalyticPrompt = true

      await renderPastSetup()

      expect(currentPage()).toBe('consent')
      expect(screen.getByTestId('analytic-consent')).toBeInTheDocument()
    })

    it('is skipped once consent has been answered', async () => {
      hoisted.productAnalyticPrompt = false

      await renderPastSetup()

      expect(currentPage()).toBe('model')
      expect(screen.queryByTestId('analytic-consent')).not.toBeInTheDocument()
    })

    // The model download is always last.
    it('precedes the model page', async () => {
      hoisted.productAnalyticPrompt = true

      await renderPastSetup()

      expect(currentPage()).not.toBe('model')
      expect(screen.queryByTestId('setup-model-card')).not.toBeInTheDocument()
    })
  })

  describe('model page', () => {
    it('offers exactly one model card', async () => {
      await renderPastSetup()
      expect(screen.getAllByTestId('setup-model-card')).toHaveLength(1)
    })

    it('renders the card before the metadata lands', async () => {
      hoisted.janModel = null

      await renderPastSetup()

      expect(screen.getByTestId('setup-model-card')).toBeInTheDocument()
    })

    // The action belongs with the model it acts on.
    it('puts the download action on the card', async () => {
      await renderPastSetup()

      expect(screen.getByTestId('setup-model-card')).toContainElement(
        screen.getByText('setup:download')
      )
    })

    it('downloads from the card action', async () => {
      await renderPastSetup()
      fireEvent.click(screen.getByText('setup:download'))

      await waitFor(() =>
        expect(hoisted.pullModelWithMetadataMock).toHaveBeenCalledWith(
          'jan-q4_k_m',
          '/models/q4',
          '/mmproj',
          'hf-token',
          true
        )
      )
    })

    // Matches the Hub: the button gives way to a progress bar rather than
    // sitting there looking pressable.
    it('replaces the action with progress while downloading', async () => {
      hoisted.downloadStore.downloads = {
        'jan-q4_k_m': {
          name: 'jan-q4_k_m',
          progress: 0.25,
          current: 500_000_000,
          total: 2_000_000_000,
        },
      }

      await renderPastSetup()

      expect(screen.queryByText('setup:download')).not.toBeInTheDocument()
      expect(screen.getByText('25%')).toBeInTheDocument()
    })

    it('opens the Hub for further exploration', async () => {
      await renderPastSetup()
      fireEvent.click(screen.getByText('setup:exploreHub'))

      expect(hoisted.navigateMock).toHaveBeenCalledWith({ to: '/hub/' })
    })

    it('queues the download until the metadata lands, keeping the HF token', async () => {
      hoisted.janModel = null
      const { rerender } = await renderPastSetup()

      fireEvent.click(screen.getByText('setup:download'))
      expect(hoisted.pullModelWithMetadataMock).not.toHaveBeenCalled()

      hoisted.janModel = sampleModel
      await act(async () => {
        rerender(<SetupScreen />)
      })

      await waitFor(() =>
        expect(hoisted.pullModelWithMetadataMock).toHaveBeenCalledWith(
          'jan-q4_k_m',
          '/models/q4',
          '/mmproj',
          'hf-token',
          true
        )
      )
    })

    it('shows an error toast when the queued download loses its metadata', async () => {
      hoisted.janModel = null
      const { rerender } = await renderPastSetup()
      fireEvent.click(screen.getByText('setup:download'))

      hoisted.metadataError = new Error('fail')
      await act(async () => {
        rerender(<SetupScreen />)
      })

      expect(hoisted.toastMock.error).toHaveBeenCalled()
    })

    it('does not start a download on its own', async () => {
      await renderPastSetup()
      expect(hoisted.pullModelWithMetadataMock).not.toHaveBeenCalled()
    })
  })

  // Answering consent used to remove its page from the flow, renumbering the
  // remaining steps under the user.
  describe('step numbering', () => {
    it('keeps the total fixed after consent is answered', async () => {
      hoisted.productAnalyticPrompt = true
      const { rerender } = await renderStarted()
      await continueSetup()
      expect(currentPage()).toBe('consent')
      const before = screen.getByTestId('setup-step-counter').textContent

      hoisted.productAnalyticPrompt = false
      await act(async () => {
        rerender(<SetupScreen />)
      })

      expect(currentPage()).toBe('model')
      expect(screen.getByTestId('setup-step-counter').textContent).toBe(before)
    })

    it('counts four pages when consent is pending', async () => {
      hoisted.productAnalyticPrompt = true

      await renderSetup()

      expect(
        screen.getByTestId('setup-wizard').querySelectorAll('span.h-1').length
      ).toBe(4)
    })

    it('counts three pages when consent is already answered', async () => {
      hoisted.productAnalyticPrompt = false

      await renderSetup()

      expect(
        screen.getByTestId('setup-wizard').querySelectorAll('span.h-1').length
      ).toBe(3)
    })
  })

  describe('leaving setup', () => {
    it('completes once the model is imported', async () => {
      hoisted.providersMock.selectModelProvider.mockReturnValue({
        id: 'jan-q4_k_m',
      })

      await renderPastSetup()
      await act(async () => {
        await hoisted.eventHandlers['onModelImported']({
          modelId: 'jan-q4_k_m',
        })
      })

      await waitFor(() => expect(hoisted.navigateMock).toHaveBeenCalled())
      expect(localStorage.getItem('sc')).toBe('true')
    })

    it('ignores an import of an unrelated model', async () => {
      await renderPastSetup()
      await act(async () => {
        await hoisted.eventHandlers['onModelImported']({
          modelId: 'some-other',
        })
      })

      expect(hoisted.navigateMock).not.toHaveBeenCalled()
    })

    // A model already on disk leaves no import event to wait for.
    it('completes without an import event when the model is already installed', async () => {
      hoisted.providersMock.getProviderByName.mockReturnValue({
        models: [{ id: 'jan-q4_k_m' }],
      })

      await renderPastSetup()

      await waitFor(() => expect(hoisted.navigateMock).toHaveBeenCalled())
      expect(hoisted.pullModelWithMetadataMock).not.toHaveBeenCalled()
    })

    // A warning was its own page and was passed deliberately, so it must not
    // also block the exit.
    it('completes after an acknowledged warning', async () => {
      hoisted.verifyEmbeddingModelMock.mockResolvedValue({
        status: 'warning',
        modelId: 'sentence-transformer-mini',
        problem: 'empty',
      })

      await renderStarted()
      expect(currentPage()).toBe('setup')
      await continueSetup()
      expect(currentPage()).toBe('model')

      await act(async () => {
        await hoisted.eventHandlers['onModelImported']({
          modelId: 'jan-q4_k_m',
        })
      })

      await waitFor(() => expect(hoisted.navigateMock).toHaveBeenCalled())
    })
  })
})
