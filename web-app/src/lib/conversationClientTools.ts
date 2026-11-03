import type { UIMessage } from 'ai'
import {
  dispatchClientTool,
  type PendingToolCall,
  type ToolOutcome,
} from './clientToolDispatch'
import { createConversationToolHandlers } from './conversationToolHandlers'
import { conversationTodos } from './conversationTaskPresentation'
import type {
  AskAnswer,
  AskRequestPayload,
  TodoList,
} from '@/types/coworkSession'

export type ConversationAskCard = { id: string; request: AskRequestPayload }
type Handlers = ReturnType<typeof createConversationToolHandlers>

/** One conversation's run-local state. No todo authority lives here: the
 * transcript is canonical; `pendingTodo` only bridges the gap between a todo
 * handler returning and its outcome being committed to the transcript. */
type Entry = {
  pendingAsks: Map<string, (answers: AskAnswer[] | null) => void>
  card: ConversationAskCard | null
  listeners: Set<(card: ConversationAskCard | null) => void>
  pendingTodo?: { signal: AbortSignal; list: TodoList; baseline: string | undefined }
  runs: WeakMap<AbortSignal, Handlers>
}

const entries = new Map<string, Entry>()

const entryOf = (threadId: string): Entry => {
  let entry = entries.get(threadId)
  if (!entry) {
    entry = {
      pendingAsks: new Map(),
      card: null,
      listeners: new Set(),
      runs: new WeakMap(),
    }
    entries.set(threadId, entry)
  }
  return entry
}

const setCard = (entry: Entry, card: ConversationAskCard | null) => {
  entry.card = card
  for (const listener of entry.listeners) listener(card)
}

export const conversationAskCard = (threadId: string) =>
  entries.get(threadId)?.card ?? null

const isIdle = (entry: Entry) =>
  !entry.card &&
  entry.pendingAsks.size === 0 &&
  !entry.pendingTodo &&
  entry.listeners.size === 0

const prune = (threadId: string, entry: Entry) => {
  if (entries.get(threadId) === entry && isIdle(entry)) entries.delete(threadId)
}

/** Thread removed/cleared: settle every suspended ask as cancelled, clear the
 * card (listeners are notified, then kept so a mounted view never holds a
 * stale entry) and forget the run projection. This module imports no store,
 * so stores may call it. */
export function dropConversationClientThread(threadId: string): void {
  const entry = entries.get(threadId)
  if (!entry) return
  const resolvers = [...entry.pendingAsks.values()]
  entry.pendingAsks.clear()
  entry.pendingTodo = undefined
  entry.runs = new WeakMap()
  setCard(entry, null)
  for (const resolve of resolvers) resolve(null)
  prune(threadId, entry)
}

/** Explicit session reset also settles any orphan runtime entries. */
export function dropAllConversationClientThreads(): void {
  for (const threadId of [...entries.keys()]) dropConversationClientThread(threadId)
}

/** Terminal onFinish, after any persistence attempt: release the run-local
 * todo bridge even on provider errors. Never touches a card or a pending
 * ask: a handler still waiting on the user is not finished. */
export function finishConversationClientRun(threadId: string): void {
  const entry = entries.get(threadId)
  if (!entry) return
  entry.pendingTodo = undefined
  prune(threadId, entry)
}

export function subscribeConversationAsk(
  threadId: string,
  listener: (card: ConversationAskCard | null) => void
): () => void {
  const entry = entryOf(threadId)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    prune(threadId, entry)
  }
}

/** CoworkAskCard onRespond. The existing handler validates the answers. */
export const respondConversationAsk = (
  threadId: string,
  id: string,
  answers: AskAnswer[] | null
) => {
  const entry = entries.get(threadId)
  const resolver = entry?.pendingAsks.get(id)
  if (!entry || !resolver) return
  // Same contract as Cowork's answerAsk: remove, then resolve.
  entry.pendingAsks.delete(id)
  resolver(answers)
}

export const isConversationClientTool = (name: string) =>
  name === 'todo' || name === 'ask'

const unsupported = async (): Promise<ToolOutcome> => ({
  output: 'ERROR: tool is not available in chat',
  isError: true,
})

/** Serves todo/ask for a Chat run. Returns undefined for any other name. */
export function dispatchConversationClientTool(
  call: PendingToolCall,
  opts: {
    threadId: string
    signal: AbortSignal
    getMessages: () => readonly UIMessage[]
  }
): Promise<ToolOutcome | undefined> {
  const { threadId, signal } = opts
  const entry = entryOf(threadId)
  let handlers = entry.runs.get(signal)
  if (!handlers) {
    handlers = createConversationToolHandlers({
      signal,
      getTodo: () => {
        const canonical = conversationTodos(opts.getMessages())
        const pending = entry.pendingTodo
        if (!pending || pending.signal !== signal) return canonical
        if (JSON.stringify(canonical) === JSON.stringify(pending.list) ||
          JSON.stringify(canonical) !== pending.baseline) {
          entry.pendingTodo = undefined
          return canonical
        }
        return pending.list
      },
      onTodo: (list) => {
        entry.pendingTodo = { signal, list, baseline: JSON.stringify(conversationTodos(opts.getMessages())) }
      },
      pendingAsks: entry.pendingAsks,
      showAsk: (id, request) => setCard(entry, { id, request }),
      hideAsk: (id) => {
        if (entry.card?.id === id) setCard(entry, null)
      },
    })
    entry.runs.set(signal, handlers)
    signal.addEventListener(
      'abort',
      () => {
        if (entry.pendingTodo?.signal === signal) entry.pendingTodo = undefined
      },
      { once: true }
    )
  }
  return dispatchClientTool(call, {
    ...handlers,
    onTask: unsupported,
    onMonitor: unsupported,
  })
}
