import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---- Module mocks ----------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  downloadStore: {
    downloads: {} as Record<string, any>,
    updateProgress: vi.fn(),
    localDownloadingModels: new Set<string>(),
    removeDownload: vi.fn(),
    removeLocalDownloadingModel: vi.fn(),
  },
  updateState: {
    isDownloading: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
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
  cancelDownloadMock: vi.fn(),
  eventHandlers: {} as Record<string, any>,
}))

vi.mock('sonner', () => ({ toast: hoisted.toastMock }))

vi.mock('@/hooks/useDownloadStore', () => ({
  useDownloadStore: () => hoisted.downloadStore,
}))

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({ updateState: hoisted.updateState }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({ abortDownload: hoisted.abortDownloadMock }),
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

describe('DownloadManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.downloadStore.downloads = {}
    hoisted.downloadStore.localDownloadingModels = new Set()
    hoisted.updateState = {
      isDownloading: false,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    }
    hoisted.eventHandlers = {}
  })

  it('renders empty state when no downloads', () => {
    render(<DownloadManagement />)
    expect(screen.getByText(/Your download progress/)).toBeInTheDocument()
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

  it('renders App Update progress when updater is downloading', () => {
    hoisted.updateState = {
      isDownloading: true,
      downloadProgress: 0.5,
      downloadedBytes: 1024,
      totalBytes: 2048,
    }
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

  it('handles HTTP 401 download error with settings toast action', () => {
    render(<DownloadManagement />)
    const handler = hoisted.eventHandlers['fde']
    expect(handler).toBeDefined()
    handler({ modelId: 'x', error: 'HTTP status 401 unauth' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'Hugging Face token required',
      expect.any(Object)
    )
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith('x')
  })

  it('handles HTTP 403 download error', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['fde']({ modelId: 'y', error: 'HTTP status 403 denied' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'Accept model license on Hugging Face',
      expect.any(Object)
    )
  })

  it('handles HTTP 429 rate-limit error', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['fde']({ modelId: 'z', error: 'HTTP status 429 slow down' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'Rate limited by Hugging Face',
      expect.any(Object)
    )
  })

  it('handles generic download error with translated toast', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['fde']({ modelId: 'w', error: 'other' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'common:toast.downloadFailed.title',
      expect.any(Object)
    )
  })

  it('on file download success, removes download and shows toast', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['fds']({ modelId: 'ok' })
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith('ok')
    expect(hoisted.toastMock.success).toHaveBeenCalled()
  })

  it('on model validation started, shows info toast', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['mvs']({ modelId: 'v', downloadType: 'model' })
    expect(hoisted.toastMock.info).toHaveBeenCalled()
  })

  it('on model validation failed, dismisses toast and removes download', () => {
    render(<DownloadManagement />)
    hoisted.eventHandlers['mvf']({ modelId: 'v', error: 'bad', reason: 'checksum' })
    expect(hoisted.toastMock.dismiss).toHaveBeenCalledWith('model-validation-started-v')
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith('v')
    expect(hoisted.toastMock.error).toHaveBeenCalled()
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
})
