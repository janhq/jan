/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-groq-extension/src/index
 */

import { RemoteOAIEngine } from '@janhq/core'

declare const COMPLETION_URL: string
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceGroqExtension extends RemoteOAIEngine {
  inferenceUrl: string = COMPLETION_URL
  provider = 'groq'

  override async onLoad(): Promise<void> {
    super.onLoad()

    this.registerSettings([
      {
        key: 'groq-api-key',
        title: 'API Key',
        description: 'Groq API Key',
        controllerType: 'input',
        controllerProps: {
          placeholder: 'API Key',
          value: '',
        }
      },
    ])
  }

  override async getApiKey(): Promise<string> {
    const settings = await this.getSettings()
    const keySetting = settings.find(
      (setting) => setting.key === 'groq-api-key'
    )

    const apiKey = keySetting?.controllerProps.value
    if (typeof apiKey === 'string') return apiKey
    return ''
  }
}
