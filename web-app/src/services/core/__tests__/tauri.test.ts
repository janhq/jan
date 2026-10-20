import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCoreService } from '../tauri'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
}))

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
const mockInvoke = invoke as ReturnType<typeof vi.fn>
const mockConvertFileSrc = convertFileSrc as ReturnType<typeof vi.fn>

describe('TauriCoreService', () => {
  let svc: TauriCoreService

  beforeEach(() => {
    svc = new TauriCoreService()
    vi.clearAllMocks()
  })

  describe('invoke', () => {
    it('delegates to Tauri invoke and returns result', async () => {
      mockInvoke.mockResolvedValue({ data: 'ok' })
      const result = await svc.invoke('my_command', { key: 'val' })
      expect(mockInvoke).toHaveBeenCalledWith('my_command', { key: 'val' })
      expect(result).toEqual({ data: 'ok' })
    })

    it('throws on Tauri invoke error', async () => {
      mockInvoke.mockRejectedValue(new Error('ipc fail'))
      await expect(svc.invoke('bad_cmd')).rejects.toThrow('ipc fail')
    })
  })

  describe('convertFileSrc', () => {
    it('delegates to Tauri convertFileSrc', () => {
      mockConvertFileSrc.mockReturnValue('asset://localhost/file.png')
      expect(svc.convertFileSrc('/file.png', 'asset')).toBe('asset://localhost/file.png')
      expect(mockConvertFileSrc).toHaveBeenCalledWith('/file.png', 'asset')
    })

    it('returns original path on error', () => {
      mockConvertFileSrc.mockImplementation(() => { throw new Error('fail') })
      expect(svc.convertFileSrc('/file.png')).toBe('/file.png')
    })
  })

  describe('getActiveExtensions', () => {
    it('returns bundled extensions without invoking the backend', async () => {
      const exts = await svc.getActiveExtensions()
      expect(mockInvoke).not.toHaveBeenCalled()
      expect(exts.length).toBeGreaterThan(0)
      expect(exts.every((e) => e.url === 'built-in')).toBe(true)
      expect(exts.every((e) => e.extensionInstance)).toBe(true)
      expect(exts.map((e) => e.name)).toContain('@janhq/llamacpp-extension')
    })
  })

  describe('installExtensions', () => {
    it('is a no-op that does not invoke the backend', async () => {
      await expect(svc.installExtensions()).resolves.toBeUndefined()
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('installExtension', () => {
    it('returns bundled extensions without invoking the backend', async () => {
      const exts = await svc.installExtension([])
      expect(mockInvoke).not.toHaveBeenCalled()
      expect(exts.map((e) => e.name)).toContain('@janhq/llamacpp-extension')
    })
  })

  describe('uninstallExtension', () => {
    it('returns false (bundled extensions cannot be uninstalled)', async () => {
      expect(await svc.uninstallExtension(['ext1'])).toBe(false)
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('getAppToken', () => {
    it('returns token string', async () => {
      mockInvoke.mockResolvedValue('token123')
      expect(await svc.getAppToken()).toBe('token123')
    })

    it('returns null on error', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))
      expect(await svc.getAppToken()).toBeNull()
    })
  })
})
