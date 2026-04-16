import { describe, it, expect, vi } from 'vitest'

import { DefaultWindowService } from '../default'

describe('DefaultWindowService', () => {
  it('createWebviewWindow returns instance with config label', async () => {
    const svc = new DefaultWindowService()
    const win = await svc.createWebviewWindow({ url: '/test', label: 'main' })
    expect(win.label).toBe('main')
  })

  it('createWebviewWindow instance methods are no-ops', async () => {
    const svc = new DefaultWindowService()
    const win = await svc.createWebviewWindow({ url: '/test', label: 'w' })
    await expect(win.close()).resolves.toBeUndefined()
    await expect(win.show()).resolves.toBeUndefined()
    await expect(win.hide()).resolves.toBeUndefined()
    await expect(win.focus()).resolves.toBeUndefined()
  })

  it('createWebviewWindow setTitle logs', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultWindowService()
    const win = await svc.createWebviewWindow({ url: '/test', label: 'w' })
    await win.setTitle('Hello')
    expect(spy).toHaveBeenCalledWith('window.setTitle called with title:', 'Hello')
    spy.mockRestore()
  })

  it('getWebviewWindowByLabel returns null and logs', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultWindowService()
    const result = await svc.getWebviewWindowByLabel('test')
    expect(result).toBeNull()
    expect(spy).toHaveBeenCalledWith('getWebviewWindowByLabel called with label:', 'test')
    spy.mockRestore()
  })

  it('openWindow logs config', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultWindowService()
    const config = { url: '/x', label: 'y' }
    await expect(svc.openWindow(config)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('openWindow called with config:', config)
    spy.mockRestore()
  })

  it('openLogsWindow resolves', async () => {
    const svc = new DefaultWindowService()
    await expect(svc.openLogsWindow()).resolves.toBeUndefined()
  })

  it('openSystemMonitorWindow resolves', async () => {
    const svc = new DefaultWindowService()
    await expect(svc.openSystemMonitorWindow()).resolves.toBeUndefined()
  })

  it('openLocalApiServerLogsWindow resolves', async () => {
    const svc = new DefaultWindowService()
    await expect(svc.openLocalApiServerLogsWindow()).resolves.toBeUndefined()
  })
})
