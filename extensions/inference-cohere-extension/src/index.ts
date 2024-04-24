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
  apiKey = 'cohere-api-key',
  chatCompletionsEndPoint = 'chat-completions-endpoint',
}
enum RoleType {
  user="USER",
  chatbot="CHATBOT"
}
type CoherePayloadType = {
  chat_history?: Array<{role:RoleType,message:string}>,
  message?: string,
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceCohereExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'cohere'

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

  transformPayload(payload:PayloadType): CoherePayloadType {
    if (payload.messages.length===0){
      return {}
    }
    const convertedData = {
      chat_history: [],
      message: ""
    };
    payload.messages.forEach((item, index) => {
      // Assign the message of the last item to the `message` property
      if (index === payload.messages.length - 1) {
        convertedData.message = item.content as string;
        return;
      }
      if (item.role === "user") {
        convertedData.chat_history.push({ role: "USER", message: item.content });
      } else if (item.role === "system") {
        convertedData.chat_history.push({ role: "CHATBOT", message: item.content });
      }
    });
    return convertedData;
  }

  transformResponse = (data:any)=> data.text
}
