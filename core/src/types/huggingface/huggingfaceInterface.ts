import { HuggingFaceRepoData } from './huggingfaceEntity'

/**
 * Hugging Face extension for converting HF models to GGUF.
 * @extends BaseExtension
 */
export interface HuggingFaceInterface {
  /**
   * Downloads and converts a Hugging Face model to GGUF.
   * @param repoID - The repo ID of the model to convert.
   * @param repoData - The repo data of the model to convert.
   * @param network - Optional object to specify proxy/whether to ignore SSL certificates.
   * @returns A promise that resolves when the conversion is complete.
   */
  convert(
    repoID: string,
    repoData: HuggingFaceRepoData,
    network?: { ignoreSSL?: boolean; proxy?: string }
  ): Promise<void>

  /**
   * Cancels the convert of current Hugging Face model.
   * @param repoID - The repository ID to cancel.
   * @param repoData - The repository data to cancel.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  cancelConvert(repoID: string, repoData: HuggingFaceRepoData): Promise<void>
}
