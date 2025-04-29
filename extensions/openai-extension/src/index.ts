/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module openai-extension/src/index
 */

import {
  ModelRuntimeParams,
  PayloadType,
  RemoteOAIEngine,
} from '@janhq/core'

export enum Settings {
  apiKey = 'api-key',
  baseUrl = 'base-url',
}
type OpenAIPayloadType = PayloadType &
  ModelRuntimeParams & { max_completion_tokens: number }
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class OpenAIProvider extends RemoteOAIEngine {
  inferenceUrl: string = ''
  baseURL: string = ''
  provider: string = ENGINE
  previewModels = ['o1-mini', 'o1-preview']

  override async onLoad(): Promise<void> {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)

    // register models
    const models = DEFAULT_MODELS.map((model) => ({
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
    }))
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

  /**
   * Tranform the payload before sending it to the inference endpoint.
   * The new preview models such as o1-mini and o1-preview replaced max_tokens by max_completion_tokens parameter.
   * Others do not.
   * @param payload
   * @returns
   */
  transformPayload = (payload: OpenAIPayloadType): OpenAIPayloadType => {
    // Remove empty stop words
    if (payload.stop?.length === 0) {
      const { stop, ...params } = payload
      payload = params
    }
    // Transform the payload for preview models
    if (this.previewModels.includes(payload.model)) {
      const { max_tokens, stop, ...params } = payload
      return {
        ...params,
        max_completion_tokens: max_tokens,
      }
    }
    delete payload.engine  // won't be needed once we remove cortex
    // Pass through for non-preview models
    return payload
  }
}
