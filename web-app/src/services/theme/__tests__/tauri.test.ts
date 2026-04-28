import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getAllWebviewWindows: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({
  Theme: {},
}))

import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow'
import { TauriThemeService } from '../tauri'

const makeWindow = (label: string, setTheme = vi.fn().mockResolvedValue(undefined)) => ({
  label,
  setTheme,
})

describe('TauriThemeService.setTheme', () => {
  beforeEach(() => {
    vi.mocked(getAllWebviewWindows).mockReset()
  })

  it('applies theme to all webview windows when given an array', async () => {
    const w1 = makeWindow('main')
    const w2 = makeWindow('secondary')
    vi.mocked(getAllWebviewWindows).mockResolvedValueOnce([w1, w2] as any)

    const svc = new TauriThemeService()
    await svc.setTheme('dark' as any)

    expect(w1.setTheme).toHaveBeenCalledWith('dark')
    expect(w2.setTheme).toHaveBeenCalledWith('dark')
  })

  it('handles non-array (object map) windows result', async () => {
    const w1 = makeWindow('main')
    vi.mocked(getAllWebviewWindows).mockResolvedValueOnce({ main: w1 } as any)

    const svc = new TauriThemeService()
    await svc.setTheme('light' as any)

    expect(w1.setTheme).toHaveBeenCalledWith('light')
  })

  it('continues on per-window setTheme errors', async () => {
    const bad = makeWindow('bad', vi.fn().mockRejectedValue(new Error('x')))
    const good = makeWindow('good')
    vi.mocked(getAllWebviewWindows).mockResolvedValueOnce([bad, good] as any)

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = new TauriThemeService()
    await expect(svc.setTheme('dark' as any)).resolves.toBeUndefined()
    expect(good.setTheme).toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('rethrows when getAllWebviewWindows itself fails', async () => {
    vi.mocked(getAllWebviewWindows).mockRejectedValueOnce(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = new TauriThemeService()
    await expect(svc.setTheme('dark' as any)).rejects.toThrow('boom')
    errSpy.mockRestore()
  })
})

describe('TauriThemeService.getCurrentWindow', () => {
  it('returns a wrapper whose setTheme delegates to setTheme()', async () => {
    vi.mocked(getAllWebviewWindows).mockResolvedValueOnce([])
    const svc = new TauriThemeService()
    const spy = vi.spyOn(svc, 'setTheme')
    await svc.getCurrentWindow().setTheme('light' as any)
    expect(spy).toHaveBeenCalledWith('light')
  })
})
