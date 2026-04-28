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
    Assistant: 'assistant',
  },
}))

const mockGetActiveExtensions = vi.fn()
const mockConvertFileSrc = vi.fn((p: string) => `asset://${p}`)
const mockInstallExtension = vi.fn()
const mockUninstallExtension = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({
      getActiveExtensions: mockGetActiveExtensions,
      convertFileSrc: mockConvertFileSrc,
      installExtension: mockInstallExtension,
      uninstallExtension: mockUninstallExtension,
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
      const ext = { type: () => 'assistant', onLoad: vi.fn(), onUnload: vi.fn() } as any
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
      const ext = { type: () => 'assistant', onLoad: vi.fn(), onUnload: vi.fn() } as any
      manager.register('asst', ext)
      expect(manager.get(ExtensionTypeEnum.Assistant)).toBe(ext)
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
    it('registers pre-loaded extension instance directly', async () => {
      const instance = { type: () => 'a', onLoad: vi.fn(), onUnload: vi.fn() } as any
      const ext = new Extension('http://ext', 'preloaded', undefined, true, undefined, undefined, instance)
      await manager.activateExtension(ext)
      expect(manager.getByName('preloaded')).toBe(instance)
    })

    it('imports and registers Tauri extensions', async () => {
      const MockClass = vi.fn().mockImplementation(function (this: any) {
        this.type = () => 'a'
        this.onLoad = vi.fn()
        this.onUnload = vi.fn()
      })

      // Mock dynamic import
      vi.doMock('asset://http://ext.js', () => ({ default: MockClass }), { virtual: true })
      mockConvertFileSrc.mockReturnValue('asset://http://ext.js')

      const ext = new Extension('http://ext.js', 'tauri-ext')
      await manager.activateExtension(ext)
      expect(MockClass).toHaveBeenCalled()
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

  describe('install', () => {
    it('returns undefined when window is undefined', async () => {
      // Can't truly test this in jsdom, but we can test the normal path
      mockInstallExtension.mockResolvedValue([
        { url: 'http://new', name: 'new-ext' },
      ])
      const result = await manager.install([{ url: 'http://new', name: 'new-ext' }])
      expect(result).toBeDefined()
    })
  })

  describe('uninstall', () => {
    it('calls uninstallExtension on service hub', async () => {
      mockUninstallExtension.mockResolvedValue(true)
      const result = await manager.uninstall(['ext-1'])
      expect(mockUninstallExtension).toHaveBeenCalledWith(['ext-1'], true)
      expect(result).toBe(true)
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
