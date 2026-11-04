import { create } from 'zustand'

/**
 * Display-only monitor completion notices for Chat threads. This store has NO
 * authority: it never feeds the model inbox, never starts a run, and dismissing
 * a notice does not consume the MonitorLane ping the next user turn receives.
 */
export const MONITOR_NOTICE_MAX_CHARS = 600
export const MONITOR_NOTICE_MAX_PER_THREAD = 5

export type MonitorNotice = {
  id: string
  threadId: string
  monitorId: string
  /** Bounded plain text; rendered as text, never markdown/HTML. */
  headline: string
  detail: string
  at: number
}

type MonitorNoticeState = {
  byThread: Record<string, MonitorNotice[]>
  publish: (notice: { threadId: string; monitorId: string; headline: string; text: string }) => void
  dismiss: (threadId: string, id: string) => void
  clearThread: (threadId: string) => void
}

const EMPTY: MonitorNotice[] = []
let seq = 0

/** Bound by UTF-16 code units without splitting a surrogate pair. */
export const boundNoticeText = (value: unknown, max = MONITOR_NOTICE_MAX_CHARS): string => {
  const text = typeof value === 'string' ? value : ''
  if (text.length <= max) return text
  let end = max - 1
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return `${text.slice(0, end)}…`
}

export const useMonitorNotices = create<MonitorNoticeState>()((set) => ({
  byThread: {},
  publish: ({ threadId, monitorId, headline, text }) =>
    set((state) => {
      const list = state.byThread[threadId] ?? EMPTY
      const notice: MonitorNotice = {
        id: `${monitorId}:${++seq}`,
        threadId,
        monitorId,
        headline: boundNoticeText(headline, 160),
        detail: boundNoticeText(text),
        at: Date.now(),
      }
      return {
        byThread: {
          ...state.byThread,
          [threadId]: [...list, notice].slice(-MONITOR_NOTICE_MAX_PER_THREAD),
        },
      }
    }),
  dismiss: (threadId, id) =>
    set((state) => {
      const list = state.byThread[threadId]
      if (!list?.some((n) => n.id === id)) return state
      const next = list.filter((n) => n.id !== id)
      const byThread = { ...state.byThread }
      if (next.length) byThread[threadId] = next
      else delete byThread[threadId]
      return { byThread }
    }),
  clearThread: (threadId) =>
    set((state) => {
      if (!(threadId in state.byThread)) return state
      const byThread = { ...state.byThread }
      delete byThread[threadId]
      return { byThread }
    }),
}))

/** Stable empty array so selectors don't re-render on unrelated threads. */
export const selectThreadNotices = (threadId: string | undefined) => (state: MonitorNoticeState) =>
  (threadId && state.byThread[threadId]) || EMPTY
