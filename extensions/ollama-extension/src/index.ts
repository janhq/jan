import {
  InferenceEngine,
  RemoteOAIEngine,
  PayloadType,
} from '@janhq/core'
import { Ollama } from 'ollama/browser'

export default class OllamaExtension extends RemoteOAIEngine {
  nodeModule: string = 'node'
  inferenceUrl: string = ''
  provider: string = 'ollama'

  // ollama client
  // NOTE: do we need Ollama client? we can just call the endpoints ourselves
  ollama: Ollama
  models_info: Map<string, any> = new Map()

  async onLoad() {
    super.onLoad()
    this.registerSettings(SETTINGS)

    let port = await this.getSetting<number>('port', DEFAULT_PORT)
    this.updatePort(port)

    // TODO: should we have a prefix for model name, in case different
    // providers provide the same model? but when sending the request,
    // we should strip the prefix
    // TODO: handle when server is not available
    let models_to_register = []
    for (const obj of (await this.ollama.list()).models) {
      const model_info = await this.ollama.show({ model: obj.model })
      const ctx_key = Object.keys(model_info.model_info).find(k => k.endsWith(".context_length"))
      this.models_info.set(obj.model, {
        tools: model_info.capabilities.includes("tools"),
        max_ctx: model_info.model_info[ctx_key],
      })

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
        created: 1,
        metadata: {
          author: '',
          tags: [],
          size: 0,
        },
        engine: InferenceEngine.ollama,
      })
    }
    console.log("Ollama models", this.models_info)
    this.registerModels(models_to_register)
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key == 'port' && typeof value == 'string')
      this.updatePort(Number(value) ?? DEFAULT_PORT)
  }

  private updatePort(port: number) {
    // should we just use ollama client for making requests?
    // this.inferenceUrl = `http://127.0.0.1:${port}/v1/chat/completions`
    this.inferenceUrl = `http://127.0.0.1:${port}/api/chat`
    this.ollama = new Ollama({ host: `http://127.0.0.1:${port}` })
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
