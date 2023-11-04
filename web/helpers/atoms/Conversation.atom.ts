import { atom } from 'jotai'

import { activeBotAtom } from './Bot.atom'
// import { MainViewState, setMainViewStateAtom } from './MainView.atom'

/**
 * Stores the current active conversation id.
 */
const activeConversationIdAtom = atom<string | undefined>(undefined)

export const getActiveConvoIdAtom = atom((get) => get(activeConversationIdAtom))

export const setActiveConvoIdAtom = atom(
  null,
  (_get, set, convoId: string | undefined) => {
    // if (convoId) {
    //   console.debug(`Set active conversation id: ${convoId}`)
    //   set(setMainViewStateAtom, MainViewState.Chat)
    // }
    set(activeBotAtom, undefined)
    set(activeConversationIdAtom, convoId)
  }
)

/**
 * Stores all conversation states for the current user
 */
export const conversationStatesAtom = atom<Record<string, ConversationState>>(
  {}
)
export const currentConvoStateAtom = atom<ConversationState | undefined>(
  (get) => {
    const activeConvoId = get(activeConversationIdAtom)
    if (!activeConvoId) {
      console.debug('Active convo id is undefined')
      return undefined
    }

    return get(conversationStatesAtom)[activeConvoId]
  }
)
export const addNewConversationStateAtom = atom(
  null,
  (get, set, conversationId: string, state: ConversationState) => {
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

export const updateConversationAtom = atom(
  null,
  (get, set, conversation: Conversation) => {
    const id = conversation._id
    if (!id) return
    const convo = get(userConversationsAtom).find((c) => c._id === id)
    if (!convo) return

    const newConversations: Conversation[] = get(userConversationsAtom).map(
      (c) => (c._id === id ? conversation : c)
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
export const userConversationsAtom = atom<Conversation[]>([])
export const currentConversationAtom = atom<Conversation | undefined>((get) =>
  get(userConversationsAtom).find((c) => c._id === get(getActiveConvoIdAtom))
)
