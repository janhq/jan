/**
 * Keycloak Auth Provider
 * Specific implementation for Keycloak OAuth via Jan Server with PKCE
 * 
 * OAuth Flow (PKCE):
 * 1. User clicks login -> initiateLogin() is called
 * 2. Frontend calls GET /auth/login to get authorization_url with PKCE parameters
 * 3. User is redirected to Keycloak login page
 * 4. After successful login, Keycloak redirects to backend /auth/callback with code & state
 * 5. Backend validates code with PKCE code_verifier and exchanges for tokens
 * 6. Backend redirects to frontend callback with tokens in URL fragment:
 *    http://localhost:3000/auth/keycloak/callback#access_token=...&refresh_token=...
 * 7. Frontend extracts tokens from fragment and stores them
 */

import { BaseAuthProvider } from './base'

export class KeycloakAuthProvider extends BaseAuthProvider {
  readonly id = 'keycloak'
  readonly name = 'Keycloak'
  readonly icon = 'IconKey' // Using key icon for Keycloak

  /**
   * Get the login endpoint
   * This endpoint returns the Keycloak authorization URL with PKCE code_challenge
   */
  getLoginEndpoint(): string {
    return '/auth/login'
  }

  /**
   * Get the callback endpoint
   * This endpoint is used as fallback for token exchange (backward compatibility)
   * In PKCE flow, tokens are extracted from URL fragment instead
   */
  getCallbackEndpoint(): string {
    return '/auth/callback'
  }
}
