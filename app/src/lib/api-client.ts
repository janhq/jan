/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible'

declare const JAN_API_BASE_URL: string
let isRefreshing = false
let refreshPromise: Promise<string> | null = null

export interface ApiErrorResponse {
  code: string
  error: string
  message: string
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code: string = '') {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ApiError'
  }

  /**
   * Check if this error is a duplicate project name error.
   * Returns true if status is 409 (Conflict) and the error code contains a project ID.
   */
  isDuplicateProjectName(): boolean {
    return this.status === 409 && this.code.startsWith('proj_')
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
  const isAuthenticated = useAuth.getState().isAuthenticated

  if (!isAuthenticated) {
    await useAuth.getState().guestLogin()
  }

  // Add authorization header
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${useAuth.getState().accessToken}`,
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
    // Try to parse JSON error response from server
    let errorMessage = 'Unknown error'
    let errorCode = ''

    try {
      const errorJson = (await response.json()) as ApiErrorResponse
      errorMessage = errorJson.message || errorJson.error || errorMessage
      errorCode = errorJson.code || ''
    } catch {
      // If JSON parsing fails, try to get text
      errorMessage = await response.text().catch(() => 'Unknown error')
    }

    throw new ApiError(response.status, errorMessage, errorCode)
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
  conversationId?: string,
  deepResearch?: boolean,
  isPrivateChat?: boolean,
  isEnableThinking: boolean = false
): OpenAICompatibleProvider<string, string, string> {
  return createOpenAICompatible({
    name: 'janhq',
    baseURL: `${JAN_API_BASE_URL}v1`,
    fetch: createAuthenticatedFetch({
      ...(!isPrivateChat && { store_reasoning: true }),
      ...(!isPrivateChat && { store: true }),
      ...(!isPrivateChat && { conversation: conversationId }),
      deep_research: deepResearch ?? false,
      enable_thinking: deepResearch ? true : isEnableThinking,
    }),
  })
}
