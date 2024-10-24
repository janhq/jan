import {
  ModelExtension,
  Model,
  InferenceEngine,
  joinPath,
  dirName,
  ModelManager,
  abortDownload,
  DownloadState,
  events,
  DownloadEvent,
} from '@janhq/core'
import { CortexAPI } from './cortex'
import { scanModelsFolder } from './legacy/model-json'
import { downloadModel } from './legacy/download'

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

    // Listen to app download events
    this.handleDesktopEvents()
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
    if (id) {
      const model: Model = ModelManager.instance().get(id)
      // Clip vision model - should not be handled by cortex.cpp
      // TensorRT model - should not be handled by cortex.cpp
      if (
        model.engine === InferenceEngine.nitro_tensorrt_llm ||
        model.settings.vision_model
      ) {
        return downloadModel(model)
      }
    }
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
    if (model) {
      const modelDto: Model = ModelManager.instance().get(model)
      // Clip vision model - should not be handled by cortex.cpp
      // TensorRT model - should not be handled by cortex.cpp
      if (
        modelDto.engine === InferenceEngine.nitro_tensorrt_llm ||
        modelDto.settings.vision_model
      ) {
        for (const source of modelDto.sources) {
          const path = await joinPath(['models', modelDto.id, source.filename])
          return abortDownload(path)
        }
      }
    }
    /**
     * Sending DELETE to /models/pull/{id} endpoint to cancel a model pull
     */
    return this.cortexAPI.cancelModelPull(model)
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

    /**
     * Legacy models should be supported
     */
    let legacyModels = await scanModelsFolder()

    try {
      if (!localStorage.getItem(ExtensionEnum.downloadedModels)) {
        // Updated from an older version than 0.5.5
        // Scan through the models folder and import them (Legacy flow)
        // Return models immediately
        currentModels = legacyModels
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
        (e: Model) => !existingIds.includes(e.id) && !e.settings?.vision_model
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
     * Models are imported successfully before
     * Now return models from cortex.cpp and merge with legacy models which are not imported
     */
    return (
      this.cortexAPI.getModels().then((models) => {
        return models.concat(
          legacyModels.filter((e) => !models.some((x) => x.id === e.id))
        )
      }) ?? Promise.resolve(legacyModels)
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

  /**
   * Handle download state from main app
   */
  handleDesktopEvents() {
    if (window && window.electronAPI) {
      window.electronAPI.onFileDownloadUpdate(
        async (_event: string, state: DownloadState | undefined) => {
          if (!state) return
          state.downloadState = 'downloading'
          events.emit(DownloadEvent.onFileDownloadUpdate, state)
        }
      )
      window.electronAPI.onFileDownloadError(
        async (_event: string, state: DownloadState) => {
          state.downloadState = 'error'
          events.emit(DownloadEvent.onFileDownloadError, state)
        }
      )
      window.electronAPI.onFileDownloadSuccess(
        async (_event: string, state: DownloadState) => {
          state.downloadState = 'end'
          events.emit(DownloadEvent.onFileDownloadSuccess, state)
        }
      )
    }
  }
}
