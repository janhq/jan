import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockClose,
  mockShow,
  mockHide,
  mockSetFocus,
  mockSetTitle,
  mockSetTheme,
  mockGetByLabel,
  mockConstructor,
} = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockShow: vi.fn(),
  mockHide: vi.fn(),
  mockSetFocus: vi.fn(),
  mockSetTitle: vi.fn(),
  mockSetTheme: vi.fn(),
  mockGetByLabel: vi.fn(),
  mockConstructor: vi.fn(),
}))

function makeMockWindow() {
  return {
    close: mockClose,
    show: mockShow,
    hide: mockHide,
    setFocus: mockSetFocus,
    setTitle: mockSetTitle,
    setTheme: mockSetTheme,
  }
}

vi.mock('@tauri-apps/api/webviewWindow', () => {
  const Ctor = function (...args: unknown[]) {
    mockConstructor(...args)
    return makeMockWindow()
  } as unknown as { new (...args: unknown[]): unknown; getByLabel: typeof mockGetByLabel }
  Ctor.getByLabel = mockGetByLabel
  return { WebviewWindow: Ctor }
})

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

import { TauriWindowService } from '../tauri'
import { DefaultWindowService } from '../default'
import type { WindowConfig } from '../types'

describe('TauriWindowService', () => {
  let svc: TauriWindowService
  const baseConfig: WindowConfig = {
    url: '/test',
    label: 'test-window',
    title: 'Test',
    width: 800,
    height: 600,
    center: true,
    resizable: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockClose.mockResolvedValue(undefined)
    mockShow.mockResolvedValue(undefined)
    mockHide.mockResolvedValue(undefined)
    mockSetFocus.mockResolvedValue(undefined)
    mockSetTitle.mockResolvedValue(undefined)
    mockSetTheme.mockResolvedValue(undefined)
    localStorage.clear()
    svc = new TauriWindowService()
  })

  it('extends DefaultWindowService', () => {
    expect(svc).toBeInstanceOf(DefaultWindowService)
  })

  describe('createWebviewWindow', () => {
    it('creates a WebviewWindow with correct config', async () => {
      const result = await svc.createWebviewWindow(baseConfig)
      expect(mockConstructor).toHaveBeenCalledWith('test-window', {
        url: '/test',
        title: 'Test',
        width: 800,
        height: 600,
        center: true,
        resizable: true,
        minimizable: undefined,
        maximizable: undefined,
        closable: undefined,
        fullscreen: undefined,
        theme: undefined,
      })
      expect(result.label).toBe('test-window')
    })

    it('sets dark theme from localStorage', async () => {
      localStorage.setItem(
        'jan-theme',
        JSON.stringify({ state: { activeTheme: 'dark', isDark: true } })
      )
      await svc.createWebviewWindow(baseConfig)
      expect(mockConstructor).toHaveBeenCalledWith(
        'test-window',
        expect.objectContaining({ theme: 'dark' })
      )
    })

    it('sets light theme from localStorage', async () => {
      localStorage.setItem(
        'jan-theme',
        JSON.stringify({ state: { activeTheme: 'light', isDark: false } })
      )
      await svc.createWebviewWindow(baseConfig)
      expect(mockConstructor).toHaveBeenCalledWith(
        'test-window',
        expect.objectContaining({ theme: 'light' })
      )
    })

    it('sets undefined theme when activeTheme is auto', async () => {
      localStorage.setItem(
        'jan-theme',
        JSON.stringify({ state: { activeTheme: 'auto', isDark: false } })
      )
      await svc.createWebviewWindow(baseConfig)
      expect(mockConstructor).toHaveBeenCalledWith(
        'test-window',
        expect.objectContaining({ theme: undefined })
      )
    })

    it('handles invalid JSON in localStorage gracefully', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      localStorage.setItem('jan-theme', 'not-json')
      await svc.createWebviewWindow(baseConfig)
      expect(spy).toHaveBeenCalled()
      expect(mockConstructor).toHaveBeenCalledWith(
        'test-window',
        expect.objectContaining({ theme: undefined })
      )
      spy.mockRestore()
    })

    it('returned instance delegates to webviewWindow methods', async () => {
      const inst = await svc.createWebviewWindow(baseConfig)
      await inst.close()
      expect(mockClose).toHaveBeenCalled()
      await inst.show()
      expect(mockShow).toHaveBeenCalled()
      await inst.hide()
      expect(mockHide).toHaveBeenCalled()
      await inst.focus()
      expect(mockSetFocus).toHaveBeenCalled()
      await inst.setTitle('New Title')
      expect(mockSetTitle).toHaveBeenCalledWith('New Title')
    })

    it('logs and rethrows on error', async () => {
      const err = new Error('creation failed')
      mockConstructor.mockImplementationOnce(() => {
        throw err
      })
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.createWebviewWindow(baseConfig)).rejects.toBe(err)
      expect(spy).toHaveBeenCalledWith('Error creating Tauri window:', err)
      spy.mockRestore()
    })
  })

  describe('getWebviewWindowByLabel', () => {
    it('returns instance when window exists', async () => {
      mockGetByLabel.mockResolvedValueOnce(makeMockWindow())
      const result = await svc.getWebviewWindowByLabel('my-label')
      expect(mockGetByLabel).toHaveBeenCalledWith('my-label')
      expect(result).not.toBeNull()
      expect(result!.label).toBe('my-label')
    })

    it('returns null when window does not exist', async () => {
      mockGetByLabel.mockResolvedValueOnce(null)
      const result = await svc.getWebviewWindowByLabel('missing')
      expect(result).toBeNull()
    })

    it('returns null and logs on error', async () => {
      const err = new Error('lookup failed')
      mockGetByLabel.mockRejectedValueOnce(err)
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await svc.getWebviewWindowByLabel('bad')
      expect(result).toBeNull()
      expect(spy).toHaveBeenCalledWith('Error getting Tauri window by label:', err)
      spy.mockRestore()
    })
  })

  describe('openWindow', () => {
    it('shows and focuses existing window', async () => {
      mockGetByLabel.mockResolvedValueOnce(makeMockWindow())
      await svc.openWindow(baseConfig)
      expect(mockShow).toHaveBeenCalled()
      expect(mockSetFocus).toHaveBeenCalled()
    })

    it('creates new window when none exists', async () => {
      mockGetByLabel.mockResolvedValueOnce(null)
      await svc.openWindow(baseConfig)
      expect(mockConstructor).toHaveBeenCalledWith(
        'test-window',
        expect.objectContaining({ url: '/test' })
      )
    })
  })

  describe('openLogsWindow', () => {
    it('opens with correct config', async () => {
      mockGetByLabel.mockResolvedValueOnce(null)
      await svc.openLogsWindow()
      expect(mockConstructor).toHaveBeenCalledWith(
        'logs-app-window',
        expect.objectContaining({ url: '/logs', title: 'App Logs - Jan' })
      )
    })

    it('rethrows when createWebviewWindow fails', async () => {
      const err = new Error('fail')
      mockGetByLabel.mockResolvedValueOnce(null)
      mockConstructor.mockImplementationOnce(() => { throw err })
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.openLogsWindow()).rejects.toBe(err)
      spy.mockRestore()
    })
  })

  describe('openSystemMonitorWindow', () => {
    it('opens with correct config', async () => {
      mockGetByLabel.mockResolvedValueOnce(null)
      await svc.openSystemMonitorWindow()
      expect(mockConstructor).toHaveBeenCalledWith(
        'system-monitor-window',
        expect.objectContaining({
          url: '/system-monitor',
          title: 'System Monitor - Jan',
          width: 1000,
          height: 700,
        })
      )
    })

    it('rethrows when createWebviewWindow fails', async () => {
      const err = new Error('fail')
      mockGetByLabel.mockResolvedValueOnce(null)
      mockConstructor.mockImplementationOnce(() => { throw err })
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.openSystemMonitorWindow()).rejects.toBe(err)
      spy.mockRestore()
    })
  })

  describe('openLocalApiServerLogsWindow', () => {
    it('opens with correct config', async () => {
      mockGetByLabel.mockResolvedValueOnce(null)
      await svc.openLocalApiServerLogsWindow()
      expect(mockConstructor).toHaveBeenCalledWith(
        'logs-window-local-api-server',
        expect.objectContaining({
          url: '/local-api-server/logs',
          title: 'Local API Server Logs - Jan',
        })
      )
    })

    it('rethrows when createWebviewWindow fails', async () => {
      const err = new Error('fail')
      mockGetByLabel.mockResolvedValueOnce(null)
      mockConstructor.mockImplementationOnce(() => { throw err })
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(svc.openLocalApiServerLogsWindow()).rejects.toBe(err)
      spy.mockRestore()
    })
  })
})
