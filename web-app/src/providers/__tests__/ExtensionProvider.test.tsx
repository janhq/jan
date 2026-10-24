/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'

const h = vi.hoisted(() => ({
  registerActive: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue(undefined),
  unload: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
  windowLabel: 'main',
  calls: [] as string[],
  host: {
    activateBuiltins: vi.fn().mockResolvedValue(undefined),
    loadInstalled: vi.fn().mockResolvedValue(undefined),
    deactivateAll: vi.fn().mockResolvedValue(undefined),
  },
  installSupported: true,
  settings: new Map<string, string>(),
  setSafeMode: vi.fn().mockResolvedValue(undefined),
  toastWarning: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  i18n: { t: (k: string) => k },
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) => {
      if (k === 'settingUpJan') return 'Booting up Jan…'
      if (k === 'registeringExtensions') return 'Registering extensions…'
      if (k === 'loadingExtensions')
        return `Loading extensions… (${vars?.done ?? 0}/${vars?.total ?? 0})`
      return k
    },
  }),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: class {
    static getInstance() {
      return { registerActive: h.registerActive, load: h.load, unload: h.unload }
    }
  },
}))

vi.mock('@/lib/extensions/host', () => ({ getExtensionHost: () => h.host }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    extensions: () => ({
      isSupported: () => h.installSupported,
      setSafeMode: h.setSafeMode,
    }),
  }),
}))

vi.mock('@/lib/service', () => ({ APIs: {} }))
vi.mock('@/services/events/EventEmitter', () => ({ EventEmitter: class {} }))
vi.mock('@janhq/core', () => ({
  EngineManager: class {},
  ModelManager: class {},
  appSettings: {
    get: async (key: string) => h.settings.get(key) ?? null,
    set: async (key: string, value: string) => void h.settings.set(key, value),
  },
}))
vi.mock('sonner', () => ({ toast: { warning: h.toastWarning } }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: h.windowLabel }),
}))
vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }))

import { ExtensionProvider } from '../ExtensionProvider'
import { getHostBuiltins } from '@/lib/extensions/builtins'

const renderProvider = () =>
  render(
    <ExtensionProvider>
      <div data-testid="child">app</div>
    </ExtensionProvider>
  )

