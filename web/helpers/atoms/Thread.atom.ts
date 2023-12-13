import {
  ModelRuntimeParams,
  Thread,
  ThreadContent,
  ThreadState,
} from '@janhq/core'
import { atom } from 'jotai'

/**
 * Stores the current active thread id.
 */
const activeThreadIdAtom = atom<string | undefined>(undefined)

export const getActiveThreadIdAtom = atom((get) => get(activeThreadIdAtom))

export const setActiveThreadIdAtom = atom(
  null,
  (_get, set, threadId: string | undefined) => set(activeThreadIdAtom, threadId)
)

export const waitingToSendMessage = atom<boolean | undefined>(undefined)

/**
 * Stores all thread states for the current user
 */
export const threadStatesAtom = atom<Record<string, ThreadState>>({})
export const activeThreadStateAtom = atom<ThreadState | undefined>((get) => {
  const threadId = get(activeThreadIdAtom)
  if (!threadId) {
    console.debug('Active thread id is undefined')
    return undefined
  }

  return get(threadStatesAtom)[threadId]
})

export const deleteThreadStateAtom = atom(
  null,
  (get, set, threadId: string) => {
    const currentState = { ...get(threadStatesAtom) }
    delete currentState[threadId]
    set(threadStatesAtom, currentState)
  }
)

export const updateThreadInitSuccessAtom = atom(
  null,
  (get, set, threadId: string) => {
    const currentState = { ...get(threadStatesAtom) }
    currentState[threadId] = {
      ...currentState[threadId],
      isFinishInit: true,
    }
    set(threadStatesAtom, currentState)
  }
)

export const updateThreadWaitingForResponseAtom = atom(
  null,
  (get, set, threadId: string, waitingForResponse: boolean) => {
    const currentState = { ...get(threadStatesAtom) }
    currentState[threadId] = {
      ...currentState[threadId],
      waitingForResponse,
      error: undefined,
    }
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

/**
 * Store model params at thread level settings
 */
export const threadModelRuntimeParamsAtom = atom<
  Record<string, ModelRuntimeParams>
>({})

export const getActiveThreadModelRuntimeParamsAtom = atom<
  ModelRuntimeParams | undefined
>((get) => {
  const threadId = get(activeThreadIdAtom)
  if (!threadId) {
    console.debug('Active thread id is undefined')
    return undefined
  }

  return get(threadModelRuntimeParamsAtom)[threadId]
})

export const getThreadModelRuntimeParamsAtom = atom(
  (get, threadId: string) => get(threadModelRuntimeParamsAtom)[threadId]
)

export const setThreadModelRuntimeParamsAtom = atom(
  null,
  (get, set, threadId: string, params: ModelRuntimeParams) => {
    const currentState = { ...get(threadModelRuntimeParamsAtom) }
    currentState[threadId] = params
    console.debug(
      `Update model params for thread ${threadId}, ${JSON.stringify(
        params,
        null,
        2
      )}`
    )
    set(threadModelRuntimeParamsAtom, currentState)
  }
)
