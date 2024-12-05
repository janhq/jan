import { Thread, ThreadContent, ThreadState } from '@janhq/core'

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import { ModelParams } from '@/types/model'

/**
 * Thread Modal Action Enum
 */
export enum ThreadModalAction {
  Clean = 'clean',
  Delete = 'delete',
  EditTitle = 'edit-title',
}

const ACTIVE_SETTING_INPUT_BOX = 'activeSettingInputBox'

/**
 * Enum for the keys used to store models in the local storage.
 */
enum ThreadStorageAtomKeys {
  ThreadStates = 'threadStates',
  ThreadList = 'threadList',
  ThreadListReady = 'threadListReady',
}

//// Threads Atom
/**
 * Stores all thread states for the current user
 */
export const threadStatesAtom = atomWithStorage<Record<string, ThreadState>>(
  ThreadStorageAtomKeys.ThreadStates,
  {}
)

/**
 * Stores all threads for the current user
 */
export const threadsAtom = atomWithStorage<Thread[]>(
  ThreadStorageAtomKeys.ThreadList,
  []
)

/**
 * Whether thread data is ready or not
 * */
export const threadDataReadyAtom = atomWithStorage<boolean>(
  ThreadStorageAtomKeys.ThreadListReady,
  false
)

/**
 * Store model params at thread level settings
 */
export const threadModelParamsAtom = atom<Record<string, ModelParams>>({})

//// End Thread Atom

/// Active Thread Atom
/**
 * Stores the current active thread id.
 */
const activeThreadIdAtom = atom<string | undefined>(undefined)

/**
 * Get the active thread id
 */
export const getActiveThreadIdAtom = atom((get) => get(activeThreadIdAtom))

/**
 * Set the active thread id
 */
export const setActiveThreadIdAtom = atom(
  null,
  (_get, set, threadId: string | undefined) => set(activeThreadIdAtom, threadId)
)

/**
 * Get the current active thread metadata
 */
export const activeThreadAtom = atom<Thread | undefined>((get) =>
  get(threadsAtom).find((c) => c.id === get(getActiveThreadIdAtom))
)

/**
 * Get the active thread state
 */
export const activeThreadStateAtom = atom<ThreadState | undefined>((get) => {
  const threadId = get(activeThreadIdAtom)
  if (!threadId) {
    console.debug('Active thread id is undefined')
    return undefined
  }

  return get(threadStatesAtom)[threadId]
})

/**
 * Get the active thread model params
 */
export const getActiveThreadModelParamsAtom = atom<ModelParams | undefined>(
  (get) => {
    const threadId = get(activeThreadIdAtom)
    if (!threadId) {
      console.debug('Active thread id is undefined')
      return undefined
    }

    return get(threadModelParamsAtom)[threadId]
  }
)
/// End Active Thread Atom

/// Threads State Atom
export const engineParamsUpdateAtom = atom<boolean>(false)

/**
 * Whether the thread is waiting to send a message
 */
export const waitingToSendMessage = atom<boolean | undefined>(undefined)

/**
 * Whether the thread is generating a response
 */
export const isGeneratingResponseAtom = atom<boolean | undefined>(undefined)

/**
 * Remove a thread state from the atom
 */
export const deleteThreadStateAtom = atom(
  null,
  (get, set, threadId: string) => {
    const currentState = { ...get(threadStatesAtom) }
    delete currentState[threadId]
    set(threadStatesAtom, currentState)
  }
)

/**
 * Update the thread state with the new state
 */
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

/**
 * Update the thread last message
 */
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

/**
 * Update a thread with the new thread metadata
 */
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
 * Update the thread model params
 */
export const setThreadModelParamsAtom = atom(
  null,
  (get, set, threadId: string, params: ModelParams) => {
    const currentState = { ...get(threadModelParamsAtom) }
    currentState[threadId] = params
    set(threadModelParamsAtom, currentState)
  }
)

/**
 * Settings input box active state
 */
export const activeSettingInputBoxAtom = atomWithStorage<boolean>(
  ACTIVE_SETTING_INPUT_BOX,
  true,
  undefined,
  { getOnInit: true }
)

/**
 * Whether thread thread is presenting a Modal or not
 */
export const modalActionThreadAtom = atom<{
  showModal: ThreadModalAction | undefined
  thread: Thread | undefined
}>({
  showModal: undefined,
  thread: undefined,
})

/// Ebd Threads State Atom
