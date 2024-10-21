import {
  ModelExtension,
  Model,
  InferenceEngine,
  joinPath,
  dirName,
} from '@janhq/core'
import { CortexAPI } from './cortex'
import { scanModelsFolder } from './model-json'

declare const SETTINGS: Array<any>

/**
 * Extension enum
 */
enum ExtensionEnum {
  downloadedModels = 'downloadedModels',
}

/**
 * A extension for models
 */
export default class JanModelExtension extends ModelExtension {
  cortexAPI: CortexAPI = new CortexAPI()

  /**
   * Called when the extension is loaded.
   * @override
   */
  async onLoad() {
    this.registerSettings(SETTINGS)

    // Try get models from cortex.cpp
    this.getModels().then((models) => {
      this.registerModels(models)
    })
  }

  /**
   * Called when the extension is unloaded.
   * @override
   */
  async onUnload() {}

  /**
   * Downloads a machine learning model.
   * @param model - The model to download.
   * @returns A Promise that resolves when the model is downloaded.
   */
  async pullModel(model: string, id?: string): Promise<void> {
    /**
     * Sending POST to /models/pull/{id} endpoint to pull the model
     */
    return this.cortexAPI.pullModel(model, id)
  }

  /**
   * Cancels the download of a specific machine learning model.
   *
   * @param {string} model - The ID of the model whose download is to be cancelled.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  async cancelModelPull(model: string): Promise<void> {
    /**
     * Sending DELETE to /models/pull/{id} endpoint to cancel a model pull
     */
    this.cortexAPI.cancelModelPull(model)
  }

  /**
   * Deletes a pulled model
   * @param model - The model to delete
   * @returns A Promise that resolves when the model is deleted.
   */
  async deleteModel(model: string): Promise<void> {
    return this.cortexAPI.deleteModel(model)
  }

  /**
   * Gets all pulled models
   * @returns A Promise that resolves with an array of all models.
   */
  async getModels(): Promise<Model[]> {
    /**
     * In this action, if return empty array right away
     * it would reset app cache and app will not function properly
     * should compare and try import
     */
    let currentModels: Model[] = []
    try {
      if (!localStorage.getItem(ExtensionEnum.downloadedModels)) {
        // Updated from an older version than 0.5.5
        // Scan through the models folder and import them (Legacy flow)
        // Return models immediately
        currentModels = await scanModelsFolder().then((models) => {
          return models ?? []
        })
      } else {
        currentModels = JSON.parse(
          localStorage.getItem(ExtensionEnum.downloadedModels)
        ) as Model[]
      }
    } catch (e) {
      currentModels = []
      console.error(e)
    }

    /**
     * Here we are filtering out the models that are not imported
     * and are not using llama.cpp engine
     */
    var toImportModels = currentModels.filter(
      (e) => e.engine === InferenceEngine.nitro
    )

    await this.cortexAPI.getModels().then((models) => {
      const existingIds = models.map((e) => e.id)
      toImportModels = toImportModels.filter(
        (e: Model) => !existingIds.includes(e.id)
      )
    })

    console.log('To import models:', toImportModels.length)
    /**
     * There are models to import
     * do not return models from cortex.cpp yet
     * otherwise it will reset the app cache
     * */
    if (toImportModels.length > 0) {
      // Import models
      await Promise.all(
        toImportModels.map(async (model: Model & { file_path: string }) =>
          this.importModel(
            model.id,
            await joinPath([
              await dirName(model.file_path),
              model.sources[0]?.filename ??
                model.settings?.llama_model_path ??
                model.sources[0]?.url.split('/').pop() ??
                model.id,
            ])
          )
        )
      )

      return currentModels
    }

    /**
     * All models are imported successfully before
     * just return models from cortex.cpp
     */
    return (
      this.cortexAPI.getModels().then((models) => {
        return models
      }) ?? Promise.resolve([])
    )
  }

  /**
   * Update a pulled model metadata
   * @param model - The metadata of the model
   */
  async updateModel(model: Partial<Model>): Promise<Model> {
    return this.cortexAPI
      ?.updateModel(model)
      .then(() => this.cortexAPI!.getModel(model.id))
  }

  /**
   * Import an existing model file
   * @param model
   * @param optionType
   */
  async importModel(model: string, modelPath: string): Promise<void> {
    return this.cortexAPI.importModel(model, modelPath)
  }
}
