import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { TauriDialogService } from '../tauri'

const mockInvoke = invoke as ReturnType<typeof vi.fn>

describe('TauriDialogService', () => {
  let svc: TauriDialogService

  beforeEach(() => {
    svc = new TauriDialogService()
    vi.clearAllMocks()
  })

  describe('open', () => {
    it('invokes open_dialog and returns result', async () => {
      mockInvoke.mockResolvedValue('/path/file.txt')
      const opts = { multiple: false, filters: [{ name: 'Text', extensions: ['txt'] }] }
      expect(await svc.open(opts)).toBe('/path/file.txt')
      expect(mockInvoke).toHaveBeenCalledWith('open_dialog', { options: opts })
    })

    it('returns null on error', async () => {
      mockInvoke.mockRejectedValue(new Error('cancelled'))
      expect(await svc.open()).toBeNull()
    })

    it('handles multiple file selection', async () => {
      mockInvoke.mockResolvedValue(['/a.txt', '/b.txt'])
      expect(await svc.open({ multiple: true })).toEqual(['/a.txt', '/b.txt'])
    })
  })

  describe('save', () => {
    it('invokes save_dialog and returns path', async () => {
      mockInvoke.mockResolvedValue('/save/path.txt')
      expect(await svc.save({ defaultPath: '/save' })).toBe('/save/path.txt')
      expect(mockInvoke).toHaveBeenCalledWith('save_dialog', { options: { defaultPath: '/save' } })
    })

    it('returns null on error', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))
      expect(await svc.save()).toBeNull()
    })
  })
})
