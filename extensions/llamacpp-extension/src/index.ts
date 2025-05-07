/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module llamacpp-extension/src/index
 */

import { RemoteOAIEngine, getJanDataFolderPath, fs, ModelCapability, Model } from '@janhq/core'

export enum Settings {
  port = 'port',
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class LlamacppProvider extends RemoteOAIEngine {
  inferenceUrl: string = ''
  baseURL: string = ''
  provider: string = ENGINE

  override async onLoad(): Promise<void> {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)

    // register models
    const models = await this.listModels()
    this.registerModels(models)

    // NOTE: port 0 may mean request free port from OS. we may want
    // to take advantage of this. llama-server --port 0 on macOS works.
    const port = await this.getSetting<number>(Settings.port, 0)
    this.updateBaseUrl(port)
  }

  // onSettingUpdate<T>(key: string, value: T): void {
  //   if (key === Settings.apiKey) {
  //     this.apiKey = value as string
  //   } else if (key === Settings.baseUrl) {
  //     if (typeof value !== 'string') return
  //     this.updateBaseUrl(value)
  //   }
  // }

  updateBaseUrl(value: number): void {
    if (value == 0) {
      // set to default value
      SETTINGS.forEach((setting) => {
        if (setting.key === Settings.port) {
          value = setting.controllerProps.value as number
        }
      })
    }
    this.baseURL = `http://127.0.0.1:${value}`
    this.inferenceUrl = `${this.baseURL}/chat/completions`
  }

  async listModels(): Promise<Model[]> {
    let modelIds = []

    const modelsFolder = `${await getJanDataFolderPath()}/models`

    // cortexso models
    const cortexsoFolder = `${modelsFolder}/cortex.so`
    const modelDirs = await fs.readdirSync(cortexsoFolder)
    for (const modelDir of modelDirs) {
      const modelName = modelDir.split('/').pop()

      // TODO: try removing this check
      // skip files start with . e.g. .DS_store
      if (!modelName || modelName.startsWith('.')) continue

      const variantDirs = await fs.readdirSync(modelDir)
      for (const variantDir of variantDirs) {
        // NOTE: we can't detect unfinished download here
        const ggufPath = `${variantDir}/model.gguf`

        if (await fs.existsSync(ggufPath)) {
          const variantName = variantDir.split('/').pop()
          modelIds.push(`${modelName}/${variantName}`)
        }
      }
    }

    // TODO: list models under huggingface.co

    const models = modelIds.map((modelId) => {
      return {
        sources: [],
        object: 'model',
        version: '1.0',
        format: 'api',
        id: modelId,
        name: modelId,
        created: 0,
        description: '',
        settings: {},
        parameters: {},
        metadata: {
          author: '',
          tags: [],
          size: 0,
        },
        engine: this.provider,
        capabilities: [ModelCapability.completion],
      }
    })
    return models
  }
}
