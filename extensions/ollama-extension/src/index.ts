import { RemoteOAIEngine } from '@janhq/core'
import { Ollama } from 'ollama/browser'

export enum Settings {
  baseUrl = 'base-url',
}

export default class OllamaProvider extends RemoteOAIEngine {
  inferenceUrl: string = ''
  baseURL: string = ''
  provider: string = ENGINE

  // ollama client
  // NOTE: do we need Ollama client? we can just call the endpoints ourselves
  ollama: Ollama

  async onLoad() {
    super.onLoad()
    this.registerSettings(SETTINGS)

    let baseUrl = await this.getSetting<string>(Settings.baseUrl, '')
    this.updateBaseUrl(baseUrl)

    // TODO: should we have a prefix for model name, in case different
    // providers provide the same model? but when sending the request,
    // we should strip the prefix
    // TODO: handle when server is not available
    let models_to_register = []
    for (const obj of (await this.ollama.list()).models) {
      const model_info = await this.ollama.show({ model: obj.model })
      // const ctx_key = Object.keys(model_info.model_info).find(k => k.endsWith(".context_length"))

      models_to_register.push({
        sources: [],
        id: obj.model,
        model: obj.model,
        object: 'model',
        name: obj.name,
        version: '1.0',
        description: '',
        format: 'api',
        settings: {},
        parameters: {},
        created: 0,
        metadata: {
          author: '',
          tags: [],
          size: 0,
        },
        engine: this.provider,
        capabilities: model_info.capabilities,
      })
    }
    this.registerModels(models_to_register)
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key == Settings.baseUrl && typeof value == 'string')
      this.updateBaseUrl(value)
  }

  private updateBaseUrl(value: string) {
    if (value.trim().length == 0) {
      // set to default value
      SETTINGS.forEach((setting: any) => {
        if (setting.key === Settings.baseUrl) {
          value = setting.controllerProps.value as string
        }
      })
    }

    // should we just use ollama client for making requests?
    // this.inferenceUrl = `http://127.0.0.1:${port}/v1/chat/completions`
    this.baseURL = value
    this.inferenceUrl = `http://${value}/api/chat`
    this.ollama = new Ollama({ host: `http://${value}` })
  }

  // // transform OpenAI payload to Ollama payload
  // transformPayload = (payload: PayloadType): PayloadType => {
  //   // Jan sets messages, model, stream, tools, which are supported by Ollama API
  //   // TODO: add Ollama-specific params e.g. num_ctx, keep_alive
  //   return payload
  // }

  // extract message from Ollama response
  // TODO: do we need to handle non-streaming response?
  transformResponse = (response: string): string => {
    const data = JSON.parse(response)
    return data.message.content
  }
}
