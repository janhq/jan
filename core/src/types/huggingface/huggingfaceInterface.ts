import { Model } from '../model'
import { HuggingFaceRepoData, Quantization } from './huggingfaceEntity'

/**
 * Hugging Face extension for converting HF models to GGUF.
 * @extends BaseExtension
 */
export interface HuggingFaceInterface {
  interrupted: boolean
  /**
   * Downloads a Hugging Face model.
   * @param repoID - The repo ID of the model to convert.
   * @param repoData - The repo data of the model to convert.
   * @param network - Optional object to specify proxy/whether to ignore SSL certificates.
   * @returns A promise that resolves when the download is complete.
   */
  downloadModelFiles(
    repoID: string,
    repoData: HuggingFaceRepoData,
    network?: { ignoreSSL?: boolean; proxy?: string }
  ): Promise<void>

  /**
   * Converts a Hugging Face model to GGUF.
   * @param repoID - The repo ID of the model to convert.
   * @returns A promise that resolves when the conversion is complete.
   */
  convert(repoID: string): Promise<void>

  /**
   * Quantizes a GGUF model.
   * @param repoID - The repo ID of the model to quantize.
   * @param quantization - The quantization to use.
   * @returns A promise that resolves when the quantization is complete.
   */
  quantize(repoID: string, quantization: Quantization): Promise<void>

  /**
   * Generates Jan model metadata from a Hugging Face model.
   * @param repoID - The repo ID of the model to generate metadata for.
   * @param repoData - The repo data of the model to generate metadata for.
   * @param quantization - The quantization of the model.
   * @returns A promise that resolves when the model metadata generation is complete.
   */
  generateMetadata(
    repoID: string,
    repoData: HuggingFaceRepoData,
    quantization: Quantization
  ): Promise<void>

  /**
   * Cancels the convert of current Hugging Face model.
   * @param repoID - The repository ID to cancel.
   * @param repoData - The repository data to cancel.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  cancelConvert(repoID: string, repoData: HuggingFaceRepoData): Promise<void>
}
