import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceKeys } from '@janhq/core'
import { TauriHardwareService } from '../tauri'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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
    it('invokes plugin:hardware|refresh_system_info', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.refreshHardwareInfo()

      expect(invoke).toHaveBeenCalledWith('plugin:hardware|refresh_system_info')
    })
  })
})
