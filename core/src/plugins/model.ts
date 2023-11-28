/**
 * Represents a plugin for managing machine learning models.
 * @abstract
 */
import { JanPlugin } from "../plugin";
import { Model, ModelCatalog } from "../types/index";

/**
 * An abstract class representing a plugin for managing machine learning models.
 */
export abstract class ModelPlugin extends JanPlugin {
  /**
   * Downloads a model.
   * @param model - The model to download.
   * @returns A Promise that resolves when the model has been downloaded.
   */
  abstract downloadModel(model: Model): Promise<void>;

  /**
   * Cancels the download of a specific model.
   * @param {string} name - The name of the model to cancel the download for.
   * @param {string} modelId - The ID of the model to cancel the download for.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  abstract cancelModelDownload(name: string, modelId: string): Promise<void>;

  /**
   * Deletes a model.
   * @param filePath - The file path of the model to delete.
   * @returns A Promise that resolves when the model has been deleted.
   */
  abstract deleteModel(filePath: string): Promise<void>;

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
