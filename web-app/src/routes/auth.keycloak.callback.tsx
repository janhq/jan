/**
 * Keycloak OAuth Callback Route
 * Handles the callback from Keycloak OAuth flow with PKCE
 * 
 * Backend Flow:
 * 1. User authenticates with Keycloak
 * 2. Backend validates authorization code with PKCE code_verifier
 * 3. Backend redirects to this route with tokens in URL fragment:
 *    http://localhost:3000/auth/keycloak/callback#access_token=...&refresh_token=...&expires_in=...
 * 4. Frontend extracts tokens from fragment and stores them
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'

export const Route = createFileRoute('/auth/keycloak/callback')({
  component: () => (
    <PlatformGuard feature={PlatformFeature.AUTHENTICATION}>
      <KeycloakCallbackRedirect />
    </PlatformGuard>
  ),
})

function KeycloakCallbackRedirect() {
  const navigate = useNavigate()
  const { isAuthenticationEnabled, handleProviderCallback } = useAuth()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        if (!isAuthenticationEnabled) {
          throw new Error('Authentication not available on this platform')
        }

        // Check for error parameters in query string first
        const urlParams = new URLSearchParams(window.location.search)
        const error = urlParams.get('error')
        const errorDescription = urlParams.get('error_description')

        if (error) {
          throw new Error(errorDescription || `OAuth error: ${error}`)
        }

        // Check for tokens in URL fragment (PKCE flow)
        // Backend redirects with: #access_token=...&refresh_token=...&expires_in=...
        const hash = window.location.hash.substring(1)
        const hashParams = new URLSearchParams(hash)
        const hasFragmentTokens = hashParams.get('access_token')

        if (hasFragmentTokens) {
          console.debug('[Keycloak] Tokens found in URL fragment (PKCE flow)')
          
          // Call handleProviderCallback - it will extract tokens from fragment
          // Pass empty code since tokens are already in fragment
          await handleProviderCallback('keycloak', '', undefined)
          
          toast.success('Successfully signed in with Keycloak!')
          
          // Redirect to home after authentication
          navigate({ to: '/', replace: true })
          return
        }

        // Fallback: Traditional flow with authorization code in query params
        const code = urlParams.get('code')
        const state = urlParams.get('state')

        if (!code) {
          throw new Error('No authorization code or tokens received from Keycloak')
        }

        console.debug('[Keycloak] Using authorization code flow (fallback)')

        // Handle callback with authorization code
        await handleProviderCallback('keycloak', code, state || undefined)

        toast.success('Successfully signed in with Keycloak!')

        // Redirect to home after authentication
        navigate({ to: '/', replace: true })
      } catch (error) {
        console.error('Keycloak OAuth callback failed:', error)

        const message =
          error instanceof Error ? error.message : 'Authentication failed'
        toast.error(message)

        // Redirect to home on error (no login page)
        navigate({ to: '/', replace: true })
      }
    }

    handleCallback()
  }, [navigate, handleProviderCallback, isAuthenticationEnabled])

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
        </div>
        <p className="text-muted-foreground">Processing Keycloak authentication...</p>
      </div>
    </div>
  )
}
