import {
  ExtensionType,
  fs,
  downloadFile,
  abortDownload,
  getResourcePath,
  getUserSpace,
  InferenceEngine,
  joinPath,
} from '@janhq/core'
import { basename } from 'path'
import { ModelExtension, Model } from '@janhq/core'

/**
 * A extension for models
 */
export default class JanModelExtension implements ModelExtension {
  private static readonly _homeDir = 'models'
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
  onLoad(): void {
    this.copyModelsToHomeDir()
  }

  /**
   * Called when the extension is unloaded.
   * @override
   */
  onUnload(): void {}

  private async copyModelsToHomeDir() {
    try {
      if (
        localStorage.getItem(`${EXTENSION_NAME}-version`) === VERSION &&
        (await fs.exists(JanModelExtension._homeDir))
      ) {
        console.debug('Model already migrated')
        return
      }

      // Get available models
      const readyModels = (await this.getDownloadedModels()).map((e) => e.id)

      // copy models folder from resources to home directory
      const resourePath = await getResourcePath()
      const srcPath = await joinPath([resourePath, 'models'])

      const userSpace = await getUserSpace()
      const destPath = await joinPath([userSpace, JanModelExtension._homeDir])

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
    await fs.mkdir(modelDirPath)

    // try to retrieve the download file name from the source url
    // if it fails, use the model ID as the file name
    const extractedFileName = basename(model.source_url)
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
    ).then(async () =>
      fs.deleteFile(
        await joinPath([JanModelExtension._homeDir, modelId, modelId])
      )
    )
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
      const files = await fs.listFiles(dirPath)
      const deletePromises = files.map(async (fileName: string) => {
        if (fileName !== JanModelExtension._modelMetadataFileName) {
          return fs.deleteFile(await joinPath([dirPath, fileName]))
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
      await fs.writeFile(jsonFilePath, JSON.stringify(model, null, 2))
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
          .listFiles(await joinPath([JanModelExtension._homeDir, modelDir]))
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
      const filesUnderJanRoot = await fs.listFiles('')
      if (!filesUnderJanRoot.includes(JanModelExtension._homeDir)) {
        console.debug('model folder not found')
        return []
      }

      const files: string[] = await fs.listFiles(JanModelExtension._homeDir)

      const allDirectories: string[] = []
      for (const file of files) {
        const isDirectory = await fs.isDirectory(
          await joinPath([JanModelExtension._homeDir, file])
        )
        if (isDirectory) {
          allDirectories.push(file)
        }
      }

      const readJsonPromises = allDirectories.map(async (dirName) => {
        // filter out directories that don't match the selector

        // read model.json
        const jsonPath = await joinPath([
          JanModelExtension._homeDir,
          dirName,
          JanModelExtension._modelMetadataFileName,
        ])
        let model = await this.readModelMetadata(jsonPath)
        model = typeof model === 'object' ? model : JSON.parse(model)

        if (selector && !(await selector?.(dirName, model))) {
          return
        }
        return model
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
    return fs.readFile(path)
  }

  /**
   * Gets all available models.
   * @returns A Promise that resolves with an array of all models.
   */
  async getConfiguredModels(): Promise<Model[]> {
    return this.getModelsMetadata()
  }
}
