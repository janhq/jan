/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible'

declare const JAN_API_BASE_URL: string
let isRefreshing = false
let refreshPromise: Promise<string> | null = null

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function refreshAccessToken(): Promise<string> {
  const { useAuth } = await import('@/stores/auth-store')
  await useAuth.getState().refreshAccessToken()
  return useAuth.getState().accessToken!
}

interface FetchWithAuthOptions extends RequestInit {
  skipAuthRefresh?: boolean
}

export async function fetchWithAuth(
  url: string,
  options: FetchWithAuthOptions = {}
): Promise<Response> {
  const { skipAuthRefresh = false, ...fetchOptions } = options

  // Get auth store dynamically to avoid circular dependencies
  const { useAuth } = await import('@/stores/auth-store')
  const { accessToken } = useAuth.getState()

  if (!accessToken) {
    throw new ApiError(401, 'No access token available')
  }

  // Add authorization header
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    ...fetchOptions.headers,
  }

  // Make the request
  let response = await fetch(url, {
    ...fetchOptions,
    headers,
  })

  // Handle 401 - Unauthorized
  if (response.status === 401 && !skipAuthRefresh) {
    // If already refreshing, wait for that to complete
    if (isRefreshing && refreshPromise) {
      try {
        const newAccessToken = await refreshPromise
        // Retry with new token
        return fetch(url, {
          ...fetchOptions,
          headers: {
            ...headers,
            Authorization: `Bearer ${newAccessToken}`,
          },
        })
      } catch (error) {
        // Refresh failed, clear auth and throw
        const { logout } = useAuth.getState()
        logout()
        throw new ApiError(401, 'Session expired. Please login again.')
      }
    }

    // Start refresh process
    isRefreshing = true
    refreshPromise = (async () => {
      try {
        const newAccessToken = await refreshAccessToken()
        return newAccessToken
      } catch (error) {
        // Refresh failed, logout user
        const { logout } = useAuth.getState()
        logout()
        throw error
      } finally {
        isRefreshing = false
        refreshPromise = null
      }
    })()

    try {
      const newAccessToken = await refreshPromise

      // Retry the original request with new token
      response = await fetch(url, {
        ...fetchOptions,
        headers: {
          ...headers,
          Authorization: `Bearer ${newAccessToken}`,
        },
      })
    } catch (error) {
      throw new ApiError(401, 'Session expired. Please login again.')
    }
  }

  return response
}

export async function fetchJsonWithAuth<T>(
  url: string,
  options: FetchWithAuthOptions = {}
): Promise<T> {
  const response = await fetchWithAuth(url, options)

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new ApiError(response.status, errorText)
  }

  return response.json()
}

/**
 * Creates a custom fetch function that handles token refresh automatically.
 * This is useful for AI SDK providers that need authenticated requests.
 *
 * @returns A fetch function that can be used with AI SDK providers
 */
export function createAuthenticatedFetch(customBody?: object): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    // Pass through fetchWithAuth which handles token refresh
    return fetchWithAuth(url, {
      ...init,
      body: customBody
        ? JSON.stringify({
            ...customBody,
            ...(init?.body ? JSON.parse(init.body.toString()) : {}),
          })
        : init?.body,
      skipAuthRefresh: false,
    })
  }
}

/**
 * Creates an OpenAI-compatible provider for Jan API with authentication.
 * @param conversationId
 * @returns
 */
export function janProvider(
  conversationId?: string
): OpenAICompatibleProvider<string, string, string> {
  return createOpenAICompatible({
    name: 'janhq',
    baseURL: `${JAN_API_BASE_URL}v1`,
    fetch: createAuthenticatedFetch({
      store: true,
      store_reasoning: true,
      conversation: conversationId,
    }),
  })
}
