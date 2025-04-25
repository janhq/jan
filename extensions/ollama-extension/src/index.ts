import {
  InferenceEngine,
  LocalOAIEngine,
} from '@janhq/core'
import ollama from 'ollama/browser'

export default class OllamaExtension extends LocalOAIEngine {
  nodeModule: string = 'node'
  inferenceUrl: string = ''
  provider: string = 'ollama'

  async onLoad() {
    super.onLoad()
    this.registerSettings(SETTINGS)

    // TODO: should we have a prefix for model name, in case different
    // providers provide the same model? but when sending the request,
    // we should strip the prefix
    let models_resp = await ollama.list()
    this.registerModels(models_resp.models.map(obj => {
      return {
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
      }
    }))

    let port = await this.getSetting<number>('port', DEFAULT_PORT)
    this.updatePort(port)
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key == 'port' && typeof value == 'string')
      this.updatePort(Number(value) ?? DEFAULT_PORT)
  }

  private updatePort(port: number) {
    this.inferenceUrl = `http://127.0.0.1:${port}/v1/chat/completions`
  }
}
