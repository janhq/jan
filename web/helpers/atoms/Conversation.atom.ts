import { Thread, ThreadContent, ThreadState } from '@janhq/core'
import { atom } from 'jotai'

/**
 * Stores the current active conversation id.
 */
const activeThreadIdAtom = atom<string | undefined>(undefined)

export const getActiveThreadIdAtom = atom((get) => get(activeThreadIdAtom))

export const setActiveThreadIdAtom = atom(
  null,
  (_get, set, convoId: string | undefined) => set(activeThreadIdAtom, convoId)
)

export const waitingToSendMessage = atom<boolean | undefined>(undefined)

/**
 * Stores all thread states for the current user
 */
export const threadStatesAtom = atom<Record<string, ThreadState>>({})
export const activeThreadStateAtom = atom<ThreadState | undefined>((get) => {
  const activeConvoId = get(activeThreadIdAtom)
  if (!activeConvoId) {
    console.debug('Active convo id is undefined')
    return undefined
  }

  return get(threadStatesAtom)[activeConvoId]
})

export const updateConversationWaitingForResponseAtom = atom(
  null,
  (get, set, conversationId: string, waitingForResponse: boolean) => {
    const currentState = { ...get(threadStatesAtom) }
    currentState[conversationId] = {
      ...currentState[conversationId],
      waitingForResponse,
      error: undefined,
    }
    set(threadStatesAtom, currentState)
  }
)
export const updateConversationErrorAtom = atom(
  null,
  (get, set, conversationId: string, error?: Error) => {
    const currentState = { ...get(threadStatesAtom) }
    currentState[conversationId] = {
      ...currentState[conversationId],
      error,
    }
    set(threadStatesAtom, currentState)
  }
)
export const updateConversationHasMoreAtom = atom(
  null,
  (get, set, conversationId: string, hasMore: boolean) => {
    const currentState = { ...get(threadStatesAtom) }
    currentState[conversationId] = { ...currentState[conversationId], hasMore }
    set(threadStatesAtom, currentState)
  }
)

export const updateThreadStateLastMessageAtom = atom(
  null,
  (get, set, threadId: string, lastContent?: ThreadContent[]) => {
    const currentState = { ...get(threadStatesAtom) }
    const lastMessage = lastContent?.[0]?.text?.value ?? ''
    currentState[threadId] = {
      ...currentState[threadId],
      lastMessage,
    }
    set(threadStatesAtom, currentState)
  }
)

export const updateThreadAtom = atom(
  null,
  (get, set, updatedThread: Thread) => {
    const threads: Thread[] = get(threadsAtom).map((c) =>
      c.id === updatedThread.id ? updatedThread : c
    )

    // sort new threads based on updated at
    threads.sort((thread1, thread2) => {
      const aDate = new Date(thread1.updated ?? 0)
      const bDate = new Date(thread2.updated ?? 0)
      return bDate.getTime() - aDate.getTime()
    })

    set(threadsAtom, threads)
  }
)

/**
 * Stores all threads for the current user
 */
export const threadsAtom = atom<Thread[]>([])

export const activeThreadAtom = atom<Thread | undefined>((get) =>
  get(threadsAtom).find((c) => c.id === get(getActiveThreadIdAtom))
)
