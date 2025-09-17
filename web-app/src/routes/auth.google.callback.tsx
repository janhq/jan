/**
 * Google OAuth Callback Route
 * Handles the callback from Google OAuth flow
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'

export const Route = createFileRoute('/auth/google/callback')({
  component: () => (
    <PlatformGuard feature={PlatformFeature.AUTHENTICATION}>
      <GoogleCallbackRedirect />
    </PlatformGuard>
  ),
})

function GoogleCallbackRedirect() {
  const navigate = useNavigate()
  const { isAuthenticationEnabled, handleProviderCallback } = useAuth()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        if (!isAuthenticationEnabled) {
          throw new Error('Authentication not available on this platform')
        }

        // Check for error parameters first
        const urlParams = new URLSearchParams(window.location.search)
        const error = urlParams.get('error')
        const errorDescription = urlParams.get('error_description')

        if (error) {
          throw new Error(errorDescription || `OAuth error: ${error}`)
        }

        // Extract the authorization code and state from URL parameters
        const code = urlParams.get('code')
        const state = urlParams.get('state')

        if (!code) {
          throw new Error('No authorization code received from Google')
        }

        // State is optional, don't require it

        // Handle successful callback with the code and optional state using generic method
        await handleProviderCallback('google', code, state || undefined)

        toast.success('Successfully signed in!')

        // Redirect to home after authentication
        navigate({ to: '/', replace: true })
      } catch (error) {
        console.error('Google OAuth callback failed:', error)

        const message =
          error instanceof Error ? error.message : 'Authentication failed'
        toast.error(message)

        // Redirect to home on error (no login page)
        navigate({ to: '/', replace: true })
      }
    }

    handleCallback()
  }, [isAuthenticationEnabled, handleProviderCallback, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold mb-2">Signing you in...</h2>
        <p className="text-muted-foreground">
          Please wait while we complete your Google authentication.
        </p>
      </div>
    </div>
  )
}
