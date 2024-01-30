import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { HuggingFaceInterface, HuggingFaceRepoData } from '../types/huggingface'

/**
 * Hugging Face extension for converting HF models to GGUF.
 */
export abstract class HuggingFaceExtension extends BaseExtension implements HuggingFaceInterface {
  /**
   * Hugging Face extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.HuggingFace
  }

  abstract convert(repoID: string, repoData: HuggingFaceRepoData): Promise<void>
  abstract cancelConvert(repoID: string, repoData: HuggingFaceRepoData): Promise<void>
}
