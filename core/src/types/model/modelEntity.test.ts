import { test, expect } from 'vitest'
import { Model, ModelSettingParams, ModelRuntimeParams } from '../model'
import { InferenceEngine } from '../engine'

test.skip('testValidModelCreation', () => {
  const model: Model = {
    object: 'model',
    version: '1.0',
    format: 'format1',
    sources: [{ filename: 'model.bin', url: 'http://example.com/model.bin' }],
    id: 'model1',
    name: 'Test Model',
    created: Date.now(),
    description: 'A cool model from Huggingface',
    settings: { ctx_len: 100, ngl: 50, embedding: true },
    parameters: { temperature: 0.5, token_limit: 100, top_k: 10 },
    metadata: { author: 'Author', tags: ['tag1', 'tag2'], size: 100 },
    engine: InferenceEngine.anthropic,
  }

  expect(model).toBeDefined()
  expect(model.object).toBe('model')
  expect(model.version).toBe('1.0')
  expect(model.sources).toHaveLength(1)
  expect(model.sources[0].filename).toBe('model.bin')
  expect(model.settings).toBeDefined()
  expect(model.parameters).toBeDefined()
  expect(model.metadata).toBeDefined()
  expect(model.engine).toBe(InferenceEngine.anthropic)
})
