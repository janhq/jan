import {
  ModelExtension,
  Model,
  InferenceEngine,
  joinPath,
  dirName,
  fs,
  OptionType,
  ModelSource,
  extractInferenceParams,
  extractModelLoadParams,
} from '@janhq/core'
import { scanModelsFolder } from './legacy/model-json'
import { deleteModelFiles } from './legacy/delete'
import PQueue from 'p-queue'
import ky from 'ky'

/**
 * cortex.cpp setting keys
 */
export enum Settings {
  huggingfaceToken = 'hugging-face-access-token',
}

/** Data List Response Type */
type Data<T> = {
  data: T[]
}

/**
 * A extension for models
 */
export default class JanModelExtension extends ModelExtension {
  queue = new PQueue({ concurrency: 1 })
  /**
   * Called when the extension is loaded.
   * @override
   */
  async onLoad() {
    this.queue.add(() => this.healthz())

    this.registerSettings(SETTINGS)

    // Configure huggingface token if available
    const huggingfaceToken = await this.getSetting<string>(
      Settings.huggingfaceToken,
      undefined
    )
    if (huggingfaceToken) {
      this.updateCortexConfig({ huggingface_token: huggingfaceToken })
    }

    // Sync with cortexsohub
    this.fetchCortexsoModels()
  }

  /**
   * Subscribe to settings update and make change accordingly
   * @param key
   * @param value
   */
  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.huggingfaceToken) {
      this.updateCortexConfig({ huggingface_token: value })
    }
  }

  /**
   * Called when the extension is unloaded.
   * @override
   */
  async onUnload() {}

  // BEGIN: - Public API
  /**
   * Downloads a machine learning model.
   * @param model - The model to download.
   * @returns A Promise that resolves when the model is downloaded.
   */
  async pullModel(model: string, id?: string, name?: string): Promise<void> {
    /**
     * Sending POST to /models/pull/{id} endpoint to pull the model
     */
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/pull`, { json: { model, id, name } })
        .json()
        .catch(async (e) => {
          throw (await e.response?.json()) ?? e
        })
        .then()
    )
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
    return this.queue.add(() =>
      ky
        .delete(`${API_URL}/v1/models/pull`, { json: { taskId: model } })
        .json()
        .then()
    )
  }

  /**
   * Deletes a pulled model
   * @param model - The model to delete
   * @returns A Promise that resolves when the model is deleted.
   */
  async deleteModel(model: string): Promise<void> {
    return this.queue
      .add(() => ky.delete(`${API_URL}/v1/models/${model}`).json().then())
      .catch((e) => console.debug(e))
      .finally(async () => {
        // Delete legacy model files
        await deleteModelFiles(model).catch((e) => console.debug(e))
      }) as Promise<void>
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
    var fetchedModels = await this.fetchModels().catch(() => [])

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
            model.sources?.[0]?.url.startsWith('http') ||
              !(await fs.existsSync(model.sources?.[0]?.url))
              ? await joinPath([
                  await dirName(model.file_path),
                  model.sources?.[0]?.filename ??
                    model.settings?.llama_model_path ??
                    model.sources?.[0]?.url.split('/').pop() ??
                    model.id,
                ]) // Copied models
              : model.sources?.[0]?.url, // Symlink models,
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
    return await this.fetchModels()
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
    return this.queue
      .add(() =>
        ky
          .patch(`${API_URL}/v1/models/${model.id}`, { json: { ...model } })
          .json()
          .then()
      )
      .then(() => this.getModel(model.id))
  }

  /**
   * Get a model by its ID
   * @param model - The ID of the model
   */
  async getModel(model: string): Promise<Model> {
    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/models/${model}`)
        .json()
        .then((e) => this.transformModel(e))
    ) as Promise<Model>
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
    return this.queue.add(() =>
      ky
        .post(`${API_URL}/v1/models/import`, {
          json: { model, modelPath, name, option },
        })
        .json()
        .catch((e) => console.debug(e)) // Ignore error
        .then()
    )
  }

  // BEGIN - Model Sources
  /**
   * Get model sources
   * @param model
   */
  async getSources(): Promise<ModelSource[]> {
    const sources = await this.queue
      .add(() => ky.get(`${API_URL}/v1/models/sources`).json<Data<ModelSource>>())
      .then((e) => (typeof e === 'object' ? (e.data as ModelSource[]) : []))
      .catch(() => [])
    return sources.concat(
      DEFAULT_MODEL_SOURCES.filter((e) => !sources.some((x) => x.id === e.id))
    )
  }

  /**
   * Add a model source
   * @param model
   */
  async addSource(source: string): Promise<any> {
    return this.queue.add(() =>
      ky.post(`${API_URL}/v1/models/sources`, {
        json: {
          source,
        },
      })
    )
  }

  /**
   * Delete a model source
   * @param model
   */
  async deleteSource(source: string): Promise<any> {
    return this.queue.add(() =>
      ky.delete(`${API_URL}/v1/models/sources`, {
        json: {
          source,
        },
      })
    )
  }
  // END - Model Sources

  /**
   * Check model status
   * @param model
   */
  async isModelLoaded(model: string): Promise<boolean> {
    return this.queue
      .add(() => ky.get(`${API_URL}/v1/models/status/${model}`))
      .then((e) => true)
      .catch(() => false)
  }

  /**
   * Configure pull options such as proxy, headers, etc.
   */
  async configurePullOptions(options: { [key: string]: any }): Promise<any> {
    return this.updateCortexConfig(options).catch((e) => console.debug(e))
  }

   /**
   * Fetches models list from cortex.cpp
   * @param model
   * @returns
   */
   async fetchModels(): Promise<Model[]> {
    return this.queue
      .add(() => ky.get(`${API_URL}/v1/models?limit=-1`).json<Data<Model>>())
      .then((e) =>
        typeof e === 'object' ? e.data.map((e) => this.transformModel(e)) : []
      )
  }
  // END: - Public API

  // BEGIN: - Private API

  /**
   * Transform model to the expected format (e.g. parameters, settings, metadata)
   * @param model
   * @returns
   */
  private transformModel(model: any) {
    model.parameters = {
      ...extractInferenceParams(model),
      ...model.parameters,
      ...model.inference_params,
    }
    model.settings = {
      ...extractModelLoadParams(model),
      ...model.settings,
    }
    model.metadata = model.metadata ?? {
      tags: [],
      size: model.size ?? model.metadata?.size ?? 0,
    }
    return model as Model
  }

  /**
   * Update cortex config
   * @param body
   */
  private async updateCortexConfig(body: {
    [key: string]: any
  }): Promise<void> {
    return this.queue
      .add(() =>
        ky.patch(`${API_URL}/v1/configs`, { json: body }).then(() => {})
      )
      .catch((e) => console.debug(e))
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  private healthz(): Promise<void> {
    return ky
      .get(`${API_URL}/healthz`, {
        retry: {
          limit: 20,
          delay: () => 500,
          methods: ['get'],
        },
      })
      .then(() => {
        this.queue.concurrency = Infinity
      })
  }

  /**
   * Fetch models from cortex.so
   */
  private fetchCortexsoModels = async () => {
    const models = await this.fetchModels()

    return this.queue.add(() =>
      ky
        .get(`${API_URL}/v1/models/hub?author=cortexso&tag=cortex.cpp`)
        .json<Data<string>>()
        .then((e) => {
          e.data?.forEach((model) => {
            if (
              !models.some((e) => 'modelSource' in e && e.modelSource === model)
            )
              this.addSource(model).catch((e) => console.debug(e))
          })
        })
        .catch((e) => console.debug(e))
    )
  }
  // END: - Private API
}
