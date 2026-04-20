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

  describe('installExtensions', () => {
    it('resolves without error', async () => {
      await expect(svc.installExtensions()).resolves.toBeUndefined()
    })
  })

  describe('installExtension', () => {
    it('returns the same extensions passed in', async () => {
      const exts = [{ name: 'ext1' }] as any
      const result = await svc.installExtension(exts)
      expect(result).toBe(exts)
    })
  })

  describe('uninstallExtension', () => {
    it('returns false', async () => {
      const result = await svc.uninstallExtension(['ext1'])
      expect(result).toBe(false)
    })

    it('returns false with reload param', async () => {
      const result = await svc.uninstallExtension(['ext1', 'ext2'], false)
      expect(result).toBe(false)
    })
  })

  describe('getAppToken', () => {
    it('returns null', async () => {
      const result = await svc.getAppToken()
      expect(result).toBeNull()
    })
  })
})
