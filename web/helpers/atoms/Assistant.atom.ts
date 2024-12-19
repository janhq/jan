import { Assistant, ThreadAssistantInfo } from '@janhq/core'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const assistantsAtom = atom<Assistant[]>([])

/**
 * Get the current active assistant
 */
export const activeAssistantAtom = atomWithStorage<
  ThreadAssistantInfo | undefined
>('activeAssistant', undefined, undefined, { getOnInit: true })
