/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module groq-extension/src/index
 */

import { RemoteOAIEngine } from '@janhq/core'

export enum Settings {
  apiKey = 'api-key',
  baseUrl = 'base-url',
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class GroqProvider extends RemoteOAIEngine {
  inferenceUrl: string = ''
  baseURL: string = ''
  provider: string = ENGINE

  override async onLoad(): Promise<void> {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)

    // register models
    const models = DEFAULT_MODELS.map((model) => {
      return {
        sources: [],
        object: 'model',
        version: model.version,
        format: 'api',  // check
        id: model.model,
        name: model.name,
        created: 0,
        description: model.description,
        settings: {},
        parameters: {},
        metadata: {
          author: '',
          tags: [],
          size: 0,
        },
        engine: this.provider,
        capabilities: model.capabilities,
      }
    })
    this.registerModels(models)

    this.apiKey = await this.getSetting<string>(Settings.apiKey, '')
    const baseUrl = await this.getSetting<string>(Settings.baseUrl, '')
    this.updateBaseUrl(baseUrl)
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.apiKey) {
      this.apiKey = value as string
    } else if (key === Settings.baseUrl) {
      if (typeof value !== 'string') return
      this.updateBaseUrl(value)
    }
  }

  updateBaseUrl(value: string): void {
    if (value.trim().length == 0) {
      // set to default value
      SETTINGS.forEach((setting) => {
        if (setting.key === Settings.baseUrl) {
          this.baseURL = setting.controllerProps.value as string
        }
      })
    } else {
      this.baseURL = value
    }

    this.inferenceUrl = `${this.baseURL}/chat/completions`
  }

  transformPayload = (payload: any): any => {
    delete payload.engine  // won't be needed once we remove cortex
    return payload
  }
}
