import { create } from 'zustand'
import type { Chat, UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import { CustomChatTransport } from '@/lib/custom-chat-transport'
import { showChatCompletionToast } from '@/components/chat-completion-toast'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SessionMemory = {
  tools: any[]
  messages: UIMessage[]
  idMap: Map<string, string>
}

type ChatSession = {
  chat: Chat<UIMessage>
  transport: CustomChatTransport
  status: ChatStatus
  title?: string
  isStreaming: boolean
  unsubscribers: Array<() => void>
  memory: SessionMemory
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
  getSessionMemory: (sessionId: string) => SessionMemory
  updateStatus: (sessionId: string, status: ChatStatus) => void
  setSessionTitle: (sessionId: string, title?: string) => void
  removeSession: (sessionId: string) => void
  clearSessions: () => void
}

const STREAMING_STATUSES: ChatStatus[] = ['submitted', 'streaming']

const createSessionMemory = (): SessionMemory => ({
  tools: [],
  messages: [],
  idMap: new Map<string, string>(),
})

// Standalone memory store for sessions that don't have a Chat yet
const standaloneMemory: Record<string, SessionMemory> = {}

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

    // Use existing standalone memory if available, otherwise create new
    const memory = standaloneMemory[sessionId] ?? createSessionMemory()
    delete standaloneMemory[sessionId] // Move to session

    const newSession: ChatSession = {
      chat,
      transport,
      status: chat.status,
      title,
      isStreaming: STREAMING_STATUSES.includes(chat.status),
      unsubscribers: unsubscribeStatus ? [unsubscribeStatus] : [],
      memory,
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: newSession,
      },
    }))

    return chat
  },
  getSessionMemory: (sessionId) => {
    const existing = get().sessions[sessionId]
    if (existing) {
      return existing.memory
    }
    // Return or create standalone memory for sessions without a Chat yet
    if (!standaloneMemory[sessionId]) {
      standaloneMemory[sessionId] = createSessionMemory()
    }
    return standaloneMemory[sessionId]
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

      // Only notify if:
      // 1. Was streaming and now stopped
      // 2. Not the active conversation
      // 3. Chat has messages (not a brand new session)
      // 4. No pending tool calls (tools are still being executed)
      const hasMessages = existing.chat.messages.length > 0
      const hasPendingTools = existing.memory.tools.length > 0
      const shouldNotify =
        wasStreaming &&
        !isStreaming &&
        hasMessages &&
        !hasPendingTools &&
        state.activeConversationId !== sessionId

      if (shouldNotify) {
        const title = existing.title ?? 'Conversation'
        showChatCompletionToast(title, existing.chat.messages, sessionId)
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

    // Also clean up standalone memory
    delete standaloneMemory[sessionId]

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

    // Clear standalone memory
    Object.keys(standaloneMemory).forEach((key) => {
      delete standaloneMemory[key]
    })

    set({ sessions: {}, activeConversationId: undefined })
  },
}))
