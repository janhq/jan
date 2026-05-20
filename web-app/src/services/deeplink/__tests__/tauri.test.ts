import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockOnOpenUrl, mockGetCurrent } = vi.hoisted(() => ({
  mockOnOpenUrl: vi.fn(),
  mockGetCurrent: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: mockOnOpenUrl,
  getCurrent: mockGetCurrent,
}))

import { TauriDeepLinkService } from '../tauri'

describe('TauriDeepLinkService', () => {
  let svc: TauriDeepLinkService

  beforeEach(() => {
    svc = new TauriDeepLinkService()
    vi.clearAllMocks()
  })

  describe('onOpenUrl', () => {
    it('delegates to tauri plugin and returns unlisten', async () => {
      const unlisten = vi.fn()
      mockOnOpenUrl.mockResolvedValue(unlisten)
      const handler = vi.fn()
      const result = await svc.onOpenUrl(handler)
      expect(mockOnOpenUrl).toHaveBeenCalledWith(handler)
      expect(result).toBe(unlisten)
    })

    it('returns no-op on error', async () => {
      mockOnOpenUrl.mockRejectedValue(new Error('fail'))
      const result = await svc.onOpenUrl(vi.fn())
      expect(typeof result).toBe('function')
    })
  })

  describe('getCurrent', () => {
    it('returns deep link urls', async () => {
      mockGetCurrent.mockResolvedValue(['jan://open/model'])
      expect(await svc.getCurrent()).toEqual(['jan://open/model'])
    })

    it('returns empty array when result is null', async () => {
      mockGetCurrent.mockResolvedValue(null)
      expect(await svc.getCurrent()).toEqual([])
    })

    it('returns empty array on error', async () => {
      mockGetCurrent.mockRejectedValue(new Error('fail'))
      expect(await svc.getCurrent()).toEqual([])
    })
  })
})
