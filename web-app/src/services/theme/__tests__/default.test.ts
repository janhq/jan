import { describe, it, expect, vi } from 'vitest'
import { DefaultThemeService } from '../default'

describe('DefaultThemeService', () => {
  it('setTheme() logs and resolves', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultThemeService()
    await expect(svc.setTheme('dark' as any)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('setTheme called with theme:', 'dark')
    spy.mockRestore()
  })

  it('getCurrentWindow() returns object with setTheme', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultThemeService()
    const win = svc.getCurrentWindow()
    expect(win).toHaveProperty('setTheme')
    await expect(win.setTheme('light' as any)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith('window.setTheme called with theme:', 'light')
    spy.mockRestore()
  })
})
