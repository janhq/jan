import { PluginType, fs, downloadFile } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model, ModelCatalog } from '@janhq/core/lib/types'
import { parseToModel } from './helpers/modelParser'
import { join } from 'path'

/**
 * A plugin for managing machine learning models.
 */
export default class JanModelPlugin implements ModelPlugin {
  private static readonly _homeDir = 'models'
  /**
   * Implements type from JanPlugin.
   * @override
   * @returns The type of the plugin.
   */
  type(): PluginType {
    return PluginType.Model
  }

  /**
   * Called when the plugin is loaded.
   * @override
   */
  onLoad(): void {
    /**  Cloud Native
     * TODO: Fetch all downloading progresses?
     **/
    fs.mkdir(JanModelPlugin._homeDir)
  }

  /**
   * Called when the plugin is unloaded.
   * @override
   */
  onUnload(): void {}

  /**
   * Downloads a machine learning model.
   * @param model - The model to download.
   * @returns A Promise that resolves when the model is downloaded.
   */
  async downloadModel(model: Model): Promise<void> {
    // create corresponding directory
    const directoryPath = join(JanModelPlugin._homeDir, model.productName)
    await fs.mkdir(directoryPath)

    // path to model binary
    const path = join(directoryPath, model.id)
    downloadFile(model.downloadLink, path)
  }

  /**
   * Deletes a machine learning model.
   * @param filePath - The path to the model file to delete.
   * @returns A Promise that resolves when the model is deleted.
   */
  async deleteModel(filePath: string): Promise<void> {
    try {
      await Promise.allSettled([
        fs.deleteFile(filePath),
        fs.deleteFile(`${filePath}.json`),
      ])
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
    const directoryPath = join(JanModelPlugin._homeDir, model.productName)
    const jsonFilePath = join(directoryPath, `${model.id}.json`)

    try {
      await fs.writeFile(jsonFilePath, JSON.stringify(model))
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Gets all downloaded models.
   * @returns A Promise that resolves with an array of all models.
   */
  async getDownloadedModels(): Promise<Model[]> {
    const results: Model[] = []
    const allDirs: string[] = await fs.listFiles(JanModelPlugin._homeDir)
    for (const dir of allDirs) {
      const modelDirPath = join(JanModelPlugin._homeDir, dir)
      if (!fs.isDirectory(modelDirPath)) {
        // if not a directory, ignore
        continue
      }

      const jsonFiles: string[] = (await fs.listFiles(modelDirPath)).filter(
        (file: string) => file.endsWith('.json')
      )

      for (const json of jsonFiles) {
        const model: Model = JSON.parse(
          await fs.readFile(join(modelDirPath, json))
        )
        results.push(model)
      }
    }

    return results
  }

  /**
   * Gets all available models.
   * @returns A Promise that resolves with an array of all models.
   */
  getConfiguredModels(): Promise<ModelCatalog[]> {
    // Add a timestamp to the URL to prevent caching
    return import(
      /* webpackIgnore: true */ MODEL_CATALOG_URL + `?t=${Date.now()}`
    ).then((module) => module.default.map((e) => parseToModel(e)))
  }
}
