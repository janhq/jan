import { Thread } from '@janhq/core'
import { atom } from 'jotai'

import { ThreadState } from '@/types/conversation'

/**
 * Stores the current active conversation id.
 */
const activeConversationIdAtom = atom<string | undefined>(undefined)

export const getActiveConvoIdAtom = atom((get) => get(activeConversationIdAtom))

export const setActiveConvoIdAtom = atom(
  null,
  (_get, set, convoId: string | undefined) => {
    set(activeConversationIdAtom, convoId)
  }
)

export const waitingToSendMessage = atom<boolean | undefined>(undefined)
/**
 * Stores all conversation states for the current user
 */
export const conversationStatesAtom = atom<Record<string, ThreadState>>({})
export const currentConvoStateAtom = atom<ThreadState | undefined>((get) => {
  const activeConvoId = get(activeConversationIdAtom)
  if (!activeConvoId) {
    console.debug('Active convo id is undefined')
    return undefined
  }

  return get(conversationStatesAtom)[activeConvoId]
})
export const addNewConversationStateAtom = atom(
  null,
  (get, set, conversationId: string, state: ThreadState) => {
    const currentState = { ...get(conversationStatesAtom) }
    currentState[conversationId] = state
    set(conversationStatesAtom, currentState)
  }
)
export const updateConversationWaitingForResponseAtom = atom(
  null,
  (get, set, conversationId: string, waitingForResponse: boolean) => {
    const currentState = { ...get(conversationStatesAtom) }
    currentState[conversationId] = {
      ...currentState[conversationId],
      waitingForResponse,
      error: undefined,
    }
    set(conversationStatesAtom, currentState)
  }
)
export const updateConversationErrorAtom = atom(
  null,
  (get, set, conversationId: string, error?: Error) => {
    const currentState = { ...get(conversationStatesAtom) }
    currentState[conversationId] = {
      ...currentState[conversationId],
      error,
    }
    set(conversationStatesAtom, currentState)
  }
)
export const updateConversationHasMoreAtom = atom(
  null,
  (get, set, conversationId: string, hasMore: boolean) => {
    const currentState = { ...get(conversationStatesAtom) }
    currentState[conversationId] = { ...currentState[conversationId], hasMore }
    set(conversationStatesAtom, currentState)
  }
)

export const updateThreadStateLastMessageAtom = atom(
  null,
  (get, set, conversationId: string, lastMessage?: string) => {
    const currentState = { ...get(conversationStatesAtom) }
    currentState[conversationId] = {
      ...currentState[conversationId],
      lastMessage,
    }
    set(conversationStatesAtom, currentState)
  }
)

export const updateConversationAtom = atom(
  null,
  (get, set, conversation: Thread) => {
    const id = conversation.id
    if (!id) return
    const convo = get(userConversationsAtom).find((c) => c.id === id)
    if (!convo) return

    const newConversations: Thread[] = get(userConversationsAtom).map((c) =>
      c.id === id ? conversation : c
    )

    // sort new conversations based on updated at
    newConversations.sort((a, b) => {
      const aDate = new Date(a.updatedAt ?? 0)
      const bDate = new Date(b.updatedAt ?? 0)
      return bDate.getTime() - aDate.getTime()
    })

    set(userConversationsAtom, newConversations)
  }
)

/**
 * Stores all conversations for the current user
 */
export const userConversationsAtom = atom<Thread[]>([])
export const currentConversationAtom = atom<Thread | undefined>((get) =>
  get(userConversationsAtom).find((c) => c.id === get(getActiveConvoIdAtom))
)
