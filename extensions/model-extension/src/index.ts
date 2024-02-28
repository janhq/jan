import {
  fs,
  downloadFile,
  abortDownload,
  getResourcePath,
  InferenceEngine,
  joinPath,
  ModelExtension,
  Model,
  getJanDataFolderPath,
  events,
  DownloadEvent,
  DownloadRoute,
  ModelEvent,
  DownloadState,
  OptionType,
  ImportingModel,
  LocalImportModelEvent,
  baseName,
} from '@janhq/core'

import { extractFileName } from './helpers/path'

/**
 * A extension for models
 */
export default class JanModelExtension extends ModelExtension {
  private static readonly _homeDir = 'file://models'
  private static readonly _modelMetadataFileName = 'model.json'
  private static readonly _supportedModelFormat = '.gguf'
  private static readonly _incompletedModelFileName = '.download'
  private static readonly _offlineInferenceEngine = InferenceEngine.nitro

  private static readonly _configDirName = 'config'
  private static readonly _defaultModelFileName = 'default-model.json'

  /**
   * Called when the extension is loaded.
   * @override
   */
  async onLoad() {
    this.copyModelsToHomeDir()
    // Handle Desktop Events
    this.handleDesktopEvents()
  }

  /**
   * Called when the extension is unloaded.
   * @override
   */
  onUnload(): void {}

