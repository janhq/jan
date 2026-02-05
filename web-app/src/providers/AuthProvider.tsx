/**
 * Authentication Provider
 * Initializes the auth service and sets up event listeners
 */

import { useCallback, useEffect, useState, ReactNode } from 'react'
import { PlatformFeature } from '@/lib/platform/types'
import { PlatformFeatures } from '@/lib/platform/const'
import { initializeAuthStore, getAuthStore } from '@/hooks/useAuth'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { usePrompt } from '@/hooks/usePrompt'
import { useAppState } from '@/hooks/useAppState'
import { useNavigate } from '@tanstack/react-router'
import { useServiceHub } from '@/hooks/useServiceHub'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const navigate = useNavigate()
  const serviceHub = useServiceHub()

  // Check if authentication is enabled for this platform
  const isAuthenticationEnabled =
    PlatformFeatures[PlatformFeature.AUTHENTICATION]

  // Fetch user data when user logs in
  const fetchUserData = useCallback(async () => {
    try {
      const { setThreads } = useThreads.getState()

      // Fetch threads first
      const threads = await serviceHub.threads().fetchThreads()
      setThreads(threads)
    } catch (error) {
      console.error('Failed to fetch user data:', error)
    }
  }, [serviceHub])

  // Reset all app data when user logs out
  const resetAppData = useCallback(() => {
    // Clear all threads (including favorites)
    const { clearAllThreads, setCurrentThreadId } = useThreads.getState()
    clearAllThreads()
    setCurrentThreadId(undefined)

    // Clear all messages
    const { clearAllMessages } = useMessages.getState()
    clearAllMessages()

    // Reset prompt
    const { resetPrompt } = usePrompt.getState()
    resetPrompt()

    // Clear app state (streaming, tokens, errors, etc.)
    const { clearAppState } = useAppState.getState()
    clearAppState()

    // Navigate back to home to ensure clean state
    navigate({ to: '/', replace: true })
  }, [navigate])

  useEffect(() => {
    if (!isAuthenticationEnabled) {
      setIsReady(true)
      return
    }

    const initializeAuth = async () => {
      try {
        const { getSharedAuthService } = await import('@jan/extensions-web')
        const authService = getSharedAuthService()

        await initializeAuthStore(authService)

        setIsReady(true)
      } catch (error) {
        console.error('Failed to initialize auth service:', error)
        setIsReady(true) // Still render to show error state
      }
    }

    initializeAuth()
  }, [isAuthenticationEnabled])

  // Listen for auth state changes across tabs - setup after auth service is ready
  useEffect(() => {
    if (!isAuthenticationEnabled || !isReady) {
      return
    }

    const handleAuthEvent = (event: MessageEvent) => {
      // Listen for all auth events, not just login/logout
      if (event.data?.type?.startsWith('auth:')) {
        const authStore = getAuthStore()

        // Handle different auth events
        if (event.data.type === 'auth:logout') {
          // Reset all app data first on logout
          resetAppData()
        }

        // Reload auth state when auth events are received
        // For login events, force refresh the user profile
        if (event.data.type === 'auth:login') {
          // Force refresh user profile on login events (forceRefresh=true)
          authStore.loadAuthState(true).then(() => {
            // Also fetch user data (threads, messages)
            fetchUserData()
          })
        } else {
          // For other events, just reload auth state without forcing refresh
          authStore.loadAuthState()
        }
      }
    }

    // Use the auth store's subscribeToAuthEvents method
    const authStore = getAuthStore()

    if (!authStore.authService) {
      return
    }

    const cleanupAuthListener = authStore.subscribeToAuthEvents(handleAuthEvent)

    return () => {
      cleanupAuthListener()
    }
  }, [isAuthenticationEnabled, isReady, fetchUserData, resetAppData])

  return <>{isReady && children}</>
}
