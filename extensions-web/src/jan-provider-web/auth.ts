/**
 * Jan Provider Authentication Service
 * Handles guest login and token refresh for Jan API
 */

export interface AuthTokens {
  access_token: string
  expires_in: number
}

export interface AuthResponse {
  access_token: string
  expires_in: number
}

// JAN_API_BASE is defined in vite.config.ts
const AUTH_STORAGE_KEY = 'jan_auth_tokens'
const TOKEN_EXPIRY_BUFFER = 60 * 1000 // 1 minute buffer before actual expiry

export class JanAuthService {
  private static instance: JanAuthService
  private tokens: AuthTokens | null = null
  private tokenExpiryTime: number = 0

  private constructor() {
    this.loadTokensFromStorage()
  }

  static getInstance(): JanAuthService {
    if (!JanAuthService.instance) {
      JanAuthService.instance = new JanAuthService()
    }
    return JanAuthService.instance
  }

  private loadTokensFromStorage(): void {
    try {
      const storedTokens = localStorage.getItem(AUTH_STORAGE_KEY)
      if (storedTokens) {
        const parsed = JSON.parse(storedTokens)
        this.tokens = parsed.tokens
        this.tokenExpiryTime = parsed.expiryTime || 0
      }
    } catch (error) {
      console.warn('Failed to load tokens from storage:', error)
      this.clearTokens()
    }
  }

  private saveTokensToStorage(): void {
    if (this.tokens) {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
          tokens: this.tokens,
          expiryTime: this.tokenExpiryTime
        }))
      } catch (error) {
        console.error('Failed to save tokens to storage:', error)
      }
    }
  }

  private clearTokens(): void {
    this.tokens = null
    this.tokenExpiryTime = 0
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  private isTokenExpired(): boolean {
    return Date.now() > (this.tokenExpiryTime - TOKEN_EXPIRY_BUFFER)
  }

  private calculateExpiryTime(expiresIn: number): number {
    return Date.now() + (expiresIn * 1000)
  }

  private async guestLogin(): Promise<AuthTokens> {
    try {
      const response = await fetch(`${JAN_API_BASE}/auth/guest-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for session management
      })

      if (!response.ok) {
        throw new Error(`Guest login failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      
      // API response is wrapped in result object
      const authResponse = data.result || data
      
      // Guest login returns only access_token and expires_in
      const tokens: AuthTokens = {
        access_token: authResponse.access_token,
        expires_in: authResponse.expires_in
      }

      this.tokens = tokens
      this.tokenExpiryTime = this.calculateExpiryTime(tokens.expires_in)
      this.saveTokensToStorage()

      return tokens
    } catch (error) {
      console.error('Guest login failed:', error)
      throw error
    }
  }

  private async refreshToken(): Promise<AuthTokens> {
    try {
      const response = await fetch(`${JAN_API_BASE}/auth/refresh-token`, {
        method: 'GET',
        credentials: 'include', // Cookies will include the refresh token
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Refresh token is invalid, clear tokens and do guest login
          this.clearTokens()
          return this.guestLogin()
        }
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      
      // API response is wrapped in result object
      const authResponse = data.result || data
      
      // Refresh endpoint returns only access_token and expires_in
      const tokens: AuthTokens = {
        access_token: authResponse.access_token,
        expires_in: authResponse.expires_in
      }

      this.tokens = tokens
      this.tokenExpiryTime = this.calculateExpiryTime(tokens.expires_in)
      this.saveTokensToStorage()

      return tokens
    } catch (error) {
      console.error('Token refresh failed:', error)
      // If refresh fails, fall back to guest login
      this.clearTokens()
      return this.guestLogin()
    }
  }

  async getValidAccessToken(): Promise<string> {
    // If no tokens exist, do guest login
    if (!this.tokens) {
      const tokens = await this.guestLogin()
      return tokens.access_token
    }

    // If token is expired or about to expire, refresh it
    if (this.isTokenExpired()) {
      const tokens = await this.refreshToken()
      return tokens.access_token
    }

    // Return existing valid token
    return this.tokens.access_token
  }

  async initialize(): Promise<void> {
    try {
      await this.getValidAccessToken()
      console.log('Jan auth service initialized successfully')
    } catch (error) {
      console.error('Failed to initialize Jan auth service:', error)
      throw error
    }
  }

  async getAuthHeader(): Promise<{ Authorization: string }> {
    const token = await this.getValidAccessToken()
    return {
      Authorization: `Bearer ${token}`
    }
  }

  logout(): void {
    this.clearTokens()
  }
}