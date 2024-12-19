import { Assistant, ThreadAssistantInfo } from '@janhq/core'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const assistantsAtom = atom<Assistant[]>([])

export const cachedAssistantAtom = atomWithStorage<
  ThreadAssistantInfo | undefined
>('activeAssistant', undefined, undefined, { getOnInit: true })
/**
 * Get the current active assistant
 */
export const activeAssistantAtom = atom(
  (get) => get(cachedAssistantAtom) ?? get(assistantsAtom)[0],
  (_get, set, newAssistant: ThreadAssistantInfo) => {
    set(cachedAssistantAtom, newAssistant)
  }
)
