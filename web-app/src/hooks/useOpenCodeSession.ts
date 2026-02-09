import { create } from 'zustand'

/**
 * OpenCode session state
 */
export interface OpenCodeSession {
  sessionId: string
  projectPath: string
  agent: 'build' | 'plan' | 'explore'
  processTaskId: string | null
  conversationHistory: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }>
  filesModified: string[]
  startedAt: number
  lastActivityAt: number
}

/**
 * OpenCode session state interface
 */
interface OpenCodeSessionState {
  sessions: Map<string, OpenCodeSession>
  activeSessionId: string | null
  sessionTimeoutMs: number

  // Actions
  createSession: (
    projectPath: string,
    agent: 'build' | 'plan' | 'explore'
  ) => string
  getSession: (sessionId: string) => OpenCodeSession | undefined
  getActiveSession: () => OpenCodeSession | undefined
  updateSession: (sessionId: string, update: Partial<OpenCodeSession>) => void
  endSession: (sessionId: string) => void
  appendToHistory: (
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ) => void
  getConversationContext: (sessionId: string) => string
  setActiveSession: (sessionId: string | null) => void
  clearExpiredSessions: () => void
}

const DEFAULT_SESSION_TIMEOUT = 10 * 60 * 1000 // 10 minutes

export const useOpenCodeSession = create<OpenCodeSessionState>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,
  sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT,

  createSession: (projectPath, agent) => {
    const sessionId = crypto.randomUUID()
    const now = Date.now()

    const session: OpenCodeSession = {
      sessionId,
      projectPath,
      agent,
      processTaskId: null,
      conversationHistory: [],
      filesModified: [],
      startedAt: now,
      lastActivityAt: now,
    }

    const { sessions } = get()
    const newSessions = new Map(sessions)
    newSessions.set(sessionId, session)
    set({ sessions: newSessions, activeSessionId: sessionId })

    console.log('[useOpenCodeSession] Created session:', sessionId)
    return sessionId
  },

  getSession: (sessionId) => {
    return get().sessions.get(sessionId)
  },

  getActiveSession: () => {
    const { activeSessionId, sessions } = get()
    return activeSessionId ? sessions.get(activeSessionId) : undefined
  },

  updateSession: (sessionId, update) => {
    const { sessions } = get()
    const session = sessions.get(sessionId)
    if (!session) return

    const newSessions = new Map(sessions)
    newSessions.set(sessionId, { ...session, ...update, lastActivityAt: Date.now() })
    set({ sessions: newSessions })
  },

  endSession: (sessionId) => {
    const { sessions } = get()
    const session = sessions.get(sessionId)
    if (!session) return

    console.log('[useOpenCodeSession] Ending session:', sessionId)
    const newSessions = new Map(sessions)
    newSessions.delete(sessionId)
    set((state) => ({
      sessions: newSessions,
      activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
    }))
  },

  appendToHistory: (sessionId, role, content) => {
    const { sessions } = get()
    const session = sessions.get(sessionId)
    if (!session) return

    const newSessions = new Map(sessions)
    newSessions.set(sessionId, {
      ...session,
      conversationHistory: [
        ...session.conversationHistory,
        { role, content, timestamp: Date.now() },
      ],
      lastActivityAt: Date.now(),
    })
    set({ sessions: newSessions })
  },

  getConversationContext: (sessionId) => {
    const session = get().sessions.get(sessionId)
    if (!session) return ''

    const recentHistory = session.conversationHistory.slice(-10) // Last 5 exchanges
    if (recentHistory.length === 0) return ''

    return recentHistory
      .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
      .join('\n\n')
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId })
  },

  clearExpiredSessions: () => {
    const { sessions, sessionTimeoutMs } = get()
    const now = Date.now()
    const newSessions = new Map<string, OpenCodeSession>()
    let activeSessionChanged = false

    for (const [id, session] of sessions) {
      if (now - session.lastActivityAt < sessionTimeoutMs) {
        newSessions.set(id, session)
      } else {
        console.log('[useOpenCodeSession] Expired session:', id)
        if (get().activeSessionId === id) {
          activeSessionChanged = true
        }
      }
    }

    set((state) => ({
      sessions: newSessions,
      activeSessionId: activeSessionChanged ? null : state.activeSessionId,
    }))
  },
}))

// ============================================================================
// Selector Hooks
// ============================================================================

/**
 * Get the active OpenCode session
 */
export function useActiveOpenCodeSession() {
  return useOpenCodeSession((state) => state.getActiveSession())
}

/**
 * Get a specific session by ID
 */
export function useOpenCodeSessionById(sessionId: string | null) {
  return useOpenCodeSession((state) =>
    sessionId ? state.getSession(sessionId) : undefined
  )
}

/**
 * Get all active sessions
 */
export function useAllOpenCodeSessions() {
  return useOpenCodeSession((state) => Array.from(state.sessions.values()))
}

/**
 * Check if there are any active sessions
 */
export function useHasOpenCodeSessions() {
  return useOpenCodeSession((state) => state.sessions.size > 0)
}