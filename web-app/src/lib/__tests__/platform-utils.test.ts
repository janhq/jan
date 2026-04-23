import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We need to test the module fresh for each scenario, so we use dynamic imports
// and resetModules

describe('platform/utils', () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    // Restore window properties
    delete (window as any).__TAURI__
    delete (window as any).__TAURI_INTERNALS__
  })

  describe('isPlatformTauri', () => {
    it('returns true when IS_WEB_APP is undefined', async () => {
      vi.stubGlobal('IS_WEB_APP', undefined)
      // Also set Tauri bridge so the bridge check passes
      ;(window as any).__TAURI__ = {}
      const mod = await import('../platform/utils')
      // IS_WEB_APP is undefined → returns true
      expect(mod.isPlatformTauri()).toBe(true)
      vi.unstubAllGlobals()
    })

    it('returns false when IS_WEB_APP is true', async () => {
      vi.stubGlobal('IS_WEB_APP', true)
      const mod = await import('../platform/utils')
      expect(mod.isPlatformTauri()).toBe(false)
      vi.unstubAllGlobals()
    })

    it('returns false when IS_WEB_APP is string "true"', async () => {
      vi.stubGlobal('IS_WEB_APP', 'true')
      const mod = await import('../platform/utils')
      expect(mod.isPlatformTauri()).toBe(false)
      vi.unstubAllGlobals()
    })

    it('returns false when IS_WEB_APP is false but no Tauri bridge', async () => {
      vi.stubGlobal('IS_WEB_APP', false)
      delete (window as any).__TAURI__
      delete (window as any).__TAURI_INTERNALS__
      const mod = await import('../platform/utils')
      expect(mod.isPlatformTauri()).toBe(false)
      vi.unstubAllGlobals()
    })

    it('returns true when IS_WEB_APP is false and __TAURI__ is present', async () => {
      vi.stubGlobal('IS_WEB_APP', false)
      ;(window as any).__TAURI__ = {}
      const mod = await import('../platform/utils')
      expect(mod.isPlatformTauri()).toBe(true)
      vi.unstubAllGlobals()
    })

    it('returns true when IS_WEB_APP is false and __TAURI_INTERNALS__ is present', async () => {
      vi.stubGlobal('IS_WEB_APP', false)
      ;(window as any).__TAURI_INTERNALS__ = {}
      const mod = await import('../platform/utils')
      expect(mod.isPlatformTauri()).toBe(true)
      vi.unstubAllGlobals()
    })
  })

  describe('isPlatformIOS', () => {
    it('returns IS_IOS value', async () => {
      vi.stubGlobal('IS_IOS', true)
      vi.stubGlobal('IS_ANDROID', false)
      vi.stubGlobal('IS_WEB_APP', true)
      const mod = await import('../platform/utils')
      expect(mod.isPlatformIOS()).toBe(true)
      expect(mod.isIOS()).toBe(true)
      vi.unstubAllGlobals()
    })
  })

  describe('isPlatformAndroid', () => {
    it('returns IS_ANDROID value', async () => {
      vi.stubGlobal('IS_IOS', false)
      vi.stubGlobal('IS_ANDROID', true)
      vi.stubGlobal('IS_WEB_APP', true)
      const mod = await import('../platform/utils')
      expect(mod.isPlatformAndroid()).toBe(true)
      expect(mod.isAndroid()).toBe(true)
      vi.unstubAllGlobals()
    })
  })

  describe('getCurrentPlatform', () => {
    it('returns ios when IS_IOS', async () => {
      vi.stubGlobal('IS_IOS', true)
      vi.stubGlobal('IS_ANDROID', false)
      vi.stubGlobal('IS_WEB_APP', true)
      const mod = await import('../platform/utils')
      expect(mod.getCurrentPlatform()).toBe('ios')
      vi.unstubAllGlobals()
    })

    it('returns android when IS_ANDROID', async () => {
      vi.stubGlobal('IS_IOS', false)
      vi.stubGlobal('IS_ANDROID', true)
      vi.stubGlobal('IS_WEB_APP', true)
      const mod = await import('../platform/utils')
      expect(mod.getCurrentPlatform()).toBe('android')
      vi.unstubAllGlobals()
    })

    it('returns web when IS_WEB_APP and no Tauri bridge', async () => {
      vi.stubGlobal('IS_IOS', false)
      vi.stubGlobal('IS_ANDROID', false)
      vi.stubGlobal('IS_WEB_APP', true)
      const mod = await import('../platform/utils')
      expect(mod.getCurrentPlatform()).toBe('web')
      vi.unstubAllGlobals()
    })

    it('returns tauri when not web/ios/android and Tauri bridge present', async () => {
      vi.stubGlobal('IS_IOS', false)
      vi.stubGlobal('IS_ANDROID', false)
      vi.stubGlobal('IS_WEB_APP', false)
      ;(window as any).__TAURI__ = {}
      const mod = await import('../platform/utils')
      expect(mod.getCurrentPlatform()).toBe('tauri')
      vi.unstubAllGlobals()
    })
  })

  describe('getUnavailableFeatureMessage', () => {
    it('formats feature name and platform', async () => {
      vi.stubGlobal('IS_IOS', false)
      vi.stubGlobal('IS_ANDROID', false)
      vi.stubGlobal('IS_WEB_APP', true)
      const { PlatformFeature } = await import('../platform/types')
      const mod = await import('../platform/utils')
      const msg = mod.getUnavailableFeatureMessage(PlatformFeature.LOCAL_INFERENCE)
      expect(msg).toContain('web')
      expect(msg).toContain('Local inference')
      vi.unstubAllGlobals()
    })
  })
})
