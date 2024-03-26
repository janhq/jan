/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-groq-extension/src/index
 */

import { RemoteOAIEngine, SettingComponentProps } from '@janhq/core'

declare const COMPLETION_URL: string
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceGroqExtension extends RemoteOAIEngine {
  inferenceUrl: string = COMPLETION_URL
  provider = 'groq'
  apiKey = ''

  override async onLoad() {
    await this.createDefaultSettingIfNotExist()
  }

  override extensionName(): string | undefined {
    return '@janhq/inference-groq-extension'
  }

  override async defaultSettings(): Promise<SettingComponentProps[]> {
    const defaultSettings: SettingComponentProps[] = [
      {
        key: 'groq-api-key',
        title: 'API Key',
        description: 'Groq API Key',
        controllerType: 'input',
        controllerProps: {
          placeholder: 'API Key',
          value: '',
        },
        extensionName: this.extensionName(),
      },
    ]

    return defaultSettings
  }
}
