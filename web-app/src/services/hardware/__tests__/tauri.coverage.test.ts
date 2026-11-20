import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceKeys } from '@janhq/core'
import { TauriHardwareService } from '../tauri'

vi.mock('@janhq/tauri-plugin-hardware-api', () => ({
  refreshSystemInfo: vi.fn(),
}))

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => ({ services: { get: h.get } }),
}))

describe('TauriHardwareService – coverage', () => {
  let svc: TauriHardwareService

  beforeEach(() => {
    svc = new TauriHardwareService()
    vi.clearAllMocks()
  })

  describe('getLlamacppDevices', () => {
    it('returns devices from the llamacpp service', async () => {
      const devices = [{ id: 0, name: 'GPU 0' }]
      h.get.mockReturnValue({ getDevices: vi.fn().mockResolvedValue(devices) })

      const result = await svc.getLlamacppDevices()

      expect(h.get).toHaveBeenCalledWith(ServiceKeys.Llamacpp)
      expect(result).toEqual(devices)
    })

    it('throws when the llamacpp service is not provided', async () => {
      h.get.mockReturnValue(undefined)

      await expect(svc.getLlamacppDevices()).rejects.toThrow(
        'llamacpp extension not found'
      )
    })
  })

  describe('reconcileLlamacppDevices', () => {
    it('asks the llamacpp service to reconcile and returns its answer', async () => {
      const reconcileEngineDevices = vi.fn().mockResolvedValue('restarted')
      h.get.mockReturnValue({ reconcileEngineDevices })

      await expect(svc.reconcileLlamacppDevices()).resolves.toBe('restarted')
      expect(h.get).toHaveBeenCalledWith(ServiceKeys.Llamacpp)
    })

    it('is unchanged when the service is absent', async () => {
      h.get.mockReturnValue(undefined)
      await expect(svc.reconcileLlamacppDevices()).resolves.toBe('unchanged')
    })
  })

  describe('refreshHardwareInfo', () => {
    it('drops the cached detection through the hardware plugin', async () => {
      const { refreshSystemInfo } = await import('@janhq/tauri-plugin-hardware-api')
      vi.mocked(refreshSystemInfo).mockResolvedValue(undefined)

      await svc.refreshHardwareInfo()

      expect(refreshSystemInfo).toHaveBeenCalled()
    })
  })
})
