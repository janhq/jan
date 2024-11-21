import {
  ModelExtension,
  Model,
  InferenceEngine,
  joinPath,
  dirName,
  fs,
  ModelManager,
  abortDownload,
  DownloadState,
  events,
  DownloadEvent,
  OptionType,
} from '@janhq/core'
import { CortexAPI } from './cortex'
import { scanModelsFolder } from './legacy/model-json'
import { downloadModel } from './legacy/download'
import { systemInformation } from '@janhq/core'
import { deleteModelFiles } from './legacy/delete'

declare const SETTINGS: Array<any>

export enum Settings {
  huggingfaceToken = 'hugging-face-access-token',
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

    // Configure huggingface token if available
    const huggingfaceToken = await this.getSetting<string>(
      Settings.huggingfaceToken,
      undefined
    )
    if (huggingfaceToken)
      this.cortexAPI.configs({ huggingface_token: huggingfaceToken })

    // Listen to app download events
    this.handleDesktopEvents()
  }

  /**
   * Subscribe to settings update and make change accordingly
   * @param key
   * @param value
   */
  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.huggingfaceToken) {
      this.cortexAPI.configs({ huggingface_token: value })
    }
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
  async pullModel(model: string, id?: string, name?: string): Promise<void> {
    if (id) {
      const model: Model = ModelManager.instance().get(id)
      // Clip vision model - should not be handled by cortex.cpp
      // TensorRT model - should not be handled by cortex.cpp
      if (
        model &&
        (model.engine === InferenceEngine.nitro_tensorrt_llm ||
          model.settings.vision_model)
      ) {
        return downloadModel(model, (await systemInformation()).gpuSetting)
      }
    }
    /**
     * Sending POST to /models/pull/{id} endpoint to pull the model
     */
    return this.cortexAPI.pullModel(model, id, name)
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
        modelDto &&
        (modelDto.engine === InferenceEngine.nitro_tensorrt_llm ||
          modelDto.settings.vision_model)
      ) {
        for (const source of modelDto.sources) {
          const path = await joinPath(['models', modelDto.id, source.filename])
          await abortDownload(path)
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
    return this.cortexAPI
      .deleteModel(model)
      .catch((e) => console.debug(e))
      .finally(async () => {
        // Delete legacy model files
        await deleteModelFiles(model).catch((e) => console.debug(e))
      })
  }

  /**
   * Gets all pulled models
   * @returns A Promise that resolves with an array of all models.
   */
  async getModels(): Promise<Model[]> {
    /**
     * Legacy models should be supported
     */
    let legacyModels = await scanModelsFolder()

    /**
     * Here we are filtering out the models that are not imported
     * and are not using llama.cpp engine
     */
    var toImportModels = legacyModels.filter(
      (e) => e.engine === InferenceEngine.nitro
    )

    /**
     * Fetch models from cortex.cpp
     */
    var fetchedModels = await this.cortexAPI.getModels().catch(() => [])

    // Checking if there are models to import
    const existingIds = fetchedModels.map((e) => e.id)
    toImportModels = toImportModels.filter(
      (e: Model) => !existingIds.includes(e.id) && !e.settings?.vision_model
    )

    /**
     * There is no model to import
     * just return fetched models
     */
    if (!toImportModels.length)
      return fetchedModels.concat(
        legacyModels.filter((e) => !fetchedModels.some((x) => x.id === e.id))
      )

    console.log('To import models:', toImportModels.length)
    /**
     * There are models to import
     */
    if (toImportModels.length > 0) {
      // Import models
      await Promise.all(
        toImportModels.map(async (model: Model & { file_path: string }) => {
          return this.importModel(
            model.id,
            model.sources[0].url.startsWith('http') ||
              !(await fs.existsSync(model.sources[0].url))
              ? await joinPath([
                  await dirName(model.file_path),
                  model.sources[0]?.filename ??
                    model.settings?.llama_model_path ??
                    model.sources[0]?.url.split('/').pop() ??
                    model.id,
                ]) // Copied models
              : model.sources[0].url, // Symlink models,
            model.name
          )
            .then((e) => {
              this.updateModel({
                id: model.id,
                ...model.settings,
                ...model.parameters,
              } as Partial<Model>)
            })
            .catch((e) => {
              console.debug(e)
            })
        })
      )
    }

    /**
     * Models are imported successfully before
     * Now return models from cortex.cpp and merge with legacy models which are not imported
     */
    return await this.cortexAPI
      .getModels()
      .then((models) => {
        return models.concat(
          legacyModels.filter((e) => !models.some((x) => x.id === e.id))
        )
      })
      .catch(() => Promise.resolve(legacyModels))
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
  async importModel(
    model: string,
    modelPath: string,
    name?: string,
    option?: OptionType
  ): Promise<void> {
    return this.cortexAPI.importModel(model, modelPath, name, option)
  }

  /**
   * Check model status
   * @param model
   */
  async isModelLoaded(model: string): Promise<boolean> {
    return this.cortexAPI.getModelStatus(model)
  }

  /**
   * Configure pull options such as proxy, headers, etc.
   */
  async configurePullOptions(options: { [key: string]: any }): Promise<any> {
    return this.cortexAPI.configs(options).catch((e) => console.debug(e))
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
