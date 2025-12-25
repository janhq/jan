import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { extractUserFromTokens } from '@/lib/oauth'
import { useGuestUsage } from './guest-usage-store'
import { fetchJsonWithAuth } from '@/lib/api-client'
import { usePrivateChat } from './private-chat-store'

declare const JAN_API_BASE_URL: string

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isGuest: boolean
  accessToken: string | null
  refreshToken: string | null
  login: (user: User) => void
  loginWithOAuth: (tokens: OAuthTokenResponse) => void
  logout: () => Promise<void>
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
      loginWithOAuth: (tokens) => {
        const userData = extractUserFromTokens(tokens)
        useGuestUsage.getState().reset()
        usePrivateChat.getState().setIsPrivateChat(false)
        set({
          user: {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            avatar: userData.avatar,
            pro: userData.pro,
          },
          isAuthenticated: true,
          isGuest: false,
          accessToken: userData.accessToken,
          refreshToken: userData.refreshToken,
        })
      },
      login: (user) => {
        useGuestUsage.getState().reset()
        usePrivateChat.getState().setIsPrivateChat(false)
        set({ user, isAuthenticated: true, isGuest: false })
      },
      logout: async () => {
        try {
          const refreshToken = useAuth.getState().refreshToken
          await fetchJsonWithAuth<{ status: string }>(
            `${JAN_API_BASE_URL}auth/logout`,
            {
              method: 'POST',
              body: JSON.stringify({ refresh_token: refreshToken }),
            }
          )

          // Clear all stores
          const { useProjects } = await import('@/stores/projects-store')
          const { useConversations } = await import(
            '@/stores/conversation-store'
          )
          useProjects.getState().clearProjects()
          useConversations.getState().clearConversations()
          set({
            user: null,
            isAuthenticated: false,
            isGuest: false,
            accessToken: null,
            refreshToken: null,
          })
        } catch (error) {
          console.error('Logout error:', error)
        }
      },
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
              }),
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
