/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import { Model, LocalOAIEngine } from '@janhq/core'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceCortexExtension extends LocalOAIEngine {
  nodeModule: string = NODE
  provider: string = 'cortex'
  /**
   * The URL for making inference requests.
   */
  inferenceUrl = ''

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    this.inferenceUrl = INFERENCE_URL

    const models = MODELS as unknown as Model[]
    this.registerModels(models)
    super.onLoad()
  }

  override loadModel(model: Model): Promise<void> {
    if (model.engine !== this.provider) return Promise.resolve()

    return super.loadModel(model)
  }

  override async unloadModel(model?: Model): Promise<void> {
    if (model?.engine && model.engine !== this.provider) return

    return super.unloadModel(model)
  }
}
