/**
 * @jest-environment jsdom
 */
import { EngineManager } from './EngineManager'
import { AIEngine } from './AIEngine'

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
})
