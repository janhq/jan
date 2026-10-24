import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---- Module mocks ----------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  downloadStore: {
    downloads: {} as Record<string, any>,
    updateProgress: vi.fn(),
    localDownloadingModels: new Set<string>(),
    resumeParams: {} as Record<string, any>,
    removeDownload: vi.fn(),
    removeLocalDownloadingModel: vi.fn(),
    setPaused: vi.fn(),
    addLocalDownloadingModel: vi.fn(),
  },
  navigateMock: vi.fn(),
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  abortDownloadMock: vi.fn().mockResolvedValue(undefined),
  pauseDownloadMock: vi.fn().mockResolvedValue(undefined),
  pullModelMock: vi.fn().mockResolvedValue(undefined),
  cancelDownloadMock: vi.fn(),
  eventHandlers: {} as Record<string, any>,
}))

vi.mock('sonner', () => ({ toast: hoisted.toastMock }))

vi.mock('@/hooks/useDownloadStore', () => {
  const useDownloadStore: any = () => hoisted.downloadStore
  useDownloadStore.getState = () => hoisted.downloadStore
  return { useDownloadStore }
})

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      abortDownload: hoisted.abortDownloadMock,
      pauseDownload: hoisted.pauseDownloadMock,
      pullModelWithMetadata: hoisted.pullModelMock,
    }),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => hoisted.navigateMock,
}))

vi.mock('@janhq/core', () => ({
  DownloadEvent: {
    onFileDownloadUpdate: 'fdu',
    onFileDownloadError: 'fde',
    onFileDownloadSuccess: 'fds',
    onFileDownloadStopped: 'fdx',
    onModelValidationStarted: 'mvs',
    onModelValidationFailed: 'mvf',
    onFileDownloadAndVerificationSuccess: 'fdvs',
  },
  AppEvent: {
    onAppUpdateDownloadUpdate: 'audu',
    onAppUpdateDownloadSuccess: 'auds',
    onAppUpdateDownloadError: 'aude',
  },
  events: {
    on: vi.fn((name: string, handler: any) => {
      hoisted.eventHandlers[name] = handler
    }),
    off: vi.fn(),
  },
}))

// Simplify Popover: always render content inline
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: any) => <div data-testid="progress" data-value={value} />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}))

vi.mock('@/constants/routes', () => ({
  route: { settings: { general: '/settings/general' } },
}))

// @ts-expect-error — test shim for window.core used by cancel branch
window.core = {
  extensionManager: {
    getByName: () => ({ cancelDownload: hoisted.cancelDownloadMock }),
  },
}

import { DownloadManagement } from '../DownloadManegement'
import { useAppUpdateDownload } from '@/stores/app-update-download-store'

