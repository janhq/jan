import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriHardwareService } from '../tauri'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mockGetDevices = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: {
    core: {
      extensionManager: {
        getByName: vi.fn(),
      },
    },
  },
  writable: true,
})

describe('TauriHardwareService – coverage', () => {
  let svc: TauriHardwareService

  beforeEach(() => {
    svc = new TauriHardwareService()
    vi.clearAllMocks()
  })

  describe('getLlamacppDevices', () => {
    it('returns devices from llamacpp extension', async () => {
      const devices = [{ id: 0, name: 'GPU 0' }]
      mockGetDevices.mockResolvedValue(devices)
      vi.mocked(window.core.extensionManager.getByName).mockReturnValue({
        getDevices: mockGetDevices,
      })

      const result = await svc.getLlamacppDevices()

      expect(window.core.extensionManager.getByName).toHaveBeenCalledWith(
        '@janhq/llamacpp-extension'
      )
      expect(result).toEqual(devices)
    })

    it('throws when llamacpp extension not found', async () => {
      vi.mocked(window.core.extensionManager.getByName).mockReturnValue(undefined)

      await expect(svc.getLlamacppDevices()).rejects.toThrow(
        'llamacpp extension not found'
      )
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
