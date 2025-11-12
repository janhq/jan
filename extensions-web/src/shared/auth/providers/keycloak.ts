/**
 * Keycloak Auth Provider
 * Specific implementation for Keycloak OAuth via Jan Server
 * 
 * OAuth Flow:
 * 1. User clicks login -> initiateLogin() is called
 * 2. Frontend calls GET /auth/keycloak/login to get authorization_url
 * 3. User is redirected to Keycloak login page
 * 4. After successful login, Keycloak redirects back to /auth/keycloak/callback with code & state
 * 5. Frontend calls POST /auth/keycloak/callback to exchange code for tokens
 * 6. Tokens are stored and user is authenticated
 */

import { BaseAuthProvider } from './base'

export class KeycloakAuthProvider extends BaseAuthProvider {
  readonly id = 'keycloak'
  readonly name = 'Keycloak'
  readonly icon = 'IconKey' // Using key icon for Keycloak

  /**
   * Get the login endpoint
   * This endpoint returns the Keycloak authorization URL
   */
  getLoginEndpoint(): string {
    return '/auth/login'
  }

  /**
   * Get the callback endpoint
   * This endpoint exchanges the authorization code for tokens
   */
  getCallbackEndpoint(): string {
    return '/auth/callback'
  }
}
