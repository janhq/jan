import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultCoreService } from '../default'

describe('DefaultCoreService', () => {
  let svc: DefaultCoreService

  beforeEach(() => {
    svc = new DefaultCoreService()
    vi.restoreAllMocks()
  })

  describe('invoke', () => {
    it('throws not implemented error', async () => {
      await expect(svc.invoke('someCommand')).rejects.toThrow(
        'Core invoke not implemented'
      )
    })

    it('throws not implemented error with args', async () => {
      await expect(svc.invoke('cmd', { key: 'val' })).rejects.toThrow(
        'Core invoke not implemented'
      )
    })
  })

  describe('convertFileSrc', () => {
    it('returns the file path as-is', () => {
      const result = svc.convertFileSrc('/path/to/file.png')
      expect(result).toBe('/path/to/file.png')
    })

    it('returns file path with protocol param', () => {
      const result = svc.convertFileSrc('/path/to/file.png', 'asset')
      expect(result).toBe('/path/to/file.png')
    })
  })

  describe('getActiveExtensions', () => {
    it('returns empty array', async () => {
      const result = await svc.getActiveExtensions()
      expect(result).toEqual([])
    })
  })

  describe('getAppToken', () => {
    it('returns null', async () => {
      const result = await svc.getAppToken()
      expect(result).toBeNull()
    })
  })
})
