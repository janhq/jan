/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-nvidia-triton-trt-llm-extension/src/index
 */

import { RemoteOAIEngine } from '@janhq/core'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceTritonTrtLLMExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'triton_trtllm'

  _engineSettings: {
    base_url: ''
    api_key: ''
  }

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    super.onLoad()

    this.registerSettings([
      {
        key: 'tritonllm-api-key',
        title: 'Triton LLM API Key',
        description: 'Triton LLM API Key',
        controllerType: 'input',
        controllerProps: {
          placeholder: 'API Key',
          value: '',
        },
      },
    ])
  }

  override async getApiKey(): Promise<string> {
    const settings = await this.getSettings()
    const keySetting = settings.find(
      (setting) => setting.key === 'tritonllm-api-key'
    )

    const apiKey = keySetting?.controllerProps.value
    if (typeof apiKey === 'string') return apiKey
    return ''
  }
}
