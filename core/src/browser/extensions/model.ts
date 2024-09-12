import { BaseExtension, ExtensionTypeEnum } from '../extension'
import {
  GpuSetting,
  HuggingFaceRepoData,
  ImportingModel,
  Model,
  ModelFile,
  ModelInterface,
  OptionType,
} from '../../types'

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
  abstract getDownloadedModels(): Promise<ModelFile[]>
  abstract getConfiguredModels(): Promise<ModelFile[]>
  abstract importModels(models: ImportingModel[], optionType: OptionType): Promise<void>
  abstract updateModelInfo(modelInfo: Partial<ModelFile>): Promise<ModelFile>
  abstract fetchHuggingFaceRepoData(repoId: string): Promise<HuggingFaceRepoData>
  abstract getDefaultModel(): Promise<Model>
}
