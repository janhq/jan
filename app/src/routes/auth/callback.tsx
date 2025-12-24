import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/stores/auth-store'
import { retrieveOAuthState, exchangeCodeForTokens } from '@/lib/oauth'

export const Route = createFileRoute('/auth/callback')({
  component: OAuthCallbackPage,
})

function OAuthCallbackPage() {
  const navigate = useNavigate()
  const loginWithOAuth = useAuth((state) => state.loginWithOAuth)
  const [error, setError] = useState<string | null>(null)
  const processingRef = useRef(false)

  useEffect(() => {
    // Prevent duplicate processing
    if (processingRef.current) return
    processingRef.current = true

    const handleCallback = async () => {
      try {
        // Parse URL parameters
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const state = params.get('state')
        const errorParam = params.get('error')
        const errorDescription = params.get('error_description')

        // Handle OAuth errors
        if (errorParam) {
          throw new Error(errorDescription || `OAuth error: ${errorParam}`)
        }

        // Validate required parameters
        if (!code || !state) {
          throw new Error('Missing authorization code or state parameter')
        }

        // Retrieve and validate stored OAuth state
        const oauthData = retrieveOAuthState(state)
        if (!oauthData) {
          throw new Error(
            'Invalid state parameter. Possible CSRF attack or expired session.'
          )
        }

        // Exchange authorization code for tokens
        const tokens = await exchangeCodeForTokens(code, oauthData.codeVerifier)

        // Login with OAuth tokens
        loginWithOAuth(tokens)
        console.log('OAuth login successful')
        // Navigate to the original URL or home
        let redirectUrl = '/'

        navigate({ to: redirectUrl })
      } catch (err) {
        console.error('OAuth callback error:', err)
        setError(err instanceof Error ? err.message : 'Authentication failed')

        // Navigate to home with error after 3 seconds
        setTimeout(() => {
          navigate({ to: '/' })
        }, 3000)
      }
    }

    handleCallback()
  }, [loginWithOAuth, navigate])

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h1 className="mb-2 text-xl font-semibold text-red-900">
            Authentication Failed
          </h1>
          <p className="mb-4 text-sm text-red-700">{error}</p>
          <p className="text-xs text-red-600">Redirecting to home page...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]" />
        <p className="text-sm text-gray-600">Completing authentication...</p>
      </div>
    </div>
  )
}
