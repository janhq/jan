import { describe, it, test, expect, beforeEach } from 'vitest'
import { EngineManager } from './EngineManager'
import { AIEngine } from './AIEngine'
import { InferenceEngine } from '../../../types'

// @ts-ignore
class MockAIEngine implements AIEngine {
  provider: string
  constructor(provider: string) {
    this.provider = provider
  }
}

describe('EngineManager', () => {
  let engineManager: EngineManager

  beforeEach(() => {
    engineManager = new EngineManager()
  })

  test('should register an engine', () => {
    const engine = new MockAIEngine('testProvider')
    // @ts-ignore
    engineManager.register(engine)
    expect(engineManager.engines.get('testProvider')).toBe(engine)
  })

  test('should retrieve a registered engine by provider', () => {
    const engine = new MockAIEngine('testProvider')
    // @ts-ignore
    engineManager.register(engine)
    // @ts-ignore
    const retrievedEngine = engineManager.get<MockAIEngine>('testProvider')
    expect(retrievedEngine).toBe(engine)
  })

  test('should return undefined for an unregistered provider', () => {
    // @ts-ignore
    const retrievedEngine = engineManager.get<MockAIEngine>('nonExistentProvider')
    expect(retrievedEngine).toBeUndefined()
  })

  describe('cortex engine migration', () => {
    test.skip('should map nitro to cortex engine', () => {
      const cortexEngine = new MockAIEngine(InferenceEngine.cortex)
      // @ts-ignore
      engineManager.register(cortexEngine)

      // @ts-ignore
      const retrievedEngine = engineManager.get<MockAIEngine>(InferenceEngine.nitro)
      expect(retrievedEngine).toBe(cortexEngine)
    })

    test.skip('should map cortex_llamacpp to cortex engine', () => {
      const cortexEngine = new MockAIEngine(InferenceEngine.cortex)
      // @ts-ignore
      engineManager.register(cortexEngine)

      // @ts-ignore
      const retrievedEngine = engineManager.get<MockAIEngine>(InferenceEngine.cortex_llamacpp)
      expect(retrievedEngine).toBe(cortexEngine)
    })

    test.skip('should map cortex_onnx to cortex engine', () => {
      const cortexEngine = new MockAIEngine(InferenceEngine.cortex)
      // @ts-ignore
      engineManager.register(cortexEngine)

      // @ts-ignore
      const retrievedEngine = engineManager.get<MockAIEngine>(InferenceEngine.cortex_onnx)
      expect(retrievedEngine).toBe(cortexEngine)
    })

    test.skip('should map cortex_tensorrtllm to cortex engine', () => {
      const cortexEngine = new MockAIEngine(InferenceEngine.cortex)
      // @ts-ignore
      engineManager.register(cortexEngine)

      // @ts-ignore
      const retrievedEngine = engineManager.get<MockAIEngine>(InferenceEngine.cortex_tensorrtllm)
      expect(retrievedEngine).toBe(cortexEngine)
    })
  })

  describe('singleton instance', () => {
    test('should return the window.core.engineManager if available', () => {
      const mockEngineManager = new EngineManager()
      // @ts-ignore
      window.core = { engineManager: mockEngineManager }

      const instance = EngineManager.instance()
      expect(instance).toBe(mockEngineManager)

      // Clean up
      // @ts-ignore
      delete window.core
    })

    test('should create a new instance if window.core.engineManager is not available', () => {
      // @ts-ignore
      delete window.core

      const instance = EngineManager.instance()
      expect(instance).toBeInstanceOf(EngineManager)
    })
  })
})
