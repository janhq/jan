import { BaseExtension } from '../extension'
import { Model, ModelInterface } from '../index'

/**
 * Model extension for managing models.
 */
export abstract class ModelExtension extends BaseExtension implements ModelInterface {
  abstract downloadModel(model: Model): Promise<void>
  abstract cancelModelDownload(modelId: string): Promise<void>
  abstract deleteModel(modelId: string): Promise<void>
  abstract saveModel(model: Model): Promise<void>
  abstract getDownloadedModels(): Promise<Model[]>
  abstract getConfiguredModels(): Promise<Model[]>
}
