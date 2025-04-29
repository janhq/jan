type ProviderObject = {
  name: string
  productName: string
  active: boolean
  description: string
  version: string
  apiKey: string
  inferenceUrl: string
  provider: string
  models: Model[]
}

/**
 * The `ModelSetting` type defines the shape of a model setting object
 * @data_transfer_object
 */
type ModelSetting = Record<string, unknown>

/**
 * The `Model` type defines the shape of a model object
 * @data_transfer_object
 */
type Model = {
  [modelName: string]: {
    setting: ModelSetting
    copabilities?: string[]
  }
}

/**
 * The `ModelProvider` type defines the shape of a model provider object
 * @data_transfer_object
 */
type ModelProvider = {
  [providerName: string]: ProviderObject
}
