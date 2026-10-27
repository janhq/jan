import { create } from 'zustand'

export type ToolCallTiming = {
  /** Unset until the executor reaches this call. */
  startedAt?: number
  endedAt?: number
  /**
   * The tool loop that enqueued the call (chat: its thread). Loops of different
   * threads run at once, since a turn keeps going when the user opens another
   * thread, so queue position and settlement are per owner.
   */
  owner?: string
  /** The MCP server serving the call, so a progress update can find it. */
  server?: string
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
   * ahead of them start. Holds every owner's calls; see queuePositionOf.
   */
  queue: string[]
  timings: Record<string, ToolCallTiming>
  /** Latest progress update per call, cleared when the call settles. */
  progress: Record<string, ToolProgressUpdate>
  /**
   * Unified diff per `write`/`edit` call. Display-only: it deliberately never
   * enters the model-facing tool output, so it cannot travel on the message part
   * and needs a side channel. Unlike `progress` it is kept after the call
   * settles, since the diff is the whole point of the finished card.
   */
  diffs: Record<string, string>
}

type ToolCallRuntimeState = ToolCallRuntimeSnapshot & {
  /**
   * Starts a turn of `owner`'s loop, replacing what that loop still had queued.
   * Earlier timings are kept: their cards are still on screen and would
   * otherwise lose the duration they had been showing.
   */
  enqueue: (toolCallIds: string[], owner?: string) => void
  markRunning: (toolCallId: string, server?: string) => void
  markSettled: (toolCallId: string) => void
  /**
   * Records an MCP progress update against the running call. The notification
   * carries no tool call id, so the running call is the only thing it can
   * belong to: a loop runs its tools one at a time, and when loops of several
   * threads each have one running, the update's server picks between them. A
   * call whose server is known and differs never takes it, and an update that
   * still matches more than one call is dropped, not guessed. (Cowork does not
   * record servers; its calls take an update whenever they are the only one.)
   */
  reportProgress: (update: ToolProgressUpdate) => void
  /** Records a display-only diff against the call that produced it. */
  recordDiff: (toolCallId: string, diff: string) => void
  /**
   * Ends `owner`'s turn: nothing it still has queued will run, so stop showing
   * it as waiting. Another loop's queue is left alone.
   */
  settleRemaining: (owner?: string) => void
  /**
   * Drops the state of `owner`'s settled calls, for when the cards showing them
   * unmount. Its queued and running calls are kept: the loop may still be going
   * in the background, and what it settles from now on is there on return.
   */
  releaseSettled: (owner?: string) => void
  reset: () => void
}

/** The owner of calls enqueued without one. */
const NO_OWNER = ''

export function isToolCallRunning(timing: ToolCallTiming | undefined): boolean {
  return timing?.startedAt !== undefined && timing.endedAt === undefined
}

/**
 * The call currently executing, if any. Returns a primitive, so it is safe to
 * use directly as a store selector.
 */
export function findRunningToolCallId(
  timings: Record<string, ToolCallTiming>
): string | undefined {
  for (const [id, timing] of Object.entries(timings)) {
    if (isToolCallRunning(timing)) return id
  }
  return undefined
}

/**
 * A waiting call's place in its own loop's line (0 = next), or -1 once the
 * executor has reached it. Another thread's queued calls are not ahead of it.
 */
export function queuePositionOf(
  snapshot: Pick<ToolCallRuntimeSnapshot, 'queue' | 'timings'>,
  toolCallId: string
): number {
  const owner = snapshot.timings[toolCallId]?.owner ?? NO_OWNER
  return snapshot.queue
    .filter((id) => (snapshot.timings[id]?.owner ?? NO_OWNER) === owner)
    .indexOf(toolCallId)
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
  diffs: {},

  enqueue: (toolCallIds, owner = NO_OWNER) =>
    set((s) => {
      const timings = { ...s.timings }
      const owns = (id: string) => (timings[id]?.owner ?? NO_OWNER) === owner
      // A turn cannot start while a call from the same loop's previous one is
      // still running, so anything of this owner left running was stranded by a
      // severed turn (HMR in dev, a reload, a crashed executor). Left alone it
      // keeps ticking and steals the running slot from every later call.
      for (const [id, timing] of Object.entries(timings)) {
        if (owns(id) && isToolCallRunning(timing)) {
          timings[id] = { ...timing, endedAt: Date.now() }
        }
      }
      return {
        queue: [...s.queue.filter((id) => !owns(id)), ...toolCallIds],
        timings: {
          ...timings,
          ...Object.fromEntries(toolCallIds.map((id) => [id, { owner }])),
        },
      }
    }),

  markRunning: (toolCallId, server) =>
    set((s) =>
      s.timings[toolCallId]
        ? {
            queue: s.queue.filter((id) => id !== toolCallId),
            timings: {
              ...s.timings,
              [toolCallId]: {
                ...s.timings[toolCallId],
                startedAt: Date.now(),
                ...(server ? { server } : {}),
              },
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
      let running = Object.keys(s.timings).filter((id) => {
        const timing = s.timings[id]
        return (
          isToolCallRunning(timing) &&
          (timing.server === undefined || timing.server === update.server)
        )
      })
      if (running.length > 1) {
        running = running.filter((id) => s.timings[id].server === update.server)
      }
      return running.length === 1
        ? { progress: { ...s.progress, [running[0]]: update } }
        : s
    }),

  recordDiff: (toolCallId, diff) =>
    set((s) => ({ diffs: { ...s.diffs, [toolCallId]: diff } })),

  settleRemaining: (owner = NO_OWNER) =>
    set((s) => {
      const settled = s.queue.filter(
        (id) => (s.timings[id]?.owner ?? NO_OWNER) === owner
      )
      if (settled.length === 0) return s
      const now = Date.now()
      const timings = { ...s.timings }
      for (const id of settled) {
        timings[id] = { ...timings[id], endedAt: now }
      }
      return { queue: s.queue.filter((id) => !settled.includes(id)), timings }
    }),

  releaseSettled: (owner = NO_OWNER) =>
    set((s) => {
      const released = new Set(
        Object.keys(s.timings).filter(
          (id) =>
            (s.timings[id].owner ?? NO_OWNER) === owner &&
            !s.queue.includes(id) &&
            !isToolCallRunning(s.timings[id])
        )
      )
      if (released.size === 0) return s
      const keep = <T>(record: Record<string, T>) =>
        Object.fromEntries(
          Object.entries(record).filter(([id]) => !released.has(id))
        )
      return {
        timings: keep(s.timings),
        progress: keep(s.progress),
        diffs: keep(s.diffs),
      }
    }),

  reset: () => set({ queue: [], timings: {}, progress: {}, diffs: {} }),
}))

/**
 * Run one tool call with its timing recorded, so its card can show a live
 * duration instead of a bare spinner.
 *
 * For a caller that dispatches serially and so has no queue to report -- each
 * call is its own queue of one. The chat route enqueues a whole step up front
 * instead, which is what lets it also show "queued, 2nd in line".
 */
export async function withToolTiming<T>(
  toolCallId: string,
  run: () => Promise<T>
): Promise<T> {
  const runtime = useToolCallRuntime.getState()
  runtime.enqueue([toolCallId])
  runtime.markRunning(toolCallId)
  try {
    return await run()
  } finally {
    useToolCallRuntime.getState().markSettled(toolCallId)
  }
}
