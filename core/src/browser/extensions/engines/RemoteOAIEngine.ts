import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Remote Inference Provider
 * Added the implementation of loading and unloading model (applicable to local inference providers)
 */
export abstract class RemoteOAIEngine extends OAIEngine {
  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    super.onLoad()
  }

  abstract getApiKey(): Promise<string>

  /**
   * Headers for the inference request
   */
  override async headers(): Promise<HeadersInit> {
    const apiKey = await this.getApiKey()
    return {
      'Authorization': `Bearer ${apiKey}`,
      'api-key': `${apiKey}`,
    }
  }
}
