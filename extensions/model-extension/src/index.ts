import {
  ModelExtension,
  Model,
  InferenceEngine,
  fs,
  joinPath,
  dirName,
} from '@janhq/core'
import { CortexAPI } from './cortex'

declare const SETTINGS: Array<any>

/**
 * TODO: Set env for HF access token? or via API request?
 */
enum Settings {
  huggingFaceAccessToken = 'hugging-face-access-token',
}

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
  private static readonly _homeDir = 'file://models'
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
  async pullModel(model: string): Promise<void> {
    /**
     * Sending POST to /models/pull/{id} endpoint to pull the model
     */
    return this.cortexAPI?.pullModel(model)
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
    this.cortexAPI?.cancelModelPull(model)
  }

  /**
   * Deletes a pulled model
   * @param model - The model to delete
   * @returns A Promise that resolves when the model is deleted.
   */
  async deleteModel(model: string): Promise<void> {
    return this.cortexAPI?.deleteModel(model)
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

    if (!localStorage.getItem(ExtensionEnum.downloadedModels)) {
      // Updated from an older version than 0.5.5
      // Scan through the models folder and import them (Legacy flow)
      // Return models immediately
      return this.scanModelsFolder().then((models) => {
        return models ?? []
      })
    }

    let currentModels: Model[] = []

    try {
      currentModels = JSON.parse(
        localStorage.getItem(ExtensionEnum.downloadedModels)
      ) as Model[]
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

    await this.cortexAPI?.getModels().then((models) => {
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
      this.cortexAPI?.getModels().then((models) => {
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
    return this.cortexAPI?.importModel(model, modelPath)
  }

  //// LEGACY MODEL FOLDER ////
  /**
   * Scan through models folder and return downloaded models
   * @returns
   */
  private async scanModelsFolder(): Promise<Model[]> {
    try {
      if (!(await fs.existsSync(JanModelExtension._homeDir))) {
        console.debug('Model folder not found')
        return []
      }

      const files: string[] = await fs.readdirSync(JanModelExtension._homeDir)

      const allDirectories: string[] = []

      for (const modelFolder of files) {
        const fullModelFolderPath = await joinPath([
          JanModelExtension._homeDir,
          modelFolder,
        ])
        if (!(await fs.fileStat(fullModelFolderPath)).isDirectory) continue
        allDirectories.push(modelFolder)
      }

      const readJsonPromises = allDirectories.map(async (dirName) => {
        // filter out directories that don't match the selector
        // read model.json
        const folderFullPath = await joinPath([
          JanModelExtension._homeDir,
          dirName,
        ])

        const jsonPath = await this.getModelJsonPath(folderFullPath)

        if (await fs.existsSync(jsonPath)) {
          // if we have the model.json file, read it
          let model = await fs.readFileSync(jsonPath, 'utf-8')

          model = typeof model === 'object' ? model : JSON.parse(model)

          // This to ensure backward compatibility with `model.json` with `source_url`
          if (model['source_url'] != null) {
            model['sources'] = [
              {
                filename: model.id,
                url: model['source_url'],
              },
            ]
          }
          model.file_path = jsonPath
          model.file_name = 'model.json'

          // Check model file exist
          // model binaries (sources) are absolute path & exist (symlinked)
          const existFiles = await Promise.all(
            model.sources.map(
              (source) =>
                // Supposed to be a local file url
                !source.url.startsWith(`http://`) &&
                !source.url.startsWith(`https://`)
            )
          )
          if (existFiles.every((exist) => exist)) return true

          const result = await fs
            .readdirSync(await joinPath([JanModelExtension._homeDir, dirName]))
            .then((files: string[]) => {
              // Model binary exists in the directory
              // Model binary name can match model ID or be a .gguf file and not be an incompleted model file
              return (
                files.includes(dirName) || // Legacy model GGUF without extension
                files.filter((file) => {
                  return (
                    file.toLowerCase().endsWith('.gguf') || // GGUF
                    file.toLowerCase().endsWith('.engine') // Tensort-LLM
                  )
                })?.length > 0 // TODO: find better way (can use basename to check the file name with source url)
              )
            })

          if (result) return model
          else return undefined
        }
      })
      const results = await Promise.allSettled(readJsonPromises)
      const modelData = results
        .map((result) => {
          if (result.status === 'fulfilled' && result.value) {
            try {
              const model =
                typeof result.value === 'object'
                  ? result.value
                  : JSON.parse(result.value)
              return model as Model
            } catch {
              console.debug(`Unable to parse model metadata: ${result.value}`)
            }
          }
          return undefined
        })
        .filter((e) => !!e)

      return modelData
    } catch (err) {
      console.error(err)
      return []
    }
  }

  /**
   * Retrieve the model.json path from a folder
   * @param folderFullPath
   * @returns
   */
  private async getModelJsonPath(
    folderFullPath: string
  ): Promise<string | undefined> {
    // try to find model.json recursively inside each folder
    if (!(await fs.existsSync(folderFullPath))) return undefined
    const files: string[] = await fs.readdirSync(folderFullPath)
    if (files.length === 0) return undefined
    if (files.includes('model.json')) {
      return joinPath([folderFullPath, 'model.json'])
    }
    // continue recursive
    for (const file of files) {
      const path = await joinPath([folderFullPath, file])
      const fileStats = await fs.fileStat(path)
      if (fileStats.isDirectory) {
        const result = await this.getModelJsonPath(path)
        if (result) return result
      }
    }
  }
  //// END LEGACY MODEL FOLDER ////
}