describe('DownloadManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.downloadStore.downloads = {}
    hoisted.downloadStore.resumeParams = {}
    hoisted.downloadStore.localDownloadingModels = new Set()
    useAppUpdateDownload.setState({
      isDownloading: false,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    })
    hoisted.eventHandlers = {}
  })

  it('renders nothing when no downloads are in progress', () => {
    const { container } = render(<DownloadManagement />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a download item with progress', () => {
    hoisted.downloadStore.downloads = {
      'model-a': {
        name: 'model-a',
        progress: 0.42,
        current: 1024 * 1024 * 1024,
        total: 2 * 1024 * 1024 * 1024,
      },
    }
    render(<DownloadManagement />)
    expect(screen.getByText('model-a')).toBeInTheDocument()
    expect(screen.getByText('downloading')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('shows initializing when total is 0 and current is 0', () => {
    hoisted.downloadStore.localDownloadingModels = new Set(['model-b'])
    render(<DownloadManagement />)
    expect(screen.getByText('Initializing download...')).toBeInTheDocument()
  })

  it('shows "Downloading..." when current > 0 but total = 0', () => {
    hoisted.downloadStore.downloads = {
      'model-c': { name: 'model-c', progress: 0, current: 500, total: 0 },
    }
    render(<DownloadManagement />)
    expect(screen.getByText('Downloading...')).toBeInTheDocument()
  })

  it('renders App Update progress when an update is downloading', () => {
    useAppUpdateDownload.setState({
      isDownloading: true,
      downloadProgress: 0.5,
      downloadedBytes: 1024,
      totalBytes: 2048,
    })
    render(<DownloadManagement />)
    expect(screen.getByText('App Update')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('cancels llamacpp download via extension manager', () => {
    hoisted.downloadStore.downloads = {
      'llamacpp/foo': {
        name: 'llamacpp/foo',
        progress: 0.1,
        current: 1,
        total: 10,
      },
    }
    render(<DownloadManagement />)
    const cancelBtn = screen.getByTitle('Cancel download')
    fireEvent.click(cancelBtn.closest('button')!)
    expect(hoisted.cancelDownloadMock).toHaveBeenCalledWith('llamacpp/foo')
  })

  it('cancels non-llamacpp download via serviceHub.abortDownload', async () => {
    hoisted.downloadStore.downloads = {
      'cloud-model': {
        name: 'cloud-model',
        progress: 0.1,
        current: 1,
        total: 10,
      },
    }
    render(<DownloadManagement />)
    const cancelBtn = screen.getByTitle('Cancel download')
    fireEvent.click(cancelBtn.closest('button')!)
    await waitFor(() => expect(hoisted.abortDownloadMock).toHaveBeenCalledWith('cloud-model'))
  })








  it('appears when an app update starts downloading', () => {
    const { container } = render(<DownloadManagement />)
    expect(container).toBeEmptyDOMElement()
    act(() => {
      hoisted.eventHandlers['audu']({ progress: 0.1, downloadedBytes: 10, totalBytes: 100 })
    })
    expect(screen.getByText('App Update')).toBeInTheDocument()
  })

  it('keeps app update progress across a remount (sidebar toggle)', () => {
    const { unmount } = render(<DownloadManagement />)
    act(() => {
      hoisted.eventHandlers['audu']({ progress: 0.1, downloadedBytes: 10, totalBytes: 100 })
    })
    unmount()
    // No further progress events: the new mount must not wait for one
    render(<DownloadManagement />)
    expect(screen.getByText('App Update')).toBeInTheDocument()
  })

  it('hides again once the app update download finishes', () => {
    const { container } = render(<DownloadManagement />)
    act(() => {
      hoisted.eventHandlers['audu']({ progress: 0.5, downloadedBytes: 50, totalBytes: 100 })
    })
    act(() => {
      hoisted.eventHandlers['auds']()
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('on app update download success, shows success toast', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['auds']()
    expect(hoisted.toastMock.success).toHaveBeenCalled()
  })

  it('on app update download error, shows error toast', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['aude']()
    expect(hoisted.toastMock.error).toHaveBeenCalled()
  })

  it('pauses a model download and marks it paused', async () => {
    hoisted.downloadStore.downloads = {
      'cloud-model': {
        name: 'cloud-model',
        progress: 0.3,
        current: 3,
        total: 10,
      },
    }
    render(<DownloadManagement />)
    fireEvent.click(screen.getByTitle('Pause download').closest('button')!)
    expect(hoisted.downloadStore.setPaused).toHaveBeenCalledWith(
      'cloud-model',
      true
    )
    await waitFor(() =>
      expect(hoisted.pauseDownloadMock).toHaveBeenCalledWith('cloud-model')
    )
  })

  it('resumes a paused download via pullModelWithMetadata', async () => {
    hoisted.downloadStore.downloads = {
      'cloud-model': {
        name: 'cloud-model',
        progress: 0.3,
        current: 3,
        total: 10,
        paused: true,
      },
    }
    hoisted.downloadStore.resumeParams = {
      'cloud-model': {
        modelPath: 'https://hf/model.gguf',
        mmprojPath: undefined,
        hfToken: 'tok',
      },
    }
    render(<DownloadManagement />)
    fireEvent.click(screen.getByTitle('Resume download').closest('button')!)
    expect(hoisted.downloadStore.setPaused).toHaveBeenCalledWith(
      'cloud-model',
      false
    )
    expect(hoisted.downloadStore.addLocalDownloadingModel).toHaveBeenCalledWith(
      'cloud-model'
    )
    await waitFor(() =>
      expect(hoisted.pullModelMock).toHaveBeenCalledWith(
        'cloud-model',
        'https://hf/model.gguf',
        undefined,
        'tok'
      )
    )
  })

  it('errors when resuming with no stored params', () => {
    hoisted.downloadStore.downloads = {
      'cloud-model': {
        name: 'cloud-model',
        progress: 0.3,
        current: 3,
        total: 10,
        paused: true,
      },
    }
    render(<DownloadManagement />)
    fireEvent.click(screen.getByTitle('Resume download').closest('button')!)
    expect(hoisted.pullModelMock).not.toHaveBeenCalled()
    expect(hoisted.toastMock.error).toHaveBeenCalled()
  })



  it('does not show pause/resume for llamacpp direct downloads', () => {
    hoisted.downloadStore.downloads = {
      'llamacpp/foo': { name: 'llamacpp/foo', progress: 0.1, total: 10 },
    }
    render(<DownloadManagement />)
    expect(screen.queryByTitle('Pause download')).not.toBeInTheDocument()
    expect(screen.getByTitle('Cancel download')).toBeInTheDocument()
  })
})
