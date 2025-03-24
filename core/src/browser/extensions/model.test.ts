import { ModelExtension } from './model'
import { ExtensionTypeEnum } from '../extension'
import { Model, OptionType, ModelSource } from '../../types'

// Mock implementation of ModelExtension
class MockModelExtension extends ModelExtension {
  private models: Model[] = []
  private sources: ModelSource[] = []
  private loadedModels: Set<string> = new Set()
  private modelsPulling: Set<string> = new Set()

  constructor() {
    super('http://mock-url.com', 'mock-model-extension', 'Mock Model Extension', true, 'A mock model extension', '1.0.0')
  }

  onLoad(): void {
    // Mock implementation
  }

  onUnload(): void {
    // Mock implementation
  }

  async configurePullOptions(configs: { [key: string]: any }): Promise<any> {
    return configs
  }

  async getModels(): Promise<Model[]> {
    return this.models
  }

  async pullModel(model: string, id?: string, name?: string): Promise<void> {
    const modelId = id || `model-${Date.now()}`
    this.modelsPulling.add(modelId)
    
    // Simulate model pull by adding it to the model list
    const newModel: Model = {
      id: modelId,
      path: `/models/${model}`,
      name: name || model,
      source: 'mock-source',
      modelFormat: 'mock-format',
      engine: 'mock-engine',
      format: 'mock-format',
      status: 'ready',
      contextLength: 2048,
      sizeInGB: 2,
      created: new Date().toISOString(),
      pullProgress: {
        percent: 100,
        transferred: 0,
        total: 0
      }
    }
    
    this.models.push(newModel)
    this.loadedModels.add(modelId)
    this.modelsPulling.delete(modelId)
  }

  async cancelModelPull(modelId: string): Promise<void> {
    this.modelsPulling.delete(modelId)
    // Remove the model if it's in the pulling state
    this.models = this.models.filter(m => m.id !== modelId)
  }

  async importModel(
    model: string,
    modelPath: string,
    name?: string,
    optionType?: OptionType
  ): Promise<void> {
    const newModel: Model = {
      id: `model-${Date.now()}`,
      path: modelPath,
      name: name || model,
      source: 'local',
      modelFormat: optionType?.format || 'mock-format',
      engine: optionType?.engine || 'mock-engine',
      format: optionType?.format || 'mock-format',
      status: 'ready',
      contextLength: optionType?.contextLength || 2048,
      sizeInGB: 2,
      created: new Date().toISOString(),
    }
    
    this.models.push(newModel)
    this.loadedModels.add(newModel.id)
  }

  async updateModel(modelInfo: Partial<Model>): Promise<Model> {
    if (!modelInfo.id) throw new Error('Model ID is required')
    
    const index = this.models.findIndex(m => m.id === modelInfo.id)
    if (index === -1) throw new Error('Model not found')
    
    this.models[index] = { ...this.models[index], ...modelInfo }
    return this.models[index]
  }

  async deleteModel(modelId: string): Promise<void> {
    this.models = this.models.filter(m => m.id !== modelId)
    this.loadedModels.delete(modelId)
  }

  async isModelLoaded(modelId: string): Promise<boolean> {
    return this.loadedModels.has(modelId)
  }

  async getSources(): Promise<ModelSource[]> {
    return this.sources
  }

  async addSource(source: string): Promise<void> {
    const newSource: ModelSource = {
      id: `source-${Date.now()}`,
      url: source,
      name: `Source ${this.sources.length + 1}`,
      type: 'mock-type'
    }
    
    this.sources.push(newSource)
  }

  async deleteSource(sourceId: string): Promise<void> {
    this.sources = this.sources.filter(s => s.id !== sourceId)
  }
}

