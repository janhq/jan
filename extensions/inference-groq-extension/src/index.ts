/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-groq-extension/src/index
 */

import { RemoteOAIEngine } from '@janhq/core'

declare const SETTINGS: Array<any>
declare const MODELS: Array<any>

enum Settings {
  apiKey = 'groq-api-key',
  chatCompletionsEndPoint = 'chat-completions-endpoint',
}
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceGroqExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider = 'groq'

  override async onLoad(): Promise<void> {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)
    this.registerModels(MODELS)

    // Retrieve API Key Setting
    this.apiKey = await this.getSetting<string>(Settings.apiKey, '')
    this.inferenceUrl = await this.getSetting<string>(
      Settings.chatCompletionsEndPoint,
      ''
    )
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.apiKey) {
      this.apiKey = value as string
    } else if (key === Settings.chatCompletionsEndPoint) {
      this.inferenceUrl = value as string
    }
  }
}
