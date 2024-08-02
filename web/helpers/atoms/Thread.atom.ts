import { ModelRuntimeParams, ModelSettingParams, Thread } from '@janhq/core'

import { atom } from 'jotai'

import {
  downloadedModelsAtom,
  getSelectedModelAtom,
  updateSelectedModelAtom,
} from './Model.atom'

const threadIdShouldAnimateTitle = atom<string[]>([])

export const getThreadIdsShouldAnimateTitleAtom = atom((get) =>
  get(threadIdShouldAnimateTitle)
)

export const addThreadIdShouldAnimateTitleAtom = atom(
  null,
  (_get, set, threadId: string) => {
    set(threadIdShouldAnimateTitle, (current) => [...current, threadId])
  }
)

/**
 * Stores the current active thread id.
 */
const activeThreadIdAtom = atom<string | undefined>(undefined)

export const getActiveThreadIdAtom = atom((get) => get(activeThreadIdAtom))

export const setActiveThreadIdAtom = atom(
  null,
  (get, set, threadId: string | undefined) => {
    const thread = get(threadsAtom).find((t) => t.id === threadId)
    if (!thread) {
      console.error(`Thread ${threadId} not found in state`)
      return
    }

    set(activeThreadIdAtom, threadId)
    const modelId = thread.assistants[0]?.model
    if (!modelId) {
      console.error(`No model id ${modelId} found in thread`, thread)
      return
    }

    const activeModelId = get(getSelectedModelAtom)?.model
    if (activeModelId === modelId) {
      console.debug('Model already selected:', modelId)
      return
    }

    const model = get(downloadedModelsAtom).find((m) => m.model === modelId)
    if (!model) {
      console.warn(`Model ${modelId} removed or deleted`)
      return
    }

    console.debug('Set selected model:', model)
    set(updateSelectedModelAtom, model)
  }
)

export const isLoadingModelAtom = atom<boolean | undefined>(undefined)

export const isGeneratingResponseAtom = atom<boolean>(false)

/**
 * Stores all threads for the current user
 */
export const threadsAtom = atom<Thread[]>([])

export const deleteThreadAtom = atom(null, (_get, set, threadId: string) => {
  set(threadsAtom, (threads) => {
    // set active thread to the latest
    const allThreads = threads.filter((c) => c.id !== threadId)
    if (allThreads.length > 0) {
      const latestThread = allThreads[0]
      set(activeThreadIdAtom, latestThread.id)
    }

    return allThreads
  })
})

export const activeThreadAtom = atom<Thread | undefined>((get) =>
  get(threadsAtom).find((c) => c.id === get(getActiveThreadIdAtom))
)

export const updateThreadTitleAtom = atom(
  null,
  (_get, set, threadId: string, title: string) => {
    set(
      threadsAtom,
      (threads) =>
        threads.map((t) =>
          t.id === threadId ? { ...t, title } : t
        ) as Thread[]
    )
  }
)

/**
 * Store model params at thread level settings
 */
export const threadModelParamsAtom = atom<Record<string, ModelParams>>({})

export type ModelParams = ModelRuntimeParams | ModelSettingParams

export const setThreadModelParamsAtom = atom(
  null,
  (get, set, threadId: string, params: ModelParams) => {
    const currentState = { ...get(threadModelParamsAtom) }
    currentState[threadId] = params
    set(threadModelParamsAtom, currentState)
  }
)
