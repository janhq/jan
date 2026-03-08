import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { LocalOAIEngine } from './LocalOAIEngine'
import { events } from '../../events'
import { Model, ModelEvent } from '../../../types'

vi.mock('../../events')

class TestLocalOAIEngine extends LocalOAIEngine {
  inferenceUrl = 'http://test-local-inference-url'
  provider = 'test-local-provider'
  nodeModule = 'test-node-module'

  async headers() {
    return { Authorization: 'Bearer test-token' }
  }

  async loadModel(model: Model & { file_path?: string }): Promise<void> {
    this.loadedModel = model
  }

  async unloadModel(model?: Model) {
    this.loadedModel = undefined
  }
}

describe('LocalOAIEngine', () => {
  let engine: TestLocalOAIEngine
  const mockModel: Model & { file_path?: string } = {
    object: 'model',
    version: '1.0.0',
    format: 'gguf',
    sources: [],
    id: 'test-model',
    name: 'Test Model',
    description: 'A test model',
    settings: {},
    parameters: {},
    metadata: {},
    file_path: '/path/to/model.gguf'
  }

  beforeEach(() => {
    engine = new TestLocalOAIEngine('', '')
    vi.clearAllMocks()
  })

  describe('onLoad', () => {
    it('should call super.onLoad and subscribe to model events', () => {
      const superOnLoadSpy = vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(engine)), 'onLoad')
      
      engine.onLoad()

      expect(superOnLoadSpy).toHaveBeenCalled()
      expect(events.on).toHaveBeenCalledWith(
        ModelEvent.OnModelInit,
        expect.any(Function)
      )
      expect(events.on).toHaveBeenCalledWith(
        ModelEvent.OnModelStop,
        expect.any(Function)
      )
    })

    it('should load model when OnModelInit event is triggered', () => {
      const loadModelSpy = vi.spyOn(engine, 'loadModel')
      engine.onLoad()

      // Get the event handler for OnModelInit
      const onModelInitCall = (events.on as Mock).mock.calls.find(
        call => call[0] === ModelEvent.OnModelInit
      )
      const onModelInitHandler = onModelInitCall[1]

      // Trigger the event handler
      onModelInitHandler(mockModel)

      expect(loadModelSpy).toHaveBeenCalledWith(mockModel)
    })

    it('should unload model when OnModelStop event is triggered', () => {
      const unloadModelSpy = vi.spyOn(engine, 'unloadModel')
      engine.onLoad()

      // Get the event handler for OnModelStop
      const onModelStopCall = (events.on as Mock).mock.calls.find(
        call => call[0] === ModelEvent.OnModelStop
      )
      const onModelStopHandler = onModelStopCall[1]

      // Trigger the event handler
      onModelStopHandler(mockModel)

      expect(unloadModelSpy).toHaveBeenCalledWith(mockModel)
    })
  })

  describe('properties', () => {
    it('should have correct default function names', () => {
      expect(engine.loadModelFunctionName).toBe('loadModel')
      expect(engine.unloadModelFunctionName).toBe('unloadModel')
    })

    it('should have abstract nodeModule property implemented', () => {
      expect(engine.nodeModule).toBe('test-node-module')
    })
  })

  describe('loadModel', () => {
    it('should load the model and set loadedModel', async () => {
      await engine.loadModel(mockModel)
      expect(engine.loadedModel).toBe(mockModel)
    })

    it('should handle model with file_path', async () => {
      const modelWithPath = { ...mockModel, file_path: '/custom/path/model.gguf' }
      await engine.loadModel(modelWithPath)
      expect(engine.loadedModel).toBe(modelWithPath)
    })
  })

  describe('unloadModel', () => {
    it('should unload the model and clear loadedModel', async () => {
      engine.loadedModel = mockModel
      await engine.unloadModel(mockModel)
      expect(engine.loadedModel).toBeUndefined()
    })

    it('should handle unload without passing a model', async () => {
      engine.loadedModel = mockModel
      await engine.unloadModel()
      expect(engine.loadedModel).toBeUndefined()
    })
  })
})
