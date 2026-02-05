import { create } from 'zustand'
import {
  type User,
  type ProviderType,
  JanAuthService,
} from '@jan/extensions-web'
import { PlatformFeature } from '@/lib/platform/types'
import { PlatformFeatures } from '@/lib/platform/const'

interface AuthState {
  // Auth service
  authService: JanAuthService | null
  setAuthService: (authService: JanAuthService | null) => void

  // Auth state
  isAuthenticated: boolean
  user: User | null
  isLoading: boolean

  // State setters
  setUser: (user: User | null) => void
  setIsLoading: (isLoading: boolean) => void

  // Multi-provider auth actions
  getAllProviders: () => Array<{ id: string; name: string; icon: string }>
  loginWithProvider: (providerId: ProviderType) => Promise<void>
  handleProviderCallback: (
    providerId: ProviderType,
    code: string,
    state?: string
  ) => Promise<void>
  isAuthenticatedWithProvider: (providerId: ProviderType) => boolean

  // Auth actions
  logout: () => Promise<void>
  getCurrentUser: (forceRefresh?: boolean) => Promise<User | null>
  loadAuthState: (forceRefresh?: boolean) => Promise<void>
  subscribeToAuthEvents: (callback: (event: MessageEvent) => void) => () => void

  // Platform feature check
  isAuthenticationEnabled: boolean
}

const useAuthStore = create<AuthState>()((set, get) => ({
  // Auth service
  authService: null,
  setAuthService: (authService: JanAuthService | null) => set({ authService }),

  // Auth state
  isAuthenticated: false,
  user: null,
  isLoading: true,

  // Platform feature check
  isAuthenticationEnabled:
    PlatformFeatures[PlatformFeature.AUTHENTICATION] || false,

  // State setters
  setUser: (user: User | null) =>
    set(() => ({
      user,
      isAuthenticated: user !== null,
    })),
  setIsLoading: (isLoading: boolean) => set({ isLoading }),

  // Multi-provider auth actions
  getAllProviders: () => {
    const { authService } = get()
    if (!authService) {
      return []
    }
    return authService.getAllProviders()
  },

  loginWithProvider: async (providerId: ProviderType) => {
    const { authService, isAuthenticationEnabled } = get()
    if (!isAuthenticationEnabled || !authService) {
      throw new Error('Authentication not available on this platform')
    }

    await authService.loginWithProvider(providerId)
  },

  handleProviderCallback: async (
    providerId: ProviderType,
    code: string,
    state?: string
  ) => {
    const { authService, isAuthenticationEnabled, loadAuthState } = get()
    if (!isAuthenticationEnabled || !authService) {
      throw new Error('Authentication not available on this platform')
    }

    await authService.handleProviderCallback(providerId, code, state)
    // Reload auth state after successful callback
    await loadAuthState()
  },

  isAuthenticatedWithProvider: (providerId: ProviderType) => {
    const { authService } = get()
    if (!authService) {
      return false
    }

    return authService.isAuthenticatedWithProvider(providerId)
  },

  logout: async () => {
    const { authService, isAuthenticationEnabled, loadAuthState } = get()
    if (!isAuthenticationEnabled || !authService) {
      throw new Error('Authentication not available on this platform')
    }

    try {
      await authService.logout()

      // Force reload auth state after logout to ensure consistency
      await loadAuthState()
    } catch (error) {
      console.error('Logout failed:', error)
      // Still update local state even if logout call failed
      set({
        user: null,
        isAuthenticated: false,
      })
    }
  },

  getCurrentUser: async (forceRefresh: boolean = false): Promise<User | null> => {
    const { authService, isAuthenticationEnabled } = get()
    if (!isAuthenticationEnabled || !authService) {
      return null
    }

    try {
      const profile = await authService.getCurrentUser(forceRefresh)
      set({
        user: profile,
        isAuthenticated: profile !== null,
      })
      return profile
    } catch (error) {
      console.error('Failed to get current user:', error)
      return null
    }
  },

  loadAuthState: async (forceRefresh: boolean = false) => {
    const { authService, isAuthenticationEnabled } = get()
    if (!isAuthenticationEnabled || !authService) {
      set({ isLoading: false })
      return
    }

    try {
      set({ isLoading: true })

      // Check if user is authenticated with any provider
      const isAuth = authService.isAuthenticated()

      // Load user profile if authenticated
      if (isAuth) {
        const profile = await authService.getCurrentUser(forceRefresh)
        set({
          user: profile,
          isAuthenticated: profile !== null,
        })
      } else {
        set({
          user: null,
          isAuthenticated: false,
        })
      }
    } catch (error) {
      console.error('Failed to load auth state:', error)
      set({
        user: null,
        isAuthenticated: false,
      })
    } finally {
      set({ isLoading: false })
    }
  },

  subscribeToAuthEvents: (callback: (event: MessageEvent) => void) => {
    const { authService } = get()
    if (!authService || typeof authService.onAuthEvent !== 'function') {
      return () => {} // Return no-op cleanup
    }

    try {
      return authService.onAuthEvent(callback)
    } catch (error) {
      console.warn('Failed to subscribe to auth events:', error)
      return () => {}
    }
  },
}))

/**
 * Hook to get auth state and actions for React components
 */
export const useAuth = () => {
  const authState = useAuthStore()
  return authState
}

/**
 * Global function to get auth store for non-React contexts
 */
export const getAuthStore = () => {
  return useAuthStore.getState()
}

/**
 * Initialize the auth service in the store
 * This should only be called from the AuthProvider after service initialization
 */
export const initializeAuthStore = async (authService: JanAuthService) => {
  const store = useAuthStore.getState()
  store.setAuthService(authService)

  // Load initial auth state
  await store.loadAuthState()
}

/**
 * Check if auth service is initialized
 */
export const isAuthServiceInitialized = (): boolean => {
  return useAuthStore.getState().authService !== null
}
