import { create } from 'zustand'
import { persist } from 'zustand/middleware'

declare const JAN_API_BASE_URL: string

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isGuest: boolean
  accessToken: string | null
  refreshToken: string | null
  login: (user: User) => void
  logout: () => void
  guestLogin: () => Promise<void>
  refreshAccessToken: () => Promise<void>
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isGuest: false,
      accessToken: null,
      refreshToken: null,
      login: (user) => set({ user, isAuthenticated: true, isGuest: false }),
      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
          isGuest: false,
          accessToken: null,
          refreshToken: null,
        }),
      guestLogin: async () => {
        try {
          const response = await fetch(`${JAN_API_BASE_URL}/auth/guest-login`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
          })

          if (!response.ok) {
            throw new Error(
              `Guest login failed: ${response.status} ${response.statusText}`
            )
          }
          const data: GuestLoginResponse = await response.json()
          const guestUser: User = {
            id: data.user_id,
            name: data.username,
            email: '',
          }

          set({
            user: guestUser,
            isAuthenticated: true,
            isGuest: true,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          })
        } catch (error) {
          console.error('Guest login error:', error)
          throw error
        }
      },
      refreshAccessToken: async () => {
        try {
          const response = await fetch(
            `${JAN_API_BASE_URL}auth/refresh-token`,
            {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                refresh_token: useAuth.getState().refreshToken,
              })
            }
          )

          if (!response.ok) {
            throw new Error(
              `Token refresh failed: ${response.status} ${response.statusText}`
            )
          }

          const data: RefreshTokenResponse = await response.json()

          set({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          })
        } catch (error) {
          console.error('Token refresh error:', error)
          set({
            user: null,
            isAuthenticated: false,
            isGuest: false,
            accessToken: null,
            refreshToken: null,
          })
          throw error
        }
      },
    }),
    {
      name: 'auth-storage',
    }
  )
)
