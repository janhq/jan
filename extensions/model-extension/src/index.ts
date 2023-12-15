import {
  ExtensionType,
  fs,
  downloadFile,
  abortDownload,
  getResourcePath,
  getUserSpace,
} from '@janhq/core'
import { ModelExtension, Model, ModelState } from '@janhq/core'
import { join } from 'path'

/**
 * A extension for models
 */
export default class JanModelExtension implements ModelExtension {
  private static readonly _homeDir = 'models'
  private static readonly _modelMetadataFileName = 'model.json'

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
      if (localStorage.getItem(`${EXTENSION_NAME}-version`) === VERSION) {
        console.debug('Model already migrated')
        return
      }

      // Get available models
      const readyModels = (await this.getDownloadedModels()).map((e) => e.id)

      // copy models folder from resources to home directory
      const resourePath = await getResourcePath()
      const srcPath = join(resourePath, 'models')

      const userSpace = await getUserSpace()
      const destPath = join(userSpace, JanModelExtension._homeDir)

      await fs.syncFile(srcPath, destPath)

      console.debug('Finished syncing models')

      const reconfigureModels = (await this.getConfiguredModels()).filter((e) =>
        readyModels.includes(e.id)
      )
      console.debug(
        'Finished updating downloaded models'
      )

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
    const directoryPath = join(JanModelExtension._homeDir, model.id)
    await fs.mkdir(directoryPath)

    // path to model binary
    const path = join(directoryPath, model.id)
    downloadFile(model.source_url, path)
  }

  /**
   * Cancels the download of a specific machine learning model.
   * @param {string} modelId - The ID of the model whose download is to be cancelled.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  async cancelModelDownload(modelId: string): Promise<void> {
    return abortDownload(
      join(JanModelExtension._homeDir, modelId, modelId)
    ).then(() => {
      fs.deleteFile(join(JanModelExtension._homeDir, modelId, modelId))
    })
  }

  /**
   * Deletes a machine learning model.
   * @param filePath - The path to the model file to delete.
   * @returns A Promise that resolves when the model is deleted.
   */
  async deleteModel(modelId: string): Promise<void> {
    try {
      const dirPath = join(JanModelExtension._homeDir, modelId)

      // remove all files under dirPath except model.json
      const files = await fs.listFiles(dirPath)
      const deletePromises = files.map((fileName: string) => {
        if (fileName !== JanModelExtension._modelMetadataFileName) {
          return fs.deleteFile(join(dirPath, fileName))
        }
      })
      await Promise.allSettled(deletePromises)

      // update the state as default
      const jsonFilePath = join(
        dirPath,
        JanModelExtension._modelMetadataFileName
      )
      const json = await fs.readFile(jsonFilePath)
      const model = JSON.parse(json) as Model
      delete model.state

      await fs.writeFile(jsonFilePath, JSON.stringify(model, null, 2))
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
    const jsonFilePath = join(
      JanModelExtension._homeDir,
      model.id,
      JanModelExtension._modelMetadataFileName
    )

    try {
      await fs.writeFile(
        jsonFilePath,
        JSON.stringify(
          {
            ...model,
            state: ModelState.Ready,
          },
          null,
          2
        )
      )
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Gets all downloaded models.
   * @returns A Promise that resolves with an array of all models.
   */
  async getDownloadedModels(): Promise<Model[]> {
    const models = await this.getModelsMetadata()
    return models.filter((model) => model.state === ModelState.Ready)
  }

  private async getModelsMetadata(): Promise<Model[]> {
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
          join(JanModelExtension._homeDir, file)
        )
        if (isDirectory) {
          allDirectories.push(file)
        }
      }

      const readJsonPromises = allDirectories.map((dirName) => {
        const jsonPath = join(
          JanModelExtension._homeDir,
          dirName,
          JanModelExtension._modelMetadataFileName
        )
        return this.readModelMetadata(jsonPath)
      })
      const results = await Promise.allSettled(readJsonPromises)
      const modelData = results.map((result) => {
        if (result.status === 'fulfilled') {
          try {
            return JSON.parse(result.value) as Model
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
    return fs.readFile(join(path))
  }

  /**
   * Gets all available models.
   * @returns A Promise that resolves with an array of all models.
   */
  async getConfiguredModels(): Promise<Model[]> {
    return this.getModelsMetadata()
  }
}
