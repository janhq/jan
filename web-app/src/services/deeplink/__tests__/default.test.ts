import { describe, it, expect, vi } from 'vitest'
import { DefaultDeepLinkService } from '../default'

describe('DefaultDeepLinkService', () => {
  it('onOpenUrl() logs, returns unlisten fn', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const svc = new DefaultDeepLinkService()
    const handler = vi.fn()
    const unlisten = await svc.onOpenUrl(handler)
    expect(spy).toHaveBeenCalledWith('onOpenUrl called with handler:', 'function')
    expect(typeof unlisten).toBe('function')
    // unlisten is a no-op
    expect(unlisten()).toBeUndefined()
    spy.mockRestore()
  })

  it('getCurrent() returns empty array', async () => {
    const svc = new DefaultDeepLinkService()
    expect(await svc.getCurrent()).toEqual([])
  })
})
