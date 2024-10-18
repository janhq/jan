/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-openai-extension/src/index
 */

import { RemoteOAIEngine } from '@janhq/core'
import { PayloadType } from '@janhq/core'

declare const SETTINGS: Array<any>
declare const MODELS: Array<any>

enum Settings {
  apiKey = 'featherless-api-key',
  model = 'featherless-model',
  chatCompletionsEndPoint = 'chat-completions-endpoint',
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceFeatherlessExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'Featherless'
  model?: string | undefined

  override async onLoad(): Promise<void> {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)
    this.registerModels(MODELS)

    this.apiKey = await this.getSetting<string>(Settings.apiKey, '')
    this.inferenceUrl = await this.getSetting<string>(
      Settings.chatCompletionsEndPoint,
      ''
    )
    this.model = await this.getSetting<string>(Settings.model, '')
   
    if (!this.model?.length) this.model = undefined
    if (this.inferenceUrl.length === 0) {
      SETTINGS.forEach((setting) => {
        if (setting.key === Settings.chatCompletionsEndPoint) {
          this.inferenceUrl = setting.controllerProps.value as string
        }
      })
    }
  }

  override async headers(): Promise<HeadersInit> {
    return {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jan.ai',
      'Authorization': `Bearer ${this.apiKey}`,
    }
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.apiKey) {
      this.apiKey = value as string
    } else if (key === Settings.chatCompletionsEndPoint) {
      if (typeof value !== 'string') return

      if (value.trim().length === 0) {
        SETTINGS.forEach((setting) => {
          if (setting.key === Settings.chatCompletionsEndPoint) {
            this.inferenceUrl = setting.controllerProps.value as string
          }
        })
      } else {
        this.inferenceUrl = value
      }
    } else if (key === Settings.model) {
      this.model =
        typeof value === 'string' && value.length > 0 ? value : undefined
    }
  }

  transformPayload = (payload: PayloadType) => ({
    ...payload,
    model: this.model,
  })
}
