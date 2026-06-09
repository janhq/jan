import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import {
  CHAT_SIDE_PANEL_DEFAULT_WIDTH,
} from '@/constants/chat-side-panel'
import { localStorageKey } from '@/constants/localStorage'

export type ChatSessionUiState = {
  sidePanelOpen: boolean
  sidePanelWidth: string
  sidePanelActiveSection: string
  sidePanelOpenTabs?: string[]
  bottomPanelOpen: boolean
  bottomPanelHeight: string
  bottomPanelActiveSection: string
  bottomPanelOpenTabs?: string[]
  browserAddressInput: string
  browserActiveUrl: string | null
  terminalActiveSessionId: string | null
  terminalLinkedSessionIds: string[]
}

type ChatSessionStateStore = {
  bySession: Record<string, ChatSessionUiState>
  getSession: (sessionId: string) => ChatSessionUiState
  patchSession: (
    sessionId: string,
    patch: Partial<ChatSessionUiState>
  ) => void
  transferSession: (fromId: string, toId: string) => void
  clearSession: (sessionId: string) => void
}

const DEFAULT_CHAT_SESSION_UI_STATE: ChatSessionUiState = {
  sidePanelOpen: true,
  sidePanelWidth: CHAT_SIDE_PANEL_DEFAULT_WIDTH,
  sidePanelActiveSection: 'files',
  sidePanelOpenTabs: ['files', 'side-chat', 'review', 'terminal', 'browser'],
  bottomPanelOpen: false,
  bottomPanelHeight: '18rem',
  bottomPanelActiveSection: 'terminal',
  bottomPanelOpenTabs: ['terminal', 'browser'],
  browserAddressInput: '',
  browserActiveUrl: null,
  terminalActiveSessionId: null,
  terminalLinkedSessionIds: [],
}

/** Stable default used for reads; patchSession always copies into bySession. */
export const defaultChatSessionUiState = (): ChatSessionUiState =>
  DEFAULT_CHAT_SESSION_UI_STATE

export const useChatSessionState = create<ChatSessionStateStore>()(
  persist(
    (set, get) => ({
      bySession: {},

      getSession: (sessionId) =>
        get().bySession[sessionId] ?? DEFAULT_CHAT_SESSION_UI_STATE,

      patchSession: (sessionId, patch) =>
        set((state) => ({
          bySession: {
            ...state.bySession,
            [sessionId]: {
              ...(state.bySession[sessionId] ?? DEFAULT_CHAT_SESSION_UI_STATE),
              ...patch,
            },
          },
        })),

      transferSession: (fromId, toId) =>
        set((state) => {
          const source = state.bySession[fromId]
          if (!source) return state
          const bySession = { ...state.bySession, [toId]: { ...source } }
          delete bySession[fromId]
          return { bySession }
        }),

      clearSession: (sessionId) =>
        set((state) => {
          const bySession = { ...state.bySession }
          delete bySession[sessionId]
          return { bySession }
        }),
    }),
    {
      name: localStorageKey.chatSessionState,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ bySession: state.bySession }),
    }
  )
)