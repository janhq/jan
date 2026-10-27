/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'

const h = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  windowLabel: 'main',
  calls: [] as string[],
  host: {
    activateBuiltins: vi.fn().mockResolvedValue(undefined),
    loadInstalled: vi.fn().mockResolvedValue(undefined),
    deactivateAll: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(() => [] as { id: string; source: string }[]),
    reload: vi.fn().mockResolvedValue(undefined),
  },
  installSupported: true,
  settings: new Map<string, string>(),
  setSafeMode: vi.fn().mockResolvedValue(undefined),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  bridge: vi.fn(),
  stopBridge: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  i18n: { t: (k: string) => k },
  useTranslation: () => ({
    t: (k: string) => {
      if (k === 'settingUpJan') return 'Booting up Jan…'
      if (k === 'registeringExtensions') return 'Registering extensions…'
      return k
    },
  }),
}))

vi.mock('@/lib/extensions/host', () => ({ getExtensionHost: () => h.host }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    extensions: () => ({
      isSupported: () => h.installSupported,
      setSafeMode: h.setSafeMode,
      list: async () => ({ extensions: [{ id: 'acme.one' }] }),
    }),
    events: () => ({ listen: h.listen }),
  }),
}))
vi.mock('@/lib/modelValidationBridge', () => ({
  bridgeModelValidationStarted: h.bridge,
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
vi.mock('sonner', () => ({
  toast: { warning: h.toastWarning, error: h.toastError },
}))
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
    h.bridge.mockResolvedValue(h.stopBridge)
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
    // Stay on the activation phase so the loader isn't dismissed mid-assertion.
    h.host.activateBuiltins.mockImplementation(() => new Promise<void>(() => {}))
    renderProvider()
    await waitFor(() =>
      expect(
        document.getElementById('initial-loader-caption')?.textContent
      ).toBe('Registering extensions…')
    )
  })

  it('gates children until extension setup finishes, then renders them', async () => {
    renderProvider()
    expect(screen.queryByTestId('child')).toBeNull()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    expect(h.host.activateBuiltins).toHaveBeenCalled()
  })

  it('activates the host built-ins before the installed extensions', async () => {
    renderProvider()
    await screen.findByTestId('child')
    expect(h.host.activateBuiltins).toHaveBeenCalledWith(getHostBuiltins())
    await waitFor(() => expect(h.calls).toEqual(['host', 'installed']))
  })

  it('does not hold the UI back while installed extensions start', async () => {
    h.host.loadInstalled.mockImplementation(() => new Promise<void>(() => {}))
    renderProvider()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    expect(h.host.loadInstalled).toHaveBeenCalled()
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
  })

  it('applies the safe mode the guard turns on to the installed extensions live', async () => {
    h.settings.set('extension-host:failedStarts', '2')
    renderProvider()
    await screen.findByTestId('child')
    await waitFor(() => expect(h.host.loadInstalled).toHaveBeenCalled())
    // Stopped through the same reload path an enable or disable takes.
    expect(h.host.reload).toHaveBeenCalledWith('acme.one')
    expect(h.host.reload.mock.invocationCallOrder[0]).toBeLessThan(
      h.host.loadInstalled.mock.invocationCallOrder[0]
    )
  })

  it('skips the installed extensions and says so when safe mode cannot be turned on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.settings.set('extension-host:failedStarts', '2')
    h.setSafeMode.mockRejectedValue(new Error('registry I/O'))
    renderProvider()
    await screen.findByTestId('child')
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        'extensions:crashed.safeModeFailed'
      )
    )
    expect(h.host.loadInstalled).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'Turning on safe mode failed:',
      expect.any(Error)
    )
  })

  it('counts a start as good once the window closes cleanly', async () => {
    renderProvider()
    await screen.findByTestId('child')
    await waitFor(() => expect(h.host.loadInstalled).toHaveBeenCalled())
    expect(h.settings.get('extension-host:failedStarts')).toBe('1')
    window.dispatchEvent(new Event('pagehide'))
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
    expect(h.calls).toEqual(['host'])
  })

  it('still renders children and loads installed ones if host activation rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.host.activateBuiltins.mockRejectedValue(new Error('boom'))
    renderProvider()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    await waitFor(() => expect(h.host.loadInstalled).toHaveBeenCalled())
  })

  it('deactivates host extensions on unmount', async () => {
    const { unmount } = renderProvider()
    await screen.findByTestId('child')
    unmount()
    expect(h.host.deactivateAll).toHaveBeenCalled()
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

  it('finishes immediately on non-main windows without loading extensions', async () => {
    h.windowLabel = 'logs'
    renderProvider()
    expect(await screen.findByTestId('child')).toBeInTheDocument()
    expect(h.host.activateBuiltins).not.toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalledWith('app-ready')
  })

  // The download manager's validation event reaches the core bus once, in the
  // main window, as it did when the llamacpp built-in relayed it: a second
  // window relaying it too would toast a validation that is not its own.
  it('relays model validation onto the core bus in the main window only', async () => {
    const { unmount } = renderProvider()
    await screen.findByTestId('child')
    expect(h.bridge).toHaveBeenCalledTimes(1)
    expect(h.bridge).toHaveBeenCalledWith({ listen: h.listen })
    unmount()
    await waitFor(() => expect(h.stopBridge).toHaveBeenCalled())
  })

  it('does not relay model validation in a secondary window', async () => {
    h.windowLabel = 'logs'
    renderProvider()
    await screen.findByTestId('child')
    expect(h.bridge).not.toHaveBeenCalled()
  })
})
