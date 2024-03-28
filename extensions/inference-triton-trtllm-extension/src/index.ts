/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-nvidia-triton-trt-llm-extension/src/index
 */

import { RemoteOAIEngine } from '@janhq/core'

declare const SETTINGS: Array<any>
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceTritonTrtLLMExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'triton_trtllm'
  settingName = 'tritonllm-api-key'

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)

    // Retrieve API Key Setting
    this.apiKey = await this.getSetting<string>(this.settingName, '')
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === this.settingName) {
      this.apiKey = value as string
    }
  }
}
