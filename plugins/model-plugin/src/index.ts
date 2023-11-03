import { PluginType, fs, downloadFile } from "@janhq/core";
import { ModelPlugin } from "@janhq/core/lib/plugins";
import { Model, ModelCatalog } from "@janhq/core/lib/types";
import { pollDownloadProgress } from "./helpers/cloudNative";
import { parseToModel } from "./helpers/modelParser";

/**
 * A plugin for managing machine learning models.
 */
export default class JanModelPlugin implements ModelPlugin {
  /**
   * Implements type from JanPlugin.
   * @override
   * @returns The type of the plugin.
   */
  type(): PluginType {
    return PluginType.Model;
  }

  /**
   * Called when the plugin is loaded.
   * @override
   */
  onLoad(): void {
    /**  Cloud Native
     * TODO: Fetch all downloading progresses?
     **/
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
    await fs.mkdir("models");
    downloadFile(model.downloadLink, `models/${model._id}`);
    /**  Cloud Native
     * MARK: Poll Downloading Progress
     **/
    pollDownloadProgress(model._id);
  }

  /**
   * Deletes a machine learning model.
   * @param filePath - The path to the model file to delete.
   * @returns A Promise that resolves when the model is deleted.
   */
  deleteModel(filePath: string): Promise<void> {
    return fs
      .deleteFile(`models/${filePath}`)
      .then(() => fs.deleteFile(`models/m-${filePath}.json`));
  }

  /**
   * Saves a machine learning model.
   * @param model - The model to save.
   * @returns A Promise that resolves when the model is saved.
   */
  async saveModel(model: Model): Promise<void> {
    await fs.writeFile(`models/m-${model._id}.json`, JSON.stringify(model));
  }

  /**
   * Gets all downloaded models.
   * @returns A Promise that resolves with an array of all models.
   */
  getDownloadedModels(): Promise<Model[]> {
    return fs
      .listFiles("models")
      .then((files: string[]) => {
        return Promise.all(
          files
            .filter((file) => /^m-.*\.json$/.test(file))
            .map(async (file) => {
              const model: Model = JSON.parse(
                await fs.readFile(`models/${file}`)
              );
              return model;
            })
        );
      })
      .catch((e) => fs.mkdir("models").then(() => []));
  }
  /**
   * Gets all available models.
   * @returns A Promise that resolves with an array of all models.
   */
  getConfiguredModels(): Promise<ModelCatalog[]> {
    // Add a timestamp to the URL to prevent caching
    return import(
      /* webpackIgnore: true */ MODEL_CATALOG_URL + `?t=${Date.now()}`
    ).then((module) =>
      module.default.map((e) => {
        return parseToModel(e);
      })
    );
  }
}
