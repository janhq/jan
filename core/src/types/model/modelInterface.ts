import { Model } from './modelEntity'
import { OptionType } from './modelImport'
import { ModelSource } from './modelSource'

/**
 * Model extension for managing models.
 */
export interface ModelInterface {
  /**
   * Downloads a model.
   * @param model - The model to download.
   * @returns A Promise that resolves when the model has been downloaded.
   */
  pullModel(model: string, id?: string, name?: string): Promise<void>

  /**
   * Cancels the download of a specific model.
   * @param {string} modelId - The ID of the model to cancel the download for.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  cancelModelPull(model: string): Promise<void>

  /**
   * Deletes a model.
   * @param modelId - The ID of the model to delete.
   * @returns A Promise that resolves when the model has been deleted.
   */
  deleteModel(model: string): Promise<void>

  /**
   * Gets downloaded models.
   * @returns A Promise that resolves with an array of downloaded models.
   */
  getModels(): Promise<Model[]>

  /**
   * Update a pulled model's metadata
   * @param model - The model to update.
   * @returns A Promise that resolves when the model has been updated.
   */
  updateModel(model: Partial<Model>): Promise<Model>

  /**
   * Import an existing model file.
   * @param model id of the model to import
   * @param modelPath - path of the model file
   */
  importModel(
    model: string,
    modePath: string,
    name?: string,
    optionType?: OptionType
  ): Promise<void>

  /**
   * Get model sources
   */
  getSources(): Promise<ModelSource[]>
  /**
   * Add a model source
   */
  addSource(source: string): Promise<void>
  /**
   * Delete a model source
   */
  deleteSource(source: string): Promise<void>
}