describe('ExtensionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.registerActive.mockResolvedValue(undefined)
    h.load.mockResolvedValue(undefined)
    h.emit.mockResolvedValue(undefined)
    h.windowLabel = 'main'
    h.calls = []
    h.installSupported = true
    h.settings.clear()
    h.setSafeMode.mockResolvedValue(undefined)
    h.host.activateBuiltins.mockImplementation(async () => void h.calls.push('host'))
    h.host.loadInstalled.mockImplementation(
      async () => void h.calls.push('installed')
    )
    h.host.deactivateAll.mockResolvedValue(undefined)
    h.registerActive.mockImplementation(async () => void h.calls.push('legacy'))
    document.body.className = ''
    document.body.innerHTML =
      '<div id="initial-loader"><p id="initial-loader-caption"></p></div>'
  })

  afterEach(() => {
    // Unmount first: restoreAllMocks strips h.emit's resolved value, and on a
    // slow runner the app-ready effect can still be pending at this point, so
    // emit('app-ready').catch would hit undefined. The global cleanup runs
    // only after this hook.
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows phased setup status in the loader caption', async () => {
    // Stay on the loading phase so the loader isn't dismissed mid-assertion.
    h.load.mockImplementation((onProgress?: (d: number, t: number) => void) => {
      onProgress?.(3, 7)
      return new Promise<void>(() => {})
    })
    renderProvider()
    await waitFor(() =>
      expect(
        document.getElementById('initial-loader-caption')?.textContent
      ).toBe('Loading extensions… (3/7)')
    )
  })

  it('gates children until extension setup finishes, then renders them', async () => {
    renderProvider()
    expect(screen.queryByTestId('child')).toBeNull()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    expect(h.registerActive).toHaveBeenCalled()
    expect(h.load).toHaveBeenCalled()
  })

  it('activates the host built-ins before the legacy manager', async () => {
    renderProvider()
    await screen.findByTestId('child')
    expect(h.host.activateBuiltins).toHaveBeenCalledWith(getHostBuiltins())
    // Installed and legacy loads do not wait on each other.
    await waitFor(() =>
      expect([...h.calls].sort()).toEqual(['host', 'installed', 'legacy'])
    )
    expect(h.calls[0]).toBe('host')
    expect(h.host.activateBuiltins.mock.invocationCallOrder[0]).toBeLessThan(
      h.host.loadInstalled.mock.invocationCallOrder[0]
    )
  })

  it('does not hold the legacy extensions back while installed ones start', async () => {
    h.host.loadInstalled.mockImplementation(() => new Promise<void>(() => {}))
    renderProvider()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    expect(h.host.loadInstalled).toHaveBeenCalled()
    expect(h.load).toHaveBeenCalled()
  })

  it('logs a failure to load the installed extensions', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.host.loadInstalled.mockRejectedValue(new Error('registry gone'))
    renderProvider()
    await screen.findByTestId('child')
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'Loading installed extensions failed:',
        expect.any(Error)
      )
    )
  })

  it('turns on safe mode after two starts that never got the installed extensions loaded', async () => {
    h.settings.set('extension-host:failedStarts', '2')
    renderProvider()
    await screen.findByTestId('child')
    await waitFor(() => expect(h.host.loadInstalled).toHaveBeenCalled())
    expect(h.setSafeMode).toHaveBeenCalledWith(true)
    expect(h.setSafeMode.mock.invocationCallOrder[0]).toBeLessThan(
      h.host.loadInstalled.mock.invocationCallOrder[0]
    )
    expect(h.toastWarning).toHaveBeenCalledWith('extensions:crashed.safeMode')
    await waitFor(() =>
      expect(h.settings.get('extension-host:failedStarts')).toBe('0')
    )
  })

  it('keeps a start counted as failed while installed extensions are loading', async () => {
    h.host.loadInstalled.mockImplementation(() => new Promise<void>(() => {}))
    renderProvider()
    await screen.findByTestId('child')
    await waitFor(() =>
      expect(h.settings.get('extension-host:failedStarts')).toBe('1')
    )
    expect(h.setSafeMode).not.toHaveBeenCalled()
  })

  it('loads no installed extension where there is no install pipeline', async () => {
    h.installSupported = false
    renderProvider()
    await screen.findByTestId('child')
    expect(h.host.loadInstalled).not.toHaveBeenCalled()
    expect(h.calls).toEqual(['host', 'legacy'])
  })

  it('still runs the legacy manager if host activation rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.host.activateBuiltins.mockRejectedValue(new Error('boom'))
    renderProvider()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    expect(h.registerActive).toHaveBeenCalled()
  })

  it('deactivates host extensions on unmount', async () => {
    const { unmount } = renderProvider()
    await screen.findByTestId('child')
    unmount()
    expect(h.host.deactivateAll).toHaveBeenCalled()
    expect(h.unload).toHaveBeenCalled()
  })

  it('dismisses the branded loader only after setup completes', async () => {
    renderProvider()
    expect(document.body.classList.contains('loaded')).toBe(false)
    await waitFor(() =>
      expect(document.body.classList.contains('loaded')).toBe(true)
    )
    await waitFor(
      () => expect(document.getElementById('initial-loader')).toBeNull(),
      { timeout: 1000 }
    )
  })

  it('emits app-ready after setup on the main window', async () => {
    renderProvider()
    await screen.findByTestId('child')
    await waitFor(() => expect(h.emit).toHaveBeenCalledWith('app-ready'))
  })

  it('still renders children if extension setup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.load.mockRejectedValue(new Error('boom'))
    renderProvider()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
  })

  it('finishes immediately on non-main windows without loading extensions', async () => {
    h.windowLabel = 'logs'
    renderProvider()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    expect(h.registerActive).not.toHaveBeenCalled()
    expect(h.load).not.toHaveBeenCalled()
    expect(h.host.activateBuiltins).not.toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalledWith('app-ready')
  })
})
