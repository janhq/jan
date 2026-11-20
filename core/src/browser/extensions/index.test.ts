import { describe, test, expect } from 'vitest'
import * as Engines from './index'

describe('index.ts exports', () => {
  test('should export Engines', () => {
    expect(Engines.EngineManager).toBeDefined()
  })
})
