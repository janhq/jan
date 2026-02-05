/**
 * Base Auth Provider
 * Abstract base class that all providers should extend
 */

import { AuthProvider, AuthTokens } from './types'
import { getLoginUrl, handleOAuthCallback } from './api'

export abstract class BaseAuthProvider implements AuthProvider {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly icon: string

  abstract getLoginEndpoint(): string
  abstract getCallbackEndpoint(): string

  async initiateLogin(): Promise<void> {
    try {
      // Fetch login URL from API
      const data = await getLoginUrl(this.getLoginEndpoint())

      // Redirect to the OAuth URL provided by the API
      window.location.href = data.url
    } catch (error) {
      console.error(`Failed to initiate ${this.id} login:`, error)
      throw error
    }
  }

  async handleCallback(code: string, state?: string): Promise<AuthTokens> {
    try {
      // Handle OAuth callback and return token data
      return await handleOAuthCallback(this.getCallbackEndpoint(), code, state)
    } catch (error) {
      console.error(`${this.name} callback handling failed:`, error)
      throw error
    }
  }
}
