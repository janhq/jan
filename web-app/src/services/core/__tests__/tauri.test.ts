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
    it('invokes get_active_extensions', async () => {
      const exts = [{ name: 'ext1' }]
      mockInvoke.mockResolvedValue(exts)
      expect(await svc.getActiveExtensions()).toEqual(exts)
    })

    it('returns empty array on error', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))
      expect(await svc.getActiveExtensions()).toEqual([])
    })
  })

  describe('installExtensions', () => {
    it('invokes install_extensions', async () => {
      mockInvoke.mockResolvedValue(undefined)
      await svc.installExtensions()
      expect(mockInvoke).toHaveBeenCalledWith('install_extensions', undefined)
    })

    it('throws on error', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))
      await expect(svc.installExtensions()).rejects.toThrow('fail')
    })
  })

  describe('installExtension', () => {
    it('returns installed extensions', async () => {
      const exts = [{ name: 'e1' }] as any
      mockInvoke.mockResolvedValue(exts)
      expect(await svc.installExtension(exts)).toEqual(exts)
    })

    it('returns empty array on error', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))
      expect(await svc.installExtension([])).toEqual([])
    })
  })

  describe('uninstallExtension', () => {
    it('returns true on success', async () => {
      mockInvoke.mockResolvedValue(true)
      expect(await svc.uninstallExtension(['ext1'], true)).toBe(true)
    })

    it('returns false on error', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))
      expect(await svc.uninstallExtension(['ext1'])).toBe(false)
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
