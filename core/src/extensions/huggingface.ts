import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { HuggingFaceInterface, HuggingFaceRepoData, Quantization } from '../types/huggingface'
import { Model } from '../types/model'

/**
 * Hugging Face extension for converting HF models to GGUF.
 */
export abstract class HuggingFaceExtension extends BaseExtension implements HuggingFaceInterface {
  interrupted = false
  /**
   * Hugging Face extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.HuggingFace
  }

  abstract downloadModelFiles(
    repoID: string,
    repoData: HuggingFaceRepoData,
    network?: { ignoreSSL?: boolean; proxy?: string }
  ): Promise<void>
  abstract convert(repoID: string): Promise<void>
  abstract quantize(repoID: string, quantization: Quantization): Promise<void>
  abstract generateMetadata(
    repoID: string,
    repoData: HuggingFaceRepoData,
    quantization: Quantization
  ): Promise<void>
  abstract cancelConvert(repoID: string, repoData: HuggingFaceRepoData): Promise<void>
}
