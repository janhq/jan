import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultHardwareService } from '../default'

describe('DefaultHardwareService', () => {
  let svc: DefaultHardwareService

  beforeEach(() => {
    svc = new DefaultHardwareService()
    vi.restoreAllMocks()
  })

  describe('getHardwareInfo', () => {
    it('returns null', async () => {
      const result = await svc.getHardwareInfo()
      expect(result).toBeNull()
    })
  })

  describe('getSystemUsage', () => {
    it('returns null', async () => {
      const result = await svc.getSystemUsage()
      expect(result).toBeNull()
    })
  })

  describe('getLlamacppDevices', () => {
    it('returns empty array', async () => {
      const result = await svc.getLlamacppDevices()
      expect(result).toEqual([])
    })
  })

  describe('setActiveGpus', () => {
    it('resolves without error', async () => {
      await expect(svc.setActiveGpus({ gpus: [0, 1] })).resolves.toBeUndefined()
    })
  })

  describe('refreshHardwareInfo', () => {
    it('resolves without error', async () => {
      await expect(svc.refreshHardwareInfo()).resolves.toBeUndefined()
    })
  })
})
