/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import {
  Model,
  executeOnMain,
  systemInformation,
  log,
  joinPath,
  dirName,
  LocalOAIEngine,
  InferenceEngine,
} from '@janhq/core'
import PQueue from 'p-queue'
import ky from 'ky'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceCortexExtension extends LocalOAIEngine {
  // DEPRECATED
  nodeModule: string = 'node'

  queue = new PQueue({ concurrency: 1 })

  provider: string = InferenceEngine.cortex

  /**
   * The URL for making inference requests.
   */
  inferenceUrl = `${CORTEX_API_URL}/v1/chat/completions`

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    const models = MODELS as Model[]

    this.registerModels(models)

    super.onLoad()

    // Run the process watchdog
    const systemInfo = await systemInformation()
    await executeOnMain(NODE, 'run', systemInfo)

    this.queue.add(() => this.healthz())
  }

  onUnload(): void {
    executeOnMain(NODE, 'dispose')
    super.onUnload()
  }

  override async loadModel(
    model: Model & { file_path?: string }
  ): Promise<void> {
    // Legacy model cache - should import
    if (model.engine === InferenceEngine.nitro && model.file_path) {
      // Try importing the model
      const modelPath = await this.modelPath(model)
      await this.queue.add(() =>
        ky
          .post(`${CORTEX_API_URL}/v1/models/${model.id}`, {
            json: { model: model.id, modelPath: modelPath },
          })
          .json()
          .catch((e) => log(e.message ?? e ?? ''))
      )
    }

    return await ky
      .post(`${CORTEX_API_URL}/v1/models/start`, {
        json: {
          ...model.settings,
          model: model.id,
          engine:
            model.engine === InferenceEngine.nitro // Legacy model cache
              ? InferenceEngine.cortex_llamacpp
              : model.engine,
        },
      })
      .json()
      .catch(async (e) => {
        throw (await e.response?.json()) ?? e
      })
      .then()
  }

  override async unloadModel(model: Model): Promise<void> {
    return ky
      .post(`${CORTEX_API_URL}/v1/models/stop`, {
        json: { model: model.id },
      })
      .json()
      .then()
  }

  private async modelPath(
    model: Model & { file_path?: string }
  ): Promise<string> {
    if (!model.file_path) return model.id
    return await joinPath([
      await dirName(model.file_path),
      model.sources[0]?.filename ??
        model.settings?.llama_model_path ??
        model.sources[0]?.url.split('/').pop() ??
        model.id,
    ])
  }

  /**
   * Do health check on cortex.cpp
   * @returns
   */
  healthz(): Promise<void> {
    return ky
      .get(`${CORTEX_API_URL}/healthz`, {
        retry: {
          limit: 10,
          methods: ['get'],
        },
      })
      .then(() => {})
  }
}
