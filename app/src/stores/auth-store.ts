import { create } from 'zustand'
import { persist } from 'zustand/middleware'

declare const JAN_API_BASE_URL: string

interface User {
  id: string
  name: string
  email: string
  avatar?: string
  pro?: boolean
}

interface GuestLoginResponse {
  access_token: string
  expires_in: number
  principal_id: string
  refresh_token: string
  token_type: string
  user_id: string
  username: string
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isGuest: boolean
  accessToken: string | null
  refreshToken: string | null
  login: (user: User) => void
  logout: () => void
  guestLogin: () => Promise<void>
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
    }),
    {
      name: 'auth-storage',
    }
  )
)
