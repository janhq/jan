import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModelManager } from './manager'
import { Model, ModelEvent } from '../../types'
import { events } from '../events'

vi.mock('../events', () => ({
  events: {
    emit: vi.fn(),
  },
}))

Object.defineProperty(global, 'window', {
  value: {
    core: {},
  },
  writable: true,
})

describe('ModelManager', () => {
  let modelManager: ModelManager
  let mockModel: Model

  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.window as any).core = {}
    modelManager = new ModelManager()
    mockModel = {
      id: 'test-model-1',
      name: 'Test Model',
      version: '1.0.0',
    } as Model
  })

  describe('constructor', () => {
    it('should set itself on window.core.modelManager when window exists', () => {
      expect((global.window as any).core.modelManager).toBe(modelManager)
    })
  })

  describe('register', () => {
    it('should register a new model', () => {
      modelManager.register(mockModel)

      expect(modelManager.models.has('test-model-1')).toBe(true)
      expect(modelManager.models.get('test-model-1')).toEqual(mockModel)
      expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelsUpdate, {})
    })

    it('should merge existing model with new model data', () => {
      const existingModel: Model = {
        id: 'test-model-1',
        name: 'Existing Model',
        description: 'Existing description',
      } as Model

      const updatedModel: Model = {
        id: 'test-model-1',
        name: 'Updated Model',
        version: '2.0.0',
      } as Model

      modelManager.register(existingModel)
      modelManager.register(updatedModel)

      const registeredModel = modelManager.models.get('test-model-1')
      expect(registeredModel).toEqual({
        id: 'test-model-1',
        name: 'Existing Model',
        description: 'Existing description',
        version: '2.0.0',
      })
      expect(events.emit).toHaveBeenCalledTimes(2)
    })
  })

  describe('get', () => {
    it('should retrieve a registered model by id', () => {
      modelManager.register(mockModel)

      const retrievedModel = modelManager.get('test-model-1')
      expect(retrievedModel).toEqual(mockModel)
    })

    it('should return undefined for non-existent model', () => {
      const retrievedModel = modelManager.get('non-existent-model')
      expect(retrievedModel).toBeUndefined()
    })

    it('should return correctly typed model', () => {
      modelManager.register(mockModel)

      const retrievedModel = modelManager.get<Model>('test-model-1')
      expect(retrievedModel?.id).toBe('test-model-1')
      expect(retrievedModel?.name).toBe('Test Model')
    })
  })

  describe('instance', () => {
    it('should create a new instance when none exists on window.core', () => {
      ;(global.window as any).core = {}
      
      const instance = ModelManager.instance()
      expect(instance).toBeInstanceOf(ModelManager)
      expect((global.window as any).core.modelManager).toBe(instance)
    })

    it('should return existing instance when it exists on window.core', () => {
      const existingManager = new ModelManager()
      ;(global.window as any).core.modelManager = existingManager

      const instance = ModelManager.instance()
      expect(instance).toBe(existingManager)
    })
  })

  describe('models property', () => {
    it('should initialize with empty Map', () => {
      expect(modelManager.models).toBeInstanceOf(Map)
      expect(modelManager.models.size).toBe(0)
    })

    it('should maintain multiple models', () => {
      const model1: Model = { id: 'model-1', name: 'Model 1' } as Model
      const model2: Model = { id: 'model-2', name: 'Model 2' } as Model

      modelManager.register(model1)
      modelManager.register(model2)

      expect(modelManager.models.size).toBe(2)
      expect(modelManager.models.get('model-1')).toEqual(model1)
      expect(modelManager.models.get('model-2')).toEqual(model2)
    })
  })
})
