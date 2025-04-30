import { OAIEngine } from './OAIEngine'
import { OpenAI } from 'openai'

/**
 * Base OAI Remote Inference Provider
 * Added the implementation of loading and unloading model (applicable to local inference providers)
 */
export abstract class RemoteOAIEngine extends OAIEngine {
  baseURL?: string
  apiKey?: string
  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    super.onLoad()
  }

  /**
   * Headers for the inference request
   */
  override async headers(): Promise<HeadersInit> {
    return {
      ...(this.apiKey && {
        'Authorization': `Bearer ${this.apiKey}`,
        // 'api-key': `${this.apiKey}`,  // only Anthropic uses this header?
      }),
    }
  }

  getOpenAIClient(): OpenAI {
    return new OpenAI({
      apiKey: this.apiKey ?? '',
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
          'User-Agent': navigator.userAgent,
          // set these to null so OpenAI SDK doesn't set these headers.
          // Google Gemini and Mistral servers will give errors if these
          // headers are set.
          'x-stainless-arch': null,
          'x-stainless-lang': null,
          'x-stainless-os': null,
          'x-stainless-package-version': null,
          'x-stainless-retry-count': null,
          'x-stainless-runtime': null,
          'x-stainless-runtime-version': null,
          'x-stainless-timeout': null,
      },
    })
  }
}
