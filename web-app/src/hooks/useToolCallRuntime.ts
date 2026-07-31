import { create } from 'zustand'

export type ToolCallTiming = {
  /** Unset until the executor reaches this call. */
  startedAt?: number
  endedAt?: number
}

/** A `notifications/progress` update from an MCP server. */
export type ToolProgressUpdate = {
  server: string
  progress: number
  total?: number
  message?: string
  /** Only set when the server reported a usable total. */
  percent?: number
}

/** The readable half of the store, for selectors defined outside it. */
export type ToolCallRuntimeSnapshot = {
  /**
   * Calls the executor has not reached yet, in execution order. Position is
   * read from here rather than stored per call, so entries move up as the ones
   * ahead of them start.
   */
  queue: string[]
  timings: Record<string, ToolCallTiming>
  /** Latest progress update per call, cleared when the call settles. */
  progress: Record<string, ToolProgressUpdate>
}

type ToolCallRuntimeState = ToolCallRuntimeSnapshot & {
  /**
   * Starts a turn. Earlier timings are kept: their cards are still on screen
   * and would otherwise lose the duration they had been showing.
   */
  enqueue: (toolCallIds: string[]) => void
  markRunning: (toolCallId: string) => void
  markSettled: (toolCallId: string) => void
  /**
   * Records an MCP progress update against the running call. The notification
   * carries no tool call id, so the running call is the only thing it can
   * belong to -- well defined because tools execute one at a time.
   */
  reportProgress: (update: ToolProgressUpdate) => void
  /** Ends a turn: nothing still queued will run, so stop showing it as waiting. */
  settleRemaining: () => void
  reset: () => void
}

/**
 * The call currently executing, if any. Returns a primitive, so it is safe to
 * use directly as a store selector.
 */
export function findRunningToolCallId(
  timings: Record<string, ToolCallTiming>
): string | undefined {
  for (const [id, timing] of Object.entries(timings)) {
    if (timing.startedAt !== undefined && timing.endedAt === undefined) {
      return id
    }
  }
  return undefined
}

/**
 * Timing and queue position for in-flight tool calls -- the two things the SDK
 * message part cannot express, since a queued call and a running one are both
 * `input-available`. Status itself stays derived from the part, so it is not
 * duplicated here.
 */
export const useToolCallRuntime = create<ToolCallRuntimeState>()((set) => ({
  queue: [],
  timings: {},
  progress: {},

  enqueue: (toolCallIds) =>
    set((s) => {
      const timings = { ...s.timings }
      // A turn cannot start while a call from the previous one is still
      // running, so anything left running was stranded by a severed turn (HMR
      // in dev, a reload, a crashed executor). Left alone it keeps ticking and
      // steals the running slot from every later call.
      const stranded = findRunningToolCallId(timings)
      if (stranded) {
        timings[stranded] = { ...timings[stranded], endedAt: Date.now() }
      }
      return {
        queue: [...toolCallIds],
        timings: {
          ...timings,
          ...Object.fromEntries(toolCallIds.map((id) => [id, {}])),
        },
      }
    }),

  markRunning: (toolCallId) =>
    set((s) =>
      s.timings[toolCallId]
        ? {
            queue: s.queue.filter((id) => id !== toolCallId),
            timings: {
              ...s.timings,
              [toolCallId]: { ...s.timings[toolCallId], startedAt: Date.now() },
            },
          }
        : s
    ),

  markSettled: (toolCallId) =>
    set((s) => {
      if (!s.timings[toolCallId]) return s
      const progress = { ...s.progress }
      delete progress[toolCallId]
      return {
        queue: s.queue.filter((id) => id !== toolCallId),
        timings: {
          ...s.timings,
          [toolCallId]: { ...s.timings[toolCallId], endedAt: Date.now() },
        },
        progress,
      }
    }),

  reportProgress: (update) =>
    set((s) => {
      const running = findRunningToolCallId(s.timings)
      return running ? { progress: { ...s.progress, [running]: update } } : s
    }),

  settleRemaining: () =>
    set((s) => {
      if (s.queue.length === 0) return s
      const now = Date.now()
      const timings = { ...s.timings }
      for (const id of s.queue) {
        timings[id] = { ...timings[id], endedAt: now }
      }
      return { queue: [], timings }
    }),

  reset: () => set({ queue: [], timings: {}, progress: {} }),
}))