  private async copyModelsToHomeDir() {
    try {
      // Check for migration conditions
      if (
        localStorage.getItem(`${EXTENSION_NAME}-version`) === VERSION &&
        (await fs.existsSync(JanModelExtension._homeDir))
      ) {
        // ignore if the there is no need to migrate
        console.debug('Models already persisted.')
        return
      }
      // copy models folder from resources to home directory
      const resourePath = await getResourcePath()
      const srcPath = await joinPath([resourePath, 'models'])

      const janDataFolderPath = await getJanDataFolderPath()
      const destPath = await joinPath([janDataFolderPath, 'models'])

      await fs.syncFile(srcPath, destPath)

      console.debug('Finished syncing models')

      // Finished migration
      localStorage.setItem(`${EXTENSION_NAME}-version`, VERSION)

      events.emit(ModelEvent.OnModelsUpdate, {})
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Downloads a machine learning model.
   * @param model - The model to download.
   * @param network - Optional object to specify proxy/whether to ignore SSL certificates.
   * @returns A Promise that resolves when the model is downloaded.
   */
  async downloadModel(
    model: Model,
    network?: { ignoreSSL?: boolean; proxy?: string }
  ): Promise<void> {
    // create corresponding directory
    const modelDirPath = await joinPath([JanModelExtension._homeDir, model.id])
    if (!(await fs.existsSync(modelDirPath))) await fs.mkdirSync(modelDirPath)

    if (model.sources.length > 1) {
      // path to model binaries
      for (const source of model.sources) {
        let path = extractFileName(
          source.url,
          JanModelExtension._supportedModelFormat
        )
        if (source.filename) {
          path = await joinPath([modelDirPath, source.filename])
        }

        downloadFile(source.url, path, network)
      }
      // TODO: handle multiple binaries for web later
    } else {
      const fileName = extractFileName(
        model.sources[0]?.url,
        JanModelExtension._supportedModelFormat
      )
      const path = await joinPath([modelDirPath, fileName])
      downloadFile(model.sources[0]?.url, path, network)

      if (window && window.core?.api && window.core.api.baseApiUrl) {
        this.startPollingDownloadProgress(model.id)
      }
    }
  }

  /**
   * Specifically for Jan server.
   */
  private async startPollingDownloadProgress(modelId: string): Promise<void> {
    // wait for some seconds before polling
    await new Promise((resolve) => setTimeout(resolve, 3000))

    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        fetch(
          `${window.core.api.baseApiUrl}/v1/download/${DownloadRoute.getDownloadProgress}/${modelId}`,
          {
            method: 'GET',
            headers: { contentType: 'application/json' },
          }
        ).then(async (res) => {
          const state: DownloadState = await res.json()
          if (state.downloadState === 'end') {
            events.emit(DownloadEvent.onFileDownloadSuccess, state)
            clearInterval(interval)
            resolve()
            return
          }

          if (state.downloadState === 'error') {
            events.emit(DownloadEvent.onFileDownloadError, state)
            clearInterval(interval)
            resolve()
            return
          }

          events.emit(DownloadEvent.onFileDownloadUpdate, state)
        })
      }, 1000)
    })
  }

  /**
   * Cancels the download of a specific machine learning model.
   *
   * @param {string} modelId - The ID of the model whose download is to be cancelled.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  async cancelModelDownload(modelId: string): Promise<void> {
    const path = await joinPath([JanModelExtension._homeDir, modelId, modelId])
    try {
      await abortDownload(path)
      await fs.unlinkSync(path)
    } catch (e) {
      console.error(e)
    }
  }

  /**
   * Deletes a machine learning model.
   * @param filePath - The path to the model file to delete.
   * @returns A Promise that resolves when the model is deleted.
   */
  async deleteModel(modelId: string): Promise<void> {
    try {
      const dirPath = await joinPath([JanModelExtension._homeDir, modelId])
      const jsonFilePath = await joinPath([
        dirPath,
        JanModelExtension._modelMetadataFileName,
      ])
      const modelInfo = JSON.parse(
        await this.readModelMetadata(jsonFilePath)
      ) as Model

      const isUserImportModel =
        modelInfo.metadata?.author?.toLowerCase() === 'user'
      if (isUserImportModel) {
        // just delete the folder
        return fs.rmdirSync(dirPath)
      }

      // remove all files under dirPath except model.json
      const files = await fs.readdirSync(dirPath)
      const deletePromises = files.map(async (fileName: string) => {
        if (fileName !== JanModelExtension._modelMetadataFileName) {
          return fs.unlinkSync(await joinPath([dirPath, fileName]))
        }
      })
      await Promise.allSettled(deletePromises)
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Saves a machine learning model.
   * @param model - The model to save.
   * @returns A Promise that resolves when the model is saved.
   */
  async saveModel(model: Model): Promise<void> {
    const jsonFilePath = await joinPath([
      JanModelExtension._homeDir,
      model.id,
      JanModelExtension._modelMetadataFileName,
    ])

    try {
      await fs.writeFileSync(jsonFilePath, JSON.stringify(model, null, 2))
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Gets all downloaded models.
   * @returns A Promise that resolves with an array of all models.
   */
  async getDownloadedModels(): Promise<Model[]> {
    return await this.getModelsMetadata(
      async (modelDir: string, model: Model) => {
        if (model.engine !== JanModelExtension._offlineInferenceEngine)
          return true

        // model binaries (sources) are absolute path & exist
        const existFiles = await Promise.all(
          model.sources.map((source) => fs.existsSync(source.url))
        )
        if (existFiles.every((exist) => exist)) return true

        return await fs
          .readdirSync(await joinPath([JanModelExtension._homeDir, modelDir]))
          .then((files: string[]) => {
            // Model binary exists in the directory
            // Model binary name can match model ID or be a .gguf file and not be an incompleted model file
            return (
              files.includes(modelDir) ||
              files.filter(
                (file) =>
                  file
                    .toLowerCase()
                    .includes(JanModelExtension._supportedModelFormat) &&
                  !file.endsWith(JanModelExtension._incompletedModelFileName)
              )?.length >= model.sources.length
            )
          })
      }
    )
  }

  private async getModelsMetadata(
    selector?: (path: string, model: Model) => Promise<boolean>
  ): Promise<Model[]> {
    try {
      if (!(await fs.existsSync(JanModelExtension._homeDir))) {
        console.debug('Model folder not found')
        return []
      }

      const files: string[] = await fs.readdirSync(JanModelExtension._homeDir)

      const allDirectories: string[] = []
      for (const file of files) {
        if (file === '.DS_Store') continue
        if (file === 'config') continue
        allDirectories.push(file)
      }

      const readJsonPromises = allDirectories.map(async (dirName) => {
        // filter out directories that don't match the selector
        // read model.json
        const jsonPath = await joinPath([
          JanModelExtension._homeDir,
          dirName,
          JanModelExtension._modelMetadataFileName,
        ])

        if (await fs.existsSync(jsonPath)) {
          // if we have the model.json file, read it
          let model = await this.readModelMetadata(jsonPath)

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

          if (selector && !(await selector?.(dirName, model))) {
            return
          }
          return model
        } else {
          // otherwise, we generate our own model file
          // TODO: we might have more than one binary file here. This will be addressed with new version of Model file
          //  which is the PR from Hiro on branch Jan can see
          return this.generateModelMetadata(dirName)
        }
      })
      const results = await Promise.allSettled(readJsonPromises)
      const modelData = results.map((result) => {
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

      return modelData.filter((e) => !!e)
    } catch (err) {
      console.error(err)
      return []
    }
  }

  private readModelMetadata(path: string) {
    return fs.readFileSync(path, 'utf-8')
  }

  /**
   * Handle the case where we have the model directory but we don't have the corresponding
   * model.json file associated with it.
   *
   * This function will create a model.json file for the model.
   * It works only with single binary file model.
   *
   * @param dirName the director which reside in ~/jan/models but does not have model.json file.
   */
  private async generateModelMetadata(dirName: string): Promise<Model> {
    const files: string[] = await fs.readdirSync(
      await joinPath([JanModelExtension._homeDir, dirName])
    )

    // sort files by name
    files.sort()

    // find the first file which is not a directory
    let binaryFileName: string | undefined = undefined
    let binaryFileSize: number | undefined = undefined

    for (const file of files) {
      if (file.endsWith(JanModelExtension._supportedModelFormat)) {
        const path = await joinPath([JanModelExtension._homeDir, dirName, file])
        const fileStats = await fs.fileStat(path)
        if (fileStats.isDirectory) continue
        binaryFileSize = fileStats.size
        binaryFileName = file
        break
      }
    }

    if (!binaryFileName) {
      console.warn(`Unable to find binary file for model ${dirName}`)
      return
    }

    const defaultModel = (await this.getDefaultModel()) as Model
    if (!defaultModel) {
      console.error('Unable to find default model')
      return
    }

    const model: Model = {
      ...defaultModel,
      // Overwrite default N/A fields
      id: dirName,
      name: dirName,
      sources: [
        {
          url: binaryFileName,
          filename: binaryFileName,
        },
      ],
      settings: {
        ...defaultModel.settings,
        llama_model_path: binaryFileName,
      },
      created: Date.now(),
      description: '',
      metadata: {
        size: binaryFileSize,
        author: 'User',
        tags: [],
      },
    }

    const modelFilePath = await joinPath([
      JanModelExtension._homeDir,
      dirName,
      JanModelExtension._modelMetadataFileName,
    ])

    await fs.writeFileSync(modelFilePath, JSON.stringify(model, null, 2))

    return model
  }

  private async getDefaultModel(): Promise<Model | undefined> {
    const defaultModelPath = await joinPath([
      JanModelExtension._homeDir,
      JanModelExtension._configDirName,
      JanModelExtension._defaultModelFileName,
    ])

    if (!(await fs.existsSync(defaultModelPath))) {
      return undefined
    }

    const model = await this.readModelMetadata(defaultModelPath)

    return typeof model === 'object' ? model : JSON.parse(model)
  }

  /**
   * Gets all available models.
   * @returns A Promise that resolves with an array of all models.
   */
  async getConfiguredModels(): Promise<Model[]> {
    return this.getModelsMetadata()
  }

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

  private async importModelSymlink(
    modelBinaryPath: string,
    modelFolderName: string,
    modelFolderPath: string
  ): Promise<Model> {
    const fileStats = await fs.fileStat(modelBinaryPath, true)
    const binaryFileSize = fileStats.size

    // Just need to generate model.json there
    const defaultModel = (await this.getDefaultModel()) as Model
    if (!defaultModel) {
      console.error('Unable to find default model')
      return
    }

    const binaryFileName = await baseName(modelBinaryPath)

    const model: Model = {
      ...defaultModel,
      id: modelFolderName,
      name: modelFolderName,
      sources: [
        {
          url: modelBinaryPath,
          filename: binaryFileName,
        },
      ],
      settings: {
        ...defaultModel.settings,
        llama_model_path: binaryFileName,
      },
      created: Date.now(),
      description: '',
      metadata: {
        size: binaryFileSize,
        author: 'User',
        tags: [],
      },
    }

    const modelFilePath = await joinPath([
      modelFolderPath,
      JanModelExtension._modelMetadataFileName,
    ])

    await fs.writeFileSync(modelFilePath, JSON.stringify(model, null, 2))

    return model
  }

  async updateModelInfo(modelInfo: Partial<Model>): Promise<Model> {
    const modelId = modelInfo.id
    if (modelInfo.id == null) throw new Error('Model ID is required')

    const janDataFolderPath = await getJanDataFolderPath()
    const jsonFilePath = await joinPath([
      janDataFolderPath,
      'models',
      modelId,
      JanModelExtension._modelMetadataFileName,
    ])
    const model = JSON.parse(
      await this.readModelMetadata(jsonFilePath)
    ) as Model

    const updatedModel: Model = {
      ...model,
      ...modelInfo,
      metadata: {
        ...model.metadata,
        tags: modelInfo.metadata?.tags ?? [],
      },
    }

    await fs.writeFileSync(jsonFilePath, JSON.stringify(updatedModel, null, 2))
    return updatedModel
  }

  private async importModel(
    model: ImportingModel,
    optionType: OptionType
  ): Promise<Model> {
    const binaryName = (await baseName(model.path)).replace(/\s/g, '')

    let modelFolderName = binaryName
    if (binaryName.endsWith(JanModelExtension._supportedModelFormat)) {
      modelFolderName = binaryName.replace(
        JanModelExtension._supportedModelFormat,
        ''
      )
    }

    const modelFolderPath = await this.getModelFolderName(modelFolderName)
    await fs.mkdirSync(modelFolderPath)

    const uniqueFolderName = await baseName(modelFolderPath)
    const modelBinaryFile = binaryName.endsWith(
      JanModelExtension._supportedModelFormat
    )
      ? binaryName
      : `${binaryName}${JanModelExtension._supportedModelFormat}`

    const binaryPath = await joinPath([modelFolderPath, modelBinaryFile])

    if (optionType === 'SYMLINK') {
      return this.importModelSymlink(
        model.path,
        uniqueFolderName,
        modelFolderPath
      )
    }

    const srcStat = await fs.fileStat(model.path, true)

    // interval getting the file size to calculate the percentage
    const interval = setInterval(async () => {
      const destStats = await fs.fileStat(binaryPath, true)
      const percentage = destStats.size / srcStat.size
      events.emit(LocalImportModelEvent.onLocalImportModelUpdate, {
        ...model,
        percentage,
      })
    }, 1000)

    await fs.copyFile(model.path, binaryPath)

    clearInterval(interval)

    // generate model json
    return this.generateModelMetadata(uniqueFolderName)
  }

  private async getModelFolderName(
    modelFolderName: string,
    count?: number
  ): Promise<string> {
    const newModelFolderName = count
      ? `${modelFolderName}-${count}`
      : modelFolderName

    const janDataFolderPath = await getJanDataFolderPath()
    const modelFolderPath = await joinPath([
      janDataFolderPath,
      'models',
      newModelFolderName,
    ])

    const isFolderExist = await fs.existsSync(modelFolderPath)
    if (!isFolderExist) {
      return modelFolderPath
    } else {
      const newCount = (count ?? 0) + 1
      return this.getModelFolderName(modelFolderName, newCount)
    }
  }

  async importModels(
    models: ImportingModel[],
    optionType: OptionType
  ): Promise<void> {
    const importedModels: Model[] = []

    for (const model of models) {
      events.emit(LocalImportModelEvent.onLocalImportModelUpdate, model)
      try {
        const importedModel = await this.importModel(model, optionType)
        events.emit(LocalImportModelEvent.onLocalImportModelSuccess, {
          ...model,
          modelId: importedModel.id,
        })
        importedModels.push(importedModel)
      } catch (err) {
        events.emit(LocalImportModelEvent.onLocalImportModelFailed, {
          ...model,
          error: err,
        })
      }
    }

    events.emit(
      LocalImportModelEvent.onLocalImportModelFinished,
      importedModels
    )
  }
}
