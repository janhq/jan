import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// In-memory backing store used by the mock Tauri plugin
const mockStoreData = new Map<string, unknown>()
const mockSave = vi.fn().mockResolvedValue(undefined)
const mockStore = {
  get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
    return mockStoreData.get(key) as T | undefined
  }),
  set: vi.fn(async (key: string, value: unknown) => {
    mockStoreData.set(key, value)
  }),
  delete: vi.fn(async (key: string) => {
    return mockStoreData.delete(key)
  }),
  save: mockSave,
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('/mock/jan/data'),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue(mockStore),
}))

describe('fileStorage', () => {
  // Each describe block re-imports the module after setting/clearing
  // __TAURI_INTERNALS__ so IS_TAURI is evaluated fresh.
  let fileStorage: typeof import('../fileStorage').fileStorage

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreData.clear()
    localStorage.clear()
  })

  afterEach(() => {
    delete (window as Record<string, unknown>).__TAURI_INTERNALS__
  })

  describe('when NOT in Tauri (browser fallback)', () => {
    beforeEach(async () => {
      delete (window as Record<string, unknown>).__TAURI_INTERNALS__
      vi.resetModules()
      const mod = await import('../fileStorage')
      fileStorage = mod.fileStorage
    })

    it('getItem reads from localStorage', async () => {
      localStorage.setItem('test-key', 'test-value')
      expect(await fileStorage.getItem('test-key')).toBe('test-value')
    })

    it('setItem writes to localStorage', async () => {
      await fileStorage.setItem('test-key', 'test-value')
      expect(localStorage.getItem('test-key')).toBe('test-value')
    })

    it('removeItem removes from localStorage', async () => {
      localStorage.setItem('test-key', 'to-be-removed')
      await fileStorage.removeItem('test-key')
      expect(localStorage.getItem('test-key')).toBeNull()
    })

    it('returns null for missing keys', async () => {
      expect(await fileStorage.getItem('nonexistent')).toBeNull()
    })

    it('never touches the Tauri store', async () => {
      await fileStorage.setItem('k', 'v')
      await fileStorage.getItem('k')
      expect(mockStore.get).not.toHaveBeenCalled()
      expect(mockStore.set).not.toHaveBeenCalled()
    })
  })

  describe('when in Tauri (file-backed storage)', () => {
    beforeEach(async () => {
      ;(window as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      vi.resetModules()
      mockStoreData.clear()
      mockStore.get.mockClear()
      mockStore.set.mockClear()
      mockStore.delete.mockClear()
      mockSave.mockClear()
      const mod = await import('../fileStorage')
      fileStorage = mod.fileStorage
    })

    it('loads the store from the Jan data folder', async () => {
      // Trigger store init by calling any method
      await fileStorage.getItem('any-key')
      const { load } = await import('@tauri-apps/plugin-store')
      expect(load).toHaveBeenCalledWith(
        '/mock/jan/data/settings.json',
        { autoSave: false, defaults: {} }
      )
    })

    it('setItem writes to the file store', async () => {
      await fileStorage.setItem('my-setting', '{"theme":"dark"}')
      expect(mockStore.set).toHaveBeenCalledWith(
        'my-setting',
        '{"theme":"dark"}'
      )
    })

    it('setItem triggers a disk save', async () => {
      await fileStorage.setItem('k', 'v')
      // save is fire-and-forget, give it a tick to resolve
      await new Promise((r) => setTimeout(r, 0))
      expect(mockSave).toHaveBeenCalled()
    })

    it('getItem reads from the file store', async () => {
      mockStoreData.set('my-setting', '{"theme":"dark"}')
      expect(await fileStorage.getItem('my-setting')).toBe('{"theme":"dark"}')
    })

    it('getItem returns null for missing keys', async () => {
      expect(await fileStorage.getItem('nonexistent')).toBeNull()
    })

    it('removeItem deletes from the file store', async () => {
      mockStoreData.set('key', 'value')
      await fileStorage.removeItem('key')
      expect(mockStore.delete).toHaveBeenCalledWith('key')
    })

    it('does not touch localStorage when Tauri store is available', async () => {
      await fileStorage.setItem('key', 'value')
      expect(localStorage.getItem('key')).toBeNull()
    })

    describe('migration from localStorage', () => {
      it('copies localStorage data to file store on first read', async () => {
        localStorage.setItem('setting-general', '{"state":{"lang":"vi"}}')

        const result = await fileStorage.getItem('setting-general')

        expect(mockStore.set).toHaveBeenCalledWith(
          'setting-general',
          '{"state":{"lang":"vi"}}'
        )
        // Immediate save for migration data safety
        expect(mockSave).toHaveBeenCalled()
        // localStorage cleaned up after confirmed write
        expect(localStorage.getItem('setting-general')).toBeNull()
        expect(result).toBe('{"state":{"lang":"vi"}}')
      })

      it('does not overwrite existing file store data', async () => {
        localStorage.setItem('theme', '{"old":"data"}')
        mockStoreData.set('theme', '{"new":"data"}')

        const result = await fileStorage.getItem('theme')

        expect(result).toBe('{"new":"data"}')
        expect(mockStore.set).not.toHaveBeenCalledWith(
          'theme',
          '{"old":"data"}'
        )
        // localStorage still cleaned up
        expect(localStorage.getItem('theme')).toBeNull()
      })

      it('runs migration only once per key', async () => {
        localStorage.setItem('key', 'value')

        await fileStorage.getItem('key')
        localStorage.setItem('key', 'new-value')
        await fileStorage.getItem('key')

        // store.set called once (migration), not twice
        expect(mockStore.set).toHaveBeenCalledTimes(1)
      })

      it('preserves localStorage if the file write fails', async () => {
        localStorage.setItem('key', 'important-data')
        mockStore.set.mockRejectedValueOnce(new Error('disk full'))

        const result = await fileStorage.getItem('key')

        expect(localStorage.getItem('key')).toBe('important-data')
        // File store has no data, so null
        expect(result).toBeNull()
      })

      it('concurrent reads share the same migration', async () => {
        localStorage.setItem('shared', 'data')

        // Fire two reads without awaiting
        const [r1, r2] = await Promise.all([
          fileStorage.getItem('shared'),
          fileStorage.getItem('shared'),
        ])

        // Both should get the migrated value
        expect(r1).toBe('data')
        expect(r2).toBe('data')
        // Migration should only write once
        expect(mockStore.set).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('migrateAllLocalStorageKeys', () => {
    let migrateAllLocalStorageKeys: typeof import('../fileStorage').migrateAllLocalStorageKeys

    beforeEach(async () => {
      ;(window as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      vi.resetModules()
      mockStoreData.clear()
      mockStore.get.mockClear()
      mockStore.set.mockClear()
      mockStore.delete.mockClear()
      mockSave.mockClear()
      const mod = await import('../fileStorage')
      fileStorage = mod.fileStorage
      migrateAllLocalStorageKeys = mod.migrateAllLocalStorageKeys
    })

    it('migrates all localStorage keys to the file store', async () => {
      localStorage.setItem('key-a', 'value-a')
      localStorage.setItem('key-b', 'value-b')
      localStorage.setItem('key-c', 'value-c')

      await migrateAllLocalStorageKeys()

      expect(mockStore.set).toHaveBeenCalledWith('key-a', 'value-a')
      expect(mockStore.set).toHaveBeenCalledWith('key-b', 'value-b')
      expect(mockStore.set).toHaveBeenCalledWith('key-c', 'value-c')
      // Single flush to disk, not one per key
      expect(mockSave).toHaveBeenCalledTimes(1)
      // All localStorage entries cleaned up
      expect(localStorage.length).toBe(0)
    })

    it('does not overwrite keys already in the file store', async () => {
      localStorage.setItem('existing', 'old-value')
      mockStoreData.set('existing', 'new-value')

      await migrateAllLocalStorageKeys()

      // Should not overwrite
      expect(mockStore.set).not.toHaveBeenCalledWith('existing', 'old-value')
      expect(mockStoreData.get('existing')).toBe('new-value')
      // localStorage still cleaned up
      expect(localStorage.getItem('existing')).toBeNull()
    })

    it('is a no-op when localStorage is empty', async () => {
      await migrateAllLocalStorageKeys()
      expect(mockStore.set).not.toHaveBeenCalled()
    })

    it('is a no-op in non-Tauri environment', async () => {
      delete (window as Record<string, unknown>).__TAURI_INTERNALS__
      vi.resetModules()
      const mod = await import('../fileStorage')

      localStorage.setItem('key', 'value')
      await mod.migrateAllLocalStorageKeys()

      // localStorage untouched
      expect(localStorage.getItem('key')).toBe('value')
      expect(mockStore.set).not.toHaveBeenCalled()
    })
  })

  describe('graceful fallback when Tauri store fails to load', () => {
    beforeEach(async () => {
      ;(window as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      vi.resetModules()

      // Make plugin-store load throw
      const pluginStore = await import('@tauri-apps/plugin-store')
      vi.mocked(pluginStore.load).mockRejectedValueOnce(
        new Error('plugin unavailable')
      )

      const mod = await import('../fileStorage')
      fileStorage = mod.fileStorage
    })

    it('falls back to localStorage on store init failure', async () => {
      localStorage.setItem('fallback-key', 'fallback-value')
      expect(await fileStorage.getItem('fallback-key')).toBe('fallback-value')

      await fileStorage.setItem('new-key', 'new-value')
      expect(localStorage.getItem('new-key')).toBe('new-value')
    })
  })
})
