import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { GpuSetting, ImportingModel, Model, ModelInterface, OptionType } from '../../types'

/**
 * Model extension for managing models.
 */
export abstract class ModelExtension extends BaseExtension implements ModelInterface {
  /**
   * Model extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Model
  }

  abstract downloadModel(
    model: Model,
    gpuSettings?: GpuSetting,
    network?: { proxy: string; ignoreSSL?: boolean }
  ): Promise<void>
  abstract cancelModelDownload(modelId: string): Promise<void>
  abstract deleteModel(modelId: string): Promise<void>
  abstract saveModel(model: Model): Promise<void>
  abstract getDownloadedModels(): Promise<Model[]>
  abstract getConfiguredModels(): Promise<Model[]>
  abstract importModels(models: ImportingModel[], optionType: OptionType): Promise<void>
  abstract updateModelInfo(modelInfo: Partial<Model>): Promise<Model>
}
