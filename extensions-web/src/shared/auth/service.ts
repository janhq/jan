/**
 * Generic Authentication Service
 * Handles authentication flows for any OAuth provider
 */

declare const JAN_BASE_URL: string

import { User, AuthState, AuthBroadcastMessage, AuthTokens } from './types'
import {
  AUTH_STORAGE_KEYS,
  AUTH_ENDPOINTS,
  TOKEN_EXPIRY_BUFFER,
  AUTH_EVENTS,
} from './const'
import { logoutUser, refreshToken, guestLogin } from './api'
import { AuthProviderRegistry } from './registry'
import { AuthBroadcast } from './broadcast'
import type { ProviderType } from './providers'
import { ApiError } from '../types/errors'

const authProviderRegistry = new AuthProviderRegistry()

export class JanAuthService {
  private accessToken: string | null = null
  private tokenExpiryTime: number = 0
  private refreshPromise: Promise<void> | null = null
  private authBroadcast: AuthBroadcast
  private currentUser: User | null = null
  private initPromise: Promise<void> | null = null

  constructor() {
    this.authBroadcast = new AuthBroadcast()
    this.setupBroadcastHandlers()
    this.initPromise = this.initialize().catch(console.error)
  }

  /**
   * Ensure initialization is complete before proceeding
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise
      this.initPromise = null
    }
  }

  /**
   * Initialize the auth service
   * Called on app load to check existing session
   */
  async initialize(): Promise<void> {
    // Ensure refreshtoken is valid (in case of expired session or secret change)
    try {
      await refreshToken()
    } catch (error) {
      console.log('Failed to refresh token on init:', error)
      // If refresh fails, logout to clear any invalid state
      console.log('Logging out and clearing auth state to clear invalid session...')
      await logoutUser()
      this.clearAuthState()
      this.authBroadcast.broadcastLogout()
    }
    // Authentication state check
    try {
      if (!this.isAuthenticated()) {
        // Not authenticated - ensure guest access
        await this.ensureGuestAccess()
        return
      }

      // Authenticated - ensure we have a valid token
      await this.refreshAccessToken()
    } catch (error) {
      console.error('Failed to initialize auth:', error)
    }
  }

