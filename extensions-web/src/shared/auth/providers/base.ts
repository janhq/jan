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
      // Construct the frontend callback URL
      const currentOrigin = window.location.origin
      const frontendCallbackUrl = `${currentOrigin}/auth/${this.id}/callback`
      
      // Fetch login URL from API with frontend callback URL as redirect destination
      const data = await getLoginUrl(this.getLoginEndpoint(), frontendCallbackUrl)
      console.log(data)

      // Redirect to the OAuth URL provided by the API
      // Support both formats: authorization_url (Keycloak) and url (generic)
      const redirectUrl = data.authorization_url || data.url
      if (!redirectUrl) {
        throw new Error('No authorization URL received from server')
      }
      
      window.location.href = redirectUrl
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
