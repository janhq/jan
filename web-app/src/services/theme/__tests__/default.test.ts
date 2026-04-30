import { describe, it, expect } from 'vitest'
import { DefaultThemeService } from '../default'

describe('DefaultThemeService', () => {
  it('setTheme() resolves', async () => {
    const svc = new DefaultThemeService()
    await expect(svc.setTheme('dark' as any)).resolves.toBeUndefined()
  })

  it('getCurrentWindow() returns object with setTheme that resolves', async () => {
    const svc = new DefaultThemeService()
    const win = svc.getCurrentWindow()
    expect(win).toHaveProperty('setTheme')
    await expect(win.setTheme('light' as any)).resolves.toBeUndefined()
  })
})
