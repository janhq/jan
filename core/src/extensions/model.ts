import { BaseExtension } from "../extension";
import { Model, ModelCatalog } from "../types/index";

/**
 * Model extension for managing models.
 */
export abstract class ModelExtension extends BaseExtension {
  /**
   * Downloads a model.
   * @param model - The model to download.
   * @returns A Promise that resolves when the model has been downloaded.
   */
  abstract downloadModel(model: Model): Promise<void>;

  /**
   * Cancels the download of a specific model.
   * @param {string} modelId - The ID of the model to cancel the download for.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  abstract cancelModelDownload(modelId: string): Promise<void>;

  /**
   * Deletes a model.
   * @param modelId - The ID of the model to delete.
   * @returns A Promise that resolves when the model has been deleted.
   */
  abstract deleteModel(modelId: string): Promise<void>;

  /**
   * Saves a model.
   * @param model - The model to save.
   * @returns A Promise that resolves when the model has been saved.
   */
  abstract saveModel(model: Model): Promise<void>;

  /**
   * Gets a list of downloaded models.
   * @returns A Promise that resolves with an array of downloaded models.
   */
  abstract getDownloadedModels(): Promise<Model[]>;

  /**
   * Gets a list of configured models.
   * @returns A Promise that resolves with an array of configured models.
   */
  abstract getConfiguredModels(): Promise<ModelCatalog[]>;
}
