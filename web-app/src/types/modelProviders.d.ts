/**
 * The `ModelSetting` type defines the shape of a model setting object
 * @data_transfer_object
 */
export type ModelSetting = Record<string, unknown>

/**
 * The `Model` type defines the shape of a model object
 * @data_transfer_object
 */
export type Model = {
  [modelName: string]: {
    setting: ModelSetting
    copabilities?: string[]
  }
}

/**
 * The `ModelProvider` type defines the shape of a model provider object
 * @data_transfer_object
 */
export type ModelProvider = {
  [providerName: string]: {
    name: string
    productName: string
    active: boolean | null
    description: string
    version: string
    apiKey: string
    inferenceUrl: string
    provider: string
    models: Model[]
  }
}
