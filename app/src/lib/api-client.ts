/* eslint-disable @typescript-eslint/no-unused-vars */
declare const JAN_API_BASE_URL: string

interface RefreshTokenResponse {
  refresh_token: string
}

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

async function refreshAccessToken(): Promise<RefreshTokenResponse> {
  const response = await fetch(`${JAN_API_BASE_URL}auth/refresh-token`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `Token refresh failed: ${response.statusText}`
    )
  }

  return response.json()
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
        const refreshData = await refreshAccessToken()

        // Update auth store with new tokens
        const { useAuth: freshAuthStore } = await import('@/stores/auth-store')
        freshAuthStore.setState({
          accessToken: refreshData.refresh_token,
          refreshToken: refreshData.refresh_token,
        })

        return refreshData.refresh_token
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
