import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Extension, ExtensionManager } from '../extension'
import { ExtensionTypeEnum } from '@janhq/core'

// Mock dependencies
vi.mock('@janhq/core', () => ({
  AIEngine: class MockAIEngine {},
  BaseExtension: class MockBaseExtension {
    type() { return 'base' }
    onLoad() { return Promise.resolve() }
    onUnload() {}
  },
  ExtensionTypeEnum: {
    SystemMonitor: 'system-monitor',
    Model: 'model',
    RAG: 'rag',
  },
}))

const mockGetActiveExtensions = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({
      getActiveExtensions: mockGetActiveExtensions,
    }),
  }),
}))

// Mock window.core
Object.defineProperty(window, 'core', {
  writable: true,
  value: { extensionManager: null },
})

describe('ExtensionManager - coverage', () => {
  let manager: ExtensionManager

  beforeEach(() => {
    vi.clearAllMocks()
    window.core.extensionManager = null
    manager = ExtensionManager.getInstance()
  })

  describe('register and retrieval', () => {
    it('registers and retrieves extension by name', () => {
      const ext = { type: () => 'rag', onLoad: vi.fn(), onUnload: vi.fn() } as any
      manager.register('my-ext', ext)
      expect(manager.getByName('my-ext')).toBe(ext)
    })

    it('registers AI engine when extension has provider', () => {
      const ext = {
        type: () => 'model',
        provider: 'openai',
        onLoad: vi.fn(),
        onUnload: vi.fn(),
      } as any
      manager.register('engine-ext', ext)
      expect(manager.getEngine('openai')).toBe(ext)
    })

    it('get by type returns matching extension', () => {
      const ext = { type: () => 'rag', onLoad: vi.fn(), onUnload: vi.fn() } as any
      manager.register('rag-ext', ext)
      expect(manager.get(ExtensionTypeEnum.RAG)).toBe(ext)
    })

    it('get by type returns undefined when no match', () => {
      expect(manager.get(ExtensionTypeEnum.SystemMonitor)).toBeUndefined()
    })

    it('getEngine returns undefined for unknown engine', () => {
      expect(manager.getEngine('nonexistent')).toBeUndefined()
    })

    it('getAll returns all registered extensions', () => {
      const ext1 = { type: () => 'a', onLoad: vi.fn(), onUnload: vi.fn() } as any
      const ext2 = { type: () => 'b', onLoad: vi.fn(), onUnload: vi.fn() } as any
      manager.register('ext1', ext1)
      manager.register('ext2', ext2)
      expect(manager.getAll()).toHaveLength(2)
    })

    it('listExtensions returns same as getAll', () => {
      const ext = { type: () => 'a', onLoad: vi.fn(), onUnload: vi.fn() } as any
      manager.register('ext', ext)
      expect(manager.listExtensions()).toEqual(manager.getAll())
    })
  })

  describe('load and unload', () => {
    it('load calls onLoad for all extensions', async () => {
      const onLoad = vi.fn().mockResolvedValue(undefined)
      const ext = { type: () => 'a', onLoad, onUnload: vi.fn() } as any
      manager.register('ext', ext)
      await manager.load()
      expect(onLoad).toHaveBeenCalled()
    })

    it('unload calls onUnload for all extensions', () => {
      const onUnload = vi.fn()
      const ext = { type: () => 'a', onLoad: vi.fn(), onUnload } as any
      manager.register('ext', ext)
      manager.unload()
      expect(onUnload).toHaveBeenCalled()
    })
  })

  describe('getActive', () => {
    it('returns extensions from service hub', async () => {
      mockGetActiveExtensions.mockResolvedValue([
        { url: 'http://ext', name: 'test', active: true },
      ])
      const result = await manager.getActive()
      expect(result).toHaveLength(1)
      expect(result[0]).toBeInstanceOf(Extension)
      expect(result[0].name).toBe('test')
    })

    it('returns empty array when no manifests', async () => {
      mockGetActiveExtensions.mockResolvedValue(null)
      const result = await manager.getActive()
      expect(result).toEqual([])
    })
  })

  describe('activateExtension', () => {
    it('registers pre-loaded extension instance directly', () => {
      const instance = { type: () => 'a', onLoad: vi.fn(), onUnload: vi.fn() } as any
      const ext = new Extension('http://ext', 'preloaded', undefined, true, undefined, undefined, instance)
      manager.activateExtension(ext)
      expect(manager.getByName('preloaded')).toBe(instance)
    })

    it('skips an extension without an instance', () => {
      const ext = new Extension('built-in', 'no-instance')
      manager.activateExtension(ext)
      expect(manager.getByName('no-instance')).toBeUndefined()
    })
  })

  describe('registerActive', () => {
    it('activates all active extensions', async () => {
      const instance = { type: () => 'a', onLoad: vi.fn(), onUnload: vi.fn() } as any
      mockGetActiveExtensions.mockResolvedValue([
        { url: 'http://ext', name: 'test', active: true, extensionInstance: instance },
      ])
      await manager.registerActive()
      expect(manager.getByName('test')).toBe(instance)
    })
  })

  describe('getInstance', () => {
    it('returns singleton', () => {
      const a = ExtensionManager.getInstance()
      const b = ExtensionManager.getInstance()
      expect(a).toBe(b)
    })
  })
})
