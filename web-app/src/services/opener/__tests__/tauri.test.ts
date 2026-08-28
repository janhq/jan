import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}))

import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { TauriOpenerService } from '../tauri'
import { DefaultOpenerService } from '../default'

describe('TauriOpenerService', () => {
  beforeEach(() => {
    vi.mocked(revealItemInDir).mockReset()
    vi.mocked(openPath).mockReset()
  })

  it('extends DefaultOpenerService', () => {
    const svc = new TauriOpenerService()
    expect(svc).toBeInstanceOf(DefaultOpenerService)
  })

  it('revealItemInDir delegates to the opener plugin, which is native per OS', async () => {
    vi.mocked(revealItemInDir).mockResolvedValueOnce(undefined)
    const svc = new TauriOpenerService()
    await svc.revealItemInDir('/tmp/x')
    expect(revealItemInDir).toHaveBeenCalledWith('/tmp/x')
  })

  it('openPath delegates to the opener plugin', async () => {
    vi.mocked(openPath).mockResolvedValueOnce(undefined)
    const svc = new TauriOpenerService()
    await svc.openPath('/tmp/x')
    expect(openPath).toHaveBeenCalledWith('/tmp/x')
  })

  it('revealItemInDir logs and rethrows when invoke rejects', async () => {
    const err = new Error('boom')
    vi.mocked(revealItemInDir).mockRejectedValueOnce(err)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = new TauriOpenerService()
    await expect(svc.revealItemInDir('/tmp/x')).rejects.toBe(err)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('DefaultOpenerService', () => {
  it('revealItemInDir is a no-op that resolves', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultOpenerService()
    await expect(svc.revealItemInDir('/any/path')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith(
      'revealItemInDir called with path:',
      '/any/path'
    )
    spy.mockRestore()
  })
})
