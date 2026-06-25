/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom'

const h = vi.hoisted(() => ({
  registerActive: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue(undefined),
  unload: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
  windowLabel: 'main',
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
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

vi.mock('@/lib/service', () => ({ APIs: {} }))
vi.mock('@/services/events/EventEmitter', () => ({ EventEmitter: class {} }))
vi.mock('@janhq/core', () => ({ EngineManager: class {}, ModelManager: class {} }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: h.windowLabel }),
}))
vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }))

import { ExtensionProvider } from '../ExtensionProvider'

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
    document.body.className = ''
    document.body.innerHTML =
      '<div id="initial-loader"><p id="initial-loader-caption"></p></div>'
  })

  afterEach(() => {
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
    expect(h.emit).not.toHaveBeenCalledWith('app-ready')
  })
})
