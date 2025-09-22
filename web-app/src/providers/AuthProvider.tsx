/**
 * Authentication Provider
 * Initializes the auth service and sets up event listeners
 */

import { useEffect, useState, ReactNode } from 'react'
import { PlatformFeature } from '@/lib/platform/types'
import { PlatformFeatures } from '@/lib/platform/const'
import { initializeAuthStore, getAuthStore } from '@/hooks/useAuth'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isReady, setIsReady] = useState(false)

  // Check if authentication is enabled for this platform
  const isAuthenticationEnabled =
    PlatformFeatures[PlatformFeature.AUTHENTICATION]

  useEffect(() => {
    if (!isAuthenticationEnabled) {
      setIsReady(true)
      return
    }

    const initializeAuth = async () => {
      try {
        console.log('Initializing auth service...')
        const { getSharedAuthService } = await import('@jan/extensions-web')
        const authService = getSharedAuthService()

        await initializeAuthStore(authService)
        console.log('Auth service initialized successfully')

        setIsReady(true)
      } catch (error) {
        console.error('Failed to initialize auth service:', error)
        setIsReady(true) // Still render to show error state
      }
    }

    initializeAuth()
  }, [isAuthenticationEnabled])

  // Listen for auth state changes across tabs
  useEffect(() => {
    if (!isAuthenticationEnabled) return

    const handleAuthEvent = (event: MessageEvent) => {
      // Listen for all auth events, not just login/logout
      if (event.data?.type?.startsWith('auth:')) {
        const authStore = getAuthStore()
        authStore.loadAuthState()
      }
    }

    // Use the auth store's subscribeToAuthEvents method
    const authStore = getAuthStore()
    const cleanupAuthListener = authStore.subscribeToAuthEvents(handleAuthEvent)

    return () => {
      cleanupAuthListener()
    }
  }, [isAuthenticationEnabled])

  return <>{isReady && children}</>
}
