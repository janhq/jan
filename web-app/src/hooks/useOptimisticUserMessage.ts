import { create } from 'zustand'

import type { UIMessage } from '@ai-sdk/react'

/**
 * Reactive store for the optimistic user message rendered while a fresh
 * thread is still being created and its attachments indexed. The message is
 * stashed by ChatInput **before** navigation so the new thread page can
 * render the bubble on its very first paint, without depending on
 * `useState`-lazy-initializer timing (which is unreliable under React
 * StrictMode's mount → unmount → remount dev simulation).
 *
 * The thread page clears the entry synchronously, right before queueing the
 * real `sendMessage`, so the real UIMessage replaces the optimistic one in
 * the same render with no flicker.
 */
type OptimisticUserMessageStore = {
  byThread: Record<string, UIMessage>
  set: (threadId: string, message: UIMessage) => void
  clear: (threadId: string) => void
}

export const useOptimisticUserMessage = create<OptimisticUserMessageStore>()(
  (set) => ({
    byThread: {},
    set: (threadId, message) =>
      set((state) => ({
        byThread: { ...state.byThread, [threadId]: message },
      })),
    clear: (threadId) =>
      set((state) => {
        if (!(threadId in state.byThread)) return state
        const next = { ...state.byThread }
        delete next[threadId]
        return { byThread: next }
      }),
  })
)
