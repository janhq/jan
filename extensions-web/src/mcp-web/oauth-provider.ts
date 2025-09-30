import { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { OAuthTokens, OAuthClientInformation, OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { JanAuthService } from '../shared/auth'

/**
 * MCP OAuth provider that integrates with Jan Auth Service
 * Just provides tokens, no storage or validation needed
 */
export class JanMCPOAuthProvider implements OAuthClientProvider {
  private authService: JanAuthService

  constructor(authService: JanAuthService) {
    this.authService = authService
  }

  get redirectUrl(): string {
    return ''
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [] // Not used, but required by interface
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return undefined
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    try {
      const accessToken = await this.authService.getValidAccessToken()
      if (accessToken) {
        return {
          access_token: accessToken,
          token_type: 'Bearer'
        }
      }
    } catch (error) {
      console.warn('Failed to get tokens from auth service:', error)
    }
    return undefined
  }

  async saveTokens(): Promise<void> {
    // No-op: Jan auth service handles token storage
  }

  redirectToAuthorization(): void {
    // No-op: Not handling authorization flow
  }

  async saveCodeVerifier(): Promise<void> {
    // No-op: Not handling authorization flow
  }

  async codeVerifier(): Promise<string> {
    throw new Error('Code verifier not supported')
  }
}
