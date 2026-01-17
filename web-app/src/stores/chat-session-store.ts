/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from "zustand";
import type { Chat, UIMessage } from "@ai-sdk/react";
import type { ChatStatus } from "ai";
import { CustomChatTransport } from "@/lib/custom-chat-transport";
// import { showChatCompletionToast } from "@/components/toasts/chat-completion-toast";

export type SessionData = {
  tools: any[];
  messages: UIMessage[];
  idMap: Map<string, string>;
};

export type ChatSession = {
  chat: Chat<UIMessage>;
  transport: CustomChatTransport;
  status: ChatStatus;
  title?: string;
  isStreaming: boolean;
  unsubscribers: Array<() => void>;
  data: SessionData;
};

interface ChatSessionState {
  sessions: Record<string, ChatSession>;
  activeConversationId?: string;
  setActiveConversationId: (conversationId?: string) => void;
  ensureSession: (
    sessionId: string,
    transport: CustomChatTransport,
    createChat: () => Chat<UIMessage>,
    title?: string,
  ) => Chat<UIMessage>;
  getSessionData: (sessionId: string) => SessionData;
  updateStatus: (sessionId: string, status: ChatStatus) => void;
  setSessionTitle: (sessionId: string, title?: string) => void;
  removeSession: (sessionId: string) => void;
  clearSessions: () => void;
}

const STREAMING_STATUSES: ChatStatus[] = [
  'submitted',
  'streaming',
];

// Pure helper function for checking if a session is busy (for reactive use in components)
export function isSessionBusy(session: ChatSession | undefined): boolean {
  return session?.isStreaming || (session?.data?.tools?.length ?? 0) > 0;
}

const createSessionData = (): SessionData => ({
  tools: [],
  messages: [],
  idMap: new Map<string, string>(),
});

// Standalone data store for sessions that don't have a Chat yet
const standaloneData: Record<string, SessionData> = {};

export const useChatSessions = create<ChatSessionState>((set, get) => ({
  sessions: {},
  activeConversationId: undefined,
  setActiveConversationId: (conversationId) =>
    set({ activeConversationId: conversationId }),
  ensureSession: (sessionId, transport, createChat, title) => {
    // Set active immediately - prevents toast for this session during status sync
    // Only update activeConversationId if it changed (avoid unnecessary state updates during render)
    if (get().activeConversationId !== sessionId) {
      set({ activeConversationId: sessionId });
    }

    const existing = get().sessions[sessionId];
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
        }));
      }
      return existing.chat;
    }

    const chat = createChat();
    const syncStatus = () => {
      get().updateStatus(sessionId, chat.status);
    };
    const unsubscribeStatus = chat["~registerStatusCallback"]
      ? chat["~registerStatusCallback"](syncStatus)
      : undefined;

    // Use existing standalone data if available, otherwise create new
    const data = standaloneData[sessionId] ?? createSessionData();
    delete standaloneData[sessionId]; // Move to session

    const newSession: ChatSession = {
      chat,
      transport,
      status: chat.status,
      title,
      isStreaming: STREAMING_STATUSES.includes(chat.status),
      unsubscribers: unsubscribeStatus ? [unsubscribeStatus] : [],
      data,
    };

    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: newSession,
      },
    }));

    return chat;
  },
  getSessionData: (sessionId) => {
    const existing = get().sessions[sessionId];
    if (existing) {
      return existing.data;
    }
    // Return or create standalone data for sessions without a Chat yet
    if (!standaloneData[sessionId]) {
      standaloneData[sessionId] = createSessionData();
    }
    return standaloneData[sessionId];
  },
  updateStatus: (sessionId, status) => {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) {
        return state;
      }

      const wasStreaming = existing.isStreaming;
      const isStreaming = STREAMING_STATUSES.includes(status);
      if (existing.status === status && wasStreaming === isStreaming) {
        return state;
      }

      // Only notify if:
      // 1. Was streaming and now stopped
      // 2. Not the active conversation
      // 3. Chat has messages (not a brand new session)
      // 4. No pending tool calls (tools are still being executed)
      // const hasMessages = existing.chat.messages.length > 0;
      // const hasPendingTools = existing.data.tools.length > 0;
      // const shouldNotify =
      //   wasStreaming &&
      //   !isStreaming &&
      //   hasMessages &&
      //   !hasPendingTools &&
      //   state.activeConversationId !== sessionId;

      // if (shouldNotify) {
      //   const title = existing.title ?? "Conversation";
      //   showChatCompletionToast(title, existing.chat.messages, sessionId);
      // }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            status,
            isStreaming,
          },
        },
      };
    });
  },
  setSessionTitle: (sessionId, title) => {
    if (!title) return;

    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing || existing.title === title) {
        return state;
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, title },
        },
      };
    });
  },
  removeSession: (sessionId) => {
    const existing = get().sessions[sessionId];
    if (!existing) {
      delete standaloneData[sessionId];
      return;
    }

    // Remove from store FIRST - prevents updateStatus from showing toast during cleanup
    set((state) => {
      if (!state.sessions[sessionId]) {
        return state;
      }
      const rest = { ...state.sessions };
      delete rest[sessionId];
      return { sessions: rest };
    });

    // Then cleanup (existing is a copy, safe to use after removal)
    existing.unsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("Failed to unsubscribe chat session listener", error);
      }
    });
    try {
      existing.chat.stop();
    } catch (error) {
      console.error("Failed to stop chat session", error);
    }

    delete standaloneData[sessionId];
  },
  clearSessions: () => {
    const sessions = get().sessions;
    Object.values(sessions).forEach((session) => {
      session.unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          console.error("Failed to unsubscribe chat session listener", error);
        }
      });
      try {
        session.chat.stop();
      } catch (error) {
        console.error("Failed to stop chat session", error);
      }
    });

    // Clear standalone data
    Object.keys(standaloneData).forEach((key) => {
      delete standaloneData[key];
    });

    set({ sessions: {}, activeConversationId: undefined });
  },
}));
