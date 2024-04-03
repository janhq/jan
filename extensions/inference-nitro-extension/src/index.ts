/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-extension/src/index
 */

import {
  events,
  executeOnMain,
  Model,
  ModelEvent,
  LocalOAIEngine,
} from '@janhq/core'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceNitroExtension extends LocalOAIEngine {
  nodeModule: string = NODE
  provider: string = 'nitro'

  /**
   * Checking the health for Nitro's process each 5 secs.
   */
  private static readonly _intervalHealthCheck = 5 * 1000

  /**
   * The interval id for the health check. Used to stop the health check.
   */
  private getNitroProcesHealthIntervalId: NodeJS.Timeout | undefined = undefined

  /**
   * Tracking the current state of nitro process.
   */
  private nitroProcessInfo: any = undefined

  /**
   * The URL for making inference requests.
   */
  inferenceUrl = ''

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    this.inferenceUrl = INFERENCE_URL

    // If the extension is running in the browser, use the base API URL from the core package.
    if (!('electronAPI' in window)) {
      this.inferenceUrl = `${window.core?.api?.baseApiUrl}/v1/chat/completions`
    }

    this.getNitroProcesHealthIntervalId = setInterval(
      () => this.periodicallyGetNitroHealth(),
      JanInferenceNitroExtension._intervalHealthCheck
    )

    super.onLoad()
  }

  /**
   * Periodically check for nitro process's health.
   */
  private async periodicallyGetNitroHealth(): Promise<void> {
    const health = await executeOnMain(NODE, 'getCurrentNitroProcessInfo')

    const isRunning = this.nitroProcessInfo?.isRunning ?? false
    if (isRunning && health.isRunning === false) {
      console.debug('Nitro process is stopped')
      events.emit(ModelEvent.OnModelStopped, {})
    }
    this.nitroProcessInfo = health
  }

  override loadModel(model: Model): Promise<void> {
    if (model.engine !== this.provider) return Promise.resolve()
    this.getNitroProcesHealthIntervalId = setInterval(
      () => this.periodicallyGetNitroHealth(),
      JanInferenceNitroExtension._intervalHealthCheck
    )
    return super.loadModel(model)
  }

  override async unloadModel(model?: Model) {
    if (model?.engine && model.engine !== this.provider) return

    // stop the periocally health check
    if (this.getNitroProcesHealthIntervalId) {
      clearInterval(this.getNitroProcesHealthIntervalId)
      this.getNitroProcesHealthIntervalId = undefined
    }
    return super.unloadModel(model)
  }
}
