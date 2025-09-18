/**
 * Google Auth Provider
 * Specific implementation for Google OAuth
 */

import { BaseAuthProvider } from './base'

export class GoogleAuthProvider extends BaseAuthProvider {
  readonly id = 'google'
  readonly name = 'Google'
  readonly icon = 'IconBrandGoogleFilled'

  getLoginEndpoint(): string {
    return '/auth/google/login'
  }

  getCallbackEndpoint(): string {
    return '/auth/google/callback'
  }
}
