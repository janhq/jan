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

export enum Settings {
  apiKey = 'anthropic-api-key',
  chatCompletionsEndPoint = 'chat-completions-endpoint',
}

type AnthropicPayloadType = {
  stream: boolean
  model?: string
  max_tokens?: number
  messages?: Array<{ role: string; content: string }>
  system?: string
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
      return {
        max_tokens: this.maxTokens,
        messages: [],
        model: payload.model,
        stream: payload.stream,
      }
    }

    const convertedData: AnthropicPayloadType = {
      max_tokens: this.maxTokens,
      messages: [],
      model: payload.model,
      stream: payload.stream,
    }

    payload.messages.forEach((item) => {
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
      } else if (item.role === ChatCompletionRole.System) {
        // When using Claude, you can dramatically improve its performance by using the system parameter to give it a role. 
        // This technique, known as role prompting, is the most powerful way to use system prompts with Claude.
        convertedData.system = item.content as string
      }
    })

    return convertedData
  }

  // Sample returned stream data from anthropic
  // {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}         }
  // {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}              }
  // {"type":"content_block_stop","index":0        }
  // {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":12}   }

  // Override the transformResponse method to convert the response to the required format
  transformResponse = (data: any): string => {
    // handling stream response
    if (typeof data === 'string' && data.trim().length === 0) return ''
    if (typeof data === 'string' && data.startsWith('event: ')) return ''
    if (typeof data === 'string' && data.startsWith('data: ')) {
      data = data.replace('data: ', '')
      const parsedData = JSON.parse(data)
      if (parsedData.type !== 'content_block_delta') return ''
      return parsedData.delta?.text ?? ''
    }

    // non stream response
    if (data.content && data.content.length > 0 && data.content[0].text) {
      return data.content[0].text
    }

    console.error('Invalid response format:', data)
    return ''
  }
}
