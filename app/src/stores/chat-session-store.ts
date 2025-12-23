import { create } from 'zustand'
import type { Chat, UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import { toast } from 'sonner'
import { CustomChatTransport } from '@/lib/custom-chat-transport'

type ChatSession = {
  chat: Chat<UIMessage>
  transport: CustomChatTransport
  status: ChatStatus
  title?: string
  isStreaming: boolean
  unsubscribers: Array<() => void>
}

interface ChatSessionState {
  sessions: Record<string, ChatSession>
  activeConversationId?: string
  setActiveConversationId: (conversationId?: string) => void
  ensureSession: (
    sessionId: string,
    transport: CustomChatTransport,
    createChat: () => Chat<UIMessage>,
    title?: string
  ) => Chat<UIMessage>
  updateStatus: (sessionId: string, status: ChatStatus) => void
  setSessionTitle: (sessionId: string, title?: string) => void
  removeSession: (sessionId: string) => void
  clearSessions: () => void
}

const STREAMING_STATUSES: ChatStatus[] = ['submitted', 'streaming']

export const useChatSessions = create<ChatSessionState>((set, get) => ({
  sessions: {},
  activeConversationId: undefined,
  setActiveConversationId: (conversationId) => set({ activeConversationId: conversationId }),
  ensureSession: (sessionId, transport, createChat, title) => {
    const existing = get().sessions[sessionId]
    if (existing) {
      // Keep transport and title in sync if they changed
      if (existing.transport !== transport || existing.title !== title) {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...existing,
              transport,
              title: title ?? existing.title,
            },
          },
        }))
      }
      return existing.chat
    }

    const chat = createChat()
    const syncStatus = () => {
      get().updateStatus(sessionId, chat.status)
    }
    const unsubscribeStatus = chat['~registerStatusCallback']
      ? chat['~registerStatusCallback'](syncStatus)
      : undefined

    const newSession: ChatSession = {
      chat,
      transport,
      status: chat.status,
      title,
      isStreaming: STREAMING_STATUSES.includes(chat.status),
      unsubscribers: unsubscribeStatus ? [unsubscribeStatus] : [],
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: newSession,
      },
    }))

    return chat
  },
  updateStatus: (sessionId, status) => {
    set((state) => {
      const existing = state.sessions[sessionId]
      if (!existing) {
        return state
      }

      const wasStreaming = existing.isStreaming
      const isStreaming = STREAMING_STATUSES.includes(status)
      if (existing.status === status && wasStreaming === isStreaming) {
        return state
      }
      const shouldNotify =
        wasStreaming &&
        !isStreaming &&
        state.activeConversationId !== sessionId

      if (shouldNotify) {
        const title = existing.title ?? 'Conversation'
        toast.info(`${title} finished streaming`)
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            status,
            isStreaming,
          },
        },
      }
    })
  },
  setSessionTitle: (sessionId, title) => {
    if (!title) return

    set((state) => {
      const existing = state.sessions[sessionId]
      if (!existing || existing.title === title) {
        return state
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, title },
        },
      }
    })
  },
  removeSession: (sessionId) => {
    const existing = get().sessions[sessionId]
    if (existing) {
      existing.unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe()
        } catch (error) {
          console.error('Failed to unsubscribe chat session listener', error)
        }
      })
      try {
        existing.chat.stop()
      } catch (error) {
        console.error('Failed to stop chat session', error)
      }
    }

    set((state) => {
      if (!state.sessions[sessionId]) {
        return state
      }
      const rest = { ...state.sessions }
      delete rest[sessionId]
      return { sessions: rest }
    })
  },
  clearSessions: () => {
    const sessions = get().sessions
    Object.values(sessions).forEach((session) => {
      session.unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe()
        } catch (error) {
          console.error('Failed to unsubscribe chat session listener', error)
        }
      })
      try {
        session.chat.stop()
      } catch (error) {
        console.error('Failed to stop chat session', error)
      }
    })

    set({ sessions: {}, activeConversationId: undefined })
  },
}))
