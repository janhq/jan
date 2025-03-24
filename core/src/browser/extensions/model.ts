import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { Model, ModelInterface, ModelSource, OptionType } from '../../types'

/**
 * Model extension for managing models.
 */
export abstract class ModelExtension
  extends BaseExtension
  implements ModelInterface
{
  /**
   * Model extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Model
  }

  abstract configurePullOptions(configs: { [key: string]: any }): Promise<any>
  abstract getModels(): Promise<Model[]>
  abstract pullModel(model: string, id?: string, name?: string): Promise<void>
  abstract cancelModelPull(modelId: string): Promise<void>
  abstract importModel(
    model: string,
    modePath: string,
    name?: string,
    optionType?: OptionType
  ): Promise<void>
  abstract updateModel(modelInfo: Partial<Model>): Promise<Model>
  abstract deleteModel(model: string): Promise<void>
  abstract isModelLoaded(model: string): Promise<boolean>
  /**
   * Get model sources
   */
  abstract getSources(): Promise<ModelSource[]>
  /**
   * Add a model source
   */
  abstract addSource(source: string): Promise<void>
  /**
   * Delete a model source
   */
  abstract deleteSource(source: string): Promise<void>
}
