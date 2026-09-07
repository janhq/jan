import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({
  downloadStore: {
    downloads: {} as Record<string, any>,
    updateProgress: vi.fn(),
    removeDownload: vi.fn(),
    removeLocalDownloadingModel: vi.fn(),
  },
  navigateMock: vi.fn(),
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  eventHandlers: {} as Record<string, any>,
  offCalls: [] as string[],
}))

vi.mock('sonner', () => ({ toast: hoisted.toastMock }))

vi.mock('@/hooks/useDownloadStore', () => {
  const useDownloadStore: any = () => hoisted.downloadStore
  useDownloadStore.getState = () => hoisted.downloadStore
  return { useDownloadStore }
})

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => hoisted.navigateMock,
}))

vi.mock('@/constants/routes', () => ({
  route: { settings: { general: '/settings/general' } },
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
  events: {
    on: vi.fn((name: string, handler: any) => {
      hoisted.eventHandlers[name] = handler
    }),
    off: vi.fn((name: string) => {
      hoisted.offCalls.push(name)
    }),
  },
}))

import { useDownloadEvents } from '../useDownloadEvents'

function Harness() {
  useDownloadEvents()
  return null
}

const mount = () => render(<Harness />)

describe('useDownloadEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.downloadStore.downloads = {}
    hoisted.eventHandlers = {}
    hoisted.offCalls = []
  })

  it('subscribes to every download event', () => {
    mount()
    for (const name of ['fdu', 'fde', 'fds', 'fdx', 'mvs', 'mvf', 'fdvs']) {
      expect(hoisted.eventHandlers[name], name).toBeDefined()
    }
  })

  it('unsubscribes on unmount', () => {
    mount().unmount()
    expect(hoisted.offCalls).toEqual(
      expect.arrayContaining(['fdu', 'fde', 'fds', 'fdx', 'mvs', 'mvf', 'fdvs'])
    )
  })

  // This is the bridge that makes progress visible anywhere in the app.
  it('feeds progress into the store keyed by model id', () => {
    mount()
    hoisted.eventHandlers['fdu']({
      modelId: 'jan-q4',
      percent: 0.5,
      size: { transferred: 100, total: 200 },
    })
    expect(hoisted.downloadStore.updateProgress).toHaveBeenCalledWith(
      'jan-q4',
      0.5,
      'jan-q4',
      100,
      200
    )
  })

  it('tolerates a progress event with no size', () => {
    mount()
    hoisted.eventHandlers['fdu']({ modelId: 'jan-q4', percent: 0 })
    expect(hoisted.downloadStore.updateProgress).toHaveBeenCalledWith(
      'jan-q4',
      0,
      'jan-q4',
      undefined,
      undefined
    )
  })

  it('handles HTTP 401 with a settings action', () => {
    mount()
    hoisted.eventHandlers['fde']({ modelId: 'x', error: 'HTTP status 401' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'common:toast.downloadTokenRequired.title',
      expect.any(Object)
    )
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith('x')
  })

  it('handles HTTP 403', () => {
    mount()
    hoisted.eventHandlers['fde']({ modelId: 'y', error: 'HTTP status 403' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'common:toast.downloadLicenseRequired.title',
      expect.any(Object)
    )
  })

  it('handles HTTP 429', () => {
    mount()
    hoisted.eventHandlers['fde']({ modelId: 'z', error: 'HTTP status 429' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'common:toast.downloadRateLimited.title',
      expect.any(Object)
    )
  })

  it('falls back to the generic failure toast', () => {
    mount()
    hoisted.eventHandlers['fde']({ modelId: 'w', error: 'other' })
    expect(hoisted.toastMock.error).toHaveBeenCalledWith(
      'common:toast.downloadFailed.title',
      expect.any(Object)
    )
  })

  it('clears the download on success', () => {
    mount()
    hoisted.eventHandlers['fds']({ modelId: 'ok' })
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith('ok')
    expect(
      hoisted.downloadStore.removeLocalDownloadingModel
    ).toHaveBeenCalledWith('ok')
    expect(hoisted.toastMock.success).toHaveBeenCalled()
  })

  it('clears the download on verified success', () => {
    mount()
    hoisted.eventHandlers['fdvs']({ modelId: 'ok' })
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith('ok')
    expect(hoisted.toastMock.success).toHaveBeenCalled()
  })

  it('reports validation starting', () => {
    mount()
    hoisted.eventHandlers['mvs']({ modelId: 'v' })
    expect(hoisted.toastMock.info).toHaveBeenCalled()
  })

  it('clears the download when validation fails', () => {
    mount()
    hoisted.eventHandlers['mvf']({ modelId: 'v' })
    expect(hoisted.toastMock.dismiss).toHaveBeenCalledWith(
      'model-validation-started-v'
    )
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith('v')
    expect(hoisted.toastMock.error).toHaveBeenCalled()
  })

  // A pause cancels the transfer through the same path, so the partial entry
  // has to survive for resume to have anything to resume.
  it('keeps a paused entry on a stopped event', () => {
    hoisted.downloadStore.downloads = {
      'cloud-model': { name: 'cloud-model', progress: 0.3, paused: true },
    }
    mount()
    hoisted.eventHandlers['fdx']({ modelId: 'cloud-model' })
    expect(hoisted.downloadStore.removeDownload).not.toHaveBeenCalled()
  })

  it('removes an unpaused entry on a stopped event', () => {
    hoisted.downloadStore.downloads = {
      'cloud-model': { name: 'cloud-model', progress: 0.3 },
    }
    mount()
    hoisted.eventHandlers['fdx']({ modelId: 'cloud-model' })
    expect(hoisted.downloadStore.removeDownload).toHaveBeenCalledWith(
      'cloud-model'
    )
  })
})
