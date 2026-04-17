import { describe, it, expect, vi } from 'vitest'
import { DefaultUpdaterService } from '../default'

describe('DefaultUpdaterService', () => {
  it('check() returns null', async () => {
    const svc = new DefaultUpdaterService()
    expect(await svc.check()).toBeNull()
  })

  it('installAndRestart() resolves', async () => {
    const svc = new DefaultUpdaterService()
    await expect(svc.installAndRestart()).resolves.toBeUndefined()
  })

  it('downloadAndInstallWithProgress() logs and resolves', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultUpdaterService()
    const cb = vi.fn()
    await expect(svc.downloadAndInstallWithProgress(cb)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith(
      'downloadAndInstallWithProgress called with callback:',
      'function'
    )
    spy.mockRestore()
  })
})
