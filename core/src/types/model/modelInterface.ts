import { Model } from './modelEntity'

/**
 * Model extension for managing models.
 */
export interface ModelInterface {
  /**
   * Downloads a model.
   * @param model - The model to download.
   * @param network - Optional object to specify proxy/whether to ignore SSL certificates.
   * @returns A Promise that resolves when the model has been downloaded.
   */
  downloadModel(model: Model, network?: { ignoreSSL?: boolean; proxy?: string }): Promise<void>

  /**
   * Cancels the download of a specific model.
   * @param {string} modelId - The ID of the model to cancel the download for.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  cancelModelDownload(modelId: string): Promise<void>

  /**
   * Deletes a model.
   * @param modelId - The ID of the model to delete.
   * @returns A Promise that resolves when the model has been deleted.
   */
  deleteModel(modelId: string): Promise<void>

  /**
   * Saves a model.
   * @param model - The model to save.
   * @returns A Promise that resolves when the model has been saved.
   */
  saveModel(model: Model): Promise<void>

  /**
   * Gets a list of downloaded models.
   * @returns A Promise that resolves with an array of downloaded models.
   */
  getDownloadedModels(): Promise<Model[]>

  /**
   * Gets a list of configured models.
   * @returns A Promise that resolves with an array of configured models.
   */
  getConfiguredModels(): Promise<Model[]>
}
