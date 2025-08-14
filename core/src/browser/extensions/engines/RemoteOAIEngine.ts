import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Remote Inference Provider
 * 
 * Abstract class that extends OAIEngine to provide functionality for remote inference providers.
 * Handles API key authentication and header configuration for remote API calls.
 */
export abstract class RemoteOAIEngine extends OAIEngine {
  /**
   * Optional API key for authenticating with the remote inference provider.
   * When provided, it will be included in request headers for authorization.
   */
  apiKey?: string

  /**
   * Initializes the remote OAI engine by calling the parent onLoad method.
   * Sets up event subscriptions and prepares the engine for operation.
   */
  override onLoad() {
    super.onLoad()
  }

  /**
   * Generates HTTP headers for inference requests to the remote provider.
   * Includes authorization headers when an API key is configured.
   * 
   * @returns Promise that resolves to an object containing HTTP headers
   */
  override async headers(): Promise<HeadersInit> {
    return {
      ...(this.apiKey && {
        'Authorization': `Bearer ${this.apiKey}`,
        'api-key': `${this.apiKey}`,
      }),
    }
  }
}
