import { describe, it, expect, vi, beforeEach } from 'vitest'

const isPlatformTauri = vi.fn()
const invoke = vi.fn()

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => isPlatformTauri(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke }) }),
}))

import { backendStorage } from '../backendStorage'

describe('backendStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('web fallback (no Tauri)', () => {
    beforeEach(() => isPlatformTauri.mockReturnValue(false))

    it('reads/writes/removes via localStorage without touching the backend', async () => {
      expect(await backendStorage.getItem('k')).toBeNull()
      await backendStorage.setItem('k', 'v')
      expect(localStorage.getItem('k')).toBe('v')
      expect(await backendStorage.getItem('k')).toBe('v')
      await backendStorage.removeItem('k')
      expect(await backendStorage.getItem('k')).toBeNull()
      expect(invoke).not.toHaveBeenCalled()
    })
  })

  describe('tauri backend', () => {
    beforeEach(() => isPlatformTauri.mockReturnValue(true))

    it('routes through settings_* commands', async () => {
      invoke.mockResolvedValueOnce('stored')
      expect(await backendStorage.getItem('theme')).toBe('stored')
      expect(invoke).toHaveBeenCalledWith('settings_get', { key: 'theme' })

      await backendStorage.setItem('theme', '"dark"')
      expect(invoke).toHaveBeenCalledWith('settings_set', {
        key: 'theme',
        value: '"dark"',
      })

      await backendStorage.removeItem('theme')
      expect(invoke).toHaveBeenCalledWith('settings_remove', { key: 'theme' })
    })

    it('maps a missing key (null/undefined) to null', async () => {
      invoke.mockResolvedValueOnce(null)
      expect(await backendStorage.getItem('missing')).toBeNull()
      invoke.mockResolvedValueOnce(undefined)
      expect(await backendStorage.getItem('missing')).toBeNull()
    })

    it('degrades to null on backend error rather than throwing', async () => {
      invoke.mockRejectedValueOnce(new Error('boom'))
      await expect(backendStorage.getItem('k')).resolves.toBeNull()
    })

    it('swallows write errors so persistence never crashes the store', async () => {
      invoke.mockRejectedValueOnce(new Error('boom'))
      await expect(backendStorage.setItem('k', 'v')).resolves.toBeUndefined()
    })
  })
})