describe('ModelExtension', () => {
  let extension: MockModelExtension

  beforeEach(() => {
    extension = new MockModelExtension()
  })

  test('should return the correct extension type', () => {
    expect(extension.type()).toBe(ExtensionTypeEnum.Model)
  })

  test('should configure pull options', async () => {
    const configs = { apiKey: 'test-key', baseUrl: 'https://test-url.com' }
    const result = await extension.configurePullOptions(configs)
    expect(result).toEqual(configs)
  })

  test('should add and get models', async () => {
    await extension.pullModel('test-model', 'test-id', 'Test Model')
    
    const models = await extension.getModels()
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('test-id')
    expect(models[0].name).toBe('Test Model')
  })

  test('should pull model with default id and name', async () => {
    await extension.pullModel('test-model')
    
    const models = await extension.getModels()
    expect(models).toHaveLength(1)
    expect(models[0].name).toBe('test-model')
  })

  test('should cancel model pull', async () => {
    await extension.pullModel('test-model', 'test-id')
    
    // Verify model exists
    let models = await extension.getModels()
    expect(models).toHaveLength(1)
    
    // Cancel the pull
    await extension.cancelModelPull('test-id')
    
    // Verify model was removed
    models = await extension.getModels()
    expect(models).toHaveLength(0)
  })

  test('should import model', async () => {
    const optionType: OptionType = {
      engine: 'test-engine',
      format: 'test-format',
      contextLength: 4096
    }
    
    await extension.importModel('test-model', '/path/to/model', 'Imported Model', optionType)
    
    const models = await extension.getModels()
    expect(models).toHaveLength(1)
    expect(models[0].name).toBe('Imported Model')
    expect(models[0].engine).toBe('test-engine')
    expect(models[0].format).toBe('test-format')
    expect(models[0].contextLength).toBe(4096)
  })

  test('should import model with default values', async () => {
    await extension.importModel('test-model', '/path/to/model')
    
    const models = await extension.getModels()
    expect(models).toHaveLength(1)
    expect(models[0].name).toBe('test-model')
    expect(models[0].engine).toBe('mock-engine')
    expect(models[0].format).toBe('mock-format')
  })

  test('should update model', async () => {
    await extension.pullModel('test-model', 'test-id', 'Test Model')
    
    const updatedModel = await extension.updateModel({
      id: 'test-id',
      name: 'Updated Model',
      contextLength: 8192
    })
    
    expect(updatedModel.name).toBe('Updated Model')
    expect(updatedModel.contextLength).toBe(8192)
    
    // Verify changes persisted
    const models = await extension.getModels()
    expect(models[0].name).toBe('Updated Model')
    expect(models[0].contextLength).toBe(8192)
  })

  test('should throw error when updating non-existent model', async () => {
    await expect(extension.updateModel({
      id: 'non-existent',
      name: 'Updated Model'
    })).rejects.toThrow('Model not found')
  })

  test('should throw error when updating model without ID', async () => {
    await expect(extension.updateModel({
      name: 'Updated Model'
    })).rejects.toThrow('Model ID is required')
  })

  test('should delete model', async () => {
    await extension.pullModel('test-model', 'test-id')
    
    // Verify model exists
    let models = await extension.getModels()
    expect(models).toHaveLength(1)
    
    // Delete the model
    await extension.deleteModel('test-id')
    
    // Verify model was removed
    models = await extension.getModels()
    expect(models).toHaveLength(0)
  })

  test('should check if model is loaded', async () => {
    await extension.pullModel('test-model', 'test-id')
    
    // Check if model is loaded
    const isLoaded = await extension.isModelLoaded('test-id')
    expect(isLoaded).toBe(true)
    
    // Check if non-existent model is loaded
    const nonExistentLoaded = await extension.isModelLoaded('non-existent')
    expect(nonExistentLoaded).toBe(false)
  })

  test('should add and get sources', async () => {
    await extension.addSource('https://test-source.com')
    
    const sources = await extension.getSources()
    expect(sources).toHaveLength(1)
    expect(sources[0].url).toBe('https://test-source.com')
  })

  test('should delete source', async () => {
    await extension.addSource('https://test-source.com')
    
    // Get the source ID
    const sources = await extension.getSources()
    const sourceId = sources[0].id
    
    // Delete the source
    await extension.deleteSource(sourceId)
    
    // Verify source was removed
    const updatedSources = await extension.getSources()
    expect(updatedSources).toHaveLength(0)
  })
})