  /**
   * Start OAuth login flow with specified provider
   */
  async loginWithProvider(providerId: ProviderType): Promise<void> {
    await this.ensureInitialized()

    const provider = authProviderRegistry.getProvider(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} is not available`)
    }

    try {
      await provider.initiateLogin()
    } catch (error) {
      console.error(`Failed to initiate ${providerId} login:`, error)
      throw error
    }
  }

  /**
   * Handle OAuth callback for any provider
   */
  async handleProviderCallback(
    providerId: ProviderType,
    code: string,
    state?: string
  ): Promise<void> {
    await this.ensureInitialized()

    const provider = authProviderRegistry.getProvider(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} is not supported`)
    }

    try {
      // Use provider to handle the callback - this returns tokens
      const tokens = await provider.handleCallback(code, state)

      // Store tokens and set authenticated state
      this.accessToken = tokens.access_token
      this.tokenExpiryTime = this.computeTokenExpiry(tokens)
      this.setAuthProvider(providerId)

      this.authBroadcast.broadcastLogin()
    } catch (error) {
      console.error(`Failed to handle ${providerId} callback:`, error)
      throw error
    }
  }

  /**
   * Get a valid access token
   * Handles both authenticated and guest tokens
   */
  async getValidAccessToken(): Promise<string> {
    await this.ensureInitialized()

    if (
      this.accessToken &&
      Date.now() < this.tokenExpiryTime - TOKEN_EXPIRY_BUFFER
    ) {
      return this.accessToken
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null
      })
    }

    await this.refreshPromise

    if (!this.accessToken) {
      throw new Error('Failed to obtain access token')
    }

    return this.accessToken
  }

  async refreshAccessToken(): Promise<void> {
    try {
      const tokens = await refreshToken()

      this.accessToken = tokens.access_token
      this.tokenExpiryTime = this.computeTokenExpiry(tokens)
    } catch (error) {
      console.error('Failed to refresh access token:', error)
      if (error instanceof ApiError && error.isStatus(401)) {
        await this.handleSessionExpired()
      }
      throw error
    }
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(forceRefresh: boolean = false): Promise<User | null> {
    await this.ensureInitialized()

    const authType = this.getAuthState()
    if (authType !== AuthState.AUTHENTICATED) {
      return null
    }

    // Force refresh if requested or if cache is cleared
    if (!forceRefresh && this.currentUser) {
      return this.currentUser
    }

    const userProfile = await this.fetchUserProfile()
    if (userProfile) {
      const user: User = {
        id: userProfile.id,
        email: userProfile.email,
        name: userProfile.name,
        picture: userProfile.picture,
        object: userProfile.object || 'user',
      }
      this.currentUser = user
    }

    return this.currentUser
  }

  /**
   * Logout the current user
   */
  async logout(): Promise<void> {
    await this.ensureInitialized()

    try {
      const authType = this.getAuthState()

      if (authType === AuthState.AUTHENTICATED) {
        await logoutUser()
      }

      this.clearAuthState()

      // Ensure guest access after logout
      await this.ensureGuestAccess()

      this.authBroadcast.broadcastLogout()

      if (window.location.pathname !== '/') {
        window.location.href = '/'
      }
    } catch (error) {
      console.error('Logout failed:', error)
      this.clearAuthState()
      // Try to ensure guest access even on error
      this.ensureGuestAccess().catch(console.error)
    }
  }

  /**
   * Get enabled authentication providers
   */
  getAllProviders(): Array<{ id: string; name: string; icon: string }> {
    return authProviderRegistry.getAllProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      icon: provider.icon,
    }))
  }

  /**
   * Check if user is authenticated with any provider
   */
  isAuthenticated(): boolean {
    return this.getAuthState() === AuthState.AUTHENTICATED
  }

  /**
   * Check if user is authenticated with specific provider
   */
  isAuthenticatedWithProvider(providerId: ProviderType): boolean {
    const authType = this.getAuthState()
    if (authType !== AuthState.AUTHENTICATED) {
      return false
    }

    return this.getAuthProvider() === providerId
  }

  /**
   * Get current auth type derived from provider
   */
  getAuthState(): AuthState {
    const provider = this.getAuthProvider()
    if (!provider) return AuthState.UNAUTHENTICATED
    if (provider === 'guest') return AuthState.GUEST
    return AuthState.AUTHENTICATED
  }

  /**
   * Get auth headers for API requests
   */
  async getAuthHeader(): Promise<{ Authorization: string }> {
    await this.ensureInitialized()

    const token = await this.getValidAccessToken()
    return {
      Authorization: `Bearer ${token}`,
    }
  }

  /**
   * Make authenticated API request
   */
  async makeAuthenticatedRequest<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.ensureInitialized()

    try {
      const authHeader = await this.getAuthHeader()

      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
          ...options.headers,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new ApiError(response.status, response.statusText, errorText)
      }

      return response.json()
    } catch (error) {
      console.error('API request failed:', error)
      throw error
    }
  }

  /**
   * Get the broadcast channel for external listeners
   */
  getBroadcastChannel(): BroadcastChannel | null {
    return this.authBroadcast.getBroadcastChannel()
  }

  /**
   * Subscribe to auth events
   */
  onAuthEvent(
    callback: (event: MessageEvent<{ type: AuthBroadcastMessage }>) => void
  ): () => void {
    return this.authBroadcast.onAuthEvent(callback)
  }

  /**
   * Clear all auth state
   */
  private clearAuthState(): void {
    this.accessToken = null
    this.tokenExpiryTime = 0
    this.currentUser = null

    localStorage.removeItem(AUTH_STORAGE_KEYS.AUTH_PROVIDER)
  }

  private computeTokenExpiry(tokens: AuthTokens): number {
    if (tokens.expires_at) {
      const expiresAt = new Date(tokens.expires_at).getTime()
      if (!Number.isNaN(expiresAt)) {
        return expiresAt
      }
      console.warn('Invalid expires_at format in auth tokens:', tokens.expires_at)
    }

    if (typeof tokens.expires_in === 'number') {
      return Date.now() + tokens.expires_in * 1000
    }

    console.warn('Auth tokens missing expiry information; defaulting to immediate expiry')
    return Date.now()
  }

  /**
   * Ensure guest access is available
   */
  private async ensureGuestAccess(): Promise<void> {
    try {
      this.setAuthProvider('guest')
      if (!this.accessToken || Date.now() > this.tokenExpiryTime) {
        const tokens = await guestLogin()
        this.accessToken = tokens.access_token
        this.tokenExpiryTime = this.computeTokenExpiry(tokens)
      }
    } catch (error) {
      console.error('Failed to ensure guest access:', error)
      // Remove provider (unauthenticated state)
      localStorage.removeItem(AUTH_STORAGE_KEYS.AUTH_PROVIDER)
    }
  }

  /**
   * Handle session expired
   */
  private async handleSessionExpired(): Promise<void> {
    this.logout().catch(console.error)
    this.ensureGuestAccess().catch(console.error)
  }

  /**
   * Setup broadcast event handlers
   */
  private setupBroadcastHandlers(): void {
    this.authBroadcast.onAuthEvent((event) => {
      switch (event.data.type) {
        case AUTH_EVENTS.LOGIN:
          // Another tab logged in, clear cached data to force refresh
          // Clear current user cache so next getCurrentUser() call fetches fresh data
          this.currentUser = null
          // Clear token cache so next getValidAccessToken() call refreshes
          this.accessToken = null
          this.tokenExpiryTime = 0
          break

        case AUTH_EVENTS.LOGOUT:
          // Another tab logged out, clear our state
          this.clearAuthState()
          break
      }
    })
  }

  /**
   * Get current auth provider
   */
  getAuthProvider(): string | null {
    return localStorage.getItem(AUTH_STORAGE_KEYS.AUTH_PROVIDER)
  }

  /**
   * Set auth provider
   */
  private setAuthProvider(provider: string): void {
    localStorage.setItem(AUTH_STORAGE_KEYS.AUTH_PROVIDER, provider)
  }

  /**
   * Fetch user profile from server
   */
  private async fetchUserProfile(): Promise<User | null> {
    try {
      return await this.makeAuthenticatedRequest<User>(
        `${JAN_BASE_URL}${AUTH_ENDPOINTS.ME}`
      )
    } catch (error) {
      console.error('Failed to fetch user profile:', error)
      if (error instanceof ApiError && error.isStatus(401)) {
        // Authentication failed - handle session expiry
        await this.handleSessionExpired()
        return null
      }
      return null
    }
  }
}

// Singleton instance management
declare global {
  interface Window {
    janAuthService?: JanAuthService
  }
}

/**
 * Get or create the shared JanAuthService instance
 */
export function getSharedAuthService(): JanAuthService {
  if (!window.janAuthService) {
    window.janAuthService = new JanAuthService()
  }
  return window.janAuthService
}
