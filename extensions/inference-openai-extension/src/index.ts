/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-openai-extension/src/index
 */

import { ModelRuntimeParams, PayloadType, RemoteOAIEngine } from '@janhq/core'

declare const SETTINGS: Array<any>
declare const MODELS: Array<any>

export enum Settings {
  apiKey = 'openai-api-key',
  chatCompletionsEndPoint = 'chat-completions-endpoint',
}
type OpenAIPayloadType = PayloadType &
  ModelRuntimeParams & { max_completion_tokens: number }
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceOpenAIExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'openai'
  previewModels = ['o1-mini', 'o1-preview']

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
    if (this.inferenceUrl.length === 0) {
      SETTINGS.forEach((setting) => {
        if (setting.key === Settings.chatCompletionsEndPoint) {
          this.inferenceUrl = setting.controllerProps.value as string
        }
      })
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
    }
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
    // Pass through for non-preview models
    return payload
  }
}
