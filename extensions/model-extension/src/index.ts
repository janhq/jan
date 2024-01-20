import {
  ExtensionType,
  fs,
  downloadFile,
  abortDownload,
  getResourcePath,
  getUserSpace,
  InferenceEngine,
  joinPath,
  ModelExtension,
  Model,
} from '@janhq/core'

/**
 * A extension for models
 */
export default class JanModelExtension implements ModelExtension {
  private static readonly _homeDir = 'file://models'
  private static readonly _modelMetadataFileName = 'model.json'
  private static readonly _supportedModelFormat = '.gguf'
  private static readonly _incompletedModelFileName = '.download'
  private static readonly _offlineInferenceEngine = InferenceEngine.nitro

  private static readonly _configDirName = 'config'
  private static readonly _defaultModelFileName = 'default-model.json'

  /**
   * Implements type from JanExtension.
   * @override
   * @returns The type of the extension.
   */
  type(): ExtensionType {
    return ExtensionType.Model
  }

  /**
   * Called when the extension is loaded.
   * @override
   */
  async onLoad() {
    this.copyModelsToHomeDir()
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

      const userSpace = await getUserSpace()
      const destPath = await joinPath([userSpace, 'models'])

      await fs.syncFile(srcPath, destPath)

      console.debug('Finished syncing models')

      // Finished migration
      localStorage.setItem(`${EXTENSION_NAME}-version`, VERSION)
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
    const ignoreSSL = !network?.ignoreSSL
    const proxy = network?.proxy?.startsWith('http') ? network.proxy : undefined
    // create corresponding directory
    const modelDirPath = await joinPath([JanModelExtension._homeDir, model.id])
    if (!(await fs.existsSync(modelDirPath))) await fs.mkdirSync(modelDirPath)
    if (model.source.length > 1) {
      // path to model binaries
      for (const modelFile of model.source) {
        const path = await joinPath([modelDirPath, modelFile.filename])
        downloadFile(modelFile.url, path, { proxy, ignoreSSL })
      }
    } else {
      // try to retrieve the download file name from the source url
      // if it fails, use the model ID as the file name
      const extractedFileName = model.source[0]?.url.split('/').pop()
      const fileName = extractedFileName
        .toLowerCase()
        .endsWith(JanModelExtension._supportedModelFormat)
        ? extractedFileName
        : model.id
      const path = await joinPath([modelDirPath, fileName])
      downloadFile(model.source[0]?.url, path, { proxy, ignoreSSL })
    }
  }

  /**
   * Cancels the download of a specific machine learning model.
   * @param {string} modelId - The ID of the model whose download is to be cancelled.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  async cancelModelDownload(modelId: string): Promise<void> {
    const model = await this.getConfiguredModels()
    return abortDownload(
      await joinPath([JanModelExtension._homeDir, modelId, modelId])
    ).then(async () => {
      fs.unlinkSync(
        await joinPath([JanModelExtension._homeDir, modelId, modelId])
      )
    })
  }

  /**
   * Deletes a machine learning model.
   * @param filePath - The path to the model file to delete.
   * @returns A Promise that resolves when the model is deleted.
   */
  // TODO: Fix for cancel/ delete multiple model binaries
  async deleteModel(modelId: string): Promise<void> {
    try {
      const dirPath = await joinPath([JanModelExtension._homeDir, modelId])

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
        if (model.engine !== JanModelExtension._offlineInferenceEngine) {
          return true
        }
        return await fs
          .readdirSync(await joinPath([JanModelExtension._homeDir, modelDir]))
          .then((files: string[]) => {
            // or model binary exists in the directory
            // model binary name can match model ID or be a .gguf file and not be an incompleted model file
            return (
              files.includes(modelDir) ||
              files.some(
                (file) =>
                  file
                    .toLowerCase()
                    .includes(JanModelExtension._supportedModelFormat) &&
                  !file.endsWith(JanModelExtension._incompletedModelFileName)
              )
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
        if (result.status === 'fulfilled') {
          try {
            const tmpModel =
              typeof result.value === 'object'
                ? result.value
                : JSON.parse(result.value)
            if (tmpModel['source_url'] != null) {
              tmpModel['source'] = [
                {
                  filename: tmpModel.id,
                  url: tmpModel['source_url'],
                },
              ]
            }

            return tmpModel as Model
          } catch {
            console.debug(`Unable to parse model metadata: ${result.value}`)
            return undefined
          }
        } else {
          console.error(result.reason)
          return undefined
        }
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
      if (file.endsWith(JanModelExtension._incompletedModelFileName)) continue
      if (file.endsWith('.json')) continue

      const path = await joinPath([JanModelExtension._homeDir, dirName, file])
      const fileStats = await fs.fileStat(path)
      if (fileStats.isDirectory) continue
      binaryFileSize = fileStats.size
      binaryFileName = file
      break
    }

    if (!binaryFileName) {
      console.warn(`Unable to find binary file for model ${dirName}`)
      return
    }

    const defaultModel = await this.getDefaultModel()
    if (!defaultModel) {
      console.error('Unable to find default model')
      return
    }

    const model: Model = {
      ...defaultModel,
      id: dirName,
      name: dirName,
      created: Date.now(),
      description: `${dirName} - user self import model`,
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
}
