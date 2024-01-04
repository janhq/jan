import {
  ExtensionType,
  fs,
  downloadFile,
  abortDownload,
  getResourcePath,
  getUserSpace,
  fileStat,
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
      // list all of the files under the home directory

      if (await fs.existsSync(JanModelExtension._homeDir)) {
        // ignore if the model is already downloaded
        console.debug('Models already persisted.')
        return
      }

      // Get available models
      const readyModels = (await this.getDownloadedModels()).map((e) => e.id)

      // copy models folder from resources to home directory
      const resourePath = await getResourcePath()
      const srcPath = await joinPath([resourePath, 'models'])

      const userSpace = await getUserSpace()
      const destPath = await joinPath([userSpace, 'models'])

      await fs.syncFile(srcPath, destPath)

      console.debug('Finished syncing models')

      const reconfigureModels = (await this.getConfiguredModels()).filter((e) =>
        readyModels.includes(e.id)
      )
      console.debug('Finished updating downloaded models')

      // update back the status
      await Promise.all(
        reconfigureModels.map(async (model) => this.saveModel(model))
      )

      // Finished migration

      localStorage.setItem(`${EXTENSION_NAME}-version`, VERSION)
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Downloads a machine learning model.
   * @param model - The model to download.
   * @returns A Promise that resolves when the model is downloaded.
   */
  async downloadModel(model: Model): Promise<void> {
    // create corresponding directory
    const modelDirPath = await joinPath([JanModelExtension._homeDir, model.id])
    if (!(await fs.existsSync(modelDirPath))) await fs.mkdirSync(modelDirPath)

    // try to retrieve the download file name from the source url
    // if it fails, use the model ID as the file name
    const extractedFileName = await model.source_url.split('/').pop()
    const fileName = extractedFileName
      .toLowerCase()
      .endsWith(JanModelExtension._supportedModelFormat)
      ? extractedFileName
      : model.id
    const path = await joinPath([modelDirPath, fileName])
    downloadFile(model.source_url, path)
  }

  /**
   * Cancels the download of a specific machine learning model.
   * @param {string} modelId - The ID of the model whose download is to be cancelled.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  async cancelModelDownload(modelId: string): Promise<void> {
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
    const downloadedModels = await this.getModelsMetadata(
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
    // TODO remove this
    console.log(`NamH downloaded models: ${JSON.stringify(downloadedModels)}`)
    return downloadedModels
  }

  private async getModelsMetadata(
    selector?: (path: string, model: Model) => Promise<boolean>
  ): Promise<Model[]> {
    try {
      if (!(await fs.existsSync(JanModelExtension._homeDir))) {
        console.error('Model folder not found')
        return []
      }

      const files: string[] = await fs.readdirSync(JanModelExtension._homeDir)

      const allDirectories: string[] = []
      for (const file of files) {
        if (file === '.DS_Store') continue
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
            return result.value as Model
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
      const fileStats = await fileStat(path)
      if (fileStats.isDirectory) continue
      binaryFileSize = fileStats.size
      binaryFileName = file
      break
    }

    if (!binaryFileName) {
      console.warn(`Unable to find binary file for model ${dirName}`)
      return
    }

    const model: Model = {
      object: 'model',
      version: 1,
      format: 'gguf',
      source_url: 'N/A',
      id: dirName,
      name: dirName,
      created: Date.now(),
      description: `${dirName} - user self import model`,
      settings: {
        ctx_len: 4096,
        ngl: 0,
        embedding: false,
        n_parallel: 0,
        cpu_threads: 0,
        prompt_template: '',
      },
      parameters: {
        temperature: 0,
        token_limit: 0,
        top_k: 0,
        top_p: 0,
        stream: false,
        max_tokens: 4096,
        stop: [],
        frequency_penalty: 0,
        presence_penalty: 0,
      },
      metadata: {
        author: 'User',
        tags: [],
        size: binaryFileSize,
      },
      engine: InferenceEngine.nitro,
    }
    const modelFilePath = await joinPath([
      JanModelExtension._homeDir,
      dirName,
      JanModelExtension._modelMetadataFileName,
    ])

    await fs.writeFileSync(modelFilePath, JSON.stringify(model, null, 2))

    return model
  }

  /**
   * Gets all available models.
   * @returns A Promise that resolves with an array of all models.
   */
  async getConfiguredModels(): Promise<Model[]> {
    return this.getModelsMetadata()
  }
}
