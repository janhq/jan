import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LocalAIEngine } from './LocalAIEngine'

class TestLocalAIEngine extends LocalAIEngine {
  provider = 'test-provider'

  async onUnload(): Promise<void> {}

  async get() {
    return undefined
  }
  async list() {
    return []
  }
  async load() {
    return {} as any
  }
  async unload() {
    return {} as any
  }
  async chat() {
    return {} as any
  }
  async delete() {}
  async update() {}
  async import() {}
  async abortImport() {}
  async getLoadedModels() {
    return []
  }
  async isToolSupported() {
    return false
  }
}

describe('LocalAIEngine', () => {
  let engine: TestLocalAIEngine

  beforeEach(() => {
    engine = new TestLocalAIEngine('', '')
    vi.clearAllMocks()
  })

  describe('onLoad', () => {
    it('should call super.onLoad', async () => {
      const superOnLoadSpy = vi.spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(engine)),
        'onLoad'
      )

      await engine.onLoad()

      expect(superOnLoadSpy).toHaveBeenCalled()
    })
  })

  describe('abstract requirements', () => {
    it('should implement provider', () => {
      expect(engine.provider).toBe('test-provider')
    })

    it('should implement abstract methods', async () => {
      expect(await engine.get('id')).toBeUndefined()
      expect(await engine.list()).toEqual([])
      expect(await engine.getLoadedModels()).toEqual([])
      expect(await engine.isToolSupported('id')).toBe(false)
    })
  })
})
