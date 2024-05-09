/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-anthropic-extension/src/index
 */

import { RemoteOAIEngine } from '@janhq/core'
import { PayloadType } from '@janhq/core'
import { ChatCompletionRole } from '@janhq/core'

declare const SETTINGS: Array<any>
declare const MODELS: Array<any>

enum Settings {
  apiKey = 'anthropic-api-key',
  chatCompletionsEndPoint = 'chat-completions-endpoint',
}

type AnthropicPayloadType = {
  model?: string
  max_tokens?: number
  messages?: Array<{ role: string; content: string }>
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceAnthropicExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'anthropic'
  maxTokens: number = 4096

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

  // Override the headers method to include the x-API-key in the request headers
  override async headers(): Promise<HeadersInit> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
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

  // Override the transformPayload method to convert the payload to the required format
  transformPayload = (payload: PayloadType): AnthropicPayloadType => {
    if (!payload.messages || payload.messages.length === 0) {
      return { max_tokens: this.maxTokens, messages: [], model: payload.model }
    }

    const convertedData: AnthropicPayloadType = {
      max_tokens: this.maxTokens,
      messages: [],
      model: payload.model,
    }

    payload.messages.forEach((item, index) => {
      if (item.role === ChatCompletionRole.User) {
        convertedData.messages.push({
          role: 'user',
          content: item.content as string,
        })
      } else if (item.role === ChatCompletionRole.Assistant) {
        convertedData.messages.push({
          role: 'assistant',
          content: item.content as string,
        })
      }
    })

    return convertedData
  }

  // Override the transformResponse method to convert the response to the required format
  transformResponse = (data: any): string => {
    if (data.content && data.content.length > 0 && data.content[0].text) {
      return data.content[0].text
    } else {
      console.error('Invalid response format:', data)
      return ''
    }
  }
}
