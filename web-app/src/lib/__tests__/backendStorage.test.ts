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

    it('skips the invoke when the same value is written again', async () => {
      invoke.mockResolvedValue(undefined)
      await backendStorage.setItem('dedup', 'v1')
      await backendStorage.setItem('dedup', 'v1')
      await backendStorage.setItem('dedup', 'v2')
      const sets = invoke.mock.calls.filter(([cmd]) => cmd === 'settings_set')
      expect(sets).toHaveLength(2)
      expect(sets.map(([, a]) => a.value)).toEqual(['v1', 'v2'])
    })

    it('retries after a failed write (cache not poisoned)', async () => {
      invoke.mockRejectedValueOnce(new Error('boom'))
      await backendStorage.setItem('retry', 'v')
      invoke.mockResolvedValueOnce(undefined)
      await backendStorage.setItem('retry', 'v')
      const sets = invoke.mock.calls.filter(([cmd]) => cmd === 'settings_set')
      expect(sets).toHaveLength(2)
    })

    it('removeItem clears the cache so an identical later write is not skipped', async () => {
      invoke.mockResolvedValue(undefined)
      await backendStorage.setItem('rm', 'v')
      await backendStorage.removeItem('rm')
      await backendStorage.setItem('rm', 'v')
      const sets = invoke.mock.calls.filter(([cmd]) => cmd === 'settings_set')
      expect(sets).toHaveLength(2)
    })
  })
})
